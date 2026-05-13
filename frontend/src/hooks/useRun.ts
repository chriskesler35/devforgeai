'use client'

import { useCallback, useEffect, useReducer, useRef } from 'react'
import { getRun } from '@/lib/runs/api'
import { subscribe, type StreamFrame } from '@/lib/runs/runStream'
import { normalizeEvent } from '@/lib/runs/eventContract'
import type { Run, RunPhase, RunMessage, RunEventSummary, RunDetail } from '@/lib/runs/types'

interface State {
  run: Run | null
  phases: RunPhase[]
  messages: RunMessage[]
  events: RunEventSummary[]
  loading: boolean
  error: string | null
  reconnecting: boolean
}

type Action =
  | { type: 'loaded'; data: RunDetail }
  | { type: 'error'; message: string }
  | { type: 'event'; event: RunEventSummary }
  | { type: 'message'; message: RunMessage }
  | { type: 'state_change'; state: Run['state'] }
  | { type: 'reconnecting'; value: boolean }

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'loaded':
      return {
        ...state,
        run: action.data,
        phases: action.data.phases,
        messages: action.data.messages,
        events: action.data.events,
        loading: false,
        error: null,
      }
    case 'error':
      return { ...state, loading: false, error: action.message }
    case 'event': {
      const exists = state.events.some((e) => e.id === action.event.id)
      if (exists) return state
      return { ...state, events: [...state.events, action.event] }
    }
    case 'message': {
      const exists = state.messages.some((m) => m.id === action.message.id)
      if (exists) return state
      return { ...state, messages: [...state.messages, action.message] }
    }
    case 'state_change':
      return state.run
        ? { ...state, run: { ...state.run, state: action.state } }
        : state
    case 'reconnecting':
      return { ...state, reconnecting: action.value }
    default:
      return state
  }
}

const INITIAL: State = {
  run: null,
  phases: [],
  messages: [],
  events: [],
  loading: true,
  error: null,
  reconnecting: false,
}

export function useRun(runId: string | null) {
  const [state, dispatch] = useReducer(reducer, INITIAL)
  const runIdRef = useRef(runId)
  runIdRef.current = runId

  const refresh = useCallback(async () => {
    if (!runIdRef.current) return
    try {
      const data = await getRun(runIdRef.current)
      dispatch({ type: 'loaded', data })
    } catch (err: any) {
      dispatch({ type: 'error', message: err.message ?? 'Failed to load run' })
    }
  }, [])

  useEffect(() => {
    if (!runId) return
    refresh()

    const unsub = subscribe(runId, (frame: StreamFrame) => {
      if (frame.type === 'reconnecting') {
        dispatch({ type: 'reconnecting', value: true })
        return
      }
      dispatch({ type: 'reconnecting', value: false })

      if (frame.type === 'run_event') {
        const normalized = normalizeEvent(frame.data)
        if (normalized) dispatch({ type: 'event', event: normalized })
      } else if (frame.type === 'run_message') {
        dispatch({
          type: 'message',
          message: frame.data as unknown as RunMessage,
        })
      }
    })

    return unsub
  }, [runId, refresh])

  return { ...state, refresh }
}
