'use client'

import { useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'

export function useLegacyRedirect(target: string) {
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    const separator = target.includes('?') ? '&' : '?'
    router.replace(`${target}${separator}from=${encodeURIComponent(pathname)}`)
  }, [router, pathname, target])
}
