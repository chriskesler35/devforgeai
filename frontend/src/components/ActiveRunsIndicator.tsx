'use client'

/**
 * ActiveRunsIndicator — global nav widget showing in-flight pipelines/sessions.
 *
 * Polls /v1/workbench/pipelines + /v1/workbench/sessions, then renders:
 *   • count of active (running/pending/awaiting_approval/waiting/paused) runs
 *   • health pill — live (recent activity), idle (no recent activity), stuck
 *     (≥120s since last update on a running run, or run created ≥120s ago with
 *     no progress at all — the zombie case)
 *   • click → if exactly one active run, deep-link to its detail page;
 *     otherwise → /runs
 *
 * This is the user-facing fix for "I kicked off a pipeline but had no way to
 * know if it's stuck."
 */

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { API_BASE, AUTH_HEADERS } from '@/lib/config'

const ACTIVE_STATUSES = new Set([
  'pending', 'running', 'awaiting_approval', 'waiting', 'paused',
])
const STUCK_THRESHOLD_SECONDS = 120

type PipelineSummary = {
  id: string
  status: string
  initial_task?: string
  current_phase_index?: number
  phases?: unknown[]
  created_at?: string | null
}

type SessionSummary = {
  id: string
  status: string
  task?: string
  created_at?: string | null
  updated_at?: string | null
  last_activity_at?: string | null
}

type ActiveRun = {
  id: string
  kind: 'pipeline' | 'session'
  title: string
  status: string
  href: string
  ageSeconds: number
  stuck: boolean
}

function ageSeconds(iso?: string | null): number | null {
  if (!iso) return null
  // SQL timestamps from SQLite arrive without a 'Z' suffix; treat as UTC.
  const safe = /Z|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : iso.replace(' ', 'T') + 'Z'
  const ms = new Date(safe).getTime()
  if (!Number.isFinite(ms)) return null
  return Math.max(0, Math.floor((Date.now() - ms) / 1000))
}

