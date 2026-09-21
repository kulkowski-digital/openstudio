import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'openstudio-test-'))
process.env.OPENSTUDIO_HOME = HOME

const { Queue } = await import('../server/queue.js')
const { loadModels } = await import('../server/models.js')
const { readJobs, writeJobs, readLedger, readConfig } = await import('../server/store.js')

const { models } = loadModels()
const PNG = Buffer.from('89504e470d0a1a0a', 'hex')

function fakeProvider({ failSubmit, failState, credits = 6, runningTicks = 1 } = {}) {
  let ticks = 0
  const calls = { submit: 0, status: 0 }
  return {
    calls,
    constructor: { id: 'fake' },
    async submit() {
      calls.submit++
      if (failSubmit) throw failSubmit
      return { taskId: 'task_' + calls.submit }
    },
    async status() {
      calls.status++
      if (ticks++ < runningTicks) return { state: 'running', urls: [], credits: null }
      if (failState) return { state: 'fail', urls: [], credits: null, failMsg: 'moderacja odrzuciła prompt' }
      return { state: 'success', urls: ['https://example.test/out.png'], credits, costTimeMs: 59000 }
    },
  }
}

const fakeFetch = async () => ({ ok: true, arrayBuffer: async () => PNG })

const values = { prompt: 'kot w kapeluszu', aspect_ratio: '1:1', resolution: '1K', count: 1 }

function waitFor(predicate, timeout = 4000) {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const tick = () => {
      if (predicate()) return resolve()
      if (Date.now() - started > timeout) return reject(new Error('timeout: ' + predicate.toString()))
      setTimeout(tick, 20)
    }
    tick()
  })
}

beforeEach(() => {
  writeJobs([])
  fs.rmSync(path.join(HOME, 'ledger.json'), { force: true })
  fs.rmSync(path.join(HOME, 'config.json'), { force: true })
})

test('pełny cykl: kolejka → submit → polling → plik na dysku → rejestr kosztów', async () => {
  const provider = fakeProvider()
  const q = new Queue({ provider, models, fetchImpl: fakeFetch, pollIntervals: { min: 10, max: 20 } })
  const [job] = q.enqueue({ modelId: 'gpt-image-2-5-flare-text-to-image', values })
  await waitFor(() => readJobs().find((j) => j.id === job.id)?.status === 'done')
  q.stop()

  const done = readJobs().find((j) => j.id === job.id)
  assert.equal(done.credits, 6)
  assert.equal(done.files.length, 1)
  assert.ok(fs.existsSync(done.files[0]), 'plik nie wylądował na dysku')
  assert.ok(fs.existsSync(done.files[0].replace(/\.png$/, '.json')), 'brak metadanych obok pliku')
  assert.equal(readLedger()[0].credits, 6)
  assert.equal(readConfig().calibration['gpt-image-2-5-flare-text-to-image|1K'].credits, 6)
})

test('count=3 tworzy 3 zadania, ale limit równoległości wysyła po 2 naraz', async () => {
  const provider = fakeProvider({ runningTicks: 2 })
  const q = new Queue({ provider, models, fetchImpl: fakeFetch, concurrency: 2, pollIntervals: { min: 10, max: 20 } })
  const jobs = q.enqueue({ modelId: 'gpt-image-2-5-flare-text-to-image', values: { ...values, count: 3 } })
  assert.equal(jobs.length, 3)
  assert.ok(provider.calls.submit <= 2, 'wysłano więcej zadań niż limit równoległości')
  await waitFor(() => readJobs().filter((j) => j.status === 'done').length === 3)
  q.stop()
  assert.equal(provider.calls.submit, 3)
})

test('błąd sieci przy POST: status „unknown”, ZERO ponowień (brak podwójnej opłaty)', async () => {
  const provider = fakeProvider({ failSubmit: new Error('ECONNRESET') })
  const q = new Queue({ provider, models, fetchImpl: fakeFetch, pollIntervals: { min: 10, max: 20 } })
  const [job] = q.enqueue({ modelId: 'gpt-image-2-5-flare-text-to-image', values })
  await waitFor(() => readJobs().find((j) => j.id === job.id)?.status === 'unknown')
  q.stop()
  assert.equal(provider.calls.submit, 1)
  assert.match(readJobs().find((j) => j.id === job.id).error, /dwa razy/)
})

test('błąd z kodem API kończy zadanie jako „failed”, bez kosztu w rejestrze', async () => {
  const err = Object.assign(new Error('403'), { code: 403, human: 'Skończyły się kredyty.' })
  const provider = fakeProvider({ failSubmit: err })
  const q = new Queue({ provider, models, fetchImpl: fakeFetch, pollIntervals: { min: 10, max: 20 } })
  const [job] = q.enqueue({ modelId: 'gpt-image-2-5-flare-text-to-image', values })
  await waitFor(() => readJobs().find((j) => j.id === job.id)?.status === 'failed')
  q.stop()
  assert.match(readJobs().find((j) => j.id === job.id).error, /kredyt/i)
  assert.deepEqual(readLedger(), [])
})

