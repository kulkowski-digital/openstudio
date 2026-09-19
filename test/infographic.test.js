import { test } from 'node:test'
import assert from 'node:assert/strict'
import { outlineFromText, extractStats, infographicPrompt, parseOutlineJson, normalizeOutline, outlineWithModel, wordCount, LAYOUTS, InfographicError } from '../server/infographic.js'

const ARTICLE = `# 5 rzeczy, które AI zmienia w SEO

Wyszukiwarki z AI cytują strony, a nie tylko je linkują. To zmienia zasady gry dla każdej firmy.

## Cytowalność zamiast pozycji
Model wybiera fragmenty, które odpowiadają wprost na pytanie. Reszta strony nie ma znaczenia.

## Struktura treści
Nagłówki jako pytania i odpowiedź w pierwszym zdaniu. 73% cytowanych akapitów ma mniej niż 60 słów.

## Marka
Model musi wiedzieć, kim jesteś: wzmianki w 3 niezależnych źródłach robią różnicę.

## Świeżość
Treści starsze niż 2 lata są cytowane 4 razy rzadziej.

## Pomiar
Ruch z AI stanowi już 12% wejść w niektórych branżach — mierz go osobno w GA4.
`

test('plan z artykułu z nagłówkami: tytuł z H1, punkty z H2, liczby z tekstu', () => {
  const o = outlineFromText(ARTICLE)
  assert.equal(o.title, '5 rzeczy, które AI zmienia w SEO')
  assert.equal(o.subtitle, 'Wyszukiwarki z AI cytują strony, a nie tylko je linkują.')
  assert.deepEqual(o.points.map((p) => p.heading), ['Cytowalność zamiast pozycji', 'Struktura treści', 'Marka', 'Świeżość', 'Pomiar'])
  assert.equal(o.points[0].text, 'Model wybiera fragmenty, które odpowiadają wprost na pytanie.')
  assert.ok(o.stats.some((s) => s.value === '73%'), JSON.stringify(o.stats))
  assert.ok(o.stats.some((s) => s.value === '12%'))
  assert.equal(o.source, 'heurystyka')
})

test('plan z samych wypunktowań: „nagłówek: opis” rozdzielone na dwa pola', () => {
  const o = outlineFromText(`Checklista przed publikacją
- Tytuł: pytanie, na które odpowiada tekst
- Pierwszy akapit — odpowiedź w 2 zdaniach
- Nagłówki H2 jako pytania
- Autor z biogramem i linkiem`)
  assert.equal(o.title, 'Checklista przed publikacją')
  assert.equal(o.points.length, 4)
  assert.deepEqual(o.points[0], { heading: 'Tytuł', text: 'pytanie, na które odpowiada tekst' })
  assert.deepEqual(o.points[1], { heading: 'Pierwszy akapit', text: 'odpowiedź w 2 zdaniach' })
})

test('plan z ciągłego tekstu bez struktury: pierwsze zdania akapitów, max 7', () => {
  const paras = Array.from({ length: 10 }, (_, i) => `Akapit numer ${i + 1} mówi o czymś ważnym i ciekawym. A potem rozwija temat dalej.`)
  const o = outlineFromText(paras.join('\n\n'))
  assert.equal(o.points.length, 7)
  assert.match(o.points[0].heading, /^Akapit numer/)
})

test('pusty tekst → błąd po polsku', () => {
  assert.throws(() => outlineFromText('   '), (e) => e instanceof InfographicError)
})

test('extractStats: liczby z jednostką i kontekstem, bez lat i cyfr porządkowych', () => {
  const stats = extractStats('W 2024 roku 73% firm nie mierzy ruchu z AI. Koszt to 1 200 zł miesięcznie. Krok 3 jest najważniejszy.')
  assert.deepEqual(stats.map((s) => s.value), ['73%', '1 200 zł'])
  assert.equal(stats[0].label, 'firm nie mierzy ruchu z AI')
})

