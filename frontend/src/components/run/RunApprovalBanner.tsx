'use client'

import { useCallback, useState } from 'react'
import { approveRun } from '@/lib/runs/api'
import { useToast } from '@/app/ToastProvider'
import type { Run, RunEventSummary } from '@/lib/runs/types'

interface Props {
  run: Run
  gateEvent: RunEventSummary
  onRefresh: () => void
}

export default function RunApprovalBanner({ run, gateEvent, onRefresh }: Props) {
  const { addToast } = useToast()
  const [busy, setBusy] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const [editBrief, setEditBrief] = useState('')

  const act = useCallback(
    async (action: 'approve' | 'skip' | 'edit_brief') => {
      setBusy(true)
      try {
        const payload = action === 'edit_brief' ? { brief: editBrief } : undefined
        await approveRun(run.id, gateEvent.phase_id ?? '', action, payload)
        onRefresh()
        setEditMode(false)
      } catch (err: any) {
        addToast({
          type: 'error',
          title: 'Approval action failed',
          message: err.message,
          autoClose: 4000,
        })
      } finally {
        setBusy(false)
      }
    },
    [run.id, gateEvent.phase_id, editBrief, onRefresh, addToast],
  )

  return (
    <div className="rounded-lg border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-900/20 p-3">
      <p className="text-xs font-semibold text-indigo-700 dark:text-indigo-400 mb-1">
        Approval Required
      </p>
      <p className="text-xs text-indigo-600 dark:text-indigo-300 mb-3">{gateEvent.summary}</p>

      {editMode ? (
        <div className="space-y-2">
          <textarea
            value={editBrief}
            onChange={(e) => setEditBrief(e.target.value)}
            rows={3}
            className="w-full text-xs rounded-md border border-indigo-200 dark:border-indigo-700 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 px-2 py-1.5 outline-none focus:ring-1 focus:ring-indigo-400"
            placeholder="Edit the brief..."
          />
          <div className="flex gap-2">
            <button
              onClick={() => act('edit_brief')}
              disabled={busy || !editBrief.trim()}
              className="text-[11px] font-medium px-3 py-1 rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40"
            >
              Submit
            </button>
            <button
              onClick={() => setEditMode(false)}
              className="text-[11px] text-gray-500 hover:text-gray-700"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <button
            onClick={() => act('approve')}
            disabled={busy}
            className="text-[11px] font-medium px-3 py-1 rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40"
          >
            Approve
          </button>
          <button
            onClick={() => act('skip')}
            disabled={busy}
            className="text-[11px] font-medium px-3 py-1 rounded-md bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-40"
          >
            Skip
          </button>
          <button
            onClick={() => setEditMode(true)}
            disabled={busy}
            className="text-[11px] text-indigo-600 dark:text-indigo-400 hover:underline disabled:opacity-40"
          >
            Edit brief
          </button>
        </div>
      )}
    </div>
  )
}
