'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createRun } from '@/lib/runs/api'

export default function NewRunPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [error, setError] = useState<string | null>(null)
  const creating = useRef(false)

  useEffect(() => {
    if (creating.current) return
    creating.current = true

    const projectId = searchParams.get('project') ?? undefined
    const methodId = searchParams.get('method') ?? undefined

    createRun({ project_id: projectId, method_id: methodId })
      .then((run) => {
        router.replace(`/runs/${run.id}`)
      })
      .catch((err) => {
        setError(err.message ?? 'Failed to create run')
        creating.current = false
      })
  }, [router, searchParams])

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-6 max-w-md text-center">
          <p className="text-sm text-red-700 dark:text-red-400 mb-3">{error}</p>
          <button
            onClick={() => {
              setError(null)
              creating.current = false
            }}
            className="text-sm text-orange-600 hover:underline"
          >
            Try again
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-center justify-center min-h-[50vh] text-gray-500 dark:text-gray-400">
      <span className="inline-block w-5 h-5 border-2 border-gray-300 border-t-orange-500 rounded-full animate-spin mr-2" />
      Creating run...
    </div>
  )
}
