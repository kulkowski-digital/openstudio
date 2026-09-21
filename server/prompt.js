import { buildPrompt as withStyle } from './styles.js'
import { describeReferences } from './reference-roles.js'
import { describeOverlays } from './overlay.js'

/**
 * JEDYNE miejsce, w którym powstaje prompt wysyłany do modelu.
 * Używa go generacja i „Pokaż pełny prompt”, więc podgląd nigdy nie rozjedzie
 * się z tym, co naprawdę poszło do API.
 *
 * Kolejność: to, co napisał użytkownik → co zrobić z załączonymi obrazami → styl.
 */
export function composePrompt({ userPrompt, references = [], overlays = [], style = null }) {
  const base = String(userPrompt || '').trim()
  const styleIds = new Set(style?.referencePinIds || [])
  const effectiveRefs = references.map((r) => styleIds.has(r.pinId) && r.role === 'inspiracja' ? { ...r, role: 'styl' } : r)
  const visual = effectiveRefs.some((r) => r.role === 'styl')
  const imageRefs = effectiveRefs.filter((r) => r.role !== 'logo-nakladka')
  const primaryPin = (style?.referencePinIds || []).find((id) => imageRefs.some((r) => r.pinId === id && r.role === 'styl'))
  const primaryIndex = primaryPin ? imageRefs.findIndex((r) => r.pinId === primaryPin) : imageRefs.findIndex((r) => r.role === 'styl')
  const refsNote = describeReferences(effectiveRefs)
  const overlayNote = describeOverlays(overlays)
  const visualNote = visual ? 'Stwórz kolejny projekt z tej samej serii co wzorce stylu. Główny wzorzec wyznacza podstawową kompozycję i typografię, pozostałe uzupełniają wspólne cechy. Treść i jawne zmiany określa polecenie użytkownika; tożsamość osoby i logo określają osobne obrazy z tymi rolami. ' + (style?.referencePriority === 'description' ? 'Opis stylu poniżej określa świadome odstępstwa od wzorców.' : 'Wygląd odczytaj z obrazów; zachowaj ich typografię, stylistykę i gęstość kompozycji zamiast zastępować projekt ogólną fotografią.') : ''
  const primaryNote = visual ? `Główny wzorzec stylu to obraz nr ${primaryIndex + 1}; to on rozstrzyga różnice w układzie i typografii między wzorcami.` : ''
  const fidelity = visual ? (style?.strength === 'lekki' ? 'Dopuszczaj luźniejsze wariacje układu przy zachowaniu rozpoznawalnych cech wzorca.' : style?.strength === 'mocny' ? 'Wierność wzorcowi ma najwyższy priorytet wizualny: zachowaj proporcje, typografię i układ możliwie najdokładniej; zmieniaj tylko treść i elementy wskazane przez użytkownika.' : 'Zachowaj wyraźne podobieństwo typografii i kompozycji; dopasuj układ tylko tyle, ile wymaga nowa treść.') : ''
  const withRefs = [base, refsNote, visualNote, primaryNote, fidelity, overlayNote].filter(Boolean).join('\n\n')
  return withStyle(withRefs, style, { visual })
}
