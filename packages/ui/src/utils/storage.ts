/**
 * localStorage utility functions with safe fallbacks.
 */

import type { LocalProviderConfig, SelectionInfo } from '../types';
import { DEFAULT_LOCAL_CONFIG, STORAGE_KEYS } from '../constants';

/**
 * Check if localStorage is available.
 */
function isStorageAvailable(): boolean {
  return typeof localStorage !== 'undefined';
}

/**
 * Read local provider configuration from storage.
 */
export function readLocalConfig(key: string = STORAGE_KEYS.localConfig): LocalProviderConfig {
  if (!isStorageAvailable()) {
    return { ...DEFAULT_LOCAL_CONFIG };
  }
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return { ...DEFAULT_LOCAL_CONFIG };
    const parsed = JSON.parse(raw);
    return {
      baseUrl: typeof parsed.baseUrl === 'string' ? parsed.baseUrl : '',
      apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey : '',
      model: typeof parsed.model === 'string' ? parsed.model : '',
      models: Array.isArray(parsed.models)
        ? parsed.models.filter((m: unknown) => typeof m === 'string')
        : [],
    };
  } catch {
    return { ...DEFAULT_LOCAL_CONFIG };
  }
}

/**
 * Persist local provider configuration to storage.
 */
export function persistLocalConfig(
  config: LocalProviderConfig,
  key: string = STORAGE_KEYS.localConfig
): void {
  if (!isStorageAvailable()) return;
  try {
    localStorage.setItem(key, JSON.stringify(config));
  } catch {
    // Storage quota exceeded or other error
  }
}

/**
 * Read the last selection from storage.
 */
export function readSelection(key: string = STORAGE_KEYS.lastSelection): SelectionInfo | null {
  if (!isStorageAvailable()) return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.provider && parsed?.model) {
      const reasoningEffort =
        typeof parsed.reasoningEffort === 'string' && parsed.reasoningEffort
          ? parsed.reasoningEffort
          : null;
      return {
        provider: parsed.provider,
        model: parsed.model,
        reasoningEffort,
        scopeId: buildScopeId(parsed.provider, parsed.model, reasoningEffort),
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Save the current selection to storage.
 */
export function saveSelection(
  selection: SelectionInfo,
  key: string = STORAGE_KEYS.lastSelection
): void {
  if (!isStorageAvailable()) return;
  try {
    localStorage.setItem(key, JSON.stringify(selection));
  } catch {
    // Storage quota exceeded or other error
  }
}

/**
 * Clear the saved selection from storage.
 */
export function clearSelection(key: string = STORAGE_KEYS.lastSelection): void {
  if (!isStorageAvailable()) return;
  try {
    localStorage.removeItem(key);
  } catch {
    // Ignore errors
  }
}

/**
 * Build a unique scope ID from provider, model, and reasoning effort.
 */
export function buildScopeId(
  provider: string,
  model: string,
  reasoningEffort: string | null
): string {
  if (!reasoningEffort) return `${provider}:${model}`;
  return `${provider}:${model}:${reasoningEffort}`;
}
