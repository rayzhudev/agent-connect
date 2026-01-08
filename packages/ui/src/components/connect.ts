/**
 * Main AgentConnect connect component.
 * Handles provider selection, model picking, and connection management.
 */

import type {
  ProviderId,
  ProviderInfo,
  ModelInfo,
  ProviderInfoWithPending,
  LocalProviderConfig,
  SelectionInfo,
  AlertConfig,
  ConnectViewType,
  ConnectComponentState,
  ConnectComponentElements,
  ValidationError,
  SelectionEventDetail,
} from '../types';
import { getClient } from '../client';
import { ERROR_MESSAGES, PROVIDER_ICONS, CONNECT_TEMPLATE, STORAGE_KEYS } from '../constants';
import { ensureStyles } from '../styles';
import {
  escapeHtml,
  readLocalConfig,
  persistLocalConfig,
  readSelection,
  saveSelection,
  clearSelection,
  buildScopeId,
  parseCommaSeparated,
  setCssVar,
} from '../utils';

export class AgentConnectConnect extends HTMLElement {
  private state: ConnectComponentState;
  private localConfig: LocalProviderConfig;
  private prefetching: boolean;
  private busy: boolean;
  private busyMessage: string | null;
  private isSelectingModel: boolean;
  private pendingModelRender: boolean;
  private popoverLocked: boolean;
  private popoverPosition: { top: number; left: number } | null;
  private modelsProvider: ProviderId | null;
  private modelsFetchedAt: number;
  private elements: ConnectComponentElements | null;
  private handleResize: () => void;
  private loginPollTimer: ReturnType<typeof setInterval> | null;
  private readonly loginPollIntervalMs = 2000;
  private readonly modelsRefreshIntervalMs = 30_000;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.state = this.createInitialState();
    this.localConfig = readLocalConfig(this.localConfigKey);
    this.prefetching = false;
    this.busy = false;
    this.busyMessage = null;
    this.isSelectingModel = false;
    this.pendingModelRender = false;
    this.popoverLocked = false;
    this.popoverPosition = null;
    this.modelsProvider = null;
    this.modelsFetchedAt = 0;
    this.elements = null;
    this.loginPollTimer = null;
    this.handleResize = () => {
      if (this.state.view === 'connected' && this.elements?.overlay?.classList.contains('open')) {
        this.positionPopover(true);
      }
    };
  }

  connectedCallback(): void {
    ensureStyles(this.shadowRoot!);
    this.render();
    this.restoreSelection();
    this.updateButtonLabel();
    window.addEventListener('resize', this.handleResize);
    this.prefetchProviders();
  }

  disconnectedCallback(): void {
    window.removeEventListener('resize', this.handleResize);
    this.stopLoginPolling();
  }

  private createInitialState(): ConnectComponentState {
    return {
      connected: null,
      selectedProvider: null,
      selectedModel: null,
      selectedReasoningEffort: null,
      providers: [],
      models: [],
      modelsLoading: false,
      view: 'connect',
      loginExperience: null,
    };
  }

  private get storageKey(): string {
    return this.getAttribute('storage-key') || STORAGE_KEYS.lastSelection;
  }

  private get localConfigKey(): string {
    return this.getAttribute('local-config-key') || STORAGE_KEYS.localConfig;
  }

  private render(): void {
    if (this.elements) return;
    this.shadowRoot!.innerHTML = '';
    ensureStyles(this.shadowRoot!);
    const container = document.createElement('div');
    container.innerHTML = CONNECT_TEMPLATE;
    this.shadowRoot!.appendChild(container);
    this.cacheElements();
    this.bindEvents();
  }

  private cacheElements(): void {
    const root = this.shadowRoot!;
    this.elements = {
      button: root.querySelector('.ac-connect-button'),
      overlay: root.querySelector('.ac-overlay'),
      connectPanel: root.querySelector('.ac-panel[data-view="connect"]'),
      localPanel: root.querySelector('.ac-panel[data-view="local"]'),
      popoverPanel: root.querySelector('.ac-panel[data-view="connected"]'),
      providerList: root.querySelector('.ac-provider-list'),
      connectedModelSelect: root.querySelector('.ac-connected-model'),
      connectedEffortSelect: root.querySelector('.ac-connected-effort'),
      effortField: root.querySelector('.ac-effort-field'),
      modelLoading: root.querySelector('.ac-model-loading'),
      localStatus: root.querySelector('.ac-local-status'),
      closeButtons: Array.from(root.querySelectorAll('.ac-close')),
      disconnectButtons: Array.from(root.querySelectorAll('.ac-disconnect')),
      backButton: root.querySelector('.ac-back'),
      saveLocalButton: root.querySelector('.ac-save-local'),
      localBaseInput: root.querySelector('.ac-local-base'),
      localModelInput: root.querySelector('.ac-local-model'),
      localKeyInput: root.querySelector('.ac-local-key'),
      localModelsInput: root.querySelector('.ac-local-models'),
      popoverTitle: root.querySelector('.ac-popover-title'),
      progressWrap: root.querySelector('.ac-progress'),
      progressLabel: root.querySelector('.ac-progress-label'),
    };
  }

  private bindEvents(): void {
    if (!this.elements) return;

    const {
      button,
      overlay,
      closeButtons,
      disconnectButtons,
      backButton,
      saveLocalButton,
      connectedModelSelect,
      connectedEffortSelect,
    } = this.elements;

    button?.addEventListener('click', () => this.open());
    closeButtons.forEach((item) => item.addEventListener('click', () => this.close()));
    disconnectButtons.forEach((item) => item.addEventListener('click', () => this.disconnect()));
    backButton?.addEventListener('click', () => this.setView('connect'));
    saveLocalButton?.addEventListener('click', () => this.saveLocalConfig());
    overlay?.addEventListener('click', (event) => {
      if (event.target === overlay) this.close();
    });

    connectedModelSelect?.addEventListener('change', () => {
      const value = connectedModelSelect.value || null;
      if (!value || !this.state.connected) return;
      this.state.selectedModel = value;
      this.syncReasoningEffort();
      this.renderReasoningEfforts();
      this.applySelection(
        this.state.connected.provider,
        value,
        false,
        this.state.selectedReasoningEffort
      );
      this.isSelectingModel = false;
      this.flushModelRender();
    });

    connectedModelSelect?.addEventListener('pointerdown', () => {
      this.isSelectingModel = true;
    });

    connectedModelSelect?.addEventListener('focus', () => {
      this.isSelectingModel = true;
    });

    connectedModelSelect?.addEventListener('blur', () => {
      this.isSelectingModel = false;
      this.flushModelRender();
    });

    connectedEffortSelect?.addEventListener('change', () => {
      const value = connectedEffortSelect.value || null;
      if (!this.state.connected || !this.state.selectedModel) return;
      this.state.selectedReasoningEffort = value;
      this.applySelection(
        this.state.connected.provider,
        this.state.selectedModel,
        false,
        this.state.selectedReasoningEffort
      );
    });
  }

  private open(): void {
    this.elements?.overlay?.classList.add('open');
    this.localConfig = readLocalConfig(this.localConfigKey);
    if (!this.state.connected) {
      this.restoreSelection(true);
    }
    if (!this.state.providers.length) {
      this.state.providers = this.getFallbackProviders();
      this.renderProviders();
    }
    this.setView(this.state.connected ? 'connected' : 'connect');
    this.refresh();
    if (!this.state.models.length) {
      this.startLoginPolling();
    } else {
      this.stopLoginPolling();
    }
  }

  private close(): void {
    this.elements?.overlay?.classList.remove('open');
    this.stopLoginPolling();
    this.popoverLocked = false;
    this.popoverPosition = null;
  }

  private setView(view: ConnectViewType): void {
    this.state.view = view;
    const { overlay, connectPanel, localPanel, popoverPanel } = this.elements ?? {};
    if (overlay) {
      overlay.dataset.mode = view === 'connected' ? 'popover' : 'modal';
    }
    this.setPanelActive(connectPanel ?? null, view === 'connect');
    this.setPanelActive(localPanel ?? null, view === 'local');
    this.setPanelActive(popoverPanel ?? null, view === 'connected');
    if (view === 'local') {
      this.populateLocalForm();
    }
    if (view === 'connected') {
      this.popoverLocked = false;
      this.popoverPosition = null;
      if (!this.state.models.length) {
        this.startLoginPolling();
      } else {
        this.stopLoginPolling();
      }
      this.renderConnectedModels();
      this.renderReasoningEfforts();
      requestAnimationFrame(() => this.positionPopover());
    }
  }

  private setPanelActive(panel: HTMLElement | null, active: boolean): void {
    if (!panel) return;
    panel.hidden = !active;
    panel.dataset.active = active ? 'true' : 'false';
  }

  private positionPopover(force = false): void {
    const { overlay, button, popoverPanel } = this.elements ?? {};
    if (!overlay || !button || !popoverPanel) return;
    if (this.popoverLocked && this.popoverPosition && !force) {
      setCssVar(overlay, '--ac-popover-top', `${this.popoverPosition.top}px`);
      setCssVar(overlay, '--ac-popover-left', `${this.popoverPosition.left}px`);
      return;
    }
    const rect = button.getBoundingClientRect();
    const panelRect = popoverPanel.getBoundingClientRect();
    const panelWidth = panelRect.width || 320;
    const panelHeight = panelRect.height || 220;
    const gap = 8;
    let left = rect.left;
    if (left + panelWidth > window.innerWidth - 12) {
      left = window.innerWidth - panelWidth - 12;
    }
    if (left < 12) left = 12;
    let top = rect.bottom + gap;
    if (top + panelHeight > window.innerHeight - 12) {
      top = rect.top - panelHeight - gap;
    }
    const finalTop = Math.max(12, top);
    const finalLeft = Math.max(12, left);
    this.popoverPosition = { top: finalTop, left: finalLeft };
    this.popoverLocked = true;
    setCssVar(overlay, '--ac-popover-top', `${finalTop}px`);
    setCssVar(overlay, '--ac-popover-left', `${finalLeft}px`);
  }

  private hasLocalConfig(): boolean {
    return Boolean(
      this.localConfig?.model ||
        this.localConfig?.baseUrl ||
        (Array.isArray(this.localConfig?.models) && this.localConfig.models.length)
    );
  }

  private getLocalModelOptions(): ModelInfo[] {
    const options = new Set<string>();
    if (this.localConfig?.model) options.add(this.localConfig.model);
    if (Array.isArray(this.localConfig?.models)) {
      for (const model of this.localConfig.models) {
        if (model) options.add(model);
      }
    }
    return Array.from(options).map((id) => ({ id, provider: 'local' as ProviderId, displayName: id }));
  }

  private getFallbackProviders(): ProviderInfoWithPending[] {
    return [
      { id: 'claude', name: 'Claude', installed: false, loggedIn: false, pending: true },
      { id: 'codex', name: 'Codex', installed: false, loggedIn: false, pending: true },
      { id: 'local', name: 'Local', installed: false, loggedIn: false, pending: true },
    ];
  }

  private populateLocalForm(): void {
    const { localBaseInput, localModelInput, localKeyInput, localModelsInput } = this.elements ?? {};
    if (!localBaseInput) return;
    localBaseInput.value = this.localConfig?.baseUrl || '';
    if (localModelInput) localModelInput.value = this.localConfig?.model || '';
    if (localKeyInput) localKeyInput.value = this.localConfig?.apiKey || '';
    if (localModelsInput) {
      localModelsInput.value = Array.isArray(this.localConfig?.models)
        ? this.localConfig.models.join(', ')
        : '';
    }
  }

  private restoreSelection(silent = false): void {
    const selection = readSelection(this.storageKey);
    if (selection) {
      this.state.connected = selection;
      this.state.selectedProvider = selection.provider;
      this.state.selectedModel = selection.model;
      this.state.selectedReasoningEffort = selection.reasoningEffort;
      if (!silent) {
        setTimeout(() => {
          this.dispatchSelectionEvent('agentconnect:connected', selection, null, true);
        }, 0);
      }
    }
  }

  private async refresh(options: { silent?: boolean } = {}): Promise<void> {
    const { silent = false } = options;
    if (!silent) {
      this.setStatus('');
    }
    try {
      const client = await getClient();
      if (!this.state.loginExperience) {
        const hello = await client.hello().catch(() => null);
        this.state.loginExperience = hello?.loginExperience ?? null;
      }
      const providers = await client.providers.list();
      this.state.providers = providers;
      if (this.state.connected) {
        this.state.selectedProvider = this.state.connected.provider;
        this.state.selectedModel = this.state.connected.model;
      } else if (!this.state.selectedProvider) {
        this.state.selectedProvider = providers[0]?.id || null;
      }
      const shouldRefreshModels =
        !this.state.selectedProvider ||
        this.state.models.length === 0 ||
        this.modelsProvider !== this.state.selectedProvider ||
        Date.now() - this.modelsFetchedAt > this.modelsRefreshIntervalMs;
      if (shouldRefreshModels) {
        await this.refreshModels();
      }
      if (this.state.connected && this.state.selectedModel) {
        const effortChanged =
          this.state.connected.reasoningEffort !== this.state.selectedReasoningEffort;
        const modelChanged = this.state.connected.model !== this.state.selectedModel;
        if (modelChanged || effortChanged) {
          this.applySelection(
            this.state.selectedProvider!,
            this.state.selectedModel,
            false,
            this.state.selectedReasoningEffort
          );
        }
      }
      this.renderProviders();
      this.renderConnectedModels();
      this.renderReasoningEfforts();
      this.updatePopoverTitle();
      this.updateButtonLabel();
      if (this.state.view === 'connected') {
        requestAnimationFrame(() => this.positionPopover());
      }
    } catch {
      if (!silent) {
        this.setAlert({
          type: 'error',
          ...ERROR_MESSAGES.connection_failed,
          onAction: () => this.refresh(),
        });
      }
    }
  }

  private startLoginPolling(): void {
    if (this.loginPollTimer) return;
    this.loginPollTimer = setInterval(() => {
      if (!this.elements?.overlay?.classList.contains('open')) {
        this.stopLoginPolling();
        return;
      }
      if (this.busy) return;
      this.pollProviderStatus().catch(() => {});
    }, this.loginPollIntervalMs);
  }

  private stopLoginPolling(): void {
    if (!this.loginPollTimer) return;
    clearInterval(this.loginPollTimer);
    this.loginPollTimer = null;
  }

  private async pollProviderStatus(): Promise<void> {
    const client = await getClient();
    const previous = this.state.providers;
    const providers = await client.providers.list();
    this.state.providers = providers;
    if (this.state.view === 'connected') {
      this.updatePopoverTitle();
      this.updateButtonLabel();
    } else {
      this.renderProviders();
      this.updatePopoverTitle();
      this.updateButtonLabel();
    }

    const selected = this.state.selectedProvider;
    if (!selected) return;
    const before = previous.find((entry) => entry.id === selected);
    const after = providers.find((entry) => entry.id === selected);
    if (before && after && !before.loggedIn && after.loggedIn) {
      await this.refreshModels();
      this.renderConnectedModels();
      this.renderReasoningEfforts();
    }
    if (after?.loggedIn && this.state.models.length > 0) {
      this.stopLoginPolling();
    }
  }

  private async prefetchProviders(): Promise<void> {
    if (this.prefetching) return;
    this.prefetching = true;
    await this.refresh({ silent: true });
    await this.prefetchAllProviderModels();
    this.prefetching = false;
  }

  private async prefetchAllProviderModels(): Promise<void> {
    if (!this.state.providers.length) return;
    const client = await getClient();
    await Promise.allSettled(
      this.state.providers.map((provider) => client.models.list(provider.id))
    );
  }

  private async refreshModels(): Promise<void> {
    if (!this.state.selectedProvider) {
      this.state.models = [];
      this.state.modelsLoading = false;
      return;
    }
    this.state.modelsLoading = true;
    this.renderConnectedModels();
    const providerId = this.state.selectedProvider;
    try {
      const client = await getClient();
      const models = await client.models.list(providerId);
      let resolvedModels: ModelInfo[] = models;
      if (providerId === 'local') {
        const localOptions = this.getLocalModelOptions();
        if (localOptions.length) {
          const merged = [...localOptions, ...models];
          const seen = new Set<string>();
          resolvedModels = merged.filter((entry) => {
            if (seen.has(entry.id)) return false;
            seen.add(entry.id);
            return true;
          });
        }
      }
      this.state.models = resolvedModels;
      this.modelsProvider = providerId;
      this.modelsFetchedAt = Date.now();
      if (
        !this.state.selectedModel ||
        !resolvedModels.find((m) => m.id === this.state.selectedModel)
      ) {
        this.state.selectedModel = resolvedModels[0]?.id || null;
      }
      this.syncReasoningEffort();
    } finally {
      this.state.modelsLoading = false;
      this.renderConnectedModels();
    }
  }

  private renderProviders(): void {
    const { providerList } = this.elements ?? {};
    if (!providerList) return;
    const fragment = document.createDocumentFragment();
    for (const provider of this.state.providers) {
      const card = this.buildProviderCard(provider);
      fragment.appendChild(card);
    }
    providerList.replaceChildren(fragment);
  }

  private buildProviderCard(provider: ProviderInfoWithPending): HTMLDivElement {
    const card = document.createElement('div');
    card.className = 'ac-provider-card';
    card.dataset.provider = provider.id;
    const isPending = provider.pending === true;
    if (isPending) {
      card.classList.add('loading');
    }
    if (provider.id === this.state.connected?.provider && !isPending) {
      card.classList.add('active');
    }
    const statusText = this.getProviderStatusText(provider);
    const svgIcon = PROVIDER_ICONS[provider.id] || null;
    const initials = (provider.name || provider.id)
      .split(' ')
      .map((part) => part[0])
      .join('')
      .slice(0, 2)
      .toUpperCase();

    const row = document.createElement('div');
    row.className = 'ac-provider-row';

    const meta = document.createElement('div');
    meta.className = 'ac-provider-meta';

    const icon = document.createElement('div');
    icon.className = 'ac-provider-icon';
    icon.dataset.provider = provider.id;

    if (svgIcon) {
      icon.innerHTML = svgIcon;
    } else {
      const iconLabel = document.createElement('span');
      iconLabel.textContent = initials;
      icon.appendChild(iconLabel);
    }

    const textWrap = document.createElement('div');

    const name = document.createElement('div');
    name.className = 'ac-provider-name';
    name.textContent = provider.name || provider.id;

    const status = document.createElement('div');
    status.className = 'ac-provider-status';
    status.textContent = statusText;

    textWrap.append(name, status);
    meta.append(icon, textWrap);
    row.appendChild(meta);
    card.appendChild(row);
    card.addEventListener('click', () => {
      this.handleProviderSelect(provider);
    });

    const action = this.buildProviderAction(provider);
    if (action) {
      const actions = document.createElement('div');
      actions.className = 'ac-provider-actions';
      actions.appendChild(action);
      card.appendChild(actions);
    }

    return card;
  }

  private getProviderStatusText(provider: ProviderInfoWithPending): string {
    const pending = provider.pending === true;
    const isLocal = provider.id === 'local';
    const hasLocalConfig = this.hasLocalConfig();
    const isConnected = this.state.connected?.provider === provider.id;
    if (pending) return 'Checking...';
    if (isLocal) {
      if (!hasLocalConfig) return 'Needs setup';
      return provider.installed ? 'Configured' : 'Offline';
    }
    if (!provider.installed) return 'Not installed';
    if (!provider.loggedIn) return 'Login needed';
    if (isConnected) return 'Connected';
    return 'Detected';
  }

  private buildProviderAction(provider: ProviderInfoWithPending): HTMLButtonElement | null {
    const pending = provider.pending === true;
    const isLocal = provider.id === 'local';
    const hasLocalConfig = this.hasLocalConfig();
    const isConnected = this.state.connected?.provider === provider.id;
    const terminalLogin = provider.id === 'claude' && this.state.loginExperience === 'terminal';

    if (pending) {
      return this.buildActionButton('Checking...', true);
    }
    if (isLocal) {
      return this.buildActionButton(hasLocalConfig ? 'Edit' : 'Configure', false, () =>
        this.openLocalConfig()
      );
    }
    if (!provider.installed) {
      const label = terminalLogin ? 'Install + Run /login' : 'Install + Login';
      const button = this.buildActionButton(label, false, () => this.connectProvider(provider));
      if (terminalLogin) {
        button.title = 'Opens a terminal and runs claude login';
      }
      return button;
    }
    if (!provider.loggedIn) {
      const label = terminalLogin ? 'Run /login' : 'Login';
      const button = this.buildActionButton(label, false, () => this.connectProvider(provider));
      if (terminalLogin) {
        button.title = 'Opens a terminal and runs claude login';
      }
      return button;
    }
    if (isConnected) return null;
    return null;
  }

  private buildActionButton(
    label: string,
    disabled: boolean,
    onClick?: () => void,
    loading = false
  ): HTMLButtonElement {
    const button = document.createElement('button');
    button.className = 'ac-button secondary';
    if (loading) {
      button.classList.add('loading');
    }
    button.textContent = label;
    button.disabled = Boolean(disabled || loading);
    if (onClick) {
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        onClick();
      });
    }
    return button;
  }

  private async handleProviderSelect(provider: ProviderInfoWithPending): Promise<void> {
    if (this.busy) return;
    if (provider.pending) return;
    if (provider.id === 'local') {
      this.openLocalConfig();
      return;
    }
    await this.connectProvider(provider);
  }

  private async connectProvider(provider: ProviderInfo): Promise<void> {
    if (this.busy) return;
    this.setAlert(null);
    const providerName = provider.name || provider.id;
    this.setBusy(true, `Connecting to ${providerName}...`);
    this.setProviderLoading(provider.id, true, 'Connecting...');
    try {
      const ready = await this.ensureProviderReady(provider, providerName);
      if (!ready) return;
      this.state.selectedProvider = provider.id;
      await this.refreshModels();
      const model = this.state.selectedModel || this.state.models[0]?.id;
      if (!model) {
        this.setAlert({
          type: 'error',
          ...ERROR_MESSAGES.no_models,
        });
        return;
      }
      this.applySelection(provider.id, model, true, this.state.selectedReasoningEffort);
      this.refresh({ silent: true });
    } catch {
      this.setAlert({
        type: 'error',
        ...ERROR_MESSAGES.login_failed,
        onAction: () => this.connectProvider(provider),
      });
    } finally {
      this.setBusy(false);
      this.setProviderLoading(provider.id, false);
    }
  }

  private setProviderLoading(providerId: ProviderId, loading: boolean, label = 'Working...'): void {
    const card = this.elements?.providerList?.querySelector(
      `.ac-provider-card[data-provider="${providerId}"]`
    );
    if (!card) return;
    const button = card.querySelector('.ac-provider-actions .ac-button') as HTMLButtonElement | null;
    if (button) {
      button.disabled = loading;
      if (loading) {
        button.classList.add('loading');
        button.dataset.originalText = button.textContent || '';
        button.textContent = label;
      } else {
        button.classList.remove('loading');
        if (button.dataset.originalText) {
          button.textContent = button.dataset.originalText;
        }
      }
    }
  }

  private async ensureProviderReady(provider: ProviderInfo, providerName: string): Promise<boolean> {
    const client = await getClient();
    let needsLogin = !provider.loggedIn;

    if (!provider.installed) {
      this.setBusy(true, `Installing ${providerName} CLI...`);
      this.setProviderLoading(provider.id, true, 'Installing...');
      const installed = await client.providers.ensureInstalled(provider.id);
      if (!installed.installed) {
        const pmInfo = installed.packageManager
          ? ` Tried using ${installed.packageManager}.`
          : '';
        this.setAlert({
          type: 'error',
          title: ERROR_MESSAGES.install_failed.title,
          message: `${ERROR_MESSAGES.install_failed.message}${pmInfo}`,
          action: ERROR_MESSAGES.install_failed.action,
          onAction: () => this.connectProvider(provider),
        });
        return false;
      }
      if (installed.packageManager && installed.packageManager !== 'unknown') {
        this.setStatus(`Installed via ${installed.packageManager}`);
      }
      // Check if already logged in after installation
      const status = await client.providers.status(provider.id);
      needsLogin = !status.loggedIn;
    }

    if (needsLogin) {
      this.setBusy(true, `Waiting for ${providerName} login...`);
      this.setProviderLoading(provider.id, true, 'Logging in...');
      const loginOptions =
        provider.id === 'claude' && this.state.loginExperience
          ? { loginExperience: this.state.loginExperience }
          : undefined;
      const loggedIn = await client.providers.login(provider.id, loginOptions);
      if (!loggedIn.loggedIn) {
        this.setAlert({
          type: 'error',
          ...ERROR_MESSAGES.login_incomplete,
          onAction: () => this.connectProvider(provider),
        });
        return false;
      }
    }
    return true;
  }

  private openLocalConfig(): void {
    if (!this.elements?.overlay?.classList.contains('open')) {
      this.elements?.overlay?.classList.add('open');
    }
    this.localConfig = readLocalConfig(this.localConfigKey);
    this.setStatus('', 'local');
    this.setView('local');
  }

  private async saveLocalConfig(): Promise<void> {
    const { saveLocalButton, localBaseInput, localModelInput, localKeyInput, localModelsInput } =
      this.elements ?? {};
    this.setAlert(null, 'local');
    this.clearFieldErrors();

    const config: LocalProviderConfig = {
      baseUrl: localBaseInput?.value.trim() || '',
      model: localModelInput?.value.trim() || '',
      apiKey: localKeyInput?.value.trim() || '',
      models: parseCommaSeparated(localModelsInput?.value || ''),
    };

    const validationErrors = this.validateLocalConfig(config);
    if (validationErrors.length > 0) {
      for (const err of validationErrors) {
        this.showFieldError(err.field, err.message);
      }
      return;
    }

    if (saveLocalButton) {
      saveLocalButton.disabled = true;
      saveLocalButton.classList.add('loading');
    }

    this.localConfig = config;
    persistLocalConfig(config, this.localConfigKey);
    try {
      const client = await getClient();
      const result = await client.providers.login('local', config);
      if (!result.loggedIn) {
        this.setAlert(
          {
            type: 'error',
            ...ERROR_MESSAGES.local_unreachable,
            onAction: () => this.saveLocalConfig(),
          },
          'local'
        );
        return;
      }
      this.state.selectedProvider = 'local';
      await this.refreshModels();
      const nextModel = this.state.selectedModel || this.state.models[0]?.id;
      if (nextModel) {
        this.applySelection('local', nextModel, true, this.state.selectedReasoningEffort);
      } else {
        await this.refresh();
        this.setView('connect');
      }
    } catch {
      this.setAlert(
        {
          type: 'error',
          ...ERROR_MESSAGES.local_save_failed,
          onAction: () => this.saveLocalConfig(),
        },
        'local'
      );
    } finally {
      if (saveLocalButton) {
        saveLocalButton.disabled = false;
        saveLocalButton.classList.remove('loading');
      }
    }
  }

  private renderConnectedModels(): void {
    const { connectedModelSelect, modelLoading } = this.elements ?? {};
    if (!connectedModelSelect) return;

    if (this.isSelectingModel) {
      this.pendingModelRender = true;
      return;
    }
    this.pendingModelRender = false;

    if (this.state.modelsLoading) {
      connectedModelSelect.style.display = 'none';
      if (modelLoading) modelLoading.style.display = 'flex';
      return;
    }

    connectedModelSelect.style.display = '';
    if (modelLoading) modelLoading.style.display = 'none';

    connectedModelSelect.innerHTML = '';
    if (!this.state.models.length) {
      if (!this.modelsFetchedAt) {
        connectedModelSelect.style.display = 'none';
        if (modelLoading) modelLoading.style.display = 'flex';
        return;
      }
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'No models available';
      connectedModelSelect.appendChild(option);
      return;
    }
    for (const model of this.state.models) {
      const option = document.createElement('option');
      option.value = model.id;
      option.textContent = model.displayName || model.id;
      connectedModelSelect.appendChild(option);
    }
    if (this.state.connected?.model) {
      connectedModelSelect.value = this.state.connected.model;
      return;
    }
    if (this.state.selectedModel) {
      connectedModelSelect.value = this.state.selectedModel;
    }
  }

  private flushModelRender(): void {
    if (!this.pendingModelRender) return;
    this.pendingModelRender = false;
    this.renderConnectedModels();
  }

  private getReasoningEffortsForModel(modelId: string | null): Array<{ id: string; label?: string }> {
    if (!modelId) return [];
    const model = this.state.models.find((entry) => entry.id === modelId);
    if (!model || !Array.isArray(model.reasoningEfforts)) return [];
    return model.reasoningEfforts.filter((entry) => entry && entry.id);
  }

  private getDefaultReasoningEffort(modelId: string | null): string | null {
    if (!modelId) return null;
    const model = this.state.models.find((entry) => entry.id === modelId);
    if (model?.defaultReasoningEffort) return model.defaultReasoningEffort;
    return null;
  }

  private syncReasoningEffort(): void {
    const modelId = this.state.selectedModel;
    if (!modelId) {
      this.state.selectedReasoningEffort = null;
      return;
    }
    const options = this.getReasoningEffortsForModel(modelId);
    if (!options.length) {
      this.state.selectedReasoningEffort = null;
      return;
    }
    const current = this.state.selectedReasoningEffort;
    if (current && options.some((option) => option.id === current)) {
      return;
    }
    const fallback = this.getDefaultReasoningEffort(modelId) || options[0].id;
    this.state.selectedReasoningEffort = fallback;
  }

  private renderReasoningEfforts(): void {
    const { connectedEffortSelect, effortField } = this.elements ?? {};
    if (!connectedEffortSelect || !effortField) return;
    const options = this.getReasoningEffortsForModel(this.state.selectedModel);
    if (!options.length) {
      effortField.style.display = 'none';
      connectedEffortSelect.innerHTML = '';
      return;
    }
    effortField.style.display = '';
    connectedEffortSelect.innerHTML = '';
    for (const option of options) {
      const entry = document.createElement('option');
      entry.value = option.id;
      entry.textContent = option.label || option.id;
      connectedEffortSelect.appendChild(entry);
    }
    const selected = this.state.selectedReasoningEffort || options[0].id;
    this.state.selectedReasoningEffort = selected;
    connectedEffortSelect.value = selected;
  }

  private updatePopoverTitle(): void {
    const { popoverTitle } = this.elements ?? {};
    if (!popoverTitle) return;
    if (!this.state.connected) {
      popoverTitle.textContent = 'Provider';
      return;
    }
    const providerName =
      this.state.providers.find((p) => p.id === this.state.connected?.provider)?.name ||
      this.state.connected.provider;
    popoverTitle.textContent = providerName;
  }

  private updateButtonLabel(): void {
    const { button } = this.elements ?? {};
    if (!button) return;
    if (!this.state.connected) {
      button.textContent = 'Connect Agent';
      button.removeAttribute('aria-label');
      return;
    }
    const providerName =
      this.state.providers.find((p) => p.id === this.state.connected?.provider)?.name ||
      this.state.connected.provider;
    const effort = this.state.connected.reasoningEffort
      ? ` · ${this.state.connected.reasoningEffort}`
      : '';
    const providerId = this.state.connected.provider;
    const modelLabel = this.formatButtonModelLabel(
      providerId,
      this.state.connected.model,
      providerName
    );
    const label = `${modelLabel}${effort}`;
    const ariaLabel = `${providerName} · ${modelLabel}${effort}`;
    const iconSvg = PROVIDER_ICONS[providerId] ?? null;
    this.renderConnectButtonContent(label, iconSvg, providerId, ariaLabel);
  }

  private formatButtonModelLabel(
    providerId: ProviderId,
    model: string | null,
    fallback: string
  ): string {
    const value = model || fallback;
    if (providerId !== 'claude') return value;
    const normalized = value.trim().toLowerCase();
    const map: Record<string, string> = {
      default: 'Default',
      sonnet: 'Sonnet',
      haiku: 'Haiku',
      opus: 'Opus',
    };
    return map[normalized] || value;
  }

  private renderConnectButtonContent(
    label: string,
    iconSvg: string | null,
    providerId: ProviderId,
    ariaLabel?: string
  ): void {
    const { button } = this.elements ?? {};
    if (!button) return;
    button.replaceChildren();
    if (ariaLabel) {
      button.setAttribute('aria-label', ariaLabel);
    } else {
      button.removeAttribute('aria-label');
    }
    if (!iconSvg) {
      button.textContent = label;
      return;
    }
    const icon = document.createElement('span');
    icon.className = 'ac-connect-icon';
    icon.dataset.provider = providerId;
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = iconSvg;
    const text = document.createElement('span');
    text.className = 'ac-connect-label';
    text.textContent = label;
    button.append(icon, text);
  }

  private applySelection(
    provider: ProviderId,
    model: string,
    closeAfter: boolean,
    reasoningEffort: string | null = null
  ): void {
    const scopeId = buildScopeId(provider, model, reasoningEffort);
    const previous = this.state.connected;
    const selection: SelectionInfo = { provider, model, reasoningEffort, scopeId };
    this.state.connected = selection;
    this.state.selectedProvider = provider;
    this.state.selectedModel = model;
    this.state.selectedReasoningEffort = reasoningEffort;
    saveSelection(selection, this.storageKey);
    this.updateButtonLabel();
    this.updatePopoverTitle();
    if (!previous) {
      this.dispatchSelectionEvent('agentconnect:connected', selection, null, false);
    } else if (previous.scopeId !== scopeId) {
      this.dispatchSelectionEvent('agentconnect:selection-changed', selection, previous, false);
    }
    if (closeAfter) {
      this.close();
    }
  }

  private disconnect(): void {
    const previous = this.state.connected;
    this.state.connected = null;
    this.state.selectedProvider = null;
    this.state.selectedModel = null;
    this.state.selectedReasoningEffort = null;
    clearSelection(this.storageKey);
    this.updateButtonLabel();
    this.renderProviders();
    if (previous) {
      this.dispatchSelectionEvent('agentconnect:disconnected', null, previous, false);
    }
    this.close();
  }

  private dispatchSelectionEvent(
    type: string,
    selection: SelectionInfo | null,
    previous: SelectionInfo | null,
    restored: boolean
  ): void {
    const detail: SelectionEventDetail = {
      provider: selection?.provider || null,
      model: selection?.model || null,
      reasoningEffort: selection?.reasoningEffort || null,
      scopeId: selection?.scopeId || null,
      previousProvider: previous?.provider || null,
      previousModel: previous?.model || null,
      previousReasoningEffort: previous?.reasoningEffort || null,
      previousScopeId: previous?.scopeId || null,
      restored: Boolean(restored),
    };
    this.dispatchEvent(
      new CustomEvent(type, {
        detail,
        bubbles: true,
        composed: true,
      })
    );
  }

  private validateLocalConfig(config: LocalProviderConfig): ValidationError[] {
    const errors: ValidationError[] = [];
    if (config.baseUrl && !/^https?:\/\/.+/.test(config.baseUrl)) {
      errors.push({
        field: 'baseUrl',
        message: 'Enter a valid URL (e.g., http://localhost:11434/v1)',
      });
    }
    if (!config.model && (!config.models || config.models.length === 0)) {
      errors.push({
        field: 'model',
        message: 'Provide at least one model ID',
      });
    }
    if (config.model && !/^[a-zA-Z0-9._:\-/]+$/.test(config.model)) {
      errors.push({
        field: 'model',
        message: 'Model ID contains invalid characters',
      });
    }
    return errors;
  }

  private showFieldError(fieldName: string, message: string): void {
    const fieldMap: Record<string, HTMLInputElement | null> = {
      baseUrl: this.elements?.localBaseInput ?? null,
      model: this.elements?.localModelInput ?? null,
    };
    const input = fieldMap[fieldName];
    if (!input) return;
    const field = input.closest('.ac-field');
    if (field) {
      field.classList.add('error');
      const errorEl = document.createElement('div');
      errorEl.className = 'ac-field-error';
      errorEl.textContent = message;
      field.appendChild(errorEl);
    }
  }

  private clearFieldErrors(): void {
    const fields = this.shadowRoot?.querySelectorAll('.ac-field.error');
    fields?.forEach((field) => {
      field.classList.remove('error');
      field.querySelector('.ac-field-error')?.remove();
    });
  }

  private setStatus(message: string, _view: ConnectViewType = 'connect'): void {
    this.setAlert(null, 'local');
    if (message) {
      this.setAlert({ message }, 'local');
    }
  }

  private setAlert(alert: AlertConfig | null, view: ConnectViewType = 'local'): void {
    if (view !== 'local') return;
    const target = this.elements?.localStatus;
    if (!target) return;

    if (!alert) {
      target.hidden = true;
      target.innerHTML = '';
      target.className = 'ac-alert ac-status';
      return;
    }

    target.hidden = false;
    target.className = 'ac-alert';
    if (alert.type) {
      target.classList.add(alert.type);
    }

    let html = '';
    if (alert.title) {
      html += `<div class="ac-alert-title">${escapeHtml(alert.title)}</div>`;
    }
    if (alert.message) {
      html += `<div class="ac-alert-message">${escapeHtml(alert.message)}</div>`;
    }
    if (alert.action && alert.onAction) {
      html += `<div class="ac-alert-actions"><button class="ac-button secondary" type="button">${escapeHtml(alert.action)}</button></div>`;
    }

    target.innerHTML = html;

    if (alert.action && alert.onAction) {
      const actionBtn = target.querySelector('.ac-alert-actions .ac-button');
      actionBtn?.addEventListener('click', () => {
        this.setAlert(null, view);
        alert.onAction!();
      });
    }
  }

  private setBusy(isBusy: boolean, message?: string | null): void {
    this.busy = Boolean(isBusy);
    if (message !== undefined) {
      this.busyMessage = message ?? null;
    }
    if (!this.elements) return;
    const { connectPanel, progressWrap, progressLabel } = this.elements;
    if (!connectPanel || !progressWrap || !progressLabel) return;
    if (this.busy) {
      connectPanel.dataset.busy = 'true';
      progressWrap.hidden = false;
      progressLabel.textContent = this.busyMessage || 'Working...';
    } else {
      connectPanel.removeAttribute('data-busy');
      progressWrap.hidden = true;
      progressLabel.textContent = '';
    }
  }
}
