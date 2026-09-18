import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerSecret, redact, mask, forgetSecrets } from '../server/log.js'

test('klucz API nigdy nie pojawia się po redakcji', () => {
  forgetSecrets()
  const key = 'a1b2c3d4e5f6g7h8i9j0klmnop'
  registerSecret(key)
  const out = redact(`request: Authorization: Bearer ${key}; config {"apiKey":"${key}"}`)
  assert.ok(!out.includes(key), 'klucz wyciekł do logu')
  assert.match(out, /a1b…mnop/)
})

test('redakcja działa na obiektach (np. dumpach diagnostyki)', () => {
  forgetSecrets()
  registerSecret('sekretnyklucz12345')
  const out = redact({ apiKey: 'sekretnyklucz12345', prompt: 'kot w kapeluszu' })
  assert.ok(!out.includes('sekretnyklucz12345'))
  assert.match(out, /kot w kapeluszu/)
})

test('mask pokazuje tylko końcówkę klucza', () => {
  assert.equal(mask('abcdefghijkl'), 'abc…ijkl')
  assert.equal(mask('krótki'), '***')
})
