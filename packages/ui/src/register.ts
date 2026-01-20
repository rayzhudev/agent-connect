/**
 * Custom element registration.
 */

import {
  AgentConnectLoginButton,
  AgentConnectModelPicker,
  AgentConnectProviderStatus,
  AgentConnectConnect,
} from './components';
import { getClient } from './client';

let prefetchStarted = false;

async function prefetchProviderData(): Promise<void> {
  if (prefetchStarted) return;
  prefetchStarted = true;
  try {
    const client = await getClient();
    const providers = await client.providers.list();
    await Promise.allSettled(
      providers.map((provider) => client.models.list(provider.id))
    );
  } catch {
    // Ignore background prefetch errors
  }
}

/**
 * Register all AgentConnect custom elements.
 * Safe to call multiple times - will only register once.
 */
export function defineAgentConnectComponents(): void {
  if (typeof window === 'undefined' || !window.customElements) {
    return;
  }
  if (!customElements.get('agentconnect-login-button')) {
    customElements.define('agentconnect-login-button', AgentConnectLoginButton);
  }
  if (!customElements.get('agentconnect-model-picker')) {
    customElements.define('agentconnect-model-picker', AgentConnectModelPicker);
  }
  if (!customElements.get('agentconnect-provider-status')) {
    customElements.define('agentconnect-provider-status', AgentConnectProviderStatus);
  }
  if (!customElements.get('agentconnect-connect')) {
    customElements.define('agentconnect-connect', AgentConnectConnect);
  }
  queueMicrotask(() => {
    void prefetchProviderData();
  });
}
