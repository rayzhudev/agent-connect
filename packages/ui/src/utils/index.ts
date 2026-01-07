/**
 * Utility function exports.
 */

export { escapeHtml } from './html';
export {
  readLocalConfig,
  persistLocalConfig,
  readSelection,
  saveSelection,
  clearSelection,
  buildScopeId,
} from './storage';
export {
  parseCommaSeparated,
  querySelector,
  querySelectorAll,
  setCssVar,
  createElement,
} from './dom';
