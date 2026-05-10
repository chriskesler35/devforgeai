import { getApiBase, getAuthToken } from '@/lib/config'

const CATALOG_CACHE_KEY = 'devforge_model_catalog_v1'

export interface ModelCatalogEntry {
  model_id: string
  provider_id: string
  provider: string
  model_ref: string
  display_name: string
  verification_status: string
  capabilities: Record<string, boolean>
  limits: Record<string, number | null>
}

export interface ModelCatalog {
  source: string
  generated_at: string
  ttl_seconds: number
  version: string
  count: number
  models: ModelCatalogEntry[]
}

export interface ModelCatalogVersion {
  source: string
  generated_at: string
  ttl_seconds: number
  version: string
  count: number
}

interface CachedModelCatalog {
  cached_at_ms: number
  expires_at_ms: number
  payload: ModelCatalog
}

function readCachedCatalog(): CachedModelCatalog | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(CATALOG_CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as CachedModelCatalog
    if (!parsed?.payload || !parsed?.expires_at_ms) return null
    if (Date.now() >= parsed.expires_at_ms) {
      window.localStorage.removeItem(CATALOG_CACHE_KEY)
      return null
    }
    return parsed
  } catch {
    return null
  }
}

function writeCachedCatalog(payload: ModelCatalog): void {
  if (typeof window === 'undefined') return
  const now = Date.now()
  const ttlMs = Math.max(60, payload.ttl_seconds || 1800) * 1000
  const wrapper: CachedModelCatalog = {
    cached_at_ms: now,
    expires_at_ms: now + ttlMs,
    payload,
  }
  window.localStorage.setItem(CATALOG_CACHE_KEY, JSON.stringify(wrapper))
}

export function getCachedModelCatalog(): ModelCatalog | null {
  return readCachedCatalog()?.payload ?? null
}

export async function syncModelCatalogOnStartup(forceRefresh = false): Promise<ModelCatalog | null> {
  const existing = readCachedCatalog()
  if (existing && !forceRefresh) return existing.payload

  try {
    const base = getApiBase()
    const res = await fetch(`${base}/v1/models/catalog`, {
      signal: AbortSignal.timeout(5000),
      headers: {
        Authorization: `Bearer ${getAuthToken()}`,
      },
    })
    if (!res.ok) return null

    const payload = (await res.json()) as ModelCatalog
    if (!payload?.models || !payload?.version) return null

    writeCachedCatalog(payload)
    return payload
  } catch {
    return null
  }
}

export async function syncModelCatalogIfVersionChanged(): Promise<ModelCatalog | null> {
  const cached = readCachedCatalog()
  if (!cached) {
    return syncModelCatalogOnStartup(false)
  }

  try {
    const base = getApiBase()
    const res = await fetch(`${base}/v1/models/catalog/version`, {
      signal: AbortSignal.timeout(4000),
      headers: {
        Authorization: `Bearer ${getAuthToken()}`,
      },
    })
    if (!res.ok) return cached.payload

    const meta = (await res.json()) as ModelCatalogVersion
    if (!meta?.version) return cached.payload

    if (meta.version === cached.payload.version) {
      return cached.payload
    }

    return await syncModelCatalogOnStartup(true)
  } catch {
    return cached.payload
  }
}

export function modelSupportsFeature(modelRef: string, feature: string): boolean {
  const catalog = getCachedModelCatalog()
  if (!catalog) return false
  const match = catalog.models.find((m) => m.model_ref === modelRef)
  if (!match) return false
  return Boolean(match.capabilities?.[feature])
}

type CatalogFilterModel = {
  provider_name?: string | null
  model_id?: string | null
}

export function filterModelsByCatalogFeature<T extends CatalogFilterModel>(
  models: T[],
  feature: string,
  fallbackFeature?: string,
): T[] {
  const catalog = getCachedModelCatalog()
  if (!catalog) return models

  const byRef = new Map(
    (catalog.models || []).map((entry) => [entry.model_ref.toLowerCase(), entry]),
  )

  return models.filter((model) => {
    const provider = String(model.provider_name || '').trim().toLowerCase()
    const modelId = String(model.model_id || '').trim()
    if (!provider || !modelId) return true

    const entry = byRef.get(`${provider}/${modelId}`.toLowerCase())
    // If model isn't in cached catalog yet, keep backward-compatible behavior.
    if (!entry) return true

    if (entry.capabilities?.[feature]) return true
    if (fallbackFeature && entry.capabilities?.[fallbackFeature]) return true
    return false
  })
}
