'use client'

/**
 * STATIC MOCK — Now Pill + Now Panel
 *
 * No backend wiring. Hard-coded fake data so we can eyeball the IA before
 * committing to a phase plan. Render via /mocks/now.
 */

import { useState } from 'react'

// ---------- Fake data ---------------------------------------------------

type RunStatus = 'running' | 'stalled' | 'waiting_approval' | 'completed' | 'failed'

interface FakeEvent {
  t: string                   // relative time, e.g. "12s"
  kind: 'tool' | 'model' | 'phase' | 'file' | 'error' | 'note'
  text: string
  detail?: string
}

interface FakePhase {
  index: number
  name: string
  agent: string
  model: string
  status: 'done' | 'running' | 'queued' | 'failed'
  duration?: string
  tokens?: { in: number; out: number }
}

interface FakeRun {
  id: string
  title: string
  method: string
  project: string
  status: RunStatus
  elapsed: string
  phases: FakePhase[]
  currentPhaseIndex: number
  events: FakeEvent[]
  tokens: { in: number; out: number }
  costUsd: number
}

interface ProviderState {
  id: string
  provider: string
  connection: 'oauth' | 'api-key' | 'local'
  status: 'connected' | 'degraded' | 'disconnected'
  selectedModel: string
  catalog: {
    live: number
    staticOnly: number
    refreshed: string
  }
  note?: string
}

const FAKE_RUNS: FakeRun[] = [
  {
    id: 'run-bmad-001',
    title: 'Add OAuth login flow',
    method: 'BMAD',
    project: 'devforgeai',
    status: 'running',
    elapsed: '4m 12s',
    currentPhaseIndex: 2,
    tokens: { in: 18420, out: 6210 },
    costUsd: 0.34,
    phases: [
      { index: 0, name: 'Analyst',     agent: 'Research Analyst',  model: 'claude-sonnet-4.6', status: 'done',    duration: '52s',  tokens: { in: 4200, out: 1100 } },
      { index: 1, name: 'PM',          agent: 'Product Manager',   model: 'gpt-5.4',            status: 'done',    duration: '1m 18s', tokens: { in: 6100, out: 2400 } },
      { index: 2, name: 'Architect',   agent: 'System Architect',  model: 'claude-opus-4.7',    status: 'running', duration: '0m 32s', tokens: { in: 8120, out: 2710 } },
      { index: 3, name: 'Developer',   agent: 'Senior Developer',  model: 'gpt-5.3-codex',      status: 'queued' },
      { index: 4, name: 'QA',          agent: 'Test Engineer',     model: 'claude-sonnet-4.6',  status: 'queued' },
      { index: 5, name: 'Reviewer',    agent: 'Code Reviewer',     model: 'claude-opus-4.7',    status: 'queued' },
    ],
    events: [
      { t: '4s',  kind: 'tool',  text: 'read_local_file',  detail: 'backend/app/routes/auth.py' },
      { t: '8s',  kind: 'tool',  text: 'list_dir',         detail: 'backend/app/routes/' },
      { t: '12s', kind: 'tool',  text: 'web_fetch',        detail: 'docs.authlib.org/oauth/server' },
      { t: '18s', kind: 'note',  text: 'Architect drafting integration plan…' },
      { t: '24s', kind: 'tool',  text: 'read_local_file',  detail: 'backend/app/models/user.py' },
      { t: '32s', kind: 'model', text: 'streaming response', detail: '2,710 tokens so far' },
    ],
  },
  {
    id: 'run-gsd-002',
    title: 'Refactor model client',
    method: 'GSD',
    project: 'devforgeai',
    status: 'stalled',
    elapsed: '2m 47s',
    currentPhaseIndex: 1,
    tokens: { in: 3200, out: 480 },
    costUsd: 0.06,
    phases: [
      { index: 0, name: 'Plan',     agent: 'Planner',  model: 'claude-opus-4.7',  status: 'done',    duration: '38s' },
      { index: 1, name: 'Execute',  agent: 'Executor', model: 'gpt-5.3-codex',    status: 'running', duration: '2m 09s' },
      { index: 2, name: 'Verify',   agent: 'Verifier', model: 'claude-sonnet-4.6', status: 'queued' },
    ],
    events: [
      { t: '8s', kind: 'tool',  text: 'run_shell', detail: 'pytest backend/tests -q' },
      { t: '2m 03s', kind: 'error', text: 'No event for 78s', detail: 'phase may be stalled' },
    ],
  },
]

