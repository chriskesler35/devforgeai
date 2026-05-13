'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { postMessage } from '@/lib/runs/api'
import { useToast } from '@/app/ToastProvider'
import type { RunMessage, RunState } from '@/lib/runs/types'

interface Props {
  runId: string
  messages: RunMessage[]
  runState: RunState
  onRefresh: () => void
}

export default function RunChatPane({ runId, messages, runState, onRefresh }: Props) {
  const { addToast } = useToast()
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  useEffect(() => {
    if (runState === 'awaiting_input') {
      inputRef.current?.focus()
    }
  }, [runState])

  const send = useCallback(async () => {
    const text = input.trim()
    if (!text || sending) return
    setSending(true)
    setInput('')
    try {
      await postMessage(runId, { content: text })
      onRefresh()
    } catch (err: any) {
      addToast({ type: 'error', title: 'Send failed', message: err.message, autoClose: 4000 })
      setInput(text)
    } finally {
      setSending(false)
    }
  }, [runId, input, sending, onRefresh, addToast])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        send()
      }
    },
    [send],
  )

  return (
    <div className="flex flex-col h-full border-r border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
      {/* Message list */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-center text-gray-400 dark:text-gray-600 text-sm py-12">
            No messages yet.
            {runState === 'awaiting_input' && (
              <span className="block mt-1 text-gray-500 dark:text-gray-500">
                Type below to get started.
              </span>
            )}
          </div>
        )}
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t border-gray-200 dark:border-gray-700 p-3">
        <div className="flex gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              runState === 'awaiting_input'
                ? 'Type a message or /command...'
                : 'Send a message...'
            }
            rows={1}
            className="flex-1 resize-none rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-sm text-gray-900 dark:text-white px-3 py-2 placeholder-gray-400 outline-none focus:border-orange-400 focus:ring-1 focus:ring-orange-400"
          />
          <button
            onClick={send}
            disabled={!input.trim() || sending}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-orange-600 text-white hover:bg-orange-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {sending ? '...' : 'Send'}
          </button>
        </div>
        {runState === 'awaiting_input' && (
          <p className="text-[10px] text-blue-500 mt-1.5 font-medium animate-pulse">
            Awaiting your input
          </p>
        )}
      </div>
    </div>
  )
}

function MessageBubble({ message }: { message: RunMessage }) {
  const isUser = message.role === 'user'
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] rounded-xl px-4 py-2.5 text-sm leading-relaxed ${
          isUser
            ? 'bg-orange-50 dark:bg-orange-900/20 text-gray-900 dark:text-orange-100'
            : 'bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200'
        }`}
      >
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[10px] font-semibold uppercase text-gray-400 dark:text-gray-500">
            {message.role}
          </span>
          {message.created_at && (
            <span className="text-[10px] text-gray-300 dark:text-gray-600">
              {new Date(message.created_at).toLocaleTimeString()}
            </span>
          )}
        </div>
        {message.image_url && (
          <img
            src={message.image_url}
            alt=""
            className="rounded-lg max-w-full max-h-48 mb-2"
          />
        )}
        <p className="whitespace-pre-wrap break-words">{message.content}</p>
      </div>
    </div>
  )
}
