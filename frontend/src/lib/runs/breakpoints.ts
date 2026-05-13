import { useEffect, useState } from 'react'

export const WIDE_BREAKPOINT = 1400
export const NARROW_BREAKPOINT = 900

export const RUN_VIEWER_GRID_WIDE =
  '130px minmax(360px, 1.1fr) minmax(420px, 1.2fr) minmax(260px, 0.9fr)'

export const RUN_VIEWER_GRID_NARROW =
  '130px minmax(360px, 1.1fr) minmax(420px, 1.2fr)'

export const RUN_VIEWER_GRID_MOBILE = '1fr'

export function isWideLayout(width: number): boolean {
  return width >= WIDE_BREAKPOINT
}

export function useIsWide(): boolean {
  const [wide, setWide] = useState(false)
  useEffect(() => {
    const check = () => setWide(window.innerWidth >= WIDE_BREAKPOINT)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])
  return wide
}

export function useViewerLayout(): 'wide' | 'narrow' | 'mobile' {
  const [layout, setLayout] = useState<'wide' | 'narrow' | 'mobile'>('narrow')
  useEffect(() => {
    const check = () => {
      const w = window.innerWidth
      if (w >= WIDE_BREAKPOINT) setLayout('wide')
      else if (w >= NARROW_BREAKPOINT) setLayout('narrow')
      else setLayout('mobile')
    }
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])
  return layout
}
