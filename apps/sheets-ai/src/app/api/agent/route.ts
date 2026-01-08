import { NextResponse } from 'next/server'
import { AgentConnect } from '@agentconnect/sdk'
import { ensureAgentConnectHost } from '@agentconnect/sdk/host'
import WebSocket from 'ws'

export const runtime = 'nodejs'

type HistoryEntry = {
  role?: string
  text?: string
}

function buildPrompt(context: string, history: HistoryEntry[], message: string): string {
  const trimmedHistory = history
    .filter(entry => {
      if (!entry || typeof entry.text !== 'string') return false
      if (entry.role !== 'user' && entry.role !== 'assistant') return false
      return entry.text.trim().length > 0
    })
    .slice(-6)
    .map(entry => `${entry.role === 'user' ? 'User' : 'Assistant'}: ${entry.text}`)
    .join('\n')

  const parts = [
    'You are a spreadsheet assistant helping with data analysis and manipulation.',
  ]

  if (context.trim()) {
    parts.push(`\n${context}`)
  }

  if (trimmedHistory) {
    parts.push(`\nConversation so far:\n${trimmedHistory}`)
  }

  parts.push(
    `\nUser request: ${message}\n`,
    'Provide helpful, concise responses. If suggesting formulas, explain what they do. If analyzing data, focus on actionable insights.'
  )

  return parts.join('\n')
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const message = typeof body?.message === 'string' ? body.message : ''
  const model = typeof body?.model === 'string' ? body.model : 'default'
  const context = typeof body?.context === 'string' ? body.context : ''
  const history = Array.isArray(body?.history) ? body.history : []

  if (!message.trim()) {
    return NextResponse.json({ error: 'Message is required.' }, { status: 400 })
  }

  await ensureAgentConnectHost()
  const client = await AgentConnect.connect({ webSocket: WebSocket as any })
  const session = await client.sessions.create({ model })

  let finalText = ''

  try {
    await new Promise<void>((resolve, reject) => {
      const offFinal = session.on('final', (event) => {
        finalText = event.text || ''
        offFinal()
        offError()
        resolve()
      })
      const offError = session.on('error', (event) => {
        offFinal()
        offError()
        reject(new Error(event.message || 'Agent error'))
      })
      session.send(buildPrompt(context, history, message)).catch(reject)
    })
  } finally {
    await session.close().catch(() => {})
  }

  return NextResponse.json({ text: finalText })
}
