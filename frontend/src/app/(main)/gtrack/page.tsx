'use client'

import { getApiBase, getAuthHeaders } from '@/lib/config'
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'

interface IssueRow {
  id: string
  title: string
  agent: string
  selected: boolean
}

const AGENT_MAP: Array<{ token: string; agent: string }> = [
  { token: 'test', agent: 'QA Engineer' },
  { token: 'bug', agent: 'Debugger' },
  { token: 'ui', agent: 'UI Engineer' },
  { token: 'api', agent: 'Backend Engineer' },
  { token: 'deploy', agent: 'Release Engineer' },
  { token: 'perf', agent: 'Performance Engineer' },
]

function inferAgent(issue: string) {
  const lower = issue.toLowerCase()
  for (const rule of AGENT_MAP) {
    if (lower.includes(rule.token)) return rule.agent
  }
  return 'Generalist Engineer'
}

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

export default function GtrackPage() {
  const router = useRouter()
  const apiBase = getApiBase()
  const authHeaders = getAuthHeaders()
  const requestHeaders = useMemo(() => ({
    Authorization: authHeaders.Authorization,
    'Content-Type': 'application/json',
  }), [authHeaders.Authorization])

  const [rawIssues, setRawIssues] = useState('')
  const [issues, setIssues] = useState<IssueRow[]>([])
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectedIssues = issues.filter((i) => i.selected)

  const importIssues = () => {
    const rows = rawIssues
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line, idx) => ({
        id: `ISSUE-${idx + 1}`,
        title: line,
        agent: inferAgent(line),
        selected: true,
      }))
    setIssues(rows)
  }

  const toggleIssue = (id: string) => {
    setIssues((curr) => curr.map((row) => (row.id === id ? { ...row, selected: !row.selected } : row)))
  }

  const selectAll = () => setIssues((curr) => curr.map((row) => ({ ...row, selected: true })))
  const clearSelection = () => setIssues((curr) => curr.map((row) => ({ ...row, selected: false })))

  const executeSelected = async () => {
    if (selectedIssues.length === 0 || running) return
    setError(null)
    setRunning(true)
    try {
      const task = [
        'Execute the following issue set via gtrack workflow.',
        '',
        ...selectedIssues.map((i, idx) => `${idx + 1}. [${i.id}] ${i.title} -> ${i.agent}`),
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
          method_id: 'gtrack',
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
      setError(e.message || 'Failed to execute gtrack issue set')
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">gtrack Issue Flow</h1>
        <p className="text-sm text-gray-600 dark:text-gray-300">Import issues, map to agents, and execute with bulk actions.</p>
      </div>

      {error && (
        <div className="rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr_320px] gap-4">
        {/* Sidebar: Issue import/list */}
        <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wider text-gray-500">Issue Import</div>
          <textarea
            value={rawIssues}
            onChange={(e) => setRawIssues(e.target.value)}
            placeholder="Paste one issue per line"
            rows={10}
            className="w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-xs px-2 py-2"
          />
          <button
            onClick={importIssues}
            className="w-full px-3 py-1.5 text-xs rounded bg-indigo-600 hover:bg-indigo-700 text-white"
          >
            Import Issues
          </button>
          <div className="pt-2 border-t border-gray-200 dark:border-gray-700">
            <div className="text-xs font-semibold text-gray-600 mb-1">Current Issues</div>
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {issues.length === 0 ? (
                <div className="text-xs text-gray-500">No issues imported yet.</div>
              ) : (
                issues.map((issue) => (
                  <label key={issue.id} className="flex items-start gap-2 text-xs rounded border border-gray-200 px-2 py-1.5">
                    <input
                      type="checkbox"
                      checked={issue.selected}
                      onChange={() => toggleIssue(issue.id)}
                      className="mt-0.5"
                    />
                    <div>
                      <div className="font-semibold text-gray-800 dark:text-gray-100">{issue.id}</div>
                      <div className="text-gray-600 dark:text-gray-300 line-clamp-2">{issue.title}</div>
                    </div>
                  </label>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Main: Mapping view */}
        <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs font-semibold uppercase tracking-wider text-gray-500">Issue -> Agent Mapping</div>
            <div className="flex items-center gap-2">
              <button onClick={selectAll} className="px-2 py-1 text-[11px] rounded border border-gray-300 text-gray-600">Select all</button>
              <button onClick={clearSelection} className="px-2 py-1 text-[11px] rounded border border-gray-300 text-gray-600">Clear</button>
            </div>
          </div>
          {issues.length === 0 ? (
            <div className="text-xs text-gray-500">Import issues to generate mapping.</div>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {issues.map((issue) => (
                <div key={issue.id} className="grid grid-cols-[90px_1fr_180px] gap-2 items-center rounded border border-gray-200 px-2 py-1.5 text-xs">
                  <div className="font-semibold text-gray-700 dark:text-gray-200">{issue.id}</div>
                  <div className="text-gray-700 dark:text-gray-300">{issue.title}</div>
                  <div className="rounded bg-gray-100 dark:bg-gray-900 px-2 py-1 text-gray-700 dark:text-gray-200">{issue.agent}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Bulk actions */}
        <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 space-y-3">
          <div className="text-xs font-semibold uppercase tracking-wider text-gray-500">Bulk Actions</div>
          <div className="rounded border border-gray-200 px-2 py-2 text-xs text-gray-700 dark:text-gray-300">
            Selected issues: <span className="font-semibold">{selectedIssues.length}</span>
          </div>
          <button
            onClick={executeSelected}
            disabled={running || selectedIssues.length === 0}
            className="w-full px-3 py-2 text-sm rounded bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50"
          >
            {running ? 'Launching…' : 'Execute Selected'}
          </button>
          <button
            onClick={() => router.push('/workbench')}
            className="w-full px-3 py-2 text-xs rounded border border-gray-300 text-gray-600 hover:bg-gray-50"
          >
            Open Workbench
          </button>
        </div>
      </div>
    </div>
  )
}
