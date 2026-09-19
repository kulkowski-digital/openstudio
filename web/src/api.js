/**
 * Klient lokalnego API. Token sesji przychodzi w adresie (?t=…), zapamiętujemy
 * go tylko na czas karty — nigdy nie trafia na dysk przeglądarki na stałe.
 */
// Token bierzemy (w tej kolejności) z adresu, ze strony podanej przez serwer
// przy wejściu z paska adresu, albo z pamięci karty.
const urlToken = new URLSearchParams(location.search).get('t')
const injected = typeof window !== 'undefined' ? window.__OPENSTUDIO_TOKEN__ : null
const token = urlToken || injected || sessionStorage.getItem('openstudio-token') || ''
if (token) {
  try { sessionStorage.setItem('openstudio-token', token) } catch { /* tryb prywatny */ }
}
if (urlToken) history.replaceState({}, '', location.pathname)
export const TOKEN = token

export const OFFLINE_MESSAGE =
  'Aplikacja nie odpowiada. Sprawdź okno terminala, w którym uruchomiłeś OpenStudio — jeśli zostało zamknięte, uruchom aplikację ponownie i otwórz adres z tokenem.'

async function call(path, options = {}) {
  let res
  try {
    res = await fetch(path, {
      ...options,
      headers: { 'Content-Type': 'application/json', 'x-openstudio-token': TOKEN, ...(options.headers || {}) },
    })
  } catch {
    // `fetch` rzuca suchym „Failed to fetch”, a to zwykle znaczy, że serwer padł albo został zamknięty.
    const err = new Error(OFFLINE_MESSAGE)
    err.offline = true
    throw err
  }
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
  generate: (modelId, values, pinIds) => call('/api/generate', { method: 'POST', body: JSON.stringify({ modelId, values, pinIds }) }),
  boards: () => call('/api/boards'),
  createBoard: (name) => call('/api/boards', { method: 'POST', body: JSON.stringify({ name }) }),
  deleteBoard: (id) => call(`/api/boards/${id}`, { method: 'DELETE' }),
  addPin: (boardId, payload) => call(`/api/boards/${boardId}/pins`, { method: 'POST', body: JSON.stringify(payload) }),
  updatePin: (id, patch) => call(`/api/pins/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deletePin: (id) => call(`/api/pins/${id}`, { method: 'DELETE' }),
  jobs: () => call('/api/jobs'),
  resend: (id) => call(`/api/jobs/${id}/resend`, { method: 'POST' }),
  redownload: (id) => call(`/api/jobs/${id}/redownload`, { method: 'POST' }),
  hide: (id) => call(`/api/jobs/${id}`, { method: 'DELETE' }),
  doctor: () => call('/api/doctor'),
  ledger: () => call('/api/ledger'),
  fileUrl: (p) => `/api/file?path=${encodeURIComponent(p)}&t=${encodeURIComponent(TOKEN)}`,
}

/** Zdarzenia na żywo (postęp zadań). EventSource nie umie nagłówków, stąd token w URL-u. */
export function subscribe(onJob, onConnection) {
  const es = new EventSource(`/api/events?t=${encodeURIComponent(TOKEN)}`)
  es.onmessage = (e) => {
    try {
      const payload = JSON.parse(e.data)
      if (payload.type === 'job') onJob(payload.job)
    } catch {}
  }
  es.onopen = () => onConnection?.(true)
  es.onerror = () => onConnection?.(false)   // EventSource sam próbuje wrócić
  return () => es.close()
}
