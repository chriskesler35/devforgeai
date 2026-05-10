'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getApiBase, getAuthHeaders } from '@/lib/config'

type RunStatus = 'running' | 'stalled' | 'waiting_approval' | 'completed' | 'failed' | 'pending'
type RunType = 'pipeline' | 'session'

interface RunSummary {
  id: string
  type: RunType
  title: string
  method: string
  project: string
  status: RunStatus
  elapsed: string
  currentPhaseLabel: string
  phaseProgress: string
  tokens: { in: number; out: number }
  costUsd: number
}

interface ProviderState {
  id: string
  providerKey: string
  provider: string
  connection: 'oauth' | 'api-key' | 'local'
  status: 'connected' | 'degraded' | 'disconnected'
  selectedModel: string
  catalog: {
    live: number
    staticOnly: number
    refreshed: string
  }
  note?: string
}

const ACTIVE_SESSION_STATUSES = new Set(['running', 'pending', 'awaiting_approval'])
const ACTIVE_PIPELINE_STATUSES = new Set(['running', 'pending', 'paused', 'awaiting_approval'])
const LOCAL_PROVIDERS = new Set(['ollama', 'local', 'lm-studio', 'lmstudio', 'llamacpp', 'comfyui-local'])
const SYNC_PROVIDER_ALIASES: Record<string, string> = {
  local: 'ollama',
  'lm-studio': 'ollama',
  lmstudio: 'ollama',
  llamacpp: 'ollama',
}
const DISCONNECT_PROVIDER_ALIASES: Record<string, string> = {
  'openai-codex': 'openai-oauth',
}
const DISCONNECTABLE_PROVIDER_KEYS = new Set([
  'anthropic',
  'google',
  'gemini',
  'openrouter',
  'openai',
  'github-copilot',
  'openai-oauth',
  'codex-proxy',
])

type ProviderActionFeedback = {
  tone: 'success' | 'error' | 'info'
  message: string
}

