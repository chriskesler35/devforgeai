'use client'

// Dynamic rendering for workbench
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { API_BASE, AUTH_HEADERS } from '@/lib/config'
import { resolveEventType } from '@/lib/eventContract'
import { filterModelsByCatalogFeature } from '@/lib/modelCatalog'
import { renderMarkdown } from '@/lib/markdown'
import { RunPanel } from '@/components/RunPanel'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useParams, useRouter } from 'next/navigation'


// ─── Types ────────────────────────────────────────────────────────────────────
interface WBEvent {
  type: string
  payload: Record<string, any>
  ts: string
  canonical_type?: string
  canonical_state?: string | null
  canonical_severity?: string
  canonical_source?: string
  canonical_version?: string
}

function getEventType(evt: WBEvent): string {
  return resolveEventType(evt)
}

interface ModelOption {
  id: string
  model_id: string
  display_name?: string
  provider_name?: string
}

interface SessionPinState {
  session_id: string
  pinned_model_ref: string
  pinned_by?: string | null
  notes?: string | null
  updated_at?: string | null
}

interface FileEntry { path: string; status: 'created' | 'modified'; content?: string; diff?: string }

const EVENT_STYLE: Record<string, { icon: string; color: string; label: string }> = {
  agent_thought: { icon: '💭', color: 'text-purple-600 dark:text-purple-400',  label: 'Thinking'     },
  tool_call:     { icon: '🔧', color: 'text-blue-600 dark:text-blue-400',      label: 'Tool'         },
  file_created:  { icon: '📄', color: 'text-green-600 dark:text-green-400',    label: 'Created'      },
  file_modified: { icon: '✏️',  color: 'text-yellow-600 dark:text-yellow-400',  label: 'Modified'     },
  error:         { icon: '❌', color: 'text-red-600 dark:text-red-400',        label: 'Error'        },
  waiting:       { icon: '⏳', color: 'text-orange-500 dark:text-orange-400',  label: 'Waiting'      },
  user_message:  { icon: '💬', color: 'text-indigo-600 dark:text-indigo-400',  label: 'You'          },
  agent_reply:   { icon: '🤖', color: 'text-emerald-600 dark:text-emerald-400', label: 'Agent'       },
  info:          { icon: 'ℹ️',  color: 'text-gray-500 dark:text-gray-400',      label: 'Info'         },
  done:          { icon: '✅', color: 'text-green-600 dark:text-green-400',    label: 'Done'         },
  ping:          { icon: '·',  color: 'text-gray-300',                          label: ''             },
}

const AGENT_STATE_STYLE: Record<string, string> = {
  IDLE: 'bg-gray-100 text-gray-700 border-gray-200',
  THINKING: 'bg-indigo-100 text-indigo-700 border-indigo-200',
  WAITING_FOR_TOOL: 'bg-blue-100 text-blue-700 border-blue-200',
  YIELDED: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  ERROR: 'bg-red-100 text-red-700 border-red-200',
  PAUSED: 'bg-amber-100 text-amber-700 border-amber-200',
  KILLED: 'bg-gray-200 text-gray-700 border-gray-300',
  EXECUTING: 'bg-violet-100 text-violet-700 border-violet-200',
  AWAITING_APPROVAL: 'bg-orange-100 text-orange-700 border-orange-200',
  COMPLETED: 'bg-green-100 text-green-700 border-green-200',
  FAILED: 'bg-red-100 text-red-700 border-red-200',
  CANCELLED: 'bg-gray-100 text-gray-700 border-gray-200',
}

function getAgentStateFromEvent(evt: WBEvent): string {
  const explicit = String(evt.canonical_state || '').trim().toUpperCase()
  if (explicit) return explicit

  const type = getEventType(evt)
  if (type === 'agent_thought' || type === 'info' || type === 'phase_progress' || type === 'phase_thinking') return 'THINKING'
  if (type === 'tool_call' || type === 'command_running') return 'WAITING_FOR_TOOL'
  if (type === 'agent_reply' || type === 'done') return 'YIELDED'
  if (type === 'error' || type === 'phase_failed') return 'ERROR'
  if (type === 'waiting' || type === 'awaiting_approval' || type === 'command_awaiting_approval') return 'AWAITING_APPROVAL'
  return 'IDLE'
}

function uniqueNonEmpty(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map((v) => String(v || '').trim()).filter(Boolean)))
}

function diffPromptLines(previousText: string, currentText: string): { added: string[]; removed: string[] } {
  const previous = uniqueNonEmpty(previousText.split('\n'))
  const current = uniqueNonEmpty(currentText.split('\n'))
  const previousSet = new Set(previous)
  const currentSet = new Set(current)

  return {
    added: current.filter((line) => !previousSet.has(line)),
    removed: previous.filter((line) => !currentSet.has(line)),
  }
}

