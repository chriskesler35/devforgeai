import type { RunEventKind, RunEventSummary } from './types'

const KNOWN_KINDS: ReadonlySet<string> = new Set<RunEventKind>([
  'phase_start',
  'phase_end',
  'agent_start',
  'tool_call',
  'tool_result',
  'model_request',
  'model_response',
  'approval_gate',
  'user_intervention',
  'error',
])

export function normalizeEvent(raw: Record<string, unknown>): RunEventSummary | null {
  if (!raw || typeof raw.id !== 'string' || typeof raw.kind !== 'string') return null

  if (!KNOWN_KINDS.has(raw.kind as string)) {
    console.warn(`[eventContract] Unknown event kind: "${raw.kind}" — accepting for forward-compat`)
  }

  return {
    id: raw.id as string,
    run_id: (raw.run_id as string) ?? '',
    phase_id: (raw.phase_id as string) ?? null,
    kind: raw.kind as RunEventKind,
    summary: (raw.summary as string) ?? '',
    duration_ms: (raw.duration_ms as number) ?? null,
    tokens_in: (raw.tokens_in as number) ?? null,
    tokens_out: (raw.tokens_out as number) ?? null,
    cost_usd: (raw.cost_usd as number) ?? null,
    created_at: (raw.created_at as string) ?? null,
  }
}

export function isKnownKind(kind: string): kind is RunEventKind {
  return KNOWN_KINDS.has(kind)
}
