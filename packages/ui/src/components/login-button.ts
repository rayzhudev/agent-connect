/**
 * Login button component for a single provider.
 */

import type { ProviderId, ProviderLoginEventDetail } from '../types';
import { getClient } from '../client';
import { ensureStyles } from '../styles';

export class AgentConnectLoginButton extends HTMLElement {
  static get observedAttributes(): string[] {
    return ['provider'];
  }

  private button: HTMLButtonElement;
  private status: HTMLSpanElement;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.button = document.createElement('button');
    this.status = document.createElement('span');
  }

  connectedCallback(): void {
    ensureStyles(this.shadowRoot!);
    this.button.className = 'ac-button';
    this.button.addEventListener('click', () => this.handleClick());
    this.status.className = 'ac-chip';
    const row = document.createElement('div');
    row.className = 'ac-row';
    row.append(this.button, this.status);
    this.shadowRoot!.appendChild(row);
    this.refresh();
  }

  attributeChangedCallback(): void {
    this.refresh();
  }

  get provider(): ProviderId {
    return (this.getAttribute('provider') as ProviderId) || 'claude';
  }

  async refresh(): Promise<void> {
    this.button.textContent = `Login: ${this.provider}`;
    this.status.textContent = 'Checking...';
    try {
      const client = await getClient();
      const info = await client.providers.status(this.provider);
      this.status.textContent = info.loggedIn ? 'Ready' : 'Login needed';
    } catch {
      this.status.textContent = 'Unavailable';
    }
  }

  async handleClick(): Promise<void> {
    this.button.disabled = true;
    this.status.textContent = 'Working...';
    try {
      const client = await getClient();
      const installed = await client.providers.ensureInstalled(this.provider);
      if (!installed.installed) {
        this.status.textContent = 'Install failed';
        return;
      }
      const loggedIn = await client.providers.login(this.provider);
      this.status.textContent = loggedIn.loggedIn ? 'Ready' : 'Login needed';
      const detail: ProviderLoginEventDetail = {
        provider: this.provider,
        loggedIn: loggedIn.loggedIn,
      };
      this.dispatchEvent(new CustomEvent('provider-login', { detail }));
    } finally {
      this.button.disabled = false;
    }
  }
}
