import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { monthDir } from './paths.js'
import { upsertJob, readJobs, writeJobs, addLedgerEntry, saveCalibration } from './store.js'
import { calibrationKey, buildInput, countOf, priceFor } from './models.js'
import { log } from './log.js'
import { applyOverlays } from './overlay.js'

const POLL_MIN = 2000
const POLL_MAX = 10000

/**
 * Kolejka zadań: submit → polling → pobranie pliku na dysk.
 *
 * Reguły, które chronią pieniądze użytkownika:
 *  - `createTask` (POST) leci dokładnie RAZ. Przy błędzie sieci zadanie dostaje
 *    status `unknown` i to użytkownik decyduje, czy wysłać ponownie.
 *  - ponawiamy tylko GET-y (status, pobieranie pliku).
 *  - `failed` nie dopisuje kosztu do rejestru.
 */
export class Queue extends EventEmitter {
  constructor({ provider, concurrency = 3, models = [], fetchImpl = globalThis.fetch, pollIntervals = {}, downloadRetry = {} } = {}) {
    super()
    this.provider = provider
    this.concurrency = concurrency
    this.models = models
    this.fetch = fetchImpl
    this.pollMin = pollIntervals.min ?? POLL_MIN
    this.pollMax = pollIntervals.max ?? POLL_MAX
    this.downloadAttempts = downloadRetry.attempts ?? 4
    this.downloadBaseMs = downloadRetry.baseMs ?? 400
    this.timers = new Map()
    this.running = new Set()
    this.stopped = false
  }

  manifest(id) {
    return this.models.find((m) => m.id === id) || null
  }

