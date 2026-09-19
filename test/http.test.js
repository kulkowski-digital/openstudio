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
const state = { tasks: new Map(), submits: 0, uploads: 0, lastInput: null }
// prawdziwy plik PNG 1×1 — atrapa musi zwracać coś, co przejdzie rozpoznanie formatu
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

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
      let raw = ''
      req.on('data', (c) => { raw += c })
      return req.on('end', () => {
        try { state.lastInput = JSON.parse(raw).input } catch { state.lastInput = null }
        send({ code: 200, data: { taskId: id } })
      })
    }
    if (url.pathname === '/api/file-base64-upload') {
      state.uploads++
      return send({ success: true, code: 200, data: { downloadUrl: `http://127.0.0.1:${kie.address().port}/ref-${state.uploads}.png` } })
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
  process.env.OPENSTUDIO_KIE_UPLOAD_BASE = `http://127.0.0.1:${kie.address().port}`
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

// ── Tablice ────────────────────────────────────────────────────────────────

const PIN_PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(32, 7)]).toString('base64')
const PIN_PNG2 = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(32, 9)]).toString('base64')

test('tablica startowa jest w stanie aplikacji od pierwszego wejścia', async () => {
  const body = await (await call('/api/state')).json()
  assert.equal(body.boards.length, 1)
  assert.equal(body.boards[0].pins.length, 0)
})

test('inspiracja wrzucona z przeglądarki ląduje na dysku, nie u dostawcy', async () => {
  const uploadsBefore = state.uploads
  const board = (await (await call('/api/boards')).json()).boards[0]
  const res = await call(`/api/boards/${board.id}/pins`, { method: 'POST', body: JSON.stringify({ base64: PIN_PNG, mime: 'image/png', name: 'inspiracja.png' }) })
  assert.equal(res.status, 200)
  const { pin } = await res.json()
  assert.ok(fs.existsSync(pin.file))
  assert.equal(state.uploads, uploadsBefore, 'sam wrzut na tablicę nie może nic wysyłać do dostawcy')

  const file = await call(`/api/file?path=${encodeURIComponent(pin.file)}`)
  assert.equal(file.status, 200, 'pliki tablic muszą być widoczne w przeglądarce')
})

test('plik, który nie jest obrazem, dostaje 400 z komunikatem po polsku', async () => {
  const board = (await (await call('/api/boards')).json()).boards[0]
  const res = await call(`/api/boards/${board.id}/pins`, { method: 'POST', body: JSON.stringify({ base64: Buffer.from('%PDF-1.7').toString('base64'), name: 'x.pdf' }) })
  assert.equal(res.status, 400)
  assert.match((await res.json()).error, /nie jest obraz/i)
})

test('„Generuj w tym klimacie”: inspiracje trafiają do modelu jako input_urls', async () => {
  const board = (await (await call('/api/boards')).json()).boards[0]
  const p2 = (await (await call(`/api/boards/${board.id}/pins`, { method: 'POST', body: JSON.stringify({ base64: PIN_PNG2, name: 'druga.png' }) })).json()).pin
  const pins = (await (await call('/api/boards')).json()).boards[0].pins

  const uploadsBefore = state.uploads
  const res = await call('/api/generate', {
    method: 'POST',
    body: JSON.stringify({
      modelId: 'gpt-image-2-5-flare-image-to-image',
      values: { prompt: 'w tym klimacie, ale zimą', aspect_ratio: '1:1', resolution: '1K', count: 1 },
      pinIds: pins.map((p) => p.id),
    }),
  })
  assert.equal(res.status, 200)
  const { jobs } = await res.json()
  assert.equal(state.uploads, uploadsBefore + 2, 'dopiero generacja wysyła inspiracje')
  await waitFor(() => readJobs().find((j) => j.id === jobs[0].id)?.status === 'done', 15000)

  assert.ok(Array.isArray(state.lastInput.input_urls))
  assert.equal(state.lastInput.input_urls.length, 2)
  assert.deepEqual(readJobs().find((j) => j.id === jobs[0].id).pinIds.length, 2)
  assert.ok(p2)
})

test('drugie użycie tych samych inspiracji nie wysyła ich ponownie', async () => {
  const pins = (await (await call('/api/boards')).json()).boards[0].pins
  const uploadsBefore = state.uploads
  const res = await call('/api/generate', {
    method: 'POST',
    body: JSON.stringify({
      modelId: 'gpt-image-2-5-flare-image-to-image',
      values: { prompt: 'jeszcze raz', aspect_ratio: '1:1', resolution: '1K', count: 1 },
      pinIds: pins.map((p) => p.id),
    }),
  })
  assert.equal(res.status, 200)
  assert.equal(state.uploads, uploadsBefore, 'cache wysłanych plików nie zadziałał')
})

