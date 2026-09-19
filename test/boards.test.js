import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'openstudio-boards-'))
process.env.OPENSTUDIO_HOME = HOME

const boards = await import('../server/boards.js')
const { resolveReferences } = await import('../server/references.js')
const { readBoards, writeBoards, getUpload, saveUpload, UPLOAD_TTL_MS } = await import('../server/store.js')

const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(40, 1)])
const PNG2 = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(40, 2)])
const JPG = Buffer.concat([Buffer.from('ffd8ff', 'hex'), Buffer.alloc(40, 3)])

beforeEach(() => {
  writeBoards([])
  fs.rmSync(path.join(HOME, 'uploads.json'), { force: true })
})

test('pierwsza tablica tworzy się sama, żeby nie witać laika pustym ekranem', () => {
  const list = boards.listBoards()
  assert.equal(list.length, 1)
  assert.equal(list[0].name, 'Moje inspiracje')
})

test('ten sam obraz dodany dwa razy nie robi duplikatu', () => {
  const board = boards.listBoards()[0]
  const a = boards.addPin(board.id, { bytes: PNG, name: 'a.png' })
  const b = boards.addPin(board.id, { bytes: PNG, name: 'kopia.png' })
  assert.equal(b.duplicate, true)
  assert.equal(b.pin.id, a.pin.id)
  assert.equal(readBoards()[0].pins.length, 1)
})

test('format rozpoznajemy po zawartości pliku, nie po deklaracji', () => {
  const board = boards.listBoards()[0]
  const { pin } = boards.addPin(board.id, { bytes: JPG, mime: 'image/png', name: 'klamstwo.png' })
  assert.equal(pin.mime, 'image/jpeg')
  assert.match(pin.file, /\.jpg$/)
})

test('plik, który nie jest obrazem, dostaje ludzkie „to nie obraz”', () => {
  const board = boards.listBoards()[0]
  assert.throws(() => boards.addPin(board.id, { bytes: Buffer.from('%PDF-1.7 zupełnie inny plik'), name: 'faktura.pdf' }), /nie jest obraz/i)
})

test('usunięcie inspiracji kasuje też plik z dysku', () => {
  const board = boards.listBoards()[0]
  const { pin } = boards.addPin(board.id, { bytes: PNG, name: 'a.png' })
  assert.ok(fs.existsSync(pin.file))
  boards.deletePin(pin.id)
  assert.equal(fs.existsSync(pin.file), false)
  assert.equal(readBoards()[0].pins.length, 0)
})

test('usunięcie tablicy kasuje jej folder z inspiracjami', () => {
  const board = boards.listBoards()[0]
  const { pin } = boards.addPin(board.id, { bytes: PNG, name: 'a.png' })
  const dir = path.dirname(pin.file)
  boards.deleteBoard(board.id)
  assert.equal(fs.existsSync(dir), false)
})

test('link do strony: bierzemy og:image zamiast mówić „nie działa”', async () => {
  const calls = []
  const fakeFetch = async (url) => {
    calls.push(url)
    if (url.endsWith('/pin/123')) {
      return {
        ok: true, status: 200,
        headers: new Map([['content-type', 'text/html; charset=utf-8']]),
        arrayBuffer: async () => Buffer.from('<html><meta property="og:image" content="/media/foto.png"></html>'),
      }
    }
    return { ok: true, status: 200, headers: new Map([['content-type', 'image/png']]), arrayBuffer: async () => PNG }
  }
  fakeFetch.prototype = null
  const res = await boards.fetchImage('https://serwis.example/pin/123', patchHeaders(fakeFetch))
  assert.equal(res.mime, 'image/png')
  assert.equal(calls[1], 'https://serwis.example/media/foto.png')
})

test('link do strony bez og:image mówi, co zrobić zamiast tego', async () => {
  const fakeFetch = patchHeaders(async () => ({
    ok: true, status: 200,
    headers: new Map([['content-type', 'text/html']]),
    arrayBuffer: async () => Buffer.from('<html>nic ciekawego</html>'),
  }))
  await assert.rejects(() => boards.fetchImage('https://serwis.example/x', fakeFetch), /przeciągnij plik/)
})

test('referencje: ten sam plik wysyłamy do dostawcy tylko raz', async () => {
  const board = boards.listBoards()[0]
  const a = boards.addPin(board.id, { bytes: PNG, name: 'a.png' }).pin
  const b = boards.addPin(board.id, { bytes: PNG2, name: 'b.png' }).pin

  let uploads = 0
  const provider = { async upload() { uploads++; return { url: `https://cdn.example/${uploads}.png` } } }

  const first = await resolveReferences(provider, [a.id, b.id])
  assert.equal(first.urls.length, 2)
  assert.equal(uploads, 2)

  const second = await resolveReferences(provider, [a.id, b.id])
  assert.equal(uploads, 2, 'drugi raz nie wysyłamy tych samych plików')
  assert.deepEqual(second.urls, first.urls)
})

test('referencje: po 20 godzinach adres uznajemy za wygasły i wysyłamy ponownie', async () => {
  const board = boards.listBoards()[0]
  const pin = boards.addPin(board.id, { bytes: PNG, name: 'a.png' }).pin
  let uploads = 0
  const provider = { async upload() { uploads++; return { url: `https://cdn.example/${uploads}.png` } } }

  await resolveReferences(provider, [pin.id])
  assert.equal(uploads, 1)

  // cofamy zegar wpisu w cache
  const uploadsFile = path.join(HOME, 'uploads.json')
  const data = JSON.parse(fs.readFileSync(uploadsFile, 'utf8'))
  data.uploads[pin.hash].uploadedAt = new Date(Date.now() - UPLOAD_TTL_MS - 1000).toISOString()
  fs.writeFileSync(uploadsFile, JSON.stringify(data))

  await resolveReferences(provider, [pin.id])
  assert.equal(uploads, 2, 'wygasły adres musi zostać odświeżony')
})

test('referencje: ponad limit modelu obcinamy i mówimy które pominięto', async () => {
  const board = boards.listBoards()[0]
  const pins = [PNG, PNG2, JPG].map((b, i) => boards.addPin(board.id, { bytes: b, name: `${i}.png` }).pin)
  const provider = { async upload() { return { url: 'https://cdn.example/x.png' } } }
  const res = await resolveReferences(provider, pins.map((p) => p.id), { limit: 2 })
  assert.equal(res.urls.length, 2)
  assert.deepEqual(res.skippedPinIds, [pins[2].id])
})

test('referencje: brak pliku na dysku nie wysyła nic i mówi po ludzku', async () => {
  const board = boards.listBoards()[0]
  const pin = boards.addPin(board.id, { bytes: PNG, name: 'zniknie.png' }).pin
  fs.rmSync(pin.file)
  const provider = { async upload() { throw new Error('nie powinno dojść') } }
  await assert.rejects(() => resolveReferences(provider, [pin.id]), /zniknął z dysku/)
})

/** node:test nie ma Headers w Map — dorabiamy `get`. */
function patchHeaders(fn) {
  return async (...args) => {
    const res = await fn(...args)
    if (res.headers instanceof Map) {
      const map = res.headers
      res.headers = { get: (k) => map.get(k.toLowerCase()) ?? null }
    }
    return res
  }
}
