// Extracted from settings/page.tsx to slim that god-file down.
// Contract: ApiKeysTab is the API-key + provider-connection settings panel.
// Owns provider metadata (PROVIDER_META), provider/runtime status fetches,
// clear-impact preview, OAuth flows, and the Test/Reconnect/Disconnect UX.
//
// Exports:
//   ApiKeysTab (default-ish; named export) — the panel component
//   normalizeProviderSlug — used by settings/page.tsx to interpret ?provider=
//   ProviderSlug — type for the deep-link prop

'use client'

import { useState, useEffect, useCallback } from 'react'
import { API_BASE, AUTH_HEADERS } from '@/lib/config'
import { useToast } from '@/app/ToastProvider'

const PROVIDER_META: Record<string, { label: string; placeholder: string; link: string; color: string }> = {
  anthropic:  { label: 'Anthropic',  placeholder: 'sk-ant-…',        link: 'https://console.anthropic.com/settings/keys',    color: 'bg-orange-100 text-orange-800' },
  google:     { label: 'Google',     placeholder: 'AIzaSy…',         link: 'https://aistudio.google.com/app/apikey',          color: 'bg-blue-100 text-blue-800' },
  gemini:     { label: 'Gemini',     placeholder: 'AIzaSy…',         link: 'https://aistudio.google.com/app/apikey',          color: 'bg-blue-100 text-blue-800' },
  'github-copilot': { label: 'GitHub Copilot Token', placeholder: 'Paste Copilot-compatible bearer token…', link: 'https://github.com/features/copilot', color: 'bg-slate-100 text-slate-800' },
  'codex-proxy': { label: 'Codex Proxy URL', placeholder: 'http://127.0.0.1:10531/v1', link: '', color: 'bg-emerald-100 text-emerald-800' },
  openrouter: { label: 'OpenRouter', placeholder: 'sk-or-v1-…',      link: 'https://openrouter.ai/keys',                      color: 'bg-purple-100 text-purple-800' },
  openai:     { label: 'OpenAI',     placeholder: 'sk-…',            link: 'https://platform.openai.com/api-keys',            color: 'bg-green-100 text-green-800' },
  'openai-oauth': { label: 'OpenAI OAuth', placeholder: 'Paste Codex/ChatGPT OAuth access token…', link: '', color: 'bg-emerald-100 text-emerald-800' },
}

interface KeyStatus {
  provider: string
  env_var: string
  is_set: boolean
  masked_value: string | null
}

interface ProviderInventory {
  id: string
  name: string
  display_name?: string
  is_active: boolean
  model_count: number
  active_model_count: number
}

interface ProviderHealthSummary {
  provider_id: string
  provider_name: string
  health_status: 'ok' | 'degraded' | 'failed' | 'unknown' | string
  credential_status: 'valid' | 'invalid' | 'unchecked' | string
  connectivity_status: 'ok' | 'error' | 'unchecked' | string
  last_checked_at?: string | null
  message?: string | null
  notes?: string | null
}

interface RuntimeCredentialStatus {
  openai_oauth: {
    provider: string
    has_access_token: boolean
    masked_access_token: string | null
    has_refresh_token: boolean
    codex_cli_installed: boolean
    codex_cli_logged_in: boolean
    codex_cli_status: string | null
    auth_file: string
    proxy_base_url: string
    proxy_reachable: boolean
    proxy_url_supported: boolean
    proxy_env_override: boolean
    using_default_proxy_url: boolean
    configuration_issue: string | null
    auth_ready: boolean
    has_openai_api_key: boolean
    usable: boolean
    usability_summary: string
    recommended_action: string | null
  }
  github_copilot: {
    provider: string
    has_token: boolean
    masked_token: string | null
    source: 'env_github_copilot_token' | 'env_github_token' | 'collaboration_user' | 'none'
    usable: boolean
    collaboration_user_count: number
    oauth_configured: boolean
    live_verified: boolean
    validation_error: string | null
    has_copilot_scope: boolean | null
  }
}

export function getCodexRuntimeBadge(status: RuntimeCredentialStatus['openai_oauth']): {
  label: string
  className: string
} {
  if (status.has_openai_api_key) {
    return { label: 'API key ready', className: 'bg-emerald-100 text-emerald-800' }
  }
  if (status.usable && status.has_access_token && !status.proxy_reachable) {
    return { label: 'OAuth ready', className: 'bg-emerald-100 text-emerald-800' }
  }
  if (status.usable) {
    return { label: 'OAuth proxy ready', className: 'bg-emerald-100 text-emerald-800' }
  }
  if (status.codex_cli_logged_in) {
    return { label: 'CLI connected', className: 'bg-blue-100 text-blue-800' }
  }
  if (status.auth_ready) {
    return { label: 'OAuth detected', className: 'bg-blue-100 text-blue-800' }
  }
  return { label: 'Needs setup', className: 'bg-amber-100 text-amber-800' }
}

interface ClearImpact {
  provider: string
  affected_models: Array<{ id: string; model_id: string; display_name: string }>
  affected_personas: Array<{ id: string; name: string; slot: string; current_model_id: string }>
  affected_agents: Array<{ id: string; name: string; current_model_id: string }>
  replacement_candidates: Array<{ id: string; model_id: string; display_name: string; provider_name: string }>
  has_references: boolean
}

export type ProviderSlug = keyof typeof PROVIDER_META

export function normalizeProviderSlug(value: string | null): ProviderSlug | null {
  if (!value) return null
  const normalized = value.trim().toLowerCase()
  if (!normalized) return null
  if (normalized === 'api-keys' || normalized === 'apikeys') return null
  return Object.prototype.hasOwnProperty.call(PROVIDER_META, normalized)
    ? (normalized as ProviderSlug)
    : null
}

