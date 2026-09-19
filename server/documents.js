import zlib from 'node:zlib'

/**
 * Wyciąga zwykły tekst z pliku, który użytkownik wrzucił „do infografiki”.
 * Obsługujemy .txt, .md, .html i .docx (Word, Google Docs „pobierz jako Word”).
 * DOCX czytamy własnym minimalnym czytnikiem ZIP + XML — celowo bez zależności,
 * żeby instalacja u osób nietechnicznych nie miała kolejnego punktu awarii.
 */

export const MAX_FILE_BYTES = 10 * 1024 * 1024
export const MAX_TEXT_CHARS = 200_000
export const ACCEPTED = ['.txt', '.md', '.markdown', '.html', '.htm', '.docx']

export class DocumentError extends Error {
  constructor(human) {
    super(human)
    this.human = human
  }
}

/** @returns {{ text: string, kind: 'docx'|'markdown'|'html'|'text', name: string }} */
export function extractText({ bytes, name = 'dokument', mime = '' }) {
  if (!bytes || bytes.length === 0) throw new DocumentError('Plik jest pusty.')
  if (bytes.length > MAX_FILE_BYTES) throw new DocumentError('Plik jest za duży (limit 10 MB). Wklej sam tekst.')
  const ext = (name.match(/\.[a-z0-9]+$/i)?.[0] || '').toLowerCase()

  if (ext === '.docx' || mime.includes('wordprocessingml') || looksLikeZip(bytes)) {
    if (ext === '.pdf') throw new DocumentError('PDF nie jest obsługiwany. Zapisz dokument jako .docx albo skopiuj tekst.')
    return { text: clip(docxToText(bytes)), kind: 'docx', name }
  }
  if (ext === '.pdf' || mime === 'application/pdf' || bytes.subarray(0, 4).toString() === '%PDF') {
    throw new DocumentError('PDF nie jest obsługiwany. Skopiuj tekst z dokumentu albo zapisz go jako .docx.')
  }
  if (ext === '.doc') throw new DocumentError('Stary format .doc nie jest obsługiwany — zapisz jako .docx.')

  const text = bytes.toString('utf8')
  if (text.includes('�') && !isMostlyText(bytes)) throw new DocumentError('To nie wygląda na plik tekstowy. Obsługujemy .txt, .md, .html i .docx.')
  if (ext === '.html' || ext === '.htm' || mime.includes('html') || /^\s*<(!doctype|html)/i.test(text)) {
    return { text: clip(htmlToText(text)), kind: 'html', name }
  }
  return { text: clip(text.replace(/\r\n?/g, '\n')), kind: ext === '.txt' ? 'text' : 'markdown', name }
}

function clip(text) {
  const t = text.trim()
  return t.length > MAX_TEXT_CHARS ? t.slice(0, MAX_TEXT_CHARS) : t
}

function looksLikeZip(bytes) {
  return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04
}

function isMostlyText(bytes) {
  const sample = bytes.subarray(0, 4096)
  let bad = 0
  for (const b of sample) if (b < 9 || (b > 13 && b < 32)) bad++
  return bad / sample.length < 0.05
}

// ── DOCX ────────────────────────────────────────────────────────────────────

/**
 * DOCX → tekst w formie markdown-podobnej: nagłówki jako `#`, listy jako `- `,
 * akapity oddzielone pustą linią. Dzięki temu heurystyka planu infografiki
 * działa tak samo dla Worda i dla wklejonego markdowna.
 */
export function docxToText(bytes) {
  let xml
  try {
    xml = readZipEntry(bytes, 'word/document.xml')
  } catch (err) {
    throw new DocumentError('Nie udało się odczytać tego pliku .docx. Spróbuj zapisać go ponownie w Wordzie albo wklej tekst.')
  }
  if (!xml) throw new DocumentError('Ten plik nie wygląda na dokument Word (.docx).')
  const numbering = readZipEntry(bytes, 'word/numbering.xml') || ''
  return paragraphsFromXml(xml, numbering)
}