test('odrzucenie przez moderację: „failed”, koszt 0, nic w rejestrze', async () => {
  const provider = fakeProvider({ failState: true })
  const q = new Queue({ provider, models, fetchImpl: fakeFetch, pollIntervals: { min: 10, max: 20 } })
  const [job] = q.enqueue({ modelId: 'gpt-image-2-5-flare-text-to-image', values })
  await waitFor(() => readJobs().find((j) => j.id === job.id)?.status === 'failed')
  q.stop()
  const failed = readJobs().find((j) => j.id === job.id)
  assert.equal(failed.credits, 0)
  assert.match(failed.error, /moderacja/)
  assert.deepEqual(readLedger(), [])
})

test('po restarcie aplikacji niedokończone zadanie wraca do pollingu', async () => {
  writeJobs([{
    id: 'stare-zadanie', createdAt: new Date().toISOString(), modelId: 'gpt-image-2-5-flare-text-to-image',
    model: 'gpt-image-2-5-flare-text-to-image', values, status: 'running', taskId: 'task_stary', files: [],
  }])
  const provider = fakeProvider({ runningTicks: 0 })
  const q = new Queue({ provider, models, fetchImpl: fakeFetch, pollIntervals: { min: 10, max: 20 } })
  q.resume()
  await waitFor(() => readJobs().find((j) => j.id === 'stare-zadanie')?.status === 'done')
  q.stop()
  assert.equal(provider.calls.submit, 0, 'wznowienie nie może wysyłać POST-a ponownie')
})

test('zadanie przerwane w trakcie wysyłania nie jest wznawiane automatycznie', async () => {
  writeJobs([{ id: 'polowiczne', createdAt: new Date().toISOString(), modelId: 'gpt-image-2-5-flare-text-to-image', model: 'x', values, status: 'submitting', taskId: null, files: [] }])
  const q = new Queue({ provider: fakeProvider(), models, fetchImpl: fakeFetch, pollIntervals: { min: 10, max: 20 } })
  q.resume()
  q.stop()
  const job = readJobs().find((j) => j.id === 'polowiczne')
  assert.equal(job.status, 'unknown')
  assert.match(job.error, /Kie\.ai/)
})

test('gdy pobranie pliku padnie: koszt zapisany, zadanie czeka na „Pobierz ponownie”', async () => {
  let allowDownload = false
  const failingFetch = async () => {
    if (!allowDownload) throw new Error('ENOTFOUND cdn')
    return { ok: true, arrayBuffer: async () => PNG }
  }
  const provider = fakeProvider({ runningTicks: 0 })
  const q = new Queue({ provider, models, fetchImpl: failingFetch, pollIntervals: { min: 10, max: 20 }, downloadRetry: { attempts: 2, baseMs: 5 } })
  const [job] = q.enqueue({ modelId: 'gpt-image-2-5-flare-text-to-image', values })
  await waitFor(() => readJobs().find((j) => j.id === job.id)?.status === 'download_failed', 10000)

  const stuck = readJobs().find((j) => j.id === job.id)
  assert.equal(readLedger()[0].credits, 6, 'opłacona generacja musi zostać w rejestrze kosztów')
  assert.match(stuck.error, /Pobierz ponownie/)
  assert.ok(stuck.sourceUrls.length, 'link do pliku musi zostać zapamiętany')

  allowDownload = true
  const fixed = await q.redownload(job.id)
  q.stop()
  assert.equal(fixed.status, 'done')
  assert.ok(fs.existsSync(fixed.files[0]))
})

test('nieudane sprawdzenie statusu jest widoczne, udane kasuje licznik błędów', async () => {
  writeJobs([])
  let padnij = true
  const provider = {
    constructor: { id: 'fake' },
    async submit() { return { taskId: 'task_flaky' } },
    async status() {
      // Pierwsze odpytanie pada — to jest moment, w którym użytkownik widzi
      // „generuję…” i nie wie, czy czekać, czy sprawdzać internet.
      if (padnij) { padnij = false; const e = new Error('ETIMEDOUT'); e.human = 'Kie.ai nie odpowiedziało w ciągu 20 s.'; throw e }
      // (błąd bez `code` = problem z siecią; z kodem = dostawca odpowiedział)
      return { state: 'success', urls: ['https://example.test/out.png'], credits: 6, costTimeMs: 1000 }
    },
  }
  const q = new Queue({ provider, models, fetchImpl: fakeFetch, concurrency: 1, pollIntervals: { min: 10, max: 20 } })
  const [job] = q.enqueue({ modelId: 'gpt-image-2-5-flare-text-to-image', values })

  await waitFor(() => (readJobs().find((j) => j.id === job.id)?.pollErrors || 0) > 0)
  const poBledzie = readJobs().find((j) => j.id === job.id)
  assert.equal(poBledzie.pollErrors, 1)
  assert.match(poBledzie.pollError, /nie odpowiedziało/)
  assert.equal(poBledzie.pollErrorKind, 'siec', 'zerwane połączenie to nie to samo co błąd od dostawcy')
  assert.equal(poBledzie.lastStatusAt, undefined, 'nieudane odpytanie nie może udawać kontaktu z dostawcą')

  await waitFor(() => readJobs().find((j) => j.id === job.id)?.status === 'done')
  const koniec = readJobs().find((j) => j.id === job.id)
  assert.equal(koniec.pollErrors, 0, 'udane sprawdzenie kasuje ostrzeżenie o braku łączności')
  assert.ok(koniec.lastStatusAt, 'zapisujemy czas ostatniego UDANEGO sprawdzenia')
})
