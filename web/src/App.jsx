import { useCallback, useEffect, useState } from 'react'
import { api, subscribe, OFFLINE_MESSAGE } from './api.js'
import KeyGate from './KeyGate.jsx'
import Generator from './Generator.jsx'
import Jobs from './Jobs.jsx'
import Boards from './Boards.jsx'
import Styles from './Styles.jsx'
import Settings from './Settings.jsx'
import Infographic from './Infographic.jsx'
import { Alert, Spinner, credits } from './ui.jsx'

const TABS = [
  { id: 'generate', label: 'generuj' },
  { id: 'infographic', label: 'infografika' },
  { id: 'boards', label: 'tablice' },
  { id: 'styles', label: 'style' },
  { id: 'library', label: 'biblioteka' },
  { id: 'settings', label: 'ustawienia' },
]

export default function App() {
  const [state, setState] = useState(null)
  const [error, setError] = useState(null)
  const [tab, setTab] = useState('generate')
  const [balance, setBalance] = useState(null)
  const [calibrationTick, setCalibrationTick] = useState(0)
  const [refs, setRefs] = useState([])            // obrazy do najbliższej generacji: {pin, role, note}
  const [preferredModelId, setPreferredModelId] = useState(null)
  const [styleId, setStyleId] = useState(null)
  const [promptSeed, setPromptSeed] = useState(null)   // prompt gotowy z zakładki „infografika”
  const [activeBoardId, setActiveBoardId] = useState(null)
  const [toast, setToast] = useState(null)
  const [offline, setOffline] = useState(false)
  const [staleToken, setStaleToken] = useState(false)   // serwer żyje, ale karta ma token z poprzedniego uruchomienia

  const load = useCallback(async () => {
    try {
      setState(await api.state())
      setError(null)
    } catch (err) {
      setError(err.message)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Postęp zadań przychodzi zdarzeniami, więc nie odpytujemy serwera w kółko.
  useEffect(() => {
    if (!state?.config?.hasApiKey) return
    const off = subscribe((job) => {
      setState((s) => {
        if (!s) return s
        const jobs = [job, ...s.jobs.filter((j) => j.id !== job.id)]
        return { ...s, jobs }
      })
      if (job.status === 'done') {
        setCalibrationTick((t) => t + 1)
        api.credits().then((r) => setBalance(r.credits)).catch(() => {})
        api.state().then(setState).catch(() => {})
      }
    }, (connected) => { setOffline(!connected); if (connected) setStaleToken(false) })
    return off
  }, [state?.config?.hasApiKey])

  useEffect(() => {
    if (!state?.config?.hasApiKey) return
    api.credits().then((r) => setBalance(r.credits)).catch(() => {})
  }, [state?.config?.hasApiKey])

  // Gdy połączenie padnie, pytamy serwer co 3 s. Wracamy sami, gdy tylko odpowie.
  useEffect(() => {
    if (!offline) return
    const id = setInterval(async () => {
      try {
        setState(await api.state())
        setOffline(false)
        setStaleToken(false)
      } catch (err) {
        // Serwer odpowiada, ale odrzuca token: został uruchomiony na nowo.
        setStaleToken(!err.offline)
      }
    }, 3000)
    return () => clearInterval(id)
  }, [offline])

  if (error && !state) {
    return (
      <div className="p-8 max-w-xl mx-auto">
        <Alert kind="error">
          {error}
          <p className="mt-2 text-xs opacity-80">
            Jeśli widzisz to po odświeżeniu strony, wróć do terminala i otwórz adres z tokenem (ten z <code>?t=…</code>).
          </p>
        </Alert>
      </div>
    )
  }

  if (!state) {
    return <div className="min-h-full flex items-center justify-center text-muted"><Spinner /></div>
  }

  if (!state.config.hasApiKey) {
    return <KeyGate onSaved={() => load()} />
  }

  const overLimit = state.spend.limit != null && state.spend.credits30d >= state.spend.limit * 0.8

  return (
    <div className="min-h-full">
      <header className="border-b border-line">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center gap-6">
          <span className="h-display text-xl">openstudio</span>
          <nav className="flex gap-1">
            {TABS.map((t) => (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`px-3 py-1.5 rounded-full text-sm transition ${tab === t.id ? 'bg-cyan/10 text-cyan' : 'text-muted hover:text-ink'}`}>
                {t.label}
              </button>
            ))}
          </nav>
          <div className="ml-auto text-right text-xs text-muted leading-tight">
            <div>saldo konta: <span className="font-mono text-ink">{balance == null ? '…' : credits(balance)}</span> kr.</div>
            <div>wydano tu (30 dni): <span className="font-mono">{credits(state.spend.credits30d)}</span> kr.</div>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        {state.manifestProblems?.length > 0 && (
          <Alert kind="warn">Część modeli ma błędy w opisie i została pominięta: {state.manifestProblems.join('; ')}</Alert>
        )}
        {overLimit && (
          <Alert kind="warn">
            Zbliżasz się do własnego limitu wydatków: {credits(state.spend.credits30d)} z {credits(state.spend.limit)} kredytów w ostatnich 30 dniach.
          </Alert>
        )}

        {offline && (
          <Alert kind="error">
            {staleToken ? (
              <>
                Aplikacja znowu działa, ale ta karta pamięta token z poprzedniego uruchomienia. Token zmienia się
                przy każdym starcie — to zabezpieczenie, nie usterka.
                <p className="mt-1 text-xs opacity-80">
                  Skopiuj z terminala adres z <span className="font-mono">?t=…</span> i otwórz go tutaj.
                </p>
              </>
            ) : (
              <>
                {OFFLINE_MESSAGE}
                <p className="mt-1 text-xs opacity-80">Sprawdzam co 3 sekundy — gdy aplikacja wróci, ten komunikat zniknie sam.</p>
              </>
            )}
          </Alert>
        )}
        {toast && <Alert kind="ok" onClose={() => setToast(null)}>{toast}</Alert>}

        {/* Generator zostaje zamontowany zawsze: wyjście na tablice po inspiracje nie może kasować wpisanego promptu. */}
        <div hidden={tab !== 'generate'}>
          <Generator
            models={state.models}
            calibrationTick={calibrationTick}
            refs={refs}
            onRefsChange={setRefs}
            preferredModelId={preferredModelId}
            styles={state.styles || []}
            styleId={styleId}
            onStyleChange={setStyleId}
            roles={state.referenceRoles || []}
            boards={state.boards || []}
            overlay={state.overlay}
            seed={promptSeed}
            onQueued={(_jobs, note) => { setTab('library'); setRefs([]); setPreferredModelId(null); if (note) setToast(note); load() }}
          />
        </div>
        {/* Infografika też zostaje zamontowana: wklejony dokument nie może zniknąć po zerknięciu do generatora. */}
        <div hidden={tab !== 'infographic'}>
          <Infographic
            config={state.infographic}
            hasApiKey={state.config.hasApiKey}
            onUse={({ prompt, defaults }) => {
              setPromptSeed({ prompt, defaults, nonce: Date.now() })
              setTab('generate')
              setToast('Prompt infografiki jest w generatorze. Sprawdź „pokaż pełny prompt” i generuj.')
            }}
          />
        </div>
        {tab === 'styles' && (
          <Styles
            styles={state.styles || []}
            catalog={state.chipCatalog}
            boards={state.boards || []}
            models={state.models}
            onChanged={load}
            onUse={(style) => { setStyleId(style.id); setTab('generate') }}
          />
        )}
        {tab === 'boards' && (
          <Boards
            boards={state.boards || []}
            activeId={activeBoardId}
            onActiveChange={setActiveBoardId}
            onChanged={load}
            onGenerate={(chosen) => {
              // Z tablicy wszystko wchodzi jako inspiracja; rolę zmienisz w generatorze.
              setRefs(chosen.map((pin) => ({ pin, role: 'inspiracja', note: '' })))
              const model = state.models.find((m) => m.refs?.max >= chosen.length && m.recommended && m.kind === 'i2i')
                || state.models.find((m) => m.kind === 'i2i')
              setPreferredModelId(model?.id || null)
              setTab('generate')
            }}
          />
        )}
        {tab === 'library' && (
          <Jobs
            jobs={state.jobs}
            onChange={load}
            boards={state.boards || []}
            onPinned={(duplicate) => setToast(duplicate ? 'Ten obraz już jest na tablicy.' : 'Przypięte do tablicy.')}
            feedback={state.feedback || []}
            feedbackTags={state.feedbackTags || { issues: [], praise: [] }}
            onVariant={(res) => { setToast(res.note || 'Nowa wersja z poprawką jest w kolejce.'); load() }}
          />
        )}
        {tab === 'settings' && (
          <Settings config={state.config} spend={state.spend} dataDir={state.dataDir} onChanged={load} />
        )}
      </main>

      <footer className="max-w-6xl mx-auto px-6 pb-10 text-[11px] text-muted leading-relaxed">
        OpenStudio jest projektem niezależnym, niepowiązanym z Kie.ai. Płacisz bezpośrednio dostawcy za swoje generacje.
        Twoje pliki leżą w <span className="font-mono">{state.dataDir}</span>.
      </footer>
    </div>
  )
}
