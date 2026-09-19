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
export async function resolveReferences(provider, pinIds = [], { limit = 16 } = {}) {
  const used = pinIds.slice(0, limit)
  const skipped = pinIds.slice(limit)
  const urls = []
  const uploaded = []

  for (const pinId of used) {
    const found = getPin(pinId)
    if (!found) throw new ReferenceError_(`Jedna z inspiracji zniknęła z tablicy (${pinId.slice(0, 8)}).`)
    const { pin } = found

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
  return { urls, usedPinIds: used, skippedPinIds: skipped }
}

/** Błąd z komunikatem gotowym do pokazania użytkownikowi. */
class ReferenceError_ extends Error {
  constructor(human) {
    super(human)
    this.human = human
  }
}

export { ReferenceError_ as ReferenceError }
