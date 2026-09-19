const MAX_SIDE = 2048

/**
 * Zmniejsza obraz w przeglądarce, zanim cokolwiek trafi na dysk czy do sieci.
 * Zrzut ekranu 4K waży kilkanaście megabajtów, a model i tak nie potrzebuje
 * więcej niż ~2000 px. Przezroczystość zachowujemy (PNG), resztę dajemy w WEBP.
 */
export async function prepareImage(file) {
  const bitmap = await createImageBitmap(file).catch(() => null)
  if (!bitmap) throw new Error(`„${file.name || 'plik'}” nie wygląda na obraz, który przeglądarka umie otworzyć.`)

  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
  const width = Math.round(bitmap.width * scale)
  const height = Math.round(bitmap.height * scale)

  const wantsAlpha = file.type === 'image/png' || file.type === 'image/gif'
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height)
  bitmap.close?.()

  const mime = wantsAlpha ? 'image/png' : 'image/webp'
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, mime, 0.92))
  if (!blob) throw new Error('Nie udało się przygotować tego obrazu.')

  return {
    base64: await blobToBase64(blob),
    mime: blob.type || mime,
    name: file.name || 'inspiracja',
    width,
    height,
  }
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1])
    reader.onerror = () => reject(new Error('Nie udało się odczytać pliku.'))
    reader.readAsDataURL(blob)
  })
}

/** Wyciąga adres obrazka z tego, co przeglądarka wrzuca przy przeciąganiu z innej karty. */
export function urlFromDataTransfer(dt) {
  const uri = dt.getData('text/uri-list') || dt.getData('text/plain')
  if (uri && /^https?:\/\//i.test(uri.trim())) return uri.trim().split('\n')[0]
  const html = dt.getData('text/html')
  const match = html?.match(/<img[^>]+src=["']([^"']+)["']/i)
  return match ? match[1] : null
}
