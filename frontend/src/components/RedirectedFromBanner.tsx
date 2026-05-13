'use client'

import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'

export default function RedirectedFromBanner() {
  const searchParams = useSearchParams()
  const [visible, setVisible] = useState(false)
  const [legacyPath, setLegacyPath] = useState('')

  useEffect(() => {
    const from = searchParams.get('from')
    if (!from) return
    const key = `redirected-banner-dismissed:${from}`
    if (typeof window !== 'undefined' && localStorage.getItem(key)) return
    setLegacyPath(from)
    setVisible(true)
  }, [searchParams])

  const dismiss = useCallback(() => {
    if (legacyPath) {
      localStorage.setItem(`redirected-banner-dismissed:${legacyPath}`, '1')
    }
    setVisible(false)
  }, [legacyPath])

  if (!visible) return null

  return (
    <div className="bg-blue-50 dark:bg-blue-900/20 border-b border-blue-200 dark:border-blue-800 px-4 py-2 flex items-center justify-between text-sm">
      <span className="text-blue-700 dark:text-blue-300">
        You were redirected from <code className="text-xs bg-blue-100 dark:bg-blue-800 px-1 py-0.5 rounded">{legacyPath}</code>
        {' '}— this page has moved to its new location.
      </span>
      <button
        onClick={dismiss}
        className="text-blue-500 hover:text-blue-700 dark:hover:text-blue-300 text-xs font-medium ml-4"
      >
        Dismiss
      </button>
    </div>
  )
}
