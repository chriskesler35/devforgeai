'use client'

import { useCallback, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRuns } from '@/hooks/useRuns'
import { useToast } from '@/app/ToastProvider'
import { approveRun, resumeRun, archiveRun } from '@/lib/runs/api'
import { TERMINAL_STATES, ACTIVE_STATES } from '@/lib/runs/types'
import type { Run, RunState } from '@/lib/runs/types'

type Filter = 'active' | 'awaiting' | 'recent' | 'all'

const FILTER_CHIPS: { key: Filter; label: string }[] = [
  { key: 'active', label: 'Active' },
  { key: 'awaiting', label: 'Awaiting' },
  { key: 'recent', label: 'Recent' },
  { key: 'all', label: 'All' },
]

const STATUS_STYLES: Record<string, string> = {
  running: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  awaiting_input: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  awaiting_approval: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400',
  paused: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  completed: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
  failed: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  cancelled: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-500',
  archived: 'bg-gray-50 text-gray-400 dark:bg-gray-800/50 dark:text-gray-600',
}

const STATUS_DOTS: Record<string, string> = {
  running: 'bg-emerald-500 animate-pulse',
  awaiting_input: 'bg-blue-500 animate-pulse',
  awaiting_approval: 'bg-indigo-500 animate-pulse',
  paused: 'bg-amber-500',
  completed: 'bg-gray-400',
  failed: 'bg-red-500',
  cancelled: 'bg-gray-400',
  archived: 'bg-gray-300 dark:bg-gray-600',
}

