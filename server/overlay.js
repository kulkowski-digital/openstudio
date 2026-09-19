import fs from 'node:fs'
import path from 'node:path'
import { PNG } from 'pngjs'
import jpeg from 'jpeg-js'

/**
 * Nakładanie logo lokalnie, po pobraniu wyniku. Model nie widzi pliku logo —
 * dostaje tylko prośbę o wolne miejsce. Dzięki temu logo jest zawsze wierne
 * co do piksela, a jego kształty nie „rozlewają się” po tle.
 * Czysty JavaScript (pngjs + jpeg-js), bez zależności natywnych.
 */
export const OVERLAY_POSITIONS = [
  { value: 'lewy-dol', label: 'lewy dolny róg', prompt: 'w lewym dolnym rogu' },
  { value: 'prawy-dol', label: 'prawy dolny róg', prompt: 'w prawym dolnym rogu' },
  { value: 'lewy-gora', label: 'lewy górny róg', prompt: 'w lewym górnym rogu' },
  { value: 'prawy-gora', label: 'prawy górny róg', prompt: 'w prawym górnym rogu' },
  { value: 'srodek-dol', label: 'na dole, pośrodku', prompt: 'na dole pośrodku' },
]

export const OVERLAY_DEFAULTS = { position: 'lewy-dol', widthPct: 18, marginPct: 4 }

export class OverlayError extends Error {
  constructor(human) {
    super(human)
    this.human = human
  }
}

export function normalizeOverlay(input = {}) {
  const position = OVERLAY_POSITIONS.some((p) => p.value === input.position) ? input.position : OVERLAY_DEFAULTS.position
  // Zero to legalna wartość marginesu — `||` zamieniłoby je w domyślne 4%.
  const num = (v, fallback) => (Number.isFinite(Number(v)) && v !== '' && v !== null && v !== undefined ? Number(v) : fallback)
  const widthPct = clamp(num(input.widthPct, OVERLAY_DEFAULTS.widthPct), 5, 60)
  const marginPct = clamp(num(input.marginPct, OVERLAY_DEFAULTS.marginPct), 0, 20)
  return { position, widthPct, marginPct }
}

/** Zdanie do promptu: model ma zostawić czyste miejsce, nie rysować logo. */
export function describeOverlays(overlays = []) {
  if (!overlays.length) return ''
  const spots = [...new Set(overlays.map((o) => OVERLAY_POSITIONS.find((p) => p.value === o.position)?.prompt).filter(Boolean))]
  return `Zostaw wolne, czyste miejsce ${spots.join(' oraz ')} (około ${Math.max(...overlays.map((o) => o.widthPct))}% szerokości) — logo zostanie nałożone później; nie rysuj tam żadnego logo, napisu ani ozdobnika.`
}

/** Wczytuje PNG albo JPEG do bufora RGBA. */
export function decodeImage(file) {
  const buf = fs.readFileSync(file)
  if (buf[0] === 0x89 && buf[1] === 0x50) {
    const png = PNG.sync.read(buf)
    return { width: png.width, height: png.height, data: png.data }
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    const img = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true })
    return { width: img.width, height: img.height, data: Buffer.from(img.data) }
  }
  throw new OverlayError(`Nakładka „${path.basename(file)}” musi być PNG albo JPG (WEBP i GIF nie są tu obsługiwane).`)
}

export function encodePng({ width, height, data }) {
  const png = new PNG({ width, height })
  png.data = Buffer.from(data)
  return PNG.sync.write(png)
}

/** Skalowanie dwuliniowe RGBA — wystarczające dla logo, bez zewnętrznych bibliotek. */
export function resize(img, width, height) {
  const out = Buffer.alloc(width * height * 4)
  const sx = img.width / width
  const sy = img.height / height
  for (let y = 0; y < height; y++) {
    const fy = Math.min(img.height - 1, (y + 0.5) * sy - 0.5)
    const y0 = Math.max(0, Math.floor(fy))
    const y1 = Math.min(img.height - 1, y0 + 1)
    const wy = fy - y0
    for (let x = 0; x < width; x++) {
      const fx = Math.min(img.width - 1, (x + 0.5) * sx - 0.5)
      const x0 = Math.max(0, Math.floor(fx))
      const x1 = Math.min(img.width - 1, x0 + 1)
      const wx = fx - x0
      const o = (y * width + x) * 4
      for (let c = 0; c < 4; c++) {
        const p00 = img.data[(y0 * img.width + x0) * 4 + c]
        const p10 = img.data[(y0 * img.width + x1) * 4 + c]
        const p01 = img.data[(y1 * img.width + x0) * 4 + c]
        const p11 = img.data[(y1 * img.width + x1) * 4 + c]
        out[o + c] = Math.round((p00 * (1 - wx) + p10 * wx) * (1 - wy) + (p01 * (1 - wx) + p11 * wx) * wy)
      }
    }
  }
  return { width, height, data: out }
}

/** Nakłada `logo` na `base` (w miejscu) z uwzględnieniem przezroczystości logo. */
export function composite(base, logo, overlay) {
  const { position, widthPct, marginPct } = normalizeOverlay(overlay)
  const targetW = Math.max(1, Math.round((base.width * widthPct) / 100))
  const targetH = Math.max(1, Math.round((targetW * logo.height) / logo.width))
  const scaled = logo.width === targetW && logo.height === targetH ? logo : resize(logo, targetW, targetH)
  const margin = Math.round((base.width * marginPct) / 100)

  let x0
  let y0
  if (position.startsWith('lewy')) x0 = margin
  else if (position.startsWith('prawy')) x0 = base.width - targetW - margin
  else x0 = Math.round((base.width - targetW) / 2)
  y0 = position.endsWith('gora') ? margin : base.height - targetH - margin

  for (let y = 0; y < targetH; y++) {
    const by = y0 + y
    if (by < 0 || by >= base.height) continue
    for (let x = 0; x < targetW; x++) {
      const bx = x0 + x
      if (bx < 0 || bx >= base.width) continue
      const s = (y * targetW + x) * 4
      const d = (by * base.width + bx) * 4
      const a = scaled.data[s + 3] / 255
      if (a === 0) continue
      for (let c = 0; c < 3; c++) base.data[d + c] = Math.round(scaled.data[s + c] * a + base.data[d + c] * (1 - a))
      base.data[d + 3] = Math.max(base.data[d + 3], scaled.data[s + 3])
    }
  }
  return { x: x0, y: y0, width: targetW, height: targetH }
}

/**
 * Nakłada wszystkie logo na plik wyniku. Oryginał zostaje obok jako `-raw`,
 * żeby dało się zmienić pozycję logo bez ponownej (płatnej) generacji.
 * @returns {{ file: string, rawFile: string, placed: object[] }}
 */
export function applyOverlays(file, overlays = []) {
  if (!overlays.length) return { file, rawFile: null, placed: [] }
  const ext = path.extname(file)
  const rawFile = file.replace(new RegExp(`${ext.replace('.', '\\.')}$`), `-raw${ext}`)
  if (!fs.existsSync(rawFile)) fs.copyFileSync(file, rawFile)

  const base = decodeImage(rawFile)
  const placed = []
  for (const overlay of overlays) {
    if (!fs.existsSync(overlay.file)) throw new OverlayError('Plik logo zniknął z dysku — nakładka pominięta.')
    placed.push(composite(base, decodeImage(overlay.file), overlay))
  }
  const out = file.toLowerCase().endsWith('.png') ? file : file.replace(new RegExp(`${ext.replace('.', '\\.')}$`), '.png')
  fs.writeFileSync(out, encodePng(base))
  return { file: out, rawFile, placed }
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
