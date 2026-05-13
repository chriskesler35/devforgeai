'use client'

import { useCallback, useRef, useState } from 'react'
import Link from 'next/link'
import { patchRun, pauseRun, resumeRun, cancelRun } from '@/lib/runs/api'
import { useToast } from '@/app/ToastProvider'
import { TERMINAL_STATES } from '@/lib/runs/types'
import type { Run, RunPhase } from '@/lib/runs/types'
import PowerToolsToggle from './PowerToolsToggle'

const PHASE_STATUS_COLORS: Record<string, string> = {
  queued: 'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-400',
  running: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  done: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-500',
  failed: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  skipped: 'bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-600',
}

interface Props {
  run: Run
  phases: RunPhase[]
  reconnecting: boolean
  liveCount: number
  showLiveButton: boolean
  onLiveClick: () => void
  onRefresh: () => void
}

export default function RunTopStrip({
  run,
  phases,
  reconnecting,
  liveCount,
  showLiveButton,
  onLiveClick,
  onRefresh,
}: Props) {
  const { addToast } = useToast()
  const [editing, setEditing] = useState(false)
  const [titleDraft, setTitleDraft] = useState(run.title ?? '')
  const inputRef = useRef<HTMLInputElement>(null)

  const saveTitle = useCallback(async () => {
    setEditing(false)
    const trimmed = titleDraft.trim()
    if (!trimmed || trimmed === run.title) return
    try {
      await patchRun(run.id, { title: trimmed })
      onRefresh()
    } catch (err: any) {
      addToast({ type: 'error', title: 'Failed to update title', message: err.message, autoClose: 4000 })
    }
  }, [run.id, run.title, titleDraft, onRefresh, addToast])

  const lifecycleAction = useCallback(
    async (action: () => Promise<unknown>, label: string) => {
      try {
        await action()
        onRefresh()
      } catch (err: any) {
        addToast({ type: 'error', title: `${label} failed`, message: err.message, autoClose: 4000 })
      }
    },
    [onRefresh, addToast],
  )

  const isTerminal = TERMINAL_STATES.has(run.state)

  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-2.5 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/50">
      {/* Title */}
      <div className="flex items-center gap-2 min-w-0 flex-1">
        {editing ? (
          <input
            ref={inputRef}
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={saveTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter') saveTitle()
              if (e.key === 'Escape') setEditing(false)
            }}
            autoFocus
            className="text-sm font-semibold bg-transparent border-b border-orange-400 outline-none text-gray-900 dark:text-white px-0 py-0 w-48"
          />
        ) : (
          <button
            onClick={() => {
              setTitleDraft(run.title ?? '')
              setEditing(true)
            }}
            className="text-sm font-semibold text-gray-900 dark:text-white hover:text-orange-600 dark:hover:text-orange-400 truncate max-w-xs"
            title="Click to edit title"
          >
            {run.title || 'Untitled run'}
          </button>
        )}

        <Link
          href={`/projects/${run.project_id}`}
          className="text-[11px] text-gray-400 dark:text-gray-500 hover:text-orange-500 truncate"
        >
          {run.project_id}
        </Link>

        {run.method_id && (
          <span className="text-[11px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 font-medium">
            {run.method_id}
          </span>
        )}

        {reconnecting && (
          <span className="text-[10px] text-amber-500 animate-pulse font-medium">
            Reconnecting...
          </span>
        )}
      </div>

      {/* Phase chips */}
      {phases.length > 0 && (
        <div className="flex items-center gap-1 overflow-x-auto">
          {phases.map((phase) => (
            <button
              key={phase.id}
              onClick={() => {
                window.dispatchEvent(
                  new CustomEvent('run-phase-scroll', { detail: { phaseId: phase.id } }),
                )
              }}
              title={`${phase.name} — ${phase.status}`}
              className={`text-[10px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${
                PHASE_STATUS_COLORS[phase.status] ?? PHASE_STATUS_COLORS.queued
              }`}
            >
              {phase.name}
            </button>
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2">
        {showLiveButton && (
          <button
            onClick={onLiveClick}
            className="text-xs px-2.5 py-1 rounded-md bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 font-medium"
          >
            Live ({liveCount})
          </button>
        )}

        {run.state === 'running' && (
          <LifecycleBtn label="Pause" onClick={() => lifecycleAction(() => pauseRun(run.id), 'Pause')} />
        )}
        {(run.state === 'paused' || run.state === 'awaiting_input' || run.state === 'awaiting_approval') && (
          <LifecycleBtn label="Resume" onClick={() => lifecycleAction(() => resumeRun(run.id), 'Resume')} />
        )}
        {!isTerminal && (
          <LifecycleBtn
            label="Cancel"
            onClick={() => lifecycleAction(() => cancelRun(run.id), 'Cancel')}
            danger
          />
        )}
        <PowerToolsToggle
          runId={run.id}
          enabled={run.power_tools_enabled}
          onToggled={onRefresh}
        />
      </div>
    </div>
  )
}

function LifecycleBtn({
  label,
  onClick,
  danger,
}: {
  label: string
  onClick: () => void
  danger?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className={`text-[11px] font-medium px-2.5 py-1 rounded-md transition-colors ${
        danger
          ? 'text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/20'
          : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
      }`}
    >
      {label}
    </button>
  )
}
