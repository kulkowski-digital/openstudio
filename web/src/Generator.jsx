import { useEffect, useMemo, useState } from 'react'
import { api } from './api.js'
import Field from './Field.jsx'
import { Alert, Badge, Card, Spinner, credits } from './ui.jsx'

/** Ekran generowania: wybór modelu, formularz z manifestu, cena na przycisku. */
export default function Generator({ models, calibrationTick, onQueued, pins = [], onPinsChange, preferredModelId }) {
  const usable = models
  const [modelId, setModelId] = useState(() => preferredModelId || (models.find((m) => m.recommended && m.kind === 't2i') || usable[0])?.id)
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

  // Wybór inspiracji na tablicy przełącza na model, który je przyjmie.
  useEffect(() => {
    if (preferredModelId && preferredModelId !== modelId) setModelId(preferredModelId)
  }, [preferredModelId])

  // Cena odświeża się 300 ms po ostatniej zmianie parametru.
  useEffect(() => {
    if (!model) return
    const t = setTimeout(() => {
      api.price(model.id, values).then(setPrice).catch(() => setPrice(null))
    }, 300)
    return () => clearTimeout(t)
  }, [modelId, values.resolution, values.count, calibrationTick])

  const fields = useMemo(() => model?.fields ?? [], [model])
  // Pole „images” obsługujemy osobno — inspiracje przychodzą z tablicy, nie z formularza.
  const basic = fields.filter((f) => !f.advanced && f.type !== 'images')
  const advanced = fields.filter((f) => f.advanced && f.type !== 'images')
  const maxRefs = model?.refs?.max ?? 0
  const needsPins = maxRefs > 0
  const usedPins = pins.slice(0, maxRefs)
  const extraPins = pins.slice(maxRefs)
  const ready = Boolean(values.prompt?.trim()) && (!needsPins || usedPins.length > 0)

  async function generate() {
    setBusy(true)
    setError(null)
    try {
      const res = await api.generate(model.id, values, needsPins ? usedPins.map((p) => p.id) : undefined)
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
                {m.refs?.max > 0 && <Badge tone="pink">wymaga inspiracji</Badge>}
              </div>
            </button>
          ))}
        </div>
        <p className="text-xs text-muted mt-4 leading-relaxed">
          Modele „z inspiracji” biorą obrazy zaznaczone na Tablicach i robią z nich punkt wyjścia.
        </p>
      </Card>

      <Card className="p-6">
        <div className="space-y-5">
          {needsPins && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-semibold">Inspiracje z tablicy</span>
                <span className="text-xs text-muted font-mono">{usedPins.length}/{maxRefs}</span>
              </div>
              {usedPins.length === 0 ? (
                <div className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-muted">
                  Ten model pracuje na Twoich obrazach. Wejdź na <span className="text-cyan">tablice</span>,
                  zaznacz 3–4 inspiracje i kliknij „generuj w tym klimacie”.
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {usedPins.map((p) => (
                    <div key={p.id} className="relative w-20 h-20 rounded-lg overflow-hidden border border-line">
                      <img src={api.fileUrl(p.file)} alt={p.note || p.name} className="w-full h-full object-cover" />
                      <button onClick={() => onPinsChange(pins.filter((x) => x.id !== p.id))}
                        className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-void/80 text-[11px] text-muted hover:text-pink">×</button>
                    </div>
                  ))}
                </div>
              )}
              {extraPins.length > 0 && (
                <p className="text-xs text-orange mt-2 leading-relaxed">
                  Zaznaczyłeś {pins.length} inspiracji, a ten model przyjmie {maxRefs}. Wezmę pierwsze {maxRefs} —
                  usuń te, na których Ci mniej zależy, albo wybierz model z wyższym limitem.
                </p>
              )}
            </div>
          )}

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
              {busy ? 'wysyłam…' : needsPins ? 'generuj w tym klimacie' : 'generuj'}
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
