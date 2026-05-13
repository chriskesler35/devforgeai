import { getApiBase } from '@/lib/config'

export type StreamFrame =
  | { type: 'run_event'; data: Record<string, unknown> }
  | { type: 'run_message'; data: Record<string, unknown> }
  | { type: 'reconnecting'; attempt: number }

export type StreamHandler = (frame: StreamFrame) => void

const MAX_BACKOFF_MS = 30_000
const INITIAL_BACKOFF_MS = 1_000

export function subscribe(runId: string, handler: StreamHandler): () => void {
  let es: EventSource | null = null
  let attempt = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  let stopped = false

  function connect() {
    if (stopped) return
    const url = `${getApiBase()}/v1/runs/${runId}/stream`
    es = new EventSource(url)

    es.onopen = () => {
      attempt = 0
    }

    es.onmessage = (ev) => {
      if (stopped) return
      try {
        const frame = JSON.parse(ev.data) as StreamFrame
        handler(frame)
      } catch {
        // malformed frame — skip
      }
    }

    es.onerror = () => {
      es?.close()
      es = null
      if (stopped) return
      attempt++
      const delay = Math.min(INITIAL_BACKOFF_MS * 2 ** (attempt - 1), MAX_BACKOFF_MS)
      handler({ type: 'reconnecting', attempt })
      timer = setTimeout(connect, delay)
    }
  }

  connect()

  return () => {
    stopped = true
    es?.close()
    es = null
    if (timer) clearTimeout(timer)
  }
}
