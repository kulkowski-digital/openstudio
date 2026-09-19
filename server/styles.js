import crypto from 'node:crypto'
import { readStyles, writeStyles } from './store.js'
import { CHIP_GROUPS, AVOID_OPTIONS, STRENGTHS, chipPrompt, avoidPrompt } from './style-chips.js'

export const STYLE_SCHEMA_VERSION = 1
const MAX_REFERENCES = 8

export class StyleError extends Error {
  constructor(human) {
    super(human)
    this.human = human
  }
}

const HEX = /^#[0-9a-fA-F]{6}$/

/** Styl to „przepis na wygląd”: paleta, chipy, czego unikać i referencje. */
export function emptyStyle(name = 'Mój styl') {
  return {
    schemaVersion: STYLE_SCHEMA_VERSION,
    id: crypto.randomUUID(),
    name,
    createdAt: new Date().toISOString(),
    palette: [],
    chips: {},
    avoid: [],
    extra: '',
    referencePinIds: [],
    strength: 'wyrazny',
    defaults: { modelId: null, aspect_ratio: null, resolution: null },
  }
}

export function listStyles() {
  return readStyles()
}

export function getStyle(id) {
  return readStyles().find((s) => s.id === id) || null
}

export function saveStyle(input) {
  const style = normalize(input)
  const styles = readStyles()
  const i = styles.findIndex((s) => s.id === style.id)
  if (i === -1) styles.unshift(style)
  else styles[i] = { ...styles[i], ...style }
  writeStyles(styles)
  return style
}

export function deleteStyle(id) {
  const styles = readStyles()
  if (!styles.some((s) => s.id === id)) throw new StyleError('Nie ma takiego stylu.')
  writeStyles(styles.filter((s) => s.id !== id))
  return { ok: true }
}

/** Sprawdza i porządkuje styl — używane przy zapisie i przy imporcie cudzego pliku. */
export function normalize(input, { keepId = true } = {}) {
  if (!input || typeof input !== 'object') throw new StyleError('To nie jest plik stylu.')
  if (input.schemaVersion && Number(input.schemaVersion) > STYLE_SCHEMA_VERSION) {
    throw new StyleError('Ten styl pochodzi z nowszej wersji aplikacji. Zaktualizuj OpenStudio.')
  }

  const name = String(input.name || '').trim()
  if (!name) throw new StyleError('Styl musi mieć nazwę.')

  const palette = (Array.isArray(input.palette) ? input.palette : [])
    .map((c) => String(c).trim())
    .filter((c) => HEX.test(c))
    .slice(0, 8)

  const chips = {}
  for (const group of CHIP_GROUPS) {
    const value = input.chips?.[group.key]
    if (!value) continue
    if (!group.options.some((o) => o.value === value)) {
      throw new StyleError(`Nieznana wartość „${value}” w grupie „${group.label}”.`)
    }
    chips[group.key] = value
  }

  const avoid = (Array.isArray(input.avoid) ? input.avoid : [])
    .filter((v) => AVOID_OPTIONS.some((o) => o.value === v))

  const strength = STRENGTHS.some((s) => s.value === input.strength) ? input.strength : 'wyrazny'

  return {
    schemaVersion: STYLE_SCHEMA_VERSION,
    id: keepId && input.id ? String(input.id) : crypto.randomUUID(),
    name: name.slice(0, 60),
    createdAt: input.createdAt || new Date().toISOString(),
    palette,
    chips,
    avoid,
    extra: String(input.extra || '').slice(0, 400),
    // Referencje są lokalne, więc cudzy plik ich nie przywlecze.
    referencePinIds: (Array.isArray(input.referencePinIds) ? input.referencePinIds : []).slice(0, MAX_REFERENCES),
    strength,
    defaults: {
      modelId: input.defaults?.modelId || null,
      aspect_ratio: input.defaults?.aspect_ratio || null,
      resolution: input.defaults?.resolution || null,
    },
  }
}

/** Plik do wysłania komuś: bez referencji, bo tamten komputer ich nie ma. */
export function exportStyle(style) {
  const { id, referencePinIds, ...rest } = normalize(style)
  return { ...rest, exportedAt: new Date().toISOString(), app: 'openstudio' }
}

export function importStyle(payload) {
  const style = normalize({ ...payload, referencePinIds: [] }, { keepId: false })
  return saveStyle(style)
}

/**
 * Składa finalny prompt. To jest dokładnie to, co widzi użytkownik pod
 * „Pokaż pełny prompt” i co leci do API — bez niespodzianek.
 */
export function buildPrompt(userPrompt, style) {
  const base = String(userPrompt || '').trim()
  if (!style) return base

  const lead = STRENGTHS.find((s) => s.value === style.strength)?.lead || 'Zachowaj ten styl:'
  const descriptors = CHIP_GROUPS
    .map((g) => chipPrompt(g.key, style.chips?.[g.key]))
    .filter(Boolean)

  const parts = []
  if (descriptors.length) parts.push(`${lead} ${descriptors.join(', ')}.`)
  if (style.extra?.trim()) {
    const extra = style.extra.trim().replace(/\s+/g, ' ')
    parts.push(/[.!?]$/.test(extra) ? extra : `${extra}.`)
  }
  if (style.palette?.length) {
    parts.push(`Paleta kolorów: ${style.palette.join(', ')} (kolory orientacyjne, trzymaj się ich nastroju).`)
  }
  const avoid = (style.avoid || []).map(avoidPrompt).filter(Boolean)
  if (avoid.length) parts.push(`Unikaj: ${avoid.join(', ')}.`)

  return [base, parts.join(' ')].filter(Boolean).join('\n\n')
}

/**
 * Nazwa pliku z polskiej nazwy stylu. „ł” nie rozkłada się przez NFD, więc
 * podmieniamy je ręcznie — inaczej „Do wysłania” robi się „do-wys-ania”.
 */
export function styleFileName(name) {
  const slug = String(name || '')
    .replace(/ł/g, 'l').replace(/Ł/g, 'L')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return `${slug || 'styl'}.styl.json`
}

export { CHIP_GROUPS, AVOID_OPTIONS, STRENGTHS, MAX_REFERENCES }
