'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { listRuns } from '@/lib/runs/api'
import type { Run } from '@/lib/runs/types'

const POLL_INTERVAL = 10_000

export function useRuns(params: {
  active?: boolean
  projectId?: string
} = {}) {
  const [runs, setRuns] = useState<Run[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const paramsRef = useRef(params)
  paramsRef.current = params

  const refresh = useCallback(async () => {
    try {
      const data = await listRuns({
        active: paramsRef.current.active,
        project_id: paramsRef.current.projectId,
      })
      setRuns(data)
      setError(null)
    } catch (err: any) {
      setError(err.message ?? 'Failed to fetch runs')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
    const id = setInterval(refresh, POLL_INTERVAL)
    return () => clearInterval(id)
  }, [refresh])

  return { runs, loading, error, refresh }
}
