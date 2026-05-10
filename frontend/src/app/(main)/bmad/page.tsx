'use client'

import { getApiBase, getAuthHeaders } from '@/lib/config'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'

type StageKey = 'discovery' | 'ideation' | 'planning' | 'handoff' | 'dev'

interface PipelineSummary {
  id: string
  method_id: string
  initial_task: string
  status: string
  created_at?: string
}

interface PhaseRun {
  id: string
  phase_name: string
  status: string
  created_at?: string
}

interface PipelineDetail {
  id: string
  method_id: string
  status: string
  initial_task: string
  phase_runs?: PhaseRun[]
}

const BMAD_STAGES: Array<{ key: StageKey; label: string; hint: string }> = [
  { key: 'discovery', label: 'Discovery', hint: 'Gather product and domain context.' },
  { key: 'ideation', label: 'Ideation', hint: 'Explore solution directions and tradeoffs.' },
  { key: 'planning', label: 'Planning', hint: 'Define specs, architecture, and execution plan.' },
  { key: 'handoff', label: 'Handoff', hint: 'Produce dev-ready artifacts and acceptance framing.' },
  { key: 'dev', label: 'Dev', hint: 'Execute selected implementation slices.' },
]

function readApiPayload(res: Response) {
  return res.text().then((t) => {
    if (!t) return null
    try {
      return JSON.parse(t)
    } catch {
      return t
    }
  })
}

function getApiErrorMessage(payload: any, status: number) {
  if (typeof payload === 'string' && payload.trim()) return payload.trim()
  if (payload?.detail?.error?.message) return payload.detail.error.message
  if (payload?.detail && typeof payload.detail === 'string') return payload.detail
  if (payload?.message && typeof payload.message === 'string') return payload.message
  return `HTTP ${status}`
}

