import { getApiBase, getAuthHeaders } from '@/lib/config'
import type {
  Run,
  RunDetail,
  RunMessage,
  RunEventSummary,
  RunEventFull,
  RunCreateInput,
  RunUpdateInput,
  RunMessageInput,
} from './types'

const BASE = () => `${getApiBase()}/v1/runs`

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { ...getAuthHeaders(), ...init?.headers },
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw Object.assign(new Error(body.detail || `API ${res.status}`), {
      status: res.status,
      body,
    })
  }
  return res.json()
}

export async function createRun(input: RunCreateInput = {}): Promise<Run> {
  return request<Run>(BASE(), {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export async function listRuns(params: {
  project_id?: string
  state?: string
  active?: boolean
  limit?: number
  cursor?: string
} = {}): Promise<Run[]> {
  const qs = new URLSearchParams()
  if (params.project_id) qs.set('project_id', params.project_id)
  if (params.state) qs.set('state', params.state)
  if (params.active) qs.set('active', 'true')
  if (params.limit) qs.set('limit', String(params.limit))
  if (params.cursor) qs.set('cursor', params.cursor)
  return request<Run[]>(`${BASE()}?${qs}`)
}

export async function getRun(id: string): Promise<RunDetail> {
  return request<RunDetail>(`${BASE()}/${id}`)
}

export async function patchRun(id: string, input: RunUpdateInput): Promise<Run> {
  return request<Run>(`${BASE()}/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
}

export async function postMessage(runId: string, input: RunMessageInput): Promise<RunMessage> {
  return request<RunMessage>(`${BASE()}/${runId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ role: 'user', ...input }),
  })
}

export async function listMessages(runId: string, params?: {
  limit?: number
  cursor?: string
}): Promise<RunMessage[]> {
  const qs = new URLSearchParams()
  if (params?.limit) qs.set('limit', String(params.limit))
  if (params?.cursor) qs.set('cursor', params.cursor)
  return request<RunMessage[]>(`${BASE()}/${runId}/messages?${qs}`)
}

export async function listEvents(runId: string, params?: {
  phase_id?: string
  since?: string
  limit?: number
}): Promise<RunEventSummary[]> {
  const qs = new URLSearchParams()
  if (params?.phase_id) qs.set('phase_id', params.phase_id)
  if (params?.since) qs.set('since', params.since)
  if (params?.limit) qs.set('limit', String(params.limit))
  return request<RunEventSummary[]>(`${BASE()}/${runId}/events?${qs}`)
}

export async function getEvent(runId: string, eventId: string): Promise<RunEventFull> {
  return request<RunEventFull>(`${BASE()}/${runId}/events/${eventId}`)
}

export async function attachMethod(runId: string, methodId: string): Promise<Run> {
  return request<Run>(`${BASE()}/${runId}/attach-method`, {
    method: 'POST',
    body: JSON.stringify({ method_id: methodId }),
  })
}

export async function pauseRun(id: string): Promise<Run> {
  return request<Run>(`${BASE()}/${id}/pause`, { method: 'POST' })
}

export async function resumeRun(id: string): Promise<Run> {
  return request<Run>(`${BASE()}/${id}/resume`, { method: 'POST' })
}

export async function cancelRun(id: string): Promise<Run> {
  return request<Run>(`${BASE()}/${id}/cancel`, { method: 'POST' })
}

export async function archiveRun(id: string): Promise<Run> {
  return request<Run>(`${BASE()}/${id}/archive`, { method: 'POST' })
}

export async function deleteRun(id: string): Promise<void> {
  const res = await fetch(`${BASE()}/${id}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw Object.assign(new Error(body.detail || `API ${res.status}`), {
      status: res.status,
      body,
    })
  }
}

export async function bulkDeleteRuns(
  params: { ids?: string[]; state?: string; terminal?: boolean },
): Promise<{ deleted: number }> {
  return request<{ deleted: number }>(`${BASE()}/bulk-delete`, {
    method: 'POST',
    body: JSON.stringify(params),
  })
}

export async function approveRun(
  runId: string,
  phaseId: string,
  action: 'approve' | 'skip' | 'edit_brief',
  editPayload?: Record<string, unknown>,
): Promise<Run> {
  return request<Run>(`${BASE()}/${runId}/approve`, {
    method: 'POST',
    body: JSON.stringify({ phase_id: phaseId, action, edit_payload: editPayload }),
  })
}

export async function forkRun(runId: string, eventId: string): Promise<Run> {
  return request<Run>(`${BASE()}/${runId}/fork`, {
    method: 'POST',
    body: JSON.stringify({ event_id: eventId }),
  })
}

export async function editRetry(
  runId: string,
  eventId: string,
  newPrompt: string,
): Promise<RunEventSummary> {
  return request<RunEventSummary>(`${BASE()}/${runId}/events/${eventId}/edit-retry`, {
    method: 'POST',
    body: JSON.stringify({ new_prompt: newPrompt }),
  })
}

export async function lookupCompanionRun(
  legacyType: 'chat' | 'pipeline' | 'session',
  legacyId: string,
): Promise<{ run_id: string; created: boolean }> {
  const qs = new URLSearchParams({ type: legacyType, id: legacyId })
  return request<{ run_id: string; created: boolean }>(`${BASE()}/by-legacy?${qs}`)
}

export async function swapModel(
  runId: string,
  phaseId: string,
  modelId: string,
): Promise<unknown> {
  return request(`${BASE()}/${runId}/phases/${phaseId}/swap-model`, {
    method: 'POST',
    body: JSON.stringify({ model_id: modelId }),
  })
}
