import { useCallback, useEffect, useState } from 'react'
import { api } from './api.js'
import { prepareImage, urlFromDataTransfer } from './image.js'
import { Alert, Badge, Card, Spinner } from './ui.jsx'

/**
 * Tablica inspiracji. Cztery sposoby dodawania: przeciągnięcie plików,
 * Cmd/Ctrl+V, przeciągnięcie obrazka z innej karty i wklejenie linku.
 */
export default function Boards({ boards, activeId, onActiveChange, onChanged, onGenerate }) {
  const board = boards.find((b) => b.id === activeId) || boards[0]
  const [selected, setSelected] = useState(() => new Set())
  const [busy, setBusy] = useState(0)
  const [error, setError] = useState(null)
  const [info, setInfo] = useState(null)
  const [dragging, setDragging] = useState(false)
  const [link, setLink] = useState('')
  const [newBoardName, setNewBoardName] = useState(null)   // null = formularz schowany
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => { setSelected(new Set()); setConfirmDelete(false) }, [board?.id])

  const addFiles = useCallback(async (files) => {
    if (!board) return
    setError(null)
    let duplicates = 0
    for (const file of files) {
      setBusy((n) => n + 1)
      try {
        const prepared = await prepareImage(file)
        const res = await api.addPin(board.id, prepared)
        if (res.duplicate) duplicates++
      } catch (err) {
        setError(err.message)
      } finally {
        setBusy((n) => n - 1)
      }
    }
    if (duplicates) setInfo(`${duplicates === 1 ? 'Ten obraz już był' : `${duplicates} obrazy już były`} na tablicy — nie dodaję drugi raz.`)
    onChanged()
  }, [board, onChanged])

  const addUrl = useCallback(async (url) => {
    if (!board || !url) return
    setError(null)
    setBusy((n) => n + 1)
    try {
      await api.addPin(board.id, { url })
      setLink('')
      onChanged()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy((n) => n - 1)
    }
  }, [board, onChanged])

  // Cmd/Ctrl+V działa wszędzie na tym ekranie, nie tylko w polu tekstowym.
  useEffect(() => {
    const onPaste = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
      const files = [...(e.clipboardData?.files || [])]
      if (files.length) { e.preventDefault(); addFiles(files); return }
      const text = e.clipboardData?.getData('text')
      if (text && /^https?:\/\//i.test(text.trim())) { e.preventDefault(); addUrl(text.trim()) }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [addFiles, addUrl])

  function onDrop(e) {
    e.preventDefault()
    setDragging(false)
    const files = [...(e.dataTransfer?.files || [])].filter((f) => f.type.startsWith('image/'))
    if (files.length) return addFiles(files)
    const url = urlFromDataTransfer(e.dataTransfer)
    if (url) return addUrl(url)
    setError('Nie rozpoznałem, co zostało upuszczone. Spróbuj przeciągnąć plik z pulpitu albo wklej link do obrazka.')
  }

  function toggle(pinId) {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(pinId) ? next.delete(pinId) : next.add(pinId)
      return next
    })
  }

  async function removePin(pinId) {
    await api.deletePin(pinId).catch((err) => setError(err.message))
    setSelected((prev) => { const n = new Set(prev); n.delete(pinId); return n })
    onChanged()
  }

  if (!board) return null
  const pins = board.pins || []
  const chosen = pins.filter((p) => selected.has(p.id))

  return (
    <div
      className="space-y-5"
      onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <div className="flex flex-wrap items-center gap-2">
        {boards.map((b) => (
          <button key={b.id} onClick={() => onActiveChange(b.id)}
            className={`px-3 py-1.5 rounded-full text-sm transition ${b.id === board.id ? 'bg-cyan/10 text-cyan' : 'text-muted hover:text-ink'}`}>
            {b.name} <span className="font-mono text-[11px] opacity-60">{b.pins.length}</span>
          </button>
        ))}
        {newBoardName === null ? (
          <button onClick={() => setNewBoardName('')}
            className="px-3 py-1.5 rounded-full text-sm text-muted hover:text-ink border border-line">+ nowa tablica</button>
        ) : (
          <form
            className="flex items-center gap-2"
            onSubmit={async (e) => {
              e.preventDefault()
              const name = newBoardName.trim()
              if (!name) return setNewBoardName(null)
              const res = await api.createBoard(name)
              setNewBoardName(null)
              onChanged()
              onActiveChange(res.board.id)
            }}
          >
            <input autoFocus value={newBoardName} onChange={(e) => setNewBoardName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') setNewBoardName(null) }}
              placeholder="np. Kampania jesień" id="new-board" name="new-board"
              className="rounded-full bg-panel-2 border border-line px-3 py-1.5 text-sm w-44" />
            <button type="submit" className="text-sm text-cyan underline">dodaj</button>
            <button type="button" onClick={() => setNewBoardName(null)} className="text-xs text-muted underline">anuluj</button>
          </form>
        )}
        {boards.length > 1 && (
          <div className="ml-auto flex items-center gap-2">
            {confirmDelete ? (
              <>
                <span className="text-xs text-muted">Usunąć „{board.name}” ze wszystkimi inspiracjami?</span>
                <button
                  onClick={async () => {
                    setConfirmDelete(false)
                    await api.deleteBoard(board.id)
                    onChanged()
                    onActiveChange(boards.find((b) => b.id !== board.id)?.id)
                  }}
                  className="text-xs text-pink underline">tak, usuń</button>
                <button onClick={() => setConfirmDelete(false)} className="text-xs text-muted underline">nie</button>
              </>
            ) : (
              <button onClick={() => setConfirmDelete(true)} className="text-xs text-muted hover:text-pink underline">usuń tę tablicę</button>
            )}
          </div>
        )}
      </div>

      <Card className={`p-5 transition ${dragging ? 'border-cyan bg-cyan/5' : ''}`}>
        <div className="flex flex-wrap items-center gap-3">
          <label className="btn-primary px-4 py-2 text-sm cursor-pointer">
            dodaj pliki
            <input id="board-files" name="board-files" type="file" accept="image/*" multiple className="sr-only"
              onChange={(e) => { addFiles([...e.target.files]); e.target.value = '' }} />
          </label>
          <span className="text-xs text-muted">albo przeciągnij tu pliki, wciśnij <span className="font-mono">Cmd/Ctrl+V</span>, albo przeciągnij obrazek z innej karty</span>
          <div className="flex gap-2 ml-auto">
            <input value={link} onChange={(e) => setLink(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addUrl(link.trim()) }}
              placeholder="wklej link do obrazka" id="pin-url" name="pin-url"
              className="rounded-xl bg-panel-2 border border-line px-3 py-2 text-sm w-56" />
            <button onClick={() => addUrl(link.trim())} disabled={!link.trim()}
              className="text-sm text-cyan underline disabled:opacity-40">dodaj</button>
          </div>
          {busy > 0 && <Spinner className="text-cyan" />}
        </div>
        <p className="text-[11px] text-muted mt-3 leading-relaxed">
          Inspiracje zostają na Twoim dysku. Do Kie.ai trafiają tylko te, których użyjesz w generacji — i dopiero w momencie kliknięcia „generuj”.
          Inspiruj się stylem i klimatem, nie kopiuj cudzych prac.
        </p>
      </Card>

      {error && <Alert kind="error" onClose={() => setError(null)}>{error}</Alert>}
      {info && <Alert kind="info" onClose={() => setInfo(null)}>{info}</Alert>}

      {pins.length === 0 ? (
        <Card className="p-12 text-center">
          <p className="text-muted text-sm leading-relaxed">
            Pusta tablica. Wrzuć kilka obrazów, które mają podobny klimat — światło, kolory, kadr.<br />
            Potem zaznaczysz 3–4 z nich i klikniesz „generuj w tym klimacie”.
          </p>
        </Card>
      ) : (
        <div className="columns-2 md:columns-3 lg:columns-4 gap-3 [column-fill:_balance]">
          {pins.map((pin) => (
            <Pin key={pin.id} pin={pin} selected={selected.has(pin.id)} onToggle={() => toggle(pin.id)}
              onRemove={() => removePin(pin.id)} onNote={onChanged} />
          ))}
        </div>
      )}

      {/* Dwa przyciski, bo to są dwie różne prośby. „W tym klimacie” bierze z obrazów
          nastrój i kolory, a resztę wymyśla od nowa — i to jest dobre, gdy chcesz czegoś
          innego w podobnej atmosferze. „Kolejny projekt w tym stylu” odtwarza typografię,
          układ i efekty, czyli to, czego oczekuje ktoś, kto wrzucił trzy swoje miniatury.
          Jeden przycisk oznaczał, że druga prośba w ogóle nie miała jak dojść do modelu. */}
      {chosen.length > 0 && (
        <div className="sticky bottom-4 z-10">
          <Card className="p-4 border-cyan/40 bg-panel-2/95 backdrop-blur space-y-3">
            <div className="flex flex-wrap items-center gap-4">
              <span className="text-sm">
                Zaznaczone: <span className="font-mono text-cyan">{chosen.length}</span>
                {chosen.length > 6 && <span className="text-orange text-xs ml-2">mniej, ale spójnych referencji daje lepszy efekt</span>}
              </span>
              <button onClick={() => setSelected(new Set())} className="text-xs text-muted underline">odznacz wszystkie</button>
              <div className="ml-auto flex flex-wrap items-center gap-2">
                <button onClick={() => onGenerate(chosen, 'inspiracja')}
                  className="rounded-full border border-line px-4 py-2.5 text-sm text-muted hover:text-ink hover:border-muted/50 transition">
                  zainspiruj się
                </button>
                <button onClick={() => onGenerate(chosen, 'styl')} className="btn-primary px-5 py-2.5">
                  kolejny projekt w tym stylu
                </button>
              </div>
            </div>
            <p className="text-[11px] text-muted leading-relaxed">
              <b className="text-ink">Kolejny projekt w tym stylu</b> — model odtwarza typografię, układ, kolory i efekty
              z tych obrazów, a zmienia treść zgodnie z Twoim opisem. <b className="text-ink">Zainspiruj się</b> — bierze
              tylko klimat i kolory, resztę komponuje od nowa. Rolę każdego obrazu zobaczysz i poprawisz w generatorze.
            </p>
          </Card>
        </div>
      )}
    </div>
  )
}

function Pin({ pin, selected, onToggle, onRemove, onNote }) {
  const [note, setNote] = useState(pin.note || '')
  const [editing, setEditing] = useState(false)

  return (
    <div className={`mb-3 break-inside-avoid rounded-xl overflow-hidden border transition ${selected ? 'border-cyan ring-2 ring-cyan/30' : 'border-line'}`}>
      <button onClick={onToggle} className="block w-full relative group">
        <img src={api.fileUrl(pin.file)} alt={pin.note || pin.name} className="w-full block"
          width={pin.width || undefined} height={pin.height || undefined} loading="lazy" />
        <span className={`absolute top-2 left-2 w-6 h-6 rounded-full border flex items-center justify-center text-xs ${
          selected ? 'bg-cyan text-void border-cyan' : 'bg-void/70 border-line text-transparent group-hover:text-muted'}`}>✓</span>
      </button>
      <div className="p-2 bg-panel space-y-1">
        {editing ? (
          <input
            autoFocus value={note} onChange={(e) => setNote(e.target.value)}
            onBlur={async () => { setEditing(false); await api.updatePin(pin.id, { note }); onNote() }}
            onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur() }}
            placeholder="np. podoba mi się światło, nie kolory"
            className="w-full bg-panel-2 border border-line rounded-lg px-2 py-1 text-[11px]" />
        ) : (
          <button onClick={() => setEditing(true)} className="text-[11px] text-muted hover:text-ink text-left w-full truncate">
            {note || 'dodaj notatkę'}
          </button>
        )}
        <div className="flex items-center justify-between">
          {pin.sourceUrl ? <Badge>z sieci</Badge> : <Badge>z dysku</Badge>}
          <button onClick={onRemove} className="text-[11px] text-muted hover:text-pink">usuń</button>
        </div>
      </div>
    </div>
  )
}
