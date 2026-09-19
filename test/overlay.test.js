import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PNG } from 'pngjs'
import { composite, resize, applyOverlays, describeOverlays, normalizeOverlay, encodePng, decodeImage, trimBorders } from '../server/overlay.js'

const solid = (w, h, [r, g, b, a = 255]) => {
  const data = Buffer.alloc(w * h * 4)
  for (let i = 0; i < w * h; i++) data.set([r, g, b, a], i * 4)
  return { width: w, height: h, data }
}

test('logo ląduje w wybranym rogu, w zadanej szerokości, z marginesem', () => {
  const base = solid(100, 50, [0, 0, 0])
  const logo = solid(10, 5, [255, 0, 0])
  const box = composite(base, logo, { position: 'prawy-dol', widthPct: 20, marginPct: 5 })
  assert.deepEqual(box, { x: 100 - 20 - 5, y: 50 - 10 - 5, width: 20, height: 10 })
  const px = (x, y) => [...base.data.subarray((y * 100 + x) * 4, (y * 100 + x) * 4 + 3)]
  assert.deepEqual(px(80, 40), [255, 0, 0], 'w polu logo ma być czerwień')
  assert.deepEqual(px(10, 10), [0, 0, 0], 'poza logo tło bez zmian')
})

test('przezroczyste piksele logo nie zamalowują tła, półprzezroczyste mieszają się', () => {
  const base = solid(10, 10, [0, 0, 0])
  const logo = solid(2, 2, [255, 255, 255, 0])
  composite(base, logo, { position: 'lewy-gora', widthPct: 20, marginPct: 0 })
  assert.equal(base.data[0], 0, 'alfa 0 = nic się nie dzieje')
  const half = solid(2, 2, [255, 255, 255, 128])
  composite(base, half, { position: 'lewy-gora', widthPct: 20, marginPct: 0 })
  assert.ok(base.data[0] > 120 && base.data[0] < 135, 'pół przezroczystości = pół jasności')
})

test('skalowanie zachowuje kolor jednolitego obrazu', () => {
  const out = resize(solid(4, 4, [10, 200, 30]), 9, 9)
  assert.equal(out.width, 9)
  assert.deepEqual([...out.data.subarray(0, 3)], [10, 200, 30])
})

test('applyOverlays zostawia oryginał jako -raw i nakłada na kopię', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openstudio-overlay-'))
  const base = path.join(dir, 'wynik.png')
  const logo = path.join(dir, 'logo.png')
  fs.writeFileSync(base, encodePng(solid(40, 20, [0, 0, 0])))
  fs.writeFileSync(logo, encodePng(solid(4, 2, [0, 255, 0])))

  const res = applyOverlays(base, [{ file: logo, position: 'lewy-dol', widthPct: 25, marginPct: 0 }])
  assert.equal(res.file, base)
  assert.ok(fs.existsSync(res.rawFile))
  const raw = decodeImage(res.rawFile)
  const done = decodeImage(base)
  assert.equal(raw.data[((19 * 40) + 0) * 4 + 1], 0, 'oryginał nietknięty')
  assert.equal(done.data[((19 * 40) + 0) * 4 + 1], 255, 'na kopii jest logo')
  assert.deepEqual(res.placed[0], { x: 0, y: 15, width: 10, height: 5 })
})

test('opis do promptu prosi o czyste miejsce i zakazuje rysowania logo', () => {
  const text = describeOverlays([{ position: 'lewy-dol', widthPct: 18 }, { position: 'prawy-gora', widthPct: 12 }])
  assert.match(text, /w lewym dolnym rogu oraz w prawym górnym rogu/)
  assert.match(text, /około 18%/)
  assert.match(text, /nie rysuj tam żadnego logo/)
  assert.equal(describeOverlays([]), '')
})

test('parametry nakładki są pilnowane', () => {
  assert.deepEqual(normalizeOverlay({ position: 'kosmos', widthPct: 900, marginPct: -3 }), { position: 'lewy-dol', widthPct: 60, marginPct: 0, trim: true })
  assert.deepEqual(normalizeOverlay({}), { position: 'lewy-dol', widthPct: 18, marginPct: 4, trim: true })
})

test('białe ramki z JPG-a są obcinane, logo bez ramek zostaje bez zmian', () => {
  // 10×6: białe tło, w środku limonkowy prostokąt 6×2 (x 2..7, y 2..3)
  const img = solid(10, 6, [255, 255, 255])
  for (let y = 2; y <= 3; y++) for (let x = 2; x <= 7; x++) img.data.set([200, 255, 0, 255], (y * 10 + x) * 4)
  const cut = trimBorders(img)
  assert.equal(cut.width, 6)
  assert.equal(cut.height, 2)
  assert.deepEqual([...cut.data.subarray(0, 3)], [200, 255, 0])

  const plain = solid(5, 5, [0, 0, 0])
  assert.equal(trimBorders(plain).width, 5, 'jednolity obraz nie jest cięty do zera')

  const base = solid(100, 50, [0, 0, 0])
  const box = composite(base, img, { position: 'lewy-dol', widthPct: 30, marginPct: 0 })
  assert.equal(box.height, 10, 'po przycięciu proporcje to 6:2, więc 30 px szerokości daje 10 px wysokości')
})
