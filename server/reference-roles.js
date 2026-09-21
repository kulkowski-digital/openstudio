/**
 * Rola obrazu w generacji. Użytkownik nie musi pisać „użyj obrazu nr 2 jako
 * logo” — wybiera rolę, a my mówimy modelowi, co ma z tym plikiem zrobić.
 * `prompt` to dokładnie zdanie, które trafi do modelu.
 */
export const REFERENCE_ROLES = [
  {
    value: 'styl',
    label: 'wzorzec stylu',
    hint: 'typografia, układ, kolory i efekty',
    prompt: 'Wzorzec stylu: odtwórz możliwie wiernie język graficzny tego obrazu: krój i grubość liter, proporcje i odstępy typografii, hierarchię tekstu, układ i skalę elementów, kadrowanie, paletę, kontrast, obrysy, cienie, poświaty i faktury. Zachowaj charakter projektu, a treść napisów i temat zastąp zgodnie z poleceniem użytkownika. Nie przenoś przypadkowych napisów, logo ani tożsamości osób ze wzorca.',
  },
  {
    value: 'inspiracja',
    label: 'inspiracja',
    hint: 'klimat, światło, kolory — nie treść',
    prompt: 'Inspiracja: weź z niej klimat, światło, kolory i kompozycję; nie kopiuj treści ani napisów.',
  },
  {
    value: 'osoba',
    label: 'osoba (np. ja)',
    hint: 'zachowaj wiernie twarz i sylwetkę',
    prompt: 'Osoba: to ma być główny bohater obrazu; zachowaj wiernie twarz, fryzurę, sylwetkę i wiek — nie zmieniaj rysów.',
  },
  {
    value: 'produkt',
    label: 'produkt',
    hint: 'pokaż wiernie, bez zmian',
    prompt: 'Produkt: pokaż go wiernie — bez zmiany kształtu, kolorów, proporcji ani napisów na nim.',
  },
  {
    value: 'logo',
    label: 'logo',
    hint: 'wstaw bez zmian, czytelnie',
    prompt: 'Logo: wstaw je dokładnie raz, bez żadnych zmian kształtu, kolorów i proporcji, czytelnie i w naturalnym miejscu; nigdzie indziej nie powtarzaj jego kształtów ani nie używaj go jako tekstury tła.',
  },
  {
    value: 'logo-nakladka',
    label: 'logo (nakładka)',
    hint: 'nie idzie do modelu — nakładamy oryginał po generacji',
    overlay: true,
    prompt: null,
  },
  {
    value: 'tlo',
    label: 'tło',
    hint: 'użyj jako tła sceny',
    prompt: 'Tło: użyj tego obrazu jako tła sceny; resztę elementów umieść na nim.',
  },
  {
    value: 'edycja',
    label: 'obraz do edycji',
    hint: 'zmień tylko to, o co proszę',
    prompt: 'Obraz wyjściowy: zmień w nim tylko to, o co proszę w opisie; wszystko inne zostaw dokładnie tak, jak jest.',
  },
  {
    value: 'wlasne',
    label: 'własna instrukcja',
    hint: 'napisz, co model ma z tym zrobić',
    prompt: null,
  },
]

export const DEFAULT_ROLE = 'inspiracja'

export function roleOf(value) {
  return REFERENCE_ROLES.find((r) => r.value === value) || null
}

/**
 * Porządkuje listę referencji z żądania. Przyjmuje nowy kształt
 * `[{pinId, role, note}]` i stary `['pinId', …]` (wszystko jako inspiracja).
 */
export function normalizeReferences(input) {
  if (!Array.isArray(input)) return []
  const out = []
  const seen = new Set()
  for (const item of input) {
    const ref = typeof item === 'string' ? { pinId: item } : item
    if (!ref || typeof ref.pinId !== 'string' || seen.has(ref.pinId)) continue
    seen.add(ref.pinId)
    const role = roleOf(ref.role) ? ref.role : DEFAULT_ROLE
    const entry = { pinId: ref.pinId, role, note: String(ref.note || '').trim().slice(0, 300) }
    if (ref.overlay && typeof ref.overlay === 'object') entry.overlay = ref.overlay
    out.push(entry)
  }
  return out
}

/**
 * Sekcja promptu o załączonych obrazach. Numeracja odpowiada kolejności
 * `input_urls`, bo model rozpoznaje obrazy po kolejności, nie po nazwie.
 */
export function describeReferences(refs = []) {
  refs = refs.filter((r) => !roleOf(r.role)?.overlay)   // nakładki nie są obrazami dla modelu
  if (!refs.length) return ''
  const lines = refs.map((ref, i) => {
    const role = roleOf(ref.role)
    const base = role?.prompt || ''
    const note = ref.note?.trim()
    let line
    if (ref.role === 'wlasne') line = note || 'Użyj tego obrazu zgodnie z opisem.'
    else line = note ? `${base} Dodatkowo: ${ensureSentence(note)}` : base
    return `${i + 1}. ${line}`
  })
  const head = refs.length === 1 ? 'Załączony obraz:' : 'Załączone obrazy, w kolejności:'
  return `${head}\n${lines.join('\n')}`
}

function ensureSentence(text) {
  return /[.!?]$/.test(text) ? text : `${text}.`
}
