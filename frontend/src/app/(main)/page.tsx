'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { GpuStatusWidget } from '@/components/ModelFitnessCheck'
import { api } from '@/lib/api'
import { API_BASE, AUTH_HEADERS } from '@/lib/config'

interface HealthResponse {
  status: string
  database?: string
  redis?: string
}

interface BackendMethod {
  id: string
  name: string
  description?: string
  is_custom: boolean
  phases?: string[]
}

interface IdentityStatus {
  first_run: boolean
  ai_name?: string
}

interface Persona {
  id: string
  name: string
  description?: string
  is_default: boolean
  memory_enabled: boolean
  max_memory_messages: number
}

interface Model {
  id: string
  model_id: string
  display_name?: string
  provider_name?: string
  is_active: boolean
  context_window?: number
  cost_per_1m_input: number
  cost_per_1m_output: number
}

interface Conversation {
  id: string
  title?: string
  message_count?: number
  last_message_at?: string
}

interface StartCard {
  title: string
  description: string
  href: string
  badge: string
  icon: string
}

interface MethodCard {
  id: string
  title: string
  description: string
  duration: string
  requiredContext: string
  roadmap: string[]
  href: string
  icon: string
  group: 'installed' | 'marketplace'
}

const START_CARDS: StartCard[] = [
  {
    title: 'Chat',
    description: 'Jump straight into a conversation with no project/session setup overhead.',
    href: '/chat',
    badge: 'Immediate',
    icon: 'Chat',
  },
  {
    title: 'Pick a Method',
    description: 'Choose GSD, BMAD, gtrack, custom stacks, or discovery-led execution.',
    href: '/methods',
    badge: 'Methods-First',
    icon: 'Method',
  },
  {
    title: 'Use Template',
    description: 'Start from workflow templates and launch a structured run quickly.',
    href: '/workbench/builder',
    badge: 'Accelerated',
    icon: 'Template',
  },
]

const METHOD_CARDS: MethodCard[] = [
  {
    id: 'chat',
    title: 'Chat',
    description: 'Linear conversation loop for fast ideation and direct model interaction.',
    duration: '1-20 min',
    requiredContext: 'Prompt only',
    roadmap: ['Ask question', 'Get response', 'Iterate in-thread'],
    href: '/chat',
    icon: 'C',
    group: 'installed',
  },
  {
    id: 'gsd',
    title: 'GSD',
    description: 'Roadmap-driven phased execution with checkpoints and delivery momentum.',
    duration: '30 min-4 hours',
    requiredContext: 'Goal + codebase',
    roadmap: ['Context gather', 'Roadmap build', 'Phase execution', 'Verification'],
    href: '/gsd',
    icon: 'G',
    group: 'installed',
  },
  {
    id: 'bmad',
    title: 'BMAD',
    description: 'Discovery to planning to handoff with structured artifact generation.',
    duration: '45 min-1 day',
    requiredContext: 'Product direction + constraints',
    roadmap: ['Discovery', 'Ideation', 'Planning', 'Handoff', 'Development'],
    href: '/bmad',
    icon: 'B',
    group: 'installed',
  },
  {
    id: 'gtrack',
    title: 'gtrack',
    description: 'Issue-to-agent orchestration for project-backed execution workflows.',
    duration: '30 min-3 hours',
    requiredContext: 'Issue backlog + repository',
    roadmap: ['Import issues', 'Map agents', 'Execute', 'Review output'],
    href: '/gtrack',
    icon: 'T',
    group: 'installed',
  },
  {
    id: 'custom',
    title: 'Custom Stack',
    description: 'Compose your own multi-method chain with compatibility guidance.',
    duration: '20 min-2 hours',
    requiredContext: 'Methods to chain + expected outcomes',
    roadmap: ['Select methods', 'Reorder stack', 'Validate conflicts', 'Launch'],
    href: '/methods',
    icon: 'S',
    group: 'installed',
  },
  {
    id: 'marketplace',
    title: 'Marketplace Methods',
    description: 'Discover community and verified methods, then install and launch.',
    duration: '10 min-2 hours',
    requiredContext: 'Use case + trust level preference',
    roadmap: ['Browse categories', 'Preview method', 'Install', 'Launch in workflow'],
    href: '/marketplace',
    icon: 'M',
    group: 'marketplace',
  },
]

