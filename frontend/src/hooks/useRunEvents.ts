'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { listEvents } from '@/lib/runs/api'
import { subscribe, type StreamFrame } from '@/lib/runs/runStream'
import { normalizeEvent } from '@/lib/runs/eventContract'
import type { RunEventSummary } from '@/lib/runs/types'

export function useRunEvents(
  runId: string | null,
  params: { phaseId?: string } = {},
) {
  const [events, setEvents] = useState<RunEventSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const seenIds = useRef(new Set<string>())
  const paramsRef = useRef(params)
  paramsRef.current = params

  const refresh = useCallback(async () => {
    if (!runId) return
    try {
      const data = await listEvents(runId, {
        phase_id: paramsRef.current.phaseId,
      })
      seenIds.current = new Set(data.map((e) => e.id))
      setEvents(data)
      setError(null)
    } catch (err: any) {
      setError(err.message ?? 'Failed to fetch events')
    } finally {
      setLoading(false)
    }
  }, [runId])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    if (!runId) return

    const unsub = subscribe(runId, (frame: StreamFrame) => {
      if (frame.type !== 'run_event') return
      const normalized = normalizeEvent(frame.data)
      if (!normalized || seenIds.current.has(normalized.id)) return

      if (paramsRef.current.phaseId && normalized.phase_id !== paramsRef.current.phaseId) return

      seenIds.current.add(normalized.id)
      setEvents((prev) => [...prev, normalized])
    })

    return unsub
  }, [runId])

  return { events, loading, error, refresh }
}