function formatAge(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const m = Math.floor(seconds / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  return `${h}h`
}

export function ActiveRunsIndicator({ collapsed }: { collapsed: boolean }) {
  const [pipelines, setPipelines] = useState<PipelineSummary[]>([])
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [loaded, setLoaded] = useState(false)
  const [, forceTick] = useState(0)

  useEffect(() => {
    let cancelled = false
    const fetchAll = async () => {
      try {
        const [pRes, sRes] = await Promise.all([
          fetch(`${API_BASE}/v1/workbench/pipelines`, { headers: AUTH_HEADERS })
            .then(r => r.ok ? r.json() : { data: [] })
            .catch(() => ({ data: [] })),
          fetch(`${API_BASE}/v1/workbench/sessions`, { headers: AUTH_HEADERS })
            .then(r => r.ok ? r.json() : { data: [] })
            .catch(() => ({ data: [] })),
        ])
        if (cancelled) return
        setPipelines(Array.isArray(pRes?.data) ? pRes.data : [])
        setSessions(Array.isArray(sRes?.data) ? sRes.data : [])
        setLoaded(true)
      } catch {
        if (!cancelled) setLoaded(true)
      }
    }
    fetchAll()
    // Poll faster while something appears active, slower otherwise.
    const interval = setInterval(fetchAll, 5000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [])

  // Re-render every 10s so the age display stays fresh even without new data.
  useEffect(() => {
    const tick = setInterval(() => forceTick(t => t + 1), 10000)
    return () => clearInterval(tick)
  }, [])

  const activeRuns = useMemo<ActiveRun[]>(() => {
    const pipeRows: ActiveRun[] = pipelines
      .filter(p => ACTIVE_STATUSES.has(p.status))
      .map(p => {
        const age = ageSeconds(p.created_at) ?? 0
        const stuck = p.status === 'running' && age >= STUCK_THRESHOLD_SECONDS
        return {
          id: p.id,
          kind: 'pipeline' as const,
          title: p.initial_task || 'Pipeline',
          status: p.status,
          href: `/workbench/pipelines/${p.id}`,
          ageSeconds: age,
          stuck,
        }
      })

    // Sessions linked to a pipeline are surfaced via the pipeline row;
    // we only show standalone sessions here.
    const pipelineSessionIds = new Set(
      pipelines.map(p => (p as any).session_id).filter((x: unknown): x is string => typeof x === 'string')
    )
    const sessRows: ActiveRun[] = sessions
      .filter(s => ACTIVE_STATUSES.has(s.status) && !pipelineSessionIds.has(s.id))
      .map(s => {
        const lastActivity = s.last_activity_at || s.updated_at || s.created_at
        const age = ageSeconds(lastActivity) ?? 0
        const stuck = s.status === 'running' && age >= STUCK_THRESHOLD_SECONDS
        return {
          id: s.id,
          kind: 'session' as const,
          title: s.task || 'Session',
          status: s.status,
          href: `/workbench/${s.id}`,
          ageSeconds: age,
          stuck,
        }
      })

    return [...pipeRows, ...sessRows].sort((a, b) => a.ageSeconds - b.ageSeconds)
  }, [pipelines, sessions])

  if (!loaded) return null
  if (activeRuns.length === 0) return null

  const stuckCount = activeRuns.filter(r => r.stuck).length
  const awaitingCount = activeRuns.filter(r => r.status === 'awaiting_approval').length
  const oldestSecs = activeRuns.length > 0 ? activeRuns[activeRuns.length - 1].ageSeconds : 0
  const newestSecs = activeRuns.length > 0 ? activeRuns[0].ageSeconds : 0

  // If exactly one active run, deep-link to its detail page. Otherwise list view.
  const target = activeRuns.length === 1 ? activeRuns[0].href : '/runs'

  const tone =
    stuckCount > 0 ? 'stuck' :
    awaitingCount > 0 ? 'awaiting' :
    newestSecs < 30 ? 'live' :
    'idle'

  const dotColor =
    tone === 'stuck'    ? 'bg-amber-500 animate-pulse' :
    tone === 'awaiting' ? 'bg-amber-400' :
    tone === 'live'     ? 'bg-emerald-500 animate-pulse' :
                          'bg-blue-400'

  const bgClass =
    tone === 'stuck'    ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 hover:bg-amber-100 dark:hover:bg-amber-900/30' :
    tone === 'awaiting' ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 hover:bg-amber-100 dark:hover:bg-amber-900/30' :
                          'bg-indigo-50 dark:bg-indigo-900/20 border-indigo-200 dark:border-indigo-800 hover:bg-indigo-100 dark:hover:bg-indigo-900/30'

  const labelLine =
    tone === 'stuck'    ? `${stuckCount} stuck — needs attention` :
    tone === 'awaiting' ? `${awaitingCount} awaiting approval` :
    tone === 'live'     ? 'Activity just now' :
                          `Last update ${formatAge(newestSecs)} ago`

  const tooltip =
    `${activeRuns.length} active run${activeRuns.length === 1 ? '' : 's'}` +
    (stuckCount    ? ` · ${stuckCount} stuck`    : '') +
    (awaitingCount ? ` · ${awaitingCount} awaiting approval` : '') +
    ` · oldest ${formatAge(oldestSecs)} ago`

  return (
    <Link
      href={target}
      title={tooltip}
      className={`flex items-center gap-2 rounded-lg border px-3 py-2 transition-colors ${bgClass} ${collapsed ? 'justify-center' : ''}`}
    >
      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${dotColor}`} />
      {!collapsed && (
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-gray-900 dark:text-gray-100">
              {activeRuns.length} active
            </span>
            <span className="text-[10px] text-gray-500 dark:text-gray-400">
              {activeRuns.length === 1 ? '· tap to open' : '· tap for Run Center'}
            </span>
          </div>
          <p className={`text-[11px] truncate ${tone === 'stuck' ? 'text-amber-700 dark:text-amber-300 font-medium' : 'text-gray-600 dark:text-gray-400'}`}>
            {labelLine}
          </p>
        </div>
      )}
      {!collapsed && stuckCount > 0 && (
        <span className="text-[10px] font-bold text-amber-700 dark:text-amber-300 flex-shrink-0">!</span>
      )}
    </Link>
  )
}
