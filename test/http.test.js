import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'openstudio-http-'))
process.env.OPENSTUDIO_HOME = HOME

// Atrapa Kie.ai: testy nie dotykają prawdziwego API i nie kosztują kredytów.
let kie
const state = { tasks: new Map(), submits: 0 }
const PNG = Buffer.from('89504e470d0a1a0a', 'hex')

before(async () => {
  kie = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost')
    const auth = req.headers.authorization || ''
    const send = (obj, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)) }
    // Pliki wynikowe leżą na CDN-ie bez autoryzacji — tak samo jak u Kie.
    if (url.pathname === '/out.png') { res.writeHead(200, { 'Content-Type': 'image/png' }); return res.end(PNG) }
    if (!auth.includes('dobry-klucz')) return send({ code: 401, msg: 'unauthorized' }, 401)
    if (url.pathname === '/api/v1/chat/credit') return send({ code: 200, data: 500 })
    if (url.pathname === '/api/v1/jobs/createTask') {
      const id = 'task_' + ++state.submits
      state.tasks.set(id, 0)
      return send({ code: 200, data: { taskId: id } })
    }
    if (url.pathname === '/api/v1/jobs/recordInfo') {
      const id = url.searchParams.get('taskId')
      const n = (state.tasks.get(id) ?? 0) + 1
      state.tasks.set(id, n)
      if (n < 2) return send({ code: 200, data: { state: 'generating' } }) // pierwszy odpyt: w toku
      return send({ code: 200, data: { state: 'success', resultJson: JSON.stringify({ resultUrls: [`http://127.0.0.1:${kie.address().port}/out.png`] }), creditsConsumed: 6, costTime: 59000 } })
    }
    if (url.pathname === '/out.png') { res.writeHead(200, { 'Content-Type': 'image/png' }); return res.end(PNG) }
    send({ code: 404, msg: 'not found' }, 404)
  })
  await new Promise((r) => kie.listen(0, '127.0.0.1', r))
  process.env.OPENSTUDIO_KIE_BASE = `http://127.0.0.1:${kie.address().port}`
})

after(() => kie?.close())

const { createApp } = await import('../server/app.js')
const { readJobs } = await import('../server/store.js')

const TOKEN = 'token-testowy-123'
const PORT = 4321
const app = createApp({ token: TOKEN, port: PORT })

const call = (pathname, opts = {}) => app.request(`http://127.0.0.1:${PORT}${pathname}`, {
  ...opts,
  headers: { host: `127.0.0.1:${PORT}`, 'x-openstudio-token': TOKEN, 'Content-Type': 'application/json', ...(opts.headers || {}) },
})

test('bez tokenu API jest zamknięte (ochrona przed złośliwą stroną w tej samej przeglądarce)', async () => {
  const res = await app.request(`http://127.0.0.1:${PORT}/api/state`, { headers: { host: `127.0.0.1:${PORT}` } })
  assert.equal(res.status, 401)
})

test('obcy Origin jest odrzucany (CSRF)', async () => {
  const res = await call('/api/state', { headers: { origin: 'https://zla-strona.example' } })
  assert.equal(res.status, 403)
})

test('obcy Host jest odrzucany (DNS rebinding)', async () => {
  const res = await app.request(`http://evil.example/api/state`, { headers: { host: 'evil.example', 'x-openstudio-token': TOKEN } })
  assert.equal(res.status, 403)
})

test('z tokenem /api/state zwraca katalog modeli i NIE zwraca klucza', async () => {
  const res = await call('/api/state')
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.models.length, 4)
  assert.equal(body.config.hasApiKey, false)
  assert.ok(!JSON.stringify(body).includes('apiKey"'), 'klucz nie może iść do przeglądarki')
})

test('zły klucz nie zostaje zapisany, użytkownik dostaje komunikat po polsku', async () => {
  const res = await call('/api/key', { method: 'POST', body: JSON.stringify({ apiKey: 'zly-klucz-abcdefgh' }) })
  assert.equal(res.status, 400)
  assert.match((await res.json()).error, /klucz/i)
})

