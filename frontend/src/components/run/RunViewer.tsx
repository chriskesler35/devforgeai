'use client'

import { useState } from 'react'
import { useRun } from '@/hooks/useRun'
import {
  useViewerLayout,
  RUN_VIEWER_GRID_WIDE,
  RUN_VIEWER_GRID_NARROW,
} from '@/lib/runs/breakpoints'
import RunTopStrip from './RunTopStrip'
import RunRail from './RunRail'
import RunChatPane from './RunChatPane'
import RunEventTimeline from './RunEventTimeline'
import RunLiveAgents from './RunLiveAgents'

interface Props {
  runId: string
  initialEventId?: string
}

export default function RunViewer({ runId, initialEventId }: Props) {
  const state = useRun(runId)
  const layout = useViewerLayout()
  const [liveSlideOpen, setLiveSlideOpen] = useState(false)

  if (state.loading) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500 dark:text-gray-400">
        <span className="inline-block w-5 h-5 border-2 border-gray-300 border-t-orange-500 rounded-full animate-spin mr-2" />
        Loading run...
      </div>
    )
  }

  if (state.error || !state.run) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-6 max-w-md text-center">
          <p className="text-sm text-red-700 dark:text-red-400">{state.error ?? 'Run not found'}</p>
          <button
            onClick={state.refresh}
            className="mt-3 text-sm text-orange-600 hover:underline"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  const gridTemplate =
    layout === 'wide'
      ? RUN_VIEWER_GRID_WIDE
      : layout === 'narrow'
      ? RUN_VIEWER_GRID_NARROW
      : '1fr'

  const liveAgentCount = deriveLiveAgentCount(state.events)

  return (
    <div className="flex flex-col h-full min-h-0">
      <RunTopStrip
        run={state.run}
        phases={state.phases}
        reconnecting={state.reconnecting}
        liveCount={liveAgentCount}
        showLiveButton={layout !== 'wide'}
        onLiveClick={() => setLiveSlideOpen(true)}
        onRefresh={state.refresh}
      />

      {layout === 'mobile' ? (
        <MobileLayout
          state={state}
          initialEventId={initialEventId}
          liveSlideOpen={liveSlideOpen}
          onCloseLive={() => setLiveSlideOpen(false)}
        />
      ) : (
        <div
          className="flex-1 min-h-0 grid gap-0"
          style={{ gridTemplateColumns: gridTemplate }}
        >
          <RunRail currentRunId={runId} />
          <RunChatPane
            runId={runId}
            messages={state.messages}
            runState={state.run.state}
            extraData={state.run.extra_data}
            onRefresh={state.refresh}
          />
          <RunEventTimeline
            runId={runId}
            events={state.events}
            phases={state.phases}
            powerToolsEnabled={state.run.power_tools_enabled}
            initialEventId={initialEventId}
          />
          {layout === 'wide' && (
            <RunLiveAgents
              run={state.run}
              events={state.events}
              onRefresh={state.refresh}
            />
          )}
        </div>
      )}

      {/* Slide-over for live agents on narrow layout */}
      {layout === 'narrow' && liveSlideOpen && (
        <div className="fixed inset-0 z-40 flex justify-end">
          <div
            className="absolute inset-0 bg-black/30"
            onClick={() => setLiveSlideOpen(false)}
          />
          <div className="relative w-80 max-w-full bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-700 shadow-xl overflow-y-auto">
            <div className="flex items-center justify-between p-3 border-b border-gray-200 dark:border-gray-700">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
                Live Agents
              </h3>
              <button
                onClick={() => setLiveSlideOpen(false)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-sm"
              >
                ✕
              </button>
            </div>
            <RunLiveAgents
              run={state.run}
              events={state.events}
              onRefresh={state.refresh}
            />
          </div>
        </div>
      )}
    </div>
  )
}

function MobileLayout({
  state,
  initialEventId,
  liveSlideOpen,
  onCloseLive,
}: {
  state: ReturnType<typeof useRun>
  initialEventId?: string
  liveSlideOpen: boolean
  onCloseLive: () => void
}) {
  const [tab, setTab] = useState<'chat' | 'events'>('chat')

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex border-b border-gray-200 dark:border-gray-700">
        <button
          onClick={() => setTab('chat')}
          className={`flex-1 py-2 text-xs font-medium text-center transition-colors ${
            tab === 'chat'
              ? 'text-orange-600 border-b-2 border-orange-500'
              : 'text-gray-500 dark:text-gray-400'
          }`}
        >
          Chat
        </button>
        <button
          onClick={() => setTab('events')}
          className={`flex-1 py-2 text-xs font-medium text-center transition-colors ${
            tab === 'events'
              ? 'text-orange-600 border-b-2 border-orange-500'
              : 'text-gray-500 dark:text-gray-400'
          }`}
        >
          Events
        </button>
      </div>
      <div className="flex-1 min-h-0">
        {tab === 'chat' && state.run && (
          <RunChatPane
            runId={state.run.id}
            messages={state.messages}
            runState={state.run.state}
            extraData={state.run.extra_data}
            onRefresh={state.refresh}
          />
        )}
        {tab === 'events' && state.run && (
          <RunEventTimeline
            runId={state.run.id}
            events={state.events}
            phases={state.phases}
            powerToolsEnabled={state.run.power_tools_enabled}
            initialEventId={initialEventId}
          />
        )}
      </div>

      {liveSlideOpen && state.run && (
        <div className="fixed inset-0 z-40 flex justify-end">
          <div className="absolute inset-0 bg-black/30" onClick={onCloseLive} />
          <div className="relative w-80 max-w-full bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-700 shadow-xl overflow-y-auto">
            <div className="flex items-center justify-between p-3 border-b border-gray-200 dark:border-gray-700">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Live Agents</h3>
              <button onClick={onCloseLive} className="text-gray-400 hover:text-gray-600 text-sm">
                ✕
              </button>
            </div>
            <RunLiveAgents
              run={state.run}
              events={state.events}
              onRefresh={state.refresh}
            />
          </div>
        </div>
      )}
    </div>
  )
}

function deriveLiveAgentCount(events: { kind: string }[]): number {
  const activeAgents = new Set<string>()
  for (const e of events) {
    if (e.kind === 'agent_start') activeAgents.add(e.kind)
    else if (e.kind === 'phase_end' || e.kind === 'error') activeAgents.clear()
  }
  return activeAgents.size > 0 ? activeAgents.size : 0
}
