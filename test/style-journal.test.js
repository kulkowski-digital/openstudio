import { test } from 'node:test'
import assert from 'node:assert/strict'
import { journalFor, applyProposal, dismissProposal, forgetLearned, PROPOSAL_THRESHOLD, MAX_LEARNED } from '../server/style-journal.js'
import { buildPrompt, normalize } from '../server/styles.js'

const style = { id: 's1', name: 'Marka', strength: 'wyrazny', chips: {}, palette: [], avoid: [], learned: [], learningCursor: {} }
const at = (min) => new Date(Date.now() - min * 60000).toISOString()
const bad = (tags, min) => ({ jobId: 'j' + min, styleId: 's1', verdict: 'bad', tags, at: at(min) })
const jobs = [1, 2, 3, 4].map((n) => ({ id: 'j' + n, styleId: 's1', files: [`/x/${n}.png`], userPrompt: 'p' + n }))

test('dziennik liczy generacje i oceny, propozycja dopiero po 3 zgodnych uwagach', () => {
  const two = journalFor(style, [bad(['za-jasno'], 30), bad(['za-jasno'], 20)], jobs)
  assert.equal(two.generations, 4)
  assert.equal(two.bad, 2)
  assert.deepEqual(two.proposals, [], 'dwie uwagi to szum, nie sygnał')

  const three = journalFor(style, [bad(['za-jasno'], 30), bad(['za-jasno', 'kolory'], 20), bad(['za-jasno'], 10)], jobs)
  assert.equal(three.proposals.length, 1)
  assert.equal(three.proposals[0].tag, 'za-jasno')
  assert.equal(three.proposals[0].kind, 'learned')
  assert.equal(three.topIssues[0].label, 'za jasno')
})

test('zastosowanie propozycji dopisuje regułę i przesuwa kursor — stare uwagi już nie liczą się drugi raz', () => {
  const fb = [bad(['za-jasno'], 30), bad(['za-jasno'], 20), bad(['za-jasno'], 10)]
  const applied = applyProposal(style, 'za-jasno')
  assert.equal(applied.learned.length, 1)
  assert.match(applied.learned[0].text, /ciemniejsza/)
  assert.deepEqual(journalFor(applied, fb, jobs).proposals, [], 'po zastosowaniu propozycja znika')
  assert.match(buildPrompt('kot', normalize(applied)), /Z wcześniejszych uwag: Scena ciemniejsza/)
})

test('„pomiń” też wycisza propozycję, aż zbiorą się 3 nowe uwagi', () => {
  const fb = [bad(['kolory'], 30), bad(['kolory'], 20), bad(['kolory'], 10)]
  const dismissed = dismissProposal(style, 'kolory')
  assert.deepEqual(journalFor(dismissed, fb, jobs).proposals, [])
  const later = [...fb, { ...bad(['kolory'], 0), at: new Date(Date.now() + 1000).toISOString() }]
  assert.deepEqual(journalFor(dismissed, later, jobs).proposals, [], 'jedna nowa uwaga to za mało')
})

test('siła stylu: „styl za słaby” proponuje stopień wyżej, na maksimum nic', () => {
  const fb = [bad(['styl-slaby'], 3), bad(['styl-slaby'], 2), bad(['styl-slaby'], 1)]
  const p = journalFor(style, fb, jobs).proposals[0]
  assert.equal(p.kind, 'strength')
  assert.deepEqual(p.patch, { strength: 'mocny' })
  assert.equal(applyProposal(style, 'styl-slaby').strength, 'mocny')
  assert.deepEqual(journalFor({ ...style, strength: 'mocny' }, fb, jobs).proposals, [])
})

test('limit dopisków: czwarty jest odrzucany z wyjaśnieniem, usunięcie zwalnia miejsce', () => {
  let s = style
  for (const tag of ['za-jasno', 'kolory', 'kompozycja']) s = applyProposal(s, tag)
  assert.equal(s.learned.length, MAX_LEARNED)
  assert.throws(() => applyProposal(s, 'napisy'), /usuń jeden/)
  s = forgetLearned(s, 'kolory')
  assert.equal(applyProposal(s, 'napisy').learned.length, MAX_LEARNED)
})

test('próg jest jawny w dzienniku (UI mówi „po 3 uwagach”)', () => {
  assert.equal(journalFor(style, [], []).threshold, PROPOSAL_THRESHOLD)
})
