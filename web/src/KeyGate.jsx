import { useState } from 'react'
import { api } from './api.js'
import { Alert, Card, Label, Spinner } from './ui.jsx'

const KIE_SIGNUP = 'https://kie.ai/api-key?ref=openstudio'
const KIE_PLAIN = 'https://kie.ai/api-key'

/** Pierwszy ekran: jedno pole i trzy kroki. Nic więcej nie może tu być. */
export default function KeyGate({ onSaved }) {
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function save(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const res = await api.saveKey(key.trim())
      onSaved(res)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-full flex items-center justify-center p-6">
      <Card className="w-full max-w-xl p-8 relative">
        <h1 className="mb-4">
          <img src="/logo.png" alt="OpenStudio" className="h-14 w-auto" />
        </h1>
        <p className="text-muted text-sm leading-relaxed mb-6">
          Twoje własne studio AI do obrazów. Płacisz tylko za to, co naprawdę wygenerujesz,
          a wszystkie pliki zostają na Twoim dysku.
        </p>

        <ol className="text-sm text-muted space-y-2 mb-6">
          <li><span className="text-cyan font-semibold">1.</span> Załóż konto na kie.ai i doładuj je choćby najmniejszą kwotą.</li>
          <li><span className="text-cyan font-semibold">2.</span> Skopiuj klucz API ze strony „API Key”.</li>
          <li><span className="text-cyan font-semibold">3.</span> Wklej go poniżej. Sprawdzimy od razu, czy działa.</li>
        </ol>

        <form onSubmit={save}>
          <Label hint="Klucz zapisujemy tylko na Twoim komputerze, w pliku z uprawnieniami tylko dla Ciebie. Nigdy nie trafia do przeglądarki ani do logów.">
            Klucz API z Kie.ai
          </Label>
          <input
            autoFocus
            id="api-key"
            name="api-key"
            autoComplete="off"
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="wklej tutaj (Cmd+V)"
            className="w-full rounded-xl bg-panel-2 border border-line px-4 py-3 font-mono text-sm"
          />

          {error && <div className="mt-4"><Alert kind="error">{error}</Alert></div>}

          <button type="submit" disabled={busy || key.trim().length < 8} className="btn-primary mt-5 w-full py-3 flex items-center justify-center gap-2">
            {busy && <Spinner />}
            {busy ? 'sprawdzam klucz…' : 'sprawdź i zapisz'}
          </button>
        </form>

        <p className="text-xs text-muted mt-6 leading-relaxed">
          Nie masz klucza? <a className="text-cyan underline" href={KIE_SIGNUP} target="_blank" rel="noreferrer">Załóż konto na kie.ai</a>{' '}
          <span className="opacity-70">(link polecający — wspiera ten projekt)</span>{' '}
          albo wejdź <a className="text-muted underline" href={KIE_PLAIN} target="_blank" rel="noreferrer">bez polecenia</a>.
        </p>
      </Card>
    </div>
  )
}
