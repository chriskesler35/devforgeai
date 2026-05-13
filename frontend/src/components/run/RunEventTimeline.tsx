'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { getEvent } from '@/lib/runs/api'
import type { RunEventSummary, RunEventFull, RunPhase } from '@/lib/runs/types'

const KIND_ICONS: Record<string, string> = {
  phase_start: '▶',
  phase_end: '■',
  agent_start: '🤖',
  tool_call: '🔧',
  tool_result: '📋',
  model_request: '→',
  model_response: '←',
  approval_gate: '🔔',
  user_intervention: '👤',
  error: '⚠',
}

const NESTED_KINDS = new Set(['tool_call', 'tool_result'])

interface Props {
  runId: string
  events: RunEventSummary[]
  phases: RunPhase[]
  powerToolsEnabled: boolean
  initialEventId?: string
}

export default function RunEventTimeline({
  runId,
  events,
  phases,
  powerToolsEnabled,
  initialEventId,
}: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(initialEventId ?? null)
  const [fullEvent, setFullEvent] = useState<RunEventFull | null>(null)
  const [loadingFull, setLoadingFull] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  const expand = useCallback(
    async (eventId: string) => {
      if (expandedId === eventId) {
        setExpandedId(null)
        setFullEvent(null)
        return
      }
      setExpandedId(eventId)
      setLoadingFull(true)
      try {
        const data = await getEvent(runId, eventId)
        setFullEvent(data)
      } catch {
        setFullEvent(null)
      } finally {
        setLoadingFull(false)
      }
    },
    [runId, expandedId],
  )

  useEffect(() => {
    if (initialEventId) expand(initialEventId)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const handler = (e: Event) => {
      const phaseId = (e as CustomEvent).detail?.phaseId
      if (!phaseId || !scrollRef.current) return
      const target = scrollRef.current.querySelector(`[data-phase-id="${phaseId}"]`)
      target?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
    window.addEventListener('run-phase-scroll', handler)
    return () => window.removeEventListener('run-phase-scroll', handler)
  }, [])

  const firstEventMs = events[0]?.created_at
    ? new Date(events[0].created_at).getTime()
    : Date.now()

  return (
    <div
      ref={scrollRef}
      className="h-full overflow-y-auto bg-gray-50 dark:bg-gray-900/50 border-r border-gray-200 dark:border-gray-700"
    >
      <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-700 sticky top-0 bg-gray-50 dark:bg-gray-900/50 z-10">
        <h3 className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">
          Events ({events.length})
        </h3>
      </div>

      {events.length === 0 ? (
        <div className="text-center text-sm text-gray-400 dark:text-gray-600 py-12">
          No events yet
        </div>
      ) : (
        <div className="divide-y divide-gray-100 dark:divide-gray-800">
          {events.map((evt) => {
            const isNested = NESTED_KINDS.has(evt.kind)
            const deltaMs = evt.created_at
              ? new Date(evt.created_at).getTime() - firstEventMs
              : 0
            const deltaSec = Math.round(deltaMs / 1000)
            const isExpanded = expandedId === evt.id
            const isError = evt.kind === 'error'

            return (
              <div
                key={evt.id}
                data-phase-id={evt.phase_id}
                className={isError ? 'bg-red-50/50 dark:bg-red-900/10' : ''}
              >
                <button
                  onClick={() => expand(evt.id)}
                  className={`w-full text-left px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors ${
                    isNested ? 'pl-8' : ''
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] w-10 text-right text-gray-400 dark:text-gray-600 flex-shrink-0 tabular-nums">
                      +{deltaSec}s
                    </span>
                    <span className="text-xs flex-shrink-0">
                      {KIND_ICONS[evt.kind] ?? '·'}
                    </span>
                    <span
                      className={`text-xs truncate ${
                        isError
                          ? 'text-red-600 dark:text-red-400 font-medium'
                          : 'text-gray-700 dark:text-gray-300'
                      }`}
                    >
                      {evt.summary}
                    </span>
                    {evt.duration_ms != null && (
                      <span className="ml-auto text-[10px] text-gray-400 dark:text-gray-600 flex-shrink-0 tabular-nums">
                        {evt.duration_ms}ms
                      </span>
                    )}
                  </div>
                  {evt.tokens_in != null && (
                    <div className="flex items-center gap-3 mt-0.5 ml-12">
                      <span className="text-[10px] text-gray-400">
                        {evt.tokens_in}↓ {evt.tokens_out}↑
                      </span>
                      {evt.cost_usd != null && evt.cost_usd > 0 && (
                        <span className="text-[10px] text-gray-400">
                          ${evt.cost_usd.toFixed(4)}
                        </span>
                      )}
                    </div>
                  )}
                </button>

                {/* T3 drawer */}
                {isExpanded && (
                  <EventDrawer
                    event={fullEvent}
                    loading={loadingFull}
                    powerToolsEnabled={powerToolsEnabled}
                    runId={runId}
                  />
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function EventDrawer({
  event,
  loading,
  powerToolsEnabled,
  runId,
}: {
  event: RunEventFull | null
  loading: boolean
  powerToolsEnabled: boolean
  runId: string
}) {
  if (loading) {
    return (
      <div className="px-6 py-4 text-xs text-gray-400 flex items-center gap-2">
        <span className="inline-block w-3 h-3 border border-gray-300 border-t-orange-500 rounded-full animate-spin" />
        Loading details...
      </div>
    )
  }

  if (!event) {
    return (
      <div className="px-6 py-3 text-xs text-gray-400">Failed to load event details</div>
    )
  }

  const payload = event.payload ?? {}
  const prompt = payload.prompt as string | undefined
  const response = payload.response as string | undefined
  const toolInput = payload.tool_input as string | undefined
  const toolOutput = payload.tool_output as string | undefined
  const errorClass = payload.error_class as string | undefined
  const traceback = payload.traceback as string | undefined
  const recoveryCandidates = payload.recovery_candidates as
    | { label: string; prompt: string }[]
    | undefined

  return (
    <div className="bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 px-4 py-3 space-y-3">
      {/* Error details */}
      {event.kind === 'error' && (
        <div className="space-y-2">
          {errorClass && (
            <p className="text-xs font-mono text-red-600 dark:text-red-400">{errorClass}</p>
          )}
          {traceback && (
            <CollapsibleBlock label="Traceback" content={traceback} mono danger />
          )}
          {recoveryCandidates && recoveryCandidates.length > 0 && (
            <div className="space-y-1">
              <p className="text-[10px] font-semibold text-gray-500 uppercase">Recovery</p>
              {recoveryCandidates.map((c, i) => (
                <button
                  key={i}
                  className="block text-xs text-orange-600 dark:text-orange-400 hover:underline"
                >
                  Retry: {c.label}
                </button>
              ))}
            </div>
          )}
          {!recoveryCandidates && (
            <p className="text-[10px] text-gray-400">Manual retry available via power tools</p>
          )}
        </div>
      )}

      {/* Prompt / Response */}
      {prompt && <CollapsibleBlock label="Prompt" content={prompt} copyable />}
      {response && <CollapsibleBlock label="Response" content={response} copyable />}

      {/* Tool I/O */}
      {toolInput && <CollapsibleBlock label="Tool input" content={toolInput} mono />}
      {toolOutput && <CollapsibleBlock label="Tool output" content={toolOutput} mono />}

      {/* Cost bar */}
      <div className="flex items-center gap-4 text-[10px] text-gray-400">
        {event.tokens_in != null && <span>Tokens in: {event.tokens_in}</span>}
        {event.tokens_out != null && <span>Tokens out: {event.tokens_out}</span>}
        {event.cost_usd != null && <span>Cost: ${event.cost_usd.toFixed(4)}</span>}
        {event.duration_ms != null && <span>Duration: {event.duration_ms}ms</span>}
      </div>

      {/* Power tool actions — rendered only when enabled */}
      {powerToolsEnabled && event.kind !== 'error' && (
        <div className="flex items-center gap-2 pt-1 border-t border-gray-100 dark:border-gray-700">
          <PowerToolBtn label="Edit & retry" eventId={event.id} runId={runId} />
          <PowerToolBtn label="Swap model" eventId={event.id} runId={runId} />
          <PowerToolBtn label="Fork from here" eventId={event.id} runId={runId} />
        </div>
      )}

      {/* Raw payload (collapsible) */}
      <CollapsibleBlock
        label="Raw payload"
        content={JSON.stringify(payload, null, 2)}
        mono
        defaultCollapsed
      />
    </div>
  )
}

function CollapsibleBlock({
  label,
  content,
  mono,
  danger,
  copyable,
  defaultCollapsed,
}: {
  label: string
  content: string
  mono?: boolean
  danger?: boolean
  copyable?: boolean
  defaultCollapsed?: boolean
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed ?? content.length > 500)

  const copy = useCallback(() => {
    navigator.clipboard.writeText(content)
  }, [content])

  return (
    <div>
      <div className="flex items-center gap-2">
        <button
          onClick={() => setCollapsed((p) => !p)}
          className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider flex items-center gap-1"
        >
          <span className={`transition-transform ${collapsed ? '' : 'rotate-90'}`}>▸</span>
          {label}
        </button>
        {copyable && !collapsed && (
          <button
            onClick={copy}
            className="text-[10px] text-gray-400 hover:text-orange-500"
            title="Copy to clipboard"
          >
            Copy
          </button>
        )}
      </div>
      {!collapsed && (
        <pre
          className={`mt-1 text-[11px] leading-relaxed max-h-60 overflow-auto rounded-md p-2 ${
            mono ? 'font-mono' : ''
          } ${
            danger
              ? 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300'
              : 'bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-300'
          }`}
        >
          {content}
        </pre>
      )}
    </div>
  )
}

function PowerToolBtn({
  label,
  eventId,
  runId,
}: {
  label: string
  eventId: string
  runId: string
}) {
  return (
    <button
      className="text-[10px] font-medium px-2 py-1 rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-orange-100 dark:hover:bg-orange-900/20 hover:text-orange-600 dark:hover:text-orange-400 transition-colors"
      data-event-id={eventId}
      data-run-id={runId}
    >
      {label}
    </button>
  )
}