function timeAgo(dateStr?: string | null): string {
  if (!dateStr) return 'just now'
  const ms = Math.max(0, Date.now() - new Date(dateStr).getTime())
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function elapsed(startStr?: string | null, endStr?: string | null): string {
  if (!startStr) return '—'
  const start = new Date(startStr).getTime()
  const end = endStr ? new Date(endStr).getTime() : Date.now()
  const ms = Math.max(0, end - start)
  const total = Math.floor(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  if (m > 59) {
    const h = Math.floor(m / 60)
    return `${h}h ${m % 60}m`
  }
  return `${m}m ${String(s).padStart(2, '0')}s`
}

function groupByProject(runs: Run[]): Map<string, Run[]> {
  const groups = new Map<string, Run[]>()
  const scratchRuns: Run[] = []
  for (const run of runs) {
    if (run.project_id === 'scratch') {
      scratchRuns.push(run)
    } else {
      const key = run.project_id
      const list = groups.get(key) || []
      list.push(run)
      groups.set(key, list)
    }
  }
  const result = new Map<string, Run[]>()
  if (scratchRuns.length > 0 || runs.length === 0) {
    result.set('scratch', scratchRuns)
  }
  Array.from(groups.entries()).forEach(([k, v]) => {
    result.set(k, v)
  })
  return result
}

export default function NowGrid() {
  const { runs, loading, error, refresh } = useRuns()
  const { addToast } = useToast()
  const [filter, setFilter] = useState<Filter>('active')
  const [search, setSearch] = useState('')
  const [projectFilter, setProjectFilter] = useState<string | null>(null)
  const [busyActions, setBusyActions] = useState<Set<string>>(new Set())
  const [recentCollapsed, setRecentCollapsed] = useState<Set<string>>(new Set())

  const nonArchived = useMemo(
    () => runs.filter((r) => r.state !== 'archived'),
    [runs],
  )

  const filtered = useMemo(() => {
    let list = nonArchived

    if (filter === 'active') {
      list = list.filter((r) => ACTIVE_STATES.has(r.state))
    } else if (filter === 'awaiting') {
      list = list.filter((r) => r.state === 'awaiting_approval' || r.state === 'awaiting_input')
    } else if (filter === 'recent') {
      list = list.filter((r) => TERMINAL_STATES.has(r.state) && r.state !== 'archived')
    }

    if (projectFilter) {
      list = list.filter((r) => r.project_id === projectFilter)
    }

    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(
        (r) =>
          (r.title ?? '').toLowerCase().includes(q) ||
          r.project_id.toLowerCase().includes(q) ||
          (r.method_id ?? '').toLowerCase().includes(q),
      )
    }

    return list
  }, [nonArchived, filter, projectFilter, search])

  const grouped = useMemo(() => groupByProject(filtered), [filtered])

  const projectIds = useMemo(
    () => Array.from(new Set(nonArchived.map((r: Run) => r.project_id))).sort(),
    [nonArchived],
  )

  const runAction = useCallback(
    async (runId: string, action: () => Promise<unknown>, label: string) => {
      setBusyActions((prev) => new Set(prev).add(runId))
      try {
        await action()
        refresh()
      } catch (err: any) {
        addToast({
          type: 'error',
          title: `${label} failed`,
          message: err.message ?? 'Unknown error',
          autoClose: 5000,
        })
      } finally {
        setBusyActions((prev) => {
          const next = new Set(prev)
          next.delete(runId)
          return next
        })
      }
    },
    [refresh, addToast],
  )

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Now</h1>
        <div className="flex items-center gap-3 text-gray-500 dark:text-gray-400">
          <span className="inline-block w-4 h-4 border-2 border-gray-300 border-t-orange-500 rounded-full animate-spin" />
          Loading runs...
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Now</h1>
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4 text-sm text-red-700 dark:text-red-400">
          {error}
          <button onClick={refresh} className="ml-3 underline hover:no-underline">
            Retry
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Now</h1>
        <Link
          href="/runs/new"
          className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-orange-600 hover:bg-orange-700 rounded-lg transition-colors"
        >
          + New Run
        </Link>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
          {FILTER_CHIPS.map((chip) => (
            <button
              key={chip.key}
              onClick={() => setFilter(chip.key)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                filter === chip.key
                  ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
            >
              {chip.label}
            </button>
          ))}
        </div>

        {projectIds.length > 1 && (
          <select
            value={projectFilter ?? ''}
            onChange={(e) => setProjectFilter(e.target.value || null)}
            className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300"
          >
            <option value="">All projects</option>
            {projectIds.map((pid) => (
              <option key={pid} value={pid}>
                {pid === 'scratch' ? 'Scratch (sandbox)' : pid}
              </option>
            ))}
          </select>
        )}

        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search runs..."
          className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 placeholder-gray-400 w-48"
        />
      </div>

      {/* Grid */}
      {filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-400 dark:text-gray-500">
          <p className="text-lg font-medium">No runs match this filter</p>
          <p className="text-sm mt-1">
            {filter !== 'all' ? (
              <button onClick={() => setFilter('all')} className="text-orange-500 hover:underline">
                Show all runs
              </button>
            ) : (
              <Link href="/runs/new" className="text-orange-500 hover:underline">
                Start a new run
              </Link>
            )}
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          {Array.from(grouped.entries()).map(([projectId, projectRuns]) => {
            const activeRuns = projectRuns.filter((r: Run) => ACTIVE_STATES.has(r.state))
            const recentRuns = projectRuns.filter(
              (r: Run) => TERMINAL_STATES.has(r.state) && r.state !== 'archived',
            )
            const isCollapsed = recentCollapsed.has(projectId)

            return (
              <section key={projectId}>
                <div className="flex items-center gap-2 mb-3 sticky top-0 bg-gray-50 dark:bg-gray-900 py-1 z-10">
                  <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide">
                    {projectId === 'scratch' ? 'Scratch' : projectId}
                  </h2>
                  {projectId === 'scratch' && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 font-medium">
                      restricted
                    </span>
                  )}
                  <span className="text-xs text-gray-400 dark:text-gray-600">
                    {activeRuns.length} active
                  </span>
                </div>

                {/* Active runs grid */}
                {activeRuns.length > 0 && (
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 mb-3">
                    {activeRuns.map((run) => (
                      <RunCard
                        key={run.id}
                        run={run}
                        busy={busyActions.has(run.id)}
                        onAction={runAction}
                      />
                    ))}
                  </div>
                )}

                {/* Recent (terminal) runs — collapsible */}
                {recentRuns.length > 0 && (
                  <div>
                    <button
                      onClick={() =>
                        setRecentCollapsed((prev) => {
                          const next = new Set(prev)
                          if (next.has(projectId)) next.delete(projectId)
                          else next.add(projectId)
                          return next
                        })
                      }
                      className="flex items-center gap-1.5 text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-400 mb-2"
                    >
                      <span className={`transition-transform ${isCollapsed ? '' : 'rotate-90'}`}>
                        ▸
                      </span>
                      Recent ({recentRuns.length})
                    </button>
                    {!isCollapsed && (
                      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                        {recentRuns.map((run) => (
                          <RunCard
                            key={run.id}
                            run={run}
                            busy={busyActions.has(run.id)}
                            onAction={runAction}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}

function RunCard({
  run,
  busy,
  onAction,
}: {
  run: Run
  busy: boolean
  onAction: (id: string, action: () => Promise<unknown>, label: string) => void
}) {
  return (
    <div
      className={`relative rounded-xl border bg-white dark:bg-gray-800 p-4 transition-shadow hover:shadow-md ${
        busy ? 'opacity-60 pointer-events-none' : ''
      } ${
        run.state === 'failed'
          ? 'border-red-200 dark:border-red-800'
          : 'border-gray-200 dark:border-gray-700'
      }`}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <Link
          href={`/runs/${run.id}`}
          className="text-sm font-semibold text-gray-900 dark:text-white hover:text-orange-600 dark:hover:text-orange-400 truncate"
        >
          {run.title || 'Untitled run'}
        </Link>
        <span
          className={`flex-shrink-0 inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full ${
            STATUS_STYLES[run.state] ?? STATUS_STYLES.completed
          }`}
        >
          <span
            className={`w-1.5 h-1.5 rounded-full ${STATUS_DOTS[run.state] ?? 'bg-gray-400'}`}
          />
          {run.state.replace(/_/g, ' ')}
        </span>
      </div>

      <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 mb-3">
        {run.method_id ? (
          <span className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 font-medium">
            {run.method_id}
          </span>
        ) : (
          <span className="italic text-gray-400 dark:text-gray-600">no method</span>
        )}
        <span className="text-gray-300 dark:text-gray-600">|</span>
        <span>{elapsed(run.created_at, run.completed_at)}</span>
        <span className="text-gray-300 dark:text-gray-600">|</span>
        <span>{timeAgo(run.updated_at)}</span>
      </div>

      {/* Inline actions */}
      <div className="flex items-center gap-2">
        {run.state === 'awaiting_approval' && (
          <>
            <ActionButton
              label="Approve"
              color="indigo"
              onClick={() => onAction(run.id, () => approveRun(run.id, '', 'approve'), 'Approve')}
            />
            <ActionButton
              label="Skip"
              color="gray"
              onClick={() => onAction(run.id, () => approveRun(run.id, '', 'skip'), 'Skip')}
            />
          </>
        )}
        {run.state === 'paused' && (
          <ActionButton
            label="Resume"
            color="amber"
            onClick={() => onAction(run.id, () => resumeRun(run.id), 'Resume')}
          />
        )}
        {run.state === 'failed' && (
          <ActionButton
            label="Acknowledge"
            color="red"
            onClick={() => onAction(run.id, () => archiveRun(run.id), 'Acknowledge')}
          />
        )}
      </div>
    </div>
  )
}

function ActionButton({
  label,
  color,
  onClick,
}: {
  label: string
  color: string
  onClick: () => void
}) {
  const colors: Record<string, string> = {
    indigo: 'bg-indigo-100 text-indigo-700 hover:bg-indigo-200 dark:bg-indigo-900/30 dark:text-indigo-400 dark:hover:bg-indigo-900/50',
    gray: 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600',
    amber: 'bg-amber-100 text-amber-700 hover:bg-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:hover:bg-amber-900/50',
    red: 'bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-400 dark:hover:bg-red-900/50',
  }
  return (
    <button
      onClick={onClick}
      className={`text-[11px] font-medium px-2.5 py-1 rounded-md transition-colors ${colors[color] ?? colors.gray}`}
    >
      {label}
    </button>
  )
}
