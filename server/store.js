import fs from 'node:fs'
import path from 'node:path'
import { CONFIG_FILE, JOBS_FILE, LEDGER_FILE, ensureDataDir } from './paths.js'
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
  const { apiKey, ...rest } = cfg
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
