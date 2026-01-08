import { NextResponse } from 'next/server'
import { ensureAgentConnectHost } from '@agentconnect/sdk/host'

export const runtime = 'nodejs'

export async function GET() {
  try {
    await ensureAgentConnectHost()
    return NextResponse.json({ status: 'ok' })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to start host'
    return NextResponse.json({ status: 'error', message }, { status: 500 })
  }
}
