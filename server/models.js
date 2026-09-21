import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const MODELS_DIR = path.join(HERE, '..', 'models')

const FIELD_TYPES = new Set(['text', 'textarea', 'select', 'number', 'toggle', 'images'])
const KINDS = new Set(['t2i', 'i2i'])

/**
 * Walidacja manifestu. Ręczna, bez zod — zero dodatkowych zależności
 * i czytelne komunikaty po polsku dla osoby, która dodaje model PR-em.
 */
export function validateManifest(m, source = '?') {
  const errors = []
  const req = (cond, msg) => { if (!cond) errors.push(`${source}: ${msg}`) }

  req(m && typeof m === 'object', 'manifest nie jest obiektem')
  if (!m || typeof m !== 'object') return { ok: false, errors }

  req(m.schemaVersion === 1, 'schemaVersion musi wynosić 1')
  req(typeof m.id === 'string' && m.id.length > 0, 'brak pola id')
  req(typeof m.provider === 'string', 'brak pola provider')
  req(typeof m.model === 'string', 'brak pola model (nazwa modelu u dostawcy)')
  req(typeof m.title === 'string', 'brak pola title')
  req(KINDS.has(m.kind), `kind musi być jednym z: ${[...KINDS].join(', ')}`)
  req(m.refs && typeof m.refs.max === 'number', 'brak refs.max')
  req(m.pricing && m.pricing.values && typeof m.pricing.values === 'object', 'brak pricing.values')
  req(Array.isArray(m.fields) && m.fields.length > 0, 'brak pól formularza (fields)')

  const names = new Set()
  for (const f of m.fields || []) {
    const at = `${source}: pole ${f?.name || '(bez nazwy)'}`
    if (!f || typeof f.name !== 'string') { errors.push(`${at} — brak nazwy`); continue }
    if (names.has(f.name)) errors.push(`${at} — nazwa powtarza się`)
    names.add(f.name)
    if (!FIELD_TYPES.has(f.type)) errors.push(`${at} — nieznany typ "${f.type}"`)
    if (f.type === 'select') {
      if (!Array.isArray(f.options) || f.options.length === 0) errors.push(`${at} — select bez opcji`)
      else if (f.default !== undefined && !f.options.some((o) => o.value === f.default)) {
        errors.push(`${at} — domyślna wartość spoza listy opcji`)
      }
    }
  }
  if (m.kind === 'i2i') {
    const hasImages = (m.fields || []).some((f) => f.type === 'images')
    req(hasImages, 'model i2i musi mieć pole typu images')
    req(m.refs.max > 0, 'model i2i musi mieć refs.max > 0')
  }
  return { ok: errors.length === 0, errors }
}

/** Wczytuje wszystkie manifesty z katalogu. Zły plik = twardy błąd (łapie to CI). */
export function loadModels(dir = MODELS_DIR) {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()
  const models = []
  const problems = []
  for (const file of files) {
    let parsed
    try {
      parsed = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))
    } catch (err) {
      problems.push(`${file}: nie jest poprawnym JSON-em (${err.message})`)
      continue
    }
    const { ok, errors } = validateManifest(parsed, file)
    if (!ok) problems.push(...errors)
    else models.push(parsed)
  }
  return { models, problems }
}

/**
 * Pole, do którego wpisujemy adresy wysłanych referencji. Nazwa pola jest
 * jednocześnie nazwą parametru u dostawcy (patrz `buildInput`), a ta różni się
 * model po modelu: `input_urls` w GPT Image, `image_input` w Nano Banana 2,
 * `image_urls` w Grok Imagine. Dlatego pytamy o nią manifest, a nie zgadujemy.
 */
export function imagesFieldName(manifest) {
  return manifest?.fields?.find((f) => f.type === 'images')?.name ?? null
}

/** Domyślne wartości formularza prosto z manifestu. */
export function defaultValues(manifest) {
  const out = {}
  for (const f of manifest.fields) {
    if (f.default !== undefined) out[f.name] = f.default
    else if (f.type === 'images') out[f.name] = []
    else if (f.type === 'toggle') out[f.name] = false
    else out[f.name] = ''
  }
  return out
}

