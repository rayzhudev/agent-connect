/**
 * Provider status list component.
 */

import { getClient } from '../client';
import { ensureStyles } from '../styles';

export class AgentConnectProviderStatus extends HTMLElement {
  private container: HTMLDivElement;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.container = document.createElement('div');
  }

  connectedCallback(): void {
    ensureStyles(this.shadowRoot!);
    this.container.className = 'ac-list';
    this.shadowRoot!.appendChild(this.container);
    this.refresh();
  }

  async refresh(): Promise<void> {
    this.container.innerHTML = '';
    try {
      const client = await getClient();
      const providers = await client.providers.list();
      for (const info of providers) {
        const row = document.createElement('div');
        row.className = 'ac-row';
        const chip = document.createElement('span');
        chip.className = 'ac-chip';
        chip.textContent = info.loggedIn ? 'Ready' : 'Login needed';
        const label = document.createElement('strong');
        label.textContent = info.name || info.id;
        row.append(label, chip);
        this.container.appendChild(row);
      }
    } catch {
      const row = document.createElement('div');
      row.textContent = 'Provider status unavailable';
      this.container.appendChild(row);
    }
  }
}
