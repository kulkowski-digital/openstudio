/**
 * Wyciąga dominujące kolory z obrazów — w całości w przeglądarce, bez API
 * i bez kosztów. Obrazy trafiają na maleńkie płótno, liczymy histogram
 * w uproszczonej przestrzeni kolorów, a potem wybieramy te odcienie, które
 * naprawdę różnią się od siebie.
 */
const SAMPLE = 64          // do takiego kwadratu skalujemy każdy obraz
const BUCKET = 3           // ile bitów obcinamy na kanał (8 → 32 poziomy)
const SATURATION_BONUS = 0.9   // kolor marki ma wygrać z czwartym odcieniem szarości
// Dwa kolory są „różne”, gdy różni je odcień, jasność albo nasycenie.
// Sama odległość w RGB przepuszczała trzy warianty tego samego cyjanu.
const NEUTRAL_CHROMA = 34     // poniżej tego kolor jest w praktyce szary
const MIN_NEUTRAL_LUM = 46    // dwie szarości muszą się różnić jasnością
const MIN_HUE = 28            // stopni na kole barw
const MIN_LUM = 70            // różnica jasności między kolorami
const MIN_CHROMA = 90         // różnica „soczystości”

export async function extractPalette(urls, count = 6) {
  const histogram = new Map()

  for (const url of urls) {
    const image = await loadImage(url).catch(() => null)
    if (!image) continue
    const canvas = document.createElement('canvas')
    canvas.width = SAMPLE
    canvas.height = SAMPLE
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    ctx.drawImage(image, 0, 0, SAMPLE, SAMPLE)
    const { data } = ctx.getImageData(0, 0, SAMPLE, SAMPLE)

    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 128) continue                       // przezroczyste pomijamy
      const key = (quantize(data[i]) << 16) | (quantize(data[i + 1]) << 8) | quantize(data[i + 2])
      const entry = histogram.get(key) || { n: 0, r: 0, g: 0, b: 0 }
      entry.n++
      entry.r += data[i]
      entry.g += data[i + 1]
      entry.b += data[i + 2]
      histogram.set(key, entry)
    }
  }

  const candidates = [...histogram.values()]
    .map((e) => {
      const rgb = [Math.round(e.r / e.n), Math.round(e.g / e.n), Math.round(e.b / e.n)]
      // Sama liczba pikseli promuje tło i szarości. Lekka premia za nasycenie
      // sprawia, że kolor marki wchodzi do palety, zamiast wypaść za czwartym szarym.
      return { rgb, score: e.n * (1 - SATURATION_BONUS / 2 + SATURATION_BONUS * saturation(rgb)) }
    })
    .sort((a, b) => b.score - a.score)

  const chosen = []
  for (const candidate of candidates) {
    if (chosen.length >= count) break
    if (chosen.every((c) => isDistinct(c.rgb, candidate.rgb))) chosen.push(candidate)
  }
  // Gdy obraz jest bardzo jednolity, lepiej oddać mniej kolorów niż dorabiać sztuczne.
  return chosen.map((c) => toHex(c.rgb))
}

const quantize = (v) => v >> BUCKET

/** 0 dla szarości, 1 dla koloru czystego. */
function saturation([r, g, b]) {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  return max === 0 ? 0 : (max - min) / max
}

/**
 * Czy ten kolor wnosi do palety coś nowego.
 *
 * Kluczowa pułapka: w HSL prawie-czerń (#160415) wychodzi „mocno nasycona”,
 * więc trzy różne czernie udawały trzy różne kolory. Dlatego nasycenie liczymy
 * bezwzględnie — jako rozpiętość kanałów, a nie ich stosunek.
 */
export function isDistinct(a, b) {
  const ca = chroma(a)
  const cb = chroma(b)
  const dLum = Math.abs(luminance(a) - luminance(b))

  const aNeutral = ca < NEUTRAL_CHROMA
  const bNeutral = cb < NEUTRAL_CHROMA
  // Czerń, biel i szarości różnią się tylko jasnością.
  if (aNeutral && bNeutral) return dLum >= MIN_NEUTRAL_LUM
  if (aNeutral !== bNeutral) return true

  if (dLum >= MIN_LUM) return true
  if (Math.abs(ca - cb) >= MIN_CHROMA) return true
  return hueGap(hue(a), hue(b)) >= MIN_HUE
}

/** Rozpiętość kanałów: 0 dla szarości, 255 dla koloru czystego. */
function chroma([r, g, b]) {
  return Math.max(r, g, b) - Math.min(r, g, b)
}

function luminance([r, g, b]) {
  return 0.299 * r + 0.587 * g + 0.114 * b
}

function hue([r, g, b]) {
  const max = Math.max(r, g, b)
  const delta = chroma([r, g, b])
  if (delta === 0) return 0
  let h
  if (max === r) h = ((g - b) / delta) % 6
  else if (max === g) h = (b - r) / delta + 2
  else h = (r - g) / delta + 4
  return (h * 60 + 360) % 360
}

function hueGap(h1, h2) {
  const d = Math.abs(h1 - h2) % 360
  return d > 180 ? 360 - d : d
}

export function toHex([r, g, b]) {
  return `#${[r, g, b].map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('')}`.toUpperCase()
}

export function isHex(value) {
  return /^#[0-9a-fA-F]{6}$/.test(String(value).trim())
}

/** Czy na tym kolorze czytelniejszy jest czarny napis, czy biały. */
export function readableOn(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? '#06070D' : '#EEF1FF'
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('nie udało się wczytać obrazu'))
    img.src = src
  })
}
