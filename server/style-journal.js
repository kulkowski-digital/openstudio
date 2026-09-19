import { ISSUE_TAGS } from './feedback.js'

export const PROPOSAL_THRESHOLD = 3   // tyle zgodnych uwag, zanim cokolwiek zaproponujemy
export const MAX_LEARNED = 3          // więcej dopisków = sprzeczności i gorsze wyniki

/**
 * Co dana uwaga oznacza dla stylu. Nic nie wchodzi samo — to tylko propozycja,
 * którą użytkownik zatwierdza jednym kliknięciem i może cofnąć.
 */
export const PROPOSAL_RULES = {
  'styl-slaby': { kind: 'strength', direction: +1, label: 'Wzmocnić styl (siła o stopień wyżej)' },
  'styl-mocny': { kind: 'strength', direction: -1, label: 'Osłabić styl (siła o stopień niżej)' },
  'za-jasno': { kind: 'learned', text: 'Scena ciemniejsza: więcej cienia i ciemnego tła.', label: 'Dopisać: ciemniejsza scena' },
  'za-ciemno': { kind: 'learned', text: 'Scena jaśniejsza: więcej światła na głównym elemencie.', label: 'Dopisać: jaśniejsza scena' },
  kolory: { kind: 'learned', text: 'Trzymaj się palety ściśle, bez obcych kolorów.', label: 'Dopisać: ściśle paleta' },
  kompozycja: { kind: 'learned', text: 'Jeden główny element wyraźnie w centrum uwagi, mniej rozproszenia.', label: 'Dopisać: prostsza kompozycja' },
  napisy: { kind: 'learned', text: 'Napisy dokładnie takie jak w opisie, czytelne, bez literówek — i żadnych innych.', label: 'Dopisać: napisy tylko z opisu' },
  'za-duzo': { kind: 'learned', text: 'Mało elementów: tylko to, co w opisie, dużo pustej przestrzeni.', label: 'Dopisać: mniej elementów' },
  artefakty: { kind: 'learned', text: 'Tło czyste i gładkie, bez tekstur, plam i przypadkowych kształtów.', label: 'Dopisać: czyste tło' },
  osoba: { kind: 'learned', text: 'Twarz i sylwetka wiernie z referencji, bez zmiany rysów.', label: 'Dopisać: wierna twarz' },
  referencje: { kind: 'learned', text: 'Trzymaj się załączonych obrazów wyraźnie bliżej.', label: 'Dopisać: bliżej referencji' },
}

const STRENGTH_ORDER = ['lekki', 'wyrazny', 'mocny']

/** Dziennik stylu: co z niego wychodzi i co można w nim poprawić. */
export function journalFor(style, feedback = [], jobs = []) {
  const styleJobs = jobs.filter((j) => j.styleId === style.id)
  const styleJobIds = new Set(styleJobs.map((j) => j.id))
  const entries = feedback.filter((f) => f.styleId === style.id || styleJobIds.has(f.jobId))
  const cursor = style.learningCursor || {}

  const good = entries.filter((f) => f.verdict === 'good')
  const bad = entries.filter((f) => f.verdict === 'bad')

  const count = (list, pick) => {
    const m = new Map()
    for (const f of list) for (const t of pick(f)) m.set(t, (m.get(t) || 0) + 1)
    return [...m.entries()].map(([tag, n]) => ({ tag, count: n })).sort((a, b) => b.count - a.count)
  }
  const topIssues = count(bad, (f) => f.tags || []).map((x) => ({ ...x, label: ISSUE_TAGS.find((t) => t.value === x.tag)?.label || x.tag }))
  const topPraise = count(good, (f) => f.tags || [])

  // Propozycje: uwagi zebrane PO ostatniej decyzji w tej sprawie.
  const proposals = []
  for (const { tag } of topIssues) {
    const rule = PROPOSAL_RULES[tag]
    if (!rule) continue
    const since = cursor[tag] ? new Date(cursor[tag]).getTime() : 0
    const fresh = bad.filter((f) => (f.tags || []).includes(tag) && new Date(f.at).getTime() > since).length
    if (fresh < PROPOSAL_THRESHOLD) continue
    if (rule.kind === 'learned' && (style.learned || []).some((l) => l.tag === tag)) continue
    if (rule.kind === 'strength') {
      const i = STRENGTH_ORDER.indexOf(style.strength || 'wyrazny')
      const next = STRENGTH_ORDER[i + rule.direction]
      if (!next) continue
      proposals.push({ tag, count: fresh, kind: 'strength', label: rule.label, patch: { strength: next } })
    } else {
      proposals.push({ tag, count: fresh, kind: 'learned', label: rule.label, text: rule.text, full: (style.learned || []).length >= MAX_LEARNED })
    }
  }

  const recentGood = good
    .map((f) => styleJobs.find((j) => j.id === f.jobId))
    .filter((j) => j && j.files?.[0])
    .slice(0, 6)
    .map((j) => ({ jobId: j.id, file: j.files[0], userPrompt: j.userPrompt, alreadyReference: false }))

  return {
    generations: styleJobs.length,
    rated: entries.length,
    good: good.length,
    bad: bad.length,
    implicit: entries.filter((f) => f.implicit).length,
    topIssues,
    topPraise,
    proposals,
    learned: style.learned || [],
    recentGood,
    threshold: PROPOSAL_THRESHOLD,
    maxLearned: MAX_LEARNED,
  }
}

/** Zastosowanie propozycji → łatka na styl + przesunięcie kursora dla tej uwagi. */
export function applyProposal(style, tag) {
  const rule = PROPOSAL_RULES[tag]
  if (!rule) throw new Error('Nie ma takiej propozycji.')
  const cursor = { ...(style.learningCursor || {}), [tag]: new Date().toISOString() }
  if (rule.kind === 'strength') {
    const i = STRENGTH_ORDER.indexOf(style.strength || 'wyrazny')
    const next = STRENGTH_ORDER[i + rule.direction] || style.strength
    return { ...style, strength: next, learningCursor: cursor }
  }
  const learned = (style.learned || []).filter((l) => l.tag !== tag)
  if (learned.length >= MAX_LEARNED) {
    const err = new Error(`Styl ma już ${MAX_LEARNED} dopiski z uwag — usuń jeden, zanim dodasz kolejny. Więcej zasad naraz zwykle psuje wyniki.`)
    err.human = err.message
    throw err
  }
  learned.push({ tag, text: rule.text, addedAt: new Date().toISOString() })
  return { ...style, learned, learningCursor: cursor }
}

export function dismissProposal(style, tag) {
  return { ...style, learningCursor: { ...(style.learningCursor || {}), [tag]: new Date().toISOString() } }
}

export function forgetLearned(style, tag) {
  return { ...style, learned: (style.learned || []).filter((l) => l.tag !== tag) }
}
