import { registerSecret, log } from '../log.js'

// Czytane leniwie, nie przy imporcie — dzięki temu testy mogą podstawić atrapę API.
const apiBase = () => process.env.OPENSTUDIO_KIE_BASE || 'https://api.kie.ai'
const uploadBase = () => process.env.OPENSTUDIO_KIE_UPLOAD_BASE || 'https://kieai.redpandaai.co'

/** Błąd z API dostawcy, z komunikatem po polsku dla użytkownika. */
export class ProviderError extends Error {
  constructor(message, { code, human, retryable = false } = {}) {
    super(message)
    this.name = 'ProviderError'
    this.code = code
    this.human = human || message
    this.retryable = retryable
  }
}

/** Tłumaczy kod odpowiedzi Kie na komunikat, który coś mówi laikowi. */
export function humanError(code, msg = '') {
  switch (Number(code)) {
    case 401: return 'Ten klucz API nie działa. Sprawdź, czy skopiowałeś go w całości ze strony kie.ai/api-key.'
    case 402:
    case 403: return 'Skończyły się kredyty na koncie Kie.ai. Doładuj konto i spróbuj ponownie.'
    case 404: return 'Ten model nie istnieje albo nie jest dostępny dla Twojego konta.'
    case 422: return `Model odrzucił parametry generacji. ${msg}`.trim()
    case 429: return 'Za dużo zapytań naraz. Aplikacja spróbuje ponownie za chwilę.'
    case 451: return 'Treść została odrzucona przez moderację dostawcy. Zmień prompt.'
    case 500:
    case 501:
    case 502:
    case 503: return 'Chwilowy problem po stronie Kie.ai. Spróbuj ponownie za chwilę.'
    default: return msg || `Nieznany błąd dostawcy (kod ${code}).`
  }
}

const RETRYABLE = new Set([408, 429, 500, 501, 502, 503, 504])

/**
 * Adapter Kie.ai. Interfejs `Provider`: submit / status / credits / upload.
 * Zasada: ponawiamy WYŁĄCZNIE GET-y. POST /createTask nigdy nie jest ponawiany
 * automatycznie, bo Kie nie ma klucza idempotencji (podwójna opłata).
 */
export class KieProvider {
  static id = 'kie'

  constructor({ apiKey, fetchImpl = globalThis.fetch } = {}) {
    if (!apiKey) throw new ProviderError('Brak klucza API', { human: 'Nie ustawiono klucza API.' })
    this.apiKey = apiKey
    this.fetch = fetchImpl
    registerSecret(apiKey)
  }

  get headers() {
    return { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' }
  }

  /** Surowe zapytanie + parsowanie koperty {code,msg,data}. */
  async #call(method, url, { body, retries = 0 } = {}) {
    let lastError
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0) await sleep(backoff(attempt))
      let res
      try {
        res = await this.fetch(url, {
          method,
          headers: this.headers,
          body: body ? JSON.stringify(body) : undefined,
        })
      } catch (err) {
        lastError = new ProviderError(`Sieć: ${err.message}`, {
          human: 'Brak połączenia z Kie.ai. Sprawdź internet.',
          retryable: true,
        })
        if (attempt < retries) continue
        throw lastError
      }

      const text = await res.text()
      let payload
      try {
        payload = JSON.parse(text)
      } catch {
        // Pułapka ze spike'u: recordInfo potrafi zwrócić nie-JSON, gdy zadanie
        // jest w toku. To błąd przejściowy — ponawiamy GET, nigdy POST.
        lastError = new ProviderError('Odpowiedź nie jest JSON-em', {
          human: 'Dostawca zwrócił nieczytelną odpowiedź. Ponawiam...',
          retryable: true,
        })
        if (attempt < retries) continue
        throw lastError
      }

      const code = payload?.code ?? res.status
      if (res.ok && (code === 200 || code === undefined)) return payload

