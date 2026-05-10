'use client'

/**
 * Static preview of the proposed Now Pill + Now Panel.
 * No backend wiring — uses fake data from NowMocks.tsx.
 */

import { useState } from 'react'
import { NowPill, NowPanel } from '@/components/now/NowMocks'

export default function NowMockPreviewPage() {
  const [open, setOpen] = useState(false)

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-800 dark:text-gray-200">
      {/* faux top bar */}
      <header className="sticky top-0 z-40 h-12 px-4 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 flex items-center gap-3">
        <span className="font-semibold text-sm">DevForgeAI</span>
        <span className="text-gray-300 dark:text-gray-700">|</span>
        <NowPill onClick={() => setOpen(true)} />
        <div className="ml-auto flex items-center gap-2 text-xs text-gray-500">
          <span className="px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400 font-medium">Method: BMAD</span>
          <span className="font-mono">claude-sonnet-4.6</span>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8 space-y-6">
        <div>
          <h1 className="text-2xl font-bold mb-1">Now panel — static mock</h1>
          <p className="text-sm text-gray-500">
            Click the green pill at the top to open the slide-over. This page renders no backend
            calls; data is hard-coded in <code className="font-mono text-xs">NowMocks.tsx</code>.
          </p>
        </div>

        <section className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
          <h2 className="font-semibold mb-2">What the pill replaces</h2>
          <ul className="text-sm text-gray-600 dark:text-gray-400 space-y-1 list-disc pl-5">
            <li>Sidebar "active sessions" count badge</li>
            <li>"What is the agent doing?" question (currently unanswered)</li>
            <li>Need to navigate to a specific page to see live state</li>
          </ul>
        </section>

        <section className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
          <h2 className="font-semibold mb-2">What the panel replaces</h2>
          <ul className="text-sm text-gray-600 dark:text-gray-400 space-y-1 list-disc pl-5">
            <li><code className="font-mono text-xs">/agents/sessions</code> list view</li>
            <li>The "running session" peek that today only exists in <code className="font-mono text-xs">/workbench/[id]</code></li>
            <li>Cross-cutting tool-call visibility (chat tool-loop + workbench commands)</li>
            <li>Stalled-phase detection (just spent the morning fixing one)</li>
            <li>Provider connection-state visibility (OAuth/API/local, live vs static catalog health)</li>
          </ul>
        </section>

        <section className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
          <h2 className="font-semibold mb-2">Open it</h2>
          <button
            onClick={() => setOpen(true)}
            className="px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-medium"
          >
            Open Now panel →
          </button>
          <p className="text-xs text-gray-400 mt-2">Or click the green pill in the header.</p>
        </section>
      </main>

      <NowPanel open={open} onClose={() => setOpen(false)} />
    </div>
  )
}
