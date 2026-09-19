import { test } from 'node:test'
import assert from 'node:assert/strict'
// Kod przeglądarkowy, ale te funkcje są czyste — sięgają po canvas dopiero
// w extractPalette, więc można je sprawdzić tutaj. Ta logika dwa razy pod rząd
// dała złą paletę, więc ma własne testy.
import { isDistinct, toHex, readableOn, isHex } from '../web/src/palette.js'

const CZERN = [2, 4, 12]
const PRAWIE_CZERN = [22, 4, 21]
const GRANAT = [1, 35, 52]
const CYJAN = [25, 250, 253]
const CYJAN_CIEMNIEJSZY = [18, 194, 205]
const ZOLTY = [253, 243, 3]
const BIEL = [255, 255, 255]
const PRAWIE_BIEL = [244, 244, 216]

test('warianty tego samego koloru nie zajmują dwóch miejsc w palecie', () => {
  assert.equal(isDistinct(CZERN, PRAWIE_CZERN), false, 'dwie czernie to jedna czerń')
  assert.equal(isDistinct(CYJAN, CYJAN_CIEMNIEJSZY), false, 'dwa odcienie cyjanu to jeden kolor')
  assert.equal(isDistinct(BIEL, PRAWIE_BIEL), false)
})

test('naprawdę różne kolory zostają rozdzielone', () => {
  assert.equal(isDistinct(CZERN, CYJAN), true)
  assert.equal(isDistinct(CYJAN, ZOLTY), true)
  assert.equal(isDistinct(CZERN, BIEL), true)
  assert.equal(isDistinct(CZERN, GRANAT), true, 'ciemny granat to kolor, nie czerń')
})

test('ciemne kolory nie udają nasyconych (pułapka HSL)', () => {
  // W HSL #160415 wychodzi „mocno nasycony fiolet”, choć dla oka to czerń.
  const CIEMNY_FIOLET = [22, 4, 21]
  const CIEMNY_BORDO = [26, 10, 14]
  assert.equal(isDistinct(CIEMNY_FIOLET, CIEMNY_BORDO), false)
})

test('zapis HEX i dobór czytelnego napisu na kolorze', () => {
  assert.equal(toHex([6, 7, 13]), '#06070D')
  assert.equal(toHex([300, -5, 13]), '#FF000D')
  assert.equal(readableOn('#FDF303'), '#06070D', 'na żółtym czytelny jest ciemny napis')
  assert.equal(readableOn('#06070D'), '#EEF1FF', 'na czarnym czytelny jest jasny napis')
  assert.ok(isHex('#06070D'))
  assert.ok(!isHex('czerwony'))
})
