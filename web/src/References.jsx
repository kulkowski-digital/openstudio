import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api.js'
import { prepareImage, urlFromDataTransfer } from './image.js'
import { Alert, Spinner } from './ui.jsx'

/**
 * Obrazy biorące udział w generacji: z tablicy albo wrzucone tu i teraz
 * (Twoje zdjęcie, logo, produkt). Każdy ma rolę — i to ona mówi modelowi,
 * co ma z tym plikiem zrobić. Kolejność na liście = kolejność w prompcie.
 */
export default function References({ refs, onChange, roles, maxRefs, styleRefsCount = 0, disabled }) {
  const [busy, setBusy] = useState(0)
  const [error, setError] = useState(null)
  const [dragging, setDragging] = useState(false)
  const fileInput = useRef(null)

  const used = refs.slice(0, maxRefs)
  const extra = refs.slice(maxRefs)

  const addFiles = useCallback(async (files) => {
    setError(null)
    const added = []
    for (const file of files) {
      setBusy((n) => n + 1)
      try {
        const prepared = await prepareImage(file)
        const res = await api.upload(prepared)
        added.push({ pin: res.pin, role: guessRole(file.name), note: '' })
      } catch (err) {
        setError(err.message)
      } finally {
        setBusy((n) => n - 1)
      }
    }
    if (added.length) onChange([...refs, ...added.filter((a) => !refs.some((r) => r.pin.id === a.pin.id))])
  }, [refs, onChange])

  const addUrl = useCallback(async (url) => {
    setError(null)
    setBusy((n) => n + 1)
    try {
      const res = await api.upload({ url })
      if (!refs.some((r) => r.pin.id === res.pin.id)) onChange([...refs, { pin: res.pin, role: 'inspiracja', note: '' }])
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy((n) => n - 1)
    }
  }, [refs, onChange])

  // Cmd/Ctrl+V działa na całym ekranie generatora.
  useEffect(() => {
    const onPaste = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
      const files = [...(e.clipboardData?.files || [])]
      if (files.length) { e.preventDefault(); addFiles(files) }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [addFiles])

  function onDrop(e) {
    e.preventDefault()
    setDragging(false)
    const files = [...(e.dataTransfer?.files || [])].filter((f) => f.type.startsWith('image/'))
    if (files.length) return addFiles(files)
    const url = urlFromDataTransfer(e.dataTransfer)
    if (url) return addUrl(url)
  }

  const update = (pinId, patch) => onChange(refs.map((r) => (r.pin.id === pinId ? { ...r, ...patch } : r)))
  const remove = (pinId) => onChange(refs.filter((r) => r.pin.id !== pinId))
  const move = (i, dir) => {
    const j = i + dir
    if (j < 0 || j >= refs.length) return
    const next = [...refs]
    ;[next[i], next[j]] = [next[j], next[i]]
    onChange(next)
  }

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={`rounded-xl border transition ${dragging ? 'border-cyan bg-cyan/5' : 'border-line'} p-4 space-y-3`}
    >
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-semibold">Obrazy do tej generacji</span>
        <span className="text-xs text-muted font-mono">{used.length}{styleRefsCount ? `+${styleRefsCount} ze stylu` : ''}/{maxRefs}</span>
        <div className="ml-auto flex items-center gap-3">
          {busy > 0 && <Spinner className="text-cyan" />}
          <button type="button" disabled={disabled} onClick={() => fileInput.current?.click()} className="text-xs text-cyan underline">dodaj własny plik</button>
          <input ref={fileInput} type="file" accept="image/*" multiple className="hidden"
            onChange={(e) => { addFiles([...e.target.files]); e.target.value = '' }} />
        </div>
      </div>

      {refs.length === 0 ? (
        <p className="text-xs text-muted leading-relaxed">
          Wrzuć tu swoje zdjęcie, logo albo produkt (przeciągnij, <span className="font-mono">Cmd/Ctrl+V</span> albo „dodaj własny plik”),
          albo zaznacz inspiracje na <span className="text-cyan">tablicach</span> i kliknij „generuj w tym klimacie”.
          Każdemu obrazowi nadasz rolę — model dostanie w prompcie, co ma z nim zrobić.
        </p>
      ) : (
        <ol className="space-y-2">
          {refs.map((ref, i) => {
            const role = roles.find((r) => r.value === ref.role)
            const skipped = i >= maxRefs
            return (
              <li key={ref.pin.id} className={`flex gap-3 items-start rounded-lg border border-line bg-panel-2/60 p-2 ${skipped ? 'opacity-40' : ''}`}>
                <div className="flex flex-col items-center gap-1">
                  <span className="font-mono text-[11px] text-muted">{i + 1}</span>
                  <img src={api.fileUrl(ref.pin.file)} alt={ref.pin.name} className="w-16 h-16 rounded-md object-cover border border-line" />
                  <div className="flex gap-1">
                    <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="text-[11px] text-muted disabled:opacity-30" title="wyżej">↑</button>
                    <button type="button" onClick={() => move(i, 1)} disabled={i === refs.length - 1} className="text-[11px] text-muted disabled:opacity-30" title="niżej">↓</button>
                  </div>
                </div>
                <div className="flex-1 space-y-1.5 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <select value={ref.role} disabled={disabled} onChange={(e) => update(ref.pin.id, { role: e.target.value })}
                      className="rounded-lg bg-panel-2 border border-line px-2 py-1 text-xs">
                      {roles.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                    </select>
                    <span className="text-[11px] text-muted">{role?.hint}</span>
                    <button type="button" onClick={() => remove(ref.pin.id)} className="ml-auto text-[11px] text-muted hover:text-pink">usuń</button>
                  </div>
                  <input
                    value={ref.note}
                    disabled={disabled}
                    onChange={(e) => update(ref.pin.id, { note: e.target.value })}
                    placeholder={ref.role === 'wlasne' ? 'co model ma z tym zrobić? (wymagane)' : 'dodatkowa uwaga, np. „w czarnej bluzie” (opcjonalnie)'}
                    className={`w-full rounded-lg bg-panel-2 border px-2 py-1 text-xs ${ref.role === 'wlasne' && !ref.note.trim() ? 'border-pink/60' : 'border-line'}`} />
                  {role?.prompt && (
                    <p className="text-[11px] text-muted/80 leading-relaxed">→ w prompcie: „{role.prompt}”</p>
                  )}
                </div>
              </li>
            )
          })}
        </ol>
      )}

      {extra.length > 0 && (
        <p className="text-xs text-orange leading-relaxed">
          Ten model przyjmie {maxRefs} obrazów — {extra.length === 1 ? 'ostatni zostanie pominięty' : `ostatnie ${extra.length} zostaną pominięte`}. Usuń te, na których Ci mniej zależy, albo zmień kolejność strzałkami.
        </p>
      )}
      {error && <Alert kind="error" onClose={() => setError(null)}>{error}</Alert>}
      <p className="text-[11px] text-muted leading-relaxed">
        Pliki wrzucone tutaj trafiają na tablicę „Moje pliki”, żebyś mógł ich użyć ponownie. Do dostawcy idą dopiero przy kliknięciu „generuj”.
      </p>
    </div>
  )
}

/** Zgadujemy rolę po nazwie pliku; użytkownik i tak może ją zmienić jednym kliknięciem. */
function guessRole(name = '') {
  const n = name.toLowerCase()
  if (/logo|znak|brand/.test(n)) return 'logo'
  if (/produkt|product|sku|packshot/.test(n)) return 'produkt'
  if (/portret|selfie|avatar/.test(n)) return 'osoba'
  return 'inspiracja'
}
