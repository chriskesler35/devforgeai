'use client'

/**
 * Runs a one-time backend port probe on app startup so the correct API base
 * URL is cached in sessionStorage before any API calls are made.
 *
 * Handles the scenario where a stale backend process occupies the primary port
 * (19001) but is missing newer routes — the probe finds the healthy port
 * (19000) and all subsequent getApiBase() calls return the correct URL.
 */

import { useEffect } from 'react'
import { probeAndCacheApiBase } from '@/lib/config'
import { syncModelCatalogIfVersionChanged, syncModelCatalogOnStartup } from '@/lib/modelCatalog'

export default function BackendProbe() {
  useEffect(() => {
    probeAndCacheApiBase().catch(() => { /* silent — fallback already set */ })
    syncModelCatalogOnStartup().catch(() => { /* silent — cache is opportunistic */ })

    const interval = window.setInterval(() => {
      syncModelCatalogIfVersionChanged().catch(() => { /* silent */ })
    }, 60_000)

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        syncModelCatalogIfVersionChanged().catch(() => { /* silent */ })
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [])
  return null
}