      const err = new ProviderError(`Kie ${code}: ${payload?.msg || res.statusText}`, {
        code,
        human: humanError(code, payload?.msg || ''),
        retryable: RETRYABLE.has(Number(code)) || RETRYABLE.has(res.status),
      })
      lastError = err
      if (attempt < retries && err.retryable) continue
      throw err
    }
    throw lastError
  }

  /** Saldo kredytów na koncie. Darmowe — używane też do walidacji klucza. */
  async credits() {
    const payload = await this.#call('GET', `${apiBase()}/api/v1/chat/credit`, { retries: 2 })
    return Number(payload?.data ?? 0)
  }

  /** Czy klucz jest poprawny. Zwraca {ok, credits} albo {ok:false, human}. */
  async validateKey() {
    try {
      const credits = await this.credits()
      return { ok: true, credits }
    } catch (err) {
      return { ok: false, human: err.human || err.message, code: err.code }
    }
  }

  /**
   * Tworzy zadanie. UWAGA: wołane dokładnie raz na zadanie (retries: 0).
   * @returns {Promise<{taskId: string}>}
   */
  async submit({ model, input, callBackUrl }) {
    const payload = await this.#call('POST', `${apiBase()}/api/v1/jobs/createTask`, {
      body: callBackUrl ? { model, input, callBackUrl } : { model, input },
      retries: 0,
    })
    const taskId = payload?.data?.taskId
    if (!taskId) throw new ProviderError('Brak taskId w odpowiedzi', { human: 'Dostawca nie zwrócił numeru zadania.' })
    return { taskId }
  }

  /**
   * Status zadania. Normalizuje odpowiedź Kie do wspólnego kształtu.
   * @returns {Promise<{state:'running'|'success'|'fail', urls:string[], credits:number|null, costTimeMs:number|null, failMsg:string|null, raw:object}>}
   */
  async status(taskId) {
    const payload = await this.#call('GET', `${apiBase()}/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`, { retries: 3 })
    const d = payload?.data || {}
    const state = d.state === 'success' ? 'success' : d.state === 'fail' ? 'fail' : 'running'
    let urls = []
    if (state === 'success' && d.resultJson) {
      try {
        const parsed = typeof d.resultJson === 'string' ? JSON.parse(d.resultJson) : d.resultJson
        urls = Array.isArray(parsed?.resultUrls) ? parsed.resultUrls : []
      } catch (err) {
        log.warn('resultJson nie sparsował się:', String(err))
      }
    }
    return {
      state,
      urls,
      credits: d.creditsConsumed != null ? Number(d.creditsConsumed) : null,
      costTimeMs: d.costTime != null ? Number(d.costTime) : null,
      failMsg: state === 'fail' ? (d.failMsg || humanError(d.failCode)) : null,
      raw: d,
    }
  }

  /**
   * Model czatu na tym samym kluczu (plan infografiki, w przyszłości „opisz
   * styl”). Endpoint w stylu Anthropic: POST /claude/v1/messages, bez streamu.
   * Płatne — wołane tylko na wyraźne kliknięcie użytkownika.
   * @returns {Promise<{text:string, credits:number|null}>}
   */
  async chat({ model, prompt, maxTokens = 1024 }) {
    const payload = await this.#call('POST', `${apiBase()}/claude/v1/messages`, {
      body: { model, messages: [{ role: 'user', content: prompt }], stream: false, max_tokens: maxTokens },
      retries: 0,
    })
    const blocks = Array.isArray(payload?.content) ? payload.content : []
    const text = blocks.filter((b) => b?.type === 'text').map((b) => b.text).join('\n').trim()
    if (!text) throw new ProviderError('Pusta odpowiedź modelu czatu', { human: 'Model czatu nie zwrócił tekstu. Spróbuj ponownie.' })
    const credits = payload?.credits_consumed != null ? Number(payload.credits_consumed) : null
    return { text, credits }
  }

  /**
   * Upload referencji (Tablice/Style, Faza 2). Zwraca publiczny URL ważny ~24 h.
   * @param {{base64:string, fileName:string, uploadPath?:string}} file
   */
  async upload({ base64, fileName, uploadPath = 'images' }) {
    const res = await this.fetch(`${uploadBase()}/api/file-base64-upload`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ base64Data: base64, uploadPath, fileName }),
    })
    const text = await res.text()
    let payload
    try {
      payload = JSON.parse(text)
    } catch {
      throw new ProviderError('Upload: odpowiedź nie jest JSON-em', { human: 'Nie udało się wysłać pliku referencyjnego.', retryable: true })
    }
    const url = payload?.data?.downloadUrl || payload?.data?.fileUrl || payload?.data?.url
    if (!url) throw new ProviderError(`Upload nieudany: ${payload?.msg}`, { human: 'Nie udało się wysłać pliku referencyjnego.' })
    return { url, expiresInHours: 24 }
  }
}

function backoff(attempt) {
  const base = Math.min(2000 * 1.5 ** (attempt - 1), 10000)
  return base + Math.random() * 500 // jitter
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
