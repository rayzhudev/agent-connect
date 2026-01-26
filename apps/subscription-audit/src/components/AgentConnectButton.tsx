'use client';

import { useEffect, useRef } from 'react';

interface AgentConnectButtonProps {
  onConnected?: (detail: { model?: string }) => void;
  onSelectionChanged?: (detail: { model?: string }) => void;
  onDisconnected?: () => void;
}

export default function AgentConnectButton({
  onConnected,
  onSelectionChanged,
  onDisconnected,
}: AgentConnectButtonProps) {
  const ref = useRef<HTMLElement>(null);
  const initialized = useRef(false);

  useEffect(() => {
    async function init() {
      if (initialized.current) return;
      initialized.current = true;

      const hostReady = fetch('/api/agentconnect')
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error('Host failed'))))
        .catch((err) => {
          console.error('Failed to start AgentConnect host:', err);
          return null;
        });

      const { defineAgentConnectComponents, resetClient } = await import('@agentconnect/ui');
      defineAgentConnectComponents();
      await customElements.whenDefined('agentconnect-connect');

      const el = ref.current;
      if (el && (el as any).render) {
        (el as any).render();
      }

      hostReady.then((result) => {
        if (!result) return;
        resetClient();
        const current = ref.current;
        if (!current || !(current as any).refresh) return;
        (current as any).refresh({ silent: true });
      });
    }
    init();
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const handleConnected = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      onConnected?.(detail);
    };

    const handleSelectionChanged = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      onSelectionChanged?.(detail);
    };

    const handleDisconnected = () => {
      onDisconnected?.();
    };

    el.addEventListener('agentconnect:connected', handleConnected);
    el.addEventListener('agentconnect:selection-changed', handleSelectionChanged);
    el.addEventListener('agentconnect:disconnected', handleDisconnected);

    return () => {
      el.removeEventListener('agentconnect:connected', handleConnected);
      el.removeEventListener('agentconnect:selection-changed', handleSelectionChanged);
      el.removeEventListener('agentconnect:disconnected', handleDisconnected);
    };
  }, [onConnected, onSelectionChanged, onDisconnected]);

  return (
    <agentconnect-connect
      ref={ref as any}
      style={
        {
          '--ac-font-family': 'IBM Plex Sans, sans-serif',
          '--ac-accent': '#1f7a6c',
          '--ac-button-bg': '#1b1916',
          '--ac-button-color': '#ffffff',
          '--ac-button-secondary-bg': '#ffffff',
          '--ac-button-secondary-color': '#1b1916',
          '--ac-button-secondary-border': '#e5ddd4',
          '--ac-button-ghost-color': '#6a5f55',
          '--ac-button-ghost-border': '#e5ddd4',
          '--ac-chip-bg': '#e1f1ee',
          '--ac-chip-color': '#1b1916',
          '--ac-modal-bg': '#ffffff',
          '--ac-modal-color': '#1b1916',
          '--ac-modal-border': '#e5ddd4',
          '--ac-card-border': '#efe8df',
          '--ac-card-active-bg': '#f4f1ec',
          '--ac-alert-bg': '#ffffff',
          '--ac-alert-color': '#1b1916',
          '--ac-alert-border': '#e5ddd4',
          '--ac-muted': '#6a5f55',
        } as React.CSSProperties
      }
    />
  );
}

declare global {
  namespace JSX {
    interface IntrinsicElements {
      'agentconnect-connect': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      >;
    }
  }
}
