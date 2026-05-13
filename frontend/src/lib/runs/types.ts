export type RunState =
  | 'awaiting_input'
  | 'running'
  | 'awaiting_approval'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'archived'

export type RunEventKind =
  | 'phase_start'
  | 'phase_end'
  | 'agent_start'
  | 'tool_call'
  | 'tool_result'
  | 'model_request'
  | 'model_response'
  | 'approval_gate'
  | 'user_intervention'
  | 'error'

export type PhaseStatus = 'queued' | 'running' | 'done' | 'failed' | 'skipped'

export interface Run {
  id: string
  title: string | null
  project_id: string
  method_id: string | null
  state: RunState
  current_phase_id: string | null
  forked_from_event_id: string | null
  power_tools_enabled: boolean
  extra_data: Record<string, unknown>
  created_at: string | null
  updated_at: string | null
  completed_at: string | null
}

export interface RunPhase {
  id: string
  run_id: string
  index: number
  name: string
  agent_role: string | null
  model_id: string | null
  status: PhaseStatus
  started_at: string | null
  ended_at: string | null
}

export interface RunMessage {
  id: string
  run_id: string
  role: string
  content: string
  image_url: string | null
  created_at: string | null
}

export interface RunEventSummary {
  id: string
  run_id: string
  phase_id: string | null
  kind: RunEventKind
  summary: string
  duration_ms: number | null
  tokens_in: number | null
  tokens_out: number | null
  cost_usd: number | null
  created_at: string | null
}

export interface RunEventFull extends RunEventSummary {
  payload: Record<string, unknown>
}

export interface RunDetail extends Run {
  phases: RunPhase[]
  messages: RunMessage[]
  events: RunEventSummary[]
}

export interface RunCreateInput {
  project_id?: string
  method_id?: string
  title?: string
}

export interface RunUpdateInput {
  title?: string
  power_tools_enabled?: boolean
}

export interface RunMessageInput {
  role?: string
  content: string
  image_url?: string
}

export const TERMINAL_STATES: ReadonlySet<RunState> = new Set<RunState>([
  'completed', 'failed', 'cancelled', 'archived',
])

export const ACTIVE_STATES: ReadonlySet<RunState> = new Set<RunState>([
  'awaiting_input', 'running', 'awaiting_approval', 'paused',
])
