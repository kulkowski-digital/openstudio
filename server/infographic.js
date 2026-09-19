/**
 * Infografika z tekstu: z dokumentu (artykuł, notatki, oferta) powstaje PLAN
 * — tytuł, kilka punktów, wyróżnione liczby — a z planu prompt do modelu
 * obrazu. Plan jest edytowalny, a prompt trafia do zwykłego pola „Co ma być
 * na obrazie?”, więc wysyłka nadal idzie przez composePrompt i użytkownik
 * widzi dokładnie to, co pojedzie do API.
 *
 * Dwie drogi do planu: heurystyka (za darmo, od razu) i model czatu Kie na tym
 * samym kluczu (płatne, lepsze przy długich, nieuporządkowanych tekstach).
 */

export const MAX_POINTS = 7
export const MAX_STATS = 4
export const MAX_INPUT_CHARS = 60_000     // tyle idzie do modelu czatu; reszta jest ucinana
export const OUTLINE_MODEL = process.env.OPENSTUDIO_OUTLINE_MODEL || 'claude-haiku-4-5'
const HEADING_LIMIT = 48
const TEXT_LIMIT = 110

/** Układy infografiki. `defaults` podpowiada format, `describe` to zdanie dla modelu. */
export const LAYOUTS = [
  {
    value: 'lista', label: 'lista punktów', hint: 'najbezpieczniejszy: numerowane punkty jeden pod drugim',
    defaults: { aspect_ratio: '2:3' },
    describe: 'pionowa, ponumerowana lista punktów, jeden pod drugim, każdy z prostą ikoną-piktogramem po lewej i krótkim opisem po prawej',
  },
  {
    value: 'kroki', label: 'kroki / proces', hint: 'kolejność ma znaczenie: strzałki, oś czasu',
    defaults: { aspect_ratio: '16:9' },
    describe: 'proces krok po kroku: ponumerowane etapy połączone strzałkami w jednej linii, każdy etap w osobnym kafelku z ikoną',
  },
  {
    value: 'porownanie', label: 'porównanie', hint: 'dwie kolumny: przed/po, A vs B',
    defaults: { aspect_ratio: '4:3' },
    describe: 'porównanie w dwóch kolumnach obok siebie, punkty z pierwszej połowy listy w lewej kolumnie, z drugiej w prawej, wyraźny pionowy podział',
  },
  {
    value: 'liczby', label: 'liczby', hint: 'statystyki w dużych kafelkach',
    defaults: { aspect_ratio: '1:1' },
    describe: 'siatka dużych kafelków z liczbami: każda liczba bardzo dużą czcionką, pod nią krótki opis, punkty jako drobniejszy pasek na dole',
  },
  {
    value: 'mapa', label: 'mapa myśli', hint: 'temat w środku, gałęzie wokół',
    defaults: { aspect_ratio: '4:3' },
    describe: 'mapa myśli: temat w okręgu na środku, punkty jako gałęzie promieniście wokół, każda z ikoną i podpisem',
  },
]

export class InfographicError extends Error {
  constructor(human) {
    super(human)
    this.human = human
  }
}

// ── Plan z tekstu: heurystyka ────────────────────────────────────────────────

/**
 * Bez modelu: nagłówki → punkty, w ich braku wypunktowania, w ostateczności
 * pierwsze zdania akapitów. Liczby z kontekstem lądują w „stats”.
 */
