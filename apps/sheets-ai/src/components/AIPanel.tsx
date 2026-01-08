'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import type { SheetData } from '@/lib/types'
import { applyAgentActions, parseAgentActions } from '@/lib/agent-actions'

interface Message {
  id: string
  role: 'user' | 'assistant'
  text: string
}

interface AIPanelProps {
  spreadsheetData: SheetData
  selectedCell: { row: number; col: number } | null
  selectedModel?: string
  isAgentConnected?: boolean
  onApplySuggestion?: (data: SheetData) => void
}

const QUICK_ACTIONS = [
  { label: 'Analyze data', prompt: 'Analyze this spreadsheet data and provide insights.' },
  { label: 'Suggest formulas', prompt: 'Suggest useful formulas for this data.' },
  { label: 'Find patterns', prompt: 'Find patterns or trends in this data.' },
  { label: 'Clean data', prompt: 'Suggest how to clean or normalize this data.' },
]

export default function AIPanel({
  spreadsheetData,
  selectedCell,
  selectedModel = 'default',
  isAgentConnected = false,
  onApplySuggestion,
}: AIPanelProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isBusy, setIsBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const chatWindowRef = useRef<HTMLDivElement>(null)
  const dataRef = useRef(spreadsheetData)

  useEffect(() => {
    if (chatWindowRef.current) {
      chatWindowRef.current.scrollTop = chatWindowRef.current.scrollHeight
    }
  }, [messages])

  useEffect(() => {
    dataRef.current = spreadsheetData
  }, [spreadsheetData])

  const finalizeResponse = useCallback((rawText: string, assistantId: string) => {
    const { cleanedText, actions } = parseAgentActions(rawText)
    if (actions.length > 0 && onApplySuggestion) {
      const updated = applyAgentActions(dataRef.current, actions)
      onApplySuggestion(updated)
    }
    setMessages(prev =>
      prev.map(m => m.id === assistantId ? { ...m, text: cleanedText } : m)
    )
  }, [onApplySuggestion])

  const buildContext = useCallback(() => {
    const rows = spreadsheetData.slice(0, 100)
    const csvLines = rows.map(row =>
      row.map(cell => cell.value).join(',')
    )
    const csv = csvLines.join('\n')

    let context = `Spreadsheet data (CSV format):\n${csv}`

    if (selectedCell) {
      const cellValue = spreadsheetData[selectedCell.row]?.[selectedCell.col]?.value || ''
      const colLabel = String.fromCharCode(65 + selectedCell.col)
      context += `\n\nCurrently selected cell: ${colLabel}${selectedCell.row + 1} with value: "${cellValue}"`
    }

    return context
  }, [spreadsheetData, selectedCell])

  const sendMessage = useCallback(async (userMessage: string) => {
    if (!userMessage.trim() || isBusy) return

    setError(null)
    const history = messages
      .filter(message => message.text.trim().length > 0)
      .slice(-6)
      .map(message => ({
        role: message.role,
        text: message.text,
      }))
    const userMsgId = crypto.randomUUID()
    const assistantMsgId = crypto.randomUUID()

    setMessages(prev => [
      ...prev,
      { id: userMsgId, role: 'user', text: userMessage },
      { id: assistantMsgId, role: 'assistant', text: '' },
    ])
    setInput('')
    setIsBusy(true)

    try {
      const context = buildContext()
      const response = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMessage,
          model: selectedModel,
          context,
          history,
        }),
      })

      if (!response.ok) {
        throw new Error('Agent request failed')
      }
      const contentType = response.headers.get('content-type') || ''
      if (contentType.includes('text/event-stream') && response.body) {
        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        let fullText = ''

        const applyText = (text: string) => {
          setMessages(prev =>
            prev.map(m => m.id === assistantMsgId ? { ...m, text } : m)
          )
        }

        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })

          let boundary = buffer.indexOf('\n\n')
          while (boundary !== -1) {
            const raw = buffer.slice(0, boundary).trim()
            buffer = buffer.slice(boundary + 2)
            if (raw) {
              const line = raw
                .split('\n')
                .find(entry => entry.startsWith('data:'))
              if (line) {
                const payloadText = line.replace(/^data:\s*/, '')
                try {
                  const payload = JSON.parse(payloadText) as {
                    type?: string
                    text?: string
                    message?: string
                  }
                  if (payload.type === 'delta' && payload.text) {
                    fullText += payload.text
                    applyText(fullText)
                  } else if (payload.type === 'final') {
                    fullText = payload.text || fullText
                    finalizeResponse(fullText, assistantMsgId)
                  } else if (payload.type === 'error') {
                    throw new Error(payload.message || 'Agent error')
                  }
                } catch {
                  // Ignore malformed events.
                }
              }
            }
            boundary = buffer.indexOf('\n\n')
          }
        }
      } else {
        const data = await response.json()
        const text = typeof data?.text === 'string' ? data.text : ''
        finalizeResponse(text, assistantMsgId)
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to send message')
      setMessages(prev => prev.filter(m => m.id !== assistantMsgId))
    }
    setIsBusy(false)
  }, [isBusy, buildContext, messages, selectedModel])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      sendMessage(input)
    }
  }

  const resetSession = () => {
    setMessages([])
    setError(null)
  }

  return (
    <div className="flex flex-col h-full bg-white rounded-xl border border-slate-200 shadow-sm">
      <div className="px-4 py-3 border-b border-slate-200">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">
              AI Assistant
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Ask about your data
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${isAgentConnected ? 'bg-green-500' : 'bg-slate-300'}`} />
            <span className="text-xs text-slate-500">
              {isAgentConnected ? 'Connected' : 'Disconnected'}
            </span>
          </div>
        </div>
      </div>

      <div
        ref={chatWindowRef}
        className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50/50"
      >
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-8">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center mb-4 shadow-lg">
              <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
              </svg>
            </div>
            <h3 className="font-medium text-slate-700 mb-1">Ready to help</h3>
            <p className="text-sm text-slate-500 max-w-[200px]">
              Ask questions about your spreadsheet data
            </p>
          </div>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}
            >
              <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${
                msg.role === 'user'
                  ? 'bg-slate-800'
                  : 'bg-gradient-to-br from-indigo-500 to-purple-600'
              }`}>
                {msg.role === 'user' ? (
                  <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                  </svg>
                )}
              </div>
              <div className={`max-w-[80%] rounded-xl px-3 py-2 text-sm ${
                msg.role === 'user'
                  ? 'bg-slate-800 text-white'
                  : 'bg-white border border-slate-200 text-slate-700 shadow-sm'
              }`}>
                {msg.text || (
                  <div className="flex gap-1 py-1">
                    <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      <div className="p-3 border-t border-slate-200 space-y-3">
        <div className="flex flex-wrap gap-2">
          {QUICK_ACTIONS.map((action) => (
            <button
              key={action.label}
              onClick={() => sendMessage(action.prompt)}
              disabled={isBusy}
              className="px-3 py-1.5 text-xs font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 hover:border-slate-300 transition-colors disabled:opacity-50"
            >
              {action.label}
            </button>
          ))}
        </div>

        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask about your data..."
          disabled={isBusy}
          className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-slate-50"
          rows={2}
        />

        <div className="flex items-center justify-between">
          <button
            onClick={resetSession}
            className="text-xs text-slate-500 hover:text-slate-700"
          >
            Reset
          </button>
          <button
            onClick={() => sendMessage(input)}
            disabled={isBusy || !input.trim()}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
            </svg>
            {isBusy ? 'Thinking...' : 'Send'}
          </button>
        </div>

        {error && (
          <div className="px-3 py-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg">
            {error}
          </div>
        )}
      </div>
    </div>
  )
}