function paragraphsFromXml(xml, numberingXml) {
  const out = []
  const paragraphs = xml.match(/<w:p[\s>][\s\S]*?<\/w:p>/g) || []
  for (const p of paragraphs) {
    const style = (p.match(/<w:pStyle\s+w:val="([^"]+)"/) || [])[1] || ''
    const runs = []
    const parts = p.match(/<w:t(?:\s[^>]*)?>[\s\S]*?<\/w:t>|<w:t(?:\s[^>]*)?\/>|<w:tab\/>|<w:br\/>/g) || []
    for (const part of parts) {
      if (part.startsWith('<w:tab')) runs.push('\t')
      else if (part.startsWith('<w:br')) runs.push('\n')
      else runs.push(decodeXml(part.replace(/^<w:t[^>]*>/, '').replace(/<\/w:t>$/, '').replace(/^<w:t[^>]*\/>$/, '')))
    }
    const text = runs.join('').replace(/[ \t]+/g, ' ').trim()
    if (!text) continue

    const level = headingLevel(style)
    if (level) { out.push(`${'#'.repeat(level)} ${text}`); continue }
    if (/^Title$|^Tytu/i.test(style)) { out.push(`# ${text}`); continue }
    if (/^Subtitle$|^Podtytu/i.test(style)) { out.push(`## ${text}`); continue }
    if (/<w:numPr>/.test(p) || /ListParagraph|Akapitzlist|ListBullet|ListNumber/i.test(style)) {
      const ilvl = Number((p.match(/<w:ilvl\s+w:val="(\d+)"/) || [])[1] || 0)
      out.push(`${'  '.repeat(Math.min(ilvl, 3))}- ${text}`)
      continue
    }
    out.push(text)
  }
  // Puste linie między blokami różnego rodzaju, ale listy trzymamy razem.
  const lines = []
  for (let i = 0; i < out.length; i++) {
    const cur = out[i]
    const prev = out[i - 1]
    if (prev !== undefined && !(isList(cur) && isList(prev))) lines.push('')
    lines.push(cur)
  }
  return lines.join('\n')
}

const isList = (l) => /^\s*- /.test(l)

function headingLevel(style) {
  const m = style.match(/^(?:Heading|Nag[łl]?[óo]?wek|berschrift|Titre)(\d)$/i)
  if (m) return Math.min(Number(m[1]), 6)
  return 0
}

function decodeXml(s) {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&')
}

// ── HTML ────────────────────────────────────────────────────────────────────

export function htmlToText(html) {
  let s = html
    .replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
  s = s.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, n, t) => `\n\n${'#'.repeat(Number(n))} ${strip(t)}\n\n`)
  s = s.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, t) => `\n- ${strip(t)}`)
  s = s.replace(/<\/(p|div|section|article|tr|blockquote|ul|ol)>/gi, '\n\n').replace(/<br\s*\/?>/gi, '\n')
  s = strip(s)
  return s.replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

function strip(s) {
  return decodeXml(s.replace(/<[^>]+>/g, ' ')).replace(/&nbsp;/g, ' ').replace(/[ \t]+/g, ' ').trim()
}

// ── ZIP (tylko odczyt, bez zależności) ──────────────────────────────────────

/**
 * Czyta jeden wpis z archiwum ZIP przez katalog centralny. Obsługuje metody
 * „stored” (0) i „deflate” (8) — DOCX nigdy nie używa innych.
 */
export function readZipEntry(buf, wanted) {
  const eocd = findEocd(buf)
  if (eocd < 0) throw new Error('brak końca katalogu ZIP')
  const entries = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16)
  for (let i = 0; i < entries; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('zły wpis katalogu ZIP')
    const method = buf.readUInt16LE(p + 10)
    const compressed = buf.readUInt32LE(p + 20)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const localOffset = buf.readUInt32LE(p + 42)
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen)
    p += 46 + nameLen + extraLen + commentLen
    if (name !== wanted) continue
    if (buf.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('zły nagłówek lokalny ZIP')
    const lNameLen = buf.readUInt16LE(localOffset + 26)
    const lExtraLen = buf.readUInt16LE(localOffset + 28)
    const start = localOffset + 30 + lNameLen + lExtraLen
    const data = buf.subarray(start, start + compressed)
    if (method === 0) return data.toString('utf8')
    if (method === 8) return zlib.inflateRawSync(data).toString('utf8')
    throw new Error(`nieobsługiwana metoda kompresji ${method}`)
  }
  return null
}

function findEocd(buf) {
  const min = Math.max(0, buf.length - 65557)
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) return i
  }
  return -1
}
