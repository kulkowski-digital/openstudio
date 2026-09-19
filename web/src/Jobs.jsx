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

export default function Jobs({ jobs, onChange, boards = [], onPinned }) {
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
            {active.map((j) => <JobTile key={j.id} job={j} onChange={onChange} boards={boards} onPinned={onPinned} />)}
          </div>
        </div>
      )}
      <div>
        <div className="flex items-center gap-4 mb-3">
          <h2 className="h-display text-lg">biblioteka</h2>
          <button onClick={() => api.openFolder('library').catch(() => {})} className="text-xs text-cyan underline">otwórz folder</button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {rest.map((j) => <JobTile key={j.id} job={j} onChange={onChange} boards={boards} onPinned={onPinned} />)}
        </div>
      </div>
    </div>
  )
}

function JobTile({ job, onChange, boards = [], onPinned }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [pickingBoard, setPickingBoard] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
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
        {(job.styleName || job.references?.length > 0) && (
          <div className="flex flex-wrap gap-1.5">
            {job.styleName && <Badge tone="cyan">styl: {job.styleName}</Badge>}
            {job.references?.length > 0 && <Badge>{job.references.length === 1 ? '1 obraz' : `${job.references.length} obrazy`}: {job.references.map((r) => r.role).join(', ')}</Badge>}
          </div>
        )}

        {job.error && <p className="text-[11px] text-pink leading-relaxed">{job.error}</p>}
        {error && <Alert kind="error">{error}</Alert>}

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
