import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Hono } from 'hono'
import { guard } from './security.js'
import { KieProvider } from './providers/kie.js'
import { loadModels, validateValues, priceFor, defaultValues } from './models.js'
import {
  readConfig, writeConfig, publicConfig, readJobs, getJob, upsertJob,
  readLedger, creditsLast30Days, libraryItems,
} from './store.js'
import { Queue } from './queue.js'
import { DATA_DIR, LIBRARY_DIR, ensureDataDir } from './paths.js'
import { log, mask } from './log.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const WEB_DIST = path.join(HERE, '..', 'web', 'dist')

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.json': 'application/json', '.ico': 'image/x-icon' }

/** Buduje aplikację. Osobno od `listen`, żeby dało się ją testować bez portu. */
export function createApp({ token, port }) {
  ensureDataDir()
  const app = new Hono()
  const { models, problems } = loadModels()
  if (problems.length) log.warn('Problemy z manifestami modeli:', problems.join('; '))

  const state = { queue: null, provider: null, clients: new Set() }

  function provider() {
    const cfg = readConfig()
    if (!cfg.apiKey) return null
    if (!state.provider || state.provider.apiKey !== cfg.apiKey) {
      state.provider = new KieProvider({ apiKey: cfg.apiKey })
      if (state.queue) state.queue.stop()
      state.queue = null
    }
    return state.provider
  }

  function queue() {
    const p = provider()
    if (!p) return null
    if (!state.queue) {
      const cfg = readConfig()
      state.queue = new Queue({ provider: p, models, concurrency: cfg.concurrency })
      state.queue.on('job', (job) => broadcast({ type: 'job', job }))
      state.queue.resume()
    }
    return state.queue
  }

  function broadcast(payload) {
    const line = `data: ${JSON.stringify(payload)}\n\n`
    for (const client of state.clients) {
      try { client.write(line) } catch { state.clients.delete(client) }
    }
  }

  app.use('*', guard({ token, port }))

  // ── Stan aplikacji ───────────────────────────────────────────────────────
  app.get('/api/state', async (c) => {
    const cfg = readConfig()
    const catalog = models.map((m) => ({ ...m, defaults: defaultValues(m) }))
    return c.json({
      config: publicConfig(cfg),
      models: catalog,
      jobs: readJobs().slice(0, 100),
      spend: { credits30d: creditsLast30Days(), limit: cfg.monthlyLimitCredits },
      dataDir: DATA_DIR,
      manifestProblems: problems,
    })
  })

  app.get('/api/credits', async (c) => {
    const p = provider()
    if (!p) return c.json({ error: 'Najpierw dodaj klucz API.' }, 400)
    try {
      return c.json({ credits: await p.credits() })
    } catch (err) {
      return c.json({ error: err.human || err.message }, 502)
    }
  })

  // ── Klucz API ────────────────────────────────────────────────────────────
  app.post('/api/key', async (c) => {
    const { apiKey } = await c.req.json().catch(() => ({}))
    if (!apiKey || typeof apiKey !== 'string' || apiKey.length < 8) {
      return c.json({ error: 'Wklej klucz API z kie.ai/api-key.' }, 400)
    }
    const probe = new KieProvider({ apiKey: apiKey.trim() })
    const result = await probe.validateKey()
    if (!result.ok) return c.json({ error: result.human }, 400)
    writeConfig({ apiKey: apiKey.trim() })
    state.provider = null
    if (state.queue) { state.queue.stop(); state.queue = null }
    queue()
    return c.json({ ok: true, credits: result.credits, masked: mask(apiKey.trim()) })
  })

  app.delete('/api/key', (c) => {
    writeConfig({ apiKey: null })
    state.provider = null
    if (state.queue) { state.queue.stop(); state.queue = null }
    return c.json({ ok: true })
  })

  app.post('/api/settings', async (c) => {
    const body = await c.req.json().catch(() => ({}))
    const patch = {}
    if (body.concurrency !== undefined) patch.concurrency = Math.min(Math.max(1, Number(body.concurrency) || 1), 8)
    if (body.monthlyLimitCredits !== undefined) {
      patch.monthlyLimitCredits = body.monthlyLimitCredits === null ? null : Math.max(0, Number(body.monthlyLimitCredits) || 0)
    }
    const cfg = writeConfig(patch)
    if (state.queue) state.queue.concurrency = cfg.concurrency
    return c.json({ ok: true, config: publicConfig(cfg) })
  })

  // ── Cena i generacja ─────────────────────────────────────────────────────
  app.post('/api/price', async (c) => {
    const { modelId, values } = await c.req.json().catch(() => ({}))
    const manifest = models.find((m) => m.id === modelId)
    if (!manifest) return c.json({ error: 'Nieznany model.' }, 400)
    const cfg = readConfig()
    return c.json(priceFor(manifest, values || {}, cfg.calibration))
  })

  app.post('/api/generate', async (c) => {
    const { modelId, values } = await c.req.json().catch(() => ({}))
    const manifest = models.find((m) => m.id === modelId)
    if (!manifest) return c.json({ error: 'Nieznany model.' }, 400)

    const check = validateValues(manifest, values || {})
    if (!check.ok) return c.json({ error: check.errors.join(' ') }, 400)

    const q = queue()
    if (!q) return c.json({ error: 'Najpierw dodaj klucz API.' }, 400)

    const cfg = readConfig()
    const price = priceFor(manifest, values, cfg.calibration)
    if (cfg.monthlyLimitCredits != null && price.credits != null) {
      const spent = creditsLast30Days()
      if (spent + price.credits > cfg.monthlyLimitCredits) {
        return c.json({
          error: `Limit wydatków (${cfg.monthlyLimitCredits} kredytów / 30 dni) zostałby przekroczony: wydano ${spent}, ta generacja to ${price.credits}. Zmień limit w Ustawieniach albo poczekaj.`,
        }, 402)
      }
    }

    const jobs = q.enqueue({ modelId, values, calibration: cfg.calibration })
    return c.json({ jobs, price })
  })

  // ── Zadania ──────────────────────────────────────────────────────────────
  app.get('/api/jobs', (c) => c.json({ jobs: readJobs().slice(0, 200) }))

  app.post('/api/jobs/:id/resend', async (c) => {
    const job = getJob(c.req.param('id'))
    if (!job) return c.json({ error: 'Nie ma takiego zadania.' }, 404)
    if (job.status !== 'unknown' && job.status !== 'failed') {
      return c.json({ error: 'Ponownie wysyłamy tylko zadania nieudane albo o nieznanym losie.' }, 400)
    }
    const q = queue()
    if (!q) return c.json({ error: 'Najpierw dodaj klucz API.' }, 400)
    const cfg = readConfig()
    const jobs = q.enqueue({ modelId: job.modelId, values: { ...job.values, count: 1 }, calibration: cfg.calibration })
    return c.json({ jobs })
  })

  app.post('/api/jobs/:id/redownload', async (c) => {
    const q = queue()
    if (!q) return c.json({ error: 'Najpierw dodaj klucz API.' }, 400)
    try {
      return c.json({ job: await q.redownload(c.req.param('id')) })
    } catch (err) {
      return c.json({ error: err.message }, 400)
    }
  })

  app.delete('/api/jobs/:id', (c) => {
    const job = getJob(c.req.param('id'))
    if (!job) return c.json({ error: 'Nie ma takiego zadania.' }, 404)
    if (['queued', 'submitting', 'running', 'downloading'].includes(job.status)) {
      return c.json({ error: 'To zadanie jest w toku.' }, 400)
    }
    upsertJob({ ...job, status: 'hidden' })
    return c.json({ ok: true })
  })

  // ── Biblioteka ───────────────────────────────────────────────────────────
  app.get('/api/library', (c) => c.json({ items: libraryItems(), dir: LIBRARY_DIR }))

  app.get('/api/file', (c) => {
    const p = c.req.query('path')
    if (!p) return c.json({ error: 'Brak ścieżki.' }, 400)
    const resolved = path.resolve(p)
    // Wolno podawać wyłącznie pliki z biblioteki użytkownika.
    if (!resolved.startsWith(path.resolve(LIBRARY_DIR) + path.sep)) {
      return c.json({ error: 'Dostęp tylko do plików w bibliotece.' }, 403)
    }
    if (!fs.existsSync(resolved)) return c.json({ error: 'Plik zniknął z dysku.' }, 404)
    const body = fs.readFileSync(resolved)
    return c.body(body, 200, { 'Content-Type': MIME[path.extname(resolved).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' })
  })

  app.get('/api/ledger', (c) => c.json({ entries: readLedger().slice(0, 500), credits30d: creditsLast30Days() }))

  // ── Diagnostyka (raport bez klucza) ──────────────────────────────────────
  app.get('/api/doctor', async (c) => {
    return c.json(await diagnostics({ port, models, problems, provider: provider() }))
  })

  // ── Zdarzenia na żywo ────────────────────────────────────────────────────
  app.get('/api/events', (c) => {
    const { readable, writable } = new TransformStream()
    const writer = writable.getWriter()
    const encoder = new TextEncoder()
    const client = { write: (line) => writer.write(encoder.encode(line)) }
    state.clients.add(client)
    client.write(`retry: 2000\n\n`)
    const ping = setInterval(() => client.write(': ping\n\n').catch(() => {}), 15000)
    if (ping.unref) ping.unref()
    c.req.raw.signal?.addEventListener('abort', () => {
      clearInterval(ping)
      state.clients.delete(client)
      writer.close().catch(() => {})
    })
    return new Response(readable, {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
    })
  })

  // ── Frontend ─────────────────────────────────────────────────────────────
  app.get('*', (c) => {
    const url = new URL(c.req.url)
    const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1)
    const file = path.resolve(WEB_DIST, rel)
    if (!file.startsWith(path.resolve(WEB_DIST))) return c.text('Nie znaleziono', 404)
    if (fs.existsSync(file) && fs.statSync(file).isFile()) {
      return c.body(fs.readFileSync(file), 200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' })
    }
    const index = path.join(WEB_DIST, 'index.html')
    if (fs.existsSync(index)) return c.html(fs.readFileSync(index, 'utf8'))
    return c.html('<h1>Brak zbudowanego interfejsu</h1><p>Uruchom <code>npm run build</code> w katalogu projektu.</p>', 200)
  })

  app.queueRef = () => state.queue
  app.bootQueue = () => queue()
  return app
}

/** Raport „Diagnostyka”: wszystko, co potrzebne do zgłoszenia, bez klucza API. */
export async function diagnostics({ port, models = [], problems = [], provider = null } = {}) {
  const cfg = readConfig()
  let writable = false
  try {
    fs.accessSync(DATA_DIR, fs.constants.W_OK)
    writable = true
  } catch {}
  const report = {
    app: 'openstudio',
    version: JSON.parse(fs.readFileSync(path.join(HERE, '..', 'package.json'), 'utf8')).version,
    node: process.version,
    platform: `${process.platform} ${process.arch}`,
    port,
    dataDir: DATA_DIR,
    dataDirWritable: writable,
    hasApiKey: Boolean(cfg.apiKey),
    apiKeyMasked: cfg.apiKey ? mask(cfg.apiKey) : null,
    models: models.length,
    manifestProblems: problems,
    webBuilt: fs.existsSync(path.join(WEB_DIST, 'index.html')),
    jobs: readJobs().length,
    credits30d: creditsLast30Days(),
  }
  if (provider) {
    const res = await provider.validateKey()
    report.apiKeyValid = res.ok
    report.credits = res.ok ? res.credits : null
    report.apiError = res.ok ? null : res.human
  }
  return report
}
