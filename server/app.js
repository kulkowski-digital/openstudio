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
import { DATA_DIR, LIBRARY_DIR, SERVABLE_DIRS, ensureDataDir } from './paths.js'
import * as boards from './boards.js'
import { resolveReferences } from './references.js'
import * as stylesStore from './styles.js'
import { log, mask } from './log.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const WEB_DIST = path.join(HERE, '..', 'web', 'dist')

/** Żadnego osadzania aplikacji w cudzej ramce — token jechałby razem z nią. */
const FRAME_GUARD = { 'X-Frame-Options': 'DENY', 'Content-Security-Policy': "frame-ancestors 'none'" }

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
      boards: boards.listBoards(),
      spend: { credits30d: creditsLast30Days(), limit: cfg.monthlyLimitCredits },
      styles: stylesStore.listStyles(),
      chipCatalog: {
        groups: stylesStore.CHIP_GROUPS,
        avoid: stylesStore.AVOID_OPTIONS,
        strengths: stylesStore.STRENGTHS,
        maxReferences: stylesStore.MAX_REFERENCES,
      },
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
    const { modelId, values, pinIds, styleId } = await c.req.json().catch(() => ({}))
    const manifest = models.find((m) => m.id === modelId)
    if (!manifest) return c.json({ error: 'Nieznany model.' }, 400)

    const q = queue()
    if (!q) return c.json({ error: 'Najpierw dodaj klucz API.' }, 400)

    const style = styleId ? stylesStore.getStyle(styleId) : null
    if (styleId && !style) return c.json({ error: 'Wybrany styl już nie istnieje.' }, 400)

    // Inspiracje z tablicy jadą do dostawcy dopiero teraz — i tylko te wybrane.
    let refs = null
    const finalValues = { ...(values || {}) }
    const userPrompt = finalValues.prompt
    finalValues.prompt = stylesStore.buildPrompt(userPrompt, style)

    // Domyślne ustawienia stylu uzupełniają tylko to, czego nie podał użytkownik —
    // dzięki temu styl działa tak samo z interfejsu i z własnego skryptu.
    for (const key of ['aspect_ratio', 'resolution']) {
      const fromStyle = style?.defaults?.[key]
      const given = finalValues[key]
      if (fromStyle && (given === undefined || given === null || given === '')) finalValues[key] = fromStyle
    }

    // Referencje stylu jadą z każdą generacją; wybrane ręcznie mają pierwszeństwo.
    const chosenPins = Array.isArray(pinIds) ? pinIds : []
    const styleRefs = style?.referencePinIds || []
    const allPins = [...new Set([...chosenPins, ...styleRefs])]
    let ignoredStyleRefs = 0

    if (manifest.refs?.max > 0 && allPins.length > 0) {
      try {
        refs = await resolveReferences(provider(), allPins, { limit: manifest.refs.max })
        finalValues.input_urls = refs.urls
      } catch (err) {
        return c.json({ error: err.human || err.message }, 400)
      }
    } else if (allPins.length > 0) {
      // Model „z tekstu” nie weźmie obrazów. Wybór użytkownika to błąd, ale
      // referencje doklejone przez styl po prostu pomijamy — styl ma działać
      // z każdym modelem, a nie blokować połowę katalogu.
      if (chosenPins.length > 0) {
        return c.json({ error: `Model „${manifest.title}” nie przyjmuje inspiracji — wybierz model „z inspiracji”.` }, 400)
      }
      ignoredStyleRefs = styleRefs.length
    }

    const check = validateValues(manifest, finalValues)
    if (!check.ok) return c.json({ error: check.errors.join(' ') }, 400)

    const cfg = readConfig()
    const price = priceFor(manifest, finalValues, cfg.calibration)
    if (cfg.monthlyLimitCredits != null && price.credits != null) {
      const spent = creditsLast30Days()
      if (spent + price.credits > cfg.monthlyLimitCredits) {
        return c.json({
          error: `Limit wydatków (${cfg.monthlyLimitCredits} kredytów / 30 dni) zostałby przekroczony: wydano ${spent}, ta generacja to ${price.credits}. Zmień limit w Ustawieniach albo poczekaj.`,
        }, 402)
      }
    }

    const jobs = q.enqueue({
      modelId,
      values: finalValues,
      calibration: cfg.calibration,
      pinIds: refs?.usedPinIds,
      styleId: style?.id || null,
      styleName: style?.name || null,
      userPrompt,
    })
    return c.json({
      jobs,
      price,
      skippedPins: refs?.skippedPinIds || [],
      note: ignoredStyleRefs
        ? `Ten model nie przyjmuje obrazów, więc ${ignoredStyleRefs === 1 ? 'referencja stylu została pominięta' : `${ignoredStyleRefs} referencje stylu zostały pominięte`}. Opis i paleta działają normalnie.`
        : null,
    })
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

  // ── Tablice (inspiracje) ─────────────────────────────────────────────────
  app.get('/api/boards', (c) => c.json({ boards: boards.listBoards() }))

  app.post('/api/boards', async (c) => {
    const { name } = await c.req.json().catch(() => ({}))
    return c.json({ board: boards.createBoard(name || 'Nowa tablica') })
  })

  app.patch('/api/boards/:id', async (c) => {
    const { name } = await c.req.json().catch(() => ({}))
    return withBoardErrors(c, () => ({ board: boards.renameBoard(c.req.param('id'), name) }))
  })

  app.delete('/api/boards/:id', (c) => withBoardErrors(c, () => boards.deleteBoard(c.req.param('id'))))

  /** Dodanie inspiracji: plik z przeglądarki (base64) albo adres w sieci. */
  app.post('/api/boards/:id/pins', async (c) => {
    const body = await c.req.json().catch(() => ({}))
    const boardId = c.req.param('id')
    return withBoardErrors(c, async () => {
      if (body.url) {
        const fetched = await boards.fetchImage(body.url)
        return boards.addPin(boardId, { ...fetched, note: body.note })
      }
      if (body.base64) {
        const clean = String(body.base64).replace(/^data:[^;]+;base64,/, '')
        return boards.addPin(boardId, {
          bytes: Buffer.from(clean, 'base64'),
          mime: body.mime,
          name: body.name,
          note: body.note,
          width: body.width,
          height: body.height,
          sourceUrl: body.sourceUrl,
        })
      }
      if (body.fromFile) {
        // „Przypnij do tablicy” — bierzemy gotowy obraz z biblioteki użytkownika.
        const resolved = path.resolve(body.fromFile)
        const allowed = SERVABLE_DIRS.some((dir) => resolved.startsWith(path.resolve(dir) + path.sep))
        if (!allowed || !fs.existsSync(resolved)) throw new boards.BoardError('Nie znaleziono tego pliku w Twojej bibliotece.')
        return boards.addPin(boardId, { bytes: fs.readFileSync(resolved), name: path.basename(resolved), note: body.note })
      }
      throw new boards.BoardError('Nie podano ani pliku, ani adresu.')
    })
  })

  app.patch('/api/pins/:id', async (c) => {
    const body = await c.req.json().catch(() => ({}))
    return withBoardErrors(c, () => ({ pin: boards.updatePin(c.req.param('id'), body) }))
  })

  app.delete('/api/pins/:id', (c) => withBoardErrors(c, () => boards.deletePin(c.req.param('id'))))

  // ── Style (przepis na wygląd) ────────────────────────────────────────────
  app.get('/api/styles', (c) => c.json({ styles: stylesStore.listStyles() }))

  app.post('/api/styles', async (c) => {
    const body = await c.req.json().catch(() => ({}))
    return withStyleErrors(c, () => ({ style: stylesStore.saveStyle(body) }))
  })

  app.delete('/api/styles/:id', (c) => withStyleErrors(c, () => stylesStore.deleteStyle(c.req.param('id'))))

  app.get('/api/styles/:id/export', (c) => {
    const style = stylesStore.getStyle(c.req.param('id'))
    if (!style) return c.json({ error: 'Nie ma takiego stylu.' }, 404)
    const file = stylesStore.exportStyle(style)
    return c.body(JSON.stringify(file, null, 2), 200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${stylesStore.styleFileName(style.name)}"`,
    })
  })

  app.post('/api/styles/import', async (c) => {
    const body = await c.req.json().catch(() => ({}))
    return withStyleErrors(c, () => ({ style: stylesStore.importStyle(body) }))
  })

  /** „Pokaż pełny prompt” — to samo, co pojedzie do API. */
  app.post('/api/prompt-preview', async (c) => {
    const { prompt, styleId } = await c.req.json().catch(() => ({}))
    const style = styleId ? stylesStore.getStyle(styleId) : null
    return c.json({ prompt: stylesStore.buildPrompt(prompt, style), styleName: style?.name || null })
  })

  // ── Biblioteka ───────────────────────────────────────────────────────────
  app.get('/api/library', (c) => c.json({ items: libraryItems(), dir: LIBRARY_DIR }))

  app.get('/api/file', (c) => {
    const p = c.req.query('path')
    if (!p) return c.json({ error: 'Brak ścieżki.' }, 400)
    const resolved = path.resolve(p)
    // Wolno podawać wyłącznie pliki z biblioteki i z tablic użytkownika.
    const allowed = SERVABLE_DIRS.some((dir) => resolved.startsWith(path.resolve(dir) + path.sep))
    if (!allowed) return c.json({ error: 'Dostęp tylko do plików w bibliotece i na tablicach.' }, 403)
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
    if (fs.existsSync(file) && fs.statSync(file).isFile() && path.extname(file) !== '.html') {
      return c.body(fs.readFileSync(file), 200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' })
    }
    const index = path.join(WEB_DIST, 'index.html')
    if (!fs.existsSync(index)) {
      return c.html('<h1>Brak zbudowanego interfejsu</h1><p>Uruchom <code>npm run build</code> w katalogu projektu.</p>', 200)
    }
    let html = fs.readFileSync(index, 'utf8')
    if (isAddressBarVisit(c)) html = injectToken(html, token)
    return c.html(html, 200, FRAME_GUARD)
  })

  async function withStyleErrors(c, fn) {
    try {
      return c.json(await fn())
    } catch (err) {
      if (err instanceof stylesStore.StyleError) return c.json({ error: err.human }, 400)
      log.error('Błąd stylu:', String(err))
      return c.json({ error: 'Coś poszło nie tak przy stylu.' }, 500)
    }
  }

  /** Błędy tablic mają gotowy komunikat po polsku — nie zamieniamy ich w 500. */
  async function withBoardErrors(c, fn) {
    try {
      return c.json(await fn())
    } catch (err) {
      if (err instanceof boards.BoardError) return c.json({ error: err.human }, 400)
      log.error('Błąd tablicy:', String(err))
      return c.json({ error: 'Coś poszło nie tak przy tablicy.' }, 500)
    }
  }

  app.queueRef = () => state.queue
  app.bootQueue = () => queue()
  return app
}

