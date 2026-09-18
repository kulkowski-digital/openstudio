/**
 * Logger, który nigdy nie wypuszcza klucza API.
 * Test automatyczny (test/redaction.test.js) pilnuje tej obietnicy.
 */
const SECRET_PATTERNS = [
  /\b[A-Za-z0-9_-]{24,}\b/g, // długie tokeny
]

let secrets = new Set()

/** Rejestruje wartość, która nigdy nie może pojawić się w logach. */
export function registerSecret(value) {
  if (typeof value === 'string' && value.length >= 8) secrets.add(value)
}

export function forgetSecrets() {
  secrets = new Set()
}

export function redact(input) {
  let text = typeof input === 'string' ? input : safeStringify(input)
  for (const s of secrets) {
    if (!s) continue
    text = text.split(s).join(mask(s))
  }
  text = text.replace(/(Bearer\s+)[A-Za-z0-9_\-.]+/gi, '$1***')
  text = text.replace(/("?(?:api[_-]?key|apiKey|key|token|authorization)"?\s*[:=]\s*"?)([^",\s}]{8,})/gi,
    (_m, head, val) => head + mask(val))
  for (const re of SECRET_PATTERNS) {
    text = text.replace(re, (m) => (secrets.has(m) ? mask(m) : m))
  }
  return text
}

/** Maska pokazywana w UI: pierwsze 3 i ostatnie 4 znaki. */
export function mask(value) {
  if (typeof value !== 'string' || value.length < 8) return '***'
  return `${value.slice(0, 3)}…${value.slice(-4)}`
}

function safeStringify(value) {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export const log = {
  info: (...args) => console.log(...args.map(redact)),
  warn: (...args) => console.warn(...args.map(redact)),
  error: (...args) => console.error(...args.map(redact)),
}
