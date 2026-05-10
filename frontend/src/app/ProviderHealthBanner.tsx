'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { getApiBase, getAuthToken } from '@/lib/config'

type ProviderHealth = {
  provider_id: string
  provider_name: string
  health_status: string
  credential_status: string
  connectivity_status: string
  last_checked_at?: string | null
}

export default function ProviderHealthBanner() {
  const [providers, setProviders] = useState<ProviderHealth[]>([])
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const base = getApiBase()
        const res = await fetch(`${base}/v1/providers/health/all`, {
          signal: AbortSignal.timeout(4000),
          headers: {
            Authorization: `Bearer ${getAuthToken()}`,
          },
        })
        if (!res.ok) return
        const data = (await res.json()) as ProviderHealth[]
        if (!cancelled && Array.isArray(data)) {
          setProviders(data)
        }
      } catch {
        // Silent: this banner is opportunistic and should never block app load.
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [])

  const unhealthy = useMemo(
    () => providers.filter((p) => p.health_status === 'failed' || p.health_status === 'degraded'),
    [providers]
  )

  if (dismissed || unhealthy.length === 0) return null

  const names = unhealthy.map((p) => p.provider_name).join(', ')
  const targetProvider = unhealthy[0]?.provider_id
  const fixHref = targetProvider
    ? `/settings?tab=api-keys&provider=${encodeURIComponent(targetProvider)}`
    : '/settings?tab=api-keys'

  return (
    <div className="w-full border-b border-amber-300 bg-amber-50 text-amber-900 px-4 py-2 text-sm">
      <div className="mx-auto max-w-[1400px] flex items-center gap-3">
        <span className="font-medium">Provider health warning:</span>
        <span className="flex-1">
          {names} currently report degraded or failed status. Update provider credentials or run health checks.
        </span>
        <Link
          href={fixHref}
          className="rounded border border-amber-600 bg-amber-100 px-2 py-1 text-xs font-medium hover:bg-amber-200"
        >
          Fix credentials
        </Link>
        <button
          type="button"
          className="rounded border border-amber-500 px-2 py-1 text-xs hover:bg-amber-100"
          onClick={() => setDismissed(true)}
        >
          Dismiss
        </button>
      </div>
    </div>
  )
}
