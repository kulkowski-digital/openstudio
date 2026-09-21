import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from './api.js'
import { extractPalette, isHex, readableOn } from './palette.js'
import { Alert, Badge, Card, Label, Spinner } from './ui.jsx'

const STEPS = ['wzorce wyglądu', 'kolory (opcjonalnie)', 'opis (opcjonalnie)']

/** Lista zapisanych stylów + kreator w trzech krokach. */
export default function Styles({ styles, catalog, boards, models, onChanged, onUse }) {
  const [editing, setEditing] = useState(null)   // styl w trakcie tworzenia lub edycji
  const [error, setError] = useState(null)
  const [info, setInfo] = useState(null)

  async function importFile(file) {
    setError(null)
    try {
      const payload = JSON.parse(await file.text())
      const res = await api.importStyle(payload)
      setInfo(`Wczytano styl „${res.style.name}”.`)
      onChanged()
    } catch (err) {
      setError(err.message?.includes('JSON') ? 'To nie jest plik stylu (.styl.json).' : err.message)
    }
  }

  if (editing) {
    return (
      <Creator
        initial={editing}
        catalog={catalog}
        boards={boards}
        models={models}
        onCancel={() => setEditing(null)}
        onSaved={(style) => { setEditing(null); setInfo(`Zapisano styl „${style.name}”.`); onChanged() }}
      />
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={() => setEditing({ name: '', palette: [], chips: {}, avoid: [], referencePinIds: [], strength: 'wyrazny', extra: '', defaults: {} })}
          className="btn-primary px-4 py-2 text-sm">nowy styl</button>
        <label className="text-sm text-cyan underline cursor-pointer">
          wczytaj plik .styl.json
          <input type="file" accept=".json,application/json" className="hidden"
            onChange={(e) => { if (e.target.files[0]) importFile(e.target.files[0]); e.target.value = '' }} />
        </label>
        <span className="text-xs text-muted">Wybierz obrazy wzorcowe, aby kolejne projekty zachowały ich typografię, kompozycję i efekty.</span>
      </div>

      {error && <Alert kind="error" onClose={() => setError(null)}>{error}</Alert>}
      {info && <Alert kind="ok" onClose={() => setInfo(null)}>{info}</Alert>}

      {styles.length === 0 ? (
        <Card className="p-12 text-center">
          <p className="text-muted text-sm leading-relaxed">
            Nie masz jeszcze żadnego stylu.<br />
            Zrób jeden z tablicy inspiracji, a potem włączaj go jednym kliknięciem przy każdej generacji —
            dziesięć obrazów zacznie wyglądać jak z jednej marki.
          </p>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {styles.map((style) => (
            <StyleCard key={style.id} style={style} catalog={catalog}
              boards={boards} onUse={() => onUse(style)}
              onEdit={() => setEditing(style)}
              onDeleted={onChanged} />
          ))}
        </div>
      )}
    </div>
  )
}

function StyleCard({ style, catalog, boards, onUse, onEdit, onDeleted }) {
  const [confirm, setConfirm] = useState(false)
  const [journalOpen, setJournalOpen] = useState(false)
  const descriptors = describe(style, catalog)
  const patterns = (style.referencePinIds || []).map((id) => boards.flatMap((b) => b.pins).find((p) => p.id === id)).filter(Boolean)

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-semibold">{style.name}</h3>
        <Badge tone="cyan">{catalog.strengths.find((s) => s.value === style.strength)?.label || 'wyraźnie'}</Badge>
      </div>

      {patterns.length > 0 && <div className="grid grid-cols-2 gap-2">{patterns.map((pin, i) => <img key={pin.id} src={api.fileUrl(pin.file)} alt={`${i === 0 ? 'Główny wzorzec' : 'Wzorzec'}: ${pin.name}`} className="w-full rounded-lg border border-line" />)}</div>}
      {style.palette.length > 0 && (
        <div className="flex rounded-lg overflow-hidden h-10">
          {style.palette.map((hex) => (
            <div key={hex} className="flex-1 flex items-end justify-center pb-0.5" style={{ background: hex }}>
              <span className="text-[9px] font-mono" style={{ color: readableOn(hex) }}>{hex.slice(1)}</span>
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-muted leading-relaxed min-h-[2.5rem]">
        {patterns.length && style.referencePriority !== 'description' ? 'Wygląd z obrazów: typografia, kompozycja, kolory i efekty. Ogólne określenia i paleta nie nadpisują wzorców.' : descriptors.length ? descriptors.join(' · ') : 'bez opisu — działa sama paleta'}
      </p>

      {style.learned?.length > 0 && (
        <p className="text-[11px] text-muted leading-relaxed">z Twoich uwag: {style.learned.map((l) => l.text).join(' ')}</p>
      )}

      <div className="flex flex-wrap items-center gap-3 text-xs">
        <button onClick={onUse} className="text-cyan underline">użyj w generatorze</button>
        <button onClick={onEdit} className="text-muted underline">edytuj</button>
        <button onClick={() => setJournalOpen((v) => !v)} className="text-muted underline">{journalOpen ? 'schowaj dziennik' : 'dziennik'}</button>
        <a href={api.styleExportUrl(style.id)} download title="Eksport zawiera ustawienia, ale nie pliki wzorców. Na innym komputerze trzeba dodać je ponownie." className="text-muted underline">eksport ustawień (bez obrazów)</a>
        {confirm ? (
          <span className="flex items-center gap-2">
            <button onClick={async () => { await api.deleteStyle(style.id); onDeleted() }} className="text-pink underline">na pewno usuń</button>
            <button onClick={() => setConfirm(false)} className="text-muted underline">nie</button>
          </span>
        ) : (
          <button onClick={() => setConfirm(true)} className="ml-auto text-muted hover:text-pink underline">usuń</button>
        )}
      </div>

      {journalOpen && <Journal style={style} onChanged={onDeleted} />}
    </Card>
  )
}

/**
 * Dziennik stylu: co z niego wychodzi (z ocen na kafelkach) i propozycje zmian.
 * Nic nie wchodzi samo — każda propozycja czeka na „zastosuj” i da się cofnąć.
 */
function Journal({ style, onChanged }) {
  const [journal, setJournal] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = () => api.styleJournal(style.id).then((r) => setJournal(r.journal)).catch((err) => setError(err.message))
  useEffect(() => { load() }, [style.id])

  async function act(fn) {
    setBusy(true)
    setError(null)
    try {
      await fn()
      await load()
      onChanged()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  if (!journal) return <div className="pt-3 border-t border-line"><Spinner className="text-cyan" /></div>

  return (
    <div className="pt-3 border-t border-line space-y-3 text-xs">
      <div className="flex flex-wrap gap-3 text-muted">
        <span>generacji: <span className="font-mono text-ink">{journal.generations}</span></span>
        <span>ocenionych: <span className="font-mono text-ink">{journal.rated}</span></span>
        <span className="text-cyan">dobre: <span className="font-mono">{journal.good}</span></span>
        <span className="text-pink">do poprawy: <span className="font-mono">{journal.bad}</span></span>
        {journal.implicit > 0 && <span className="opacity-70">(w tym {journal.implicit} z przypięć/skasowań)</span>}
      </div>

      {journal.topIssues.length > 0 && (
        <p className="text-muted">najczęstsze uwagi: {journal.topIssues.slice(0, 4).map((i) => `${i.label} (${i.count}×)`).join(' · ')}</p>
      )}

      {journal.proposals.length > 0 ? (
        <div className="space-y-2">
          {journal.proposals.map((p) => (
            <div key={p.tag} className="rounded-lg border border-cyan/40 bg-cyan/5 p-2 space-y-1">
              <div><span className="text-cyan">{p.count}× „{journal.topIssues.find((i) => i.tag === p.tag)?.label}”</span> → {p.label}</div>
              {p.text && <div className="text-muted">do promptu: „{p.text}”</div>}
              {p.full && <div className="text-orange">Styl ma już {journal.maxLearned} dopiski — usuń jeden niżej, żeby dodać ten.</div>}
              <div className="flex gap-3">
                <button disabled={busy || p.full} onClick={() => act(() => api.styleProposal(style.id, p.tag, 'apply'))} className="underline text-cyan disabled:opacity-40">zastosuj</button>
                <button disabled={busy} onClick={() => act(() => api.styleProposal(style.id, p.tag, 'dismiss'))} className="underline text-muted">pomiń</button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-muted/80">Propozycja zmiany pojawi się, gdy ta sama uwaga powtórzy się {journal.threshold} razy — jedna nieudana generacja to szum, nie sygnał.</p>
      )}

      {journal.learned.length > 0 && (
        <div className="space-y-1">
          <div className="text-muted">dopiski z uwag ({journal.learned.length}/{journal.maxLearned}) — widoczne w „pokaż pełny prompt”:</div>
          {journal.learned.map((l) => (
            <div key={l.tag} className="flex items-start gap-2">
              <span className="flex-1">{l.text}</span>
              <button disabled={busy} onClick={() => act(() => api.styleProposal(style.id, l.tag, 'forget'))} className="underline text-muted hover:text-pink">usuń</button>
            </div>
          ))}
        </div>
      )}

      {journal.recentGood.length > 0 && (
        <div className="space-y-1">
          <div className="text-muted">dobre wyniki w tym stylu — dodaj jako stałą referencję:</div>
          <div className="flex flex-wrap gap-2">
            {journal.recentGood.map((g) => (
              <div key={g.jobId} className="w-16 space-y-1">
                <img src={api.fileUrl(g.file)} alt={g.userPrompt || ''} className="w-16 h-16 rounded-md object-cover border border-line" />
                {g.alreadyReference
                  ? <div className="text-[10px] text-cyan text-center">jest wzorcem</div>
                  : <button disabled={busy} onClick={() => act(() => api.styleAddReference(style.id, g.jobId))} className="w-full text-[10px] underline text-cyan">jako wzorzec</button>}
              </div>
            ))}
          </div>
        </div>
      )}

      {error && <Alert kind="error" onClose={() => setError(null)}>{error}</Alert>}
    </div>
  )
}

function describe(style, catalog) {
  const out = []
  for (const group of catalog.groups) {
    const chosen = group.options.find((o) => o.value === style.chips?.[group.key])
    if (chosen) out.push(chosen.label)
  }
  if (style.avoid?.length) out.push(`bez: ${style.avoid.map((v) => catalog.avoid.find((o) => o.value === v)?.label).filter(Boolean).join(', ')}`)
  return out
}

// ── Kreator ────────────────────────────────────────────────────────────────

function Creator({ initial, catalog, boards, models, onCancel, onSaved }) {
  const [step, setStep] = useState(0)
  const [draft, setDraft] = useState(() => ({ ...initial, defaults: { ...initial.defaults } }))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const allPins = useMemo(() => boards.flatMap((b) => b.pins.map((p) => ({ ...p, boardName: b.name }))), [boards])
  const set = (patch) => setDraft((d) => ({ ...d, ...patch }))

  async function save() {
    setBusy(true)
    setError(null)
    try {
      const preferred = models.find((m) => m.id === draft.defaults.modelId)
      const modelId = draft.referencePinIds?.length && !preferred?.refs?.max
        ? (models.find((m) => m.refs?.max > 0 && m.recommended) || models.find((m) => m.refs?.max > 0))?.id
        : draft.defaults.modelId
      const res = await api.saveStyle({ ...draft, defaults: { ...draft.defaults, modelId } })
      onSaved(res.style)
    } catch (err) {
      setError(err.message)
      setStep(0)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="p-6 space-y-6 max-w-3xl">
      <div className="flex items-center gap-3">
        <input
          value={draft.name} onChange={(e) => set({ name: e.target.value })}
          placeholder="nazwa stylu, np. Moja marka" id="style-name" name="style-name"
          className="flex-1 rounded-xl bg-panel-2 border border-line px-4 py-2.5 text-sm" />
        <button onClick={onCancel} className="text-xs text-muted underline">anuluj</button>
      </div>

      <div className="flex gap-2">
        {STEPS.map((label, i) => (
          <button key={label} onClick={() => setStep(i)}
            className={`px-3 py-1.5 rounded-full text-xs transition ${i === step ? 'bg-cyan/10 text-cyan' : 'text-muted hover:text-ink'}`}>
            {i + 1}. {label}
          </button>
        ))}
      </div>

      {error && <Alert kind="error">{error}</Alert>}

      {step === 0 && <ReferencesStep draft={draft} set={set} pins={allPins} models={models} catalog={catalog} />}
      {step === 1 && <PaletteStep draft={draft} set={set} pins={allPins} />}
      {step === 2 && <DescriptionStep draft={draft} set={set} catalog={catalog} />}

      <div className="flex items-center gap-3 pt-2 border-t border-line">
        {step > 0 && <button onClick={() => setStep(step - 1)} className="text-sm text-muted underline">wstecz</button>}
        {step < STEPS.length - 1 ? (
          <button onClick={() => setStep(step + 1)} className="btn-primary px-5 py-2 ml-auto">dalej</button>
        ) : (
          <button onClick={save} disabled={busy || !draft.name.trim()} className="btn-primary px-5 py-2 ml-auto flex items-center gap-2">
            {busy && <Spinner />} zapisz styl
          </button>
        )}
      </div>
    </Card>
  )
}

function PaletteStep({ draft, set, pins }) {
  const [busy, setBusy] = useState(false)
  const [manual, setManual] = useState('')
  const [source, setSource] = useState(() => new Set(draft.referencePinIds || []))
  const request = useRef(0)

  async function pickFrom(ids) {
    // Przy szybkim klikaniu liczenie kolorów potrafi się wyprzedzić — bierzemy
    // tylko wynik ostatniego żądania, żeby starsza paleta nie nadpisała nowej.
    const id = ++request.current
    setBusy(true)
    try {
      const urls = pins.filter((p) => ids.has(p.id)).map((p) => api.fileUrl(p.file))
      const palette = await extractPalette(urls, 6)
      if (id === request.current) set({ palette })
    } finally {
      if (id === request.current) setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <Label hint="Zaznacz inspiracje, z których mamy wziąć kolory. Liczymy je u Ciebie w przeglądarce — nic nie wychodzi do sieci i nic to nie kosztuje.">
        Skąd wziąć kolory
      </Label>
      {draft.referencePinIds?.length > 0 && draft.referencePriority !== 'description' && <Alert kind="info">Kolory model odczyta bezpośrednio ze wzorców. Ta paleta jest pomocnicza; użyjesz jej do zmiany wyglądu dopiero po włączeniu opisu w następnym kroku.</Alert>}

      {pins.length === 0 ? (
        <Alert kind="info">Najpierw wrzuć kilka inspiracji na Tablice — stamtąd bierzemy paletę. Możesz też po prostu wkleić swoje HEX-y niżej.</Alert>
      ) : (
        <div className="flex flex-wrap gap-2 max-h-56 overflow-auto">
          {pins.map((pin) => {
            const on = source.has(pin.id)
            return (
              <button key={pin.id}
                onClick={() => {
                  const next = new Set(source)
                  next.has(pin.id) ? next.delete(pin.id) : next.add(pin.id)
                  setSource(next)
                  if (next.size) pickFrom(next)
                }}
                className={`w-16 h-16 rounded-lg overflow-hidden border-2 transition ${on ? 'border-cyan' : 'border-line opacity-70 hover:opacity-100'}`}>
                <img src={api.fileUrl(pin.file)} alt={pin.name} className="w-full h-full object-cover" />
              </button>
            )
          })}
        </div>
      )}

      <div className="flex items-center gap-3">
        {busy && <Spinner className="text-cyan" />}
        <span className="text-xs text-muted">{busy ? 'liczę kolory…' : `kolorów w palecie: ${draft.palette.length}`}</span>
      </div>

      {draft.palette.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {draft.palette.map((hex, i) => (
            <div key={`${hex}-${i}`} className="rounded-lg overflow-hidden border border-line">
              <div className="w-20 h-12" style={{ background: hex }} />
              <div className="flex items-center gap-1 px-1.5 py-1 bg-panel-2">
                <input
                  value={hex}
                  onChange={(e) => {
                    const next = [...draft.palette]
                    next[i] = e.target.value.toUpperCase()
                    set({ palette: next })
                  }}
                  className="w-16 bg-transparent font-mono text-[11px]" />
                <button onClick={() => set({ palette: draft.palette.filter((_, j) => j !== i) })}
                  className="text-[11px] text-muted hover:text-pink">×</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div>
        <Label hint="Masz brandbook? Wklej kolory po przecinku, np. #06070D, #37E7F5.">Albo wpisz własne</Label>
        <div className="flex gap-2">
          <input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="#06070D, #37E7F5"
            id="manual-palette" name="manual-palette"
            className="flex-1 rounded-xl bg-panel-2 border border-line px-4 py-2 font-mono text-sm" />
          <button
            onClick={() => {
              const added = manual.split(/[\s,;]+/).map((v) => v.trim().toUpperCase()).filter(isHex)
              if (added.length) set({ palette: [...new Set([...draft.palette, ...added])].slice(0, 8) })
              setManual('')
            }}
            className="text-sm text-cyan underline">dodaj</button>
        </div>
      </div>

      <p className="text-[11px] text-muted leading-relaxed">
        Uczciwie: modele traktują kody kolorów orientacyjnie. Paleta przesuwa całość w Twoją stronę,
        ale nie zagwarantuje odcienia co do numeru.
      </p>
    </div>
  )
}

function DescriptionStep({ draft, set, catalog }) {
  const toggle = (key, value) => set({ chips: { ...draft.chips, [key]: draft.chips[key] === value ? undefined : value } })
  const imageLed = draft.referencePinIds?.length > 0 && draft.referencePriority !== 'description'

  return (
    <div className="space-y-5">
      {draft.referencePinIds?.length > 0 && <div className="space-y-3">
        <p className="text-sm">Domyślnie wygląd pochodzi z obrazów. Zapisane określenia i paleta są pomijane, aby nie zmieniały ich stylistyki. Dopisek i „Unikaj” nadal obowiązują.</p>
        <label className="flex gap-2 text-sm"><input type="checkbox" checked={!imageLed} onChange={(e) => set({ referencePriority: e.target.checked ? 'description' : 'images' })} />Chcę zmienić wygląd wzorców opisem i paletą</label>
      </div>}
      <fieldset disabled={imageLed} className={`space-y-5 ${imageLed ? 'opacity-40' : ''}`}>
      {catalog.groups.map((group) => (
        <div key={group.key}>
          <Label hint={group.help}>{group.label}</Label>
          <div className="flex flex-wrap gap-2">
            {group.options.map((option) => (
              <button key={option.value} onClick={() => toggle(group.key, option.value)}
                className={`px-3 py-1.5 rounded-full text-xs border transition ${
                  draft.chips[group.key] === option.value ? 'border-cyan text-cyan bg-cyan/5' : 'border-line text-muted hover:text-ink'}`}>
                {option.label}
              </button>
            ))}
          </div>
        </div>
      ))}
      </fieldset>

      <div>
        <Label hint="Czego model ma nie robić. Działa lepiej niż proszenie o to w prompcie za każdym razem.">Unikaj</Label>
        <div className="flex flex-wrap gap-2">
          {catalog.avoid.map((option) => {
            const on = draft.avoid.includes(option.value)
            return (
              <button key={option.value}
                onClick={() => set({ avoid: on ? draft.avoid.filter((v) => v !== option.value) : [...draft.avoid, option.value] })}
                className={`px-3 py-1.5 rounded-full text-xs border transition ${on ? 'border-pink text-pink bg-pink/5' : 'border-line text-muted hover:text-ink'}`}>
                {option.label}
              </button>
            )
          })}
        </div>
      </div>

      <div>
        <Label hint="Jedno zdanie własnymi słowami, jeśli chipy czegoś nie łapią.">Dopisek (opcjonalnie)</Label>
        <input value={draft.extra} onChange={(e) => set({ extra: e.target.value })}
          placeholder="np. nagłówek zawsze w dwóch wierszach, zachowaj obrys liter"
          id="style-extra" name="style-extra"
          className="w-full rounded-xl bg-panel-2 border border-line px-4 py-2 text-sm" />
      </div>

      <div>
        <Label hint="Jak mocno styl ma dociskać Twój prompt.">Siła stylu</Label>
        <div className="flex gap-2">
          {catalog.strengths.map((s) => (
            <button key={s.value} onClick={() => set({ strength: s.value })}
              className={`px-3 py-1.5 rounded-full text-xs border transition ${
                draft.strength === s.value ? 'border-cyan text-cyan bg-cyan/5' : 'border-line text-muted hover:text-ink'}`}>
              {s.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function ReferencesStep({ draft, set, pins, models, catalog }) {
  const chosen = new Set(draft.referencePinIds || [])
  const i2iModels = models.filter((m) => m.refs?.max > 0)
  const t2iModels = models.filter((m) => !m.refs?.max)

  return (
    <div className="space-y-5">
      <div>
        <Label hint={`Wybierz projekty, których wygląd chcesz kontynuować. Wszystkie wybrane wzorce trafią do modelu dopiero przy generacji. Maksimum ${catalog.maxReferences}.`}>
          Wzorce wyglądu
        </Label>
        {pins.length === 0 ? (
          <p className="text-xs text-muted">Brak inspiracji na tablicach — styl będzie działał samym opisem i paletą.</p>
        ) : (
          <div className="flex flex-wrap gap-2 max-h-56 overflow-auto">
            {pins.map((pin) => {
              const on = chosen.has(pin.id)
              return (
                <button key={pin.id}
                  onClick={() => {
                    const next = new Set(chosen)
                    if (on) next.delete(pin.id)
                    else if (next.size < catalog.maxReferences) next.add(pin.id)
                    set({ referencePinIds: [...next] })
                  }}
                  className={`w-40 rounded-lg overflow-hidden border-2 transition ${on ? 'border-cyan' : 'border-line opacity-70 hover:opacity-100'}`}>
                  <img src={api.fileUrl(pin.file)} alt={pin.name} className="w-full aspect-video object-contain" />
                  <span className="block text-[10px] p-1">{on ? `✓ Wzorzec ${[...chosen].indexOf(pin.id) + 1}` : pin.boardName}</span>
                </button>
              )
            })}
          </div>
        )}
        <p className="text-[11px] text-muted mt-2">wybrano: {chosen.size}/{catalog.maxReferences}</p>
        <div className="space-y-2 mt-3">{[...chosen].map((id, i) => {
          const pin = pins.find((p) => p.id === id)
          return <div key={id} className="flex items-center gap-3 text-xs"><span className="flex-1">{i + 1}. {pin?.name || 'Brak pliku wzorca'}{i === 0 ? ' — główny wzorzec' : ''}</span>{i > 0 && <button className="text-cyan underline" onClick={() => set({ referencePinIds: [id, ...[...chosen].filter((v) => v !== id)] })}>ustaw jako główny</button>}<button className="text-muted underline" onClick={() => set({ referencePinIds: [...chosen].filter((v) => v !== id) })}>odłącz</button></div>
        })}</div>
        <p className="text-xs text-muted mt-2">Pierwszy wybrany wzorzec określa główny układ i typografię. Kolejne uzupełniają styl. Zdjęcie osoby i logo dodaj w generatorze z odpowiednimi rolami. Model odtwarza wygląd liter, ale nie gwarantuje identycznego fontu ani układu co do piksela.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <Label>Domyślny model</Label>
          <select value={draft.defaults.modelId || ''} onChange={(e) => set({ defaults: { ...draft.defaults, modelId: e.target.value || null } })}
            className="w-full rounded-xl bg-panel-2 border border-line px-3 py-2 text-sm">
            <option value="">bez wskazania</option>
            <optgroup label="z inspiracji">
              {i2iModels.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
            </optgroup>
            <optgroup label="z tekstu">
              {t2iModels.map((m) => <option disabled={chosen.size > 0} key={m.id} value={m.id}>{m.title}</option>)}
            </optgroup>
          </select>
        </div>
        <div>
          <Label>Domyślny format</Label>
          <select value={draft.defaults.aspect_ratio || ''} onChange={(e) => set({ defaults: { ...draft.defaults, aspect_ratio: e.target.value || null } })}
            className="w-full rounded-xl bg-panel-2 border border-line px-3 py-2 text-sm">
            <option value="">bez wskazania</option>
            {['1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16', '21:9'].map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>
        <div>
          <Label>Domyślna jakość</Label>
          <select value={draft.defaults.resolution || ''} onChange={(e) => set({ defaults: { ...draft.defaults, resolution: e.target.value || null } })}
            className="w-full rounded-xl bg-panel-2 border border-line px-3 py-2 text-sm">
            <option value="">bez wskazania</option>
            {['1K', '2K', '4K'].map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>
      </div>
    </div>
  )
}
