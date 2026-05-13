// Extracted from settings/page.tsx. Identity panel: edits SOUL.md / USER.md
// / IDENTITY.md and exposes the Reset Onboarding action.

'use client'

import { useState, useEffect } from 'react'
import { API_BASE, AUTH_HEADERS } from '@/lib/config'

export function IdentityTab() {

  const [soulContent, setSoulContent] = useState('')
  const [userContent, setUserContent] = useState('')
  const [identityContent, setIdentityContent] = useState('')
  const [saving, setSaving] = useState<Record<string, boolean>>({})
  const [saved, setSaved] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchAll = async () => {
      try {
        const [soulRes, userRes, identityRes] = await Promise.all([
          fetch(`${API_BASE}/v1/identity/soul`, { headers: AUTH_HEADERS }).then(r => r.json()),
          fetch(`${API_BASE}/v1/identity/user`, { headers: AUTH_HEADERS }).then(r => r.json()),
          fetch(`${API_BASE}/v1/identity/identity-file`, { headers: AUTH_HEADERS }).then(r => r.json()),
        ])
        setSoulContent(soulRes.content || '')
        setUserContent(userRes.content || '')
        setIdentityContent(identityRes.content || '')
      } catch (e) {
        console.error('Failed to fetch identity files:', e)
      } finally {
        setLoading(false)
      }
    }
    fetchAll()
  }, [])

  const saveFile = async (key: string, url: string, content: string) => {
    setSaving(s => ({ ...s, [key]: true }))
    try {
      await fetch(url, { method: 'PUT', headers: AUTH_HEADERS, body: JSON.stringify({ content }) })
      setSaved(s => ({ ...s, [key]: true }))
      setTimeout(() => setSaved(s => ({ ...s, [key]: false })), 2500)
    } finally {
      setSaving(s => ({ ...s, [key]: false }))
    }
  }

  const resetOnboarding = async () => {
    if (!confirm('This will clear your profile and immediately re-run setup in chat. Continue?')) return
    await fetch(`${API_BASE}/v1/identity/user`, {
      method: 'PUT', headers: AUTH_HEADERS, body: JSON.stringify({ content: '' })
    })
    await fetch(`${API_BASE}/v1/identity/soul`, {
      method: 'PUT', headers: AUTH_HEADERS, body: JSON.stringify({ content: '' })
    })
    setUserContent('')
    setSoulContent('')
    setIdentityContent('')
    // Navigate the user into the wizard rather than asking them to find chat.
    // The chat page checks /v1/identity/status on mount and fires the
    // OnboardingOverlay when first_run is true.
    window.location.href = '/chat'
  }

  if (loading) return <div className="text-sm text-gray-500 py-8 text-center">Loading...</div>

  const fileCard = (
    key: string,
    title: string,
    description: string,
    hint: string,
    value: string,
    onChange: (v: string) => void,
    saveUrl: string,
    rows: number = 10,
  ) => (
    <div className="bg-white shadow sm:rounded-lg overflow-hidden">
      <div className="px-4 py-5 sm:p-6">
        <div className="flex items-center justify-between mb-1">
          <div>
            <h3 className="text-base font-semibold text-gray-900">{title}</h3>
            <p className="text-xs font-mono text-gray-400 mt-0.5">{hint}</p>
          </div>
          {saved[key] && <span className="text-xs text-green-600 font-medium animate-pulse">Saved!</span>}
        </div>
        <p className="text-sm text-gray-500 mb-3">{description}</p>
        <textarea
          value={value}
          onChange={e => onChange(e.target.value)}
          rows={rows}
          className="block w-full rounded-md border-gray-300 shadow-sm focus:border-orange-500 focus:ring-orange-500 font-mono text-sm"
        />
        <button
          onClick={() => saveFile(key, saveUrl, value)}
          disabled={saving[key]}
          className="mt-3 inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-orange-600 hover:bg-orange-700 disabled:bg-gray-300"
        >
          {saving[key] ? 'Saving...' : `Save`}
        </button>
      </div>
    </div>
  )

  return (
    <div className="space-y-6">

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-800">
        <strong>Tip:</strong> You can also update these from chat using slash commands:{' '}
        <code className="font-mono bg-blue-100 px-1 rounded">/soul</code>,{' '}
        <code className="font-mono bg-blue-100 px-1 rounded">/identity</code>,{' '}
        <code className="font-mono bg-blue-100 px-1 rounded">/user</code>.
        Each starts a guided wizard to walk you through the questions.
      </div>

      {fileCard(
        'soul',
        'AI Soul',
        'Defines your AI\'s personality, tone, and behaviour. Injected as context into every conversation.',
        'data/soul.md',
        soulContent,
        setSoulContent,
        `${API_BASE}/v1/identity/soul`,
        12,
      )}

      {fileCard(
        'identity',
        'AI Identity',
        'Name, creature/role, and vibe tagline. Quick-reference identity card.',
        'data/identity.md',
        identityContent,
        setIdentityContent,
        `${API_BASE}/v1/identity/identity-file`,
        5,
      )}

      {fileCard(
        'user',
        'Your Profile',
        'What the AI knows about you — name, communication style, and primary use. Built during setup, editable anytime.',
        'data/user.md',
        userContent,
        setUserContent,
        `${API_BASE}/v1/identity/user`,
        8,
      )}

      {/* Danger zone */}
      <div className="bg-white shadow sm:rounded-lg overflow-hidden border border-red-100">
        <div className="px-4 py-5 sm:p-6">
          <h3 className="text-base font-semibold text-red-700 mb-1">Reset Setup</h3>
          <p className="text-sm text-gray-500 mb-3">
            Clears all three identity files. The setup wizard will run again next time you open chat.
          </p>
          <button
            onClick={resetOnboarding}
            className="inline-flex items-center px-4 py-2 border border-red-300 text-sm font-medium rounded-md text-red-600 bg-white hover:bg-red-50"
          >
            Reset Onboarding
          </button>
        </div>
      </div>
    </div>
  )
}
