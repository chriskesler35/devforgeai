'use client'

import { useCallback, useState } from 'react'
import { useToast } from '@/app/ToastProvider'

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
