'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { API_BASE, AUTH_HEADERS } from '@/lib/config'

type Session = {
  id: string
  task: string
  agent_type: string
  model?: string | null
  status: string
  project_id?: string | null
  created_at?: string | null
}

type PipelinePhase = {
  name?: string
  role?: string
  model?: string | null
}

type Pipeline = {
  id: string
  session_id?: string | null
  initial_task: string
  method_id: string
  status: string
  current_phase_index: number
  phases: PipelinePhase[]
  created_at?: string | null
}

type RunRow =
  | { kind: 'pipeline'; id: string; title: string; status: string; created_at?: string | null; data: Pipeline }
  | { kind: 'session'; id: string; title: string; status: string; created_at?: string | null; data: Session }

type FlowNode = {
  name: string
  agent: string
  model: string
  state: 'queued' | 'running' | 'done' | 'failed' | 'waiting'
}

type RunEvent = {
  type: string
  ts?: string
  payload?: Record<string, any>
}

type PendingCommand = {
  command_id: string
  command: string
  tier?: string
}

type TimelineFilter = 'all' | 'state' | 'files' | 'approvals' | 'commands' | 'errors'

type FileDelta = {
  path: string
  action: 'created' | 'modified'
  ts?: string
  phase?: string
}

type ModelOption = {
  id: string
  model_id: string
  provider_name?: string | null
  display_name?: string | null
}

const STATE_STYLE: Record<FlowNode['state'], string> = {
  queued: 'bg-gray-100 text-gray-600 border-gray-200',
  running: 'bg-blue-50 text-blue-700 border-blue-200',
  done: 'bg-green-50 text-green-700 border-green-200',
  failed: 'bg-red-50 text-red-700 border-red-200',
  waiting: 'bg-amber-50 text-amber-700 border-amber-200',
}

const STATUS_STYLE: Record<string, string> = {
  pending: 'bg-yellow-50 text-yellow-700 border-yellow-200',
  running: 'bg-blue-50 text-blue-700 border-blue-200',
  paused: 'bg-slate-100 text-slate-700 border-slate-200',
  awaiting_approval: 'bg-amber-50 text-amber-700 border-amber-200',
  waiting: 'bg-amber-50 text-amber-700 border-amber-200',
  completed: 'bg-green-50 text-green-700 border-green-200',
  failed: 'bg-red-50 text-red-700 border-red-200',
  cancelled: 'bg-gray-100 text-gray-600 border-gray-200',
}

function prettyStatus(status: string): string {
  if (status === 'awaiting_approval') return 'Needs approval'
  if (status === 'completed') return 'Done'
  if (status === 'paused') return 'Paused'
  return status.replace('_', ' ')
}

function toFlowNodes(run: RunRow): FlowNode[] {
  if (run.kind === 'session') {
    const state: FlowNode['state'] = run.status === 'failed'
      ? 'failed'
      : run.status === 'completed'
      ? 'done'
      : run.status === 'running'
      ? 'running'
      : run.status === 'waiting' || run.status === 'awaiting_approval'
      ? 'waiting'
      : 'queued'

    return [{
      name: 'Session Task',
      agent: run.data.agent_type || 'agent',
      model: run.data.model || 'auto',
      state,
    }]
  }

  const total = run.data.phases?.length || 0
  const current = Math.max(0, run.data.current_phase_index || 0)
  const phases = total > 0 ? run.data.phases : [{ name: 'Phase 1', role: 'agent' }]

  return phases.map((phase, index) => {
    let state: FlowNode['state'] = 'queued'
    if (run.status === 'failed' && index === current) state = 'failed'
    else if (run.status === 'completed') state = 'done'
    else if (index < current) state = 'done'
    else if (index === current) {
      if (run.status === 'awaiting_approval' || run.status === 'waiting') state = 'waiting'
      else if (run.status === 'running') state = 'running'
      else state = 'queued'
    }

    return {
      name: phase.name || `Phase ${index + 1}`,
      agent: phase.role || 'agent',
      model: phase.model || 'auto',
      state,
    }
  })
}