export function outlineFromText(input) {
  const text = String(input || '').replace(/\r\n?/g, '\n').trim()
  if (!text) throw new InfographicError('Wklej tekst albo wrzuć plik — nie ma z czego zrobić infografiki.')
  const lines = text.split('\n').map((l) => l.replace(/\s+$/, ''))

  const blocks = parseBlocks(lines)
  const h1 = blocks.find((b) => b.type === 'heading' && b.level === 1)
  const firstText = blocks.find((b) => b.type !== 'heading' || b.level > 1)
  let title = h1?.text || (blocks[0]?.type === 'heading' ? blocks[0].text : null) || firstSentence(firstText?.text || '') || 'Infografika'
  title = cut(title, 70)

  // Punkty: nagłówki niższego rzędu (z pierwszym zdaniem treści pod spodem).
  let points = []
  const subheads = blocks.filter((b) => b.type === 'heading' && b !== h1 && b.text !== title)
  if (subheads.length >= 2) {
    for (const h of subheads) {
      const i = blocks.indexOf(h)
      const body = blocks.slice(i + 1).find((b) => b.type === 'paragraph' || b.type === 'item')
      points.push({ heading: cut(h.text, HEADING_LIMIT), text: cut(firstSentence(body?.text || ''), TEXT_LIMIT) })
    }
  }
  if (points.length < 2) {
    const items = blocks.filter((b) => b.type === 'item' && b.depth === 0)
    if (items.length >= 2) points = items.map((b) => splitPoint(b.text))
  }
  if (points.length < 2) {
    const paras = blocks.filter((b) => b.type === 'paragraph' && b.text !== firstText?.text || (b.type === 'paragraph' && title !== firstSentence(b.text)))
    points = paras.map((b) => splitPoint(firstSentence(b.text)))
  }
  points = dedupe(points.filter((p) => p.heading)).slice(0, MAX_POINTS)

  const stats = extractStats(text).slice(0, MAX_STATS)
  const subtitle = h1 && firstText && firstText !== h1 && firstText.type === 'paragraph' ? cut(firstSentence(firstText.text), 90) : ''

  return normalizeOutline({ title, subtitle, points, stats, source: 'heurystyka' })
}

function parseBlocks(lines) {
  const blocks = []
  let para = []
  const flush = () => {
    if (para.length) blocks.push({ type: 'paragraph', text: para.join(' ').replace(/\s+/g, ' ').trim() })
    para = []
  }
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) { flush(); continue }
    const h = line.match(/^(#{1,6})\s+(.+?)\s*#*$/)
    if (h) { flush(); blocks.push({ type: 'heading', level: h[1].length, text: cleanInline(h[2]) }); continue }
    const item = raw.match(/^(\s*)(?:[-*•]|\d+[.)])\s+(.+)$/)
    if (item) { flush(); blocks.push({ type: 'item', depth: Math.floor(item[1].length / 2), text: cleanInline(item[2]) }); continue }
    // Krótka linia bez kropki, po której idzie treść — traktujemy jak nagłówek (typowe w notatkach i Wordzie bez stylów).
    if (line.length <= 60 && !/[.:;,]$/.test(line) && para.length === 0 && /^[\p{Lu}\d„"]/u.test(line) && (line.split(' ').length <= 8)) {
      blocks.push({ type: 'heading', level: 2, text: cleanInline(line) })
      continue
    }
    para.push(line)
  }
  flush()
  // „Nagłówek”, po którym od razu jest kolejny nagłówek, a nic pod spodem — to raczej akapit-jednozdaniowiec.
  return blocks
}