// ─── Event row ────────────────────────────────────────────────────────────────
function EventRow({ evt, index }: { evt: WBEvent; index: number }) {
  const [expanded, setExpanded] = useState(false)
  const type = getEventType(evt)
  const cfg = EVENT_STYLE[type] || EVENT_STYLE.info
  if (type === 'ping' || type === 'init') return null

  const hasDetail = evt.payload.content || evt.payload.diff || evt.payload.result || evt.payload.args

  const summary = (() => {
    const p = evt.payload
    switch (type) {
      case 'agent_thought': return p.thought
      case 'tool_call':     return `${p.tool}(${JSON.stringify(p.args || {}).slice(0, 60)}) → ${p.result || '...'}`
      case 'file_created':  return p.path
      case 'file_modified': return p.path
      case 'error':         return p.message || p.error
      case 'waiting':       return p.message || 'Waiting for human input...'
      case 'user_message':  return p.message
      case 'agent_reply':    return p.message
      case 'info':          return p.message
      case 'done':          return p.message
      default: return JSON.stringify(p).slice(0, 100)
    }
  })()

  return (
    <div className={`flex gap-3 py-2 px-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800/50 group transition-colors ${type === 'error' ? 'bg-red-50 dark:bg-red-900/10' : ''} ${type === 'waiting' ? 'bg-orange-50 dark:bg-orange-900/10 border border-orange-200 dark:border-orange-800' : ''}`}>
      <div className="flex-shrink-0 w-6 text-center mt-0.5 text-base">{cfg.icon}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          {cfg.label && <span className={`text-xs font-semibold uppercase tracking-wider ${cfg.color}`}>{cfg.label}</span>}
          <span className="text-sm text-gray-700 dark:text-gray-200 truncate flex-1">{summary}</span>
          <span className="text-xs text-gray-400 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
            {new Date(evt.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </span>
        </div>

        {hasDetail && (
          <button onClick={() => setExpanded(e => !e)}
            className="text-xs text-gray-400 hover:text-gray-600 mt-0.5">
            {expanded ? '▲ hide' : '▼ show details'}
          </button>
        )}

        {expanded && hasDetail && (
          <pre className="mt-2 text-xs bg-gray-900 text-green-400 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap max-h-48 overflow-y-auto">
            {evt.payload.diff || evt.payload.content || JSON.stringify(evt.payload, null, 2)}
          </pre>
        )}
      </div>
    </div>
  )
}

// ─── Agent Card ───────────────────────────────────────────────────────────────
const AGENT_AVATARS: Record<string, { icon: string; color: string }> = {
  coder:     { icon: '💻', color: 'from-blue-400 to-indigo-500' },
  researcher:{ icon: '🔍', color: 'from-purple-400 to-pink-500' },
  designer:  { icon: '🎨', color: 'from-pink-400 to-rose-500' },
  reviewer:  { icon: '👀', color: 'from-amber-400 to-orange-500' },
  planner:   { icon: '📋', color: 'from-emerald-400 to-teal-500' },
  executor:  { icon: '⚙️',  color: 'from-gray-400 to-slate-500' },
  writer:    { icon: '✍️',  color: 'from-violet-400 to-purple-500' },
}

function AgentCard({
  agentType, model, status, currentActivity, currentRole, turnCount, fileCount,
}: {
  agentType: string
  model: string
  status: string
  currentActivity: string | null
  currentRole: string | null
  turnCount: number
  fileCount: number
}) {
  const meta = AGENT_AVATARS[agentType] || AGENT_AVATARS.coder
  const statusLabel = status === 'running' ? 'Working…' : status === 'waiting' ? 'Idle — send another message or close' : status === 'completed' ? 'Done' : status === 'failed' ? 'Failed' : status === 'cancelled' ? 'Cancelled' : 'Connecting'
  const isWorking = status === 'running' || status === 'pending'

  return (
    <div className="flex items-center gap-3 px-4 py-3 bg-gradient-to-r from-white to-gray-50 dark:from-gray-900 dark:to-gray-800 border-b border-gray-200 dark:border-gray-700">
      {/* Avatar */}
      <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${meta.color} flex items-center justify-center text-2xl shadow-md flex-shrink-0 relative`}>
        {meta.icon}
        {isWorking && (
          <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-green-400 border-2 border-white dark:border-gray-900 animate-pulse" />
        )}
        {status === 'waiting' && (
          <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-orange-400 border-2 border-white dark:border-gray-900" />
        )}
      </div>

      {/* Details */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-gray-900 dark:text-white capitalize">{agentType} Agent</span>
          {currentRole && (
            <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-700">
              🎭 {currentRole}
            </span>
          )}
          <span className="text-xs text-gray-400">·</span>
          <span className="text-xs text-gray-500 font-mono truncate">{model}</span>
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className={`text-xs font-medium ${
            isWorking ? 'text-green-600 dark:text-green-400' :
            status === 'waiting' ? 'text-orange-600 dark:text-orange-400' :
            status === 'failed' || status === 'error' ? 'text-red-600 dark:text-red-400' :
            'text-gray-500'
          }`}>
            {statusLabel}
          </span>
          {currentActivity && isWorking && (
            <>
              <span className="text-xs text-gray-400">·</span>
              <span className="text-xs text-gray-600 dark:text-gray-300 truncate italic">{currentActivity}</span>
            </>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="flex items-center gap-3 flex-shrink-0">
        <div className="text-center">
          <div className="text-sm font-semibold text-gray-900 dark:text-white">{turnCount}</div>
          <div className="text-[10px] text-gray-400 uppercase tracking-wider">Turns</div>
        </div>
        <div className="w-px h-8 bg-gray-200 dark:bg-gray-700" />
        <div className="text-center">
          <div className="text-sm font-semibold text-gray-900 dark:text-white">{fileCount}</div>
          <div className="text-[10px] text-gray-400 uppercase tracking-wider">Files</div>
        </div>
      </div>
    </div>
  )
}


// ─── Conversation turn (groups events into a message bubble pair) ──────────────
interface Turn {
  userMessage: string
  userTime: string
  role: string | null           // role declared by agent for this turn
  agentActivities: string[]  // plain-text descriptions of what the agent did
  agentReply: string | null
  filesTouched: string[]
  turnStatus: 'running' | 'done' | 'error'
  error: string | null
}

function buildTurnsFromHistory(messages: Array<{role: string; content: string}>, initialTask: string | null): Turn[] {
  /**
   * Rebuild turns from the session.messages array (complete conversation history).
   * Used when events_log has been truncated by the rolling buffer. This provides
   * a simpler view (no agent_thought, no files_touched) but shows the full
   * conversation so the user can see what turn they left off on.
   */
  const turns: Turn[] = []
  let current: Turn | null = null

  for (const msg of messages) {
    if (msg.role === 'user' && !msg.content.startsWith('[system-note]')) {
      if (current) turns.push(current)
      current = {
        userMessage: msg.content.replace(/^.*?User request for this turn:\s*/s, '').trim() || msg.content,
        userTime: '',
        role: null,
        agentActivities: [],
        agentReply: null,
        filesTouched: [],
        turnStatus: 'done',
        error: null,
      }
    } else if (msg.role === 'assistant' && current) {
      // Extract role from ROLE: line
      const roleMatch = msg.content.match(/^\s*ROLE:\s*([A-Za-z][A-Za-z ]{0,30})/)
      if (roleMatch) current.role = roleMatch[1].trim()
      // Extract file paths from FILE: lines
      const fileMatches = Array.from(msg.content.matchAll(/^FILE:\s*(\S+)/gm))
      for (const fm of fileMatches) current.filesTouched.push(fm[1])
      // Strip ROLE: line + FILE: blocks for the reply summary
      let reply = msg.content
        .replace(/^\s*ROLE:\s*[A-Za-z][A-Za-z ]*\n/, '')
        .replace(/FILE:[^\n]*\n```[^\n]*\n[\s\S]*?```/g, '')
        .replace(/^\s*CMD:\s*.+$/gm, '')
        .trim()
      if (!reply && current.filesTouched.length > 0) {
        reply = `Wrote ${current.filesTouched.length} file(s): ${current.filesTouched.join(', ')}`
      }
      current.agentReply = reply || msg.content.slice(0, 300)
    }
  }
  if (current) turns.push(current)
  return turns
}

function buildTurns(events: WBEvent[], initialTask: string | null): Turn[] {
  const turns: Turn[] = []
  let current: Turn | null = null

  // Seed with the initial task as turn 1
  if (initialTask) {
    current = {
      userMessage: initialTask,
      userTime: '',
      role: null,
      agentActivities: [],
      agentReply: null,
      filesTouched: [],
      turnStatus: 'running',
      error: null,
    }
  }

  for (const evt of events) {
    const type = getEventType(evt)
    const p = evt.payload || {}
    if (type === 'user_message') {
      // Close out current turn (if any) and start a new one
      if (current) turns.push(current)
      current = {
        userMessage: p.message || '',
        userTime: evt.ts,
        role: null,
        agentActivities: [],
        agentReply: null,
        filesTouched: [],
        turnStatus: 'running',
        error: null,
      }
    } else if (type === 'role_change') {
      if (current) current.role = p.role || null
    } else if (type === 'agent_thought') {
      if (current) current.agentActivities.push(p.thought || '')
    } else if (type === 'info') {
      if (current) current.agentActivities.push(p.message || '')
    } else if (type === 'file_created') {
      if (current) current.filesTouched.push(p.path || '')
    } else if (type === 'file_modified') {
      if (current) current.filesTouched.push(p.path || '')
    } else if (type === 'agent_reply') {
      if (current) current.agentReply = p.message || ''
    } else if (type === 'done') {
      if (current) {
        current.turnStatus = p.status === 'waiting' || p.status === 'completed' ? 'done' : 'error'
        if (!current.agentReply) current.agentReply = p.message || ''
      }
    } else if (type === 'error') {
      if (current) {
        current.turnStatus = 'error'
        current.error = p.message || p.error || 'Error'
      }
    }
  }
  if (current) turns.push(current)
  return turns
}


function TurnBubble({ turn, isLast, isActive }: { turn: Turn; isLast: boolean; isActive: boolean }) {
  const working = isLast && isActive && turn.turnStatus === 'running'

  return (
    <div className="space-y-3">
      {/* User message (right-aligned) */}
      {turn.userMessage && (
        <div className="flex justify-end">
          <div className="max-w-[80%] rounded-2xl rounded-tr-sm bg-orange-500 text-white px-4 py-2.5 text-sm whitespace-pre-wrap break-words shadow-sm">
            {turn.userMessage}
          </div>
        </div>
      )}

      {/* Agent response (left-aligned) */}
      <div className="flex justify-start">
        <div className="max-w-[85%] rounded-2xl rounded-tl-sm bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
          {/* Role badge — shows which role the agent took for this turn */}
          {turn.role && (
            <div className="px-4 pt-3 flex items-center gap-2">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider bg-gradient-to-r from-indigo-100 to-purple-100 dark:from-indigo-900/30 dark:to-purple-900/30 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-700">
                🎭 {turn.role}
              </span>
            </div>
          )}
          {/* Activity list — collapsed once turn is done */}
          {turn.agentActivities.length > 0 && (
            <div className={`px-4 py-3 space-y-1.5 border-b border-gray-100 dark:border-gray-700 ${working ? '' : 'bg-gray-50 dark:bg-gray-900/50'}`}>
              {turn.agentActivities.slice(-4).map((a, i) => (
                <div key={i} className="flex items-start gap-2 text-xs text-gray-600 dark:text-gray-400">
                  <span className="text-gray-400 mt-0.5">{working && i === turn.agentActivities.slice(-4).length - 1 ? '⏳' : '✓'}</span>
                  <span className="flex-1">{a}</span>
                </div>
              ))}
              {turn.agentActivities.length > 4 && (
                <div className="text-[10px] text-gray-400 italic">({turn.agentActivities.length - 4} earlier steps)</div>
              )}
            </div>
          )}

          {/* Agent final reply (rendered as markdown) */}
          {turn.agentReply ? (
            <div
              className="px-4 py-3 text-sm text-gray-900 dark:text-gray-100 break-words leading-relaxed prose-sm"
              dangerouslySetInnerHTML={{ __html: `<p class="mb-2">${renderMarkdown(turn.agentReply)}</p>` }}
            />
          ) : working ? (
            <div className="px-4 py-3 flex items-center gap-2 text-sm text-gray-500">
              <div className="flex gap-1">
                <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
              <span className="text-xs italic">Working on it…</span>
            </div>
          ) : null}

          {/* Files touched this turn */}
          {turn.filesTouched.length > 0 && (
            <div className="px-4 py-2.5 bg-gray-50 dark:bg-gray-900/50 border-t border-gray-100 dark:border-gray-700">
              <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                {turn.filesTouched.length} file{turn.filesTouched.length === 1 ? '' : 's'} touched
              </div>
              <div className="flex flex-wrap gap-1.5">
                {turn.filesTouched.map((f, i) => (
                  <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 text-[11px] font-mono text-gray-700 dark:text-gray-300">
                    📄 {f}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Error */}
          {turn.error && (
            <div className="px-4 py-2.5 bg-red-50 dark:bg-red-900/20 border-t border-red-200 dark:border-red-800 text-xs text-red-700 dark:text-red-300">
              ❌ {turn.error}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}


// ─── File tree ────────────────────────────────────────────────────────────────
function FileTree({ files, onSelect, selected }: { files: FileEntry[]; onSelect: (f: FileEntry) => void; selected: string | null }) {
  if (files.length === 0) return (
    <div className="text-center py-8 text-xs text-gray-400">No files yet</div>
  )
  return (
    <div className="space-y-0.5">
      {files.map(f => (
        <button key={f.path} onClick={() => onSelect(f)}
          className={`w-full flex items-center gap-2 px-3 py-2 text-left rounded-lg text-sm transition-colors ${
            selected === f.path
              ? 'bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-300'
              : 'hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300'
          }`}>
          <span className={f.status === 'created' ? 'text-green-500' : 'text-yellow-500'}>
            {f.status === 'created' ? '+ ' : '~ '}
          </span>
          <span className="font-mono truncate">{f.path}</span>
          <span className={`ml-auto text-xs px-1.5 py-0.5 rounded ${
            f.status === 'created' ? 'bg-green-100 text-green-600' : 'bg-yellow-100 text-yellow-600'
          }`}>{f.status}</span>
        </button>
      ))}
    </div>
  )
}

// ─── Main workbench page ──────────────────────────────────────────────────────
export default function WorkbenchSessionPage() {
  const { id } = useParams() as { id: string }
  const router = useRouter()

  const [session, setSession] = useState<any>(null)
  const [models, setModels] = useState<ModelOption[]>([])
  const [loadingModels, setLoadingModels] = useState(false)
  const [modelDraft, setModelDraft] = useState('')
  const [updatingModel, setUpdatingModel] = useState(false)
  const [modelUpdateNote, setModelUpdateNote] = useState('')
  const [sessionPin, setSessionPin] = useState<SessionPinState | null>(null)
  const [pinningModel, setPinningModel] = useState(false)
  const [pinNote, setPinNote] = useState('')
  const [events, setEvents] = useState<WBEvent[]>([])
  const [files, setFiles] = useState<FileEntry[]>([])
  const [selectedFile, setSelectedFile] = useState<FileEntry | null>(null)
  const [status, setStatus] = useState<string>('connecting')
  const [intervention, setIntervention] = useState('')
  const [sending, setSending] = useState(false)
  const [waitingForHuman, setWaitingForHuman] = useState(false)
  const [autoScroll, setAutoScroll] = useState(true)
  const [showRunPanel, setShowRunPanel] = useState(false)
  // Command approval queue (pending Tier 3 commands)
  const [pendingCommands, setPendingCommands] = useState<Array<{id: string; command: string; tier: string; tier_label?: string}>>([])
  const [completedCommands, setCompletedCommands] = useState<Array<{id: string; command: string; exit_code: number; status: string; stdout?: string; stderr?: string; tier?: string}>>([])
  const [bypassMode, setBypassMode] = useState<boolean>(false)
  const [showBypassWarning, setShowBypassWarning] = useState(false)
  const [showCommandLog, setShowCommandLog] = useState(false)
  const [rightPanelTab, setRightPanelTab] = useState<'files' | 'agent'>('files')
  const [selectedMonitorEvent, setSelectedMonitorEvent] = useState<number | null>(null)
  const [monitorView, setMonitorView] = useState<'timeline' | 'transcript' | 'prompt'>('timeline')
  const [monitorSearch, setMonitorSearch] = useState('')
  const [monitorStateFilter, setMonitorStateFilter] = useState('all')
  const [monitorTypeFilter, setMonitorTypeFilter] = useState('all')
  const [selectedPromptTurnIndex, setSelectedPromptTurnIndex] = useState<number | null>(null)

  const streamRef = useRef<EventSource | null>(null)
  const streamEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let cancelled = false
    const loadModels = async () => {
      setLoadingModels(true)
      try {
        const res = await fetch(
          `${API_BASE}/v1/models?active_only=true&usable_only=true&validated_only=true&chat_only=true&limit=250`,
          { headers: AUTH_HEADERS },
        )
        const payload = await res.json().catch(() => ({ data: [] }))
        if (cancelled) return
        const raw = Array.isArray(payload?.data) ? payload.data : []
        setModels(filterModelsByCatalogFeature(raw, 'function_calling', 'tools'))
      } finally {
        if (!cancelled) setLoadingModels(false)
      }
    }
    loadModels()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    let cancelled = false
    const loadSessionPin = async () => {
      try {
        const res = await fetch(`${API_BASE}/v1/models/pin-session/${id}`, { headers: AUTH_HEADERS })
        const payload = await res.json().catch(() => ({}))
        if (cancelled) return
        setSessionPin(payload?.pin || null)
      } catch {
        if (!cancelled) setSessionPin(null)
      }
    }
    loadSessionPin()
    return () => {
      cancelled = true
    }
  }, [id])

  // Auto-scroll stream
  useEffect(() => {
    if (autoScroll) streamEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [events, autoScroll])

  // SSE stream
  useEffect(() => {
    const es = new EventSource(`${API_BASE}/v1/workbench/sessions/${id}/stream`)
    streamRef.current = es

    es.onmessage = (e) => {
      try {
        const evt: WBEvent = JSON.parse(e.data)
        const type = getEventType(evt)

        if (type === 'init') {
          setSession(evt.payload)
          setModelDraft(String(evt.payload?.model || ''))
          setStatus(evt.payload.status || evt.canonical_state || 'running')
          setBypassMode(!!evt.payload.bypass_approvals)
          // Clear local event state — the stream will replay events_log from DB.
          // Without this, page refreshes / reconnects cause events to pile up
          // (old local events + replayed events = duplicate turns).
          setEvents([])
          setFiles([])
          setPendingCommands([])
          setCompletedCommands([])
          return
        }

        if (type === 'ping') return

        setEvents(prev => [...prev, evt])

        if (type === 'file_created') {
          setFiles(prev => {
            const existingIdx = prev.findIndex(f => f.path === evt.payload.path)
            const entry = { path: evt.payload.path, status: 'created' as const, content: evt.payload.content }
            if (existingIdx >= 0) {
              // File touched again on a later turn — update its preview
              const next = [...prev]
              next[existingIdx] = entry
              return next
            }
            return [...prev, entry]
          })
          // If the user is currently viewing this file, refresh its preview
          setSelectedFile(current => {
            if (current && current.path === evt.payload.path) {
              return { ...current, content: evt.payload.content }
            }
            return current
          })
        }
        if (type === 'file_modified') {
          setFiles(prev => prev.map(f =>
            f.path === evt.payload.path ? { ...f, status: 'modified' as const, diff: evt.payload.diff } : f
          ).concat(prev.find(f => f.path === evt.payload.path) ? [] : [{ path: evt.payload.path, status: 'modified' as const, diff: evt.payload.diff }])
          )
        }
        if (type === 'waiting') {
          setWaitingForHuman(true)
          setStatus('waiting')
          inputRef.current?.focus()
        }
        if (type === 'done') {
          const newStatus = evt.payload.status || evt.canonical_state || 'completed'
          setStatus(newStatus)
          // 'waiting' means turn finished but session stays open for follow-ups.
          // Keep the SSE stream alive so the next turn's events flow in.
          if (newStatus === 'waiting') {
            setWaitingForHuman(true)
            inputRef.current?.focus()
          } else {
            setWaitingForHuman(false)
            es.close()
          }
        }
        if (type === 'error') {
          setStatus(evt.canonical_state || 'error')
        }
        if (type === 'model_changed') {
          const nextModel = String(evt.payload?.model || '')
          setSession((prev: any) => prev ? { ...prev, model: nextModel } : prev)
          setModelDraft(nextModel)
        }

        // Command execution events
        if (type === 'command_awaiting_approval') {
          const p = evt.payload
          setPendingCommands(prev => [...prev, { id: p.command_id, command: p.command, tier: p.tier, tier_label: p.tier_label }])
        }
        if (type === 'command_approved' || type === 'command_rejected') {
          setPendingCommands(prev => prev.filter(c => c.id !== evt.payload.command_id))
        }
        if (type === 'command_completed') {
          const p = evt.payload
          setPendingCommands(prev => prev.filter(c => c.id !== p.command_id))
          setCompletedCommands(prev => [...prev, {
            id: p.command_id, command: p.command, exit_code: p.exit_code,
            status: p.status, stdout: p.stdout, stderr: p.stderr, tier: p.tier,
          }])
        }
        if (type === 'bypass_mode_changed') {
          setBypassMode(!!evt.payload.bypass_approvals)
        }
      } catch { /* ignore malformed */ }
    }

    es.onerror = () => {
      // EventSource auto-reconnects on error (browser spec). For sessions that
      // are done/waiting/failed, the server's replay-only stream ends immediately,
      // which triggers onerror → reconnect → replay → onerror → infinite loop.
      // Break the loop: if we're not actively running, close the EventSource.
      setStatus(prev => {
        if (prev === 'running' || prev === 'connecting') {
          return 'disconnected'
        }
        // Session is idle/completed/failed — stop reconnecting
        es.close()
        return prev
      })
    }

    return () => es.close()
  }, [id])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const deepLinkEvent = Number(params.get('ae'))
    const panel = params.get('panel')
    const monitorViewParam = params.get('av')

    if (panel === 'agent' || panel === 'files') {
      setRightPanelTab(panel)
    }
    if (monitorViewParam === 'timeline' || monitorViewParam === 'transcript' || monitorViewParam === 'prompt') {
      setMonitorView(monitorViewParam)
    }
    if (Number.isInteger(deepLinkEvent) && deepLinkEvent >= 0) {
      setSelectedMonitorEvent(deepLinkEvent)
    }
  }, [id])

  const applyModelChange = useCallback(async () => {
    const nextModel = modelDraft.trim()
    if (!nextModel || !session) return
    if ((session.model || '') === nextModel) return

    setUpdatingModel(true)
    setModelUpdateNote('')
    try {
      const res = await fetch(`${API_BASE}/v1/workbench/sessions/${id}/model`, {
        method: 'POST',
        headers: AUTH_HEADERS,
        body: JSON.stringify({ model: nextModel }),
      })
      const payload = await res.json().catch(() => ({}))
      if (!res.ok) {
        const detail = payload?.detail || `HTTP ${res.status}`
        throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail))
      }
      const updated = payload?.session
      if (updated?.model) {
        setSession((prev: any) => ({ ...(prev || {}), ...updated }))
        setModelDraft(updated.model)
      }
      const appliesTo = payload?.applies_to === 'next_turn' ? 'Applies on next turn.' : 'Active now.'
      setModelUpdateNote(`Model updated. ${appliesTo}`)
    } catch (e: any) {
      setModelUpdateNote(`Model update failed: ${e?.message || 'unknown error'}`)
    } finally {
      setUpdatingModel(false)
    }
  }, [id, modelDraft, session])

  const pinModelForSession = useCallback(async () => {
    const targetRef = modelDraft.trim()
    if (!targetRef) return

    const modelRow = models.find((m) => `${m.provider_name || 'unknown'}/${m.model_id}` === targetRef)
    if (!modelRow?.id) {
      setPinNote('Pin failed: selected model is not in validated catalog list.')
      return
    }

    setPinningModel(true)
    setPinNote('')
    try {
      const res = await fetch(`${API_BASE}/v1/models/${modelRow.id}/pin-session/${id}`, {
        method: 'POST',
        headers: AUTH_HEADERS,
        body: JSON.stringify({ pinned_by: 'workbench-ui', notes: 'Pinned from Workbench session controls' }),
      })
      const payload = await res.json().catch(() => ({}))
      if (!res.ok) {
        const detail = payload?.detail || `HTTP ${res.status}`
        throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail))
      }
      setSessionPin(payload)
      setPinNote('Session model pin applied.')
    } catch (e: any) {
      setPinNote(`Pin failed: ${e?.message || 'unknown error'}`)
    } finally {
      setPinningModel(false)
    }
  }, [id, modelDraft, models])

  const unpinModelForSession = useCallback(async () => {
    setPinningModel(true)
    setPinNote('')
    try {
      const res = await fetch(`${API_BASE}/v1/models/pin-session/${id}`, {
        method: 'DELETE',
        headers: AUTH_HEADERS,
      })
      const payload = await res.json().catch(() => ({}))
      if (!res.ok) {
        const detail = payload?.detail || `HTTP ${res.status}`
        throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail))
      }
      setSessionPin(null)
      setPinNote('Session model pin removed.')
    } catch (e: any) {
      setPinNote(`Unpin failed: ${e?.message || 'unknown error'}`)
    } finally {
      setPinningModel(false)
    }
  }, [id])

  const sendIntervention = useCallback(async () => {
    if (!intervention.trim() || sending) return
    setSending(true)
    const msg = intervention.trim()
    const res = await fetch(`${API_BASE}/v1/workbench/sessions/${id}/message`, {
      method: 'POST', headers: AUTH_HEADERS,
      body: JSON.stringify({ message: msg })
    })
    if (res.ok) {
      // Backend pushes a `user_message` event through SSE, so DON'T add it
      // locally here or we get a duplicate. Just flip state + clear input.
      setStatus('running')
      setWaitingForHuman(false)
      setIntervention('')
    }
    setSending(false)
  }, [id, intervention, sending])

  const cancelSession = async () => {
    if (!confirm('Cancel this session?')) return
    await fetch(`${API_BASE}/v1/workbench/sessions/${id}/cancel`, { method: 'POST', headers: AUTH_HEADERS })
    setStatus('cancelled')
  }
  const completeSession = async () => {
    try {
      const res = await fetch(`${API_BASE}/v1/workbench/sessions/${id}/complete`, { method: 'POST', headers: AUTH_HEADERS })
      if (!res.ok) {
        const body = await res.text()
        throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`)
      }
      setStatus('completed')
    } catch (e: any) {
      alert(`Failed to mark session complete: ${e.message}\n\nIf this says "Not Found", restart the backend so it picks up the new endpoint.`)
    }
  }

  const approveCommand = async (commandId: string) => {
    try {
      const res = await fetch(`${API_BASE}/v1/workbench/sessions/${id}/commands/${commandId}/approve`, { method: 'POST', headers: AUTH_HEADERS })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setPendingCommands(prev => prev.filter(c => c.id !== commandId))
    } catch (e: any) {
      alert(`Failed to approve: ${e.message}`)
    }
  }
  const rejectCommand = async (commandId: string, feedback?: string) => {
    try {
      const res = await fetch(`${API_BASE}/v1/workbench/sessions/${id}/commands/${commandId}/reject`, {
        method: 'POST', headers: AUTH_HEADERS,
        body: JSON.stringify({ feedback: feedback || null }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setPendingCommands(prev => prev.filter(c => c.id !== commandId))
    } catch (e: any) {
      alert(`Failed to reject: ${e.message}`)
    }
  }
  const setBypassModeRemote = async (enable: boolean) => {
    try {
      const res = await fetch(`${API_BASE}/v1/workbench/sessions/${id}/bypass`, {
        method: 'POST', headers: AUTH_HEADERS,
        body: JSON.stringify({ bypass_approvals: enable }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setBypassMode(enable)
    } catch (e: any) {
      alert(`Failed to toggle bypass: ${e.message}`)
    }
  }

  // Click file in the tree → fetch full content from disk (SSE payload is truncated)
  const selectFile = useCallback(async (f: FileEntry) => {
    // Show immediately with preview, then replace with full content
    setSelectedFile(f)
    if (f.diff) return  // diff view doesn't need a file read
    try {
      const url = `${API_BASE}/v1/workbench/sessions/${id}/files/read?path=${encodeURIComponent(f.path)}`
      const res = await fetch(url, { headers: AUTH_HEADERS })
      if (!res.ok) return  // keep truncated preview
      const data = await res.json()
      setSelectedFile({ ...f, content: data.content })
    } catch { /* silent — keep truncated preview */ }
  }, [id])

  const STATUS_BADGE: Record<string, string> = {
    connecting:   'bg-gray-100 text-gray-600',
    pending:      'bg-yellow-100 text-yellow-700',
    running:      'bg-blue-100 text-blue-700',
    waiting:      'bg-orange-100 text-orange-700',
    completed:    'bg-green-100 text-green-700',
    cancelled:    'bg-gray-100 text-gray-500',
    error:        'bg-red-100 text-red-700',
    disconnected: 'bg-red-100 text-red-600',
  }

  const isActive = status === 'running' || status === 'pending' || status === 'waiting'

  const agentTimeline = useMemo(() => {
    return events
      .map((evt, eventIndex) => ({ evt, eventIndex }))
      .filter(({ evt }) => {
        const t = getEventType(evt)
        return t !== 'ping' && t !== 'init'
      })
      .map(({ evt, eventIndex }) => {
        const eventType = getEventType(evt)
        const state = getAgentStateFromEvent(evt)
        const summary = evt.payload?.message || evt.payload?.thought || evt.payload?.error || evt.payload?.path || eventType
        return {
          evt,
          eventIndex,
          eventType,
          state,
          summary: String(summary || eventType),
        }
      })
  }, [events])

  const monitorStates = useMemo(() => {
    return Array.from(new Set(agentTimeline.map((item) => item.state))).sort()
  }, [agentTimeline])

  const monitorEventTypes = useMemo(() => {
    return Array.from(new Set(agentTimeline.map((item) => item.eventType))).sort()
  }, [agentTimeline])

  const filteredAgentTimeline = useMemo(() => {
    const needle = monitorSearch.trim().toLowerCase()
    return agentTimeline.filter((item) => {
      if (monitorStateFilter !== 'all' && item.state !== monitorStateFilter) {
        return false
      }
      if (monitorTypeFilter !== 'all' && item.eventType !== monitorTypeFilter) {
        return false
      }
      if (!needle) return true

      const payload = JSON.stringify(item.evt.payload || {}).toLowerCase()
      const summary = item.summary.toLowerCase()
      const eventType = item.eventType.toLowerCase()
      const state = item.state.toLowerCase()
      return summary.includes(needle) || payload.includes(needle) || eventType.includes(needle) || state.includes(needle)
    })
  }, [agentTimeline, monitorSearch, monitorStateFilter, monitorTypeFilter])

  const mergedTurns = useMemo(() => {
    const eventTurns = buildTurns(events, session?.task || null)
    const historyTurns = session?.messages ? buildTurnsFromHistory(session.messages, session?.task || null) : []
    const eventTurnCount = eventTurns.length
    const historyOnly = historyTurns.slice(0, Math.max(0, historyTurns.length - eventTurnCount))
    return [...historyOnly, ...eventTurns]
  }, [events, session?.messages, session?.task])

  const transcriptRows = useMemo(() => {
    return mergedTurns
      .map((turn, index) => {
        const agentText = turn.agentReply || turn.agentActivities.join(' | ') || turn.error || '(no agent reply yet)'
        return {
          index,
          userText: turn.userMessage || '(empty user turn)',
          agentText,
          role: turn.role || 'agent',
          status: turn.turnStatus,
          filesTouched: turn.filesTouched,
        }
      })
      .filter((row) => {
        const needle = monitorSearch.trim().toLowerCase()
        if (!needle) return true
        return (
          row.userText.toLowerCase().includes(needle) ||
          row.agentText.toLowerCase().includes(needle) ||
          row.role.toLowerCase().includes(needle) ||
          row.status.toLowerCase().includes(needle) ||
          row.filesTouched.join(' ').toLowerCase().includes(needle)
        )
      })
  }, [mergedTurns, monitorSearch])

  const promptInspectorTurns = useMemo(() => {
    return mergedTurns.map((turn, index) => {
      const previous = index > 0 ? mergedTurns[index - 1] : null
      const contextInjected = uniqueNonEmpty([
        session?.project_id ? `Project ID: ${session.project_id}` : null,
        session?.project_path ? `Project path: ${session.project_path}` : null,
        session?.model ? `Model: ${session.model}` : null,
        turn.role ? `Agent role: ${turn.role}` : null,
        turn.filesTouched.length > 0 ? `Files touched this turn: ${turn.filesTouched.join(', ')}` : null,
        previous?.agentReply ? `Previous agent output: ${previous.agentReply.slice(0, 220)}` : null,
      ])

      const systemPrompt = session?.task || 'No explicit system prompt persisted for this session.'
      const userPrompt = turn.userMessage || '(empty user turn)'
      const rawPrompt = [
        'SYSTEM PROMPT',
        systemPrompt,
        '',
        'CONTEXT INJECTED',
        ...(contextInjected.length > 0 ? contextInjected.map((line) => `- ${line}`) : ['- (none captured)']),
        '',
        'USER REQUEST FOR THIS TURN',
        userPrompt,
      ].join('\n')

      return {
        index,
        role: turn.role || 'agent',
        systemPrompt,
        userPrompt,
        contextInjected,
        rawPrompt,
      }
    })
  }, [mergedTurns, session?.model, session?.project_id, session?.project_path, session?.task])

  const selectedPromptTurn = selectedPromptTurnIndex != null
    ? promptInspectorTurns[selectedPromptTurnIndex] || null
    : promptInspectorTurns[promptInspectorTurns.length - 1] || null

  const selectedPromptDiff = useMemo(() => {
    if (!selectedPromptTurn) {
      return { added: [] as string[], removed: [] as string[] }
    }
    if (selectedPromptTurn.index <= 0) {
      return { added: uniqueNonEmpty(selectedPromptTurn.rawPrompt.split('\n')), removed: [] }
    }
    const previous = promptInspectorTurns[selectedPromptTurn.index - 1]
    if (!previous) {
      return { added: uniqueNonEmpty(selectedPromptTurn.rawPrompt.split('\n')), removed: [] }
    }
    return diffPromptLines(previous.rawPrompt, selectedPromptTurn.rawPrompt)
  }, [promptInspectorTurns, selectedPromptTurn])

  const currentAgentState = useMemo(() => {
    if (agentTimeline.length === 0) {
      if (status === 'running') return 'EXECUTING'
      if (status === 'waiting') return 'AWAITING_APPROVAL'
      if (status === 'completed') return 'COMPLETED'
      if (status === 'failed' || status === 'error') return 'FAILED'
      if (status === 'cancelled') return 'CANCELLED'
      return 'IDLE'
    }
    return agentTimeline[agentTimeline.length - 1].state
  }, [agentTimeline, status])

  const selectedAgentEvent = selectedMonitorEvent != null
    ? agentTimeline.find((item) => item.eventIndex === selectedMonitorEvent)?.evt || null
    : null

  useEffect(() => {
    if (selectedMonitorEvent == null) return
    const exists = agentTimeline.some((item) => item.eventIndex === selectedMonitorEvent)
    if (!exists) {
      setSelectedMonitorEvent(null)
    }
  }, [agentTimeline, selectedMonitorEvent])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const url = new URL(window.location.href)
    if (rightPanelTab === 'agent') {
      url.searchParams.set('panel', 'agent')
    } else {
      url.searchParams.delete('panel')
    }
    if (selectedMonitorEvent != null) {
      url.searchParams.set('ae', String(selectedMonitorEvent))
    } else {
      url.searchParams.delete('ae')
    }
    if (rightPanelTab === 'agent') {
      url.searchParams.set('av', monitorView)
    } else {
      url.searchParams.delete('av')
    }
    window.history.replaceState({}, '', url.toString())
  }, [rightPanelTab, selectedMonitorEvent, monitorView])

  useEffect(() => {
    if (promptInspectorTurns.length === 0) {
      setSelectedPromptTurnIndex(null)
      return
    }
    if (selectedPromptTurnIndex == null) return
    if (selectedPromptTurnIndex < 0 || selectedPromptTurnIndex >= promptInspectorTurns.length) {
      setSelectedPromptTurnIndex(promptInspectorTurns.length - 1)
    }
  }, [promptInspectorTurns, selectedPromptTurnIndex])

  const downloadTextFile = useCallback((filename: string, content: string, mimeType: string) => {
    if (typeof window === 'undefined') return
    const blob = new Blob([content], { type: mimeType })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }, [])

  const exportMonitorJson = useCallback(() => {
    const payload = {
      session_id: id,
      status,
      exported_at: new Date().toISOString(),
      timeline_events: filteredAgentTimeline.map((item) => item.evt),
      transcript: transcriptRows,
    }
    downloadTextFile(
      `workbench-${id}-monitor.json`,
      `${JSON.stringify(payload, null, 2)}\n`,
      'application/json;charset=utf-8',
    )
  }, [downloadTextFile, filteredAgentTimeline, id, status, transcriptRows])

  const exportMonitorMarkdown = useCallback(() => {
    const lines: string[] = [
      '# Workbench Agent Transcript',
      '',
      `- Session: ${id}`,
      `- Status: ${status}`,
      `- Exported: ${new Date().toISOString()}`,
      '',
      '## Transcript',
      '',
    ]

    if (transcriptRows.length === 0) {
      lines.push('_No transcript rows match current filters._', '')
    } else {
      transcriptRows.forEach((row) => {
        lines.push(`### Turn ${row.index + 1}`)
        lines.push(`- Role: ${row.role}`)
        lines.push(`- Status: ${row.status}`)
        if (row.filesTouched.length > 0) {
          lines.push(`- Files: ${row.filesTouched.join(', ')}`)
        }
        lines.push('')
        lines.push('**User**')
        lines.push('')
        lines.push(row.userText)
        lines.push('')
        lines.push('**Agent**')
        lines.push('')
        lines.push(row.agentText)
        lines.push('')
      })
    }

    lines.push('## Timeline (Filtered)', '')
    if (filteredAgentTimeline.length === 0) {
      lines.push('_No timeline events match current filters._', '')
    } else {
      filteredAgentTimeline.forEach((item) => {
        lines.push(`- ${item.evt.ts} | ${item.state} | ${item.eventType} | ${item.summary}`)
      })
      lines.push('')
    }

    downloadTextFile(
      `workbench-${id}-monitor.md`,
      `${lines.join('\n')}\n`,
      'text/markdown;charset=utf-8',
    )
  }, [downloadTextFile, filteredAgentTimeline, id, status, transcriptRows])

  return (
    <div className="flex flex-col h-full -m-6 lg:-m-10">

      {/* Top bar */}
      <div className="flex items-center gap-3 px-6 py-3 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
        <button onClick={() => router.push('/workbench')}
          className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 transition-colors flex-shrink-0">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        <div className="flex-1 min-w-0">
          <p className="text-xs text-gray-400 uppercase tracking-wider">Session</p>
          <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">
            {session?.task || 'Loading…'}
          </p>
          <div className="mt-1 flex items-center gap-2 max-w-full">
            {loadingModels ? (
              <span className="text-xs text-gray-500">Loading models…</span>
            ) : models.length > 0 ? (
              <select
                value={modelDraft}
                onChange={(e) => setModelDraft(e.target.value)}
                className="max-w-[340px] rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs px-2 py-1 text-gray-700 dark:text-gray-200"
                title="Change session model"
              >
                {Object.entries(
                  models.reduce((acc, m) => {
                    const provider = m.provider_name || 'other'
                    if (!acc[provider]) acc[provider] = []
                    acc[provider].push(m)
                    return acc
                  }, {} as Record<string, ModelOption[]>),
                ).map(([provider, providerModels]) => (
                  <optgroup key={provider} label={provider}>
                    {providerModels.map((m) => (
                      <option key={m.id} value={`${m.provider_name || 'unknown'}/${m.model_id}`}>
                        {m.display_name || m.model_id}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            ) : (
              <input
                value={modelDraft}
                onChange={(e) => setModelDraft(e.target.value)}
                placeholder="provider/model"
                className="max-w-[340px] rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs px-2 py-1 text-gray-700 dark:text-gray-200"
              />
            )}
            <button
              onClick={applyModelChange}
              disabled={updatingModel || !modelDraft.trim() || modelDraft.trim() === String(session?.model || '').trim()}
              className="px-2 py-1 text-xs rounded border border-indigo-300 text-indigo-700 hover:bg-indigo-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {updatingModel ? 'Applying…' : 'Apply Model'}
            </button>
            <button
              onClick={pinModelForSession}
              disabled={pinningModel || !modelDraft.trim()}
              className="px-2 py-1 text-xs rounded border border-emerald-300 text-emerald-700 hover:bg-emerald-50 disabled:opacity-50 disabled:cursor-not-allowed"
              title="Pin this model for the current session"
            >
              {pinningModel ? 'Pinning…' : 'Pin Model'}
            </button>
            <button
              onClick={unpinModelForSession}
              disabled={pinningModel || !sessionPin}
              className="px-2 py-1 text-xs rounded border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              title="Remove session-level model pin"
            >
              Unpin
            </button>
            {status === 'running' && (
              <span className="text-[10px] text-amber-600">Takes effect next turn while running</span>
            )}
          </div>
          {modelUpdateNote && (
            <p className="mt-1 text-[10px] text-gray-500">{modelUpdateNote}</p>
          )}
          {sessionPin?.pinned_model_ref && (
            <p className="mt-1 text-[10px] text-emerald-700">Pinned for this session: {sessionPin.pinned_model_ref}</p>
          )}
          {pinNote && (
            <p className="mt-1 text-[10px] text-gray-500">{pinNote}</p>
          )}
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <button onClick={() => setAutoScroll(a => !a)}
            className={`px-2.5 py-1 text-xs rounded-lg border transition-colors ${autoScroll ? 'bg-green-50 border-green-200 text-green-700' : 'border-gray-200 text-gray-500'}`}>
            {autoScroll ? '↓ Auto' : '↓ Manual'}
          </button>
          {isActive && status !== 'waiting' && (
            <button onClick={cancelSession}
              className="px-3 py-1.5 text-xs font-medium rounded-lg border border-red-200 text-red-600 hover:bg-red-50 transition-colors">
              Cancel
            </button>
          )}
          {status === 'waiting' && (
            <button onClick={completeSession}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-green-600 hover:bg-green-700 text-white transition-colors"
              title="Mark session as complete — closes it out, no more follow-ups">
              ✓ Mark complete
            </button>
          )}
        </div>
      </div>

      {/* Main 3-panel layout */}
      <div className="flex-1 flex min-h-0 overflow-hidden">

        {/* LEFT: File tree */}
        <div className="w-56 flex-shrink-0 border-r border-gray-200 dark:border-gray-700 flex flex-col bg-gray-50 dark:bg-gray-900">
          <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-700">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Files ({files.length})</p>
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            <FileTree files={files} selected={selectedFile?.path || null} onSelect={selectFile} />
          </div>
        </div>

        {/* CENTER: Conversation timeline */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0">
          {/* Agent Card header */}
          <AgentCard
            agentType={session?.agent_type || 'coder'}
            model={session?.model || 'unknown'}
            status={status}
            currentActivity={(() => {
              // Latest agent_thought or info from the current turn
              for (let i = events.length - 1; i >= 0; i--) {
                const e = events[i]
                const type = getEventType(e)
                if (type === 'user_message') break
                if (type === 'agent_thought') return e.payload.thought
                if (type === 'info') return e.payload.message
              }
              return null
            })()}
            currentRole={(() => {
              // Most recent role_change event (since last user_message)
              for (let i = events.length - 1; i >= 0; i--) {
                const e = events[i]
                const type = getEventType(e)
                if (type === 'user_message') break
                if (type === 'role_change') return e.payload.role
              }
              return null
            })()}
            turnCount={events.filter(e => getEventType(e) === 'user_message').length + (session?.task ? 1 : 0)}
            fileCount={files.length}
          />

          {/* Conversation turns */}
          <div className="flex-1 overflow-y-auto px-4 py-6 space-y-6">
            {(() => {
              // Build turns from live events. If events_log was truncated (rolling
              // buffer), also pull older turns from session.messages (complete history).
              if (mergedTurns.length === 0) {
                return (
                  <div className="flex items-center justify-center h-full">
                    <div className="text-center text-gray-400">
                      <div className="text-3xl mb-2">⚡</div>
                      <p className="text-sm">Connecting to agent…</p>
                    </div>
                  </div>
                )
              }
              return mergedTurns.map((turn, i) => (
                <TurnBubble
                  key={i}
                  turn={turn}
                  isLast={i === mergedTurns.length - 1}
                  isActive={isActive}
                />
              ))
            })()}
            <div ref={streamEndRef} />
          </div>

          {/* Pending command approval queue (Tier 3) */}
          {pendingCommands.length > 0 && (
            <div className="flex-shrink-0 border-t-2 border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 px-4 py-3 space-y-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-amber-900 dark:text-amber-200">
                <span className="text-base">⚠️</span>
                <span>{pendingCommands.length} command{pendingCommands.length > 1 ? 's' : ''} waiting for your approval</span>
              </div>
              {pendingCommands.map(cmd => (
                <div key={cmd.id} className="bg-white dark:bg-gray-900 rounded-lg border border-amber-200 dark:border-amber-800 p-2">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <code className="text-xs font-mono text-gray-900 dark:text-white break-all">$ {cmd.command}</code>
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300 font-semibold uppercase flex-shrink-0">{cmd.tier}</span>
                  </div>
                  {cmd.tier_label && (
                    <div className="text-[10px] text-amber-700 dark:text-amber-400 mb-2">{cmd.tier_label}</div>
                  )}
                  <div className="flex gap-1.5">
                    <button onClick={() => approveCommand(cmd.id)}
                      className="px-2.5 py-1 text-xs font-semibold rounded bg-green-600 hover:bg-green-700 text-white">
                      ✓ Approve & run
                    </button>
                    <button onClick={() => {
                      const reason = prompt('Why reject this command? (optional)') || ''
                      rejectCommand(cmd.id, reason)
                    }}
                      className="px-2.5 py-1 text-xs font-semibold rounded bg-red-500 hover:bg-red-600 text-white">
                      ✗ Reject
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Bypass mode + command log toggles */}
          <div className="flex-shrink-0 border-t border-gray-200 dark:border-gray-700 px-4 py-1.5 bg-gray-50 dark:bg-gray-800/30 flex items-center justify-between text-[11px] gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <button onClick={() => setShowCommandLog(s => !s)}
                className="text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200">
                {showCommandLog ? '▼' : '▶'} Command log ({completedCommands.length})
              </button>
              {bypassMode && (
                <span className="px-1.5 py-0.5 rounded bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300 font-semibold uppercase text-[9px]">
                  🚨 Bypass mode
                </span>
              )}
            </div>
            <button
              onClick={() => {
                if (bypassMode) {
                  setBypassModeRemote(false)
                } else {
                  setShowBypassWarning(true)
                }
              }}
              className={`text-[11px] font-medium ${bypassMode ? 'text-red-600 dark:text-red-400' : 'text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'}`}
            >
              {bypassMode ? 'Disable bypass' : 'Enable bypass (skip approvals)'}
            </button>
          </div>

          {/* Command log panel */}
          {showCommandLog && completedCommands.length > 0 && (
            <div className="flex-shrink-0 border-t border-gray-200 dark:border-gray-700 max-h-48 overflow-y-auto bg-gray-900 text-gray-200 font-mono text-[10px] p-2 space-y-1">
              {completedCommands.map(c => (
                <details key={c.id} className="border-l-2 pl-2" style={{borderColor: c.exit_code === 0 ? '#22c55e' : '#ef4444'}}>
                  <summary className="cursor-pointer flex items-center gap-2">
                    <span className={c.exit_code === 0 ? 'text-green-400' : 'text-red-400'}>
                      [{c.exit_code === 0 ? '✓' : '✗'} {c.exit_code}]
                    </span>
                    <span className="text-gray-100 truncate">{c.command}</span>
                  </summary>
                  {c.stdout && <pre className="mt-1 text-gray-300 whitespace-pre-wrap max-h-40 overflow-auto">{c.stdout}</pre>}
                  {c.stderr && <pre className="mt-1 text-red-300 whitespace-pre-wrap max-h-40 overflow-auto">{c.stderr}</pre>}
                </details>
              ))}
            </div>
          )}

          {/* Run panel (collapsible) */}
          {session?.project_id && (
            <div className="flex-shrink-0 border-t border-gray-200 dark:border-gray-700">
              <button
                onClick={() => setShowRunPanel(s => !s)}
                className="w-full flex items-center justify-between px-4 py-2 bg-gray-50 dark:bg-gray-800/50 hover:bg-gray-100 dark:hover:bg-gray-800 text-xs font-semibold text-gray-600 dark:text-gray-400 transition-colors"
              >
                <span className="flex items-center gap-2">
                  <span>{showRunPanel ? '▼' : '▶'}</span>
                  Run & Test
                </span>
                <span className="text-[10px] text-gray-400">Click to {showRunPanel ? 'hide' : 'show'}</span>
              </button>
              {showRunPanel && (
                <div className="h-64 border-t border-gray-200 dark:border-gray-700">
                  <RunPanel projectId={session.project_id} compact />
                </div>
              )}
            </div>
          )}

          {/* Intervention bar */}
          <div className={`flex-shrink-0 border-t transition-colors ${
            waitingForHuman
              ? 'border-orange-300 dark:border-orange-600 bg-orange-50 dark:bg-orange-900/10'
              : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900'
          } px-4 py-3`}>
            {waitingForHuman && (
              <div className="flex items-center gap-2 mb-2 text-xs font-medium text-orange-600 dark:text-orange-400">
                <span className="w-2 h-2 rounded-full bg-orange-400 animate-pulse" />
                Agent is waiting for your input
              </div>
            )}
            <div className="flex gap-2">
              <input
                ref={inputRef}
                value={intervention}
                onChange={e => setIntervention(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && sendIntervention()}
                placeholder={waitingForHuman ? 'Type your response to the agent...' : 'Send a message to the agent (e.g. "use port 3001", "skip that step")...'}
                disabled={!isActive && !waitingForHuman}
                className={`flex-1 rounded-xl border px-3.5 py-2 text-sm focus:outline-none focus:ring-2 disabled:opacity-40 dark:bg-gray-800 dark:text-white ${
                  waitingForHuman
                    ? 'border-orange-300 focus:ring-orange-400 dark:border-orange-600'
                    : 'border-gray-200 dark:border-gray-700 focus:ring-gray-400'
                }`}
              />
              <button
                onClick={sendIntervention}
                disabled={!intervention.trim() || sending || (!isActive && !waitingForHuman)}
                className={`px-4 py-2 text-sm font-medium rounded-xl text-white transition-colors disabled:opacity-40 ${
                  waitingForHuman
                    ? 'bg-orange-500 hover:bg-orange-600'
                    : 'bg-gray-700 hover:bg-gray-800'
                }`}
              >
                {sending ? '...' : 'Send'}
              </button>
            </div>
            <p className="text-xs text-gray-400 mt-1.5">
              {isActive ? 'Agent will receive your message on its next iteration.' : 'Session ended — no new messages can be sent.'}
            </p>
          </div>
        </div>

        {/* RIGHT: File preview + agent monitor */}
        <div className="w-80 flex-shrink-0 border-l border-gray-200 dark:border-gray-700 flex flex-col bg-white dark:bg-gray-900">
          <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-700 space-y-2">
            <div className="grid grid-cols-2 gap-1 rounded-lg bg-gray-100 dark:bg-gray-800 p-1">
              <button
                onClick={() => setRightPanelTab('files')}
                className={`px-2 py-1 text-xs font-medium rounded transition-colors ${
                  rightPanelTab === 'files'
                    ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                }`}
              >
                File Preview
              </button>
              <button
                onClick={() => setRightPanelTab('agent')}
                className={`px-2 py-1 text-xs font-medium rounded transition-colors ${
                  rightPanelTab === 'agent'
                    ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                }`}
              >
                Agent Monitor
              </button>
            </div>

            {rightPanelTab === 'files' ? (
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider truncate">
                  {selectedFile ? selectedFile.path : 'File Preview'}
                </p>
                {selectedFile && (
                  <button onClick={() => setSelectedFile(null)} className="text-gray-400 hover:text-gray-600 text-xs ml-2">✕</button>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Agent State</p>
                  <span className={`px-2 py-0.5 rounded-full border text-[10px] font-semibold ${AGENT_STATE_STYLE[currentAgentState] || AGENT_STATE_STYLE.IDLE}`}>
                    {currentAgentState}
                  </span>
                </div>
                <div className="text-[10px] text-gray-500 dark:text-gray-400">
                  {session?.agent_type || 'agent'} · {session?.model || 'unknown model'}
                </div>
              </div>
            )}
          </div>
          <div className="flex-1 overflow-auto p-3">
            {rightPanelTab === 'files' ? (
              !selectedFile ? (
                <div className="flex items-center justify-center h-full text-center">
                  <div className="text-gray-400">
                    <div className="text-3xl mb-2">📄</div>
                    <p className="text-xs">Click a file in the tree to preview it</p>
                  </div>
                </div>
              ) : (
                <pre className="text-xs font-mono text-gray-700 dark:text-gray-300 whitespace-pre-wrap break-all">
                  {selectedFile.diff
                    ? selectedFile.diff.split('\n').map((line, i) => (
                        <span key={i} className={`block ${line.startsWith('+') ? 'text-green-600 bg-green-50 dark:bg-green-900/20' : line.startsWith('-') ? 'text-red-600 bg-red-50 dark:bg-red-900/20' : ''}`}>
                          {line}
                        </span>
                      ))
                    : selectedFile.content || '(empty)'}
                </pre>
              )
            ) : (
              <div className="space-y-3">
                <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 p-2">
                  <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Agent Detail</div>
                  <div className="text-xs text-gray-700 dark:text-gray-300 space-y-1">
                    <div>Session: <span className="font-mono">{id}</span></div>
                    <div>Status: <span className="font-semibold">{status}</span></div>
                    <div>Turns: <span className="font-semibold">{mergedTurns.length}</span></div>
                    <div>Events: <span className="font-semibold">{agentTimeline.length}</span></div>
                  </div>
                </div>

                <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-2 space-y-2">
                  <div className="grid grid-cols-3 gap-1 rounded-lg bg-gray-100 dark:bg-gray-800 p-1">
                    <button
                      onClick={() => setMonitorView('timeline')}
                      className={`px-2 py-1 text-xs font-medium rounded transition-colors ${
                        monitorView === 'timeline'
                          ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm'
                          : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                      }`}
                    >
                      Timeline
                    </button>
                    <button
                      onClick={() => setMonitorView('transcript')}
                      className={`px-2 py-1 text-xs font-medium rounded transition-colors ${
                        monitorView === 'transcript'
                          ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm'
                          : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                      }`}
                    >
                      Transcript
                    </button>
                    <button
                      onClick={() => setMonitorView('prompt')}
                      className={`px-2 py-1 text-xs font-medium rounded transition-colors ${
                        monitorView === 'prompt'
                          ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm'
                          : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                      }`}
                    >
                      Prompt Inspector
                    </button>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={exportMonitorJson}
                      className="flex-1 px-2 py-1 text-[10px] rounded border border-indigo-300 text-indigo-700 hover:bg-indigo-50"
                    >
                      Export JSON
                    </button>
                    <button
                      onClick={exportMonitorMarkdown}
                      className="flex-1 px-2 py-1 text-[10px] rounded border border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                    >
                      Export Markdown
                    </button>
                  </div>
                </div>

                {monitorView === 'timeline' ? (
                <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
                  <div className="px-2 py-1.5 bg-gray-50 dark:bg-gray-800/50 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                    Lifecycle Timeline
                  </div>
                  <div className="p-2 space-y-1.5 border-y border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900">
                    <input
                      value={monitorSearch}
                      onChange={(e) => setMonitorSearch(e.target.value)}
                      placeholder="Search event text, payload, or type"
                      className="w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs px-2 py-1 text-gray-700 dark:text-gray-200"
                    />
                    <div className="grid grid-cols-2 gap-1.5">
                      <select
                        value={monitorStateFilter}
                        onChange={(e) => setMonitorStateFilter(e.target.value)}
                        className="rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs px-2 py-1 text-gray-700 dark:text-gray-200"
                      >
                        <option value="all">All states</option>
                        {monitorStates.map((state) => (
                          <option key={state} value={state}>{state}</option>
                        ))}
                      </select>
                      <select
                        value={monitorTypeFilter}
                        onChange={(e) => setMonitorTypeFilter(e.target.value)}
                        className="rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs px-2 py-1 text-gray-700 dark:text-gray-200"
                      >
                        <option value="all">All types</option>
                        {monitorEventTypes.map((eventType) => (
                          <option key={eventType} value={eventType}>{eventType}</option>
                        ))}
                      </select>
                    </div>
                    {(monitorSearch || monitorStateFilter !== 'all' || monitorTypeFilter !== 'all') && (
                      <button
                        onClick={() => {
                          setMonitorSearch('')
                          setMonitorStateFilter('all')
                          setMonitorTypeFilter('all')
                        }}
                        className="text-[10px] text-indigo-600 hover:text-indigo-700"
                      >
                        Clear filters
                      </button>
                    )}
                  </div>
                  <div className="max-h-64 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-800">
                    {filteredAgentTimeline.length === 0 ? (
                      <div className="px-2 py-3 text-xs text-gray-400">
                        {agentTimeline.length === 0 ? 'No lifecycle events yet.' : 'No events match current filters.'}
                      </div>
                    ) : (
                      filteredAgentTimeline.slice(-80).map((item, idx) => {
                        const selected = selectedMonitorEvent === item.eventIndex
                        return (
                          <button
                            key={`${item.evt.ts}-${idx}`}
                            onClick={() => {
                              setRightPanelTab('agent')
                              setSelectedMonitorEvent(item.eventIndex)
                            }}
                            className={`w-full text-left px-2 py-2 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors ${selected ? 'bg-indigo-50 dark:bg-indigo-900/20' : ''}`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[10px] font-mono text-gray-500">{new Date(item.evt.ts).toLocaleTimeString()}</span>
                              <span className={`px-1.5 py-0.5 rounded border text-[9px] font-semibold ${AGENT_STATE_STYLE[item.state] || AGENT_STATE_STYLE.IDLE}`}>
                                {item.state}
                              </span>
                            </div>
                            <div className="mt-1 text-[11px] text-gray-800 dark:text-gray-200 truncate">{item.summary}</div>
                            <div className="text-[10px] text-gray-400">{item.eventType}</div>
                          </button>
                        )
                      })
                    )}
                  </div>
                </div>
                ) : monitorView === 'transcript' ? (
                  <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
                    <div className="px-2 py-1.5 bg-gray-50 dark:bg-gray-800/50 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                      Transcript
                    </div>
                    <div className="p-2 border-y border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900">
                      <input
                        value={monitorSearch}
                        onChange={(e) => setMonitorSearch(e.target.value)}
                        placeholder="Search turns by user text, agent text, files, role"
                        className="w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs px-2 py-1 text-gray-700 dark:text-gray-200"
                      />
                    </div>
                    <div className="max-h-80 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-800">
                      {transcriptRows.length === 0 ? (
                        <div className="px-2 py-3 text-xs text-gray-400">No transcript rows match current filters.</div>
                      ) : (
                        transcriptRows.map((row) => (
                          <div key={row.index} className="px-2 py-2 space-y-1.5">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Turn {row.index + 1}</span>
                              <span className={`px-1.5 py-0.5 rounded border text-[9px] font-semibold ${row.status === 'error' ? AGENT_STATE_STYLE.ERROR : AGENT_STATE_STYLE.YIELDED}`}>
                                {row.status}
                              </span>
                            </div>
                            <div className="text-[10px] text-indigo-700 dark:text-indigo-300">Role: {row.role}</div>
                            <div className="text-[11px] text-gray-700 dark:text-gray-200 whitespace-pre-wrap">{row.userText}</div>
                            <div className="text-[11px] text-gray-600 dark:text-gray-300 whitespace-pre-wrap border-l-2 border-gray-200 dark:border-gray-700 pl-2">{row.agentText}</div>
                            {row.filesTouched.length > 0 && (
                              <div className="text-[10px] text-gray-500">Files: {row.filesTouched.join(', ')}</div>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}

                {selectedAgentEvent && (
                  <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
                    <div className="px-2 py-1.5 bg-gray-50 dark:bg-gray-800/50 flex items-center justify-between">
                      <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Event Payload</span>
                      <button
                        onClick={() => setSelectedMonitorEvent(null)}
                        className="text-[10px] text-gray-500 hover:text-gray-700"
                      >
                        Clear
                      </button>
                    </div>
                    <pre className="p-2 text-[11px] font-mono whitespace-pre-wrap break-all text-gray-700 dark:text-gray-300 max-h-56 overflow-auto">
                      {JSON.stringify(selectedAgentEvent, null, 2)}
                    </pre>
                  </div>
                ) : (
                  <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
                    <div className="px-2 py-1.5 bg-gray-50 dark:bg-gray-800/50 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                      Prompt Inspector
                    </div>
                    {promptInspectorTurns.length === 0 || !selectedPromptTurn ? (
                      <div className="px-2 py-3 text-xs text-gray-400">No turns available yet for prompt inspection.</div>
                    ) : (
                      <>
                        <div className="p-2 border-y border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 space-y-2">
                          <div className="grid grid-cols-[1fr_auto] gap-1.5 items-center">
                            <select
                              value={selectedPromptTurn.index}
                              onChange={(e) => setSelectedPromptTurnIndex(Number(e.target.value))}
                              className="rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs px-2 py-1 text-gray-700 dark:text-gray-200"
                            >
                              {promptInspectorTurns.map((turn) => (
                                <option key={turn.index} value={turn.index}>
                                  Turn {turn.index + 1} · {turn.role}
                                </option>
                              ))}
                            </select>
                            <button
                              onClick={async () => {
                                try {
                                  await navigator.clipboard.writeText(selectedPromptTurn.rawPrompt)
                                } catch {
                                  // Clipboard access can fail on restricted contexts.
                                }
                              }}
                              className="px-2 py-1 text-[10px] rounded border border-indigo-300 text-indigo-700 hover:bg-indigo-50"
                            >
                              Copy Raw
                            </button>
                          </div>
                          <div className="text-[10px] text-gray-500">
                            Turn {selectedPromptTurn.index + 1} · role {selectedPromptTurn.role}
                          </div>
                        </div>
                        <div className="max-h-96 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-800">
                          <div className="p-2 space-y-1.5">
                            <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">System Prompt</div>
                            <pre className="text-[11px] whitespace-pre-wrap break-all text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-800/50 rounded p-2">{selectedPromptTurn.systemPrompt}</pre>
                          </div>
                          <div className="p-2 space-y-1.5">
                            <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Context Injected</div>
                            {selectedPromptTurn.contextInjected.length === 0 ? (
                              <div className="text-[11px] text-gray-400">No context metadata captured for this turn.</div>
                            ) : (
                              <ul className="space-y-1 text-[11px] text-gray-700 dark:text-gray-300">
                                {selectedPromptTurn.contextInjected.map((line, idx) => (
                                  <li key={`${line}-${idx}`} className="bg-gray-50 dark:bg-gray-800/50 rounded px-2 py-1">{line}</li>
                                ))}
                              </ul>
                            )}
                          </div>
                          <div className="p-2 space-y-1.5">
                            <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Prompt Diff vs Previous Turn</div>
                            <div className="grid grid-cols-2 gap-1.5">
                              <div className="rounded border border-green-200 bg-green-50 p-1.5">
                                <div className="text-[10px] font-semibold text-green-700 mb-1">Added ({selectedPromptDiff.added.length})</div>
                                <div className="max-h-28 overflow-auto space-y-1">
                                  {selectedPromptDiff.added.length === 0 ? (
                                    <div className="text-[10px] text-green-700/70">None</div>
                                  ) : (
                                    selectedPromptDiff.added.slice(0, 40).map((line, idx) => (
                                      <div key={`added-${idx}`} className="text-[10px] text-green-800">+ {line}</div>
                                    ))
                                  )}
                                </div>
                              </div>
                              <div className="rounded border border-red-200 bg-red-50 p-1.5">
                                <div className="text-[10px] font-semibold text-red-700 mb-1">Removed ({selectedPromptDiff.removed.length})</div>
                                <div className="max-h-28 overflow-auto space-y-1">
                                  {selectedPromptDiff.removed.length === 0 ? (
                                    <div className="text-[10px] text-red-700/70">None</div>
                                  ) : (
                                    selectedPromptDiff.removed.slice(0, 40).map((line, idx) => (
                                      <div key={`removed-${idx}`} className="text-[10px] text-red-800">- {line}</div>
                                    ))
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                          <div className="p-2 space-y-1.5">
                            <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Raw Prompt</div>
                            <pre className="text-[11px] whitespace-pre-wrap break-all text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-800/50 rounded p-2">{selectedPromptTurn.rawPrompt}</pre>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Bypass warning modal */}
      {showBypassWarning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
             onClick={() => setShowBypassWarning(false)}>
          <div className="w-full max-w-md bg-white dark:bg-gray-900 rounded-2xl shadow-2xl overflow-hidden border-2 border-red-500"
               onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20">
              <h2 className="text-base font-bold text-red-900 dark:text-red-100 flex items-center gap-2">
                🚨 Enable Bypass Mode?
              </h2>
            </div>
            <div className="px-6 py-4 space-y-3 text-sm">
              <p className="text-gray-900 dark:text-white font-semibold">You are about to disable all command approval gates for this session.</p>
              <p className="text-gray-700 dark:text-gray-300">
                With bypass ON, the agent can execute <b>any</b> command without asking you — including:
              </p>
              <ul className="list-disc list-inside text-xs text-gray-700 dark:text-gray-300 space-y-0.5 ml-2">
                <li><code className="text-red-600 dark:text-red-400">git push</code>, <code className="text-red-600 dark:text-red-400">git push --force</code></li>
                <li><code className="text-red-600 dark:text-red-400">rm -rf</code>, <code className="text-red-600 dark:text-red-400">sudo</code></li>
                <li><code className="text-red-600 dark:text-red-400">docker rm</code>, <code className="text-red-600 dark:text-red-400">curl -X POST</code> to external APIs</li>
                <li>Anything else it decides to run</li>
              </ul>
              <p className="text-red-700 dark:text-red-400 font-semibold text-xs">
                ⚠ Use at your own risk. This can destroy files, push broken code, or leak data. Only enable if you fully trust the agent and model you're using.
              </p>
            </div>
            <div className="px-6 py-3 border-t border-gray-200 dark:border-gray-800 flex gap-2 justify-end">
              <button onClick={() => setShowBypassWarning(false)}
                className="px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800">
                Cancel
              </button>
              <button onClick={async () => { await setBypassModeRemote(true); setShowBypassWarning(false) }}
                className="px-4 py-2 text-sm font-bold rounded-lg bg-red-600 hover:bg-red-700 text-white">
                I understand — enable bypass
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
