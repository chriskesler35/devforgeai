'use client'

import { useLegacyRedirect } from '@/lib/legacyRedirect'

export default function GsdRedirect() {
  useLegacyRedirect('/methods?launch=gsd')
  return <p className="text-center text-gray-400 py-12">Redirecting...</p>
}