function timeAgo(dateStr?: string | null): string {
  if (!dateStr) return 'just now'
  const deltaMs = Math.max(0, Date.now() - new Date(dateStr).getTime())
  const s = Math.floor(deltaMs / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function elapsedFrom(startedAt?: string | null): string {
  if (!startedAt) return '0m 00s'
  const ms = Math.max(0, Date.now() - new Date(startedAt).getTime())
  const total = Math.floor(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}m ${String(s).padStart(2, '0')}s`
}

function StatusDot({ status }: { status: RunStatus | 'done' | 'queued' | 'failed' | 'completed' }) {
  const map: Record<string, string> = {
    running: 'bg-emerald-500 animate-pulse',
    stalled: 'bg-amber-500 animate-pulse',
    waiting_approval: 'bg-indigo-500 animate-pulse',
    pending: 'bg-blue-500 animate-pulse',
    completed: 'bg-gray-400',
    done: 'bg-gray-400',
    failed: 'bg-red-500',
    queued: 'bg-gray-300 dark:bg-gray-600',
  }
  return <span className={`inline-block w-2 h-2 rounded-full ${map[status] ?? 'bg-gray-400'}`} />
}

export function NowLauncher({ collapsed = false }: { collapsed?: boolean }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [runs, setRuns] = useState<RunSummary[]>([])
  const [providers, setProviders] = useState<ProviderState[]>([])
  const [providerBusy, setProviderBusy] = useState<Record<string, boolean>>({})
  const [providerFeedback, setProviderFeedback] = useState<Record<string, ProviderActionFeedback>>({})
  const [selectedRunId, setSelectedRunId] = useState<string>('')
  const [selectedDetail, setSelectedDetail] = useState<any>(null)

  const selectedRun = useMemo(
    () => runs.find(r => r.id === selectedRunId) ?? runs[0] ?? null,
    [runs, selectedRunId],
  )

  const fetchNowData = useCallback(async () => {
    setLoading(true)
    const apiBase = getApiBase()
    const headers = getAuthHeaders()

    try {
      const [sessionRes, pipelineRes, providerRes, capabilityRes, modelRes] = await Promise.all([
        fetch(`${apiBase}/v1/workbench/sessions`, { headers }).then(r => (r.ok ? r.json() : { data: [] })).catch(() => ({ data: [] })),
        fetch(`${apiBase}/v1/workbench/pipelines`, { headers }).then(r => (r.ok ? r.json() : { data: [] })).catch(() => ({ data: [] })),
        fetch(`${apiBase}/v1/providers?active_only=false`, { headers }).then(r => (r.ok ? r.json() : { data: [] })).catch(() => ({ data: [] })),
        fetch(`${apiBase}/v1/runtime/provider-capabilities`, { headers }).then(r => (r.ok ? r.json() : { providers: {} })).catch(() => ({ providers: {} })),
        fetch(`${apiBase}/v1/models?limit=500&active_only=false`, { headers }).then(r => (r.ok ? r.json() : { data: [] })).catch(() => ({ data: [] })),
      ])

      const pipelineRows = Array.isArray(pipelineRes?.data) ? pipelineRes.data : []
      const sessionRows = Array.isArray(sessionRes?.data) ? sessionRes.data : []
      const providerRows = Array.isArray(providerRes?.data) ? providerRes.data : []
      const modelRows = Array.isArray(modelRes?.data) ? modelRes.data : []
      const capsByName = capabilityRes?.providers || {}

      const pipelineSessionIds = new Set(
        pipelineRows
          .map((p: any) => String(p?.session_id || ''))
          .filter(Boolean),
      )

      const pipelineRuns: RunSummary[] = pipelineRows
        .filter((p: any) => ACTIVE_PIPELINE_STATUSES.has(String(p?.status || '')))
        .map((p: any) => {
          const phases = Array.isArray(p?.phases) ? p.phases : []
          const idx = Number.isFinite(p?.current_phase_index) ? Number(p.current_phase_index) : 0
          const activePhase = phases[idx] || phases[0] || null
          return {
            id: `pipeline:${p.id}`,
            type: 'pipeline',
            title: p?.initial_task || `${String(p?.method_id || 'pipeline').toUpperCase()} run`,
            method: String(p?.method_id || 'pipeline').toUpperCase(),
            project: p?.session_id ? `session ${String(p.session_id).slice(0, 8)}` : 'workspace',
            status: p?.status === 'awaiting_approval' ? 'waiting_approval' : (p?.status || 'running'),
            elapsed: elapsedFrom(p?.created_at),
            currentPhaseLabel: activePhase?.name || 'Pending',
            phaseProgress: `${Math.max(1, idx + 1)}/${Math.max(1, phases.length)}`,
            tokens: { in: 0, out: 0 },
            costUsd: 0,
          }
        })

      const sessionRuns: RunSummary[] = sessionRows
        .filter((s: any) => ACTIVE_SESSION_STATUSES.has(String(s?.status || '')))
        .filter((s: any) => !pipelineSessionIds.has(String(s?.id || '')))
        .map((s: any) => ({
          id: `session:${s.id}`,
          type: 'session',
          title: s?.task || `${String(s?.agent_type || 'agent')} run`,
          method: String(s?.agent_type || 'agent').toUpperCase(),
          project: s?.project_id ? `project ${String(s.project_id).slice(0, 8)}` : 'workspace',
          status: s?.status === 'awaiting_approval' ? 'waiting_approval' : (s?.status || 'running'),
          elapsed: elapsedFrom(s?.started_at || s?.created_at),
          currentPhaseLabel: s?.status === 'waiting' ? 'Idle' : 'Executing',
          phaseProgress: s?.status === 'pending' ? '0/1' : '1/1',
          tokens: {
            in: Number(s?.input_tokens || 0),
            out: Number(s?.output_tokens || 0),
          },
          costUsd: Number(s?.estimated_cost || 0),
        }))

      const mergedRuns = [...pipelineRuns, ...sessionRuns]
      setRuns(mergedRuns)
      if (!selectedRunId && mergedRuns[0]) {
        setSelectedRunId(mergedRuns[0].id)
      }

      const modelsByProvider = modelRows.reduce((acc: Record<string, any[]>, m: any) => {
        const key = String(m?.provider_name || '').toLowerCase().trim()
        if (!key) return acc
        if (!acc[key]) acc[key] = []
        acc[key].push(m)
        return acc
      }, {})

      const providerStates: ProviderState[] = providerRows.map((p: any) => {
        const key = String(p?.name || '').toLowerCase().trim()
        const cap = capsByName[key] || {}
        const providerModels = modelsByProvider[key] || []
        const liveCount = providerModels.filter((m: any) => m?.is_active && (m?.validation_status || 'unverified') === 'validated').length
        const discoveredCount = Number(cap?.model_count || 0)
        const staticOnly = Math.max(0, discoveredCount - liveCount)

        let status: ProviderState['status'] = 'connected'
        if (!p?.is_active || cap?.has_credentials === false) {
          status = 'disconnected'
        } else if (cap?.catalog_source === 'error' || cap?.catalog_source === 'not_available') {
          status = 'degraded'
        }

        const selectedModel = providerModels.find((m: any) => m?.is_active)?.model_id || '—'

        let note: string | undefined
        if (cap?.probe_error) {
          note = String(cap.probe_error)
        } else if (cap?.catalog_source === 'cache') {
          note = 'Using cached provider catalog snapshot.'
        }

        return {
          id: String(p?.id || key),
          providerKey: key,
          provider: String(p?.display_name || p?.name || 'Provider'),
          connection: LOCAL_PROVIDERS.has(key)
            ? 'local'
            : cap?.oauth_configured
            ? 'oauth'
            : 'api-key',
          status,
          selectedModel,
          catalog: {
            live: liveCount,
            staticOnly,
            refreshed: timeAgo(capabilityRes?.checked_at),
          },
          note,
        }
      })

      setProviders(providerStates)
    } finally {
      setLoading(false)
    }
  }, [selectedRunId])

  const fetchSelectedDetail = useCallback(async (run: RunSummary | null) => {
    if (!run) {
      setSelectedDetail(null)
      return
    }
    const apiBase = getApiBase()
    const headers = getAuthHeaders()

    const [runType, id] = run.id.split(':')
    if (!id) return

    try {
      if (runType === 'pipeline') {
        const detail = await fetch(`${apiBase}/v1/workbench/pipelines/${id}`, { headers }).then(r => (r.ok ? r.json() : null))
        setSelectedDetail(detail)
      } else {
        const detail = await fetch(`${apiBase}/v1/workbench/sessions/${id}`, { headers }).then(r => (r.ok ? r.json() : null))
        setSelectedDetail(detail)
      }
    } catch {
      setSelectedDetail(null)
    }
  }, [])

  useEffect(() => {
    fetchNowData()
    const timer = setInterval(fetchNowData, 10000)
    return () => clearInterval(timer)
  }, [fetchNowData])

  useEffect(() => {
    fetchSelectedDetail(selectedRun)
  }, [fetchSelectedDetail, selectedRun])

  const performProviderReconnect = useCallback(async (provider: ProviderState) => {
    const providerKey = provider.providerKey.toLowerCase().trim()
    const syncKey = SYNC_PROVIDER_ALIASES[providerKey] || providerKey

    if (providerKey === 'comfyui-local') {
      setOpen(false)
      router.push('/settings')
      return
    }

    setProviderBusy((prev) => ({ ...prev, [provider.id]: true }))
    setProviderFeedback((prev) => {
      const next = { ...prev }
      delete next[provider.id]
      return next
    })

    try {
      const apiBase = getApiBase()
      const headers = getAuthHeaders()
      const res = await fetch(`${apiBase}/v1/models/sync/provider/${encodeURIComponent(syncKey)}`, {
        method: 'POST',
        headers,
      })
      const payload = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(payload?.detail || payload?.message || `Could not sync ${provider.provider}`)
      }

      await fetchNowData()
      setProviderFeedback((prev) => ({
        ...prev,
        [provider.id]: {
          tone: 'success',
          message: payload?.message || `${provider.provider} reconnected and refreshed.`,
        },
      }))
    } catch (error: any) {
      setProviderFeedback((prev) => ({
        ...prev,
        [provider.id]: {
          tone: 'error',
          message: error?.message || `Reconnect failed for ${provider.provider}.`,
        },
      }))
    } finally {
      setProviderBusy((prev) => ({ ...prev, [provider.id]: false }))
    }
  }, [fetchNowData, router])

  const performProviderDisconnect = useCallback(async (provider: ProviderState) => {
    const providerKey = provider.providerKey.toLowerCase().trim()
    const disconnectKey = DISCONNECT_PROVIDER_ALIASES[providerKey] || providerKey

    if (!DISCONNECTABLE_PROVIDER_KEYS.has(disconnectKey)) {
      setOpen(false)
      router.push('/settings')
      return
    }

    setProviderBusy((prev) => ({ ...prev, [provider.id]: true }))
    setProviderFeedback((prev) => {
      const next = { ...prev }
      delete next[provider.id]
      return next
    })

    try {
      const apiBase = getApiBase()
      const headers = getAuthHeaders()

      const impactRes = await fetch(`${apiBase}/v1/api-keys/${encodeURIComponent(disconnectKey)}/clear-impact`, { headers })
      const impact = await impactRes.json().catch(() => ({}))
      if (!impactRes.ok) {
        throw new Error(impact?.detail || `Could not inspect disconnect impact for ${provider.provider}`)
      }

      const affectedModels = Array.isArray(impact?.affected_models) ? impact.affected_models.length : 0
      const affectedPersonas = Array.isArray(impact?.affected_personas) ? impact.affected_personas.length : 0
      const affectedAgents = Array.isArray(impact?.affected_agents) ? impact.affected_agents.length : 0
      const confirmed = window.confirm(
        `Disconnect ${provider.provider}?\n\n` +
        `${affectedModels} active model(s) will be deactivated.\n` +
        `${affectedPersonas} persona reference(s) and ${affectedAgents} agent reference(s) may be reassigned/cleared.`
      )
      if (!confirmed) {
        setProviderFeedback((prev) => ({
          ...prev,
          [provider.id]: {
            tone: 'info',
            message: 'Disconnect cancelled.',
          },
        }))
        return
      }

      const clearRes = await fetch(`${apiBase}/v1/api-keys/${encodeURIComponent(disconnectKey)}`, {
        method: 'DELETE',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: true }),
      })
      const clearPayload = await clearRes.json().catch(() => ({}))
      if (!clearRes.ok) {
        throw new Error(clearPayload?.detail?.message || clearPayload?.detail || clearPayload?.message || `Could not disconnect ${provider.provider}`)
      }

      await fetchNowData()
      const deactivated = Number(clearPayload?.deactivated_models || 0)
      setProviderFeedback((prev) => ({
        ...prev,
        [provider.id]: {
          tone: 'success',
          message: `${provider.provider} disconnected. ${deactivated} model(s) deactivated.`,
        },
      }))
    } catch (error: any) {
      setProviderFeedback((prev) => ({
        ...prev,
        [provider.id]: {
          tone: 'error',
          message: error?.message || `Disconnect failed for ${provider.provider}.`,
        },
      }))
    } finally {
      setProviderBusy((prev) => ({ ...prev, [provider.id]: false }))
    }
  }, [fetchNowData, router])

  const runningCount = runs.filter(r => r.status === 'running' || r.status === 'pending').length
  const stalledCount = runs.filter(r => r.status === 'stalled').length
  const primary = selectedRun || runs[0]

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title={collapsed ? 'Now' : undefined}
        className={`group inline-flex items-center gap-2 rounded-full border transition-colors text-xs ${
          collapsed
            ? 'w-9 h-9 justify-center mx-auto bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700'
            : 'h-8 pl-2 pr-3 bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800 hover:border-emerald-400 dark:hover:border-emerald-500'
        }`}
      >
        <StatusDot status={stalledCount > 0 ? 'stalled' : 'running'} />
        {!collapsed && (
          <>
            <span className="font-semibold text-gray-700 dark:text-gray-200">
              {loading ? 'Loading…' : `${runningCount} running${stalledCount > 0 ? ` · ${stalledCount} stalled` : ''}`}
            </span>
            {primary && (
              <>
                <span className="text-gray-400 dark:text-gray-500">·</span>
                <span className="text-gray-500 dark:text-gray-400 truncate max-w-[160px]">
                  {primary.method} · {primary.currentPhaseLabel} {primary.phaseProgress} · {primary.elapsed}
                </span>
              </>
            )}
          </>
        )}
      </button>

      {!open ? null : (
        <div className="fixed inset-0 z-50 flex">
          <div className="flex-1 bg-black/40" onClick={() => setOpen(false)} />
          <aside className="w-[860px] max-w-[95vw] h-full bg-white dark:bg-gray-950 border-l border-gray-200 dark:border-gray-800 shadow-2xl flex flex-col">
            <div className="px-5 py-3 border-b border-gray-200 dark:border-gray-800 flex items-center gap-3">
              <span className="text-emerald-500 text-lg">🟢</span>
              <h2 className="font-semibold text-gray-800 dark:text-gray-100">Now</h2>
              <span className="text-xs text-gray-400">{runs.length} active runs · {providers.length} providers</span>
              <div className="ml-auto flex items-center gap-2">
                <button onClick={fetchNowData} className="text-xs text-gray-500 hover:text-gray-800 dark:hover:text-gray-200">Refresh</button>
                <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-lg leading-none">×</button>
              </div>
            </div>

            <div className="flex-1 grid grid-cols-[280px_1fr] overflow-hidden">
              <div className="border-r border-gray-200 dark:border-gray-800 overflow-y-auto">
                <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Active Runs</div>
                {runs.length === 0 && <div className="px-3 py-3 text-xs text-gray-500">No active runs.</div>}
                {runs.map(run => (
                  <button
                    key={run.id}
                    onClick={() => setSelectedRunId(run.id)}
                    className={`w-full text-left px-3 py-2.5 border-l-2 transition-colors ${
                      run.id === (selectedRun?.id || '')
                        ? 'border-emerald-500 bg-emerald-50/50 dark:bg-emerald-900/10'
                        : 'border-transparent hover:bg-gray-50 dark:hover:bg-gray-900'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <StatusDot status={run.status} />
                      <span className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{run.title}</span>
                    </div>
                    <div className="text-[11px] text-gray-500 dark:text-gray-400">
                      {run.method} · {run.currentPhaseLabel} {run.phaseProgress} · {run.elapsed}
                    </div>
                  </button>
                ))}
              </div>

              <div className="overflow-y-auto">
                <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-800">
                  <h3 className="text-base font-semibold text-gray-800 dark:text-gray-100">{selectedRun?.title || 'No run selected'}</h3>
                  {selectedRun && (
                    <p className="text-xs text-gray-500 mt-1">
                      <span className="font-mono">{selectedRun.method}</span>
                      <span className="mx-1.5">·</span>
                      <span>{selectedRun.project}</span>
                      <span className="mx-1.5">·</span>
                      <span>{selectedRun.elapsed} elapsed</span>
                    </p>
                  )}
                  {selectedRun && (
                    <div className="mt-2 flex items-center gap-4 text-[11px] text-gray-500 dark:text-gray-400">
                      <span>📥 {selectedRun.tokens.in.toLocaleString()} in</span>
                      <span>📤 {selectedRun.tokens.out.toLocaleString()} out</span>
                      <span>💵 ${selectedRun.costUsd.toFixed(3)}</span>
                    </div>
                  )}
                </div>

                <div className="px-5 py-3 border-b border-gray-200 dark:border-gray-800">
                  <div className="text-[10px] uppercase tracking-wider text-gray-400 mb-2">Run detail</div>
                  {!selectedDetail && <div className="text-xs text-gray-500">Loading detail…</div>}
                  {selectedDetail?.phase_runs && (
                    <div className="space-y-1.5">
                      {(selectedDetail.phase_runs as any[]).slice(-8).map((pr: any) => (
                        <div key={pr.id} className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
                          <StatusDot status={pr.status === 'approved' ? 'done' : pr.status === 'awaiting_approval' ? 'waiting_approval' : pr.status === 'running' ? 'running' : pr.status === 'failed' ? 'failed' : 'queued'} />
                          <span className="font-medium">{pr.phase_name}</span>
                          <span className="text-gray-400">·</span>
                          <span>{pr.status}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {selectedDetail?.events_log && (
                    <div className="space-y-1.5">
                      {(selectedDetail.events_log as any[]).slice(-10).map((evt: any, i: number) => (
                        <div key={`${i}-${evt?.type || 'evt'}`} className="text-xs text-gray-600 dark:text-gray-300">
                          <span className="text-gray-400 mr-1">{evt?.type || 'event'}:</span>
                          <span>{evt?.payload?.message || evt?.payload?.thought || evt?.payload?.path || '…'}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="px-5 py-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-[10px] uppercase tracking-wider text-gray-400">Provider runtime state</div>
                    <div className="text-[11px] text-gray-500">Live vs static catalog visibility</div>
                  </div>
                  <div className="space-y-2">
                    {providers.map(p => {
                      const actionBusy = Boolean(providerBusy[p.id])
                      const feedback = providerFeedback[p.id]
                      const statusTone =
                        p.status === 'connected'
                          ? 'text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 dark:text-emerald-300'
                          : p.status === 'degraded'
                          ? 'text-amber-700 bg-amber-50 dark:bg-amber-900/20 dark:text-amber-300'
                          : 'text-red-700 bg-red-50 dark:bg-red-900/20 dark:text-red-300'
                      const feedbackTone =
                        feedback?.tone === 'success'
                          ? 'text-emerald-700 dark:text-emerald-300'
                          : feedback?.tone === 'error'
                          ? 'text-red-700 dark:text-red-300'
                          : 'text-gray-600 dark:text-gray-300'

                      return (
                        <div key={p.id} className="rounded-md border border-gray-200 dark:border-gray-800 p-2.5">
                          <div className="flex items-center justify-between gap-2 mb-1.5">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-gray-800 dark:text-gray-200">{p.provider}</span>
                              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-500">{p.connection}</span>
                              <span className={`text-[10px] px-1.5 py-0.5 rounded ${statusTone}`}>{p.status}</span>
                            </div>
                            <div className="flex items-center gap-1 text-[10px]">
                              <button
                                disabled={actionBusy}
                                onClick={() => void performProviderReconnect(p)}
                                className="px-1.5 py-0.5 rounded border border-gray-200 dark:border-gray-700 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 disabled:opacity-50"
                              >{actionBusy ? 'Working…' : 'Reconnect'}</button>
                              <button
                                disabled={actionBusy}
                                onClick={fetchNowData}
                                className="px-1.5 py-0.5 rounded border border-gray-200 dark:border-gray-700 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 disabled:opacity-50"
                              >Refresh</button>
                              <button
                                disabled={actionBusy}
                                onClick={() => void performProviderDisconnect(p)}
                                className="px-1.5 py-0.5 rounded border border-gray-200 dark:border-gray-700 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 disabled:opacity-50"
                              >Disconnect</button>
                            </div>
                          </div>

                          <div className="grid grid-cols-4 gap-2 text-[11px] text-gray-500 dark:text-gray-400">
                            <div>
                              <div className="text-gray-400">Selected model</div>
                              <div className="font-mono text-gray-700 dark:text-gray-300 truncate">{p.selectedModel}</div>
                            </div>
                            <div>
                              <div className="text-gray-400">Live models</div>
                              <div className="text-gray-700 dark:text-gray-300">{p.catalog.live}</div>
                            </div>
                            <div>
                              <div className="text-gray-400">Static-only</div>
                              <div className="text-gray-700 dark:text-gray-300">{p.catalog.staticOnly}</div>
                            </div>
                            <div>
                              <div className="text-gray-400">Catalog refresh</div>
                              <div className="text-gray-700 dark:text-gray-300">{p.catalog.refreshed}</div>
                            </div>
                          </div>

                          {p.note && <div className="mt-1.5 text-[10px] text-amber-700 dark:text-amber-300">{p.note}</div>}
                          {feedback && <div className={`mt-1.5 text-[10px] ${feedbackTone}`}>{feedback.message}</div>}
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            </div>
          </aside>
        </div>
      )}
    </>
  )
}