export function ApiKeysTab({ preferredProvider }: { preferredProvider?: ProviderSlug | null }) {
  const { addToast } = useToast()
  const [keys, setKeys] = useState<KeyStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState<Record<string, boolean>>({})
  const [saved, setSaved] = useState<Record<string, boolean>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [clearImpact, setClearImpact] = useState<ClearImpact | null>(null)
  const [replacements, setReplacements] = useState<Record<string, string>>({})
  const [clearing, setClearing] = useState(false)
  const [providerActionBusy, setProviderActionBusy] = useState<Record<string, boolean>>({})
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeCredentialStatus | null>(null)
  const [providerInventory, setProviderInventory] = useState<Record<string, ProviderInventory>>({})
  const [providerHealth, setProviderHealth] = useState<Record<string, ProviderHealthSummary>>({})
  const [providerHealthLoading, setProviderHealthLoading] = useState(false)
  const [copilotDevice, setCopilotDevice] = useState<{ user_code: string; verification_uri: string; device_code: string; status: 'pending' | 'ok' | 'error'; error?: string } | null>(null)

  const fetchRuntimeStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/v1/api-keys/runtime-status`, { headers: AUTH_HEADERS })
      if (!res.ok) return
      setRuntimeStatus(await res.json())
    } catch (e) {
      console.error('Failed to fetch runtime credential status', e)
    }
  }, [])

  const fetchKeys = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/v1/api-keys`, { headers: AUTH_HEADERS })
      const data = await res.json()
      setKeys(data.data || [])
    } catch (e) {
      console.error('Failed to fetch keys', e)
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchProviderInventory = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/v1/providers?active_only=false`, { headers: AUTH_HEADERS })
      if (!res.ok) return
      const data = await res.json()
      const inventory = Object.fromEntries(
        (data.data || []).map((provider: ProviderInventory) => [provider.name, provider])
      )
      setProviderInventory(inventory)
    } catch (e) {
      console.error('Failed to fetch providers', e)
    }
  }, [])

  const fetchProviderHealth = useCallback(async () => {
    try {
      setProviderHealthLoading(true)
      const res = await fetch(`${API_BASE}/v1/providers/health/all`, { headers: AUTH_HEADERS })
      if (!res.ok) return
      const data = (await res.json()) as ProviderHealthSummary[]
      const healthByName = Object.fromEntries(
        (data || []).map((item) => [item.provider_name, item])
      )
      setProviderHealth(healthByName)
    } catch (e) {
      console.error('Failed to fetch provider health', e)
    } finally {
      setProviderHealthLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchKeys()
    fetchRuntimeStatus()
    fetchProviderInventory()
    fetchProviderHealth()
  }, [fetchKeys, fetchRuntimeStatus, fetchProviderInventory, fetchProviderHealth])

  const saveKey = async (provider: string) => {
    const value = editing[provider]?.trim()
    if (!value) return
    setSaving(s => ({ ...s, [provider]: true }))
    setErrors(e => ({ ...e, [provider]: '' }))
    try {
      const res = await fetch(`${API_BASE}/v1/api-keys/${provider}`, {
        method: 'PUT',
        headers: AUTH_HEADERS,
        body: JSON.stringify({ value }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.detail || 'Save failed')
      }
      const updated = await res.json()
      setKeys(prev => prev.map(k => k.provider === provider
        ? { ...k, is_set: true, masked_value: updated.masked_value }
        : k
      ))
      setEditing(e => { const n = { ...e }; delete n[provider]; return n })
      setSaved(s => ({ ...s, [provider]: true }))
      await fetchRuntimeStatus()
      await fetchProviderInventory()
      setTimeout(() => setSaved(s => ({ ...s, [provider]: false })), 2500)
    } catch (e: any) {
      setErrors(err => ({ ...err, [provider]: e.message }))
    } finally {
      setSaving(s => ({ ...s, [provider]: false }))
    }
  }

  const clearKey = async (provider: string) => {
    // Step 1: fetch impact report — what would happen if we cleared this key?
    const impactRes = await fetch(
      `${API_BASE}/v1/api-keys/${provider}/clear-impact`,
      { headers: AUTH_HEADERS }
    )
    if (!impactRes.ok) {
      alert('Could not check impact of clearing this key.')
      return
    }
    const impact: ClearImpact = await impactRes.json()

    // No references → simple confirm + clear
    if (!impact.has_references) {
      const modelCount = impact.affected_models.length
      const msg = modelCount > 0
        ? `Clear the ${PROVIDER_META[provider]?.label || provider} API key?\n\n${modelCount} model(s) will be deactivated.`
        : `Clear the ${PROVIDER_META[provider]?.label || provider} API key?`
      if (!confirm(msg)) return
      const res = await fetch(`${API_BASE}/v1/api-keys/${provider}`, {
        method: 'DELETE',
        headers: AUTH_HEADERS,
        body: JSON.stringify({}),
      })
      if (res.ok) {
        setKeys(prev => prev.map(k => k.provider === provider ? { ...k, is_set: false, masked_value: null } : k))
        await fetchRuntimeStatus()
        await fetchProviderInventory()
      }
      return
    }

    // References exist → show dialog with replacement dropdowns
    setClearImpact(impact)
    setReplacements({})
  }

  const confirmClearWithReplacements = async (useForce: boolean) => {
    if (!clearImpact) return
    setClearing(true)
    try {
      const res = await fetch(`${API_BASE}/v1/api-keys/${clearImpact.provider}`, {
        method: 'DELETE',
        headers: AUTH_HEADERS,
        body: JSON.stringify({
          replacements: useForce ? undefined : replacements,
          force: useForce,
        }),
      })
      if (!res.ok) {
        const err = await res.json()
        alert(err.detail?.message || err.detail || 'Failed to clear key')
        return
      }
      const result = await res.json()
      setKeys(prev => prev.map(k => k.provider === clearImpact.provider ? { ...k, is_set: false, masked_value: null } : k))
      await fetchRuntimeStatus()
      await fetchProviderInventory()
      alert(
        `✓ ${PROVIDER_META[clearImpact.provider]?.label} provider removed.\n\n` +
        `Deactivated ${result.deactivated_models} models.\n` +
        `Reassigned ${result.reassigned_personas} personas, ${result.reassigned_agents} agents.`
      )
      setClearImpact(null)
      setReplacements({})
    } finally {
      setClearing(false)
    }
  }

  // OpenRouter OAuth (PKCE) — redirects to OpenRouter, exchanges code for key on return
  const connectOpenRouter = async () => {
    // Generate PKCE code verifier (random 64-char string) + challenge (SHA-256)
    const randomBytes = new Uint8Array(48)
    crypto.getRandomValues(randomBytes)
    const codeVerifier = btoa(String.fromCharCode.apply(null, Array.from(randomBytes)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')

    const encoder = new TextEncoder()
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(codeVerifier))
    const codeChallenge = btoa(String.fromCharCode.apply(null, Array.from(new Uint8Array(hashBuffer))))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')

    sessionStorage.setItem('openrouter_pkce_verifier', codeVerifier)

    const callbackUrl = `${window.location.origin}/auth/openrouter/callback`
    const authUrl = `https://openrouter.ai/auth?callback_url=${encodeURIComponent(callbackUrl)}&code_challenge=${codeChallenge}&code_challenge_method=S256`
    window.location.href = authUrl
  }

  const connectGitHubOAuth = async () => {
    try {
      const res = await fetch(`${API_BASE}/v1/auth/github/authorize?origin=${encodeURIComponent(window.location.origin)}`)
      const payload = await res.json().catch(() => ({}))
      if (!res.ok) {
        const detail = payload?.detail || `HTTP ${res.status}`
        const hint = res.status === 503
          ? ' Backend OAuth is not configured. Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET in backend/.env, then restart DevForgeAI.'
          : ''
        throw new Error(`${detail}${hint}`)
      }

      const { authorize_url, state } = payload
      if (!authorize_url || !state) {
        throw new Error('GitHub OAuth response was missing authorize_url/state')
      }
      sessionStorage.setItem('github_oauth_state', state)
      sessionStorage.setItem('github_oauth_redirect', '/settings?tab=api-keys')
      window.location.href = authorize_url
    } catch (e: any) {
      addToast({ type: 'error', title: 'GitHub OAuth failed', message: e.message || 'Could not start GitHub sign-in', autoClose: 7000 })
    }
  }

  const importGitHubFromCli = async () => {
    try {
      const statusRes = await fetch(`${API_BASE}/v1/auth/github/cli-status`, { headers: AUTH_HEADERS })
      const statusData = statusRes.ok ? await statusRes.json() : null
      if (!statusData?.installed) {
        addToast({
          type: 'error',
          title: 'GitHub CLI not installed',
          message: 'Install gh from https://cli.github.com/, then run "gh auth login".',
          autoClose: 6000,
        })
        return
      }
      if (!statusData?.authenticated) {
        addToast({
          type: 'error',
          title: 'GitHub CLI not authenticated',
          message: 'Open a terminal and run: gh auth login --web -s "read:user user:email"',
          autoClose: 8000,
        })
        return
      }
      const res = await fetch(`${API_BASE}/v1/auth/github/cli-import`, {
        method: 'POST',
        headers: AUTH_HEADERS,
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || 'CLI import failed')
      addToast({
        type: 'success',
        title: 'GitHub CLI token imported',
        message: 'Verifying Copilot access…',
        autoClose: 3000,
      })
      await fetchRuntimeStatus()
    } catch (e: any) {
      addToast({ type: 'error', title: 'CLI import failed', message: e.message || 'Could not import gh token', autoClose: 5000 })
    }
  }

  const startCopilotDeviceFlow = async () => {
    try {
      const startRes = await fetch(`${API_BASE}/v1/auth/github/copilot-device-start`, {
        method: 'POST', headers: AUTH_HEADERS,
      })
      const startData = await startRes.json()
      if (!startRes.ok) throw new Error(startData.detail || 'Could not start device flow')
      setCopilotDevice({
        user_code: startData.user_code,
        verification_uri: startData.verification_uri,
        device_code: startData.device_code,
        status: 'pending',
      })
      try { window.open(startData.verification_uri, '_blank', 'noopener') } catch {}
      try { await navigator.clipboard.writeText(startData.user_code) } catch {}

      const interval = Math.max(2, Number(startData.interval) || 5) * 1000
      const expiresAt = Date.now() + (Number(startData.expires_in) || 900) * 1000
      // Poll until the user authorizes (or expiry)
      const poll = async (): Promise<void> => {
        if (Date.now() > expiresAt) {
          setCopilotDevice((s) => s ? { ...s, status: 'error', error: 'expired' } : s)
          return
        }
        const pollRes = await fetch(`${API_BASE}/v1/auth/github/copilot-device-poll`, {
          method: 'POST',
          headers: { ...AUTH_HEADERS, 'Content-Type': 'application/json' },
          body: JSON.stringify({ device_code: startData.device_code }),
        })
        const pollData = await pollRes.json()
        if (pollData.status === 'ok') {
          setCopilotDevice((s) => s ? { ...s, status: 'ok' } : s)
          addToast({ type: 'success', title: 'Copilot connected', message: 'Live model list will populate on next sync.', autoClose: 4000 })
          await fetchRuntimeStatus()
          // Trigger a model sync so the new GPT/Claude entries show up immediately
          fetch(`${API_BASE}/v1/models/sync/provider/github-copilot`, { method: 'POST', headers: AUTH_HEADERS }).catch(() => {})
          return
        }
        if (pollData.status === 'error') {
          setCopilotDevice((s) => s ? { ...s, status: 'error', error: pollData.error || 'failed' } : s)
          addToast({ type: 'error', title: 'Copilot auth failed', message: pollData.error_description || pollData.error || 'unknown', autoClose: 5000 })
          return
        }
        setTimeout(poll, interval)
      }
      setTimeout(poll, interval)
    } catch (e: any) {
      addToast({ type: 'error', title: 'Device flow failed', message: e.message || 'Could not start device flow', autoClose: 5000 })
    }
  }

  const launchCodexCliLogin = async () => {
    try {
      const res = await fetch(`${API_BASE}/v1/api-keys/openai-oauth/launch-cli-login`, {
        method: 'POST',
        headers: AUTH_HEADERS,
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || 'Could not launch Codex CLI login')
      await fetchRuntimeStatus()

      const refreshedRes = await fetch(`${API_BASE}/v1/api-keys/runtime-status`, { headers: AUTH_HEADERS })
      const refreshedStatus: RuntimeCredentialStatus | null = refreshedRes.ok ? await refreshedRes.json() : null
      const codexStatus = refreshedStatus?.openai_oauth
      const toastMessage = codexStatus?.usable
        ? (data.message || 'Codex runtime is ready.')
        : codexStatus?.codex_cli_logged_in
        ? `${data.message || 'Logged in using ChatGPT'} Runtime still needs an OpenAI-compatible HTTP proxy or OPENAI_API_KEY.`
        : (data.message || 'Refresh runtime status after finishing the login flow.')

      addToast({
        type: codexStatus?.usable ? 'success' : 'info',
        title: data.started ? 'Codex login started' : 'Codex already connected',
        message: toastMessage,
        autoClose: 6500,
      })
    } catch (e: any) {
      addToast({ type: 'error', title: 'Codex login failed', message: e.message || 'Could not launch Codex CLI login', autoClose: 5000 })
    }
  }

  if (loading) return <div className="text-sm text-gray-500 py-8 text-center">Loading keys…</div>

  const codexRuntimeBadge = runtimeStatus ? getCodexRuntimeBadge(runtimeStatus.openai_oauth) : null
  const keyByProvider = Object.fromEntries(keys.map((key) => [key.provider, key])) as Record<string, KeyStatus>
  const anthropicReady = Boolean(keyByProvider.anthropic?.is_set)
  const googleReady = Boolean(keyByProvider.google?.is_set || keyByProvider.gemini?.is_set)
  const openRouterReady = Boolean(keyByProvider.openrouter?.is_set)
  const openAiReady = Boolean(keyByProvider.openai?.is_set || runtimeStatus?.openai_oauth.usable)
  const githubReady = Boolean(runtimeStatus?.github_copilot.usable || keyByProvider['github-copilot']?.is_set)

  const openProviderEditor = (provider: string) => {
    setEditing((current) => ({ ...current, [provider]: current[provider] ?? '' }))
  }

  useEffect(() => {
    if (!preferredProvider) return
    openProviderEditor(preferredProvider)
  }, [preferredProvider])

  const describeProvider = (provider: string) => {
    const inventory = providerInventory[provider]
    const activeModels = inventory?.active_model_count ?? 0

    if (provider === 'openai') {
      const status = runtimeStatus?.openai_oauth
      if (!status) {
        return 'OpenAI runtime status is still loading.'
      }
      return [
        status.usability_summary,
        activeModels > 0 ? `${activeModels} active models are already available.` : 'No active OpenAI models are synced yet.',
        status.recommended_action || 'Use Test to sync the live OpenAI/Codex catalog now.',
      ].join(' ')
    }

    if (provider === 'github-copilot') {
      const status = runtimeStatus?.github_copilot
      if (!status) {
        return 'GitHub Copilot runtime status is still loading.'
      }
      return [
        status.usable
          ? 'GitHub Copilot is live-verified and ready.'
          : status.validation_error || 'GitHub Copilot is not fully connected yet.',
        activeModels > 0 ? `${activeModels} Copilot models are active.` : 'No Copilot models are synced yet.',
        status.has_copilot_scope === false
          ? 'Reconnect using the Copilot device flow to restore the copilot scope.'
          : 'Use Test to sync the live Copilot catalog now.',
      ].join(' ')
    }

    const envVar = keyByProvider[provider]?.env_var || 'credential'
    const isReady = provider === 'anthropic'
      ? anthropicReady
      : provider === 'google'
      ? googleReady
      : provider === 'openrouter'
      ? openRouterReady
      : false

    return isReady
      ? `${PROVIDER_META[provider]?.label || provider} is connected. ${activeModels > 0 ? `${activeModels} active models are already synced.` : 'No models are synced yet.'} Use Test to refresh the live catalog.`
      : `${PROVIDER_META[provider]?.label || provider} is not connected yet. Add ${envVar} first, then use Test to verify the provider catalog.`
  }

  const diagnoseProvider = (provider: string) => {
    const ready = provider === 'openai'
      ? openAiReady
      : provider === 'github-copilot'
      ? githubReady
      : provider === 'anthropic'
      ? anthropicReady
      : provider === 'google'
      ? googleReady
      : openRouterReady

    addToast({
      type: ready ? 'info' : 'error',
      title: `${PROVIDER_META[provider]?.label || provider} diagnosis`,
      message: describeProvider(provider),
      autoClose: 8000,
    })
  }

  const testProviderConnection = async (actionKey: string, providerNames: string[], title: string) => {
    setProviderActionBusy((current) => ({ ...current, [actionKey]: true }))
    try {
      const results: Array<{ provider: string; message: string; added: number }> = []
      for (const providerName of providerNames) {
        const res = await fetch(`${API_BASE}/v1/models/sync/provider/${providerName}`, {
          method: 'POST',
          headers: AUTH_HEADERS,
        })
        const payload = await res.json().catch(() => ({}))
        if (!res.ok) {
          throw new Error(payload?.detail || payload?.message || `Sync failed for ${providerName}`)
        }
        results.push({
          provider: providerName,
          message: payload?.message || `${providerName} sync completed`,
          added: Array.isArray(payload?.added) ? payload.added.length : Number(payload?.added_count || 0),
        })
      }
      await fetchProviderInventory()
      await fetchRuntimeStatus()
      await fetchProviderHealth()
      addToast({
        type: 'success',
        title: `${title} test completed`,
        message: results.map((result) => `${result.provider}: ${result.message}`).join(' '),
        autoClose: 7000,
      })
    } catch (e: any) {
      addToast({
        type: 'error',
        title: `${title} test failed`,
        message: e.message || 'Provider sync failed.',
        autoClose: 7000,
      })
    } finally {
      setProviderActionBusy((current) => ({ ...current, [actionKey]: false }))
    }
  }

  const healthBadgeClass = (status: string) => {
    if (status === 'ok') return 'bg-emerald-100 text-emerald-800 border-emerald-200'
    if (status === 'degraded') return 'bg-amber-100 text-amber-800 border-amber-200'
    if (status === 'failed') return 'bg-rose-100 text-rose-800 border-rose-200'
    return 'bg-slate-100 text-slate-700 border-slate-200'
  }

  return (
    <div className="space-y-4">
      <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 text-sm text-slate-700">
        <strong>Provider setup lives here.</strong> Each card below shows the supported connection methods for that provider,
        which method is recommended, and what is currently blocking it. Changes are hot-reloaded, so you do not need to restart the app after connecting a provider.
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-900">Provider health status</h3>
          <button
            type="button"
            onClick={() => fetchProviderHealth()}
            disabled={providerHealthLoading}
            className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {providerHealthLoading ? 'Refreshing…' : 'Refresh health'}
          </button>
        </div>
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {(Object.keys(PROVIDER_META) as ProviderSlug[]).map((provider) => {
            const health = providerHealth[provider]
            const healthStatus = health?.health_status || 'unknown'
            const credential = health?.credential_status || 'unchecked'
            const connectivity = health?.connectivity_status || 'unchecked'
            return (
              <div key={`health-${provider}`} className="rounded border border-slate-200 p-3 text-xs text-slate-700">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="font-medium text-slate-900">{PROVIDER_META[provider].label}</span>
                  <span className={`rounded border px-2 py-0.5 ${healthBadgeClass(healthStatus)}`}>{healthStatus}</span>
                </div>
                <div className="space-y-1">
                  <div>Credential: <span className="font-medium">{credential}</span></div>
                  <div>Connectivity: <span className="font-medium">{connectivity}</span></div>
                  {health?.last_checked_at && (
                    <div className="text-[11px] text-slate-500">Last check: {new Date(health.last_checked_at).toLocaleString()}</div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <div className={`rounded-xl border p-4 ${anthropicReady ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-white'}`}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-slate-900">Anthropic</p>
              <p className="mt-1 text-xs text-slate-600">Claude models connect through an API key.</p>
            </div>
            <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${anthropicReady ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
              {anthropicReady ? 'Connected' : 'Needs API key'}
            </span>
          </div>
          <p className="mt-3 text-xs text-slate-700"><strong>Methods:</strong> API key</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer" className="text-xs px-2 py-1 rounded border border-orange-300 hover:bg-orange-50 text-orange-700 font-medium">Get key ↗</a>
            <button onClick={() => openProviderEditor('anthropic')} className="text-xs px-2 py-1 rounded border border-slate-300 hover:bg-slate-50 text-slate-700">{anthropicReady ? 'Connect' : 'Set key'}</button>
            <button onClick={() => diagnoseProvider('anthropic')} className="text-xs px-2 py-1 rounded border border-slate-300 hover:bg-slate-50 text-slate-700">Diagnose</button>
            <button disabled={providerActionBusy.anthropic} onClick={() => testProviderConnection('anthropic', ['anthropic'], 'Anthropic')} className="text-xs px-2 py-1 rounded border border-slate-300 hover:bg-slate-50 text-slate-700 disabled:opacity-50">{providerActionBusy.anthropic ? 'Testing…' : 'Test'}</button>
          </div>
        </div>

        <div className={`rounded-xl border p-4 ${googleReady ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-white'}`}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-slate-900">Google / Gemini</p>
              <p className="mt-1 text-xs text-slate-600">Gemini models connect through a Google AI Studio API key.</p>
            </div>
            <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${googleReady ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
              {googleReady ? 'Connected' : 'Needs API key'}
            </span>
          </div>
          <p className="mt-3 text-xs text-slate-700"><strong>Methods:</strong> API key</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" className="text-xs px-2 py-1 rounded border border-blue-300 hover:bg-blue-50 text-blue-700 font-medium">Get key ↗</a>
            <button onClick={() => openProviderEditor('google')} className="text-xs px-2 py-1 rounded border border-slate-300 hover:bg-slate-50 text-slate-700">{googleReady ? 'Connect' : 'Set key'}</button>
            <button onClick={() => diagnoseProvider('google')} className="text-xs px-2 py-1 rounded border border-slate-300 hover:bg-slate-50 text-slate-700">Diagnose</button>
            <button disabled={providerActionBusy.google} onClick={() => testProviderConnection('google', ['google'], 'Google / Gemini')} className="text-xs px-2 py-1 rounded border border-slate-300 hover:bg-slate-50 text-slate-700 disabled:opacity-50">{providerActionBusy.google ? 'Testing…' : 'Test'}</button>
          </div>
        </div>

        <div className={`rounded-xl border p-4 ${openRouterReady ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-white'}`}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-slate-900">OpenRouter</p>
              <p className="mt-1 text-xs text-slate-600">Use one OpenRouter connection to access many upstream providers.</p>
            </div>
            <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${openRouterReady ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
              {openRouterReady ? 'Connected' : 'Needs connection'}
            </span>
          </div>
          <p className="mt-3 text-xs text-slate-700"><strong>Methods:</strong> OpenRouter OAuth (recommended), API key</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button onClick={connectOpenRouter} className="text-xs px-2 py-1 rounded border border-purple-300 hover:bg-purple-50 text-purple-700 font-medium">{openRouterReady ? 'Reconnect with OAuth' : 'Connect with OAuth'}</button>
            <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer" className="text-xs px-2 py-1 rounded border border-slate-300 hover:bg-slate-50 text-slate-700">Use API key instead ↗</a>
            <button onClick={() => diagnoseProvider('openrouter')} className="text-xs px-2 py-1 rounded border border-slate-300 hover:bg-slate-50 text-slate-700">Diagnose</button>
            <button disabled={providerActionBusy.openrouter} onClick={() => testProviderConnection('openrouter', ['openrouter'], 'OpenRouter')} className="text-xs px-2 py-1 rounded border border-slate-300 hover:bg-slate-50 text-slate-700 disabled:opacity-50">{providerActionBusy.openrouter ? 'Testing…' : 'Test'}</button>
          </div>
        </div>

        <div className={`rounded-xl border p-4 ${openAiReady ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-white'}`}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-slate-900">OpenAI / Codex</p>
              <p className="mt-1 text-xs text-slate-600">OpenAI models can use a standard API key or a Codex OAuth session when one is available on this machine.</p>
            </div>
            <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${openAiReady ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
              {openAiReady ? 'Connected' : 'Needs connection'}
            </span>
          </div>
          <p className="mt-3 text-xs text-slate-700"><strong>Methods:</strong> OpenAI API key, Codex CLI OAuth, optional custom HTTP proxy</p>
          <div className="mt-2 text-xs text-slate-600">
            {runtimeStatus?.openai_oauth.usability_summary || 'No OpenAI credential is connected yet.'}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button onClick={() => openProviderEditor('openai')} className="text-xs px-2 py-1 rounded border border-green-300 hover:bg-green-50 text-green-700 font-medium">{keyByProvider.openai?.is_set ? 'Connect' : 'Set API key'}</button>
            <button onClick={launchCodexCliLogin} className="text-xs px-2 py-1 rounded border border-slate-300 hover:bg-slate-50 text-slate-700">{runtimeStatus?.openai_oauth.auth_ready ? 'Reconnect Codex OAuth' : 'Connect Codex OAuth'}</button>
            <button onClick={() => openProviderEditor('codex-proxy')} className="text-xs px-2 py-1 rounded border border-slate-300 hover:bg-slate-50 text-slate-700">Set custom proxy</button>
            <button onClick={() => diagnoseProvider('openai')} className="text-xs px-2 py-1 rounded border border-slate-300 hover:bg-slate-50 text-slate-700">Diagnose</button>
            <button disabled={providerActionBusy.openai} onClick={() => testProviderConnection('openai', ['openai', 'openai-codex'], 'OpenAI / Codex')} className="text-xs px-2 py-1 rounded border border-slate-300 hover:bg-slate-50 text-slate-700 disabled:opacity-50">{providerActionBusy.openai ? 'Testing…' : 'Test'}</button>
          </div>
        </div>

        <div className={`rounded-xl border p-4 ${githubReady ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-white'} xl:col-span-2`}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-slate-900">GitHub Copilot</p>
              <p className="mt-1 text-xs text-slate-600">Use the Copilot device flow for the most reliable model catalog. GitHub OAuth and CLI import are available as alternate paths.</p>
            </div>
            <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${githubReady ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
              {githubReady ? 'Connected' : 'Needs connection'}
            </span>
          </div>
          <p className="mt-3 text-xs text-slate-700"><strong>Methods:</strong> Copilot device flow (recommended), GitHub OAuth, GitHub CLI import</p>
          <div className="mt-2 text-xs text-slate-600">
            {runtimeStatus?.github_copilot.usable
              ? 'The current token passed a live Copilot probe.'
              : runtimeStatus?.github_copilot.validation_error || 'No live Copilot token is connected yet.'}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button onClick={startCopilotDeviceFlow} className="text-xs px-2 py-1 rounded border border-emerald-400 hover:bg-emerald-50 text-emerald-800 font-semibold">Sign in to Copilot</button>
            <button onClick={connectGitHubOAuth} className="text-xs px-2 py-1 rounded border border-slate-300 hover:bg-slate-50 text-slate-700">GitHub OAuth</button>
            <button onClick={importGitHubFromCli} className="text-xs px-2 py-1 rounded border border-slate-300 hover:bg-slate-50 text-slate-700">Import from GitHub CLI</button>
            <button onClick={() => diagnoseProvider('github-copilot')} className="text-xs px-2 py-1 rounded border border-slate-300 hover:bg-slate-50 text-slate-700">Diagnose</button>
            <button disabled={providerActionBusy['github-copilot']} onClick={() => testProviderConnection('github-copilot', ['github-copilot'], 'GitHub Copilot')} className="text-xs px-2 py-1 rounded border border-slate-300 hover:bg-slate-50 text-slate-700 disabled:opacity-50">{providerActionBusy['github-copilot'] ? 'Testing…' : 'Test'}</button>
          </div>
        </div>
      </div>

      {runtimeStatus?.github_copilot.has_token && !runtimeStatus.github_copilot.usable && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <strong>Copilot visibility warning:</strong> A token is present, but live Copilot verification failed. Model discovery may be incomplete until a Copilot-compatible bearer token is configured.
        </div>
      )}

      {runtimeStatus?.openai_oauth.auth_ready && !runtimeStatus.openai_oauth.usable && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <strong>OpenAI / Codex still needs one more step:</strong> {runtimeStatus.openai_oauth.recommended_action || runtimeStatus.openai_oauth.usability_summary}
        </div>
      )}

      {runtimeStatus && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className={`rounded-lg border p-4 text-sm ${runtimeStatus.openai_oauth.has_openai_api_key ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-slate-200 bg-slate-50 text-slate-900'}`}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold">OpenAI / Codex Runtime</p>
                <p className={`mt-1 text-sm ${runtimeStatus.openai_oauth.has_openai_api_key ? 'text-emerald-800/80' : 'text-slate-600'}`}>
                  {runtimeStatus.openai_oauth.usability_summary}
                </p>
              </div>
              <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${codexRuntimeBadge?.className || 'bg-amber-100 text-amber-800'}`}>
                {codexRuntimeBadge?.label || 'Needs setup'}
              </span>
            </div>
            <div className="mt-3 space-y-1 text-xs text-slate-700">
              <div><span className={runtimeStatus.openai_oauth.has_openai_api_key ? 'text-emerald-700 font-medium' : 'text-red-600 font-medium'}>
                {runtimeStatus.openai_oauth.has_openai_api_key ? '✓' : '✗'} OpenAI API key (OPENAI_API_KEY):
              </span> {runtimeStatus.openai_oauth.has_openai_api_key ? 'set — model routing enabled' : 'not set — OAuth can still be used if a Codex session is available'}</div>
              <div><span className={runtimeStatus.openai_oauth.has_access_token ? 'text-emerald-700 font-medium' : 'text-slate-500 font-medium'}>
                {runtimeStatus.openai_oauth.has_access_token ? '✓' : '•'} Codex OAuth access token:
              </span> {runtimeStatus.openai_oauth.has_access_token ? (runtimeStatus.openai_oauth.masked_access_token || 'present') : 'missing'}</div>
              <div>Codex CLI: {runtimeStatus.openai_oauth.codex_cli_installed
                ? (runtimeStatus.openai_oauth.codex_cli_logged_in
                  ? <span className="text-blue-700">installed and logged in</span>
                  : 'installed but not logged in')
                : 'not installed'}</div>
              {runtimeStatus.openai_oauth.usable && runtimeStatus.openai_oauth.has_access_token && !runtimeStatus.openai_oauth.has_openai_api_key && (
                <div className="text-emerald-700 font-medium">✓ OAuth routing is available even without an OpenAI API key.</div>
              )}
              {runtimeStatus.openai_oauth.proxy_env_override && (
                <div>Proxy: {runtimeStatus.openai_oauth.proxy_reachable ? `online at ${runtimeStatus.openai_oauth.proxy_base_url}` : `offline at ${runtimeStatus.openai_oauth.proxy_base_url}`}</div>
              )}
              {runtimeStatus.openai_oauth.recommended_action && (
                <div className="text-[11px] text-amber-800 mt-1">Next step: {runtimeStatus.openai_oauth.recommended_action}</div>
              )}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {!runtimeStatus.openai_oauth.has_openai_api_key && (
                <a
                  href="https://platform.openai.com/api-keys"
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs px-2 py-1 rounded border border-blue-300 hover:bg-blue-50 text-blue-700 font-medium">
                  Get OpenAI API Key ↗
                </a>
              )}
              <button
                onClick={launchCodexCliLogin}
                className="text-xs px-2 py-1 rounded border border-slate-300 hover:bg-slate-100 text-slate-700">
                {runtimeStatus.openai_oauth.codex_cli_logged_in ? 'Reconnect Codex OAuth' : 'Connect Codex OAuth'}
              </button>
              <button
                onClick={fetchRuntimeStatus}
                className="text-xs px-2 py-1 rounded border border-slate-200 hover:bg-slate-100 text-slate-600">
                Refresh status
              </button>
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-900">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold">GitHub Copilot Runtime</p>
                <p className="mt-1 text-slate-700">
                  {runtimeStatus.github_copilot.usable
                    ? 'GitHub token is present and passed a live Copilot API probe.'
                    : runtimeStatus.github_copilot.has_token
                    ? 'GitHub token is present, but the live Copilot probe failed.'
                    : 'No GitHub token is available yet. Add one here or on a collaboration user.'}
                </p>
              </div>
              <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${runtimeStatus.github_copilot.usable ? 'bg-slate-200 text-slate-800' : 'bg-amber-100 text-amber-800'}`}>
                {runtimeStatus.github_copilot.usable ? 'Live verified' : runtimeStatus.github_copilot.has_token ? 'Needs attention' : 'Missing token'}
              </span>
            </div>
            <div className="mt-3 space-y-1 text-xs text-slate-700">
              <div>Token: {runtimeStatus.github_copilot.has_token ? (runtimeStatus.github_copilot.masked_token || 'present') : 'missing'}</div>
              <div>Source: {
                runtimeStatus.github_copilot.source === 'collaboration_user'
                  ? 'Collaboration user token'
                  : runtimeStatus.github_copilot.source === 'env_github_copilot_token'
                  ? 'GITHUB_COPILOT_TOKEN'
                  : runtimeStatus.github_copilot.source === 'env_github_token'
                  ? 'GITHUB_TOKEN'
                  : 'None'
              }</div>
              <div>Users with GitHub token: {runtimeStatus.github_copilot.collaboration_user_count}</div>
              <div>OAuth app: {runtimeStatus.github_copilot.oauth_configured ? 'configured' : 'not configured'}</div>
              <div>Live probe: {runtimeStatus.github_copilot.live_verified ? 'passed' : 'not verified'}</div>
              {runtimeStatus.github_copilot.validation_error && (
                <div className="text-[11px] text-slate-600">Probe detail: {runtimeStatus.github_copilot.validation_error}</div>
              )}
            </div>
            {runtimeStatus.github_copilot.has_token && !runtimeStatus.github_copilot.usable && runtimeStatus.github_copilot.has_copilot_scope === false && (
              <div className="mt-3 rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
                <strong>Limited model access:</strong> Your GitHub token is missing the <code>copilot</code> scope, so only basic GPT models are currently live-verified. Click <strong>Sign in to Copilot (device flow)</strong> below — that is the only flow that can grant this scope and unlock the full catalog (Claude, Gemini, o3, etc.).
              </div>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                onClick={startCopilotDeviceFlow}
                title="Sign in using the official GitHub Copilot OAuth client. This is the only flow whose token can call the Copilot API."
                className="text-xs px-2 py-1 rounded border border-emerald-400 hover:bg-emerald-100 text-emerald-800 font-semibold">
                Sign in to Copilot (device flow)
              </button>
              <button
                onClick={connectGitHubOAuth}
                className="text-xs px-2 py-1 rounded border border-slate-300 hover:bg-slate-100 text-slate-800 font-medium">
                {runtimeStatus.github_copilot.has_token ? 'Reconnect GitHub OAuth' : 'Connect with GitHub OAuth'}
              </button>
              <button
                onClick={importGitHubFromCli}
                title='Imports a token from "gh auth token" (does NOT work for Copilot — kept for git push only).'
                className="text-xs px-2 py-1 rounded border border-slate-300 hover:bg-slate-100 text-slate-700">
                Import from GitHub CLI
              </button>
              <button
                onClick={fetchRuntimeStatus}
                className="text-xs px-2 py-1 rounded border border-slate-200 hover:bg-slate-100 text-slate-600">
                Refresh status
              </button>
            </div>
            {copilotDevice && (
              <div className="mt-3 rounded border border-emerald-300 bg-white p-3 text-xs text-slate-800">
                {copilotDevice.status === 'pending' && (
                  <>
                    <div className="font-semibold text-emerald-800">Waiting for GitHub authorization…</div>
                    <div className="mt-1">1. Open <a href={copilotDevice.verification_uri} target="_blank" rel="noreferrer" className="underline text-emerald-700">{copilotDevice.verification_uri}</a></div>
                    <div>2. Enter this code (already copied to clipboard):</div>
                    <div className="mt-1 font-mono text-lg tracking-widest text-emerald-900 select-all">{copilotDevice.user_code}</div>
                  </>
                )}
                {copilotDevice.status === 'ok' && (
                  <div className="text-emerald-800 font-semibold">✓ Copilot connected. Refreshing model list…</div>
                )}
                {copilotDevice.status === 'error' && (
                  <div className="text-rose-700">Device flow failed: {copilotDevice.error}</div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {keys.map((key) => {
        const meta = PROVIDER_META[key.provider]
        const isEditing = key.provider in editing
        const inventory = providerInventory[key.provider]
        const canRemoveProvider = key.provider !== 'openai-oauth' && (key.is_set || Boolean(inventory?.is_active) || (inventory?.active_model_count || 0) > 0)
        return (
          <div key={key.provider} className="bg-white shadow sm:rounded-lg overflow-hidden">
            <div className="px-4 py-4 sm:px-6">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-3">
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${meta?.color || 'bg-gray-100 text-gray-800'}`}>
                    {meta?.label || key.provider}
                  </span>
                  <code className="text-xs text-gray-400 font-mono">{key.env_var}</code>
                  {key.is_set
                    ? <span className="text-xs text-green-600 font-medium">✓ Set</span>
                    : <span className="text-xs text-red-500 font-medium">✗ Not set</span>
                  }
                  {inventory && inventory.active_model_count > 0 && (
                    <span className="text-xs text-gray-500 font-medium">{inventory.active_model_count} active models</span>
                  )}
                  {saved[key.provider] && <span className="text-xs text-green-600 animate-pulse">Saved!</span>}
                </div>
                <div className="flex items-center gap-2">
                  {meta?.link && (
                    <a href={meta.link} target="_blank" rel="noreferrer"
                      className="text-xs text-indigo-500 hover:text-indigo-700 underline">
                      Get key ↗
                    </a>
                  )}
                  {!isEditing && key.provider === 'openrouter' && (
                    <button
                      onClick={connectOpenRouter}
                      className="text-xs px-2 py-1 rounded border border-purple-300 hover:bg-purple-50 text-purple-700 font-medium">
                      {key.is_set ? 'Reconnect with OAuth' : '🔗 Connect with OAuth'}
                    </button>
                  )}
                  {!isEditing && key.provider === 'github-copilot' && (
                    <button
                      onClick={connectGitHubOAuth}
                      className="text-xs px-2 py-1 rounded border border-slate-300 hover:bg-slate-50 text-slate-700 font-medium">
                      {key.is_set ? 'Reconnect GitHub OAuth' : 'Connect GitHub OAuth'}
                    </button>
                  )}
                  {!isEditing && key.provider === 'openai-oauth' && (
                    <>
                      <a
                        href="https://platform.openai.com/api-keys"
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs px-2 py-1 rounded border border-blue-300 hover:bg-blue-50 text-blue-700 font-medium">
                        Get OpenAI API Key ↗
                      </a>
                      <button
                        onClick={launchCodexCliLogin}
                        className="text-xs px-2 py-1 rounded border border-slate-300 hover:bg-slate-50 text-slate-600"
                        title="Authenticates the standalone codex CLI tool — not required for DevForgeAI model routing">
                        Codex CLI Login (standalone)
                      </button>
                    </>
                  )}
                  {!isEditing && (
                    <button
                      onClick={() => setEditing(e => ({ ...e, [key.provider]: '' }))}
                      className="text-xs px-2 py-1 rounded border border-gray-200 hover:bg-gray-50 text-gray-600">
                      {key.is_set ? 'Update' : 'Set Key'}
                    </button>
                  )}
                  {canRemoveProvider && !isEditing && (
                    <button onClick={() => clearKey(key.provider)}
                      className="text-xs px-2 py-1 rounded border border-red-200 hover:bg-red-50 text-red-500">
                      Remove Provider
                    </button>
                  )}
                </div>
              </div>

              {key.is_set && !isEditing && (
                <div className="mt-2 font-mono text-sm text-gray-500">{key.masked_value}</div>
              )}
              {!key.is_set && inventory?.is_active && inventory.active_model_count > 0 && (
                <div className="mt-2 text-xs text-amber-600">
                  This provider still has active models in the catalog. Remove Provider to deactivate them.
                </div>
              )}

              {isEditing && (
                <div className="mt-3 space-y-2">
                  <input
                    type="password"
                    autoComplete="off"
                    placeholder={meta?.placeholder || 'Paste your API key…'}
                    value={editing[key.provider] || ''}
                    onChange={e => setEditing(prev => ({ ...prev, [key.provider]: e.target.value }))}
                    onKeyDown={e => e.key === 'Enter' && saveKey(key.provider)}
                    className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 font-mono text-sm"
                  />
                  {errors[key.provider] && (
                    <p className="text-xs text-red-500">{errors[key.provider]}</p>
                  )}
                  <div className="flex gap-2">
                    <button
                      onClick={() => saveKey(key.provider)}
                      disabled={saving[key.provider] || !editing[key.provider]?.trim()}
                      className="px-3 py-1.5 text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-300">
                      {saving[key.provider] ? 'Saving…' : 'Save'}
                    </button>
                    <button
                      onClick={() => setEditing(e => { const n = { ...e }; delete n[key.provider]; return n })}
                      className="px-3 py-1.5 text-sm font-medium rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50">
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )
      })}

      {/* Clear-key impact dialog */}
      {clearImpact && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-2xl bg-white dark:bg-gray-900 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800">
              <h2 className="text-base font-semibold text-gray-900 dark:text-white">
                ⚠️ Clearing {PROVIDER_META[clearImpact.provider]?.label || clearImpact.provider} key will affect other records
              </h2>
              <p className="text-xs text-gray-500 mt-1">
                {clearImpact.affected_models.length} model(s) will be deactivated. Pick replacements for {clearImpact.affected_personas.length + clearImpact.affected_agents.length} reference(s) below.
              </p>
            </div>
            <div className="px-6 py-5 overflow-y-auto flex-1 space-y-5">
              {/* Personas */}
              {clearImpact.affected_personas.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-2">Affected Personas</h3>
                  <div className="space-y-2">
                    {clearImpact.affected_personas.map((p, i) => {
                      const affectedModel = clearImpact.affected_models.find(m => m.id === p.current_model_id)
                      return (
                        <div key={`${p.id}-${p.slot}-${i}`} className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-sm font-medium text-gray-900 dark:text-white">
                              {p.name} <span className="text-xs text-gray-500 font-normal">({p.slot} model)</span>
                            </span>
                            <span className="text-xs text-gray-500 line-through">{affectedModel?.display_name || affectedModel?.model_id}</span>
                          </div>
                          <select
                            value={replacements[p.current_model_id] || ''}
                            onChange={e => setReplacements(r => ({ ...r, [p.current_model_id]: e.target.value }))}
                            className="w-full rounded-md border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white px-2 py-1.5 text-xs"
                          >
                            <option value="">— Leave empty (will be set to None) —</option>
                            {clearImpact.replacement_candidates.map(c => (
                              <option key={c.id} value={c.id}>{c.provider_name} / {c.display_name || c.model_id}</option>
                            ))}
                          </select>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Agents */}
              {clearImpact.affected_agents.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-2">Affected Agents</h3>
                  <div className="space-y-2">
                    {clearImpact.affected_agents.map(a => {
                      const affectedModel = clearImpact.affected_models.find(m => m.id === a.current_model_id)
                      return (
                        <div key={a.id} className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-sm font-medium text-gray-900 dark:text-white">{a.name}</span>
                            <span className="text-xs text-gray-500 line-through">{affectedModel?.display_name || affectedModel?.model_id}</span>
                          </div>
                          <select
                            value={replacements[a.current_model_id] || ''}
                            onChange={e => setReplacements(r => ({ ...r, [a.current_model_id]: e.target.value }))}
                            className="w-full rounded-md border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white px-2 py-1.5 text-xs"
                          >
                            <option value="">— Leave empty (will be set to None) —</option>
                            {clearImpact.replacement_candidates.map(c => (
                              <option key={c.id} value={c.id}>{c.provider_name} / {c.display_name || c.model_id}</option>
                            ))}
                          </select>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {clearImpact.replacement_candidates.length === 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
                  No replacement models available from other providers. You can still clear the key — references will be set to None and you'll need to reassign models manually later.
                </div>
              )}
            </div>
            <div className="px-6 py-4 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between gap-3">
              <button
                onClick={() => { setClearImpact(null); setReplacements({}) }}
                className="px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => confirmClearWithReplacements(true)}
                  disabled={clearing}
                  className="px-3 py-2 text-xs font-medium rounded-lg border border-red-300 text-red-600 hover:bg-red-50 disabled:opacity-50"
                >
                  Clear anyway (set refs to None)
                </button>
                <button
                  onClick={() => confirmClearWithReplacements(false)}
                  disabled={clearing}
                  className="px-4 py-2 text-sm font-medium rounded-lg bg-orange-500 hover:bg-orange-600 text-white disabled:bg-gray-300"
                >
                  {clearing ? 'Applying...' : 'Apply Replacements & Clear'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
