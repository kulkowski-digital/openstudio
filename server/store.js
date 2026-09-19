import fs from 'node:fs'
import path from 'node:path'
import { CONFIG_FILE, JOBS_FILE, LEDGER_FILE, BOARDS_FILE, UPLOADS_FILE, STYLES_FILE, ensureDataDir } from './paths.js'
import { registerSecret, mask } from './log.js'

const SCHEMA_VERSION = 1

/** Zapis atomowy: najpierw plik tymczasowy, potem rename. Nigdy nie zostaje ogryzek. */
function writeJson(file, data, mode) {
  ensureDataDir()
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), mode ? { mode } : undefined)
  fs.renameSync(tmp, file)
  if (mode) fs.chmodSync(file, mode)
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return structuredClone(fallback)
  }
}

const DEFAULT_CONFIG = {
  schemaVersion: SCHEMA_VERSION,
  provider: 'kie',
  apiKey: null,
  sessionToken: null,
  concurrency: 3,
  monthlyLimitCredits: null,
  calibration: {},
  language: 'pl',
}

export function readConfig() {
  const cfg = { ...DEFAULT_CONFIG, ...readJson(CONFIG_FILE, DEFAULT_CONFIG) }
  if (cfg.apiKey) registerSecret(cfg.apiKey)
  return cfg
}

/** Klucz leży w ~/OpenStudio/config.json z prawami 0600 (tylko właściciel). */
export function writeConfig(patch) {
  const next = { ...readConfig(), ...patch, schemaVersion: SCHEMA_VERSION }
  if (next.apiKey) registerSecret(next.apiKey)
  writeJson(CONFIG_FILE, next, 0o600)
  return next
}

/** Wersja konfiguracji bezpieczna do wysłania do przeglądarki: bez klucza. */
export function publicConfig(cfg = readConfig()) {
  const { apiKey, sessionToken, ...rest } = cfg
  return { ...rest, hasApiKey: Boolean(apiKey), apiKeyMasked: apiKey ? mask(apiKey) : null }
}

export function saveCalibration(key, credits) {
  const cfg = readConfig()
  const prev = cfg.calibration[key]
  cfg.calibration[key] = {
    credits,
    samples: (prev?.samples || 0) + 1,
    updatedAt: new Date().toISOString(),
  }
  writeConfig({ calibration: cfg.calibration })
  return cfg.calibration
}

// ── Zadania ────────────────────────────────────────────────────────────────
export function readJobs() {
  const data = readJson(JOBS_FILE, { schemaVersion: SCHEMA_VERSION, jobs: [] })
  return Array.isArray(data.jobs) ? data.jobs : []
}

export function writeJobs(jobs) {
  writeJson(JOBS_FILE, { schemaVersion: SCHEMA_VERSION, jobs })
  return jobs
}

export function upsertJob(job) {
  const jobs = readJobs()
  const i = jobs.findIndex((j) => j.id === job.id)
  if (i === -1) jobs.unshift(job)
  else jobs[i] = job
  writeJobs(jobs.slice(0, 500))
  return job
}

export function getJob(id) {
  return readJobs().find((j) => j.id === id) || null
}

// ── Rejestr kosztów ────────────────────────────────────────────────────────
export function readLedger() {
  return readJson(LEDGER_FILE, { schemaVersion: SCHEMA_VERSION, entries: [] }).entries || []
}

export function addLedgerEntry(entry) {
  const entries = readLedger()
  entries.unshift({ at: new Date().toISOString(), ...entry })
  writeJson(LEDGER_FILE, { schemaVersion: SCHEMA_VERSION, entries: entries.slice(0, 5000) })
  return entry
}

/** Suma realnie pobranych kredytów z ostatnich 30 dni (licznik tej aplikacji). */
export function creditsLast30Days() {
  const since = Date.now() - 30 * 24 * 3600 * 1000
  return readLedger()
    .filter((e) => new Date(e.at).getTime() >= since)
    .reduce((sum, e) => sum + (Number(e.credits) || 0), 0)
}

export function libraryItems(limit = 200) {
  return readJobs()
    .filter((j) => j.status === 'done' && j.files?.length)
    .slice(0, limit)
}

// ── Tablice (inspiracje) ───────────────────────────────────────────────────
export function readBoards() {
  const data = readJson(BOARDS_FILE, { schemaVersion: SCHEMA_VERSION, boards: [] })
  return Array.isArray(data.boards) ? data.boards : []
}

export function writeBoards(boards) {
  writeJson(BOARDS_FILE, { schemaVersion: SCHEMA_VERSION, boards })
  return boards
}

// ── Cache wysłanych referencji ─────────────────────────────────────────────
// Pliki u dostawcy żyją 24 h, więc trzymamy je krócej (20 h) i wysyłamy ponownie.
export const UPLOAD_TTL_MS = 20 * 3600 * 1000

export function readUploads() {
  return readJson(UPLOADS_FILE, { schemaVersion: SCHEMA_VERSION, uploads: {} }).uploads || {}
}

export function getUpload(hash) {
  const entry = readUploads()[hash]
  if (!entry) return null
  if (Date.now() - new Date(entry.uploadedAt).getTime() > UPLOAD_TTL_MS) return null
  return entry
}

export function saveUpload(hash, url) {
  const uploads = readUploads()
  uploads[hash] = { url, uploadedAt: new Date().toISOString() }
  // Wpisy starsze niż doba i tak są nieważne — nie hodujemy pliku w nieskończoność.
  for (const [key, entry] of Object.entries(uploads)) {
    if (Date.now() - new Date(entry.uploadedAt).getTime() > UPLOAD_TTL_MS * 2) delete uploads[key]
  }
  writeJson(UPLOADS_FILE, { schemaVersion: SCHEMA_VERSION, uploads })
  return uploads[hash]
}

export function forgetUpload(hash) {
  const uploads = readUploads()
  delete uploads[hash]
  writeJson(UPLOADS_FILE, { schemaVersion: SCHEMA_VERSION, uploads })
}

// ── Style (zapisany przepis na wygląd) ─────────────────────────────────────
export function readStyles() {
  const data = readJson(STYLES_FILE, { schemaVersion: SCHEMA_VERSION, styles: [] })
  return Array.isArray(data.styles) ? data.styles : []
}

export function writeStyles(styles) {
  writeJson(STYLES_FILE, { schemaVersion: SCHEMA_VERSION, styles })
  return styles
}