function timeAgo(ts?: string | null): string {
  if (!ts) return '—'
  const diffMs = Date.now() - new Date(ts).getTime()
  const minutes = Math.floor(diffMs / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function eventLabel(evt: RunEvent): { title: string; detail: string; tone: 'neutral' | 'good' | 'warn' | 'bad' } {
  const p = evt.payload || {}
  switch (evt.type) {
    case 'pipeline_created':
      return { title: 'Pipeline created', detail: `${(p.phases || []).length || 0} phases queued.`, tone: 'neutral' }
    case 'phase_started':
      return { title: `${p.phase_name || 'Phase'} started`, detail: `${p.agent_role || 'Agent'} is now running.`, tone: 'neutral' }
    case 'phase_completed':
      return { title: `${p.phase_name || 'Phase'} completed`, detail: p.status === 'approved' ? 'Auto-approved and advanced.' : 'Ready for review.', tone: 'good' }
    case 'awaiting_approval':
      return { title: 'Awaiting approval', detail: p.message || 'Review required before continuing.', tone: 'warn' }
    case 'phase_failed':
      return { title: `${p.phase_name || 'Phase'} failed`, detail: p.error || 'Execution failed.', tone: 'bad' }
    case 'pipeline_retry':
    case 'phase_retry':
      return { title: 'Retry started', detail: p.message || 'Retrying failed work.', tone: 'warn' }
    case 'pipeline_done':
      return { title: 'Pipeline finished', detail: `Status: ${String(p.status || 'done')}`, tone: 'good' }
    case 'command_awaiting_approval':
      return { title: 'Command approval needed', detail: String(p.command || ''), tone: 'warn' }
    case 'command_completed':
      return { title: 'Command completed', detail: `${p.command || 'command'} (exit ${p.exit_code ?? '?'})`, tone: p.exit_code === 0 ? 'good' : 'bad' }
    case 'file_created':
      return { title: 'File created', detail: String(p.path || ''), tone: 'good' }
    case 'file_modified':
      return { title: 'File modified', detail: String(p.path || ''), tone: 'neutral' }
    case 'waiting':
      return { title: 'Waiting for input', detail: p.message || 'Session is waiting for your next instruction.', tone: 'warn' }
    case 'done':
      return { title: 'Turn completed', detail: `Status: ${String(p.status || 'completed')}`, tone: 'good' }
    case 'error':
      return { title: 'Error', detail: p.message || p.error || 'An error was reported.', tone: 'bad' }
    case 'info':
      return { title: 'Update', detail: p.message || 'Info event', tone: 'neutral' }
    default:
      return { title: evt.type.replace(/_/g, ' '), detail: p.message || p.phase_name || p.command || 'Event received.', tone: 'neutral' }
  }
}

function eventToneClass(tone: 'neutral' | 'good' | 'warn' | 'bad'): string {
  if (tone === 'good') return 'border-green-200 bg-green-50 dark:bg-green-900/20'
  if (tone === 'warn') return 'border-amber-200 bg-amber-50 dark:bg-amber-900/20'
  if (tone === 'bad') return 'border-red-200 bg-red-50 dark:bg-red-900/20'
  return 'border-gray-200 bg-white dark:bg-gray-800'
}

function eventTime(ts?: string): string {
  if (!ts) return 'now'
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return 'now'
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })
}

function eventAgeSeconds(ts?: string): number | null {
  if (!ts) return null
  const ms = new Date(ts).getTime()
  if (Number.isNaN(ms)) return null
  return Math.max(0, Math.floor((Date.now() - ms) / 1000))
}

