'use client'

import { useCallback, useState } from 'react'
import { patchRun } from '@/lib/runs/api'
import { useToast } from '@/app/ToastProvider'

interface Props {
  runId: string
  enabled: boolean
  onToggled: () => void
}

export default function PowerToolsToggle({ runId, enabled, onToggled }: Props) {
  const { addToast } = useToast()
  const [busy, setBusy] = useState(false)

  const toggle = useCallback(async () => {
    setBusy(true)
    try {
      await patchRun(runId, { power_tools_enabled: !enabled })
      onToggled()
    } catch (err: any) {
      addToast({
        type: 'error',
        title: 'Failed to toggle power tools',
        message: err.message,
        autoClose: 4000,
      })
    } finally {
      setBusy(false)
    }
  }, [runId, enabled, onToggled, addToast])

  return (
    <button
      onClick={toggle}
      disabled={busy}
      title={enabled ? 'Power tools enabled — click to disable' : 'Power tools disabled — click to enable'}
      className={`flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-md transition-colors ${
        enabled
          ? 'bg-orange-100 dark:bg-orange-900/20 text-orange-700 dark:text-orange-400'
          : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
      } ${busy ? 'opacity-50' : 'hover:bg-orange-200 dark:hover:bg-orange-900/30'}`}
    >
      <span className="text-sm">{enabled ? '⚡' : '⚙'}</span>
      Power tools
    </button>
  )
}
