import { useState } from 'react'
import { api } from './api.js'
import { Alert, Badge, Card, Spinner, credits } from './ui.jsx'

const STATUS = {
  queued: { label: 'w kolejce u Ciebie', tone: 'default' },
  submitting: { label: 'wysyłam do Kie.ai', tone: 'default' },
  running: { label: 'generuję…', tone: 'cyan' },
  downloading: { label: 'zapisuję na dysk', tone: 'cyan' },
  done: { label: 'gotowe', tone: 'cyan' },
  failed: { label: 'nie udało się', tone: 'pink' },
  download_failed: { label: 'opłacone, ale niepobrane', tone: 'pink' },
  unknown: { label: 'nieznany los', tone: 'pink' },
}

const inProgress = (s) => ['queued', 'submitting', 'running', 'downloading'].includes(s)

export default function Jobs({ jobs, onChange, boards = [], onPinned, feedback = [], feedbackTags = { issues: [], praise: [] }, onVariant }) {
  const visible = jobs.filter((j) => j.status !== 'hidden')
  const active = visible.filter((j) => inProgress(j.status))
  const rest = visible.filter((j) => !inProgress(j.status))

  if (visible.length === 0) {
    return (
      <Card className="p-10 text-center">
        <p className="text-muted text-sm">Nic tu jeszcze nie ma. Wygeneruj pierwszy obraz — pojawi się tutaj i od razu wyląduje na Twoim dysku.</p>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      {active.length > 0 && (
        <div>
          <h2 className="h-display text-lg mb-3">w toku ({active.length})</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {active.map((j) => <JobTile key={j.id} job={j} onChange={onChange} boards={boards} onPinned={onPinned} fb={feedback.find((f) => f.jobId === j.id)} tags={feedbackTags} onVariant={onVariant} />)}
          </div>
        </div>
      )}
      <div>
        <div className="flex items-center gap-4 mb-3">
          <h2 className="h-display text-lg">biblioteka</h2>
          <button onClick={() => api.openFolder('library').catch(() => {})} className="text-xs text-cyan underline">otwórz folder</button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {rest.map((j) => <JobTile key={j.id} job={j} onChange={onChange} boards={boards} onPinned={onPinned} fb={feedback.find((f) => f.jobId === j.id)} tags={feedbackTags} onVariant={onVariant} />)}
        </div>
      </div>
    </div>
  )
}

function JobTile({ job, onChange, boards = [], onPinned, fb, tags, onVariant }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [pickingBoard, setPickingBoard] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [rating, setRating] = useState(null)       // null | 'good' | 'bad' — otwarty panel oceny
  const [picked, setPicked] = useState([])
  const [text, setText] = useState('')
  const status = STATUS[job.status] || { label: job.status, tone: 'default' }

  async function run(fn) {
    setBusy(true)
    setError(null)
    try {
      await fn()
      onChange()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="overflow-hidden flex flex-col">
      <div className="aspect-square bg-panel-2 flex items-center justify-center relative">
        {job.files?.[0] ? (
          <a href={api.fileLink(job.files[0])} target="_blank" rel="noreferrer" className="block w-full h-full">
            <img src={api.fileUrl(job.files[0])} alt={job.values?.prompt || 'wygenerowany obraz'} className="w-full h-full object-contain" />
          </a>
        ) : inProgress(job.status) ? (
          <div className="flex flex-col items-center gap-2 text-muted text-xs">
            <Spinner className="text-cyan" />
            {status.label}
          </div>
        ) : (
          <div className="text-4xl opacity-30">✕</div>
        )}
      </div>

      <div className="p-3 space-y-2 flex-1 flex flex-col">
        <div className="flex items-center justify-between gap-2">
          <Badge tone={status.tone}>{status.label}</Badge>
          <span className="font-mono text-[11px] text-muted">
            {job.credits != null ? `${credits(job.credits)} kr.` : `~${credits(job.creditsEstimated)} kr.`}
          </span>
        </div>

        <p className="text-xs text-muted line-clamp-3 leading-relaxed flex-1">{job.userPrompt ?? job.values?.prompt}</p>
        {job.variantOf && <Badge tone="pink">poprawka do {job.variantOf.slice(0, 8)}</Badge>}
        {(job.styleName || job.references?.length > 0) && (
          <div className="flex flex-wrap gap-1.5">
            {job.styleName && <Badge tone="cyan">styl: {job.styleName}</Badge>}
            {job.references?.length > 0 && <Badge>{job.references.length === 1 ? '1 obraz' : `${job.references.length} obrazy`}: {job.references.map((r) => r.role).join(', ')}</Badge>}
          </div>
        )}

        {job.error && <p className="text-[11px] text-pink leading-relaxed">{job.error}</p>}
        {job.overlayError && <p className="text-[11px] text-orange leading-relaxed">Logo nie zostało nałożone: {job.overlayError}</p>}
        {job.overlayPlaced?.length > 0 && <p className="text-[11px] text-muted">logo nałożone lokalnie ({job.overlayPlaced.length})</p>}
        {error && <Alert kind="error">{error}</Alert>}

        {job.status === 'done' && (
          <div className="space-y-2">
            {fb && rating === null && (
              <div className="text-[11px] text-muted">
                oceniono: <span className={fb.verdict === 'good' ? 'text-cyan' : 'text-pink'}>{fb.verdict === 'good' ? 'dobre' : 'do poprawy'}</span>
                {fb.implicit && <span className="opacity-70"> (z {fb.implicit === 'pinned' ? 'przypięcia' : 'skasowania'})</span>}
                {fb.tags?.length > 0 && <span className="opacity-70"> · {fb.tags.join(', ')}</span>}
                {fb.variantJobId && <span className="opacity-70"> · zrobiono poprawkę</span>}
              </div>
            )}
            <div className="flex flex-wrap gap-2 text-[11px]">
              <button disabled={busy} onClick={() => { setRating(rating === 'good' ? null : 'good'); setPicked([]) }}
                className={`rounded-full border px-2 py-0.5 ${rating === 'good' ? 'border-cyan text-cyan' : 'border-line text-muted hover:text-ink'}`}>👍 dobre</button>
              <button disabled={busy} onClick={() => { setRating(rating === 'bad' ? null : 'bad'); setPicked([]) }}
                className={`rounded-full border px-2 py-0.5 ${rating === 'bad' ? 'border-pink text-pink' : 'border-line text-muted hover:text-ink'}`}>co poprawić?</button>
            </div>
            {rating && (
              <div className="rounded-lg border border-line bg-panel-2/60 p-2 space-y-2">
                <div className="flex flex-wrap gap-1.5">
                  {(rating === 'good' ? tags.praise : tags.issues).map((t) => {
                    const on = picked.includes(t.value)
                    return (
                      <button key={t.value} onClick={() => setPicked((prev) => (prev.includes(t.value) ? prev.filter((v) => v !== t.value) : [...prev, t.value]))}
                        className={`rounded-full border px-2 py-0.5 text-[11px] ${on ? (rating === 'good' ? 'border-cyan text-cyan' : 'border-pink text-pink') : 'border-line text-muted'}`}>
                        {t.label}
                      </button>
                    )
                  })}
                </div>
                <input value={text} onChange={(e) => setText(e.target.value)}
                  placeholder={rating === 'good' ? 'co dokładnie zagrało? (opcjonalnie)' : 'własnymi słowami, np. „logo mniejsze, w rogu”'}
                  className="w-full rounded-lg bg-panel-2 border border-line px-2 py-1 text-[11px]" />
                {rating === 'bad' && picked.length > 0 && (
                  <p className="text-[10px] text-muted/80 leading-relaxed">
                    → do promptu: {picked.map((v) => tags.issues.find((t) => t.value === v)?.fix).filter(Boolean).join(' ')}
                  </p>
                )}
                <div className="flex flex-wrap gap-3 text-[11px]">
                  <button disabled={busy} className="underline text-muted"
                    onClick={() => run(async () => { await api.feedback(job.id, { verdict: rating, tags: picked, text }); setRating(null); setPicked([]); setText('') })}>
                    tylko zapisz ocenę
                  </button>
                  {rating === 'bad' && (
                    <button disabled={busy || (picked.length === 0 && !text.trim())} className="underline text-cyan disabled:opacity-40"
                      onClick={() => run(async () => {
                        const res = await api.variant(job.id, { tags: picked, text })
                        setRating(null); setPicked([]); setText('')
                        onVariant?.(res)
                      })}>
                      ponów z poprawką (~{credits(job.credits ?? job.creditsEstimated)} kr.)
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="flex flex-wrap gap-2 text-[11px]">
          {job.status === 'download_failed' && (
            <button disabled={busy} onClick={() => run(() => api.redownload(job.id))} className="underline text-cyan">Pobierz ponownie</button>
          )}
          {(job.status === 'failed' || job.status === 'unknown') && (
            <button disabled={busy} onClick={() => run(() => api.resend(job.id))} className="underline text-cyan">Wyślij ponownie (świadomie)</button>
          )}
          {job.files?.[0] && boards.length > 0 && (
            pickingBoard ? (
              <select
                autoFocus
                defaultValue=""
                onChange={(e) => {
                  const boardId = e.target.value
                  setPickingBoard(false)
                  if (!boardId) return
                  // Najlepsze wyniki wracają na tablicę i stają się referencją dla kolejnych.
                  run(async () => {
                    const res = await api.addPin(boardId, { fromFile: job.files[0] })
                    onPinned?.(res.duplicate)
                  })
                }}
                className="bg-panel-2 border border-line rounded-lg px-2 py-1 text-[11px]">
                <option value="">wybierz tablicę…</option>
                {boards.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            ) : (
              <button
                disabled={busy}
                onClick={() => {
                  if (boards.length === 1) {
                    return run(async () => {
                      const res = await api.addPin(boards[0].id, { fromFile: job.files[0] })
                      onPinned?.(res.duplicate)
                    })
                  }
                  setPickingBoard(true)
                }}
                className="underline text-cyan">📌 Przypnij do tablicy</button>
            )
          )}
          {!inProgress(job.status) && (
            <button disabled={busy} onClick={() => run(() => api.hide(job.id))} className="underline text-muted">Ukryj</button>
          )}
          {job.files?.[0] && !inProgress(job.status) && (
            confirmDelete ? (
              <span className="flex items-center gap-2">
                <button disabled={busy} onClick={() => run(() => api.deleteFile(job.id))} className="underline text-pink">na pewno usuń z dysku</button>
                <button onClick={() => setConfirmDelete(false)} className="underline text-muted">nie</button>
              </span>
            ) : (
              <button disabled={busy} onClick={() => setConfirmDelete(true)} className="underline text-muted hover:text-pink">Usuń z dysku</button>
            )
          )}
          {job.files?.[0] && (
            <span className="font-mono text-muted/70 truncate" title={job.files[0]}>{job.files[0].split('/').slice(-2).join('/')}</span>
          )}
        </div>
      </div>
    </Card>
  )
}
