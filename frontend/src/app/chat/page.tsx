'use client'

import { useLegacyRedirect } from '@/lib/legacyRedirect'

export default function ChatRedirect() {
  useLegacyRedirect('/runs/new?project=scratch')
  return <p className="text-center text-gray-400 py-12">Redirecting...</p>
}