test('prompt: wszystkie napisy dosłownie w cudzysłowach, układ opisany, brak wymyślonych treści', () => {
  const o = outlineFromText(ARTICLE)
  const prompt = infographicPrompt(o, { layout: 'kroki' })
  assert.match(prompt, /^Infografika „5 rzeczy, które AI zmienia w SEO”\. Układ: proces krok po kroku/)
  assert.match(prompt, /1\. „Cytowalność zamiast pozycji” — „Model wybiera fragmenty/)
  assert.match(prompt, /5\. „Pomiar”/)
  assert.match(prompt, /„73%” — „/)
  assert.match(prompt, /Żadnych innych napisów/)
  assert.ok(!/undefined|null/.test(prompt))
})

test('prompt: nieznany układ → lista; pusty plan → błąd', () => {
  assert.match(infographicPrompt({ title: 'T', points: [{ heading: 'A' }] }, { layout: 'nie-ma' }), /Układ: pionowa, ponumerowana lista/)
  assert.throws(() => infographicPrompt({ title: 'T', points: [], stats: [] }), (e) => /pusty/.test(e.human))
})

test('normalizeOutline przycina i wyrzuca puste; wordCount liczy słowa na planszy', () => {
  const o = normalizeOutline({ title: 'x'.repeat(200), points: [{ heading: '' }, { heading: 'ok', text: 'y'.repeat(300) }, 'Napis: opis'], stats: [{ value: '', label: 'nic' }, { value: '5x', label: 'szybciej' }] })
  assert.ok(o.title.length <= 70)
  assert.equal(o.points.length, 2)
  assert.ok(o.points[0].text.length <= 110)
  assert.deepEqual(o.points[1], { heading: 'Napis', text: 'opis' })
  assert.deepEqual(o.stats, [{ value: '5x', label: 'szybciej' }])
  assert.equal(wordCount({ title: 'a b', points: [{ heading: 'c', text: 'd e' }], stats: [] }), 5)
})

test('parseOutlineJson wybacza płotki i komentarz wokół JSON-a', () => {
  const raw = 'Oto plan:\n```json\n{"title":"T","points":[{"heading":"A","text":"b"}],"stats":[],"layout":"liczby"}\n```'
  assert.equal(parseOutlineJson(raw).layout, 'liczby')
  assert.equal(parseOutlineJson('nie json'), null)
  assert.equal(parseOutlineJson('{"title":"bez punktów"}'), null)
})

test('outlineWithModel: JSON od modelu → plan; śmieci → heurystyka z notatką; tekst ucięty do limitu', async () => {
  const calls = []
  const fake = (text) => ({ chat: async (args) => { calls.push(args); return { text, credits: 0.3 } } })
  const good = await outlineWithModel(fake('{"title":"Z modelu","subtitle":"","points":[{"heading":"A","text":"a"},{"heading":"B","text":"b"},{"heading":"C","text":"c"}],"stats":[{"value":"9%","label":"x"}],"layout":"kroki"}'), ARTICLE)
  assert.equal(good.outline.title, 'Z modelu')
  assert.equal(good.outline.source, 'claude-haiku-4-5')
  assert.equal(good.layout, 'kroki')
  assert.equal(good.credits, 0.3)
  assert.match(calls[0].prompt, /TEKST:\n# 5 rzeczy/)

  const bad = await outlineWithModel(fake('nie umiem'), ARTICLE)
  assert.equal(bad.outline.source, 'heurystyka')
  assert.match(bad.note, /heurystyki/)

  const long = await outlineWithModel(fake('{"title":"L","points":[{"heading":"A"}]}'), 'x '.repeat(50_000))
  assert.ok(calls.at(-1).prompt.length < 62_000)
  assert.match(long.note, /długi/)
})

test('katalog układów: każdy ma opis dla modelu i domyślny format', () => {
  for (const l of LAYOUTS) {
    assert.ok(l.value && l.label && l.describe && l.defaults?.aspect_ratio, l.value)
  }
})
