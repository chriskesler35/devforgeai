// One predicate for "is this model usable at runtime right now?"
//
// Closes a class of bugs where UI surfaces represent capability the runtime
// can't deliver:
//
//   - Bug 1: Chat dropdown lists a model that's been deactivated server-side
//            since the dropdown was fetched. Submit goes through; backend
//            rejects with "Model 'UUID' matched but is inactive."
//
//   - Bug 2: Copilot's model catalog appends static-only entries (via the
//            `_from_static_catalog` flag) that aren't in the live API list
//            because the token lacks the right scope. Selecting one fails
//            at runtime with a 404 / scope error.
//
// Every model selector in the app (chat dropdown, persona forms, pipeline
// phase pickers, NowLive provider-state card) should consult this module
// rather than rolling its own check. New runtime gates (e.g., Responses-only
// transport) extend `Reason` here, not in each call site.

export type Reason =
  | 'missing'        // model is null/undefined or no longer in the dropdown's fetch
  | 'deactivated'    // model.is_active === false
  | 'catalog-only'   // model._from_static_catalog === true (live API doesn't list it)
  | 'no-longer-listed' // override references a model not in the current models[]

export interface ModelRuntimeView {
  id: string
  model_id: string
  provider_name?: string | null
  display_name?: string | null
  is_active: boolean
  /**
   * Backend marks fallback-catalog entries that the live provider API didn't
   * return (typical for github-copilot when the token lacks `copilot` scope).
   * Surfaced from /v1/models/sync in model_sync.py.
   */
  _from_static_catalog?: boolean
}

export interface UsabilityResult {
  usable: boolean
  reason?: Reason
}

export interface ValidationResult {
  valid: boolean
  reason?: Reason
  /** The matched model, if any — useful for showing the user what was rejected. */
  model?: ModelRuntimeView
}

/**
 * Test a single model record for runtime usability.
 *
 * Conservative: if the model is missing, deactivated, or catalog-only, it
 * fails closed. Callers can show the reason to explain the gating.
 */
export function isModelRuntimeUsable(
  model: ModelRuntimeView | null | undefined
): UsabilityResult {
  if (!model) return { usable: false, reason: 'missing' }
  if (!model.is_active) return { usable: false, reason: 'deactivated' }
  if (model._from_static_catalog) return { usable: false, reason: 'catalog-only' }
  return { usable: true }
}

/**
 * Validate a `model_override` value (the string the chat dropdown sends) against
 * the current models list. Three accepted formats:
 *   1. `''` → empty / no override (persona default) — always valid.
 *   2. `provider_name/model_id` → typical dropdown / `/model` slash command output.
 *   3. Bare UUID → defensive: backend resolver accepts UUIDs too.
 *
 * Returns `valid: false` with a specific reason when the override doesn't
 * point at a runtime-usable model. Callers decide what to do (toast + clear +
 * retry without override is the recommended UX).
 */
export function validateModelOverride(
  selectedModelId: string,
  models: ModelRuntimeView[]
): ValidationResult {
  if (!selectedModelId) return { valid: true }

  // Try provider/model_id match first (the dropdown's native format).
  const slashIdx = selectedModelId.indexOf('/')
  let match: ModelRuntimeView | undefined
  if (slashIdx >= 0) {
    const provider = selectedModelId.slice(0, slashIdx)
    const modelId = selectedModelId.slice(slashIdx + 1)
    match = models.find(
      (m) =>
        m.model_id === modelId &&
        (m.provider_name || 'unknown') === provider
    )
  }

  // Fallback: bare UUID or model_id match (slash command can send these).
  if (!match) {
    match = models.find((m) => m.id === selectedModelId || m.model_id === selectedModelId)
  }

  if (!match) {
    return { valid: false, reason: 'no-longer-listed' }
  }

  const usability = isModelRuntimeUsable(match)
  if (!usability.usable) {
    return { valid: false, reason: usability.reason, model: match }
  }

  return { valid: true, model: match }
}

/**
 * Human-readable explanation for each failure reason. Use when surfacing
 * a toast or status badge.
 */
export function explainReason(reason: Reason | undefined, modelLabel?: string): string {
  const label = modelLabel ? `"${modelLabel}"` : 'The selected model'
  switch (reason) {
    case 'missing':
      return `${label} is unavailable.`
    case 'deactivated':
      return `${label} has been deactivated. Falling back to persona default.`
    case 'catalog-only':
      return `${label} is in your provider's static catalog but not in the live API (token may lack the required scope). Falling back to persona default.`
    case 'no-longer-listed':
      return `${label} is no longer available. Falling back to persona default.`
    default:
      return `${label} is unavailable.`
  }
}
