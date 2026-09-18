/**
 * Klient lokalnego API. Token sesji przychodzi w adresie (?t=…), zapamiętujemy
 * go tylko na czas karty — nigdy nie trafia na dysk przeglądarki na stałe.
 */
const urlToken = new URLSearchParams(location.search).get('t')
if (urlToken) {
  sessionStorage.setItem('openstudio-token', urlToken)
  history.replaceState({}, '', location.pathname)
}
export const TOKEN = sessionStorage.getItem('openstudio-token') || ''

async function call(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', 'x-openstudio-token': TOKEN, ...(options.headers || {}) },
  })
  const text = await res.text()
  let data
  try { data = text ? JSON.parse(text) : {} } catch { data = { error: 'Odpowiedź serwera jest nieczytelna.' } }
  if (!res.ok) throw new Error(data.error || `Błąd ${res.status}`)
  return data
}

export const api = {
  state: () => call('/api/state'),
  credits: () => call('/api/credits'),
  saveKey: (apiKey) => call('/api/key', { method: 'POST', body: JSON.stringify({ apiKey }) }),
  removeKey: () => call('/api/key', { method: 'DELETE' }),
  settings: (patch) => call('/api/settings', { method: 'POST', body: JSON.stringify(patch) }),
  price: (modelId, values) => call('/api/price', { method: 'POST', body: JSON.stringify({ modelId, values }) }),
  generate: (modelId, values) => call('/api/generate', { method: 'POST', body: JSON.stringify({ modelId, values }) }),
  jobs: () => call('/api/jobs'),
  resend: (id) => call(`/api/jobs/${id}/resend`, { method: 'POST' }),
  redownload: (id) => call(`/api/jobs/${id}/redownload`, { method: 'POST' }),
  hide: (id) => call(`/api/jobs/${id}`, { method: 'DELETE' }),
  doctor: () => call('/api/doctor'),
  ledger: () => call('/api/ledger'),
  fileUrl: (p) => `/api/file?path=${encodeURIComponent(p)}&t=${encodeURIComponent(TOKEN)}`,
}

/** Zdarzenia na żywo (postęp zadań). EventSource nie umie nagłówków, stąd token w URL-u. */
export function subscribe(onJob) {
  const es = new EventSource(`/api/events?t=${encodeURIComponent(TOKEN)}`)
  es.onmessage = (e) => {
    try {
      const payload = JSON.parse(e.data)
      if (payload.type === 'job') onJob(payload.job)
    } catch {}
  }
  return () => es.close()
}
