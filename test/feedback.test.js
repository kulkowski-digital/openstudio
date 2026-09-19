import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeFeedback, correctionText, ISSUE_TAGS } from '../server/feedback.js'

test('chipy z poprawką zamieniają się w konkretne zdania do promptu', () => {
  const text = correctionText({ tags: ['za-ciemno', 'napisy'], text: 'logo mniejsze, w rogu' })
  assert.match(text, /^Poprawka względem poprzedniej wersji: /)
  assert.match(text, /rozjaśnij scenę/)
  assert.match(text, /Napisy są błędne/)
  assert.match(text, /logo mniejsze, w rogu\.$/)
})

test('bez chipów i bez tekstu nie ma poprawki', () => {
  assert.equal(correctionText({ tags: [], text: '  ' }), '')
})

test('nieznane chipy i zła ocena są odrzucane', () => {
  const f = normalizeFeedback({ jobId: 'j', verdict: 'bad', tags: ['kolory', 'dyskoteka'], text: 'x' })
  assert.deepEqual(f.tags, ['kolory'])
  assert.throws(() => normalizeFeedback({ jobId: 'j', verdict: 'meh' }), /dobre/)
})

test('każda uwaga ma gotowe zdanie do promptu', () => {
  for (const t of ISSUE_TAGS) assert.ok(t.fix.length > 20, t.value)
})
