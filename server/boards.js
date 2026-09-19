import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { BOARDS_FILE, boardDir, ensureDataDir } from './paths.js'
import { readBoards, writeBoards } from './store.js'
import { log } from './log.js'

const MAX_BYTES = 25 * 1024 * 1024
const ALLOWED = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }

export class BoardError extends Error {
  constructor(human) {
    super(human)
    this.human = human
  }
}

export function listBoards() {
  const boards = readBoards()
  if (boards.length === 0) {
    // Pierwsza tablica powstaje sama — laik nie ma zaczynać od pustego ekranu z przyciskiem.
    const first = createBoard('Moje inspiracje')
    return [first]
  }
  return boards
}

export function createBoard(name = 'Nowa tablica') {
  const boards = readBoards()
  const board = { id: crypto.randomUUID(), name: String(name).slice(0, 80), createdAt: new Date().toISOString(), pins: [] }
  boards.unshift(board)
  writeBoards(boards)
  return board
}

export function renameBoard(id, name) {
  const boards = readBoards()
  const board = boards.find((b) => b.id === id)
  if (!board) throw new BoardError('Nie ma takiej tablicy.')
  board.name = String(name).slice(0, 80)
  writeBoards(boards)
  return board
}

export function deleteBoard(id) {
  const boards = readBoards()
  const board = boards.find((b) => b.id === id)
  if (!board) throw new BoardError('Nie ma takiej tablicy.')
  fs.rmSync(boardDir(id), { recursive: true, force: true })
  writeBoards(boards.filter((b) => b.id !== id))
  return { ok: true }
}

export function getPin(pinId) {
  for (const board of readBoards()) {
    const pin = board.pins.find((p) => p.id === pinId)
    if (pin) return { board, pin }
  }
  return null
}

/**
 * Dodaje inspirację do tablicy. Plik ląduje na dysku użytkownika i nigdzie
 * indziej — do dostawcy trafia dopiero wtedy, gdy pin weźmie udział w generacji.
 */
export function addPin(boardId, { bytes, mime, name, sourceUrl, note, width, height }) {
  ensureDataDir()
  const boards = readBoards()
  const board = boards.find((b) => b.id === boardId)
  if (!board) throw new BoardError('Nie ma takiej tablicy.')
  if (!bytes?.length) throw new BoardError('Pusty plik.')
  if (bytes.length > MAX_BYTES) throw new BoardError('Ten plik jest za duży (limit 25 MB). Zmniejsz go i spróbuj ponownie.')

  const detected = sniffMime(bytes) || mime
  const ext = ALLOWED[detected]
  if (!ext) throw new BoardError('To nie jest obraz JPG, PNG, WEBP ani GIF.')

  const hash = crypto.createHash('sha256').update(bytes).digest('hex')
  const existing = board.pins.find((p) => p.hash === hash)
  if (existing) return { pin: existing, duplicate: true }

  const id = crypto.randomUUID()
  const file = path.join(boardDir(boardId), `${id}.${ext}`)
  fs.writeFileSync(file, bytes)

  const pin = {
    id,
    boardId,
    file,
    hash,
    mime: detected,
    bytes: bytes.length,
    name: (name || 'inspiracja').slice(0, 120),
    sourceUrl: sourceUrl || null,
    note: note || '',
    width: width || null,
    height: height || null,
    addedAt: new Date().toISOString(),
  }
  board.pins.unshift(pin)
  writeBoards(boards)
  return { pin, duplicate: false }
}

export function updatePin(pinId, patch) {
  const boards = readBoards()
  for (const board of boards) {
    const pin = board.pins.find((p) => p.id === pinId)
    if (!pin) continue
    if (patch.note !== undefined) pin.note = String(patch.note).slice(0, 300)
    writeBoards(boards)
    return pin
  }
  throw new BoardError('Nie ma takiej inspiracji.')
}

export function deletePin(pinId) {
  const boards = readBoards()
  for (const board of boards) {
    const pin = board.pins.find((p) => p.id === pinId)
    if (!pin) continue
    board.pins = board.pins.filter((p) => p.id !== pinId)
    writeBoards(boards)
    fs.rmSync(pin.file, { force: true })
    return { ok: true }
  }
  throw new BoardError('Nie ma takiej inspiracji.')
}

/**
 * Pobiera obraz z adresu. Linki z Pinteresta czy Instagrama zwykle prowadzą do
 * strony, nie do pliku, więc próbujemy wyłuskać `og:image`.
 */
export async function fetchImage(url, fetchImpl = globalThis.fetch) {
  let target
  try {
    target = new URL(url)
  } catch {
    throw new BoardError('To nie wygląda na poprawny adres.')
  }
  if (!['http:', 'https:'].includes(target.protocol)) throw new BoardError('Obsługujemy tylko adresy http i https.')

  const res = await fetchImpl(target.href, { headers: { 'User-Agent': 'OpenStudio/0.1 (+https://github.com/openstudio)' } })
    .catch(() => { throw new BoardError('Nie udało się połączyć z tym adresem.') })
  if (!res.ok) {
    if ([401, 403, 429].includes(res.status)) {
      throw new BoardError(`Ta strona nie pozwala pobrać obrazka automatycznie (błąd ${res.status}). Otwórz ją w przeglądarce, zapisz obraz na dysk i przeciągnij plik tutaj — albo przeciągnij go prosto z tamtej karty.`)
    }
    throw new BoardError(`Strona odpowiedziała błędem ${res.status}. Sprawdź, czy link jest poprawny.`)
  }

  const type = (res.headers.get('content-type') || '').split(';')[0].trim()
  const buf = Buffer.from(await res.arrayBuffer())

  if (ALLOWED[sniffMime(buf) || type]) {
    return { bytes: buf, mime: sniffMime(buf) || type, sourceUrl: target.href, name: path.basename(target.pathname) || 'inspiracja' }
  }

  if (type.startsWith('text/html')) {
    const og = findOgImage(buf.toString('utf8'), target)
    if (!og) throw new BoardError('Pod tym adresem jest strona, a nie obrazek. Zapisz obraz na dysk i przeciągnij plik.')
    log.info('Pod adresem była strona — biorę og:image')
    return fetchImage(og, fetchImpl)
  }

  throw new BoardError('Pod tym adresem nie ma obrazka w obsługiwanym formacie.')
}

function findOgImage(html, base) {
  const patterns = [
    /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
  ]
  for (const re of patterns) {
    const m = html.match(re)
    if (m) {
      try { return new URL(m[1], base).href } catch { /* pomijamy */ }
    }
  }
  return null
}

/** Rozpoznanie formatu po nagłówku pliku — nie ufamy deklarowanemu typowi. */
export function sniffMime(buf) {
  if (buf.length < 12) return null
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
  if (buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP') return 'image/webp'
  if (buf.subarray(0, 3).toString() === 'GIF') return 'image/gif'
  return null
}

export { BOARDS_FILE }
