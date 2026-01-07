/**
 * Combined styles and style injection.
 */

import { baseStyles } from './base';
import { buttonStyles, connectButtonStyles } from './buttons';
import { inputStyles } from './inputs';
import { panelStyles } from './panels';
import { cardStyles } from './cards';
import { utilityStyles } from './utilities';
import { responsiveStyles } from './responsive';

/**
 * Combined CSS for all AgentConnect UI components.
 */
export const combinedStyles = [
  baseStyles,
  buttonStyles,
  connectButtonStyles,
  inputStyles,
  panelStyles,
  cardStyles,
  utilityStyles,
  responsiveStyles,
].join('\n');

/**
 * Ensure styles are injected into a shadow root.
 * Safe to call multiple times - will only inject once per root.
 */
export function ensureStyles(root: ShadowRoot): void {
  if (root.querySelector('style[data-agentconnect]')) return;
  const style = document.createElement('style');
  style.dataset.agentconnect = 'true';
  style.textContent = combinedStyles;
  root.appendChild(style);
}

export { baseStyles } from './base';
export { buttonStyles, connectButtonStyles } from './buttons';
export { inputStyles } from './inputs';
export { panelStyles } from './panels';
export { cardStyles } from './cards';
export { utilityStyles } from './utilities';
export { responsiveStyles } from './responsive';