function StatCard({ label, value, sub, href }: { label: string; value: string | number; sub?: string; href?: string }) {
  const inner = (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden group hover:shadow-md hover:border-orange-300 dark:hover:border-orange-500 transition-all">
      <div className="px-5 py-5">
        <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{label}</p>
        <p className="mt-2 text-3xl font-bold text-gray-900 dark:text-white">{value}</p>
      </div>
      {sub && (
        <div className="px-5 py-3 bg-gray-50 dark:bg-gray-700/50 border-t border-gray-100 dark:border-gray-700">
          <p className="text-xs font-medium text-orange-600 dark:text-orange-400 group-hover:underline">{sub}</p>
        </div>
      )}
    </div>
  )
  return href ? <Link href={href}>{inner}</Link> : <div>{inner}</div>
}

function StartAction({ href, badge, icon, title, description }: StartCard) {
  const cls = 'rounded-2xl border border-orange-200 dark:border-orange-800 bg-white dark:bg-gray-800 p-5 shadow-sm hover:shadow-md hover:border-orange-400 dark:hover:border-orange-600 transition-all'
  const content = (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-1 rounded bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300">
          {badge}
        </span>
        <span className="text-[10px] text-gray-500 dark:text-gray-400 uppercase tracking-wider">{icon}</span>
      </div>
      <div>
        <p className="text-lg font-semibold text-gray-900 dark:text-white">{title}</p>
        <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">{description}</p>
      </div>
      <p className="text-xs font-medium text-orange-600 dark:text-orange-400">Open</p>
    </div>
  )
  return <Link href={href} className={cls}>{content}</Link>
}

function MethodTile({ method }: { method: MethodCard }) {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 text-xs font-semibold flex items-center justify-center">
              {method.icon}
            </span>
            <p className="text-sm font-semibold text-gray-900 dark:text-white">{method.title}</p>
          </div>
          <p className="text-xs text-gray-600 dark:text-gray-300 mt-1">{method.description}</p>
        </div>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
        <div className="rounded border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 px-2 py-1">
          <div className="text-gray-500">Duration</div>
          <div className="font-medium text-gray-700 dark:text-gray-200">{method.duration}</div>
        </div>
        <div className="rounded border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 px-2 py-1">
          <div className="text-gray-500">Required Context</div>
          <div className="font-medium text-gray-700 dark:text-gray-200">{method.requiredContext}</div>
        </div>
      </div>
      <details className="mt-2 rounded border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 px-2 py-1.5">
        <summary className="text-[11px] font-semibold text-gray-700 dark:text-gray-200 cursor-pointer">Sample Roadmap</summary>
        <ul className="mt-1 space-y-1 text-[11px] text-gray-600 dark:text-gray-300">
          {method.roadmap.map((step) => (
            <li key={step}>- {step}</li>
          ))}
        </ul>
      </details>
      <Link href={method.href} className="mt-3 inline-flex text-xs font-medium text-orange-600 dark:text-orange-400 hover:underline">
        Use This Method
      </Link>
    </div>
  )
}

