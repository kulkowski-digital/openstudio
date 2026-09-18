import { useEffect, useState } from 'react'
import { api } from './api.js'
import { Alert, Card, Label, Spinner, credits } from './ui.jsx'

export default function Settings({ config, spend, dataDir, onChanged }) {
  const [concurrency, setConcurrency] = useState(config.concurrency)
  const [limit, setLimit] = useState(config.monthlyLimitCredits ?? '')
  const [newKey, setNewKey] = useState('')
  const [msg, setMsg] = useState(null)
  const [report, setReport] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => { api.doctor().then(setReport).catch(() => {}) }, [])

  async function save(patch, text) {
    setBusy(true)
    try {
      await api.settings(patch)
      setMsg({ kind: 'ok', text })
      onChanged()
    } catch (err) {
      setMsg({ kind: 'error', text: err.message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2 items-start">
      <Card className="p-6 space-y-5">
        <h2 className="h-display text-lg">klucz i pliki</h2>

        <div>
          <Label hint="Klucz leży w pliku config.json z uprawnieniami tylko dla Ciebie. W interfejsie widać wyłącznie końcówkę.">Twój klucz</Label>
          <div className="font-mono text-sm bg-panel-2 border border-line rounded-xl px-4 py-2.5">{config.apiKeyMasked || 'brak'}</div>
        </div>

        <div>
          <Label>Zmień klucz</Label>
          <div className="flex gap-2">
            <input id="new-api-key" name="new-api-key" autoComplete="off" type="password" value={newKey} onChange={(e) => setNewKey(e.target.value)} placeholder="nowy klucz z kie.ai"
              className="flex-1 rounded-xl bg-panel-2 border border-line px-4 py-2.5 font-mono text-sm" />
            <button
              disabled={busy || newKey.trim().length < 8}
              onClick={async () => {
                setBusy(true)
                try { await api.saveKey(newKey.trim()); setNewKey(''); setMsg({ kind: 'ok', text: 'Klucz zapisany i sprawdzony.' }); onChanged() }
                catch (err) { setMsg({ kind: 'error', text: err.message }) }
                finally { setBusy(false) }
              }}
              className="btn-primary px-4">zapisz</button>
          </div>
        </div>

        <div>
          <Label hint="Tutaj lądują wszystkie wygenerowane obrazy razem z opisem, jakim promptem powstały.">Folder z Twoimi plikami</Label>
          <div className="font-mono text-xs bg-panel-2 border border-line rounded-xl px-4 py-2.5 break-all">{dataDir}</div>
        </div>

        {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      </Card>

      <Card className="p-6 space-y-5">
        <h2 className="h-display text-lg">pieniądze i tempo</h2>

        <div>
          <Label hint="Ile zadań aplikacja wysyła naraz. Mniej = spokojniej dla konta.">Zadania równolegle</Label>
          <input id="concurrency" name="concurrency" type="number" min={1} max={8} value={concurrency}
            onChange={(e) => setConcurrency(Number(e.target.value))}
            onBlur={() => save({ concurrency }, 'Zapisano tempo wysyłania.')}
            className="w-28 rounded-xl bg-panel-2 border border-line px-4 py-2.5 font-mono text-sm" />
        </div>

        <div>
          <Label hint="Blokada zanim cokolwiek pójdzie do API. To licznik tej aplikacji, a nie stan Twojego konta — inne programy na tym samym kluczu się tu nie liczą.">
            Limit wydatków na 30 dni (kredyty)
          </Label>
          <div className="flex gap-2 items-center">
            <input id="limit" name="limit" type="number" min={0} value={limit} placeholder="bez limitu"
              onChange={(e) => setLimit(e.target.value)}
              onBlur={() => save({ monthlyLimitCredits: limit === '' ? null : Number(limit) }, 'Zapisano limit wydatków.')}
              className="w-40 rounded-xl bg-panel-2 border border-line px-4 py-2.5 font-mono text-sm" />
            <span className="text-xs text-muted">wydano: <span className="font-mono text-ink">{credits(spend.credits30d)}</span></span>
          </div>
        </div>

        <div>
          <Label hint="Raport nie zawiera klucza API — możesz go wkleić w zgłoszeniu błędu.">Diagnostyka</Label>
          {report ? (
            <pre className="text-[11px] font-mono bg-panel-2 border border-line rounded-xl p-3 overflow-auto max-h-56">{JSON.stringify(report, null, 2)}</pre>
          ) : <Spinner />}
          <button
            className="mt-2 text-xs underline text-cyan"
            onClick={() => navigator.clipboard?.writeText(JSON.stringify(report, null, 2))}>
            skopiuj raport
          </button>
        </div>
      </Card>
    </div>
  )
}
