import crypto from 'node:crypto'

/** Token sesji: losowy przy każdym starcie, przekazywany w URL-u i w nagłówku. */
export function newSessionToken() {
  return crypto.randomBytes(24).toString('base64url')
}

function timingSafeEqual(a = '', b = '') {
  const bufA = Buffer.from(String(a))
  const bufB = Buffer.from(String(b))
  if (bufA.length !== bufB.length) return false
  return crypto.timingSafeEqual(bufA, bufB)
}

const ALLOWED_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]'])

/**
 * Aplikacja na localhondzie wydaje prawdziwe pieniądze, więc jest łakomym celem
 * dla dowolnej złośliwej strony otwartej w tej samej przeglądarce (CSRF)
 * oraz dla ataku DNS rebinding. Stąd trzy bariery: token, Host i Origin.
 */
export function guard({ token, port }) {
  return async (c, next) => {
    const url = new URL(c.req.url)
    const isApi = url.pathname.startsWith('/api/')

    const hostHeader = c.req.header('host') || ''
    const hostName = hostHeader.replace(/:\d+$/, '')
    if (!ALLOWED_HOSTS.has(hostName)) {
      return c.json({ error: 'Nieprawidłowy nagłówek Host. Otwórz aplikację pod adresem http://127.0.0.1:' + port }, 403)
    }

    const origin = c.req.header('origin')
    if (origin) {
      let ok = false
      try {
        const o = new URL(origin)
        ok = ALLOWED_HOSTS.has(o.hostname) && String(o.port) === String(port)
      } catch { ok = false }
      if (!ok) return c.json({ error: 'Żądanie z obcej strony zostało odrzucone.' }, 403)
    }

    if (!isApi) return next()

    const given = c.req.header('x-openstudio-token') || url.searchParams.get('t') || ''
    if (!timingSafeEqual(given, token)) {
      return c.json({ error: 'Brak ważnego tokenu sesji. Otwórz aplikację ponownie linkiem z terminala.' }, 401)
    }
    return next()
  }
}