const RECENT_RUNS = [
  { id: 'r-91', title: 'Telegram remote tests', method: 'GSD',  status: 'completed', elapsed: '3m 04s', when: '14m ago' },
  { id: 'r-90', title: 'Fix workbench hang',    method: 'GSD',  status: 'completed', elapsed: '1m 51s', when: '38m ago' },
  { id: 'r-89', title: 'Add tool advert prompt', method: 'BMAD', status: 'failed',    elapsed: '0m 42s', when: '1h ago' },
] as const

const PROVIDER_STATES: ProviderState[] = [
  {
    id: 'p-github-copilot',
    provider: 'GitHub Copilot',
    connection: 'oauth',
    status: 'degraded',
    selectedModel: 'claude-sonnet-4.5',
    catalog: { live: 7, staticOnly: 23, refreshed: '2m ago' },
    note: 'Token likely lacks copilot scope; showing mixed live/static catalog.',
  },
  {
    id: 'p-openai-codex',
    provider: 'OpenAI Codex',
    connection: 'oauth',
    status: 'connected',
    selectedModel: 'gpt-5.5-pro',
    catalog: { live: 16, staticOnly: 0, refreshed: '2m ago' },
  },
  {
    id: 'p-google',
    provider: 'Google',
    connection: 'api-key',
    status: 'connected',
    selectedModel: 'gemini-2.5-pro',
    catalog: { live: 44, staticOnly: 0, refreshed: '2m ago' },
  },
  {
    id: 'p-ollama',
    provider: 'Ollama',
    connection: 'local',
    status: 'connected',
    selectedModel: 'llama3.1:8b',
    catalog: { live: 20, staticOnly: 0, refreshed: '2m ago' },
  },
]

// ---------- Tiny presentational helpers --------------------------------

function StatusDot({ status }: { status: RunStatus | 'done' | 'queued' | 'failed' | 'completed' }) {
  const map: Record<string, string> = {
    running:          'bg-emerald-500 animate-pulse',
    stalled:          'bg-amber-500 animate-pulse',
    waiting_approval: 'bg-indigo-500 animate-pulse',
    completed:        'bg-gray-400',
    done:             'bg-gray-400',
    failed:           'bg-red-500',
    queued:           'bg-gray-300 dark:bg-gray-600',
  }
  return <span className={`inline-block w-2 h-2 rounded-full ${map[status] ?? 'bg-gray-400'}`} />
}

function EventIcon({ kind }: { kind: FakeEvent['kind'] }) {
  const map: Record<FakeEvent['kind'], string> = {
    tool: '🛠', model: '🧠', phase: '➡', file: '📄', error: '⚠', note: '·',
  }
  return <span className="text-xs flex-shrink-0 w-4 text-center">{map[kind]}</span>
}

// ---------- NowPill (top bar) ------------------------------------------

export function NowPill({ onClick }: { onClick: () => void }) {
  const running = FAKE_RUNS.filter(r => r.status === 'running').length
  const stalled = FAKE_RUNS.filter(r => r.status === 'stalled').length
  const primary = FAKE_RUNS[0]
  const phase = primary.phases[primary.currentPhaseIndex]

  return (
    <button
      onClick={onClick}
      className="group inline-flex items-center gap-2 h-8 pl-2 pr-3 rounded-full
                 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800
                 hover:border-emerald-400 dark:hover:border-emerald-500 transition-colors text-xs"
    >
      <StatusDot status={stalled > 0 ? 'stalled' : 'running'} />
      <span className="font-semibold text-gray-700 dark:text-gray-200">
        {running} running{stalled > 0 ? ` · ${stalled} stalled` : ''}
      </span>
      <span className="text-gray-400 dark:text-gray-500">·</span>
      <span className="text-gray-500 dark:text-gray-400 truncate max-w-[180px]">
        {primary.method} · {phase.name} {primary.currentPhaseIndex + 1}/{primary.phases.length} · {primary.elapsed}
      </span>
      <span className="text-gray-300 dark:text-gray-600 group-hover:text-emerald-500">▸</span>
    </button>
  )
}

// ---------- NowPanel (slide-over) --------------------------------------

