import { useEffect, useMemo, useState } from 'react'
import { api } from './api.js'
import Field from './Field.jsx'
import { Alert, Badge, Card, Spinner, credits } from './ui.jsx'

/** Ekran generowania: wybór modelu, formularz z manifestu, cena na przycisku. */
export default function Generator({ models, calibrationTick, onQueued }) {
  const usable = models.filter((m) => m.kind === 't2i')
  const [modelId, setModelId] = useState(() => (models.find((m) => m.recommended && m.kind === 't2i') || usable[0])?.id)
  const model = models.find((m) => m.id === modelId)
  const [values, setValues] = useState(() => ({ ...model?.defaults }))
  const [price, setPrice] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [showAdvanced, setShowAdvanced] = useState(false)

  useEffect(() => {
    setValues({ ...model?.defaults })
    setError(null)
  }, [modelId])

  // Cena odświeża się 300 ms po ostatniej zmianie parametru.
  useEffect(() => {
    if (!model) return
    const t = setTimeout(() => {
      api.price(model.id, values).then(setPrice).catch(() => setPrice(null))
    }, 300)
    return () => clearTimeout(t)
  }, [modelId, values.resolution, values.count, calibrationTick])

  const fields = useMemo(() => model?.fields ?? [], [model])
  const basic = fields.filter((f) => !f.advanced)
  const advanced = fields.filter((f) => f.advanced)
  const ready = Boolean(values.prompt?.trim())

  async function generate() {
    setBusy(true)
    setError(null)
    try {
      const res = await api.generate(model.id, values)
      onQueued(res.jobs)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  if (!model) return null

  return (
    <div className="grid gap-6 lg:grid-cols-[22rem_1fr] items-start">
      <Card className="p-4">
        <h2 className="h-display text-lg mb-3">model</h2>
        <div className="space-y-2">
          {usable.map((m) => (
            <button
              key={m.id}
              onClick={() => setModelId(m.id)}
              className={`w-full text-left rounded-xl border px-4 py-3 transition ${
                m.id === modelId ? 'border-cyan bg-cyan/5' : 'border-line hover:border-muted/50'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sm">{m.title}</span>
                {m.recommended && <Badge tone="cyan">polecany</Badge>}
              </div>
              <p className="text-xs text-muted mt-1 leading-relaxed">{m.subtitle}</p>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {m.badges?.map((b) => <Badge key={b}>{b}</Badge>)}
              </div>
            </button>
          ))}
        </div>
        <p className="text-xs text-muted mt-4 leading-relaxed">
          Modele „z inspiracji” (do 16 obrazów referencyjnych) włączą się razem z Tablicami.
        </p>
      </Card>

      <Card className="p-6">
        <div className="space-y-5">
          {basic.map((f) => (
            <Field key={f.name} field={f} value={values[f.name]} onChange={(v) => setValues((s) => ({ ...s, [f.name]: v }))} disabled={busy} />
          ))}

          {advanced.length > 0 && (
            <div>
              <button onClick={() => setShowAdvanced((v) => !v)} className="text-xs text-muted underline">
                {showAdvanced ? 'ukryj ustawienia zaawansowane' : 'ustawienia zaawansowane'}
              </button>
              {showAdvanced && (
                <div className="mt-4 space-y-5">
                  {advanced.map((f) => (
                    <Field key={f.name} field={f} value={values[f.name]} onChange={(v) => setValues((s) => ({ ...s, [f.name]: v }))} disabled={busy} />
                  ))}
                </div>
              )}
            </div>
          )}

          {error && <Alert kind="error">{error}</Alert>}

          <div className="flex flex-wrap items-center gap-4 pt-1">
            <button onClick={generate} disabled={!ready || busy} className="btn-primary px-6 py-3 flex items-center gap-2">
              {busy && <Spinner />}
              {busy ? 'wysyłam…' : 'generuj'}
              {price?.credits != null && (
                <span className="font-mono text-sm opacity-80">· {credits(price.credits)} kr.</span>
              )}
            </button>

            <div className="text-xs text-muted leading-relaxed">
              {price?.credits != null ? (
                <>
                  {price.count > 1 && <>{price.count} × {credits(price.perImage)} = {credits(price.credits)} kredytów. </>}
                  {price.estimated
                    ? <span className="text-orange">Cena orientacyjna — dokładną poznamy po pierwszej generacji w tej jakości.</span>
                    : price.source === 'twoje-generacje'
                      ? <span>Cena policzona z Twoich wcześniejszych generacji, więc realna.</span>
                      : <span>Cena sprawdzona w praktyce dla tego modelu.</span>}
                </>
              ) : 'Cena pojawi się po wybraniu jakości.'}
              <br />
              Zwykle trwa to około {Math.round((model.typicalSeconds || 60) / 5) * 5} sekund.
            </div>
          </div>
        </div>
      </Card>
    </div>
  )
}
