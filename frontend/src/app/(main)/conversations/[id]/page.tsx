'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname, useParams } from 'next/navigation'
import { lookupCompanionRun } from '@/lib/runs/api'
import Link from 'next/link'

export default function ConversationRedirect() {
  const router = useRouter()
  const pathname = usePathname()
  const params = useParams<{ id: string }>()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!params.id) return
    lookupCompanionRun('chat', params.id)
      .then(({ run_id }) => {
        router.replace(`/runs/${run_id}?from=${encodeURIComponent(pathname)}`)
      })
      .catch((err) => {
        if (err.status === 404) {
          setError('This conversation link is no longer valid.')
        } else {
          setError('Unable to load — try again when the backend is online.')
        }
      })
  }, [params.id, router, pathname])

  if (error) {
    return (
      <div className="text-center py-16">
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">{error}</p>
        <Link href="/now" className="text-sm text-orange-600 hover:underline">Go to Now</Link>
      </div>
    )
  }

  return <p className="text-center text-gray-400 py-12">Opening Run...</p>
}