export default function Home() {
  const [personas, setPersonas] = useState<Persona[]>([])
  const [models, setModels] = useState<Model[]>([])
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [loading, setLoading] = useState(true)
  const [methodSearch, setMethodSearch] = useState('')
  // `null` while in-flight; `{status:'unreachable'}` if /v1/health fetch fails.
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [customMethods, setCustomMethods] = useState<BackendMethod[]>([])
  // When identity files are missing/empty, surface a one-click path into the
  // wizard. Previously users had to discover that onboarding only fires on
  // the Chat page; now home tells them.
  const [identity, setIdentity] = useState<IdentityStatus | null>(null)

  useEffect(() => {
    async function fetchData() {
      // Run main data fetch and health probe in parallel; degraded health
      // shouldn't block stats from rendering.
      const dataPromise = Promise.all([
        api.getPersonas(),
        api.getModels(),
        api.getConversations(),
      ])
      const healthPromise: Promise<HealthResponse> = fetch(`${API_BASE}/v1/health`, {
        signal: AbortSignal.timeout(3000),
      })
        .then((r) => (r.ok ? r.json() : { status: 'unreachable' }))
        .catch(() => ({ status: 'unreachable' }))
      // Custom methods aren't hardcoded in METHOD_CARDS; pull them so they
      // surface in the Available section alongside built-ins.
      const methodsPromise: Promise<BackendMethod[]> = fetch(`${API_BASE}/v1/methods/`, {
        headers: AUTH_HEADERS,
        signal: AbortSignal.timeout(3000),
      })
        .then((r) => (r.ok ? r.json() : { data: [] }))
        .then((j) => (j?.data || []).filter((m: BackendMethod) => m.is_custom))
        .catch(() => [])
      const identityPromise: Promise<IdentityStatus | null> = fetch(`${API_BASE}/v1/identity/status`, {
        headers: AUTH_HEADERS,
        signal: AbortSignal.timeout(3000),
      })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null)

      try {
        const [[personasRes, modelsRes, conversationsRes], healthRes, customRes, identityRes] = await Promise.all([
          dataPromise,
          healthPromise,
          methodsPromise,
          identityPromise,
        ])
        setPersonas(personasRes.data)
        setModels(modelsRes.data)
        setConversations(conversationsRes.data)
        setHealth(healthRes)
        setCustomMethods(customRes)
        setIdentity(identityRes)
      } catch (e) {
        console.error('Failed to fetch data:', e)
        setHealth({ status: 'unreachable' })
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [])

  // Translate the /v1/health payload into a stat-card label + subtitle pair.
  function healthBadge(): { value: string; sub: string } {
    if (!health) return { value: 'Checking…', sub: 'Probing backend' }
    if (health.status === 'healthy') return { value: 'Healthy', sub: 'All systems operational' }
    if (health.status === 'unreachable') return { value: 'Offline', sub: 'Backend not reachable' }
    const parts: string[] = []
    if (health.database === 'unhealthy') parts.push('DB down')
    if (health.redis === 'unhealthy') parts.push('Redis down')
    return { value: 'Degraded', sub: parts.join(' · ') || 'Subsystem degraded' }
  }
  const healthInfo = healthBadge()

  const activeModels = models.filter(m => m.is_active)
  const normalizedSearch = methodSearch.trim().toLowerCase()

  // Built-in methods are always available (shipped with the app). Custom
  // methods are fetched live from /v1/methods/.
  const customAsCards: MethodCard[] = customMethods.map((m) => ({
    id: m.id,
    title: m.name,
    description: m.description || 'Custom method',
    duration: 'Varies',
    requiredContext: 'Per method',
    roadmap: m.phases && m.phases.length > 0 ? m.phases : ['Custom phase chain'],
    href: `/methods?focus=${encodeURIComponent(m.id)}`,
    icon: (m.name || '?').charAt(0).toUpperCase(),
    group: 'installed',
  }))

  const allMethods = [...METHOD_CARDS, ...customAsCards]
  const filteredMethods = allMethods.filter((m) =>
    !normalizedSearch ||
    m.title.toLowerCase().includes(normalizedSearch) ||
    m.description.toLowerCase().includes(normalizedSearch)
  )
  const installedMethods = filteredMethods.filter((m) => m.group === 'installed')
  const marketplaceMethods = filteredMethods.filter((m) => m.group === 'marketplace')

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="flex gap-1.5">
          {[0,1,2].map(i => (
            <div key={i} className="w-2 h-2 bg-orange-400 rounded-full animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-8">

      {/* First-run banner — only visible when identity files haven't been set.
          Clicking the button takes the user into chat, where the OnboardingOverlay
          fires automatically based on the same identity/status check. */}
      {identity?.first_run && (
        <div className="rounded-2xl border border-orange-300 dark:border-orange-700 bg-orange-50 dark:bg-orange-900/20 px-5 py-4">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-orange-900 dark:text-orange-200">Welcome — let's set up your AI</h2>
              <p className="mt-1 text-sm text-orange-800 dark:text-orange-300">
                A 2-minute setup tunes your AI's personality, your profile, and the preferences it uses everywhere.
              </p>
            </div>
            <Link
              href="/chat"
              className="inline-flex items-center px-4 py-2 rounded-lg text-sm font-semibold bg-orange-600 hover:bg-orange-700 text-white shadow-sm whitespace-nowrap"
            >
              Start setup →
            </Link>
          </div>
        </div>
      )}

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Start New Work</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Choose the right entry path first, then launch with method context.</p>
      </div>

      {/* Required home CTAs */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {START_CARDS.map((card) => <StartAction key={card.title} {...card} />)}
      </div>

      {/* Method picker: search + installed + marketplace */}
      <div className="space-y-3">
        <div className="flex items-end justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">Method Picker</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400">Search methods, inspect context requirements, and launch directly.</p>
          </div>
          <input
            value={methodSearch}
            onChange={(e) => setMethodSearch(e.target.value)}
            placeholder="Search methods"
            className="w-full sm:w-72 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm px-3 py-2 text-gray-700 dark:text-gray-200"
          />
        </div>
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500">Available</h3>
            <div className="space-y-3">
              {installedMethods.map((method) => <MethodTile key={method.id} method={method} />)}
              {installedMethods.length === 0 && (
                <div className="text-xs text-gray-500 rounded-lg border border-dashed border-gray-300 dark:border-gray-700 px-3 py-4">No methods match your search.</div>
              )}
            </div>
          </div>
          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500">Marketplace</h3>
            <div className="space-y-3">
              {marketplaceMethods.map((method) => <MethodTile key={method.id} method={method} />)}
              {marketplaceMethods.length === 0 && (
                <div className="text-xs text-gray-500 rounded-lg border border-dashed border-gray-300 dark:border-gray-700 px-3 py-4">No marketplace methods match your search.</div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Personas" value={personas.length} sub="Manage personas →" href="/personas" />
        <StatCard label="Models" value={models.length} sub={`${activeModels.length} active →`} href="/models" />
        <StatCard label="Conversations" value={conversations.length} sub="View history →" href="/conversations" />
        <StatCard label="Status" value={healthInfo.value} sub={healthInfo.sub} />
      </div>

      {/* GPU Status */}
      <GpuStatusWidget />

      {/* Operational quick links */}
      <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-3">
        <div className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">Operational Links</div>
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <Link href="/personas/new" className="text-orange-600 dark:text-orange-400 hover:underline">Create persona</Link>
          <Link href="/stats" className="text-orange-600 dark:text-orange-400 hover:underline">Usage and cost</Link>
          <a href="/api/docs" target="_blank" rel="noopener noreferrer" className="text-orange-600 dark:text-orange-400 hover:underline">API docs</a>
        </div>
      </div>

      {/* Bottom grid — Personas + Models */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Personas */}
        {personas.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-semibold text-gray-900 dark:text-white">Personas</h2>
              <Link href="/personas" className="text-xs text-orange-600 dark:text-orange-400 hover:underline">View all →</Link>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
              <ul className="divide-y divide-gray-100 dark:divide-gray-700">
                {personas.slice(0, 5).map(p => (
                  <li key={p.id}>
                    <Link href={`/personas/${p.id}`} className="flex items-center justify-between px-5 py-3.5 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{p.name}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">{p.description || 'No description'}</p>
                      </div>
                      <span className={`ml-3 flex-shrink-0 px-2 py-0.5 text-xs font-medium rounded-full ${
                        p.is_default
                          ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300'
                          : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
                      }`}>
                        {p.is_default ? 'Default' : 'Active'}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {/* Models */}
        {models.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-semibold text-gray-900 dark:text-white">Models</h2>
              <Link href="/models" className="text-xs text-orange-600 dark:text-orange-400 hover:underline">View all →</Link>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
              <ul className="divide-y divide-gray-100 dark:divide-gray-700">
                {models.slice(0, 5).map(m => (
                  <li key={m.id} className="flex items-center justify-between px-5 py-3.5">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{m.display_name || m.model_id}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 capitalize">{m.provider_name || 'Unknown'}</p>
                    </div>
                    <span className={`ml-3 flex-shrink-0 px-2 py-0.5 text-xs font-medium rounded-full ${
                      m.is_active
                        ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                        : 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400'
                    }`}>
                      {m.is_active ? 'Active' : 'Off'}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
