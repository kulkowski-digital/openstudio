import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'openstudio-styles-'))
process.env.OPENSTUDIO_HOME = HOME

const styles = await import('../server/styles.js')
const { readStyles, writeStyles } = await import('../server/store.js')
const { composePrompt } = await import('../server/prompt.js')

const MARKA = {
  name: 'Kulkowski Digital',
  palette: ['#06070D', '#37E7F5', '#FF4D9D', '#FF8A3D'],
  chips: { kind: 'plakat', light: 'neon', framing: 'centralnie', mood: 'minimalistyczny' },
  avoid: ['ludzie', 'watermark'],
  strength: 'wyrazny',
  extra: 'dużo czarnej przestrzeni wokół',
}

beforeEach(() => writeStyles([]))

test('wzorce wizualne zastępują sprzeczne chipy i paletę, zachowują role osoby i logo', () => {
  const style = styles.normalize({ ...MARKA, referencePinIds: ['a'] })
  const references = [{ pinId: 'a', role: 'inspiracja' }, { pinId: 'b', role: 'osoba' }, { pinId: 'c', role: 'logo' }]
  const prompt = composePrompt({ userPrompt: 'Nowy tytuł', style, references })
  assert.match(prompt, /1\. Wzorzec stylu:/)
  // Nazwane cechy typografii, bez których model „odtwarza styl” jako dowolny napis.
  for (const cecha of [/charakter kroju/, /szerokość liter/, /wielkość liter/, /podział napisu na wiersze/, /kąt nachylenia/, /gradient/, /obrys i cień/]) {
    assert.match(prompt, cecha)
  }
  assert.match(prompt, /Zachowaj wygląd napisów, ale nie ich treść/)
  assert.match(prompt, /2\. Osoba:/)
  assert.match(prompt, /3\. Logo:/)
  assert.doesNotMatch(prompt, /minimalistyczny|Paleta kolorów:/)
  assert.match(prompt, /dużo czarnej przestrzeni wokół/)
  const override = composePrompt({ userPrompt: 'Nowy tytuł', style: { ...style, referencePriority: 'description' }, references })
  assert.match(override, /minimalistyczny/)
  assert.match(override, /Paleta kolorów:/)
})

test('styl zapisuje się i wraca z listy', () => {
  const saved = styles.saveStyle(MARKA)
  assert.equal(saved.name, 'Kulkowski Digital')
  assert.equal(readStyles().length, 1)
  assert.equal(styles.getStyle(saved.id).palette.length, 4)
})

test('prompt składa się z tego, co użytkownik widzi w kreatorze', () => {
  const style = styles.saveStyle(MARKA)
  const prompt = styles.buildPrompt('okładka odcinka o Claude Code', style)

  assert.match(prompt, /^okładka odcinka o Claude Code/)
  assert.match(prompt, /Zachowaj ten styl: grafika plakatowa, neonowe światło/)
  assert.match(prompt, /dużo czarnej przestrzeni wokół\./, 'dopisek musi kończyć się kropką, żeby nie zlewał się z paletą')
  assert.match(prompt, /Paleta kolorów: #06070D, #37E7F5/)
  assert.match(prompt, /kolory orientacyjne/)
  assert.match(prompt, /Unikaj: ludzie i twarze, znaki wodne\./)
})

test('siła stylu zmienia ton polecenia, nie jego treść', () => {
  const lekki = styles.buildPrompt('kot', styles.normalize({ ...MARKA, strength: 'lekki' }))
  const mocny = styles.buildPrompt('kot', styles.normalize({ ...MARKA, strength: 'mocny' }))
  assert.match(lekki, /Nawiąż do stylu:/)
  assert.match(mocny, /Trzymaj się ściśle tego stylu:/)
})

test('bez stylu prompt zostaje dokładnie taki, jaki wpisał użytkownik', () => {
  assert.equal(styles.buildPrompt('  kot w kapeluszu  ', null), 'kot w kapeluszu')
})

test('styl bez chipów i palety nie dokleja pustych zdań', () => {
  const goly = styles.saveStyle({ name: 'Goły' })
  assert.equal(styles.buildPrompt('kot', goly), 'kot')
})

test('błędne kolory i nieznane chipy są odrzucane', () => {
  const s = styles.normalize({ name: 'X', palette: ['#06070D', 'czerwony', '#GGGGGG', '#FF4D9D'] })
  assert.deepEqual(s.palette, ['#06070D', '#FF4D9D'])
  assert.throws(() => styles.normalize({ name: 'X', chips: { light: 'dyskoteka' } }), /Nieznana wartość/)
  assert.throws(() => styles.normalize({ palette: [] }), /nazwę/)
})

test('eksport nie wynosi referencji ani identyfikatora', () => {
  const style = styles.saveStyle({ ...MARKA, referencePinIds: ['pin-1', 'pin-2'] })
  const file = styles.exportStyle(style)
  assert.equal(file.id, undefined)
  assert.equal(file.referencePinIds, undefined)
  assert.equal(file.app, 'openstudio')
  assert.deepEqual(file.palette, MARKA.palette)
})

test('import cudzego pliku daje własny styl bez cudzych referencji', () => {
  const file = styles.exportStyle(styles.normalize({ ...MARKA, referencePinIds: ['obcy-pin'] }))
  writeStyles([])
  const imported = styles.importStyle(file)
  assert.equal(imported.name, 'Kulkowski Digital')
  assert.deepEqual(imported.referencePinIds, [])
  assert.ok(imported.id)
})

test('plik z nowszej wersji aplikacji jest odrzucany ze zrozumiałym powodem', () => {
  assert.throws(() => styles.importStyle({ name: 'Z przyszłości', schemaVersion: 99 }), /nowszej wersji/)
})

test('usuwanie stylu, którego nie ma, mówi o tym po ludzku', () => {
  assert.throws(() => styles.deleteStyle('nie-istnieje'), /Nie ma takiego stylu/)
})

test('nazwa pliku eksportu nie gubi polskich znaków', () => {
  assert.equal(styles.styleFileName('Do wysłania'), 'do-wyslania.styl.json')
  assert.equal(styles.styleFileName('Ciepła jesień — wersja 2'), 'ciepla-jesien-wersja-2.styl.json')
  assert.equal(styles.styleFileName('🙂'), 'styl.styl.json')
})
