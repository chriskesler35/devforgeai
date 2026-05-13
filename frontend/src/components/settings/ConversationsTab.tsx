// Extracted from settings/page.tsx. Conversations panel: lists past
// conversations and exposes per-row delete.

'use client'

import { useState, useEffect } from 'react'
import { API_BASE, AUTH_HEADERS } from '@/lib/config'

export function ConversationsTab() {

  const [conversations, setConversations] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState<string | null>(null)

  useEffect(() => {
    fetch(`${API_BASE}/v1/conversations?limit=100`, { headers: AUTH_HEADERS })
      .then(r => r.json())
      .then(d => setConversations(d.data || []))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  const deleteConv = async (id: string) => {
    if (!confirm('Delete this conversation?')) return
    setDeleting(id)
    await fetch(`${API_BASE}/v1/conversations/${id}`, { method: 'DELETE', headers: AUTH_HEADERS })
    setConversations(prev => prev.filter(c => c.id !== id))
    setDeleting(null)
  }

  const timeAgo = (d: string) => {
    const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000)
    if (s < 60) return `${s}s ago`
    if (s < 3600) return `${Math.floor(s/60)}m ago`
    if (s < 86400) return `${Math.floor(s/3600)}h ago`
    return `${Math.floor(s/86400)}d ago`
  }

  if (loading) return <div className="text-sm text-gray-500 py-8 text-center">Loading...</div>

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">{conversations.length} conversation{conversations.length !== 1 ? 's' : ''}</p>
        <a href="/chat" className="text-sm text-orange-600 hover:text-orange-700 font-medium">Open Chat →</a>
      </div>
      {conversations.length === 0 ? (
        <div className="text-center py-12 text-sm text-gray-400">No conversations yet.</div>
      ) : (
        <div className="bg-white dark:bg-gray-800 shadow rounded-lg divide-y divide-gray-100 dark:divide-gray-700 overflow-hidden">
          {conversations.map(c => (
            <div key={c.id} className="flex items-center justify-between px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-gray-800 dark:text-white truncate">{c.title || 'Untitled conversation'}</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {timeAgo(c.last_message_at || c.created_at)}
                  {c.message_count > 0 && ` · ${c.message_count} messages`}
                  {c.pinned && ' · 📌'}
                  {c.keep_forever && ' · 🔒'}
                </p>
              </div>
              <div className="flex items-center gap-2 ml-4 flex-shrink-0">
                <a
                  href={`/chat?session=${c.id}`}
                  className="text-xs text-indigo-500 hover:text-indigo-700"
                >
                  Open
                </a>
                <button
                  onClick={() => deleteConv(c.id)}
                  disabled={deleting === c.id}
                  className="text-xs text-red-400 hover:text-red-600 disabled:opacity-40"
                >
                  {deleting === c.id ? '...' : 'Delete'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
