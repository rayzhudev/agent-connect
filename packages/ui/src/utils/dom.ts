/**
 * DOM utility functions.
 */

/**
 * Parse a comma-separated string into an array of trimmed, non-empty strings.
 */
export function parseCommaSeparated(raw: string): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * Query a single element from a root with type assertion.
 */
export function querySelector<T extends Element>(
  root: ParentNode,
  selector: string
): T | null {
  return root.querySelector<T>(selector);
}

/**
 * Query all elements from a root with type assertion.
 */
export function querySelectorAll<T extends Element>(
  root: ParentNode,
  selector: string
): T[] {
  return Array.from(root.querySelectorAll<T>(selector));
}

/**
 * Set a CSS custom property on an element.
 */
export function setCssVar(element: HTMLElement, name: string, value: string): void {
  element.style.setProperty(name, value);
}

/**
 * Create an element with optional class name.
 */
export function createElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (className) {
    el.className = className;
  }
  return el;
}