  #emit(job) {
    upsertJob(job)
    this.emit('job', job)
  }

  /** Tworzy tyle zadań, ile wersji zamówił użytkownik. Zwraca listę zadań. */
  enqueue({ modelId, values, calibration = {}, references = [], overlays = [], styleId = null, styleName = null, styleSnapshot = null, userPrompt = null, variantOf = null, correction = null }) {
    const manifest = this.manifest(modelId)
    if (!manifest) throw new Error(`Nieznany model: ${modelId}`)
    const count = countOf(manifest, values)
    const input = buildInput(manifest, values)
    const price = priceFor(manifest, values, calibration)
    const batchId = randomUUID()
    const jobs = []
    for (let i = 0; i < count; i++) {
      const job = {
        id: randomUUID(),
        batchId,
        index: i + 1,
        of: count,
        createdAt: new Date().toISOString(),
        provider: this.provider.constructor.id || 'kie',
        modelId: manifest.id,
        model: manifest.model,
        modelTitle: manifest.title,
        input,
        values,
        references,
        overlays,
        pinIds: references.map((r) => r.pinId),
        styleId,
        styleName,
        styleSnapshot,
        userPrompt,
        variantOf,
        correction,
        status: 'queued',
        taskId: null,
        creditsEstimated: price.perImage,
        credits: null,
        files: [],
        error: null,
        startedAt: null,
        finishedAt: null,
      }
      jobs.push(job)
      this.#emit(job)
    }
    this.pump()
    return jobs
  }

  /** Wznawia pracę po restarcie aplikacji. */
  resume() {
    const jobs = readJobs()
    let changed = false
    for (const job of jobs) {
      if (job.status === 'running' && job.taskId) {
        this.running.add(job.id)
        this.#schedulePoll(job, this.pollMin)
      } else if (job.status === 'submitting') {
        // POST poszedł, ale nie wiemy, czy dotarł. Nie zgadujemy za użytkownika.
        job.status = 'unknown'
        job.error = 'Aplikacja zamknęła się w trakcie wysyłania. Sprawdź w panelu Kie.ai, czy zadanie ruszyło, zanim wyślesz je ponownie.'
        changed = true
      }
    }
    if (changed) writeJobs(jobs)
    this.pump()
    return jobs
  }

  pump() {
    if (this.stopped) return
    while (this.running.size < this.concurrency) {
      const next = readJobs().reverse().find((j) => j.status === 'queued' && !this.running.has(j.id))
      if (!next) break
      this.running.add(next.id)
      this.#submit(next)
    }
  }

  async #submit(job) {
    job.status = 'submitting'
    job.startedAt = new Date().toISOString()
    this.#emit(job)
    try {
      const { taskId } = await this.provider.submit({ model: job.model, input: job.input })
      job.taskId = taskId
      job.status = 'running'
      this.#emit(job)
      this.#schedulePoll(job, this.pollMin)
    } catch (err) {
      // Błąd sieci = nie wiemy, czy zadanie ruszyło. Błąd API (kod) = na pewno nie.
      const definite = Boolean(err.code)
      job.status = definite ? 'failed' : 'unknown'
      job.error = definite
        ? err.human || err.message
        : 'Nie wiemy, czy zadanie ruszyło. Sprawdź w panelu Kie.ai, zanim wyślesz je ponownie (inaczej zapłacisz dwa razy).'
      job.finishedAt = new Date().toISOString()
      this.running.delete(job.id)
      this.#emit(job)
      this.pump()
    }
  }

  #schedulePoll(job, delay) {
    if (this.stopped) return
    const jitter = Math.random() * 400
    const timer = setTimeout(() => this.#poll(job, delay), delay + jitter)
    if (timer.unref) timer.unref()
    this.timers.set(job.id, timer)
  }

  async #poll(job, prevDelay) {
    if (this.stopped) return
    try {
      const status = await this.provider.status(job.taskId)
      // Ostatnie UDANE sprawdzenie. Bez tego „generuję…” wygląda identycznie,
      // gdy zadanie po prostu trwa i gdy od dziesięciu minut nie ma łączności.
      job.lastStatusAt = new Date().toISOString()
      job.pollErrors = 0
      if (status.state === 'running') {
        this.#emit(job)
        this.#schedulePoll(job, Math.min(prevDelay * 1.5, this.pollMax))
        return
      }
      if (status.state === 'fail') {
        job.status = 'failed'
        job.error = status.failMsg || 'Dostawca zwrócił błąd.'
        job.credits = 0
        job.finishedAt = new Date().toISOString()
        this.running.delete(job.id)
        this.#emit(job)
        this.pump()
        return
      }
      job.status = 'downloading'
      job.credits = status.credits
      job.costTimeMs = status.costTimeMs
      job.sourceUrls = status.urls
      this.#emit(job)

      // Zadanie jest już opłacone, więc koszt zapisujemy niezależnie od tego,
      // czy pobieranie się powiedzie.
      if (status.credits != null) {
        const manifest = this.manifest(job.modelId)
        if (manifest) saveCalibration(calibrationKey(manifest, job.values), status.credits)
        addLedgerEntry({ jobId: job.id, modelId: job.modelId, credits: status.credits, resolution: job.values?.resolution })
      }

      try {
        await this.#download(job, status.urls)
        job.status = 'done'
      } catch (err) {
        job.status = 'download_failed'
        job.error = `Obraz powstał i został opłacony, ale nie udało się zapisać go na dysku (${err.message}). Kliknij „Pobierz ponownie” — linki u dostawcy żyją około 24 godzin.`
      }
      job.finishedAt = new Date().toISOString()
      this.#emit(job)
    } catch (err) {
      job.pollErrors = (job.pollErrors || 0) + 1
      job.pollError = err.human || err.message
      // Dostawca, który ODPOWIEDZIAŁ błędem (kod HTTP), to co innego niż zerwane
      // połączenie: pierwsze wymaga reakcji użytkownika, drugie zwykle mija samo.
      job.pollErrorKind = err.code ? 'api' : 'siec'
      if (job.pollErrors > 60) {
        job.status = 'unknown'
        job.error = `Nie udało się sprawdzić statusu: ${err.human || err.message}. Zadanie mogło się wykonać — sprawdź w panelu Kie.ai.`
        job.finishedAt = new Date().toISOString()
        this.running.delete(job.id)
        this.#emit(job)
        this.pump()
        return
      }
      this.#emit(job)
      this.#schedulePoll(job, Math.min(prevDelay * 1.5, this.pollMax))
      return
    } finally {
      this.timers.delete(job.id)
    }
    this.running.delete(job.id)
    this.pump()
  }

  /** URL-e u Kie żyją ~24 h, więc pobieramy natychmiast, z ponawianiem (to GET). */
  async #download(job, urls) {
    const dir = monthDir(new Date(job.createdAt))
    const files = []
    for (const [i, url] of urls.entries()) {
      const ext = guessExt(url)
      const base = `${job.id}${urls.length > 1 ? `-${i + 1}` : ''}`
      const file = path.join(dir, `${base}.${ext}`)
      let lastErr
      for (let attempt = 0; attempt < this.downloadAttempts; attempt++) {
        try {
          const res = await this.fetch(url, { signal: AbortSignal.timeout(120000) })
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          const buf = Buffer.from(await res.arrayBuffer())
          fs.writeFileSync(file, buf)
          files.push(file)
          lastErr = null
          break
        } catch (err) {
          lastErr = err
          if (attempt < this.downloadAttempts - 1) await sleep(this.downloadBaseMs * 2 ** attempt)
        }
      }
      if (lastErr) throw new Error(`Nie udało się pobrać pliku: ${lastErr.message}`)
      fs.writeFileSync(path.join(dir, `${base}.json`), JSON.stringify({
        id: job.id, createdAt: job.createdAt, model: job.model, modelTitle: job.modelTitle,
        prompt: job.values?.prompt, userPrompt: job.userPrompt, style: job.styleName,
        values: job.values, references: job.references, overlays: job.overlays, variantOf: job.variantOf, correction: job.correction,
        credits: job.credits, sourceUrl: url,
      }, null, 2))
    }
    job.files = files
    job.sourceUrls = urls
    this.#overlay(job)
  }

  /** Logo nakładane lokalnie — po pobraniu, na oryginał zachowany jako -raw. */
  #overlay(job) {
    if (!job.overlays?.length || !job.files?.length) return
    try {
      const res = applyOverlays(job.files[0], job.overlays)
      job.files = [res.file, ...job.files.slice(1)]
      job.rawFiles = [res.rawFile]
      job.overlayPlaced = res.placed
    } catch (err) {
      job.overlayError = err.human || err.message
      log.warn('Nakładka logo nie powiodła się:', String(err.message))
    }
  }

  /** Ponawia samo pobranie pliku (GET, więc bezpieczne i darmowe). */
  async redownload(jobId) {
    const job = readJobs().find((j) => j.id === jobId)
    if (!job) throw new Error('Nie ma takiego zadania.')
    if (!job.sourceUrls?.length) throw new Error('To zadanie nie ma linków do pobrania.')
    job.status = 'downloading'
    job.error = null
    this.#emit(job)
    try {
      await this.#download(job, job.sourceUrls)
      job.status = 'done'
    } catch (err) {
      job.status = 'download_failed'
      job.error = `Nadal nie udało się pobrać pliku (${err.message}). Jeśli minęły 24 godziny od generacji, link u dostawcy już wygasł.`
    }
    this.#emit(job)
    return job
  }

  stop() {
    this.stopped = true
    for (const t of this.timers.values()) clearTimeout(t)
    this.timers.clear()
  }
}

function guessExt(url) {
  const m = String(url).split('?')[0].match(/\.(png|jpe?g|webp|gif)$/i)
  return m ? m[1].toLowerCase() : 'png'
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
