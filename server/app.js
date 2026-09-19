import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
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
import { composePrompt } from './prompt.js'
import { REFERENCE_ROLES, normalizeReferences } from './reference-roles.js'
import * as feedback from './feedback.js'
import { journalFor, applyProposal, dismissProposal, forgetLearned } from './style-journal.js'
import { OVERLAY_POSITIONS, OVERLAY_DEFAULTS, normalizeOverlay } from './overlay.js'
import { roleOf } from './reference-roles.js'
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
      referenceRoles: REFERENCE_ROLES,
      overlay: { positions: OVERLAY_POSITIONS, defaults: OVERLAY_DEFAULTS },
      feedbackTags: { issues: feedback.ISSUE_TAGS, praise: feedback.PRAISE_TAGS },
      feedback: feedback.listFeedback().slice(0, 500),
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

  /**
   * Wspólna droga dla „generuj” i „wyślij ponownie”: składa prompt, dokłada
   * referencje stylu, wysyła obrazy do dostawcy i pilnuje limitu wydatków.
   */
  async function startGeneration({ modelId, values, references, styleId, variantOf = null, correction = null }) {
    const manifest = models.find((m) => m.id === modelId)
    if (!manifest) return { error: 'Nieznany model.', status: 400 }

    const q = queue()
    if (!q) return { error: 'Najpierw dodaj klucz API.', status: 400 }

    const style = styleId ? stylesStore.getStyle(styleId) : null
    if (styleId && !style) return { error: 'Wybrany styl już nie istnieje.', status: 400 }

    const finalValues = { ...(values || {}) }
    delete finalValues.input_urls
    const userPrompt = finalValues.prompt

    // Domyślne ustawienia stylu uzupełniają tylko to, czego nie podał użytkownik —
    // dzięki temu styl działa tak samo z interfejsu i z własnego skryptu.
    for (const key of ['aspect_ratio', 'resolution']) {
      const fromStyle = style?.defaults?.[key]
      const given = finalValues[key]
      if (fromStyle && (given === undefined || given === null || given === '')) finalValues[key] = fromStyle
    }

    // Referencje: najpierw te wybrane przez użytkownika (z rolami), potem stałe
    // referencje stylu jako inspiracja. Stylowe są opcjonalne — skasowany pin
    // ich nie blokuje.
    const all = normalizeReferences(references)
    // Nakładki nie idą do modelu: zostają na dysku i wchodzą po pobraniu.
    const overlays = []
    for (const r of all.filter((r) => roleOf(r.role)?.overlay)) {
      const found = boards.getPin(r.pinId)
      if (!found) return { error: 'Plik logo do nakładki zniknął z tablicy.', status: 400 }
      overlays.push({ pinId: r.pinId, file: found.pin.file, ...normalizeOverlay(r.overlay || {}) })
    }
    const chosen = all.filter((r) => !roleOf(r.role)?.overlay)
    const chosenIds = new Set(chosen.map((r) => r.pinId))
    const styleRefs = (style?.referencePinIds || []).filter((id) => !chosenIds.has(id))
      .map((pinId) => ({ pinId, role: 'inspiracja', note: '', fromStyle: true }))
    const wanted = [...chosen, ...styleRefs]
    let usedRefs = []
    let resolved = null
    let ignoredStyleRefs = 0

    if (manifest.refs?.max > 0 && wanted.length > 0) {
      try {
        resolved = await resolveReferences(provider(), wanted.map((r) => r.pinId), {
          limit: manifest.refs.max,
          optional: new Set(styleRefs.map((r) => r.pinId)),
        })
        usedRefs = resolved.usedPinIds.map((id) => wanted.find((r) => r.pinId === id))
        finalValues.input_urls = resolved.urls
      } catch (err) {
        return { error: err.human || err.message, status: 400 }
      }
    } else if (wanted.length > 0) {
      // Model „z tekstu” nie weźmie obrazów. Wybór użytkownika to błąd, ale
      // referencje doklejone przez styl po prostu pomijamy — styl ma działać
      // z każdym modelem, a nie blokować połowę katalogu.
      if (chosen.length > 0) {
        return { error: `Model „${manifest.title}” nie przyjmuje obrazów — wybierz model „z inspiracji”.`, status: 400 }
      }
      ignoredStyleRefs = styleRefs.length
    }

    // Prompt składa się DOKŁADNIE tak samo jak w „Pokaż pełny prompt”.
    finalValues.prompt = composePrompt({ userPrompt, references: usedRefs, overlays, style })

    const check = validateValues(manifest, finalValues)
    if (!check.ok) return { error: check.errors.join(' '), status: 400 }

    const cfg = readConfig()
    const price = priceFor(manifest, finalValues, cfg.calibration)
    if (cfg.monthlyLimitCredits != null && price.credits != null) {
      const spent = creditsLast30Days()
      if (spent + price.credits > cfg.monthlyLimitCredits) {
        return {
          status: 402,
          error: `Limit wydatków (${cfg.monthlyLimitCredits} kredytów / 30 dni) zostałby przekroczony: wydano ${spent}, ta generacja to ${price.credits}. Zmień limit w Ustawieniach albo poczekaj.`,
        }
      }
    }

    const jobs = q.enqueue({
      modelId,
      values: finalValues,
      calibration: cfg.calibration,
      references: usedRefs.map((r) => ({ pinId: r.pinId, role: r.role, note: r.note, fromStyle: Boolean(r.fromStyle) })),
      overlays,
      styleId: style?.id || null,
      styleName: style?.name || null,
      userPrompt,
      variantOf,
      correction,
    })

    const notes = []
    if (ignoredStyleRefs) {
      notes.push(`Ten model nie przyjmuje obrazów, więc ${ignoredStyleRefs === 1 ? 'referencja stylu została pominięta' : `${ignoredStyleRefs} referencje stylu zostały pominięte`}. Opis i paleta działają normalnie.`)
    }
    if (resolved?.missingPinIds?.length) {
      notes.push(`${resolved.missingPinIds.length === 1 ? 'Jedna referencja stylu zniknęła' : `${resolved.missingPinIds.length} referencje stylu zniknęły`} z tablicy i zostały pominięte — popraw styl, jeśli to nie było celowe.`)
    }
    if (resolved?.skippedPinIds?.length) {
      notes.push(`Model przyjmuje najwyżej ${manifest.refs.max} obrazów — ${resolved.skippedPinIds.length} pominięto.`)
    }

    return { jobs, price, skippedPins: resolved?.skippedPinIds || [], note: notes.join(' ') || null }
  }

  app.post('/api/generate', async (c) => {
    const { modelId, values, pinIds, references, styleId } = await c.req.json().catch(() => ({}))
    // `pinIds` to starszy kształt: sama lista, wszystko jako inspiracja.
    const result = await startGeneration({ modelId, values, references: references ?? pinIds, styleId })
    if (result.error) return c.json({ error: result.error }, result.status)
    return c.json(result)
  })

  /** Obraz wrzucony prosto w generatorze (zdjęcie, logo, produkt) ląduje na tablicy „Moje pliki”. */
  app.post('/api/uploads', async (c) => {
    const body = await c.req.json().catch(() => ({}))
    return withBoardErrors(c, async () => {
      const board = boards.uploadsBoard()
      if (body.url) {
        const fetched = await boards.fetchImage(body.url)
        return boards.addPin(board.id, { ...fetched, note: body.note })
      }
      if (!body.base64) throw new boards.BoardError('Nie podano pliku.')
      const clean = String(body.base64).replace(/^data:[^;]+;base64,/, '')
      return boards.addPin(board.id, {
        bytes: Buffer.from(clean, 'base64'),
        mime: body.mime,
        name: body.name,
        width: body.width,
        height: body.height,
      })
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
    // Linki do referencji u dostawcy mogły już wygasnąć, więc nie kopiujemy
    // starego `input` — przechodzimy całą drogę od nowa, z tymi samymi obrazami.
    const result = await startGeneration({
      modelId: job.modelId,
      values: { ...job.values, prompt: job.userPrompt ?? job.values?.prompt, count: 1 },
      references: [
        ...(job.references || []).filter((r) => !r.fromStyle),
        ...(job.overlays || []).map((o) => ({ pinId: o.pinId, role: 'logo-nakladka', overlay: o })),
      ],
      styleId: job.styleId || undefined,
    })
    if (result.error) return c.json({ error: result.error }, result.status)
    return c.json(result)
  })

  // ── Feedback: „dobre” / „co poprawić?” / „ponów z poprawką” ─────────────
  app.post('/api/jobs/:id/feedback', async (c) => {
    const job = getJob(c.req.param('id'))
    if (!job) return c.json({ error: 'Nie ma takiego zadania.' }, 404)
    const body = await c.req.json().catch(() => ({}))
    try {
      const entry = feedback.saveFeedback({ jobId: job.id, ...body }, { styleId: job.styleId, modelId: job.modelId, references: job.references || [] })
      annotateSidecar(job, { feedback: entry })
      return c.json({ feedback: entry })
    } catch (err) {
      if (err instanceof feedback.FeedbackError) return c.json({ error: err.human }, 400)
      throw err
    }
  })

  /**
   * Nowa wersja z poprawką: poprzedni wynik jedzie jako „obraz do edycji”,
   * a uwagi jako dopisek do promptu. Reszta (styl, format, referencje) bez zmian.
   */
  app.post('/api/jobs/:id/variant', async (c) => {
    const job = getJob(c.req.param('id'))
    if (!job) return c.json({ error: 'Nie ma takiego zadania.' }, 404)
    if (!job.files?.[0] || !fs.existsSync(job.files[0])) return c.json({ error: 'Nie ma pliku poprzedniej wersji — nie ma czego poprawiać.' }, 400)
    const body = await c.req.json().catch(() => ({}))

    let entry
    try {
      entry = feedback.saveFeedback({ jobId: job.id, verdict: 'bad', tags: body.tags, text: body.text }, { styleId: job.styleId, modelId: job.modelId, references: job.references || [] })
    } catch (err) {
      if (err instanceof feedback.FeedbackError) return c.json({ error: err.human }, 400)
      throw err
    }
    const correction = feedback.correctionText(entry)
    if (!correction) return c.json({ error: 'Zaznacz, co poprawić, albo napisz to własnymi słowami.' }, 400)

    // Poprzedni wynik staje się pinem (tablica „Moje pliki”), żeby móc być referencją.
    const board = boards.uploadsBoard()
    const baseFile = job.rawFiles?.[0] && fs.existsSync(job.rawFiles[0]) ? job.rawFiles[0] : job.files[0]
    const { pin } = boards.addPin(board.id, { bytes: fs.readFileSync(baseFile), name: `wersja-${job.id.slice(0, 8)}.png`, note: 'poprzednia wersja do poprawki' })

    const model = models.find((m) => m.id === job.modelId)
    const targetModel = model?.refs?.max > 0 ? model : editingCounterpart(model)
    if (!targetModel) return c.json({ error: 'Nie ma modelu, który przyjmuje obrazy.' }, 400)

    const previousRefs = (job.references || []).filter((r) => !r.fromStyle && r.pinId !== pin.id)
    const previousOverlays = (job.overlays || []).map((o) => ({ pinId: o.pinId, role: 'logo-nakladka', overlay: o }))
    const result = await startGeneration({
      modelId: targetModel.id,
      values: { ...job.values, prompt: `${job.userPrompt ?? job.values?.prompt}\n\n${correction}`, count: 1 },
      references: [{ pinId: pin.id, role: 'edycja', note: '' }, ...previousRefs, ...previousOverlays],
      styleId: job.styleId || undefined,
      variantOf: job.id,
      correction,
    })
    if (result.error) return c.json({ error: result.error }, result.status)
    feedback.saveFeedback(entry, { ...entry, variantJobId: result.jobs[0].id })
    return c.json(result)
  })

  /** Model „z tekstu” → jego odpowiednik „z inspiracji” (ten sam wariant, np. Flare). */
  function editingCounterpart(model) {
    if (!model) return models.find((m) => m.kind === 'i2i' && m.recommended) || models.find((m) => m.kind === 'i2i')
    const base = model.id.replace(/-text-to-image$/, '')
    return models.find((m) => m.kind === 'i2i' && m.id.startsWith(base))
      || models.find((m) => m.kind === 'i2i' && m.recommended)
      || models.find((m) => m.kind === 'i2i')
  }

  /** Dopisuje informację do pliku JSON leżącego obok obrazu w bibliotece. */
  function annotateSidecar(job, patch) {
    for (const file of job.files || []) {
      const sidecar = file.replace(/\.[a-z0-9]+$/i, '.json')
      try {
        const data = JSON.parse(fs.readFileSync(sidecar, 'utf8'))
        fs.writeFileSync(sidecar, JSON.stringify({ ...data, ...patch }, null, 2))
      } catch { /* brak sidecara to nie błąd */ }
    }
  }

  /** Kasuje wygenerowany plik z dysku — świadomie, na prośbę użytkownika. */
  app.delete('/api/jobs/:id/file', (c) => {
    const job = getJob(c.req.param('id'))
    if (!job) return c.json({ error: 'Nie ma takiego zadania.' }, 404)
    for (const file of job.files || []) {
      const resolved = path.resolve(file)
      if (!resolved.startsWith(path.resolve(LIBRARY_DIR) + path.sep)) continue
      fs.rmSync(resolved, { force: true })
      fs.rmSync(resolved.replace(/\.[a-z0-9]+$/i, '.json'), { force: true })
      fs.rmSync(resolved.replace(/\.([a-z0-9]+)$/i, '-raw.$1'), { force: true })
    }
    if (!feedback.feedbackFor(job.id)) {
      feedback.saveFeedback({ jobId: job.id, verdict: 'bad', tags: [], text: '' }, { implicit: 'deleted', styleId: job.styleId, modelId: job.modelId })
    }
    upsertJob({ ...job, files: [], status: 'hidden', deletedAt: new Date().toISOString() })
    return c.json({ ok: true })
  })

  /** Otwiera folder z plikami w Finderze / Eksploratorze. */
  app.post('/api/open-folder', async (c) => {
    const { which } = await c.req.json().catch(() => ({}))
    const target = which === 'library' ? LIBRARY_DIR : DATA_DIR
    try {
      const { default: open } = await import('open')
      await open(target)
      return c.json({ ok: true, path: target })
    } catch (err) {
      return c.json({ error: `Nie udało się otworzyć folderu. Ścieżka: ${target}` }, 500)
    }
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
        const added = boards.addPin(boardId, { bytes: fs.readFileSync(resolved), name: path.basename(resolved), note: body.note })
        // Przypięcie wyniku do tablicy to najuczciwszy „podoba mi się” — zapisujemy, jeśli nie ma jawnej oceny.
        const job = readJobs().find((j) => j.files?.includes(resolved))
        if (job && !feedback.feedbackFor(job.id)) {
          feedback.saveFeedback({ jobId: job.id, verdict: 'good', tags: [], text: '' }, { implicit: 'pinned', styleId: job.styleId, modelId: job.modelId })
        }
        return added
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

  // ── Dziennik stylu ───────────────────────────────────────────────────────
  app.get('/api/styles/:id/journal', (c) => {
    const style = stylesStore.getStyle(c.req.param('id'))
    if (!style) return c.json({ error: 'Nie ma takiego stylu.' }, 404)
    const journal = journalFor(style, feedback.listFeedback(), readJobs())
    journal.recentGood = journal.recentGood.map((g) => ({ ...g, alreadyReference: isReferenceOf(style, g.file) }))
    return c.json({ journal })
  })

  app.post('/api/styles/:id/proposals/:tag/:action', (c) => {
    const style = stylesStore.getStyle(c.req.param('id'))
    if (!style) return c.json({ error: 'Nie ma takiego stylu.' }, 404)
    const tag = c.req.param('tag')
    const action = c.req.param('action')
    try {
      const next = action === 'apply' ? applyProposal(style, tag)
        : action === 'dismiss' ? dismissProposal(style, tag)
        : action === 'forget' ? forgetLearned(style, tag)
        : null
      if (!next) return c.json({ error: 'Nieznana akcja.' }, 400)
      const saved = stylesStore.saveStyle(next)
      return c.json({ style: saved, journal: journalFor(saved, feedback.listFeedback(), readJobs()) })
    } catch (err) {
      return c.json({ error: err.human || err.message }, 400)
    }
  })

  /** Dobry wynik staje się stałą referencją stylu — z tablicy „Moje pliki”. */
  app.post('/api/styles/:id/references', async (c) => {
    const style = stylesStore.getStyle(c.req.param('id'))
    if (!style) return c.json({ error: 'Nie ma takiego stylu.' }, 404)
    const { jobId } = await c.req.json().catch(() => ({}))
    const job = getJob(jobId)
    const file = job?.rawFiles?.[0] && fs.existsSync(job.rawFiles[0]) ? job.rawFiles[0] : job?.files?.[0]
    if (!file || !fs.existsSync(file)) return c.json({ error: 'Nie ma pliku tego wyniku.' }, 400)
    if ((style.referencePinIds || []).length >= stylesStore.MAX_REFERENCES) {
      return c.json({ error: `Styl ma już ${stylesStore.MAX_REFERENCES} referencji — usuń jedną w edycji stylu.` }, 400)
    }
    return withBoardErrors(c, () => {
      const board = boards.uploadsBoard()
      const { pin } = boards.addPin(board.id, { bytes: fs.readFileSync(file), name: `wzorzec-${job.id.slice(0, 8)}.png`, note: `wzorzec stylu „${style.name}”` })
      const ids = [...new Set([...(style.referencePinIds || []), pin.id])]
      const saved = stylesStore.saveStyle({ ...style, referencePinIds: ids })
      return { style: saved, pin }
    })
  })

  function isReferenceOf(style, file) {
    try {
      const hash = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
      return (style.referencePinIds || []).some((id) => boards.getPin(id)?.pin.hash === hash)
    } catch { return false }
  }

  /** „Pokaż pełny prompt” — to samo, co pojedzie do API. */
  app.post('/api/prompt-preview', async (c) => {
    const { prompt, styleId, references, modelId } = await c.req.json().catch(() => ({}))
    const style = styleId ? stylesStore.getStyle(styleId) : null
    const manifest = models.find((m) => m.id === modelId)
    const acceptsImages = manifest ? manifest.refs?.max > 0 : true
    const allRefs = normalizeReferences(references)
    const overlays = allRefs.filter((r) => roleOf(r.role)?.overlay).map((r) => normalizeOverlay(r.overlay || {}))
    const chosen = allRefs.filter((r) => !roleOf(r.role)?.overlay)
    const chosenIds = new Set(chosen.map((r) => r.pinId))
    const styleRefs = acceptsImages
      ? (style?.referencePinIds || []).filter((id) => !chosenIds.has(id) && boards.getPin(id)).map((pinId) => ({ pinId, role: 'inspiracja', note: '' }))
      : []
    const all = acceptsImages ? [...chosen, ...styleRefs] : []
    const limit = manifest?.refs?.max || all.length
    return c.json({
      prompt: composePrompt({ userPrompt: prompt, references: all.slice(0, limit), overlays, style }),
      styleName: style?.name || null,
      referenceCount: Math.min(all.length, limit),
    })
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
    return c.body(body, 200, { 'Content-Type': MIME[path.extname(resolved).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'private, max-age=86400' })
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
    return c.html(html, 200, { ...FRAME_GUARD, 'Cache-Control': 'no-cache' })
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