export function NowPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [selectedId, setSelectedId] = useState<string>(FAKE_RUNS[0].id)
  const selected = FAKE_RUNS.find(r => r.id === selectedId) ?? FAKE_RUNS[0]

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* backdrop */}
      <div className="flex-1 bg-black/40" onClick={onClose} />

      {/* slide-over */}
      <aside className="w-[820px] max-w-[95vw] h-full bg-white dark:bg-gray-950 border-l border-gray-200 dark:border-gray-800 shadow-2xl flex flex-col">
        {/* header */}
        <div className="px-5 py-3 border-b border-gray-200 dark:border-gray-800 flex items-center gap-3">
          <span className="text-emerald-500 text-lg">🟢</span>
          <h2 className="font-semibold text-gray-800 dark:text-gray-100">Now</h2>
          <span className="text-xs text-gray-400">{FAKE_RUNS.length} active · {RECENT_RUNS.length} recent</span>
          <div className="ml-auto flex items-center gap-2">
            <button className="text-xs text-gray-500 hover:text-gray-800 dark:hover:text-gray-200">⏸ Pause all</button>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-lg leading-none">×</button>
          </div>
        </div>

        <div className="flex-1 grid grid-cols-[260px_1fr] overflow-hidden">
          {/* left: run list */}
          <div className="border-r border-gray-200 dark:border-gray-800 overflow-y-auto">
            <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
              Active
            </div>
            {FAKE_RUNS.map(r => (
              <button
                key={r.id}
                onClick={() => setSelectedId(r.id)}
                className={`w-full text-left px-3 py-2.5 border-l-2 transition-colors ${
                  r.id === selectedId
                    ? 'border-emerald-500 bg-emerald-50/50 dark:bg-emerald-900/10'
                    : 'border-transparent hover:bg-gray-50 dark:hover:bg-gray-900'
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <StatusDot status={r.status} />
                  <span className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{r.title}</span>
                </div>
                <div className="text-[11px] text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
                  <span className="font-mono">{r.method}</span>
                  <span>·</span>
                  <span>phase {r.currentPhaseIndex + 1}/{r.phases.length}</span>
                  <span>·</span>
                  <span>{r.elapsed}</span>
                </div>
                {r.status === 'stalled' && (
                  <div className="mt-1 text-[10px] text-amber-600 dark:text-amber-400">⚠ no events 78s</div>
                )}
              </button>
            ))}

            <div className="px-3 py-2 mt-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
              Recent
            </div>
            {RECENT_RUNS.map(r => (
              <div key={r.id} className="px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-900 cursor-pointer">
                <div className="flex items-center gap-2 mb-0.5">
                  <StatusDot status={r.status as RunStatus} />
                  <span className="text-xs text-gray-700 dark:text-gray-300 truncate">{r.title}</span>
                </div>
                <div className="text-[10px] text-gray-400">{r.method} · {r.elapsed} · {r.when}</div>
              </div>
            ))}
          </div>

          {/* right: detail */}
          <div className="overflow-y-auto">
            {/* run header */}
            <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-800">
              <div className="flex items-start justify-between gap-3 mb-2">
                <div>
                  <h3 className="text-base font-semibold text-gray-800 dark:text-gray-100">{selected.title}</h3>
                  <p className="text-xs text-gray-500 mt-0.5">
                    <span className="font-mono">{selected.method}</span>
                    <span className="mx-1.5">·</span>
                    <span>{selected.project}</span>
                    <span className="mx-1.5">·</span>
                    <span>{selected.elapsed} elapsed</span>
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  <button className="px-2.5 py-1 text-xs rounded-md border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800">Open run</button>
                  <button className="px-2.5 py-1 text-xs rounded-md border border-red-200 text-red-600 hover:bg-red-50 dark:border-red-900/40 dark:hover:bg-red-900/20">Cancel</button>
                </div>
              </div>
              <div className="flex items-center gap-4 text-[11px] text-gray-500 dark:text-gray-400">
                <span>📥 {selected.tokens.in.toLocaleString()} in</span>
                <span>📤 {selected.tokens.out.toLocaleString()} out</span>
                <span>💵 ${selected.costUsd.toFixed(2)}</span>
              </div>
            </div>

            {/* phases */}
            <div className="px-5 py-3 border-b border-gray-200 dark:border-gray-800">
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                {selected.phases.map(p => (
                  <div
                    key={p.index}
                    className={`flex-shrink-0 px-2.5 py-1.5 rounded-md border text-xs flex items-center gap-1.5 ${
                      p.status === 'running'
                        ? 'border-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 dark:border-emerald-700'
                        : p.status === 'done'
                        ? 'border-gray-200 dark:border-gray-800 text-gray-500'
                        : p.status === 'failed'
                        ? 'border-red-300 bg-red-50 text-red-700 dark:bg-red-900/20 dark:border-red-800'
                        : 'border-dashed border-gray-200 dark:border-gray-800 text-gray-400'
                    }`}
                  >
                    <StatusDot status={p.status} />
                    <span className="font-medium">{p.index + 1}. {p.name}</span>
                    {p.duration && <span className="text-gray-400 font-mono">{p.duration}</span>}
                  </div>
                ))}
              </div>
            </div>

            {/* current phase context */}
            <div className="px-5 py-3 border-b border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/30">
              <div className="text-[10px] uppercase tracking-wider text-gray-400 mb-1.5">
                Current phase · {selected.phases[selected.currentPhaseIndex].name}
              </div>
              <div className="grid grid-cols-3 gap-3 text-xs">
                <div>
                  <div className="text-gray-400">Agent</div>
                  <div className="text-gray-700 dark:text-gray-200 font-medium">{selected.phases[selected.currentPhaseIndex].agent}</div>
                </div>
                <div>
                  <div className="text-gray-400">Model</div>
                  <div className="text-gray-700 dark:text-gray-200 font-mono text-[11px]">{selected.phases[selected.currentPhaseIndex].model}</div>
                </div>
                <div>
                  <div className="text-gray-400">Tools available</div>
                  <div className="text-gray-700 dark:text-gray-200">9 tools <button className="text-indigo-500 ml-1">view</button></div>
                </div>
              </div>
            </div>

            {/* provider runtime state (M2 mock) */}
            <div className="px-5 py-3 border-b border-gray-200 dark:border-gray-800">
              <div className="flex items-center justify-between mb-2">
                <div className="text-[10px] uppercase tracking-wider text-gray-400">Provider runtime state</div>
                <div className="text-[11px] text-gray-500">Live vs static catalog visibility</div>
              </div>
              <div className="space-y-2">
                {PROVIDER_STATES.map((p) => {
                  const statusTone =
                    p.status === 'connected'
                      ? 'text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 dark:text-emerald-300'
                      : p.status === 'degraded'
                      ? 'text-amber-700 bg-amber-50 dark:bg-amber-900/20 dark:text-amber-300'
                      : 'text-red-700 bg-red-50 dark:bg-red-900/20 dark:text-red-300'

                  return (
                    <div key={p.id} className="rounded-md border border-gray-200 dark:border-gray-800 p-2.5">
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-gray-800 dark:text-gray-200">{p.provider}</span>
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-500">{p.connection}</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${statusTone}`}>{p.status}</span>
                        </div>
                        <div className="flex items-center gap-1 text-[10px]">
                          <button className="px-1.5 py-0.5 rounded border border-gray-200 dark:border-gray-700 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">Reconnect</button>
                          <button className="px-1.5 py-0.5 rounded border border-gray-200 dark:border-gray-700 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">Refresh</button>
                          <button className="px-1.5 py-0.5 rounded border border-gray-200 dark:border-gray-700 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">Disconnect</button>
                        </div>
                      </div>

                      <div className="grid grid-cols-4 gap-2 text-[11px] text-gray-500 dark:text-gray-400">
                        <div>
                          <div className="text-gray-400">Selected model</div>
                          <div className="font-mono text-gray-700 dark:text-gray-300">{p.selectedModel}</div>
                        </div>
                        <div>
                          <div className="text-gray-400">Live models</div>
                          <div className="text-gray-700 dark:text-gray-300">{p.catalog.live}</div>
                        </div>
                        <div>
                          <div className="text-gray-400">Static-only</div>
                          <div className="text-gray-700 dark:text-gray-300">{p.catalog.staticOnly}</div>
                        </div>
                        <div>
                          <div className="text-gray-400">Catalog refresh</div>
                          <div className="text-gray-700 dark:text-gray-300">{p.catalog.refreshed}</div>
                        </div>
                      </div>

                      {p.note && <div className="mt-1.5 text-[10px] text-amber-700 dark:text-amber-300">{p.note}</div>}
                    </div>
                  )
                })}
              </div>
            </div>

            {/* timeline */}
            <div className="px-5 py-3">
              <div className="text-[10px] uppercase tracking-wider text-gray-400 mb-2">Live timeline</div>
              <ol className="space-y-1.5">
                {selected.events.map((e, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs">
                    <span className="text-gray-400 font-mono w-12 flex-shrink-0">{e.t}</span>
                    <EventIcon kind={e.kind} />
                    <span className={`${e.kind === 'error' ? 'text-amber-700 dark:text-amber-400' : 'text-gray-700 dark:text-gray-300'}`}>
                      <span className="font-medium">{e.text}</span>
                      {e.detail && <span className="text-gray-500 dark:text-gray-400"> — <span className="font-mono">{e.detail}</span></span>}
                    </span>
                  </li>
                ))}
                {selected.status === 'running' && (
                  <li className="flex items-start gap-2 text-xs pt-1">
                    <span className="text-gray-400 font-mono w-12 flex-shrink-0">now</span>
                    <span className="inline-block w-1.5 h-3 bg-emerald-500 animate-pulse" />
                    <span className="text-gray-500 italic">streaming…</span>
                  </li>
                )}
              </ol>
            </div>
          </div>
        </div>
      </aside>
    </div>
  )
}