export default function BmadPage() {
  const router = useRouter()
  const apiBase = useMemo(() => getApiBase(), [])
  const authHeader = useMemo(() => getAuthHeaders().Authorization, [])
  const requestHeaders = useMemo(() => ({
    Authorization: authHeader,
    'Content-Type': 'application/json',
  }), [authHeader])

  const [task, setTask] = useState('')
  const [launching, setLaunching] = useState(false)
  const [loading, setLoading] = useState(true)
  const [pipelines, setPipelines] = useState<PipelineSummary[]>([])
  const [selectedPipelineId, setSelectedPipelineId] = useState<string>('')
  const [pipelineDetail, setPipelineDetail] = useState<PipelineDetail | null>(null)
  const [activeStage, setActiveStage] = useState<StageKey>('discovery')
  const [error, setError] = useState<string | null>(null)

  const fetchPipelines = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`${apiBase}/v1/workbench/pipelines`, { headers: { Authorization: authHeader } })
      const payload = await readApiPayload(res)
      if (!res.ok) throw new Error(getApiErrorMessage(payload, res.status))
      const rows = Array.isArray(payload?.data) ? payload.data : []
      const bmadRows = rows.filter((p: any) => String(p?.method_id || '').toLowerCase() === 'bmad')
      setPipelines(bmadRows)
      if (!selectedPipelineId && bmadRows[0]?.id) {
        setSelectedPipelineId(bmadRows[0].id)
      }
      setError(null)
    } catch (e: any) {
      setError(e.message || 'Failed to load BMAD pipelines')
    } finally {
      setLoading(false)
    }
  }, [apiBase, authHeader, selectedPipelineId])

  const fetchPipelineDetail = useCallback(async (id: string) => {
    if (!id) return
    try {
      const res = await fetch(`${apiBase}/v1/workbench/pipelines/${id}`, { headers: { Authorization: authHeader } })
      const payload = await readApiPayload(res)
      if (!res.ok) throw new Error(getApiErrorMessage(payload, res.status))
      setPipelineDetail(payload as PipelineDetail)
    } catch (e: any) {
      setError(e.message || 'Failed to load BMAD pipeline detail')
    }
  }, [apiBase, authHeader])

  useEffect(() => { fetchPipelines() }, [fetchPipelines])
  useEffect(() => { if (selectedPipelineId) fetchPipelineDetail(selectedPipelineId) }, [selectedPipelineId, fetchPipelineDetail])

  const stageStatus = useMemo(() => {
    const runs = pipelineDetail?.phase_runs || []
    const labels = runs.map((r) => `${r.phase_name} ${r.status}`.toLowerCase())
    const map: Record<StageKey, 'pending' | 'running' | 'done'> = {
      discovery: 'pending',
      ideation: 'pending',
      planning: 'pending',
      handoff: 'pending',
      dev: 'pending',
    }

    const resolve = (keywords: string[]): 'pending' | 'running' | 'done' => {
      const hasDone = labels.some((l) => keywords.some((k) => l.includes(k)) && (l.includes('approved') || l.includes('completed') || l.includes('skipped')))
      if (hasDone) return 'done'
      const hasRunning = labels.some((l) => keywords.some((k) => l.includes(k)) && (l.includes('running') || l.includes('awaiting_approval')))
      if (hasRunning) return 'running'
      return 'pending'
    }

    map.discovery = resolve(['discover', 'context', 'intake'])
    map.ideation = resolve(['ideation', 'solution', 'brainstorm'])
    map.planning = resolve(['plan', 'spec', 'architecture'])
    map.handoff = resolve(['handoff', 'report'])
    map.dev = resolve(['dev', 'implement', 'execute', 'build'])
    return map
  }, [pipelineDetail])

  const launchBmad = async () => {
    const brief = task.trim()
    if (!brief) return

    setLaunching(true)
    setError(null)
    try {
      const sessionRes = await fetch(`${apiBase}/v1/workbench/sessions`, {
        method: 'POST',
        headers: requestHeaders,
        body: JSON.stringify({ task: brief, agent_type: 'planner' }),
      })
      const sessionPayload = await readApiPayload(sessionRes)
      if (!sessionRes.ok) throw new Error(getApiErrorMessage(sessionPayload, sessionRes.status))

      const pipelineRes = await fetch(`${apiBase}/v1/workbench/pipelines`, {
        method: 'POST',
        headers: requestHeaders,
        body: JSON.stringify({
          session_id: sessionPayload.id,
          method_id: 'bmad',
          task: brief,
          auto_approve: false,
          interaction_mode: 'interactive',
          delegate_qa_to_agent: false,
        }),
      })
      const pipelinePayload = await readApiPayload(pipelineRes)
      if (!pipelineRes.ok) throw new Error(getApiErrorMessage(pipelinePayload, pipelineRes.status))
      router.push(`/workbench/pipelines/${pipelinePayload.id}`)
    } catch (e: any) {
      setError(e.message || 'Failed to launch BMAD pipeline')
    } finally {
      setLaunching(false)
    }
  }

  const activeStageIndex = BMAD_STAGES.findIndex((s) => s.key === activeStage)
  const nextStage = BMAD_STAGES[Math.min(BMAD_STAGES.length - 1, activeStageIndex + 1)]

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-3">
        <div className="text-xs font-semibold uppercase tracking-wider text-gray-500">Context</div>
        <div className="mt-1 text-sm text-gray-700 dark:text-gray-200">
          Home {'>'} Pick Method {'>'} BMAD {'>'} {BMAD_STAGES[activeStageIndex]?.label}
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">BMAD Flow</h1>
          <p className="text-sm text-gray-600 dark:text-gray-300">Discovery -> Ideation -> Planning -> Handoff -> Dev</p>
        </div>
        <button
          onClick={fetchPipelines}
          className="px-3 py-1.5 text-xs rounded border border-gray-300 text-gray-600 hover:bg-gray-50"
        >
          Refresh
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
      )}

      <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-3 space-y-2">
        <div className="text-xs font-semibold uppercase tracking-wider text-gray-500">Launch BMAD</div>
        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-2">
          <input
            value={task}
            onChange={(e) => setTask(e.target.value)}
            placeholder="Describe what you want BMAD to drive"
            className="rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm px-3 py-2"
          />
          <button
            onClick={launchBmad}
            disabled={launching || !task.trim()}
            className="px-4 py-2 text-sm rounded bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50"
          >
            {launching ? 'Launching…' : 'Start BMAD'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
        <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs font-semibold uppercase tracking-wider text-gray-500">BMAD Stage Panels</div>
            <div className="flex gap-1">
              <button
                onClick={() => setActiveStage(BMAD_STAGES[Math.max(0, activeStageIndex - 1)].key)}
                disabled={activeStageIndex <= 0}
                className="px-2 py-1 text-xs rounded border border-gray-300 text-gray-600 disabled:opacity-40"
              >
                Prev
              </button>
              <button
                onClick={() => setActiveStage(BMAD_STAGES[Math.min(BMAD_STAGES.length - 1, activeStageIndex + 1)].key)}
                disabled={activeStageIndex >= BMAD_STAGES.length - 1}
                className="px-2 py-1 text-xs rounded border border-gray-300 text-gray-600 disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
            {BMAD_STAGES.map((stage) => {
              const status = stageStatus[stage.key]
              return (
                <button
                  key={stage.key}
                  onClick={() => setActiveStage(stage.key)}
                  className={`text-left rounded-lg border px-2 py-2 text-xs ${activeStage === stage.key ? 'border-indigo-400 bg-indigo-50 text-indigo-800' : 'border-gray-200 bg-white text-gray-700'}`}
                >
                  <div className="font-semibold">{stage.label}</div>
                  <div className="text-[10px] mt-1">{status}</div>
                </button>
              )
            })}
          </div>

          <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 px-3 py-3">
            <div className="text-sm font-semibold text-gray-900 dark:text-white">{BMAD_STAGES[activeStageIndex]?.label}</div>
            <div className="text-xs text-gray-600 dark:text-gray-300 mt-1">{BMAD_STAGES[activeStageIndex]?.hint}</div>
          </div>

          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wider text-gray-500">Recent BMAD Pipelines</div>
            {loading ? (
              <div className="text-xs text-gray-500">Loading…</div>
            ) : pipelines.length === 0 ? (
              <div className="text-xs text-gray-500">No BMAD pipelines yet.</div>
            ) : (
              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {pipelines.slice(0, 12).map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setSelectedPipelineId(p.id)}
                    className={`w-full text-left rounded border px-2 py-1.5 text-xs ${selectedPipelineId === p.id ? 'border-indigo-400 bg-indigo-50 text-indigo-800' : 'border-gray-200 bg-white text-gray-700'}`}
                  >
                    <div className="font-medium truncate">{p.initial_task}</div>
                    <div className="text-[10px] mt-0.5 opacity-80">{p.status}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">Agent Monitor</div>
          {!pipelineDetail ? (
            <div className="text-xs text-gray-500">Select a BMAD pipeline to inspect active and completed phases.</div>
          ) : (
            <div className="space-y-2 max-h-[420px] overflow-y-auto">
              {(pipelineDetail.phase_runs || []).length === 0 ? (
                <div className="text-xs text-gray-500">No phase runs yet.</div>
              ) : (
                (pipelineDetail.phase_runs || []).map((run) => (
                  <div key={run.id} className="rounded border border-gray-200 px-2 py-1.5 text-xs">
                    <div className="font-semibold text-gray-800 dark:text-gray-100">{run.phase_name}</div>
                    <div className="text-[10px] text-gray-600 dark:text-gray-300">{run.status}</div>
                  </div>
                ))
              )}
              <button
                onClick={() => router.push(`/workbench/pipelines/${pipelineDetail.id}`)}
                className="w-full px-3 py-1.5 text-xs rounded bg-indigo-600 hover:bg-indigo-700 text-white"
              >
                Open Full Pipeline View
              </button>
            </div>
          )}

          <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-2 text-xs text-gray-700 dark:text-gray-300 space-y-1">
            <div className="font-semibold">What Happens Next?</div>
            <div>Next stage: {nextStage?.label}</div>
            <div>Expected action: {nextStage?.hint}</div>
            <div>User input needed: choose artifacts to export or launch next stage work.</div>
          </div>
        </div>
      </div>
    </div>
  )
}
