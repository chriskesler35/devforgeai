'use client'

import { useLegacyRedirect } from '@/lib/legacyRedirect'

export default function ConversationsRedirect() {
  useLegacyRedirect('/now?type=chat')
  return <p className="text-center text-gray-400 py-12">Redirecting...</p>
}
