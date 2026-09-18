import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  loadModels, validateManifest, defaultValues, validateValues,
  priceFor, buildInput, countOf, calibrationKey,
} from '../server/models.js'

const { models, problems } = loadModels()
const flare = models.find((m) => m.id === 'gpt-image-2-5-flare-text-to-image')
const flareI2I = models.find((m) => m.id === 'gpt-image-2-5-flare-image-to-image')

test('wszystkie manifesty w repo są poprawne', () => {
  assert.deepEqual(problems, [])
  assert.equal(models.length, 4)
})

test('zły manifest jest odrzucany z czytelnym błędem', () => {
  const { ok, errors } = validateManifest({ schemaVersion: 1, id: 'x', provider: 'kie', model: 'x', title: 'X', kind: 'i2i', refs: { max: 0 }, pricing: { values: {} }, fields: [{ name: 'a', type: 'select', options: [] }] }, 'zly.json')
  assert.equal(ok, false)
  assert.ok(errors.some((e) => /select bez opcji/.test(e)))
  assert.ok(errors.some((e) => /images/.test(e)))
})

test('domyślne wartości pochodzą z manifestu', () => {
  const v = defaultValues(flare)
  assert.equal(v.resolution, '1K')
  assert.equal(v.aspect_ratio, '1:1')
  assert.equal(v.count, 1)
})

test('walidacja wymaga promptu i pilnuje limitu referencji', () => {
  assert.equal(validateValues(flare, defaultValues(flare)).ok, false)
  assert.equal(validateValues(flare, { ...defaultValues(flare), prompt: 'kot' }).ok, true)

  const many = Array.from({ length: 17 }, (_, i) => `https://x/${i}.png`)
  const res = validateValues(flareI2I, { ...defaultValues(flareI2I), prompt: 'zmień tło', input_urls: many })
  assert.equal(res.ok, false)
  assert.match(res.errors.join(' '), /najwyżej 16/)
})

test('proporcje tylko-1K są pilnowane przed wysłaniem', () => {
  const res = validateValues(flare, { ...defaultValues(flare), prompt: 'x', aspect_ratio: '9:8', resolution: '2K' })
  assert.equal(res.ok, false)
  assert.match(res.errors.join(' '), /tylko w jakości 1K/)
})

test('cena: 1K ze spike\'u jest pewna, 2K oznaczone jako szacunek', () => {
  const p1 = priceFor(flare, { resolution: '1K', count: 1 })
  assert.equal(p1.credits, 6)
  assert.equal(p1.estimated, false)

  const p2 = priceFor(flare, { resolution: '2K', count: 3 })
  assert.equal(p2.credits, 36)
  assert.equal(p2.count, 3)
  assert.equal(p2.estimated, true)
})

test('kalibracja realnym creditsConsumed nadpisuje cennik z manifestu', () => {
  const key = calibrationKey(flare, { resolution: '2K' })
  const p = priceFor(flare, { resolution: '2K', count: 2 }, { [key]: { credits: 15 } })
  assert.equal(p.credits, 30)
  assert.equal(p.estimated, false)
})

test('buildInput nie wysyła pól pomocniczych (count) ani pustych', () => {
  const input = buildInput(flare, { prompt: 'kot', aspect_ratio: '1:1', resolution: '1K', background: '', count: 4 })
  assert.deepEqual(input, { prompt: 'kot', aspect_ratio: '1:1', resolution: '1K' })
  assert.equal(countOf(flare, { count: 4 }), 4)
  assert.equal(countOf(flare, { count: 99 }), 8)
})
