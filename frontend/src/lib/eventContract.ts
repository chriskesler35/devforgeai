export interface CanonicalEventLike {
  type?: string | null
  canonical_type?: string | null
}

const DEFAULT_CANONICAL_EVENT_ALIAS: Record<string, string> = {
  'lifecycle.init': 'init',
  'lifecycle.ping': 'ping',
  'system.info': 'info',
  'system.warning': 'warning',
  'run.error': 'error',
  'run.done': 'done',
  'run.waiting': 'waiting',
  'run.model_changed': 'model_changed',
  'run.awaiting_approval': 'awaiting_approval',
  'user.message': 'user_message',
  'agent.role_change': 'role_change',
  'agent.thought': 'agent_thought',
  'agent.reply': 'agent_reply',
  'artifact.file_created': 'file_created',
  'artifact.file_modified': 'file_modified',
  'artifact.files_written': 'files_written',
  'command.awaiting_approval': 'command_awaiting_approval',
  'command.approved': 'command_approved',
  'command.rejected': 'command_rejected',
  'command.running': 'command_running',
  'command.completed': 'command_completed',
  'pipeline.created': 'pipeline_created',
  'pipeline.done': 'pipeline_done',
  'pipeline.retry': 'pipeline_retry',
  'phase.started': 'phase_started',
  'phase.progress': 'phase_progress',
  'phase.thinking': 'phase_thinking',
  'phase.completed': 'phase_completed',
  'phase.failed': 'phase_failed',
  'phase.retry': 'phase_retry',
  'phase.retry_exhausted': 'phase_retry_exhausted',
  'phase.skipped': 'phase_skipped',
  'phase.branch': 'phase_branch',
  'phase.model_changed': 'phase_model_changed',
  'phase.approved': 'phase_approved',
  'phase.rejected': 'phase_rejected',
}

export function resolveEventType(
  evt: CanonicalEventLike,
  overrides?: Record<string, string>,
): string {
  const canonicalType = evt?.canonical_type || ''
  if (canonicalType) {
    if (overrides && overrides[canonicalType]) {
      return overrides[canonicalType]
    }
    const mapped = DEFAULT_CANONICAL_EVENT_ALIAS[canonicalType]
    if (mapped) {
      return mapped
    }
  }

  return evt?.type || ''
}
