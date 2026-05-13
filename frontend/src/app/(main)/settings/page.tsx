'use client'

import { API_BASE, AUTH_HEADERS, probeAndCacheApiBase } from '@/lib/config'
import PreferencesTab from '@/components/PreferencesTab'
import ImageSettingsTab from '@/components/ImageSettingsTab'
import VoiceAudioTab from '@/components/VoiceAudioTab'
import MediaConverterTab from '@/components/MediaConverterTab'
import { RemoteAccessTab } from './remote'
import { useToast } from '@/app/ToastProvider'
import { useSearchParams } from 'next/navigation'

import { Suspense, useState, useEffect, useCallback } from 'react'
import { api } from '@/lib/api'


import { ApiKeysTab, normalizeProviderSlug, type ProviderSlug } from '@/components/settings/ApiKeysTab'



// ─── Conversations Tab ────────────────────────────────────────────────────────
import { ConversationsTab } from '@/components/settings/ConversationsTab'
// ─── Identity Tab ─────────────────────────────────────────────────────────────
import { IdentityTab } from '@/components/settings/IdentityTab'
// ─── Server Tab ───────────────────────────────────────────────────────────────
import { ServerTab } from '@/components/settings/ServerTab'

interface MemoryFile {
  id: string
  name: string
  content: string
  description?: string
  created_at: string
  updated_at: string
}

interface UserProfile {
  id: string
  name: string
  email?: string
  preferences: Record<string, any>
}

interface RuntimeCapabilitiesSummary {
  local?: {
    comfyui_available?: boolean
    ollama_available?: boolean
  }
  cloud?: {
    any_available?: boolean
  }
}