test('model bez referencji odmawia inspiracji i podpowiada, co zrobić', async () => {
  const pins = (await (await call('/api/boards')).json()).boards[0].pins
  const res = await call('/api/generate', {
    method: 'POST',
    body: JSON.stringify({
      modelId: 'gpt-image-2-5-flare-text-to-image',
      values: { prompt: 'x', resolution: '1K', count: 1 },
      pinIds: pins.map((p) => p.id),
    }),
  })
  assert.equal(res.status, 400)
  assert.match((await res.json()).error, /z inspiracji/)
})

test('„Przypnij do tablicy” bierze gotowy obraz z biblioteki', async () => {
  const lib = await (await call('/api/library')).json()
  const board = (await (await call('/api/boards')).json()).boards[0]
  const res = await call(`/api/boards/${board.id}/pins`, { method: 'POST', body: JSON.stringify({ fromFile: lib.items[0].files[0] }) })
  assert.equal(res.status, 200)
  assert.ok((await res.json()).pin.id)
})

test('„Przypnij” nie wpuści pliku spoza biblioteki i tablic', async () => {
  const board = (await (await call('/api/boards')).json()).boards[0]
  const res = await call(`/api/boards/${board.id}/pins`, { method: 'POST', body: JSON.stringify({ fromFile: '/etc/hosts' }) })
  assert.equal(res.status, 400)
})

test('notatka na inspiracji zapisuje się i usuwanie działa', async () => {
  const board = (await (await call('/api/boards')).json()).boards[0]
  const pin = board.pins[0]
  const updated = await (await call(`/api/pins/${pin.id}`, { method: 'PATCH', body: JSON.stringify({ note: 'podoba mi się światło, nie kolory' }) })).json()
  assert.match(updated.pin.note, /światło/)

  assert.equal((await call(`/api/pins/${pin.id}`, { method: 'DELETE' })).status, 200)
  const after = (await (await call('/api/boards')).json()).boards[0]
  assert.equal(after.pins.find((p) => p.id === pin.id), undefined)
})

// ── Token sesji ────────────────────────────────────────────────────────────

test('token sesji przeżywa restart aplikacji (otwarta karta nie umiera)', async () => {
  const { getOrCreateSessionToken, resetSessionToken } = await import('../server/security.js')
  const { readConfig, writeConfig, publicConfig } = await import('../server/store.js')

  const first = getOrCreateSessionToken(readConfig, writeConfig)
  const second = getOrCreateSessionToken(readConfig, writeConfig)
  assert.equal(second, first, 'ponowne uruchomienie musi wziąć ten sam token')
  assert.ok(first.length >= 32)

  const fresh = resetSessionToken(writeConfig)
  assert.notEqual(fresh, first, 'reset-token musi unieważnić stary adres')

  assert.equal(publicConfig().sessionToken, undefined, 'token nie może iść do przeglądarki w stanie aplikacji')
})

// ── Wejście z paska adresu ─────────────────────────────────────────────────

test('wejście z paska adresu dostaje token w stronie (goły adres po prostu działa)', async () => {
  const res = await app.request(`http://127.0.0.1:${PORT}/`, {
    headers: { host: `127.0.0.1:${PORT}`, 'sec-fetch-dest': 'document', 'sec-fetch-mode': 'navigate', 'sec-fetch-site': 'none' },
  })
  assert.equal(res.status, 200)
  const html = await res.text()
  assert.match(html, /__OPENSTUDIO_TOKEN__/)
  assert.ok(html.includes(TOKEN))
  assert.equal(res.headers.get('x-frame-options'), 'DENY')
})

test('ta sama strona wczytana przez obcą witrynę NIE dostaje tokenu', async () => {
  for (const headers of [
    { 'sec-fetch-dest': 'iframe', 'sec-fetch-mode': 'navigate', 'sec-fetch-site': 'cross-site' },
    { 'sec-fetch-dest': 'document', 'sec-fetch-mode': 'navigate', 'sec-fetch-site': 'cross-site' },
    { 'sec-fetch-dest': 'empty', 'sec-fetch-mode': 'cors', 'sec-fetch-site': 'cross-site' },
  ]) {
    const res = await app.request(`http://127.0.0.1:${PORT}/`, { headers: { host: `127.0.0.1:${PORT}`, ...headers } })
    const html = await res.text()
    assert.ok(!html.includes('__OPENSTUDIO_TOKEN__'), `token wyciekł przy ${JSON.stringify(headers)}`)
  }
})

test('żądanie bez nagłówków Sec-Fetch (curl, skrypt) też nie dostaje tokenu', async () => {
  const res = await app.request(`http://127.0.0.1:${PORT}/`, { headers: { host: `127.0.0.1:${PORT}` } })
  const html = await res.text()
  assert.ok(!html.includes('__OPENSTUDIO_TOKEN__'))
})
