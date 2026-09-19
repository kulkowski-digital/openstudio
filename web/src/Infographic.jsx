import { useEffect, useRef, useState } from 'react'
import { api } from './api.js'
import { Alert, Badge, Card, Label, Spinner } from './ui.jsx'

const WORD_SOFT_LIMIT = 80
const inputCls = 'w-full rounded-xl bg-panel-2 border border-line px-3 py-2 text-sm'

/**
 * Infografika z tekstu w trzech krokach: źródło (wklejony tekst albo plik)
 * → plan (tytuł, punkty, liczby, układ) → prompt, który ląduje w generatorze.
 * Nic tu nie generuje obrazu — to robi zwykły generator, ze stylem i podglądem promptu.
 */
export default function Infographic({ config, hasApiKey, onUse }) {
  const [text, setText] = useState('')
  const [fileInfo, setFileInfo] = useState(null)
  const [outline, setOutline] = useState(null)
  const [layout, setLayout] = useState('lista')
  const [preview, setPreview] = useState(null)      // { prompt, words, defaults }
  const [busy, setBusy] = useState(null)            // 'plik' | 'plan' | 'model'
  const [error, setError] = useState(null)
  const [note, setNote] = useState(null)
  const [dragging, setDragging] = useState(false)
  const planRef = useRef(null)

  const layouts = config?.layouts || []
  const accepted = config?.accepted || ['.txt', '.md', '.docx']

  async function readFile(file) {
    setError(null)
    setBusy('plik')
    try {
      const base64 = await new Promise((resolve, reject) => {
        const r = new FileReader()
        r.onload = () => resolve(String(r.result).split(',')[1])
        r.onerror = () => reject(new Error('Nie udało się odczytać pliku.'))
        r.readAsDataURL(file)
      })
      const res = await api.infographicExtract({ base64, name: file.name, mime: file.type })
      setText(res.text)
      setFileInfo({ name: file.name, kind: res.kind, chars: res.text.length })
      setOutline(null)
      setPreview(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(null)
    }
  }

  async function makeOutline(useModel) {
    setError(null)
    setNote(null)
    setBusy(useModel ? 'model' : 'plan')
    try {
      const res = await api.infographicOutline(text, useModel)
      setOutline(res.outline)
      if (res.layout) setLayout(res.layout)
      const bits = []
      if (res.credits != null) bits.push(`Plan od modelu kosztował ${res.credits} kr.`)
      if (res.note) bits.push(res.note)
      if (bits.length) setNote(bits.join(' '))
      setTimeout(() => planRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(null)
    }
  }

  // Prompt liczy serwer — ten sam kod, który testy sprawdzają — 300 ms po ostatniej zmianie planu.
  useEffect(() => {
    if (!outline) return
    const t = setTimeout(() => {
      api.infographicPrompt(outline, layout).then(setPreview).catch((err) => { setPreview(null); setError(err.message) })
    }, 300)
    return () => clearTimeout(t)
  }, [JSON.stringify(outline), layout])

  const patch = (p) => setOutline((o) => ({ ...o, ...p }))
  const patchPoint = (i, p) => patch({ points: outline.points.map((x, j) => (j === i ? { ...x, ...p } : x)) })
  const movePoint = (i, d) => {
    const pts = [...outline.points]
    const j = i + d
    if (j < 0 || j >= pts.length) return
    ;[pts[i], pts[j]] = [pts[j], pts[i]]
    patch({ points: pts })
  }
  const patchStat = (i, p) => patch({ stats: outline.stats.map((x, j) => (j === i ? { ...x, ...p } : x)) })

  function onDrop(e) {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file) readFile(file)
    else {
      const dropped = e.dataTransfer.getData('text/plain')
      if (dropped) { setText(dropped); setFileInfo(null) }
    }
  }

  const chars = text.trim().length
  const tooMany = preview?.words > WORD_SOFT_LIMIT

  return (
    <div className="space-y-6">
      <Card className="p-6 space-y-4"
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}>
        <div className="flex flex-wrap items-baseline gap-3">
          <h2 className="h-display text-lg">1. tekst źródłowy</h2>
          <span className="text-xs text-muted">artykuł, notatki, oferta, fragment ebooka — z tego wybierzemy to, co zmieści się na jednej planszy</span>
        </div>

        <textarea
          rows={10}
          value={text}
          onChange={(e) => { setText(e.target.value); setFileInfo(null) }}
          placeholder={'Wklej tekst albo przeciągnij tu plik (' + accepted.join(', ') + ').\n\nNagłówki i wypunktowania pomagają: z nagłówków robią się punkty infografiki, z liczb w tekście — kafelki ze statystykami.'}
          disabled={busy === 'plik'}
          className={`${inputCls} resize-y leading-relaxed font-mono text-xs ${dragging ? 'border-cyan' : ''}`}
        />

        <div className="flex flex-wrap items-center gap-4 text-xs text-muted">
          <label className={`text-cyan underline cursor-pointer ${busy ? 'opacity-50 pointer-events-none' : ''}`}>
            {busy === 'plik' ? 'czytam plik…' : 'wybierz plik z dysku'}
            <input type="file" accept={accepted.join(',')} className="hidden"
              onChange={(e) => { if (e.target.files[0]) readFile(e.target.files[0]); e.target.value = '' }} />
          </label>
          {fileInfo && <span>plik: <span className="font-mono text-ink">{fileInfo.name}</span> · {fileInfo.chars.toLocaleString('pl-PL')} znaków</span>}
          {!fileInfo && chars > 0 && <span>{chars.toLocaleString('pl-PL')} znaków</span>}
          <span className="ml-auto">Plik zostaje na Twoim komputerze. Do dostawcy idzie tylko to, co sam wyślesz w kroku 2.</span>
        </div>

        {error && <Alert kind="error" onClose={() => setError(null)}>{error}</Alert>}

        <div className="flex flex-wrap items-center gap-3 pt-1">
          <button onClick={() => makeOutline(false)} disabled={!chars || Boolean(busy)} className="btn-primary px-5 py-2.5 text-sm flex items-center gap-2">
            {busy === 'plan' && <Spinner />} ułóż plan
          </button>
          <button onClick={() => makeOutline(true)} disabled={!chars || Boolean(busy) || !hasApiKey}
            className="rounded-full border border-line px-5 py-2.5 text-sm hover:border-cyan disabled:opacity-40 flex items-center gap-2">
            {busy === 'model' && <Spinner />} ułóż plan modelem <Badge>{config?.outlineModel}</Badge>
          </button>
          <span className="text-xs text-muted leading-relaxed max-w-md">
            „Ułóż plan” jest darmowy i działa od razu: bierze nagłówki, wypunktowania i liczby. Model czatu (na tym samym kluczu, zwykle ułamek kredytu)
            radzi sobie lepiej z długim, nieuporządkowanym tekstem.
          </span>
        </div>
      </Card>

      {outline && (
        <div ref={planRef}><Card className="p-6 space-y-5">
          <div className="flex flex-wrap items-baseline gap-3">
            <h2 className="h-display text-lg">2. plan planszy</h2>
            <span className="text-xs text-muted">popraw, skróć, wyrzuć — to trafi na obraz dosłownie</span>
            <Badge>{outline.source === 'heurystyka' ? 'z heurystyki' : outline.source === 'edytor' ? 'edytowany' : `z modelu ${outline.source}`}</Badge>
          </div>
          {note && <Alert kind="ok" onClose={() => setNote(null)}>{note}</Alert>}

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Label>Tytuł</Label>
              <input value={outline.title} onChange={(e) => patch({ title: e.target.value })} className={inputCls} maxLength={70} />
            </div>
            <div>
              <Label hint="opcjonalnie, jedno zdanie">Podtytuł</Label>
              <input value={outline.subtitle || ''} onChange={(e) => patch({ subtitle: e.target.value })} className={inputCls} maxLength={90} />
            </div>
          </div>

          <div>
            <Label hint={`od 3 do ${config?.maxPoints || 7} punktów; nagłówek do 5 słów, opis do 12 — modele gubią litery przy dłuższych`}>Punkty</Label>
            <div className="space-y-2">
              {outline.points.map((p, i) => (
                <div key={i} className="grid gap-2 md:grid-cols-[2rem_1fr_2fr_auto] items-center">
                  <span className="font-mono text-xs text-muted text-center">{i + 1}.</span>
                  <input value={p.heading} onChange={(e) => patchPoint(i, { heading: e.target.value })} placeholder="nagłówek" className={inputCls} maxLength={48} />
                  <input value={p.text || ''} onChange={(e) => patchPoint(i, { text: e.target.value })} placeholder="krótki opis (opcjonalnie)" className={inputCls} maxLength={110} />
                  <div className="flex gap-1 text-xs text-muted">
                    <button onClick={() => movePoint(i, -1)} title="w górę" className="px-1.5 hover:text-ink">↑</button>
                    <button onClick={() => movePoint(i, 1)} title="w dół" className="px-1.5 hover:text-ink">↓</button>
                    <button onClick={() => patch({ points: outline.points.filter((_, j) => j !== i) })} title="usuń" className="px-1.5 hover:text-pink">✕</button>
                  </div>
                </div>
              ))}
            </div>
            {outline.points.length < (config?.maxPoints || 7) && (
              <button onClick={() => patch({ points: [...outline.points, { heading: '', text: '' }] })} className="mt-2 text-xs text-cyan underline">dodaj punkt</button>
            )}
          </div>

          <div>
            <Label hint="liczby z tekstu w dużych kafelkach; zostaw puste, jeśli w tekście nie ma statystyk">Liczby</Label>
            <div className="space-y-2">
              {(outline.stats || []).map((s, i) => (
                <div key={i} className="grid gap-2 md:grid-cols-[8rem_1fr_auto] items-center">
                  <input value={s.value} onChange={(e) => patchStat(i, { value: e.target.value })} placeholder="73%" className={`${inputCls} font-mono`} maxLength={16} />
                  <input value={s.label} onChange={(e) => patchStat(i, { label: e.target.value })} placeholder="czego dotyczy" className={inputCls} maxLength={60} />
                  <button onClick={() => patch({ stats: outline.stats.filter((_, j) => j !== i) })} title="usuń" className="px-1.5 text-xs text-muted hover:text-pink">✕</button>
                </div>
              ))}
            </div>
            {(outline.stats || []).length < (config?.maxStats || 4) && (
              <button onClick={() => patch({ stats: [...(outline.stats || []), { value: '', label: '' }] })} className="mt-2 text-xs text-cyan underline">dodaj liczbę</button>
            )}
          </div>

          <div>
            <Label hint="układ podpowiada też format obrazu; zmienisz go w generatorze">Układ</Label>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
              {layouts.map((l) => (
                <button key={l.value} onClick={() => setLayout(l.value)}
                  className={`text-left rounded-xl border px-3 py-2.5 transition ${layout === l.value ? 'border-cyan bg-cyan/5' : 'border-line hover:border-muted/50'}`}>
                  <div className="text-sm font-semibold">{l.label}</div>
                  <div className="text-[11px] text-muted mt-0.5 leading-snug">{l.hint}</div>
                </button>
              ))}
            </div>
          </div>
        </Card></div>
      )}

      {outline && (
        <Card className="p-6 space-y-4">
          <div className="flex flex-wrap items-baseline gap-3">
            <h2 className="h-display text-lg">3. prompt</h2>
            <span className="text-xs text-muted">to pojedzie do pola „Co ma być na obrazie?” — w generatorze dołożysz styl, logo i format</span>
            {preview && (
              <Badge tone={tooMany ? 'pink' : 'default'}>{preview.words} słów na planszy</Badge>
            )}
          </div>
          {tooMany && (
            <Alert kind="warn">
              Powyżej ~{WORD_SOFT_LIMIT} słów modele obrazu zaczynają gubić litery i sklejać wyrazy. Skróć opisy albo wyrzuć punkt — tytuł i nagłówki są ważniejsze niż opisy.
            </Alert>
          )}
          <pre className="text-[11px] font-mono bg-panel-2 border border-line rounded-xl p-3 whitespace-pre-wrap leading-relaxed max-h-72 overflow-auto">
            {preview?.prompt || '…'}
          </pre>
          <div className="flex flex-wrap items-center gap-4">
            <button onClick={() => onUse({ prompt: preview.prompt, defaults: preview.defaults })} disabled={!preview} className="btn-primary px-6 py-3 text-sm">
              wstaw do generatora
            </button>
            <span className="text-xs text-muted leading-relaxed max-w-md">
              Najlepiej sprawdza się model z odznaką „napisy na grafice”. Zacznij od jakości 1K — to najtańszy test, czy tekst się składa.
            </span>
          </div>
        </Card>
      )}
    </div>
  )
}