export default function RunsPage() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [pipelines, setPipelines] = useState<Pipeline[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string>('')
  const [events, setEvents] = useState<RunEvent[]>([])
  const [timelineFilter, setTimelineFilter] = useState<TimelineFilter>('all')
  const [models, setModels] = useState<ModelOption[]>([])
  const [launchModel, setLaunchModel] = useState('')
  const [loadingModels, setLoadingModels] = useState(false)
  const [acting, setActing] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const streamRef = useRef<EventSource | null>(null)

  const loadRuns = useCallback(async () => {
    const [sessRes, pipeRes] = await Promise.all([
      fetch(`${API_BASE}/v1/workbench/sessions`, { headers: AUTH_HEADERS }),
      fetch(`${API_BASE}/v1/workbench/pipelines`, { headers: AUTH_HEADERS }),
    ])
    const sessPayload = await sessRes.json().catch(() => ({ data: [] }))
    const pipePayload = await pipeRes.json().catch(() => ({ data: [] }))
    setSessions(Array.isArray(sessPayload.data) ? sessPayload.data : [])
    setPipelines(Array.isArray(pipePayload.data) ? pipePayload.data : [])
  }, [])

  useEffect(() => {
    let mounted = true
    const load = async () => {
      try {
        await loadRuns()
      } finally {
        if (mounted) setLoading(false)
      }
    }
    load()
    const timer = window.setInterval(load, 8000)
    return () => {
      mounted = false
      window.clearInterval(timer)
    }
  }, [loadRuns])

  useEffect(() => {
    let mounted = true
    const loadModels = async () => {
      setLoadingModels(true)
      try {
        const res = await fetch(
          `${API_BASE}/v1/models?active_only=true&usable_only=true&validated_only=true&chat_only=true&limit=250`,
          { headers: AUTH_HEADERS },
        )
        const payload = await res.json().catch(() => ({ data: [] }))
        if (!mounted) return
        setModels(Array.isArray(payload?.data) ? payload.data as ModelOption[] : [])
      } finally {
        if (mounted) setLoadingModels(false)
      }
    }
    loadModels()
    return () => { mounted = false }
  }, [])

  const sessionById = useMemo(() => {
    return new Map(sessions.map((session) => [session.id, session]))
  }, [sessions])

  const runs = useMemo<RunRow[]>(() => {
    const pipelineRows: RunRow[] = pipelines.map((pipeline) => ({
      kind: 'pipeline',
      id: `pipeline:${pipeline.id}`,
      title: pipeline.initial_task,
      status: pipeline.status,
      created_at: pipeline.created_at,
      data: pipeline,
    }))

    const pipedSessionIds = new Set(
      pipelines
        .map((pipeline) => pipeline.session_id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    )

    const standaloneSessions: RunRow[] = sessions
      .filter((session) => !pipedSessionIds.has(session.id))
      .map((session) => ({
        kind: 'session',
        id: `session:${session.id}`,
        title: session.task,
        status: session.status,
        created_at: session.created_at,
        data: session,
      }))

    return [...pipelineRows, ...standaloneSessions].sort((a, b) => {
      const aTs = new Date(a.created_at || 0).getTime()
      const bTs = new Date(b.created_at || 0).getTime()
      return bTs - aTs
    })
  }, [pipelines, sessions])

  useEffect(() => {
    if (!selectedId && runs.length > 0) {
      setSelectedId(runs[0].id)
      return
    }
    if (selectedId && runs.every((run) => run.id !== selectedId)) {
      setSelectedId(runs[0]?.id || '')
    }
  }, [runs, selectedId])

  const selected = runs.find((run) => run.id === selectedId) || null
  const flowNodes = selected ? toFlowNodes(selected) : []

  useEffect(() => {
    setEvents([])
    streamRef.current?.close()
    streamRef.current = null

    if (!selected) return

    const target = selected.kind === 'session'
      ? `${API_BASE}/v1/workbench/sessions/${selected.data.id}/stream`
      : `${API_BASE}/v1/workbench/pipelines/${selected.data.id}/stream`

    const es = new EventSource(target)
    streamRef.current = es

    es.onmessage = (raw) => {
      try {
        const evt = JSON.parse(raw.data) as RunEvent
        if (evt.type === 'ping') return
        if (evt.type === 'init') {
          const initialEvents = Array.isArray((evt.payload as any)?.events_log)
            ? ((evt.payload as any).events_log as RunEvent[])
            : []
          setEvents(initialEvents.slice(-120))
          return
        }
        setEvents((prev) => [...prev, evt].slice(-120))
      } catch {
        // Ignore malformed events.
      }
    }

    return () => {
      es.close()
      if (streamRef.current === es) streamRef.current = null
    }
  }, [selected])

  const linkedProjectId = selected
    ? selected.kind === 'session'
      ? selected.data.project_id
      : selected.data.session_id
      ? sessionById.get(selected.data.session_id)?.project_id
      : null
    : null

  const byAgent = useMemo(() => {
    const map = new Map<string, { total: number; done: number; active: number; failed: number }>()
    for (const node of flowNodes) {
      const key = node.agent || 'agent'
      if (!map.has(key)) {
        map.set(key, { total: 0, done: 0, active: 0, failed: 0 })
      }
      const row = map.get(key)!
      row.total += 1
      if (node.state === 'done') row.done += 1
      if (node.state === 'running' || node.state === 'waiting') row.active += 1
      if (node.state === 'failed') row.failed += 1
    }
    return Array.from(map.entries())
  }, [flowNodes])

  const pendingCommands = useMemo<PendingCommand[]>(() => {
    if (!selected || selected.kind !== 'session') return []
    const pending = new Map<string, PendingCommand>()
    for (const evt of events) {
      if (evt.type === 'command_awaiting_approval') {
        const id = String(evt.payload?.command_id || '')
        const command = String(evt.payload?.command || '')
        if (!id || !command) continue
        pending.set(id, {
          command_id: id,
          command,
          tier: evt.payload?.tier ? String(evt.payload.tier) : undefined,
        })
      }
      if (evt.type === 'command_approved' || evt.type === 'command_rejected' || evt.type === 'command_completed') {
        const id = String(evt.payload?.command_id || '')
        if (id) pending.delete(id)
      }
    }
    return Array.from(pending.values())
  }, [events, selected])

  const runAction = useCallback(async (request: () => Promise<Response>) => {
    setActing(true)
    setActionError(null)
    try {
      const res = await request()
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        throw new Error(`HTTP ${res.status}${body ? `: ${body.slice(0, 180)}` : ''}`)
      }
      await loadRuns()
    } catch (err: any) {
      setActionError(err?.message || 'Action failed')
    } finally {
      setActing(false)
    }
  }, [loadRuns])

  const stopSelectedRun = useCallback(() => {
    if (!selected) return
    const ok = window.confirm('Stop this run?')
    if (!ok) return

    if (selected.kind === 'pipeline' && selected.status === 'running') {
      runAction(() => fetch(`${API_BASE}/v1/workbench/pipelines/${selected.data.id}/pause`, {
        method: 'POST', headers: AUTH_HEADERS,
      }))
      return
    }

    runAction(() => fetch(
      selected.kind === 'session'
        ? `${API_BASE}/v1/workbench/sessions/${selected.data.id}/cancel`
        : `${API_BASE}/v1/workbench/pipelines/${selected.data.id}/cancel`,
      { method: 'POST', headers: AUTH_HEADERS },
    ))
  }, [runAction, selected])

  const abortSelectedRun = useCallback(() => {
    if (!selected) return
    const ok = window.confirm('Abort this run immediately?')
    if (!ok) return
    runAction(() => fetch(
      selected.kind === 'session'
        ? `${API_BASE}/v1/workbench/sessions/${selected.data.id}/cancel`
        : `${API_BASE}/v1/workbench/pipelines/${selected.data.id}/cancel`,
      { method: 'POST', headers: AUTH_HEADERS },
    ))
  }, [runAction, selected])

  const resetSelectedRun = useCallback(async () => {
    if (!selected) return
    const ok = window.confirm('Reset this run? This will remove the run record so you can start clean.')
    if (!ok) return

    setActing(true)
    setActionError(null)
    try {
      if (['pending', 'running', 'waiting', 'awaiting_approval', 'paused'].includes(selected.status)) {
        await fetch(
          selected.kind === 'session'
            ? `${API_BASE}/v1/workbench/sessions/${selected.data.id}/cancel`
            : `${API_BASE}/v1/workbench/pipelines/${selected.data.id}/cancel`,
          { method: 'POST', headers: AUTH_HEADERS },
        )
      }

      const delRes = await fetch(
        selected.kind === 'session'
          ? `${API_BASE}/v1/workbench/sessions/${selected.data.id}`
          : `${API_BASE}/v1/workbench/pipelines/${selected.data.id}`,
        { method: 'DELETE', headers: AUTH_HEADERS },
      )
      if (!delRes.ok) {
        const body = await delRes.text().catch(() => '')
        throw new Error(`HTTP ${delRes.status}${body ? `: ${body.slice(0, 180)}` : ''}`)
      }

      setSelectedId('')
      setEvents([])
      await loadRuns()
    } catch (err: any) {
      setActionError(err?.message || 'Reset failed')
    } finally {
      setActing(false)
    }
  }, [loadRuns, selected])

  const canStop = selected && ['pending', 'running', 'waiting', 'awaiting_approval', 'paused'].includes(selected.status)
  const canCompleteSession = selected?.kind === 'session' && selected.status === 'waiting'
  const canApprovePipeline = selected?.kind === 'pipeline' && selected.status === 'awaiting_approval'
  const canRetryPipeline = selected?.kind === 'pipeline' && selected.status === 'failed'
  const canPausePipeline = selected?.kind === 'pipeline' && selected.status === 'running'
  const canResumePipeline = selected?.kind === 'pipeline' && selected.status === 'paused'
  const canAbortHard = selected && ['pending', 'running', 'waiting', 'awaiting_approval', 'paused'].includes(selected.status)

  const timelineEvents = useMemo(() => {
    const isStateEvent = (type: string) => (
      type === 'phase_started' ||
      type === 'phase_completed' ||
      type === 'pipeline_done' ||
      type === 'waiting' ||
      type === 'done' ||
      type === 'pipeline_created'
    )

    const isFileEvent = (type: string) => type === 'file_created' || type === 'file_modified'
    const isApprovalEvent = (type: string) => (
      type === 'awaiting_approval' ||
      type === 'command_awaiting_approval' ||
      type === 'command_approved' ||
      type === 'command_rejected'
    )
    const isCommandEvent = (type: string) => type.startsWith('command_')
    const isErrorEvent = (type: string) => type === 'error' || type.endsWith('_failed') || type === 'phase_retry_exhausted'

    return [...events]
      .filter((evt) => {
        if (timelineFilter === 'all') return true
        if (timelineFilter === 'state') return isStateEvent(evt.type)
        if (timelineFilter === 'files') return isFileEvent(evt.type)
        if (timelineFilter === 'approvals') return isApprovalEvent(evt.type)
        if (timelineFilter === 'commands') return isCommandEvent(evt.type)
        if (timelineFilter === 'errors') return isErrorEvent(evt.type)
        return true
      })
      .reverse()
  }, [events, timelineFilter])

  const latestFileDeltas = useMemo<FileDelta[]>(() => {
    const source = selected?.kind === 'pipeline'
      ? (() => {
          const lastPhaseStart = [...events].reverse().find((evt) => evt.type === 'phase_started')
          if (!lastPhaseStart) return events
          const idx = events.findIndex((evt) => evt === lastPhaseStart)
          return idx >= 0 ? events.slice(idx) : events
        })()
      : events

    const map = new Map<string, FileDelta>()
    let activePhase = selected?.kind === 'pipeline'
      ? selected.data.phases?.[selected.data.current_phase_index]?.name || `Phase ${selected.data.current_phase_index + 1}`
      : undefined

    for (const evt of source) {
      if (evt.type === 'phase_started') {
        activePhase = String(evt.payload?.phase_name || activePhase || '')
      }
      if (evt.type !== 'file_created' && evt.type !== 'file_modified') continue
      const path = String(evt.payload?.path || '').trim()
      if (!path) continue
      map.set(path, {
        path,
        action: evt.type === 'file_created' ? 'created' : 'modified',
        ts: evt.ts,
        phase: activePhase,
      })
    }

    return Array.from(map.values()).reverse().slice(0, 8)
  }, [events, selected])

  const latestEventTs = events.length > 0 ? events[events.length - 1]?.ts : undefined
  const secondsSinceEvent = eventAgeSeconds(latestEventTs)
  const likelyStuck = !!selected
    && ['pending', 'running', 'awaiting_approval', 'waiting', 'paused'].includes(selected.status)
    && secondsSinceEvent !== null
    && secondsSinceEvent >= 120

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Run Center</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            One place to launch, monitor, and steer active work.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="min-w-[250px]">
            {loadingModels ? (
              <div className="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-sm text-gray-500 dark:text-gray-400 bg-white dark:bg-gray-900">
                Loading models...
              </div>
            ) : models.length > 0 ? (
              <select
                value={launchModel}
                onChange={(e) => setLaunchModel(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-sm bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300"
                title="Choose a model override for the next launch"
              >
                <option value="">Model: auto/default</option>
                {Object.entries(
                  models.reduce((acc, m) => {
                    const provider = m.provider_name || 'other'
                    if (!acc[provider]) acc[provider] = []
                    acc[provider].push(m)
                    return acc
                  }, {} as Record<string, ModelOption[]>),
                ).map(([provider, group]) => (
                  <optgroup key={provider} label={provider}>
                    {group.map((m) => (
                      <option key={m.id} value={`${m.provider_name || 'unknown'}/${m.model_id}`}>
                        {m.display_name || m.model_id}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            ) : (
              <input
                value={launchModel}
                onChange={(e) => setLaunchModel(e.target.value)}
                placeholder="provider/model"
                className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-sm bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300"
                title="Set a model override manually"
              />
            )}
          </div>
          <Link
            href={launchModel ? `/workbench?model=${encodeURIComponent(launchModel)}` : '/workbench'}
            className="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            New Run
          </Link>
          {selected?.kind === 'pipeline' && (
            <Link
              href={`/workbench/pipelines/${selected.data.id}`}
              className="px-3 py-2 rounded-lg border border-indigo-200 dark:border-indigo-700 text-sm text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-900/20"
            >
              Open Detail
            </Link>
          )}
          {selected?.kind === 'session' && (
            <Link
              href={`/workbench/${selected.data.id}`}
              className="px-3 py-2 rounded-lg border border-indigo-200 dark:border-indigo-700 text-sm text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-900/20"
            >
              Open Detail
            </Link>
          )}
          {linkedProjectId && (
            <Link
              href={`/projects/${linkedProjectId}`}
              className="px-3 py-2 rounded-lg border border-orange-200 dark:border-orange-700 text-sm text-orange-700 dark:text-orange-300 hover:bg-orange-50 dark:hover:bg-orange-900/20"
            >
              View Project Code
            </Link>
          )}
          {canStop && (
            <button
              onClick={stopSelectedRun}
              disabled={acting}
              className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50"
            >
              Stop
            </button>
          )}
          {canAbortHard && (
            <button
              onClick={abortSelectedRun}
              disabled={acting}
              className="px-3 py-2 rounded-lg border border-red-300 dark:border-red-700 text-sm font-medium text-red-800 dark:text-red-300 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/30 disabled:opacity-50"
            >
              Abort
            </button>
          )}
          {selected && (
            <button
              onClick={resetSelectedRun}
              disabled={acting}
              className="px-3 py-2 rounded-lg border border-orange-300 dark:border-orange-700 text-sm font-medium text-orange-800 dark:text-orange-300 bg-orange-50 dark:bg-orange-900/20 hover:bg-orange-100 dark:hover:bg-orange-900/30 disabled:opacity-50"
            >
              Reset
            </button>
          )}
          {canCompleteSession && selected?.kind === 'session' && (
            <button
              onClick={() => runAction(() => fetch(`${API_BASE}/v1/workbench/sessions/${selected.data.id}/complete`, { method: 'POST', headers: AUTH_HEADERS }))}
              disabled={acting}
              className="px-3 py-2 rounded-lg border border-green-200 dark:border-green-700 text-sm text-green-700 dark:text-green-300 hover:bg-green-50 dark:hover:bg-green-900/20 disabled:opacity-50"
            >
              Mark Complete
            </button>
          )}
          {canApprovePipeline && selected?.kind === 'pipeline' && (
            <button
              onClick={() => runAction(() => fetch(`${API_BASE}/v1/workbench/pipelines/${selected.data.id}/approve`, {
                method: 'POST', headers: AUTH_HEADERS, body: JSON.stringify({ feedback: null }),
              }))}
              disabled={acting}
              className="px-3 py-2 rounded-lg border border-amber-200 dark:border-amber-700 text-sm text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-900/20 disabled:opacity-50"
            >
              Approve and Continue
            </button>
          )}
          {canRetryPipeline && selected?.kind === 'pipeline' && (
            <button
              onClick={() => runAction(() => fetch(`${API_BASE}/v1/workbench/pipelines/${selected.data.id}/retry`, { method: 'POST', headers: AUTH_HEADERS }))}
              disabled={acting}
              className="px-3 py-2 rounded-lg border border-indigo-200 dark:border-indigo-700 text-sm text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 disabled:opacity-50"
            >
              Retry Failed Phases
            </button>
          )}
          {canPausePipeline && selected?.kind === 'pipeline' && (
            <button
              onClick={() => runAction(() => fetch(`${API_BASE}/v1/workbench/pipelines/${selected.data.id}/pause`, { method: 'POST', headers: AUTH_HEADERS }))}
              disabled={acting}
              className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50"
            >
              Pause
            </button>
          )}
          {canResumePipeline && selected?.kind === 'pipeline' && (
            <button
              onClick={() => runAction(() => fetch(`${API_BASE}/v1/workbench/pipelines/${selected.data.id}/resume`, { method: 'POST', headers: AUTH_HEADERS }))}
              disabled={acting}
              className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50"
            >
              Resume
            </button>
          )}
          {selected?.kind === 'session' && (
            <Link
              href={`/workbench?project=${selected.data.project_id || ''}&agent_type=${selected.data.agent_type || 'coder'}${launchModel ? `&model=${encodeURIComponent(launchModel)}` : ''}`}
              className="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
            >
              New Session
            </Link>
          )}
          {selected?.kind === 'pipeline' && (
            <Link
              href={launchModel ? `/workbench?model=${encodeURIComponent(launchModel)}` : '/workbench'}
              className="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
            >
              New Pipeline
            </Link>
          )}
        </div>
      </div>

      {likelyStuck && (
        <div className="rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-xs text-amber-800 dark:text-amber-300 flex items-center justify-between gap-3">
          <span>
            This run may be stuck: no new events for about {Math.floor((secondsSinceEvent || 0) / 60)}m {((secondsSinceEvent || 0) % 60)}s.
          </span>
          <div className="flex items-center gap-2">
          {canAbortHard && (
            <button
              onClick={abortSelectedRun}
              disabled={acting}
              className="px-2.5 py-1 rounded border border-amber-400 dark:border-amber-600 text-amber-900 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-900/30 disabled:opacity-50"
            >
              Abort Stuck Run
            </button>
          )}
          {selected && (
            <button
              onClick={resetSelectedRun}
              disabled={acting}
              className="px-2.5 py-1 rounded border border-orange-400 dark:border-orange-600 text-orange-900 dark:text-orange-200 hover:bg-orange-100 dark:hover:bg-orange-900/30 disabled:opacity-50"
            >
              Reset Stuck Run
            </button>
          )}
          </div>
        </div>
      )}

      {actionError && (
        <div className="rounded-lg border border-red-200 dark:border-red-700 bg-red-50 dark:bg-red-900/20 px-3 py-2 text-xs text-red-700 dark:text-red-300">
          {actionError}
        </div>
      )}

      {loading ? (
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-8 text-sm text-gray-500 dark:text-gray-400">
          Loading runs...
        </div>
      ) : runs.length === 0 ? (
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-10 text-center">
          <div className="text-4xl mb-3">🧭</div>
          <p className="text-sm text-gray-600 dark:text-gray-300">No runs yet. Start from Workbench to see assignment and progress here.</p>
          <Link href="/workbench" className="inline-block mt-4 px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white text-sm rounded-lg">
            Start a Run
          </Link>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
          <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Active and Recent Runs</h2>
            </div>
            <div className="max-h-[70vh] overflow-y-auto p-2 space-y-2">
              {runs.map((run) => {
                const active = selectedId === run.id
                return (
                  <button
                    key={run.id}
                    onClick={() => setSelectedId(run.id)}
                    className={`w-full text-left rounded-lg border p-3 transition-colors ${
                      active
                        ? 'border-orange-300 bg-orange-50 dark:bg-orange-900/20 dark:border-orange-700'
                        : 'border-gray-200 dark:border-gray-700 hover:border-gray-300'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                        {run.kind}
                      </span>
                      <span className={`text-xs px-2 py-0.5 rounded-full border ${STATUS_STYLE[run.status] || STATUS_STYLE.pending}`}>
                        {prettyStatus(run.status)}
                      </span>
                    </div>
                    <p className="mt-1 text-sm font-medium text-gray-900 dark:text-white line-clamp-2">{run.title}</p>
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Updated {timeAgo(run.created_at)}</p>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Execution Flow</h2>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Assignment and completion by phase.</p>
              <div className="mt-4 overflow-x-auto">
                <div className="flex items-stretch gap-3 min-w-max pb-1">
                  {flowNodes.map((node, index) => (
                    <div key={`${node.name}-${index}`} className="flex items-center gap-3">
                      <div className={`w-56 rounded-xl border p-3 ${STATE_STYLE[node.state]}`}>
                        <p className="text-xs uppercase tracking-wide opacity-75">Step {index + 1}</p>
                        <p className="mt-1 text-sm font-semibold">{node.name}</p>
                        <p className="mt-2 text-xs">Agent: {node.agent}</p>
                        <p className="text-xs opacity-80">Model: {node.model}</p>
                      </div>
                      {index < flowNodes.length - 1 && <div className="w-8 h-px bg-gray-300 dark:bg-gray-600" />}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Agent Lanes</h2>
              <div className="mt-3 space-y-2">
                {byAgent.map(([agent, stats]) => (
                  <div key={agent} className="rounded-lg border border-gray-200 dark:border-gray-700 p-3">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium text-gray-900 dark:text-white capitalize">{agent}</span>
                      <span className="text-xs text-gray-500 dark:text-gray-400">{stats.total} assigned</span>
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                      <span className="rounded bg-green-50 text-green-700 px-2 py-1 text-center">Done: {stats.done}</span>
                      <span className="rounded bg-blue-50 text-blue-700 px-2 py-1 text-center">Active: {stats.active}</span>
                      <span className="rounded bg-red-50 text-red-700 px-2 py-1 text-center">Failed: {stats.failed}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {pendingCommands.length > 0 && selected?.kind === 'session' && (
              <div className="rounded-xl border border-amber-200 dark:border-amber-700 bg-amber-50/80 dark:bg-amber-900/20 p-4">
                <h2 className="text-sm font-semibold text-amber-800 dark:text-amber-200">Command Approvals</h2>
                <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">Run Center quick approvals for this session.</p>
                <div className="mt-3 space-y-2">
                  {pendingCommands.map((cmd) => (
                    <div key={cmd.command_id} className="rounded-lg border border-amber-200 dark:border-amber-700 bg-white/80 dark:bg-gray-900/30 p-3">
                      <p className="text-xs font-mono text-gray-700 dark:text-gray-200 break-all">{cmd.command}</p>
                      <div className="mt-2 flex items-center gap-2">
                        <button
                          onClick={() => runAction(() => fetch(`${API_BASE}/v1/workbench/sessions/${selected.data.id}/commands/${cmd.command_id}/approve`, { method: 'POST', headers: AUTH_HEADERS }))}
                          disabled={acting}
                          className="px-2.5 py-1 text-xs rounded border border-green-200 dark:border-green-700 text-green-700 dark:text-green-300 hover:bg-green-50 dark:hover:bg-green-900/20 disabled:opacity-50"
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => runAction(() => fetch(`${API_BASE}/v1/workbench/sessions/${selected.data.id}/commands/${cmd.command_id}/reject`, {
                            method: 'POST', headers: AUTH_HEADERS, body: JSON.stringify({ feedback: 'Rejected from Run Center' }),
                          }))}
                          disabled={acting}
                          className="px-2.5 py-1 text-xs rounded border border-red-200 dark:border-red-700 text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50"
                        >
                          Reject
                        </button>
                        {cmd.tier && <span className="text-[11px] text-amber-700 dark:text-amber-300">tier: {cmd.tier}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Latest Changed Files</h2>
                <span className="text-xs text-gray-500 dark:text-gray-400">{latestFileDeltas.length}</span>
              </div>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {selected?.kind === 'pipeline'
                  ? 'Recent file changes for the current pipeline phase.'
                  : 'Recent file changes for this session.'}
              </p>
              <div className="mt-3 space-y-2">
                {latestFileDeltas.length === 0 ? (
                  <p className="text-xs text-gray-500 dark:text-gray-400">No file writes in the current event window.</p>
                ) : (
                  latestFileDeltas.map((file) => (
                    <div key={file.path} className="rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        {linkedProjectId ? (
                          <Link
                            href={`/projects/${linkedProjectId}?tab=files&file=${encodeURIComponent(file.path)}`}
                            className="text-xs font-mono text-indigo-700 dark:text-indigo-300 hover:underline truncate"
                            title="Open file in Project viewer"
                          >
                            {file.path}
                          </Link>
                        ) : (
                          <span className="text-xs font-mono text-gray-800 dark:text-gray-200 truncate">{file.path}</span>
                        )}
                        <span className={`text-[11px] px-1.5 py-0.5 rounded ${file.action === 'created' ? 'bg-green-50 text-green-700' : 'bg-blue-50 text-blue-700'}`}>
                          {file.action}
                        </span>
                      </div>
                      <div className="mt-1 text-[11px] text-gray-500 dark:text-gray-400 flex items-center justify-between gap-2">
                        <span>{file.phase || 'session'}</span>
                        <span>{eventTime(file.ts)}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Live Timeline</h2>
                <span className="text-xs text-gray-500 dark:text-gray-400">{timelineEvents.length}/{events.length} events</span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {([
                  ['all', 'All'],
                  ['state', 'State'],
                  ['files', 'Files'],
                  ['approvals', 'Approvals'],
                  ['commands', 'Commands'],
                  ['errors', 'Errors'],
                ] as Array<[TimelineFilter, string]>).map(([key, label]) => {
                  const active = timelineFilter === key
                  return (
                    <button
                      key={key}
                      onClick={() => setTimelineFilter(key)}
                      className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
                        active
                          ? 'border-orange-300 bg-orange-50 text-orange-700 dark:border-orange-700 dark:bg-orange-900/20 dark:text-orange-300'
                          : 'border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800'
                      }`}
                    >
                      {label}
                    </button>
                  )
                })}
              </div>
              <div className="mt-3 max-h-[22rem] overflow-y-auto space-y-2 pr-1">
                {timelineEvents.length === 0 ? (
                  <p className="text-xs text-gray-500 dark:text-gray-400">No events yet for this run.</p>
                ) : (
                  timelineEvents.map((evt, idx) => {
                    const info = eventLabel(evt)
                    return (
                      <div key={`${evt.type}-${evt.ts || 't'}-${idx}`} className={`rounded-lg border px-3 py-2 ${eventToneClass(info.tone)}`}>
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs font-semibold text-gray-900 dark:text-white">{info.title}</p>
                          <span className="text-[11px] text-gray-500 dark:text-gray-400">{eventTime(evt.ts)}</span>
                        </div>
                        <p className="mt-1 text-xs text-gray-700 dark:text-gray-300 break-words">{info.detail}</p>
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
