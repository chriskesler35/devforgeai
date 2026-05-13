'use client'

import { useLegacyRedirect } from '@/lib/legacyRedirect'

export default function AgentSessionsRedirect() {
  useLegacyRedirect('/now?type=session')
  return <p className="text-center text-gray-400 py-12">Redirecting...</p>
}
