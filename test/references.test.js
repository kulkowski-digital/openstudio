import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeReferences, describeReferences, REFERENCE_ROLES } from '../server/reference-roles.js'
import { composePrompt } from '../server/prompt.js'

test('stary kształt (lista id) staje się listą inspiracji', () => {
  const refs = normalizeReferences(['a', 'b', 'a'])
  assert.deepEqual(refs, [{ pinId: 'a', role: 'inspiracja', note: '' }, { pinId: 'b', role: 'inspiracja', note: '' }])
})

test('nieznana rola spada do inspiracji, notatka jest przycinana', () => {
  const [ref] = normalizeReferences([{ pinId: 'x', role: 'dyskoteka', note: '  w bluzie  ' }])
  assert.equal(ref.role, 'inspiracja')
  assert.equal(ref.note, 'w bluzie')
})

test('opis załączników numeruje obrazy w kolejności wysyłki i mówi, co z nimi zrobić', () => {
  const text = describeReferences([
    { pinId: 'a', role: 'inspiracja', note: '' },
    { pinId: 'b', role: 'osoba', note: 'w czarnej bluzie' },
    { pinId: 'c', role: 'logo', note: '' },
  ])
  const lines = text.split('\n')
  assert.equal(lines[0], 'Załączone obrazy, w kolejności:')
  assert.match(lines[1], /^1\. Inspiracja: weź z niej klimat/)
  assert.match(lines[2], /^2\. Osoba: to ma być główny bohater.*Dodatkowo: w czarnej bluzie\./)
  assert.match(lines[3], /^3\. Logo: wstaw je bez żadnych zmian/)
})

test('własna instrukcja idzie dosłownie, bez naszego szablonu', () => {
  const text = describeReferences([{ pinId: 'a', role: 'wlasne', note: 'zrób z tego naklejkę na laptop' }])
  assert.equal(text, 'Załączony obraz:\n1. zrób z tego naklejkę na laptop')
})

test('każda rola poza „własną” ma gotowe zdanie dla modelu', () => {
  for (const role of REFERENCE_ROLES) {
    if (role.value === 'wlasne') continue
    assert.ok(role.prompt && role.prompt.length > 20, `rola ${role.value} bez zdania`)
  }
})

test('composePrompt: prompt użytkownika → załączniki → styl, w tej kolejności', () => {
  const prompt = composePrompt({
    userPrompt: 'okładka odcinka',
    references: [{ pinId: 'a', role: 'logo', note: '' }],
    style: { name: 'x', chips: { light: 'neon' }, palette: ['#000000'], avoid: [], strength: 'wyrazny' },
  })
  const iUser = prompt.indexOf('okładka odcinka')
  const iRefs = prompt.indexOf('Załączony obraz')
  const iStyle = prompt.indexOf('Zachowaj ten styl')
  assert.ok(iUser < iRefs && iRefs < iStyle, prompt)
})

test('bez załączników i stylu prompt to dokładnie tekst użytkownika', () => {
  assert.equal(composePrompt({ userPrompt: '  kot  ' }), 'kot')
})
