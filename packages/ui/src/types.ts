/**
 * Type definitions for AgentConnect UI components.
 */

// Re-export SDK types for consumers
export type {
  ProviderId,
  ProviderInfo,
  ModelInfo,
  ReasoningEffortOption,
  AgentConnectClient,
  PackageManager,
  InstallResult,
} from '@agentconnect/sdk';

import type { ProviderId, ProviderInfo, ModelInfo } from '@agentconnect/sdk';

/**
 * Extended provider info with loading state for UI rendering.
 */
export interface ProviderInfoWithPending extends ProviderInfo {
  pending?: boolean;
}

/**
 * Configuration for the local provider (Ollama, LM Studio, etc.).
 */
export interface LocalProviderConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  models: string[];
}

/**
 * Represents the current model selection.
 */
export interface SelectionInfo {
  provider: ProviderId;
  model: string;
  reasoningEffort: string | null;
  scopeId: string;
}

/**
 * Configuration for displaying alerts in the UI.
 */
export interface AlertConfig {
  type?: 'error' | 'info';
  title?: string;
  message?: string;
  action?: string | null;
  onAction?: () => void;
}

/**
 * Views available in the connect component.
 */
export type ConnectViewType = 'connect' | 'local' | 'connected';

/**
 * State for the AgentConnectConnect component.
 */
export interface ConnectComponentState {
  connected: SelectionInfo | null;
  selectedProvider: ProviderId | null;
  selectedModel: string | null;
  selectedReasoningEffort: string | null;
  providers: ProviderInfoWithPending[];
  models: ModelInfo[];
  modelsLoading: boolean;
  view: ConnectViewType;
  loginExperience?: 'embedded' | 'terminal' | null;
}

/**
 * Cached DOM elements for the AgentConnectConnect component.
 */
export interface ConnectComponentElements {
  button: HTMLButtonElement | null;
  overlay: HTMLDivElement | null;
  connectPanel: HTMLDivElement | null;
  localPanel: HTMLDivElement | null;
  popoverPanel: HTMLDivElement | null;
  providerList: HTMLDivElement | null;
  connectedModelSelect: HTMLSelectElement | null;
  connectedEffortSelect: HTMLSelectElement | null;
  effortField: HTMLDivElement | null;
  modelLoading: HTMLDivElement | null;
  localStatus: HTMLDivElement | null;
  closeButtons: HTMLButtonElement[];
  disconnectButtons: HTMLButtonElement[];
  backButton: HTMLButtonElement | null;
  saveLocalButton: HTMLButtonElement | null;
  localBaseInput: HTMLInputElement | null;
  localModelInput: HTMLInputElement | null;
  localKeyInput: HTMLInputElement | null;
  localModelsInput: HTMLInputElement | null;
  popoverTitle: HTMLDivElement | null;
  progressWrap: HTMLDivElement | null;
  progressLabel: HTMLDivElement | null;
}

/**
 * Error message configuration for predefined error states.
 */
export interface ErrorMessageConfig {
  title: string;
  message: string;
  action: string | null;
}

/**
 * Field validation error.
 */
export interface ValidationError {
  field: string;
  message: string;
}

/**
 * Event detail for selection-related custom events.
 */
export interface SelectionEventDetail {
  provider: ProviderId | null;
  model: string | null;
  reasoningEffort: string | null;
  scopeId: string | null;
  previousProvider: ProviderId | null;
  previousModel: string | null;
  previousReasoningEffort: string | null;
  previousScopeId: string | null;
  restored: boolean;
}

/**
 * Event detail for provider login events.
 */
export interface ProviderLoginEventDetail {
  provider: ProviderId;
  loggedIn: boolean;
}

/**
 * Event detail for model change events.
 */
export interface ModelChangeEventDetail {
  model: string;
}

/**
 * Custom event types emitted by UI components.
 */
export interface AgentConnectUIEventMap {
  'agentconnect:connected': CustomEvent<SelectionEventDetail>;
  'agentconnect:disconnected': CustomEvent<SelectionEventDetail>;
  'agentconnect:selection-changed': CustomEvent<SelectionEventDetail>;
  'provider-login': CustomEvent<ProviderLoginEventDetail>;
  'model-change': CustomEvent<ModelChangeEventDetail>;
}
