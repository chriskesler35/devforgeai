import { Suspense } from 'react'
import NowGrid from '@/components/now/NowGrid'

export const metadata = { title: 'Now — DevForgeAI' }

export default function NowPage() {
  return (
    <Suspense>
      <NowGrid />
    </Suspense>
  )
}
