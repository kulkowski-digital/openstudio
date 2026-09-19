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
  const refsNote = describeReferences(references)
  const overlayNote = describeOverlays(overlays)
  const withRefs = [base, refsNote, overlayNote].filter(Boolean).join('\n\n')
  return withStyle(withRefs, style)
}
