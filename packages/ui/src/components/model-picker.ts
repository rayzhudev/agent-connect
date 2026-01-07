/**
 * Model picker dropdown component.
 */

import type { ProviderId, ModelChangeEventDetail } from '../types';
import { getClient } from '../client';
import { ensureStyles } from '../styles';

export class AgentConnectModelPicker extends HTMLElement {
  static get observedAttributes(): string[] {
    return ['provider'];
  }

  private select: HTMLSelectElement;
  private label: HTMLSpanElement;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.select = document.createElement('select');
    this.label = document.createElement('span');
  }

  connectedCallback(): void {
    ensureStyles(this.shadowRoot!);
    this.select.className = 'ac-select';
    this.label.className = 'ac-chip';
    this.label.textContent = 'Model';
    const row = document.createElement('div');
    row.className = 'ac-row';
    row.append(this.label, this.select);
    this.shadowRoot!.appendChild(row);
    this.select.addEventListener('change', () => this.emitChange());
    this.refresh();
  }

  attributeChangedCallback(): void {
    this.refresh();
  }

  get provider(): ProviderId | '' {
    return (this.getAttribute('provider') as ProviderId) || '';
  }

  async refresh(): Promise<void> {
    this.select.innerHTML = '';
    try {
      const client = await getClient();
      const models = await client.models.list(this.provider || undefined);
      for (const model of models) {
        const option = document.createElement('option');
        option.value = model.id;
        option.textContent = model.displayName || model.id;
        this.select.appendChild(option);
      }
      this.emitChange();
    } catch {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'No models';
      this.select.appendChild(option);
    }
  }

  emitChange(): void {
    const value = this.select.value;
    const detail: ModelChangeEventDetail = { model: value };
    this.dispatchEvent(new CustomEvent('model-change', { detail }));
  }
}
