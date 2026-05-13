'use client'

import { useLegacyRedirect } from '@/lib/legacyRedirect'

export default function BmadRedirect() {
  useLegacyRedirect('/methods?launch=bmad')
  return <p className="text-center text-gray-400 py-12">Redirecting...</p>
}
