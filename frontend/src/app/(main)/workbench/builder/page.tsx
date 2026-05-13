'use client'

import { useLegacyRedirect } from '@/lib/legacyRedirect'

export default function BuilderRedirect() {
  useLegacyRedirect('/methods')
  return <p className="text-center text-gray-400 py-12">Redirecting...</p>
}