function SettingsPageContent() {
  const searchParams = useSearchParams()
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [memoryFiles, setMemoryFiles] = useState<MemoryFile[]>([])
  const [loading, setLoading] = useState(true)
  const [profileSaving, setProfileSaving] = useState(false)
  const [profileSaved, setProfileSaved] = useState(false)
  const [activeTab, setActiveTab] = useState<'identity' | 'profile' | 'memory' | 'preferences' | 'voice' | 'conversations' | 'apikeys' | 'remote' | 'images' | 'media' | 'server' | 'budget'>('identity')
  const [budgetLimit, setBudgetLimit] = useState<string>('')
  const [budgetSaving, setBudgetSaving] = useState(false)
  const [budgetSaved, setBudgetSaved] = useState(false)
  const [runtimeMode, setRuntimeMode] = useState<'checking' | 'hybrid' | 'cloud-only' | 'local-only' | 'offline'>('checking')
  const [runtimeSignals, setRuntimeSignals] = useState<{ comfyui: boolean; ollama: boolean; cloud: boolean }>({
    comfyui: false,
    ollama: false,
    cloud: false,
  })
  const [updateStatus, setUpdateStatus] = useState<import('@/lib/types').UpdateStatus | null>(null)
  const [checkingUpdates, setCheckingUpdates] = useState(false)

  const preferredProvider = normalizeProviderSlug(searchParams.get('provider'))

  useEffect(() => {
    const requested = (searchParams.get('tab') || '').trim().toLowerCase()
    if (!requested) {
      if (preferredProvider) setActiveTab('apikeys')
      return
    }
    if (requested === 'api-keys' || requested === 'apikeys') {
      setActiveTab('apikeys')
      return
    }
    const allowed = new Set([
      'identity',
      'profile',
      'memory',
      'preferences',
      'voice',
      'conversations',
      'apikeys',
      'remote',
      'images',
      'media',
      'server',
      'budget',
    ])
    if (allowed.has(requested)) {
      setActiveTab(requested as any)
    }
  }, [searchParams, preferredProvider])

  const checkForUpdates = useCallback(async (force = false) => {
    try {
      setCheckingUpdates(true)
      const status = await api.getUpdateStatus(force)
      setUpdateStatus(status)
    } catch (e) {
      console.error('Failed to check update status:', e)
      setUpdateStatus({
        status: 'unavailable',
        checked_at: new Date().toISOString(),
        update_available: false,
        current_commit: null,
        latest_commit: null,
        branch: null,
        remote: null,
        compare_url: null,
        error: 'Could not check for updates.',
        cached: false,
      })
    } finally {
      setCheckingUpdates(false)
    }
  }, [])

  const saveProfile = async () => {
    if (!profile) return
    setProfileSaving(true)
    try {
      // Save to DB
      await fetch(`${API_BASE}/v1/user`, {
        method: 'PATCH',
        headers: { 'Authorization': 'Bearer modelmesh_local_dev_key', 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: profile.name, email: profile.email })
      })

      // Also update USER.md memory file so the AI knows about the user
      const userMdContent = `# USER.md — About You\n\n## Personal Info\n- Name: ${profile.name || ''}\n- Email: ${profile.email || ''}\n\n## Notes\n- Update this file with more context about yourself via Settings → Identity → Your Profile\n`
      await fetch(`${API_BASE}/v1/identity/user`, {
        method: 'PUT',
        headers: { 'Authorization': 'Bearer modelmesh_local_dev_key', 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: userMdContent })
      })

      setProfileSaved(true)
      setTimeout(() => setProfileSaved(false), 2500)
    } catch (e) {
      console.error('Failed to save profile:', e)
    } finally {
      setProfileSaving(false)
    }
  }
  const [editingFile, setEditingFile] = useState<MemoryFile | null>(null)
  const [newFileName, setNewFileName] = useState('')

  useEffect(() => {
    async function fetchData() {
      try {
        // Probe to find the healthy backend port (handles stale process on primary port)
        const base = await probeAndCacheApiBase()
        const [profileRes, memoryRes, runtimeCaps] = await Promise.all([
          fetch(`${base}/v1/user`, {
            headers: { 'Authorization': 'Bearer modelmesh_local_dev_key' }
          }).then(r => r.json()),
          fetch(`${base}/v1/memory`, {
            headers: { 'Authorization': 'Bearer modelmesh_local_dev_key' }
          }).then(r => r.json()),
          fetch(`${base}/v1/runtime/capabilities`, { headers: AUTH_HEADERS })
            .then(r => r.json())
            .catch(() => ({} as RuntimeCapabilitiesSummary)),
        ])
        setProfile(profileRes)
        setMemoryFiles(memoryRes.data || [])

        const comfyuiAvailable = Boolean(runtimeCaps?.local?.comfyui_available)
        const ollamaAvailable = Boolean(runtimeCaps?.local?.ollama_available)
        const localAvailable = Boolean(comfyuiAvailable || ollamaAvailable)
        const cloudAvailable = Boolean(runtimeCaps?.cloud?.any_available)

        setRuntimeSignals({
          comfyui: comfyuiAvailable,
          ollama: ollamaAvailable,
          cloud: cloudAvailable,
        })
        if (localAvailable && cloudAvailable) setRuntimeMode('hybrid')
        else if (!localAvailable && cloudAvailable) setRuntimeMode('cloud-only')
        else if (localAvailable && !cloudAvailable) setRuntimeMode('local-only')
        else setRuntimeMode('offline')

        // Fetch budget
        try {
          const budgetRes = await fetch(`${API_BASE}/v1/stats/budget`, {
            headers: { 'Authorization': 'Bearer modelmesh_local_dev_key' }
          }).then(r => r.json())
          if (budgetRes.budget_limit != null) {
            setBudgetLimit(String(budgetRes.budget_limit))
          }
        } catch {}
      } catch (e) {
        console.error('Failed to fetch:', e)
      } finally {
        setLoading(false)
      }
    }
    fetchData()
    checkForUpdates(false)
  }, [checkForUpdates])

  const createMemoryFile = async (name: string) => {
    try {
      const res = await fetch(`${API_BASE}/v1/memory`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer modelmesh_local_dev_key'
        },
        body: JSON.stringify({ name, content: '# ' + name + '\n\nAdd your content here...' })
      })
      const newFile = await res.json()
      setMemoryFiles([...memoryFiles, newFile])
      setNewFileName('')
    } catch (e) {
      console.error('Failed to create:', e)
    }
  }

  const updateMemoryFile = async (file: MemoryFile) => {
    try {
      await fetch(`${API_BASE}/v1/memory/${file.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer modelmesh_local_dev_key'
        },
        body: JSON.stringify({ content: file.content })
      })
      setEditingFile(null)
    } catch (e) {
      console.error('Failed to update:', e)
    }
  }

  const deleteMemoryFile = async (fileId: string) => {
    try {
      await fetch(`${API_BASE}/v1/memory/${fileId}`, {
        method: 'DELETE',
        headers: { 'Authorization': 'Bearer modelmesh_local_dev_key' }
      })
      setMemoryFiles(memoryFiles.filter(f => f.id !== fileId))
    } catch (e) {
      console.error('Failed to delete:', e)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="text-gray-500">Loading...</div>
      </div>
    )
  }

  const runtimeModeStyle: Record<typeof runtimeMode, string> = {
    checking: 'bg-gray-100 text-gray-700 border-gray-200',
    hybrid: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    'cloud-only': 'bg-blue-100 text-blue-800 border-blue-200',
    'local-only': 'bg-violet-100 text-violet-800 border-violet-200',
    offline: 'bg-amber-100 text-amber-800 border-amber-200',
  }

  const runtimeModeLabel: Record<typeof runtimeMode, string> = {
    checking: 'Runtime: Checking',
    hybrid: 'Runtime: Hybrid (Local + Cloud)',
    'cloud-only': 'Runtime: Cloud-only',
    'local-only': 'Runtime: Local-only',
    offline: 'Runtime: Limited / Offline',
  }

  return (
    <div>
      <div className="mb-8 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
          <p className="mt-1 text-sm text-gray-500">
            Manage your profile, memory files, and preferences
          </p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <span
            title={`ComfyUI: ${runtimeSignals.comfyui ? 'online' : 'offline'} | Ollama: ${runtimeSignals.ollama ? 'online' : 'offline'} | Cloud providers: ${runtimeSignals.cloud ? 'configured' : 'not configured'}`}
            className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium whitespace-nowrap ${runtimeModeStyle[runtimeMode]}`}
          >
            {runtimeModeLabel[runtimeMode]}
          </span>
          <div className="flex items-center gap-1.5 text-[11px]">
            <span className={`inline-flex items-center rounded-full px-2 py-0.5 ${runtimeSignals.comfyui ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-100 text-gray-500'}`}>
              ComfyUI {runtimeSignals.comfyui ? 'on' : 'off'}
            </span>
            <span className={`inline-flex items-center rounded-full px-2 py-0.5 ${runtimeSignals.ollama ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-100 text-gray-500'}`}>
              Ollama {runtimeSignals.ollama ? 'on' : 'off'}
            </span>
            <span className={`inline-flex items-center rounded-full px-2 py-0.5 ${runtimeSignals.cloud ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-500'}`}>
              Cloud {runtimeSignals.cloud ? 'on' : 'off'}
            </span>
          </div>
        </div>
      </div>

      {updateStatus && (
        <div className={`mb-6 rounded-lg border px-4 py-3 text-sm ${
          updateStatus.update_available
            ? 'border-amber-300 bg-amber-50 text-amber-900'
            : updateStatus.status === 'ok'
            ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
            : 'border-gray-300 bg-gray-50 text-gray-700'
        }`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-semibold">
                {updateStatus.update_available ? 'Update available' : 'You are up to date'}
              </p>
              <p className="text-xs mt-0.5 opacity-90">
                {updateStatus.current_commit ? `Current: ${updateStatus.current_commit.slice(0, 12)}` : 'Current: unknown'}
                {' · '}
                {updateStatus.latest_commit ? `Latest: ${updateStatus.latest_commit.slice(0, 12)}` : 'Latest: unavailable'}
                {updateStatus.branch ? ` · Branch: ${updateStatus.branch}` : ''}
                {updateStatus.cached ? ' · cached' : ''}
              </p>
              {updateStatus.error && (
                <p className="text-xs mt-1 opacity-90">{updateStatus.error}</p>
              )}
            </div>
            <div className="flex items-center gap-2">
              {updateStatus.compare_url && (
                <a
                  href={updateStatus.compare_url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs px-2.5 py-1 rounded border border-current/30 hover:bg-white/40"
                >
                  View changes
                </a>
              )}
              <button
                onClick={() => checkForUpdates(true)}
                disabled={checkingUpdates}
                className="text-xs px-2.5 py-1 rounded border border-current/30 hover:bg-white/40 disabled:opacity-50"
              >
                {checkingUpdates ? 'Checking...' : 'Check now'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="border-b border-gray-200 mb-6">
        <nav className="-mb-px flex space-x-6 overflow-x-auto">
          {([
            ['identity', 'Identity', 'border-orange-500 text-orange-600'],
            ['profile', 'Profile', 'border-indigo-500 text-indigo-600'],
            ['memory', 'Memory', 'border-indigo-500 text-indigo-600'],
            ['preferences', 'Preferences', 'border-indigo-500 text-indigo-600'],
            ['voice', '🎙️ Voice & Audio', 'border-violet-500 text-violet-600'],
            ['images', 'Image Generation', 'border-pink-500 text-pink-600'],
            ['media', '🎞️ Media Converter', 'border-orange-500 text-orange-600'],
            ['conversations', 'Conversations', 'border-indigo-500 text-indigo-600'],
            ['apikeys', 'API Keys', 'border-indigo-500 text-indigo-600'],
            ['budget', '💰 Budget', 'border-green-500 text-green-600'],
            ['remote', '🌐 Remote', 'border-orange-500 text-orange-600'],
            ['server', '⚙️ Server', 'border-gray-500 text-gray-700'],
          ] as const).map(([tab, label, activeClass]) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab as any)}
              className={`flex-shrink-0 py-2 px-1 border-b-2 font-medium text-sm whitespace-nowrap ${
                activeTab === tab
                  ? activeClass
                  : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
            >
              {label}
            </button>
          ))}
        </nav>
      </div>

      {/* Identity Tab */}
      {activeTab === 'identity' && (
        <div>
          <div className="mb-6">
            <h2 className="text-lg font-semibold text-gray-900">Identity</h2>
            <p className="text-sm text-gray-500 mt-1">Manage your AI's personality and your personal profile.</p>
          </div>
          <IdentityTab />
        </div>
      )}

      {/* Profile Tab */}
      {activeTab === 'profile' && (
        <div className="bg-white shadow sm:rounded-lg">
          <div className="px-4 py-5 sm:p-6">
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-lg font-medium text-gray-900">User Profile</h3>
              {profileSaved && <span className="text-sm text-green-600 font-medium animate-pulse">Saved!</span>}
            </div>
            <p className="mt-1 text-sm text-gray-500 mb-4">
              Saved here and synced to your AI's USER.md so it knows who you are.
            </p>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">Name</label>
                <input
                  type="text"
                  value={profile?.name || ''}
                  onChange={(e) => setProfile({ ...profile!, name: e.target.value })}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Email</label>
                <input
                  type="email"
                  value={profile?.email || ''}
                  onChange={(e) => setProfile({ ...profile!, email: e.target.value })}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                />
              </div>
              <div className="pt-1">
                <p className="text-xs text-gray-400 mb-3">
                  💡 For richer context (timezone, preferences, projects), use <strong>Settings → Identity → Your Profile</strong> to edit USER.md directly.
                </p>
                <button
                  type="button"
                  onClick={saveProfile}
                  disabled={profileSaving}
                  className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-300"
                >
                  {profileSaving ? 'Saving…' : 'Save Profile'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Memory Files Tab */}
      {activeTab === 'memory' && (
        <div className="space-y-6">
          <div className="bg-white shadow sm:rounded-lg">
            <div className="px-4 py-5 sm:p-6">
              <h3 className="text-lg font-medium text-gray-900">Memory Files</h3>
              <p className="mt-1 text-sm text-gray-500">
                Memory files are injected into AI system prompts to provide context and personalization.
              </p>

              {/* Create new file */}
              <div className="mt-4 flex gap-2">
                <input
                  type="text"
                  placeholder="New file name (e.g., USER.md, CONTEXT.md)"
                  value={newFileName}
                  onChange={(e) => setNewFileName(e.target.value)}
                  className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                />
                <button
                  onClick={() => newFileName && createMemoryFile(newFileName)}
                  disabled={!newFileName}
                  className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-300"
                >
                  Create
                </button>
              </div>
            </div>
          </div>

          {/* Memory files list */}
          {memoryFiles.map((file) => (
            <div key={file.id} className="bg-white shadow sm:rounded-lg">
              <div className="px-4 py-5 sm:p-6">
                <div className="flex justify-between items-start">
                  <div>
                    <h4 className="text-sm font-medium text-gray-900">{file.name}</h4>
                    {file.description && (
                      <p className="text-sm text-gray-500">{file.description}</p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setEditingFile(file)}
                      className="text-sm text-indigo-600 hover:text-indigo-500"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => deleteMemoryFile(file.id)}
                      className="text-sm text-red-600 hover:text-red-500"
                    >
                      Delete
                    </button>
                  </div>
                </div>

                {editingFile?.id === file.id ? (
                  <div className="mt-4">
                    <textarea
                      value={file.content}
                      onChange={(e) => {
                        const updated = memoryFiles.map(f => 
                          f.id === file.id ? { ...f, content: e.target.value } : f
                        )
                        setMemoryFiles(updated)
                      }}
                      rows={10}
                      className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 font-mono text-sm"
                    />
                    <div className="mt-2 flex gap-2">
                      <button
                        onClick={() => updateMemoryFile(file)}
                        className="inline-flex items-center px-3 py-1.5 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => setEditingFile(null)}
                        className="inline-flex items-center px-3 py-1.5 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <pre className="mt-2 text-sm text-gray-600 whitespace-pre-wrap line-clamp-3">
                    {file.content}
                  </pre>
                )}
              </div>
            </div>
          ))}

          {memoryFiles.length === 0 && (
            <div className="text-center py-8">
              <p className="text-sm text-gray-500">No memory files yet. Create one to personalize your AI interactions.</p>
            </div>
          )}
        </div>
      )}

      {/* Preferences Tab */}
      {activeTab === 'preferences' && (
        <PreferencesTab />
      )}

      {/* Voice & Audio Tab */}
      {activeTab === 'voice' && (
        <div>
          <div className="mb-6">
            <h2 className="text-lg font-semibold text-gray-900">Voice & Audio</h2>
            <p className="text-sm text-gray-500 mt-1">Configure speech-to-text, text-to-speech, voice selection, and playback.</p>
          </div>
          <VoiceAudioTab />
        </div>
      )}

      {/* Conversations Tab */}
      {activeTab === 'conversations' && (
        <ConversationsTab />
      )}

      {/* Remote Access Tab */}
      {activeTab === 'remote' && (
        <div>
          <div className="mb-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Remote Access</h2>
            <p className="text-sm text-gray-500 mt-1">Telegram bot, Tailscale, and firewall configuration for remote access.</p>
          </div>
          <RemoteAccessTab />
        </div>
      )}

      {/* API Keys Tab */}
      {activeTab === 'apikeys' && (
        <div>
          <div className="mb-6">
            <h2 className="text-lg font-semibold text-gray-900">API Keys</h2>
            <p className="text-sm text-gray-500 mt-1">Manage provider API keys. Changes are applied immediately.</p>
          </div>
          <ApiKeysTab preferredProvider={preferredProvider} />
        </div>
      )}

      {/* Image Generation Tab */}
      {activeTab === 'images' && (
        <ImageSettingsTab />
      )}

      {/* Media Converter Tab */}
      {activeTab === 'media' && (
        <MediaConverterTab />
      )}

      {/* Budget Tab */}
      {activeTab === 'budget' && (
        <div>
          <div className="mb-6">
            <h2 className="text-lg font-semibold text-gray-900">Budget Threshold</h2>
            <p className="text-sm text-gray-500 mt-1">Set a monthly budget limit. The Stats page will warn you if projected costs exceed this amount.</p>
          </div>
          <div className="bg-white shadow sm:rounded-lg">
            <div className="px-4 py-5 sm:p-6">
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">Monthly Budget Limit ($)</label>
                  <div className="mt-1 relative rounded-md shadow-sm">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <span className="text-gray-500 sm:text-sm">$</span>
                    </div>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={budgetLimit}
                      onChange={(e) => setBudgetLimit(e.target.value)}
                      placeholder="e.g. 50.00"
                      className="block w-full pl-7 pr-12 rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                    />
                  </div>
                  <p className="mt-1 text-xs text-gray-400">
                    Leave empty or set to 0 to disable budget warnings.
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={async () => {
                      setBudgetSaving(true)
                      try {
                        await fetch(`${API_BASE}/v1/stats/budget`, {
                          method: 'PATCH',
                          headers: { 'Authorization': 'Bearer modelmesh_local_dev_key', 'Content-Type': 'application/json' },
                          body: JSON.stringify({ budget_limit: parseFloat(budgetLimit) || 0 }),
                        })
                        setBudgetSaved(true)
                        setTimeout(() => setBudgetSaved(false), 2500)
                      } catch (e) {
                        console.error('Failed to save budget:', e)
                      } finally {
                        setBudgetSaving(false)
                      }
                    }}
                    disabled={budgetSaving}
                    className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-300"
                  >
                    {budgetSaving ? 'Saving…' : 'Save Budget'}
                  </button>
                  {budgetSaved && <span className="text-sm text-green-600 font-medium animate-pulse">Saved!</span>}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Server Tab */}
      {activeTab === 'server' && (
        <div>
          <div className="mb-6">
            <h2 className="text-lg font-semibold text-gray-900">Server</h2>
            <p className="text-sm text-gray-500 mt-1">Backend process info, health status, and controls.</p>
          </div>
          <ServerTab />
        </div>
      )}
    </div>
  )
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-gray-500">Loading settings...</div>}>
      <SettingsPageContent />
    </Suspense>
  )
}
