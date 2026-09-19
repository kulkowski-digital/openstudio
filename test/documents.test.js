import { test } from 'node:test'
import assert from 'node:assert/strict'
import zlib from 'node:zlib'
import { extractText, docxToText, htmlToText, readZipEntry, DocumentError } from '../server/documents.js'

/** Minimalny zapis ZIP (stored albo deflate) — tyle, ile trzeba, żeby zbudować DOCX w teście. */
function makeZip(entries, { deflate = false } = {}) {
  const locals = []
  const centrals = []
  let offset = 0
  for (const [name, content] of Object.entries(entries)) {
    const raw = Buffer.from(content, 'utf8')
    const data = deflate ? zlib.deflateRawSync(raw) : raw
    const nameBuf = Buffer.from(name, 'utf8')
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(deflate ? 8 : 0, 8)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    const localFull = Buffer.concat([local, nameBuf, data])
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(deflate ? 8 : 0, 10)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(raw.length, 24)
    central.writeUInt16LE(nameBuf.length, 28)
    central.writeUInt32LE(offset, 42)
    centrals.push(Buffer.concat([central, nameBuf]))
    locals.push(localFull)
    offset += localFull.length
  }
  const cd = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(centrals.length, 8)
  eocd.writeUInt16LE(centrals.length, 10)
  eocd.writeUInt32LE(cd.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, cd, eocd])
}

const p = (text, { style, num, ilvl = 0 } = {}) =>
  `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/>${num ? `<w:numPr><w:ilvl w:val="${ilvl}"/><w:numId w:val="1"/></w:numPr>` : ''}</w:pPr>` : num ? `<w:pPr><w:numPr><w:ilvl w:val="${ilvl}"/><w:numId w:val="1"/></w:numPr></w:pPr>` : ''}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`

const DOC = `<?xml version="1.0"?><w:document xmlns:w="x"><w:body>
${p('Jak AI zmienia SEO', { style: 'Heading1' })}
${p('Krótki wstęp o tym, co się dzieje. Drugie zdanie wstępu.')}
${p('Cytowalność', { style: 'Heading2' })}
${p('Modele cytują strony, które odpowiadają wprost. 73% odpowiedzi ma źródło.')}
${p('Struktura', { style: 'Nagwek2' })}
${p('Pierwszy krok', { num: true })}
${p('Drugi &amp; trzeci krok', { num: true })}
${p('Podpunkt', { num: true, ilvl: 1 })}
${p('Koniec')}
</w:body></w:document>`

test('czytnik ZIP: wpis stored i deflate', () => {
  for (const deflate of [false, true]) {
    const zip = makeZip({ 'a.txt': 'hej', 'word/document.xml': '<w:p/>' }, { deflate })
    assert.equal(readZipEntry(zip, 'a.txt'), 'hej')
    assert.equal(readZipEntry(zip, 'word/document.xml'), '<w:p/>')
    assert.equal(readZipEntry(zip, 'brak'), null)
  }
})

test('DOCX → markdown: nagłówki (także polskie style), listy z wcięciem, encje', () => {
  const zip = makeZip({ 'word/document.xml': DOC }, { deflate: true })
  const text = docxToText(zip)
  assert.equal(text, [
    '# Jak AI zmienia SEO',
    '',
    'Krótki wstęp o tym, co się dzieje. Drugie zdanie wstępu.',
    '',
    '## Cytowalność',
    '',
    'Modele cytują strony, które odpowiadają wprost. 73% odpowiedzi ma źródło.',
    '',
    '## Struktura',
    '',
    '- Pierwszy krok',
    '- Drugi & trzeci krok',
    '  - Podpunkt',
    '',
    'Koniec',
  ].join('\n'))
})

test('extractText rozpoznaje docx po nagłówku, a nie po nazwie', () => {
  const zip = makeZip({ 'word/document.xml': DOC })
  const res = extractText({ bytes: zip, name: 'bez-rozszerzenia' })
  assert.equal(res.kind, 'docx')
  assert.match(res.text, /^# Jak AI zmienia SEO/)
})

test('extractText: markdown, txt, html', () => {
  assert.equal(extractText({ bytes: Buffer.from('# Tytuł\r\n\r\ntekst'), name: 'a.md' }).text, '# Tytuł\n\ntekst')
  assert.equal(extractText({ bytes: Buffer.from('zwykły'), name: 'a.txt' }).kind, 'text')
  const html = extractText({ bytes: Buffer.from('<html><body><h1>Nagłówek</h1><p>Akapit &amp; coś</p><ul><li>jeden</li><li>dwa</li></ul><script>x()</script></body></html>'), name: 'a.html' })
  assert.equal(html.kind, 'html')
  assert.equal(html.text, '# Nagłówek\n\nAkapit & coś\n\n- jeden\n- dwa')
})

test('PDF i pusty plik dostają komunikat po polsku', () => {
  assert.throws(() => extractText({ bytes: Buffer.from('%PDF-1.4 ...'), name: 'a.pdf' }), (e) => e instanceof DocumentError && /PDF/.test(e.human))
  assert.throws(() => extractText({ bytes: Buffer.alloc(0), name: 'a.txt' }), (e) => /pusty/.test(e.human))
  assert.throws(() => extractText({ bytes: Buffer.from('PK\x03\x04zepsute'), name: 'a.docx' }), (e) => /docx/.test(e.human))
})

test('htmlToText zostawia czysty tekst bez stylów i komentarzy', () => {
  assert.equal(htmlToText('<style>p{}</style><!-- c --><p>A<br>B</p>'), 'A\nB')
})
