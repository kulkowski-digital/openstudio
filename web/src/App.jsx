import { useCallback, useEffect, useState } from 'react'
import { api, subscribe } from './api.js'
import KeyGate from './KeyGate.jsx'
import Generator from './Generator.jsx'
import Jobs from './Jobs.jsx'
import Settings from './Settings.jsx'
import { Alert, Spinner, credits } from './ui.jsx'

const TABS = [
  { id: 'generate', label: 'generuj' },
  { id: 'library', label: 'biblioteka' },
  { id: 'settings', label: 'ustawienia' },
]

export default function App() {
  const [state, setState] = useState(null)
  const [error, setError] = useState(null)
  const [tab, setTab] = useState('generate')
  const [balance, setBalance] = useState(null)
  const [calibrationTick, setCalibrationTick] = useState(0)

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
    })
    return off
  }, [state?.config?.hasApiKey])

  useEffect(() => {
    if (!state?.config?.hasApiKey) return
    api.credits().then((r) => setBalance(r.credits)).catch(() => {})
  }, [state?.config?.hasApiKey])

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

        {tab === 'generate' && (
          <Generator
            models={state.models}
            calibrationTick={calibrationTick}
            onQueued={() => { setTab('library'); load() }}
          />
        )}
        {tab === 'library' && <Jobs jobs={state.jobs} onChange={load} />}
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
