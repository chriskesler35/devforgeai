'use client'

import { useLegacyRedirect } from '@/lib/legacyRedirect'

export default function WorkbenchRedirect() {
  useLegacyRedirect('/now?filter=method')
  return <p className="text-center text-gray-400 py-12">Redirecting...</p>
}
