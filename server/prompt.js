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
/**
 * Rola, z jaką obraz NAPRAWDĘ pojedzie do modelu. Referencja zapisana w stylu
 * jest wzorcem stylu, nawet jeśli w żądaniu przyszła jako „inspiracja” — bo styl
 * z obrazami to prośba „zrób kolejny projekt w tym wyglądzie”, a nie „weź klimat”.
 * Eksportowane, żeby zapis zadania pokazywał to samo, co zobaczył model.
 */
export function effectiveReferences(references = [], style = null) {
  const styleIds = new Set(style?.referencePinIds || [])
  return references.map((r) => (styleIds.has(r.pinId) && r.role === 'inspiracja' ? { ...r, role: 'styl' } : r))
}

export function composePrompt({ userPrompt, references = [], overlays = [], style = null }) {
  const base = String(userPrompt || '').trim()
  const effectiveRefs = effectiveReferences(references, style)
  const visual = effectiveRefs.some((r) => r.role === 'styl')
  const imageRefs = effectiveRefs.filter((r) => r.role !== 'logo-nakladka')
  // Główny wzorzec to po prostu PIERWSZY obraz z rolą „styl” w kolejności wysyłki.
  // Kolejność jest tym, czym użytkownik steruje: strzałkami na liście referencji
  // i przyciskiem „ustaw jako główny” w edycji stylu. Dzięki jednej regule numer
  // pokazany na ekranie zgadza się z numerem w prompcie i w żądaniu do modelu.
  const primaryIndex = imageRefs.findIndex((r) => r.role === 'styl')
  const refsNote = describeReferences(effectiveRefs)
  const overlayNote = describeOverlays(overlays)
  const visualNote = visual ? 'Stwórz kolejny projekt z tej samej serii co wzorce stylu. Główny wzorzec wyznacza podstawową kompozycję i typografię, pozostałe uzupełniają wspólne cechy. Treść i jawne zmiany określa polecenie użytkownika; tożsamość osoby i logo określają osobne obrazy z tymi rolami. ' + (style?.referencePriority === 'description' ? 'Opis stylu poniżej określa świadome odstępstwa od wzorców.' : 'Wygląd odczytaj z obrazów; zachowaj ich typografię, stylistykę i gęstość kompozycji zamiast zastępować projekt ogólną fotografią.') : ''
  const primaryNote = visual ? `Główny wzorzec stylu to obraz nr ${primaryIndex + 1}; to on rozstrzyga różnice w układzie i typografii między wzorcami.` : ''
  const fidelity = visual ? (style?.strength === 'lekki' ? 'Dopuszczaj luźniejsze wariacje układu przy zachowaniu rozpoznawalnych cech wzorca.' : style?.strength === 'mocny' ? 'Wierność wzorcowi ma najwyższy priorytet wizualny: zachowaj proporcje, typografię i układ możliwie najdokładniej; zmieniaj tylko treść i elementy wskazane przez użytkownika.' : 'Zachowaj wyraźne podobieństwo typografii i kompozycji; dopasuj układ tylko tyle, ile wymaga nowa treść.') : ''
  const withRefs = [base, refsNote, visualNote, primaryNote, fidelity, overlayNote].filter(Boolean).join('\n\n')
  return withStyle(withRefs, style, { visual })
}
