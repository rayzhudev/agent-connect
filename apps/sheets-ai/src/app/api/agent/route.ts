import { NextResponse } from 'next/server'
import { AgentConnect } from '@agentconnect/sdk'
import { ensureAgentConnectHost } from '@agentconnect/sdk/host'

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
    'When you want to modify the sheet, include a JSON action block in a fenced ```agentconnect``` code block.',
    'Actions schema:',
    '{"actions":[{"type":"set_cell","row":1,"col":1,"value":"New value"},{"type":"set_range","startRow":1,"startCol":1,"values":[["A1","B1"],["A2","B2"]]}]}',
    'Rows and columns are 1-based indexes.',
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
  const client = await AgentConnect.connect()
  const session = await client.sessions.create({ model })
  const encoder = new TextEncoder()
  const headers = {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  }

  const stream = new ReadableStream({
    start: (controller) => {
      let closed = false
      let buffer = ''
      const send = (payload: Record<string, unknown>) => {
        if (closed) return
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`))
      }
      const finish = async () => {
        if (closed) return
        closed = true
        offDelta()
        offFinal()
        offError()
        await session.close().catch(() => {})
        controller.close()
      }

      const offDelta = session.on('delta', (event) => {
        const text = event.text || ''
        if (!text) return
        buffer += text
        send({ type: 'delta', text })
      })

      const offFinal = session.on('final', (event) => {
        send({ type: 'final', text: event.text || buffer })
        finish()
      })

      const offError = session.on('error', (event) => {
        send({ type: 'error', message: event.message || 'Agent error' })
        finish()
      })

      session.send(buildPrompt(context, history, message)).catch((err) => {
        send({ type: 'error', message: err?.message || 'Agent error' })
        finish()
      })
    },
    cancel: async () => {
      await session.close().catch(() => {})
    },
  })

  return new Response(stream, { headers })
}
