'use client'

import { useEffect, useRef } from 'react'

interface AgentConnectButtonProps {
  onConnected?: (detail: { model?: string; reasoningEffort?: string }) => void
  onSelectionChanged?: (detail: { model?: string; reasoningEffort?: string }) => void
  onDisconnected?: () => void
}

export default function AgentConnectButton({
  onConnected,
  onSelectionChanged,
  onDisconnected,
}: AgentConnectButtonProps) {
  const ref = useRef<HTMLElement>(null)
  const initialized = useRef(false)

  useEffect(() => {
    async function init() {
      if (initialized.current) return
      initialized.current = true

      const { defineAgentConnectComponents } = await import('@agentconnect/ui')
      defineAgentConnectComponents()

      await customElements.whenDefined('agentconnect-connect')

      const el = ref.current
      if (!el) return

      if ((el as any).render) {
        (el as any).render()
      }
    }
    init()
  }, [])

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const handleConnected = (e: Event) => {
      const detail = (e as CustomEvent).detail || {}
      onConnected?.(detail)
    }

    const handleSelectionChanged = (e: Event) => {
      const detail = (e as CustomEvent).detail || {}
      onSelectionChanged?.(detail)
    }

    const handleDisconnected = () => {
      onDisconnected?.()
    }

    el.addEventListener('agentconnect:connected', handleConnected)
    el.addEventListener('agentconnect:selection-changed', handleSelectionChanged)
    el.addEventListener('agentconnect:disconnected', handleDisconnected)

    return () => {
      el.removeEventListener('agentconnect:connected', handleConnected)
      el.removeEventListener('agentconnect:selection-changed', handleSelectionChanged)
      el.removeEventListener('agentconnect:disconnected', handleDisconnected)
    }
  }, [onConnected, onSelectionChanged, onDisconnected])

  return (
    <agentconnect-connect
      ref={ref as any}
      style={{
        // @ts-ignore
        '--ac-font-family': 'inherit',
        '--ac-accent': '#2563eb',
        '--ac-button-bg': '#1a1a1a',
        '--ac-button-color': '#ffffff',
        '--ac-button-secondary-bg': '#ffffff',
        '--ac-button-secondary-color': '#1a1a1a',
        '--ac-button-secondary-border': '#e2e8f0',
        '--ac-button-ghost-color': '#4a5568',
        '--ac-button-ghost-border': '#e2e8f0',
        '--ac-chip-bg': '#eff6ff',
        '--ac-chip-color': '#2563eb',
        '--ac-modal-bg': '#ffffff',
        '--ac-modal-color': '#1a1a1a',
        '--ac-modal-border': '#e2e8f0',
        '--ac-card-border': '#e2e8f0',
        '--ac-card-active-bg': '#eff6ff',
        '--ac-alert-bg': '#ffffff',
        '--ac-alert-color': '#1a1a1a',
        '--ac-alert-border': '#e2e8f0',
        '--ac-muted': '#64748b',
      } as React.CSSProperties}
    />
  )
}

declare global {
  namespace JSX {
    interface IntrinsicElements {
      'agentconnect-connect': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      >
    }
  }
}
