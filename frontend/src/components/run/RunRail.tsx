'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRuns } from '@/hooks/useRuns'
import { TERMINAL_STATES } from '@/lib/runs/types'

const STATUS_ICONS: Record<string, string> = {
  running: '▶',
  awaiting_input: '⏳',
  awaiting_approval: '🔔',
  paused: '⏸',
  completed: '✓',
  failed: '✕',
  cancelled: '—',
}

const STATUS_ICON_COLORS: Record<string, string> = {
  running: 'text-emerald-500',
  awaiting_input: 'text-blue-500',
  awaiting_approval: 'text-indigo-500',
  paused: 'text-amber-500',
  completed: 'text-gray-400',
  failed: 'text-red-500',
  cancelled: 'text-gray-400',
}

interface Props {
  currentRunId: string
}

export default function RunRail({ currentRunId }: Props) {
  const { runs } = useRuns()
  const [showRecent, setShowRecent] = useState(false)

  const active = runs
    .filter((r) => !TERMINAL_STATES.has(r.state))
    .sort((a, b) => {
      const aTime = a.updated_at ? new Date(a.updated_at).getTime() : 0
      const bTime = b.updated_at ? new Date(b.updated_at).getTime() : 0
      return bTime - aTime
    })

  const recent = runs
    .filter((r) => TERMINAL_STATES.has(r.state) && r.state !== 'archived')
    .sort((a, b) => {
      const aTime = a.completed_at ? new Date(a.completed_at).getTime() : 0
      const bTime = b.completed_at ? new Date(b.completed_at).getTime() : 0
      return bTime - aTime
    })
    .slice(0, 5)

  const displayActive = active.slice(0, 8)
  const hasMoreActive = active.length > 8

  return (
    <aside className="h-full border-r border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 flex flex-col">
      <div className="px-2 py-2 border-b border-gray-200 dark:border-gray-700">
        <Link
          href="/now"
          className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider hover:text-orange-500"
        >
          Runs
        </Link>
      </div>

      <div className="flex-1 overflow-y-auto" style={{ maxHeight: 'calc(100% - 36px)' }}>
        {/* Active runs */}
        <div className="px-1 py-1">
          {displayActive.map((run) => (
            <RailEntry key={run.id} run={run} active={run.id === currentRunId} />
          ))}
          {hasMoreActive && (
            <div className="text-[10px] text-gray-400 dark:text-gray-600 text-center py-1">
              +{active.length - 8} more
            </div>
          )}
          {active.length === 0 && (
            <div className="text-[10px] text-gray-400 dark:text-gray-600 text-center py-3">
              No active runs
            </div>
          )}
        </div>

        {/* Recent — collapsed by default */}
        {recent.length > 0 && (
          <div className="border-t border-gray-200 dark:border-gray-700 px-1 py-1">
            <button
              onClick={() => setShowRecent((p) => !p)}
              className="w-full text-left text-[10px] text-gray-400 dark:text-gray-600 hover:text-gray-600 dark:hover:text-gray-400 px-1 py-1 flex items-center gap-1"
            >
              <span className={`transition-transform ${showRecent ? 'rotate-90' : ''}`}>▸</span>
              Recent
            </button>
            {showRecent &&
              recent.map((run) => (
                <RailEntry key={run.id} run={run} active={run.id === currentRunId} />
              ))}
          </div>
        )}
      </div>
    </aside>
  )
}

function RailEntry({
  run,
  active,
}: {
  run: { id: string; title: string | null; state: string }
  active: boolean
}) {
  return (
    <Link
      href={`/runs/${run.id}`}
      replace
      className={`flex items-center gap-1.5 px-2 py-1.5 rounded-md text-[11px] transition-colors truncate ${
        active
          ? 'bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-400 font-semibold'
          : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
      }`}
    >
      <span className={`flex-shrink-0 ${STATUS_ICON_COLORS[run.state] ?? 'text-gray-400'}`}>
        {STATUS_ICONS[run.state] ?? '·'}
      </span>
      <span className="truncate">{run.title || 'Untitled'}</span>
    </Link>
  )
}
