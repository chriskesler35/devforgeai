'use client'

import Link from 'next/link'

const CARDS = [
  {
    title: 'Agents',
    description: 'Define specialist workers, prompts, and guardrails for execution.',
    href: '/agents',
    icon: '🤖',
  },
  {
    title: 'Personas',
    description: 'Shape writing style, reasoning posture, and output tone.',
    href: '/personas',
    icon: '🎭',
  },
  {
    title: 'Methods',
    description: 'Choose frameworks and pipelines to structure multi-step work.',
    href: '/methods',
    icon: '🧠',
  },
  {
    title: 'Marketplace',
    description: 'Browse and install reusable skills and templates.',
    href: '/marketplace',
    icon: '🛍️',
  },
]

export default function CreatePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Create</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Build the team and strategy before you launch runs.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {CARDS.map((card) => (
          <Link
            key={card.href}
            href={card.href}
            className="group rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5 hover:border-orange-300 dark:hover:border-orange-600 hover:shadow-sm transition-all"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-gray-900 dark:text-white">{card.title}</h2>
                <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">{card.description}</p>
              </div>
              <span className="text-2xl" aria-hidden>
                {card.icon}
              </span>
            </div>
            <div className="mt-4 text-xs font-medium text-orange-600 dark:text-orange-400 group-hover:translate-x-0.5 transition-transform">
              Open {card.title} →
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
