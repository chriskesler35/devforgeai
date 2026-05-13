'use client'

import { useMemo } from 'react'
import { useToast } from '@/app/ToastProvider'
import { approveRun } from '@/lib/runs/api'
import type { Run, RunEventSummary } from '@/lib/runs/types'
import RunApprovalBanner from './RunApprovalBanner'

interface LiveAgent {
  role: string
  model: string | null
  currentTool: string | null
  startedAt: string | null
}

interface Props {
  run: Run
  events: RunEventSummary[]
  onRefresh: () => void
}

export default function RunLiveAgents({ run, events, onRefresh }: Props) {
  const agents = useMemo(() => deriveLiveAgents(events), [events])

  const approvalEvent = useMemo(() => {
    if (run.state !== 'awaiting_approval') return null
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i].kind === 'approval_gate') return events[i]
    }
    return null
  }, [run.state, events])

  return (
    <div className="h-full overflow-y-auto bg-white dark:bg-gray-900 p-3 space-y-3">
      {approvalEvent && (
        <RunApprovalBanner
          run={run}
          gateEvent={approvalEvent}
          onRefresh={onRefresh}
        />
      )}

      <h3 className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">
        Live Agents ({agents.length})
      </h3>

      {agents.length === 0 ? (
        <p className="text-xs text-gray-400 dark:text-gray-600 py-4 text-center">
          {run.state === 'running' ? 'Waiting for agents...' : 'No active agents'}
        </p>
      ) : (
        <div className="space-y-2">
          {agents.map((agent, i) => (
            <AgentCard key={i} agent={agent} />
          ))}
        </div>
      )}
    </div>
  )
}

function AgentCard({ agent }: { agent: LiveAgent }) {
  const elapsedStr = agent.startedAt ? formatElapsed(agent.startedAt) : '—'

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 p-3">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-semibold text-gray-800 dark:text-gray-200">
          {agent.role}
        </span>
        <span className="text-[10px] text-gray-400 tabular-nums">{elapsedStr}</span>
      </div>
      {agent.model && (
        <p className="text-[10px] text-gray-500 dark:text-gray-400">{agent.model}</p>
      )}
      {agent.currentTool && (
        <p className="text-[10px] text-emerald-600 dark:text-emerald-400 mt-1 truncate">
          {agent.currentTool}
        </p>
      )}
    </div>
  )
}

function deriveLiveAgents(events: RunEventSummary[]): LiveAgent[] {
  const agentMap = new Map<string, LiveAgent>()

  for (const evt of events) {
    if (evt.kind === 'agent_start') {
      const role = evt.summary || 'agent'
      agentMap.set(role, {
        role,
        model: null,
        currentTool: null,
        startedAt: evt.created_at,
      })
    } else if (evt.kind === 'tool_call') {
      Array.from(agentMap.values()).forEach((agent) => {
        agent.currentTool = evt.summary
      })
    } else if (evt.kind === 'phase_end' || evt.kind === 'error') {
      agentMap.clear()
    }
  }

  return Array.from(agentMap.values())
}

function formatElapsed(startStr: string): string {
  const ms = Math.max(0, Date.now() - new Date(startStr).getTime())
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return `${m}m ${s % 60}s`
}
