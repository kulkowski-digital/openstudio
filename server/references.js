import fs from 'node:fs'
import path from 'node:path'
import { getPin } from './boards.js'
import { getUpload, saveUpload, forgetUpload } from './store.js'
import { log } from './log.js'

/**
 * Zamienia wybrane inspiracje na publiczne adresy, których wymaga model.
 *
 * Zasady:
 *  - upload jest **leniwy**: plik trafia do dostawcy dopiero, gdy naprawdę
 *    bierze udział w generacji (obietnica z ekranu Tablic),
 *  - ten sam plik wysyłamy raz (cache po skrócie SHA-256),
 *  - po 20 godzinach adres uznajemy za wygasły (u dostawcy żyje 24 h) i wysyłamy
 *    plik ponownie.
 */
export async function resolveReferences(provider, pinIds = [], { limit = 16, optional = new Set() } = {}) {
  // Piny, które zniknęły z tablicy, a były tylko „opcjonalne” (np. referencje
  // stylu), pomijamy zamiast blokować generację.
  const missing = []
  const present = pinIds.filter((id) => {
    if (getPin(id)) return true
    if (optional.has(id)) { missing.push(id); return false }
    throw new ReferenceError_(`Jedna z inspiracji zniknęła z tablicy (${id.slice(0, 8)}).`)
  })
  const used = present.slice(0, limit)
  const skipped = present.slice(limit)
  const urls = []
  const uploaded = []

  for (const pinId of used) {
    const { pin } = getPin(pinId)

    const cached = getUpload(pin.hash)
    if (cached) {
      urls.push(cached.url)
      continue
    }

    if (!fs.existsSync(pin.file)) throw new ReferenceError_(`Plik inspiracji „${pin.name}” zniknął z dysku.`)
    const bytes = fs.readFileSync(pin.file)
    const base64 = `data:${pin.mime};base64,${bytes.toString('base64')}`
    const fileName = `${pin.id}${path.extname(pin.file)}`

    try {
      const { url } = await provider.upload({ base64, fileName, uploadPath: 'openstudio' })
      saveUpload(pin.hash, url)
      urls.push(url)
      uploaded.push(pin.id)
    } catch (err) {
      forgetUpload(pin.hash)
      throw new ReferenceError_(`Nie udało się wysłać inspiracji „${pin.name}”: ${err.human || err.message}`)
    }
  }

  if (uploaded.length) log.info(`Wysłano ${uploaded.length} nowych inspiracji do dostawcy.`)
  return { urls, usedPinIds: used, skippedPinIds: skipped, missingPinIds: missing }
}

/** Błąd z komunikatem gotowym do pokazania użytkownikowi. */
class ReferenceError_ extends Error {
  constructor(human) {
    super(human)
    this.human = human
  }
}

export { ReferenceError_ as ReferenceError }
