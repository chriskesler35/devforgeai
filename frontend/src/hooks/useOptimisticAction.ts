'use client'

import { useCallback, useState } from 'react'
import { useToast } from '@/app/ToastProvider'

// ---------------------------------------------------------------------------
// Single-action variant (original) — one boolean busy state.
// ---------------------------------------------------------------------------

interface UseOptimisticActionResult {
  busy: boolean
  run: (action: () => Promise<unknown>, label: string) => Promise<void>
}

export function useOptimisticAction(onSuccess?: () => void): UseOptimisticActionResult {
  const { addToast } = useToast()
  const [busy, setBusy] = useState(false)

  const run = useCallback(
    async (action: () => Promise<unknown>, label: string) => {
      setBusy(true)
      try {
        await action()
        onSuccess?.()
      } catch (err: any) {
        addToast({
          type: 'error',
          title: `${label} failed`,
          message: err.message ?? 'Unknown error',
          autoClose: 5000,
        })
      } finally {
        setBusy(false)
      }
    },
    [onSuccess, addToast],
  )

  return { busy, run }
}

// ---------------------------------------------------------------------------
// Keyed variant — tracks busy state per key (e.g. per run ID in NowGrid).
// Multiple items can be in-flight simultaneously.
// ---------------------------------------------------------------------------

interface UseKeyedOptimisticActionResult {
  isBusy: (key: string) => boolean
  run: (key: string, action: () => Promise<unknown>, label: string) => Promise<void>
}

export function useKeyedOptimisticAction(onSuccess?: () => void): UseKeyedOptimisticActionResult {
  const { addToast } = useToast()
  const [busyKeys, setBusyKeys] = useState<Set<string>>(new Set())

  const isBusy = useCallback((key: string) => busyKeys.has(key), [busyKeys])

  const run = useCallback(
    async (key: string, action: () => Promise<unknown>, label: string) => {
      setBusyKeys((prev) => new Set(prev).add(key))
      try {
        await action()
        onSuccess?.()
      } catch (err: any) {
        addToast({
          type: 'error',
          title: `${label} failed`,
          message: err.message ?? 'Unknown error',
          autoClose: 5000,
        })
      } finally {
        setBusyKeys((prev) => {
          const next = new Set(prev)
          next.delete(key)
          return next
        })
      }
    },
    [onSuccess, addToast],
  )

  return { isBusy, run }
}