function cleanInline(s) {
  return s.replace(/\*\*|__|`/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/\s+/g, ' ').trim()
}

function firstSentence(text) {
  const t = cleanInline(text)
  const m = t.match(/^.+?[.!?](\s|$)/)
  return (m ? m[0] : t).trim()
}

/** „Nagłówek: opis” albo „Nagłówek — opis” → dwa pola; inaczej sam nagłówek. */
function splitPoint(text) {
  const t = cleanInline(text)
  const m = t.match(/^(.{3,60}?)\s*(?::|—|–| - )\s*(.+)$/)
  if (m) return { heading: cut(m[1], HEADING_LIMIT), text: cut(firstSentence(m[2]), TEXT_LIMIT) }
  const sentence = firstSentence(t)
  if (sentence.length <= HEADING_LIMIT) return { heading: sentence.replace(/[.!?]$/, ''), text: cut(t.slice(sentence.length).trim(), TEXT_LIMIT) }
  return { heading: cut(sentence, HEADING_LIMIT), text: '' }
}

function cut(s, max) {
  const t = String(s || '').replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  const sliced = t.slice(0, max - 1)
  return sliced.slice(0, Math.max(sliced.lastIndexOf(' '), max - 20)).trim() + '…'
}

function dedupe(points) {
  const seen = new Set()
  return points.filter((p) => {
    const key = p.heading.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

const NUMBER = /(?:^|[\s(„"])((?:\d{1,3}(?:[  ]\d{3})+|\d+)(?:[.,]\d+)?\s?(?:%|zł|PLN|€|\$|mln|mld|tys\.?|x|×|godz\.?|h|min\.?|dni|lat|razy)?)(?=[\s,.;:)!?”"]|$)/g

/** Liczby z otoczeniem: „73% firm nie ma…” → { value: '73%', label: 'firm nie ma…' }. */
export function extractStats(text) {
  const out = []
  // Nagłówki i znaczniki list wypadają — inaczej „## Świeżość” klei się do zdania obok.
  const plain = String(text).split('\n').map((l) => l.replace(/^\s*#{1,6}\s+/, '').replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '')).join('. ')
  const sentences = plain.replace(/\s+/g, ' ').split(/(?<=[.!?])\s+/)
  for (const s of sentences) {
    NUMBER.lastIndex = 0
    let m
    while ((m = NUMBER.exec(s))) {
      const value = m[1].trim()
      // Same lata i drobne liczby porządkowe nie są „statystyką”.
      if (/^(19|20)\d{2}$/.test(value)) continue
      // Goła liczba bez jednostki to zwykle numer porządkowy albo „60 słów” w środku zdania — bierzemy ją tylko, gdy jest duża.
      if (/^[\d ,.\u00a0]+$/.test(value) && Number(value.replace(/[ \u00a0]/g, '').replace(',', '.')) < 1000) continue
      const after = s.slice(m.index + m[0].length).trim()
      const before = s.slice(0, m.index).trim()
      // Kontekst za liczbą, a gdy jest za krótki („4 razy rzadziej.”) — całe zdanie bez liczby.
      const context = after.length >= 12 ? after : `${before} ${after}`.trim()
      const label = cut(context.replace(/^[,;:—–-]\s*/, '').replace(/^\.\s*/, ''), 60).replace(/[.!?…]+$/, '')
      if (!label) continue
      if (out.some((o) => o.value === value)) continue
      out.push({ value, label })
    }
  }
  return out
}

// ── Plan z tekstu: model czatu ───────────────────────────────────────────────

const OUTLINE_INSTRUCTION = `Jesteś redaktorem infografik. Z tekstu poniżej wybierz to, co najlepiej zadziała na JEDNEJ planszy.
Odpowiedz WYŁĄCZNIE JSON-em (bez komentarza, bez markdown):
{"title": "...", "subtitle": "...", "points": [{"heading": "...", "text": "..."}], "stats": [{"value": "...", "label": "..."}], "layout": "lista|kroki|porownanie|liczby|mapa"}
Zasady: od 3 do ${MAX_POINTS} punktów; "heading" do 5 słów, "text" do 12 słów; "stats" tylko liczby, które NAPRAWDĘ są w tekście (max ${MAX_STATS}), "value" to sama liczba z jednostką; język taki jak w tekście; nic nie wymyślaj.`

/**
 * Plan przez model czatu Kie (ten sam klucz). Gdy odpowiedź nie da się
 * sparsować, zwracamy heurystykę z notatką — użytkownik nie zostaje z niczym.
 */
export async function outlineWithModel(provider, input) {
  const text = String(input || '').trim()
  if (!text) throw new InfographicError('Wklej tekst albo wrzuć plik — nie ma z czego zrobić infografiki.')
  const clipped = text.length > MAX_INPUT_CHARS ? text.slice(0, MAX_INPUT_CHARS) : text
  const res = await provider.chat({
    model: OUTLINE_MODEL,
    prompt: `${OUTLINE_INSTRUCTION}\n\nTEKST:\n${clipped}`,
    maxTokens: 1200,
  })
  const parsed = parseOutlineJson(res.text)
  if (!parsed) {
    return { outline: outlineFromText(text), credits: res.credits, note: 'Model odpowiedział niezrozumiale — pokazuję plan z heurystyki.' }
  }
  const outline = normalizeOutline({ ...parsed, source: OUTLINE_MODEL })
  const layout = LAYOUTS.some((l) => l.value === parsed.layout) ? parsed.layout : null
  return { outline, layout, credits: res.credits, note: text.length > MAX_INPUT_CHARS ? `Tekst był długi — model dostał pierwsze ${MAX_INPUT_CHARS.toLocaleString('pl-PL')} znaków.` : null }
}

export function parseOutlineJson(raw) {
  const s = String(raw || '').replace(/```(?:json)?/gi, '').trim()
  const start = s.indexOf('{')
  const end = s.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const obj = JSON.parse(s.slice(start, end + 1))
    if (!obj || typeof obj !== 'object' || !Array.isArray(obj.points)) return null
    return obj
  } catch {
    return null
  }
}

