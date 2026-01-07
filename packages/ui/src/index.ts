/**
 * AgentConnect UI Components
 *
 * Web components for integrating AgentConnect into applications.
 */

// Export types
export type {
  ProviderId,
  ProviderInfo,
  ModelInfo,
  ReasoningEffortOption,
  AgentConnectClient,
  ProviderInfoWithPending,
  LocalProviderConfig,
  SelectionInfo,
  AlertConfig,
  ConnectViewType,
  ConnectComponentState,
  ConnectComponentElements,
  ErrorMessageConfig,
  ValidationError,
  SelectionEventDetail,
  ProviderLoginEventDetail,
  ModelChangeEventDetail,
  AgentConnectUIEventMap,
} from './types';

// Export components
export {
  AgentConnectLoginButton,
  AgentConnectModelPicker,
  AgentConnectProviderStatus,
  AgentConnectConnect,
} from './components';

// Export registration function
export { defineAgentConnectComponents } from './register';

// Export client utilities
export { getClient, resetClient } from './client';

// Export style utilities
export { ensureStyles, combinedStyles } from './styles';
