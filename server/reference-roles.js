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
    // Wyliczenie jest długie celowo. „Odtwórz typografię” model rozumie jako
    // „daj jakiś podobny napis”; dopiero nazwane cechy (szerokość liter, podział
    // na wiersze, kąt, gradient) wracają w wyniku. Ostatnie dwa zdania pilnują
    // granicy, na której ten mechanizm najczęściej się wykłada: wygląd napisu
    // przepisujemy, treść napisu bierzemy wyłącznie od użytkownika.
    prompt: 'Wzorzec stylu: odtwórz możliwie wiernie język graficzny tego obrazu. Typografia: ten sam charakter kroju, grubość, szerokość liter (zwężone czy szerokie), wielkość liter (wersaliki czy małe), odstępy między literami i wierszami, podział napisu na wiersze, kąt nachylenia, wypełnienie (jednolite czy gradient), obrys i cień. Kompozycja: układ i hierarchia elementów, ich proporcje i skala, kadrowanie, gęstość i marginesy, miejsce przeznaczone na tekst. Kolor i wykończenie: paleta, kontrast, poświaty, faktury i szum. Zachowaj wygląd napisów, ale nie ich treść — słowa bierz wyłącznie z polecenia użytkownika. Nie przenoś ze wzorca napisów, logo ani twarzy i tożsamości osób.',
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
  // Instrukcję roli piszemy w całości RAZ. Trzy wzorce stylu pod rząd to inaczej
  // trzy kopie tego samego akapitu — dłuższy prompt, w którym najważniejsze
  // zdanie (polecenie użytkownika) tonie wśród powtórzeń.
  const pierwszeWystapienie = new Map()
  const lines = refs.map((ref, i) => {
    const role = roleOf(ref.role)
    const note = ref.note?.trim()
    let base
    if (ref.role === 'wlasne') base = note || 'Użyj tego obrazu zgodnie z opisem.'
    else if (!pierwszeWystapienie.has(ref.role)) {
      pierwszeWystapienie.set(ref.role, i)
      base = role?.prompt || ''
    } else {
      const label = role?.label || ref.role
      base = `${label.charAt(0).toUpperCase()}${label.slice(1)}: tak samo jak obraz nr ${pierwszeWystapienie.get(ref.role) + 1}.`
    }
    const line = ref.role !== 'wlasne' && note ? `${base} Dodatkowo: ${ensureSentence(note)}` : base
    return `${i + 1}. ${line}`
  })
  const head = refs.length === 1 ? 'Załączony obraz:' : 'Załączone obrazy, w kolejności:'
  return `${head}\n${lines.join('\n')}`
}

function ensureSentence(text) {
  return /[.!?]$/.test(text) ? text : `${text}.`
}