/** Porządkuje plan (z heurystyki, modelu albo edytora): przycina, filtruje puste. */
export function normalizeOutline(input) {
  const o = input || {}
  const points = (Array.isArray(o.points) ? o.points : [])
    .map((p) => (typeof p === 'string' ? splitPoint(p) : { heading: cut(p?.heading, HEADING_LIMIT), text: cut(p?.text, TEXT_LIMIT) }))
    .filter((p) => p.heading)
    .slice(0, MAX_POINTS)
  const stats = (Array.isArray(o.stats) ? o.stats : [])
    .map((s) => ({ value: cut(s?.value, 16), label: cut(s?.label, 60) }))
    .filter((s) => s.value)
    .slice(0, MAX_STATS)
  return {
    title: cut(o.title, 70) || 'Infografika',
    subtitle: cut(o.subtitle, 90),
    points,
    stats,
    source: o.source || 'edytor',
  }
}

// ── Prompt do modelu obrazu ──────────────────────────────────────────────────

/**
 * Prompt z planu. Wszystkie napisy w cudzysłowach — modele obrazu najlepiej
 * trzymają się tekstu podanego dosłownie. To trafia do pola promptu w
 * generatorze; użytkownik może go jeszcze poprawić.
 */
export function infographicPrompt(rawOutline, { layout = 'lista' } = {}) {
  const o = normalizeOutline(rawOutline)
  if (o.points.length === 0 && o.stats.length === 0) throw new InfographicError('Plan jest pusty — dodaj choć jeden punkt albo liczbę.')
  const l = LAYOUTS.find((x) => x.value === layout) || LAYOUTS[0]

  // Kropka na końcu cytowanego napisu wyglądałaby na planszy jak błąd, więc ją zdejmujemy.
  const q = (s) => `„${String(s).replace(/[.]+$/, '')}”`
  const lines = []
  lines.push(`Infografika ${q(o.title)}. Układ: ${l.describe}.`)
  lines.push(`Nagłówek na górze planszy, dokładnie: ${q(o.title)}.${o.subtitle ? ` Pod nim mniejszy podtytuł: ${q(o.subtitle)}.` : ''}`)
  if (o.points.length) {
    lines.push(`Punkty (dokładnie te napisy, w tej kolejności, bez zmian i bez dodatkowych):`)
    o.points.forEach((p, i) => lines.push(`${i + 1}. ${q(p.heading)}${p.text ? ` — ${q(p.text)}` : ''}`))
  }
  if (o.stats.length) {
    lines.push(`Wyróżnione liczby w osobnych kafelkach, każda dużą czcionką z podpisem: ${o.stats.map((s) => `${q(s.value)} — ${q(s.label)}`).join('; ')}.`)
  }
  lines.push('Wszystkie napisy bezbłędne, czytelne i w tym samym języku co powyżej; duża czcionka bezszeryfowa, wysoki kontrast, dużo światła między elementami, płaskie ikony w jednym stylu. Żadnych innych napisów, znaków wodnych ani wymyślonych liczb.')
  return lines.join('\n')
}

/** Ile słów pójdzie na planszę — powyżej ~80 modele zaczynają gubić litery. */
export function wordCount(rawOutline) {
  const o = normalizeOutline(rawOutline)
  const all = [o.title, o.subtitle, ...o.points.flatMap((p) => [p.heading, p.text]), ...o.stats.flatMap((s) => [s.value, s.label])]
  return all.join(' ').split(/\s+/).filter(Boolean).length
}