/** Sprawdza wartości z UI zanim wyślemy cokolwiek (i zanim zapłacimy). */
export function validateValues(manifest, values = {}) {
  const errors = []
  for (const f of manifest.fields) {
    const v = values[f.name]
    const empty = v === undefined || v === '' || (Array.isArray(v) && v.length === 0)
    if (f.required && empty) { errors.push(`Uzupełnij: ${f.label}`); continue }
    if (empty) continue
    if (f.type === 'select' && !f.options.some((o) => o.value === v)) errors.push(`${f.label}: nieznana wartość „${v}”`)
    if (f.type === 'number') {
      const n = Number(v)
      if (!Number.isFinite(n)) errors.push(`${f.label}: wpisz liczbę`)
      else if (f.min !== undefined && n < f.min) errors.push(`${f.label}: minimum to ${f.min}`)
      else if (f.max !== undefined && n > f.max) errors.push(`${f.label}: maksimum to ${f.max}`)
    }
    if (f.type === 'images') {
      if (!Array.isArray(v)) errors.push(`${f.label}: oczekiwano listy obrazów`)
      else if (f.maxItems && v.length > f.maxItems) errors.push(`${f.label}: ten model przyjmie najwyżej ${f.maxItems} obrazów, wybrano ${v.length}`)
    }
    if (f.maxLength && typeof v === 'string' && v.length > f.maxLength) errors.push(`${f.label}: najwyżej ${f.maxLength} znaków`)
  }
  // Ograniczenie Kie: część proporcji istnieje tylko w 1K.
  const ar = manifest.fields.find((f) => f.name === 'aspect_ratio')
  const only1K = ar?.options?.find((o) => o.value === values.aspect_ratio)?.only1K
  if (only1K && values.resolution && values.resolution !== '1K') {
    errors.push(`Format ${values.aspect_ratio} działa tylko w jakości 1K.`)
  }
  return { ok: errors.length === 0, errors }
}

/** Ile zadań powstanie z jednego kliknięcia (pole count jest po naszej stronie). */
export function countOf(manifest, values = {}) {
  const f = manifest.fields.find((x) => x.name === 'count' && x.clientOnly)
  if (!f) return 1
  const n = Number(values.count ?? f.default ?? 1)
  return Number.isFinite(n) ? Math.min(Math.max(1, Math.round(n)), f.max ?? 8) : 1
}

/**
 * Cena w kredytach przed kliknięciem. Kie nie ma endpointu estimate, więc
 * bierzemy ją z manifestu i kalibrujemy realnym `creditsConsumed`.
 * @returns {{credits:number, perImage:number, count:number, estimated:boolean}}
 */
export function priceFor(manifest, values = {}, calibration = {}) {
  const key = calibrationKey(manifest, values)
  const cal = calibration[key]
  const res = values.resolution ?? manifest.fields.find((f) => f.name === 'resolution')?.default
  // Model bez wyboru jakości (np. Grok Imagine) ma jedną cenę pod kluczem `flat`.
  const fromManifest = res == null ? manifest.pricing?.values?.flat : manifest.pricing?.values?.[res]
  const perImage = cal?.credits ?? fromManifest ?? null
  const count = countOf(manifest, values)
  const estimatedFor = res == null ? manifest.pricing?.estimated?.flat : manifest.pricing?.estimated?.[res]
  const estimated = cal ? false : (estimatedFor ?? perImage == null)
  return {
    credits: perImage == null ? null : perImage * count,
    perImage,
    count,
    estimated,
    source: cal ? 'twoje-generacje' : (perImage == null ? 'brak' : 'cennik'),
  }
}

export function calibrationKey(manifest, values = {}) {
  const res = values.resolution ?? manifest.fields.find((f) => f.name === 'resolution')?.default ?? '-'
  return `${manifest.id}|${res}`
}

/** Buduje `input` dla Kie: tylko pola modelu, bez naszych pól pomocniczych. */
export function buildInput(manifest, values = {}) {
  const input = {}
  for (const f of manifest.fields) {
    if (f.clientOnly) continue
    const v = values[f.name]
    if (v === undefined || v === '' || (Array.isArray(v) && v.length === 0)) continue
    input[f.name] = f.type === 'number' ? Number(v) : v
  }
  return input
}
