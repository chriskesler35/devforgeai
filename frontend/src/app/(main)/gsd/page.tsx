'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getApiBase, getAuthHeaders } from '@/lib/config'

type QuestionKey = 'projectName' | 'goal' | 'scope' | 'constraints' | 'repoUrl'

type PhaseStatus = 'pending' | 'running' | 'done'

interface RoadmapPhase {
  id: string
  name: string
  success: string
  estimate: string
  status: PhaseStatus
}

const INITIAL_PHASES: RoadmapPhase[] = [
  { id: 'phase-1', name: 'Context Mapping', success: 'Shared understanding of the current baseline', estimate: '10-20 min', status: 'pending' },
  { id: 'phase-2', name: 'Roadmap Draft', success: 'Phased milestones with success criteria', estimate: '15-30 min', status: 'pending' },
  { id: 'phase-3', name: 'Execution Plan Review', success: 'User-approved roadmap', estimate: '10-15 min', status: 'pending' },
  { id: 'phase-4', name: 'Phase Delivery Loop', success: 'Phase-by-phase implementation and verification', estimate: '30+ min', status: 'pending' },
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

export default function GsdPage() {
  const router = useRouter()
  const apiBase = getApiBase()
  const authHeaders = getAuthHeaders()
  const requestHeaders = useMemo(() => ({
    Authorization: authHeaders.Authorization,
    'Content-Type': 'application/json',
  }), [authHeaders.Authorization])

  const [answers, setAnswers] = useState<Record<QuestionKey, string>>({
    projectName: '',
    goal: '',
    scope: '',
    constraints: '',
    repoUrl: '',
  })
  const [uploadedFiles, setUploadedFiles] = useState<string[]>([])
  const [roadmap, setRoadmap] = useState<RoadmapPhase[]>(INITIAL_PHASES)
  const [buildingRoadmap, setBuildingRoadmap] = useState(false)
  const [reviewState, setReviewState] = useState<'pending' | 'approved' | 'needs_changes'>('pending')
  const [launching, setLaunching] = useState(false)
  const [activePhaseIndex, setActivePhaseIndex] = useState(0)
  const [runningPhase, setRunningPhase] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const progressPct = Math.round(((activePhaseIndex + 1) / Math.max(1, roadmap.length)) * 100)

  const nextStep = roadmap[Math.min(activePhaseIndex + 1, roadmap.length - 1)]

  const canBuildRoadmap = answers.goal.trim().length > 0 && answers.scope.trim().length > 0

  const updateAnswer = (key: QuestionKey, value: string) => {
    setAnswers((prev) => ({ ...prev, [key]: value }))
  }

  const handleFileSelection = (fileList: FileList | null) => {
    if (!fileList) return
    const names = Array.from(fileList).map((f) => f.name)
    setUploadedFiles(names)
  }

  const buildRoadmap = async () => {
    if (!canBuildRoadmap || buildingRoadmap) return

    setError(null)
    setBuildingRoadmap(true)
    setReviewState('pending')
    setRoadmap(INITIAL_PHASES.map((p) => ({ ...p, status: 'pending' })))

    for (let i = 0; i < INITIAL_PHASES.length; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 300))
      setRoadmap((curr) => curr.map((phase, idx) => {
        if (idx < i) return { ...phase, status: 'done' }
        if (idx === i) return { ...phase, status: 'running' }
        return { ...phase, status: 'pending' }
      }))
    }

    setRoadmap((curr) => curr.map((phase) => ({ ...phase, status: 'done' })))
    setBuildingRoadmap(false)
  }

  const restartRoadmap = () => {
    setRoadmap(INITIAL_PHASES.map((p) => ({ ...p, status: 'pending' })))
    setReviewState('pending')
    setActivePhaseIndex(0)
    setRunningPhase(false)
  }

  const launchGsd = async () => {
    if (launching || reviewState !== 'approved') return

    setError(null)
    setLaunching(true)
    try {
      const briefParts = [
        `Project: ${answers.projectName || 'Untitled project'}`,
        `Goal: ${answers.goal}`,
        `Scope: ${answers.scope}`,
        `Constraints: ${answers.constraints || 'None provided'}`,
        `Repository: ${answers.repoUrl || 'Not provided'}`,
        `Uploads: ${uploadedFiles.length > 0 ? uploadedFiles.join(', ') : 'None'}`,
      ]
      const task = [
        'Run GSD flow: context gather, roadmap review, then phased execution.',
        '',
        ...briefParts,
      ].join('\n')

      const sessionRes = await fetch(`${apiBase}/v1/workbench/sessions`, {
        method: 'POST',
        headers: requestHeaders,
        body: JSON.stringify({ task, agent_type: 'planner' }),
      })
      const sessionPayload = await readApiPayload(sessionRes)
      if (!sessionRes.ok) throw new Error(getApiErrorMessage(sessionPayload, sessionRes.status))

      const pipelineRes = await fetch(`${apiBase}/v1/workbench/pipelines`, {
        method: 'POST',
        headers: requestHeaders,
        body: JSON.stringify({
          session_id: sessionPayload.id,
          method_id: 'gsd',
          task,
          auto_approve: false,
          interaction_mode: 'interactive',
          delegate_qa_to_agent: false,
        }),
      })
      const pipelinePayload = await readApiPayload(pipelineRes)
      if (!pipelineRes.ok) throw new Error(getApiErrorMessage(pipelinePayload, pipelineRes.status))

      router.push(`/workbench/pipelines/${pipelinePayload.id}`)
    } catch (e: any) {
      setError(e.message || 'Failed to launch GSD flow')
    } finally {
      setLaunching(false)
    }
  }

  const jumpToPhase = (index: number) => {
    if (index < 0 || index >= roadmap.length) return
    setActivePhaseIndex(index)
  }

  const togglePhaseRun = () => {
    setRunningPhase((prev) => !prev)
  }

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-3">
        <div className="text-xs font-semibold uppercase tracking-wider text-gray-500">Context</div>
        <div className="mt-1 text-sm text-gray-700 dark:text-gray-200">
          Home {'>'} Pick Method {'>'} GSD {'>'} Phase {activePhaseIndex + 1}
        </div>
      </div>

      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">GSD Workflow</h1>
        <p className="text-sm text-gray-600 dark:text-gray-300">Context gather {'->'} roadmap build {'->'} review {'->'} phase-by-phase execution</p>
      </div>

      {error && (
        <div className="rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[260px_1fr_320px] gap-4">
        <aside className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 space-y-3">
          <div className="text-xs font-semibold uppercase tracking-wider text-gray-500">Roadmap</div>
          <div className="space-y-2">
            {roadmap.map((phase, idx) => (
              <button
                key={phase.id}
                onClick={() => jumpToPhase(idx)}
                className={`w-full text-left rounded border px-2 py-2 text-xs ${idx === activePhaseIndex ? 'border-indigo-400 bg-indigo-50 text-indigo-800' : 'border-gray-200 bg-white text-gray-700'}`}
              >
                <div className="font-semibold">{idx + 1}. {phase.name}</div>
                <div className="text-[11px] mt-0.5">{phase.status}</div>
              </button>
            ))}
          </div>
          <div className="rounded border border-gray-200 px-2 py-2 text-xs text-gray-700 dark:text-gray-300">
            Phase {activePhaseIndex + 1} of {roadmap.length} ({progressPct}%)
            <div className="mt-2 h-1.5 rounded bg-gray-200 overflow-hidden">
              <div className="h-full bg-indigo-500" style={{ width: `${progressPct}%` }} />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={togglePhaseRun}
              className="flex-1 px-2 py-1.5 text-xs rounded bg-indigo-600 hover:bg-indigo-700 text-white"
            >
              {runningPhase ? 'Pause' : 'Play'}
            </button>
            <button
              onClick={() => jumpToPhase(Math.min(roadmap.length - 1, activePhaseIndex + 1))}
              className="flex-1 px-2 py-1.5 text-xs rounded border border-gray-300 text-gray-600"
            >
              Jump +1
            </button>
          </div>
        </aside>

        <main className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 space-y-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-gray-500">Brief Context Gathering</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-2">
              <input
                value={answers.projectName}
                onChange={(e) => updateAnswer('projectName', e.target.value)}
                placeholder="Project name"
                className="rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm px-3 py-2"
              />
              <input
                value={answers.repoUrl}
                onChange={(e) => updateAnswer('repoUrl', e.target.value)}
                placeholder="GitHub repo URL"
                className="rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm px-3 py-2"
              />
              <textarea
                value={answers.goal}
                onChange={(e) => updateAnswer('goal', e.target.value)}
                placeholder="Project goal"
                rows={3}
                className="rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm px-3 py-2"
              />
              <textarea
                value={answers.scope}
                onChange={(e) => updateAnswer('scope', e.target.value)}
                placeholder="Scope and boundaries"
                rows={3}
                className="rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm px-3 py-2"
              />
              <textarea
                value={answers.constraints}
                onChange={(e) => updateAnswer('constraints', e.target.value)}
                placeholder="Constraints and risks"
                rows={2}
                className="md:col-span-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm px-3 py-2"
              />
              <div className="md:col-span-2 rounded border border-dashed border-gray-300 px-3 py-2">
                <div className="text-xs font-semibold text-gray-600">Upload context files</div>
                <input type="file" multiple onChange={(e) => handleFileSelection(e.target.files)} className="mt-1 text-xs" />
                <div className="mt-1 text-[11px] text-gray-500">
                  {uploadedFiles.length > 0 ? uploadedFiles.join(', ') : 'No files selected'}
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-gray-200 bg-gray-50 dark:bg-gray-900 px-3 py-3 space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wider text-gray-500">Auto-Build Roadmap</div>
            <div className="text-xs text-gray-600 dark:text-gray-300">Roadmap phases appear incrementally as they are generated.</div>
            <button
              onClick={buildRoadmap}
              disabled={!canBuildRoadmap || buildingRoadmap}
              className="px-3 py-1.5 text-xs rounded bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50"
            >
              {buildingRoadmap ? 'Building roadmap...' : 'Build Roadmap'}
            </button>
          </div>

          <div className="rounded-xl border border-gray-200 px-3 py-3 space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wider text-gray-500">User Review</div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setReviewState('approved')}
                className={`px-3 py-1.5 text-xs rounded ${reviewState === 'approved' ? 'bg-emerald-600 text-white' : 'border border-gray-300 text-gray-700'}`}
              >
                Yes
              </button>
              <button
                onClick={() => setReviewState('needs_changes')}
                className={`px-3 py-1.5 text-xs rounded ${reviewState === 'needs_changes' ? 'bg-amber-500 text-white' : 'border border-gray-300 text-gray-700'}`}
              >
                Modify
              </button>
              <button
                onClick={restartRoadmap}
                className="px-3 py-1.5 text-xs rounded border border-gray-300 text-gray-700"
              >
                Restart
              </button>
              <button
                onClick={launchGsd}
                disabled={reviewState !== 'approved' || launching}
                className="px-3 py-1.5 text-xs rounded bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50"
              >
                {launching ? 'Launching...' : 'Start Building'}
              </button>
            </div>
          </div>
        </main>

        <aside className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 space-y-3">
          <div className="text-xs font-semibold uppercase tracking-wider text-gray-500">Agent Monitor</div>
          <div className="rounded border border-gray-200 px-2 py-2 text-xs text-gray-700 dark:text-gray-300">
            Current phase: <span className="font-semibold">{roadmap[activePhaseIndex]?.name}</span>
            <div className="mt-1">Execution: {runningPhase ? 'Running' : 'Paused'}</div>
          </div>

          <div className="rounded border border-gray-200 px-2 py-2 text-xs text-gray-700 dark:text-gray-300 space-y-1">
            <div className="font-semibold">What Happens Next?</div>
            <div>Next step: {nextStep?.name}</div>
            <div>Estimate: {nextStep?.estimate}</div>
            <div>User input needed: {reviewState === 'needs_changes' ? 'Roadmap edits' : 'Approval or launch'}</div>
          </div>

          <div className="rounded border border-gray-200 px-2 py-2 text-xs text-gray-700 dark:text-gray-300">
            <div className="font-semibold">Skip / Restart</div>
            <div className="mt-1 flex gap-2">
              <button
                onClick={() => jumpToPhase(Math.min(activePhaseIndex + 1, roadmap.length - 1))}
                className="flex-1 px-2 py-1 rounded border border-gray-300"
              >
                Skip ahead
              </button>
              <button
                onClick={restartRoadmap}
                className="flex-1 px-2 py-1 rounded border border-gray-300"
              >
                Restart
              </button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}