/**
 * Czy to wejście z paska adresu albo z zakładki (a nie żądanie wywołane przez
 * inną stronę)? Tylko wtedy wolno wstawić token do HTML-a, dzięki czemu
 * `http://127.0.0.1:PORT/` działa bez doklejania `?t=…`.
 *
 * `Sec-Fetch-Site: none` ustawia sama przeglądarka i obca witryna nie może go
 * podrobić — jej żądania mają `cross-site`. Ramki odpadają przez `Sec-Fetch-Dest`.
 */
export function isAddressBarVisit(c) {
  const dest = c.req.header('sec-fetch-dest')
  const site = c.req.header('sec-fetch-site')
  const mode = c.req.header('sec-fetch-mode')
  if (!dest && !site && !mode) return false        // stara przeglądarka albo curl — nie ryzykujemy
  if (dest !== 'document') return false            // iframe, obrazek, fetch: nie
  if (mode && mode !== 'navigate') return false
  return site === 'none' || site === 'same-origin'
}

/** Wstawia token do strony jako zmienną, zanim ruszy aplikacja. */
export function injectToken(html, token) {
  const tag = `<script>window.__OPENSTUDIO_TOKEN__=${JSON.stringify(token)}</script>`
  return html.includes('</head>') ? html.replace('</head>', `${tag}</head>`) : tag + html
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
