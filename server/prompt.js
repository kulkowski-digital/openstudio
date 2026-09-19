import { buildPrompt as withStyle } from './styles.js'
import { describeReferences } from './reference-roles.js'

/**
 * JEDYNE miejsce, w którym powstaje prompt wysyłany do modelu.
 * Używa go generacja i „Pokaż pełny prompt”, więc podgląd nigdy nie rozjedzie
 * się z tym, co naprawdę poszło do API.
 *
 * Kolejność: to, co napisał użytkownik → co zrobić z załączonymi obrazami → styl.
 */
export function composePrompt({ userPrompt, references = [], style = null }) {
  const base = String(userPrompt || '').trim()
  const refsNote = describeReferences(references)
  const withRefs = [base, refsNote].filter(Boolean).join('\n\n')
  return withStyle(withRefs, style)
}