test('dobry klucz jest zapisany zamaskowany i pokazuje saldo', async () => {
  const res = await call('/api/key', { method: 'POST', body: JSON.stringify({ apiKey: 'dobry-klucz-1234567890' }) })
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.credits, 500)
  assert.match(body.masked, /^dob…/)
  assert.equal((await (await call('/api/state')).json()).config.hasApiKey, true)
})

test('cena przed kliknięciem: 1K pewna, 2K oznaczona jako szacunek', async () => {
  const res = await call('/api/price', { method: 'POST', body: JSON.stringify({ modelId: 'gpt-image-2-5-flare-text-to-image', values: { resolution: '2K', count: 2 } }) })
  const body = await res.json()
  assert.equal(body.credits, 24)
  assert.equal(body.estimated, true)
})

test('generacja bez promptu jest zatrzymana ZANIM pójdzie do API', async () => {
  const before = state.submits
  const res = await call('/api/generate', { method: 'POST', body: JSON.stringify({ modelId: 'gpt-image-2-5-flare-text-to-image', values: { resolution: '1K' } }) })
  assert.equal(res.status, 400)
  assert.match((await res.json()).error, /Uzupełnij/)
  assert.equal(state.submits, before, 'wysłano zapytanie mimo błędnego formularza')
})

test('pełna generacja przez API aplikacji kończy się plikiem w bibliotece', async () => {
  const res = await call('/api/generate', { method: 'POST', body: JSON.stringify({ modelId: 'gpt-image-2-5-flare-text-to-image', values: { prompt: 'kot', aspect_ratio: '1:1', resolution: '1K', count: 1 } }) })
  assert.equal(res.status, 200)
  const { jobs } = await res.json()
  await waitFor(() => readJobs().find((j) => j.id === jobs[0].id)?.status === 'done', 15000)
  const job = readJobs().find((j) => j.id === jobs[0].id)
  assert.equal(job.credits, 6)
  assert.ok(fs.existsSync(job.files[0]))

  const lib = await (await call('/api/library')).json()
  assert.equal(lib.items.length, 1)

  const file = await call(`/api/file?path=${encodeURIComponent(job.files[0])}`)
  assert.equal(file.status, 200)
  assert.equal(file.headers.get('content-type'), 'image/png')
})

test('nie da się wyciągnąć pliku spoza biblioteki', async () => {
  const res = await call(`/api/file?path=${encodeURIComponent('/etc/passwd')}`)
  assert.equal(res.status, 403)
})

test('limit wydatków blokuje generację PRZED wysłaniem', async () => {
  await call('/api/settings', { method: 'POST', body: JSON.stringify({ monthlyLimitCredits: 3 }) })
  const before = state.submits
  const res = await call('/api/generate', { method: 'POST', body: JSON.stringify({ modelId: 'gpt-image-2-5-flare-text-to-image', values: { prompt: 'kot', resolution: '1K', count: 1 } }) })
  assert.equal(res.status, 402)
  assert.match((await res.json()).error, /Limit wydatków/)
  assert.equal(state.submits, before)
  await call('/api/settings', { method: 'POST', body: JSON.stringify({ monthlyLimitCredits: null }) })
})

test('diagnostyka nie zawiera klucza API', async () => {
  const body = await (await call('/api/doctor')).json()
  assert.ok(!JSON.stringify(body).includes('dobry-klucz-1234567890'))
  assert.equal(body.apiKeyValid, true)
  assert.equal(body.apiKeyMasked, 'dob…7890')
})

function waitFor(predicate, timeout = 4000) {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const tick = () => {
      if (predicate()) return resolve()
      if (Date.now() - started > timeout) return reject(new Error('timeout'))
      setTimeout(tick, 25)
    }
    tick()
  })
}
