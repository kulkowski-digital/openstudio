import { readFeedback, writeFeedback } from './store.js'

/**
 * Feedback do wyniku. Nie „kciuk w górę”, tylko konkret: co poszło nie tak
 * i — najważniejsze — gotowe zdanie do promptu następnej wersji.
 * Każda uwaga ma `fix`: to dokładnie ten tekst pojedzie w „ponów z poprawką”.
 */
export const ISSUE_TAGS = [
  { value: 'kolory', label: 'kolory', fix: 'Kolory są nie takie — dopasuj je do palety i klimatu z opisu, reszty nie zmieniaj.' },
  { value: 'kompozycja', label: 'kompozycja', fix: 'Popraw kompozycję: główny element ma być wyraźnie w centrum uwagi, mniej rozproszenia wokół.' },
  { value: 'napisy', label: 'napisy', fix: 'Napisy są błędne — popraw literówki i czytelność; tekst dokładnie taki, jak w opisie, i żaden inny.' },
  { value: 'osoba', label: 'twarz / osoba', fix: 'Twarz i sylwetka nie zgadzają się z referencją — odtwórz osobę wiernie, nie zmieniaj rysów.' },
  { value: 'za-duzo', label: 'za dużo elementów', fix: 'Za dużo elementów: uprość scenę, zostaw tylko to, co jest w opisie.' },
  { value: 'artefakty', label: 'plamy / artefakty', fix: 'Usuń plamy, smugi, zacieki i przypadkowe kształty — tło ma być czyste i gładkie, bez tekstur; nie powtarzaj nigdzie kształtów z logo ani z referencji.' },
  { value: 'za-jasno', label: 'za jasno', fix: 'Za jasno — przyciemnij scenę, więcej cienia i ciemnego tła.' },
  { value: 'za-ciemno', label: 'za ciemno', fix: 'Za ciemno — rozjaśnij scenę, więcej światła na głównym elemencie.' },
  { value: 'referencje', label: 'nie trzyma referencji', fix: 'Wynik za bardzo odbiega od załączonych obrazów — trzymaj się ich wyraźnie bliżej.' },
  { value: 'styl-slaby', label: 'styl za słaby', fix: 'Styl jest za słabo widoczny — zastosuj go zdecydowanie mocniej.' },
  { value: 'styl-mocny', label: 'styl za mocny', fix: 'Styl przytłacza treść — zastosuj go delikatniej, treść z opisu ma pierwszeństwo.' },
]

/** Co wyszło dobrze — zapisujemy, żeby styl mógł się kiedyś tego nauczyć. */
export const PRAISE_TAGS = [
  { value: 'kolory', label: 'kolory' },
  { value: 'kompozycja', label: 'kompozycja' },
  { value: 'napisy', label: 'napisy' },
  { value: 'osoba', label: 'twarz / osoba' },
  { value: 'klimat', label: 'klimat' },
  { value: 'referencje', label: 'trzyma referencje' },
]

export const VERDICTS = ['good', 'bad']

export class FeedbackError extends Error {
  constructor(human) {
    super(human)
    this.human = human
  }
}

export function normalizeFeedback({ jobId, verdict, tags, text }) {
  if (!jobId) throw new FeedbackError('Brak zadania.')
  if (!VERDICTS.includes(verdict)) throw new FeedbackError('Ocena musi być „dobre” albo „do poprawy”.')
  const catalog = verdict === 'good' ? PRAISE_TAGS : ISSUE_TAGS
  const clean = [...new Set((Array.isArray(tags) ? tags : []).filter((t) => catalog.some((c) => c.value === t)))]
  return { jobId, verdict, tags: clean, text: String(text || '').trim().slice(0, 500) }
}

/** Jedna ocena na zadanie — kolejna nadpisuje poprzednią. */
export function saveFeedback(input, extra = {}) {
  const entry = { ...normalizeFeedback(input), ...extra, at: new Date().toISOString() }
  const all = readFeedback().filter((f) => f.jobId !== entry.jobId)
  all.unshift(entry)
  writeFeedback(all)
  return entry
}

export function feedbackFor(jobId) {
  return readFeedback().find((f) => f.jobId === jobId) || null
}

export function listFeedback() {
  return readFeedback()
}

/** Zdanie do promptu następnej wersji: z chipów + własnych słów użytkownika. */
export function correctionText({ tags = [], text = '' }) {
  const fixes = tags.map((t) => ISSUE_TAGS.find((c) => c.value === t)?.fix).filter(Boolean)
  const own = String(text || '').trim()
  const parts = [...fixes]
  if (own) parts.push(/[.!?]$/.test(own) ? own : `${own}.`)
  if (!parts.length) return ''
  return `Poprawka względem poprzedniej wersji: ${parts.join(' ')}`
}
