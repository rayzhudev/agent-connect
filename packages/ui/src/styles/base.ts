/**
 * Base styles - host, reset, and common selectors.
 */

export const baseStyles = `
  :host {
    font-family: inherit;
    display: inline-flex;
    align-items: center;
  }
  :host * {
    box-sizing: border-box;
  }
  button, select {
    font-family: inherit;
  }
  .ac-connect {
    display: inline-flex;
    align-items: center;
  }
  .ac-row {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
  .ac-list {
    display: grid;
    gap: 6px;
  }
  .ac-section {
    display: grid;
    gap: 8px;
  }
  .ac-field {
    display: grid;
    gap: 6px;
  }
  .ac-field label {
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--ac-muted, #556070);
    font-weight: 700;
  }
  .ac-helper {
    font-size: 13px;
    color: var(--ac-muted, #556070);
    line-height: 1.4;
  }
`;
