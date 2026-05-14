'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { postMessage, patchRun } from '@/lib/runs/api'
import { getApiBase, getAuthHeaders } from '@/lib/config'
import { useToast } from '@/app/ToastProvider'
import type { RunMessage, RunState } from '@/lib/runs/types'

interface ModelOption {
  id: string
  model_id: string
  display_name: string
  provider_name: string
}

interface Props {
  runId: string
  messages: RunMessage[]
  runState: RunState
  extraData: Record<string, unknown>
  onRefresh: () => void
}

export default function RunChatPane({ runId, messages, runState, extraData, onRefresh }: Props) {
  const { addToast } = useToast()
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [models, setModels] = useState<ModelOption[]>([])
  const [modelsLoading, setModelsLoading] = useState(true)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const currentModelRef = (extraData?.model_ref as string) || ''

  // Fetch usable models on mount
  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch(
          `${getApiBase()}/v1/models?usable_only=true&active_only=true&chat_only=true&limit=200`,
          { headers: getAuthHeaders() },
        )
        if (!res.ok) throw new Error(`API ${res.status}`)
        const data = await res.json()
        const items: ModelOption[] = (data.data || data.models || []).map((m: any) => ({
          id: m.id,
          model_id: m.model_id,
          display_name: m.display_name || m.model_id,
          provider_name: m.provider_name || 'unknown',
        }))
        if (!cancelled) setModels(items)
      } catch {
        // Silently fail — user can still type
      } finally {
        if (!cancelled) setModelsLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  // Auto-scroll on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  // Focus input when awaiting
  useEffect(() => {
    if (runState === 'awaiting_input') {
      inputRef.current?.focus()
    }
  }, [runState])

  const changeModel = useCallback(
    async (ref: string) => {
      try {
        await patchRun(runId, { model_ref: ref })
        onRefresh()
      } catch (err: any) {
        addToast({ type: 'error', title: 'Model change failed', message: err.message, autoClose: 4000 })
      }
    },
    [runId, onRefresh, addToast],
  )

  const send = useCallback(async () => {
    const text = input.trim()
    if (!text || sending) return

    const isSlashCommand = text.startsWith('/')

    // Warn if no model is selected (but allow slash commands through)
    if (!currentModelRef && !isSlashCommand) {
      addToast({
        type: 'error',
        title: 'No model selected',
        message: 'Pick a model from the dropdown above before sending.',
        autoClose: 4000,
      })
      return
    }

    setSending(true)
    setInput('')
    try {
      await postMessage(runId, { content: text })
      // The backend calls the LLM synchronously. The SSE stream pushes the
      // assistant message, but the Run's state field needs a full re-fetch.
      // Schedule two refreshes: a fast one to pick up state change, and a
      // deferred one as a safety net for slow LLM responses.
      setTimeout(onRefresh, 1500)
      setTimeout(onRefresh, 10000)
    } catch (err: any) {
      addToast({ type: 'error', title: 'Send failed', message: err.message, autoClose: 4000 })
      setInput(text)
    } finally {
      setSending(false)
    }
  }, [runId, input, sending, currentModelRef, onRefresh, addToast])

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
      {/* Model picker bar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
        <label className="text-[10px] font-semibold uppercase text-gray-400 dark:text-gray-500 whitespace-nowrap">
          Model
        </label>
        {modelsLoading ? (
          <span className="text-xs text-gray-400">Loading models...</span>
        ) : models.length === 0 ? (
          <span className="text-xs text-amber-600 dark:text-amber-400">
            No usable models found. Add an API key in Settings.
          </span>
        ) : (
          <select
            value={currentModelRef}
            onChange={(e) => changeModel(e.target.value)}
            className="flex-1 text-xs rounded-md border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200 px-2 py-1 outline-none focus:border-orange-400 focus:ring-1 focus:ring-orange-400 truncate"
          >
            <option value="">Select a model...</option>
            {(() => {
              const grouped = new Map<string, ModelOption[]>()
              for (const m of models) {
                const list = grouped.get(m.provider_name) || []
                list.push(m)
                grouped.set(m.provider_name, list)
              }
              return Array.from(grouped.entries()).map(([provider, providerModels]) => (
                <optgroup key={provider} label={provider}>
                  {providerModels.map((m) => (
                    <option
                      key={`${m.provider_name}/${m.model_id}`}
                      value={`${m.provider_name}/${m.model_id}`}
                    >
                      {m.display_name}
                    </option>
                  ))}
                </optgroup>
              ))
            })()}
          </select>
        )}
      </div>

      {/* Message list */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-center text-gray-400 dark:text-gray-600 text-sm py-12">
            No messages yet.
            {!currentModelRef && models.length > 0 && (
              <span className="block mt-2 text-amber-600 dark:text-amber-400 font-medium">
                Select a model above to get started.
              </span>
            )}
            {currentModelRef && runState === 'awaiting_input' && (
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
              !currentModelRef
                ? 'Select a model above, or type /imagine...'
                : runState === 'awaiting_input'
                ? 'Type a message or /command...'
                : 'Send a message...'
            }
            rows={1}
            disabled={sending}
            className="flex-1 resize-none rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-sm text-gray-900 dark:text-white px-3 py-2 placeholder-gray-400 outline-none focus:border-orange-400 focus:ring-1 focus:ring-orange-400 disabled:opacity-50"
          />
          <button
            onClick={send}
            disabled={!input.trim() || sending}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-orange-600 text-white hover:bg-orange-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {sending ? '...' : 'Send'}
          </button>
        </div>
        {sending && (
          <p className="text-[10px] text-orange-500 mt-1.5 font-medium animate-pulse">
            Waiting for response...
          </p>
        )}
        {!sending && runState === 'awaiting_input' && currentModelRef && (
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
  const isError = !isUser && message.content.startsWith('⚠️')
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] rounded-xl px-4 py-2.5 text-sm leading-relaxed ${
          isUser
            ? 'bg-orange-50 dark:bg-orange-900/20 text-gray-900 dark:text-orange-100'
            : isError
            ? 'bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-300'
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
