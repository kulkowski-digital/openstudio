import { useEffect, useMemo, useState } from 'react'
import { api } from './api.js'
import Field from './Field.jsx'
import References from './References.jsx'
import { Alert, Badge, Card, Spinner, credits } from './ui.jsx'

/** Ekran generowania: wybór modelu, obrazy z rolami, formularz z manifestu, cena na przycisku. */
export default function Generator({
  models, calibrationTick, onQueued, refs = [], onRefsChange, preferredModelId,
  styles = [], styleId, onStyleChange, roles = [], boards = [], overlay, seed = null,
}) {
  const [modelId, setModelId] = useState(() => preferredModelId || (models.find((m) => m.recommended && m.kind === 't2i') || models[0])?.id)
  const model = models.find((m) => m.id === modelId)
  const [values, setValues] = useState(() => ({ ...model?.defaults }))
  const [price, setPrice] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [note, setNote] = useState(null)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [fullPrompt, setFullPrompt] = useState(null)
  const [showPrompt, setShowPrompt] = useState(false)
  const style = styles.find((s) => s.id === styleId) || null

  // Zmiana modelu nie kasuje tego, co użytkownik już wpisał: prompt, format
  // i jakość zostają, o ile nowy model je zna. Nowe pola dostają domyślne.
  useEffect(() => {
    if (!model) return
    setValues((prev) => {
      const next = { ...model.defaults }
      for (const f of model.fields) {
        const old = prev[f.name]
        if (old === undefined || old === '') continue
        if (f.type === 'select' && !f.options.some((o) => o.value === old)) continue
        next[f.name] = old
      }
      return next
    })
    setError(null)
  }, [modelId])

  // Wybór inspiracji na tablicy przełącza na model, który je przyjmie.
  useEffect(() => {
    if (preferredModelId && preferredModelId !== modelId) setModelId(preferredModelId)
  }, [preferredModelId])

  // Domyślne ustawienia stylu wchodzą przy jego włączeniu — po ewentualnej
  // zmianie modelu, żeby ta zmiana ich nie nadpisała.
  useEffect(() => {
    if (!style) return
    const d = style.defaults || {}
    if (d.modelId && models.some((m) => m.id === d.modelId)) setModelId(d.modelId)
    const apply = () => setValues((v) => ({
      ...v,
      ...(d.aspect_ratio ? { aspect_ratio: d.aspect_ratio } : {}),
      ...(d.resolution ? { resolution: d.resolution } : {}),
    }))
    const t = setTimeout(apply, 0)
    return () => clearTimeout(t)
  }, [styleId])

  // Prompt z zakładki „infografika”: wchodzi do pola, format z układu tylko
  // gdy model go zna. Gdy wybrany jest model „z inspiracji” bez obrazów,
  // przełączamy na polecany model z tekstu — ten składa napisy.
  useEffect(() => {
    if (!seed?.nonce) return
    const hasModelRefs = refs.some((r) => !roles.find((x) => x.value === r.role)?.overlay)
    let target = model
    if (model?.refs?.max > 0 && !hasModelRefs) {
      target = models.find((m) => m.kind === 't2i' && m.recommended) || models.find((m) => m.kind === 't2i') || model
      if (target && target.id !== modelId) setModelId(target.id)
    }
    const ratioField = target?.fields?.find((f) => f.name === 'aspect_ratio')
    const ratio = seed.defaults?.aspect_ratio
    const ratioOk = ratio && ratioField?.options?.some((o) => o.value === ratio)
    // Po zmianie modelu wartości i tak przechodzą przez efekt wyżej, który zachowuje prompt i format.
    setTimeout(() => setValues((v) => ({ ...v, prompt: seed.prompt, ...(ratioOk ? { aspect_ratio: ratio } : {}) })), 0)
    setError(null)
  }, [seed?.nonce])

  const maxRefs = model?.refs?.max ?? 0
  const acceptsImages = maxRefs > 0
  const isOverlay = (r) => roles.find((x) => x.value === r.role)?.overlay
  const overlayRefs = refs.filter(isOverlay)
  const modelRefs = refs.filter((r) => !isOverlay(r))
  const usedRefs = modelRefs.slice(0, maxRefs)
  const refPayload = [
    ...usedRefs.map((r) => ({ pinId: r.pin.id, role: r.role, note: r.note })),
    ...overlayRefs.map((r) => ({ pinId: r.pin.id, role: r.role, overlay: r.overlay || overlay?.defaults })),
  ]
  const styleRefsAlive = (style?.referencePinIds || []).filter((id) => boards.some((b) => b.pins.some((p) => p.id === id)) && !usedRefs.some((r) => r.pin.id === id))
  const styleRefsCount = acceptsImages ? Math.max(0, Math.min(styleRefsAlive.length, maxRefs - usedRefs.length)) : 0

  // Podgląd pełnego promptu liczy serwer — tym samym kodem, którym składa go do wysyłki.
  useEffect(() => {
    if (!showPrompt) return
    const t = setTimeout(() => {
      api.promptPreview(values.prompt || '', styleId || null, refPayload, modelId)
        .then((r) => setFullPrompt(r.prompt)).catch(() => setFullPrompt(null))
    }, 250)
    return () => clearTimeout(t)
  }, [showPrompt, values.prompt, styleId, modelId, JSON.stringify(refPayload)])

  // Cena odświeża się 300 ms po ostatniej zmianie parametru.
  useEffect(() => {
    if (!model) return
    const t = setTimeout(() => {
      api.price(model.id, values).then(setPrice).catch(() => setPrice(null))
    }, 300)
    return () => clearTimeout(t)
  }, [modelId, values.resolution, values.count, calibrationTick])

  const fields = useMemo(() => model?.fields ?? [], [model])
  const basic = fields.filter((f) => !f.advanced && f.type !== 'images')
  const advanced = fields.filter((f) => f.advanced && f.type !== 'images')

  const missingOwnInstruction = usedRefs.some((r) => r.role === 'wlasne' && !r.note.trim())
  const hasImages = usedRefs.length > 0 || styleRefsCount > 0
  const ready = Boolean(values.prompt?.trim()) && (!acceptsImages || hasImages) && !missingOwnInstruction
  const i2iModel = models.find((m) => m.kind === 'i2i' && m.recommended) || models.find((m) => m.kind === 'i2i')

  async function generate() {
    setBusy(true)
    setError(null)
    setNote(null)
    try {
      const res = await api.generate(model.id, values, acceptsImages ? refPayload : refPayload.filter((r) => roles.find((x) => x.value === r.role)?.overlay), styleId || undefined)
      if (res.note) setNote(res.note)
      onQueued(res.jobs, res.note)
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
          {models.map((m) => (
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
                {m.refs?.max > 0 && <Badge tone="pink">pracuje na obrazach</Badge>}
              </div>
            </button>
          ))}
        </div>
        <p className="text-xs text-muted mt-4 leading-relaxed">
          Modele „z inspiracji” biorą Twoje obrazy — z tablic albo wrzucone wprost — i robią z nich punkt wyjścia.
        </p>
      </Card>

      <Card className="p-6">
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-3 pb-4 border-b border-line">
            <span className="text-sm font-semibold">Styl</span>
            <select
              value={styleId || ''}
              onChange={(e) => onStyleChange(e.target.value || null)}
              className="rounded-xl bg-panel-2 border border-line px-3 py-2 text-sm">
              <option value="">bez stylu</option>
              {styles.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            {style?.palette?.length > 0 && (
              <div className="flex rounded-md overflow-hidden h-5">
                {style.palette.map((hex) => <div key={hex} className="w-5" style={{ background: hex }} />)}
              </div>
            )}
            <button onClick={() => setShowPrompt((v) => !v)} className="ml-auto text-xs text-cyan underline">
              {showPrompt ? 'ukryj pełny prompt' : 'pokaż pełny prompt'}
            </button>
          </div>

          {showPrompt && (
            <div>
              <pre className="text-[11px] font-mono bg-panel-2 border border-line rounded-xl p-3 whitespace-pre-wrap leading-relaxed max-h-64 overflow-auto">
                {fullPrompt || (values.prompt?.trim() ? '…' : '(najpierw napisz, co ma być na obrazie)')}
              </pre>
              <p className="text-[11px] text-muted mt-1">To dokładnie ten tekst pojedzie do modelu — nic nie dopisujemy po cichu.</p>
            </div>
          )}

          {!acceptsImages && modelRefs.length > 0 && (
            <Alert kind="warn">
              Masz {modelRefs.length === 1 ? 'wybrany obraz' : `wybrane ${modelRefs.length} obrazy`}, ale ten model pracuje tylko z tekstu (nakładki logo działają).
              {i2iModel && <> <button onClick={() => setModelId(i2iModel.id)} className="underline">Przełącz na {i2iModel.title}</button>, żeby ich użyć.</>}
            </Alert>
          )}
          <References refs={refs} onChange={onRefsChange} roles={roles} maxRefs={maxRefs} styleRefsCount={styleRefsCount}
            disabled={busy} overlay={overlay} acceptsImages={acceptsImages} />

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
          {note && <Alert kind="warn" onClose={() => setNote(null)}>{note}</Alert>}

          <div className="flex flex-wrap items-center gap-4 pt-1">
            <button onClick={generate} disabled={!ready || busy} className="btn-primary px-6 py-3 flex items-center gap-2">
              {busy && <Spinner />}
              {busy ? 'wysyłam…' : acceptsImages ? 'generuj z tymi obrazami' : 'generuj'}
              {price?.credits != null && (
                <span className="font-mono text-sm opacity-80">· {credits(price.credits)} kr.</span>
              )}
            </button>

            <div className="text-xs text-muted leading-relaxed">
              {missingOwnInstruction ? (
                <span className="text-orange">Przy „własnej instrukcji” napisz, co model ma zrobić z tym obrazem.</span>
              ) : acceptsImages && !hasImages ? (
                <span className="text-orange">Ten model potrzebuje choć jednego obrazu.</span>
              ) : price?.credits != null ? (
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
