/**
 * Button styles.
 */

export const buttonStyles = `
  .ac-button {
    appearance: none;
    border: 1px solid transparent;
    border-radius: 999px;
    padding: 10px 16px;
    background: var(--ac-button-bg, #0b1320);
    color: var(--ac-button-color, #f8fbff);
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 0.01em;
    cursor: pointer;
    transition: transform 0.15s ease, box-shadow 0.2s ease, opacity 0.2s ease;
  }
  .ac-button:hover:not([disabled]) {
    transform: translateY(-1px);
    box-shadow: 0 14px 30px rgba(10, 16, 28, 0.2);
  }
  .ac-button.secondary {
    background: linear-gradient(
      165deg,
      rgba(255, 255, 255, 0.95) 0%,
      rgba(250, 251, 254, 0.9) 100%
    );
    color: #1a1f2e;
    border: 1px solid rgba(195, 165, 90, 0.35);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.9),
      0 1px 3px rgba(0, 0, 0, 0.04);
  }
  .ac-button.secondary:hover:not([disabled]) {
    border-color: rgba(200, 170, 90, 0.55);
    background: linear-gradient(
      165deg,
      rgba(255, 255, 255, 1) 0%,
      rgba(253, 253, 255, 0.95) 100%
    );
    box-shadow:
      0 0 0 1px rgba(210, 180, 100, 0.12),
      inset 0 1px 0 rgba(255, 255, 255, 1),
      0 4px 12px rgba(0, 0, 0, 0.06);
  }
  .ac-button.ghost {
    background: transparent;
    color: rgba(80, 70, 50, 0.7);
    border: 1px solid rgba(195, 165, 90, 0.3);
    box-shadow: none;
  }
  .ac-button.ghost:hover:not([disabled]) {
    color: rgba(80, 70, 50, 0.9);
    border-color: rgba(200, 170, 90, 0.45);
    background: rgba(255, 255, 255, 0.5);
  }
  .ac-button.ac-close {
    width: 32px;
    height: 32px;
    padding: 0;
    border-radius: 999px;
    font-size: 18px;
    line-height: 1;
    color: rgba(80, 70, 50, 0.5);
  }
  .ac-button.ac-close:hover:not([disabled]) {
    color: rgba(80, 70, 50, 0.8);
    background: rgba(200, 170, 90, 0.12);
  }
  .ac-button[disabled] {
    opacity: 0.6;
    cursor: default;
    box-shadow: none;
  }
  .ac-chip {
    font-size: 12px;
    font-weight: 600;
    padding: 6px 10px;
    border-radius: 999px;
    background: linear-gradient(
      165deg,
      rgba(255, 255, 255, 0.9) 0%,
      rgba(250, 248, 245, 0.85) 100%
    );
    color: rgba(80, 70, 50, 0.8);
    border: 1px solid rgba(195, 165, 90, 0.28);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.8);
  }
  .ac-button.loading {
    position: relative;
    color: transparent;
    pointer-events: none;
  }
  .ac-button.loading::after {
    content: '';
    position: absolute;
    inset: 0;
    margin: auto;
    width: 16px;
    height: 16px;
    border: 2px solid var(--ac-button-color, #f8fbff);
    border-top-color: transparent;
    border-radius: 50%;
    animation: ac-spin 0.8s linear infinite;
  }
  .ac-button.secondary.loading::after {
    border-color: var(--ac-button-secondary-color, #0b1320);
    border-top-color: transparent;
  }
  .ac-button:active:not([disabled]) {
    transform: scale(0.98);
  }
`;

export const connectButtonStyles = `
  .ac-connect .ac-button {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    min-height: 52px;
    padding: 14px 24px;
    border-radius: 999px;
    background: linear-gradient(
      165deg,
      rgba(255, 255, 255, 0.95) 0%,
      rgba(245, 247, 250, 0.9) 25%,
      rgba(235, 238, 245, 0.85) 50%,
      rgba(240, 242, 248, 0.9) 75%,
      rgba(250, 251, 254, 0.95) 100%
    );
    color: #1a1f2e;
    font-size: 13px;
    font-weight: 600;
    letter-spacing: 0.02em;
    border: 1.5px solid rgba(195, 165, 90, 0.55);
    box-shadow:
      0 0 0 1px rgba(210, 180, 100, 0.2),
      0 1px 2px rgba(0, 0, 0, 0.04),
      0 4px 12px rgba(0, 0, 0, 0.06),
      0 12px 36px rgba(0, 0, 0, 0.08),
      inset 0 1px 0 rgba(255, 255, 255, 1),
      inset 0 -1px 0 rgba(0, 0, 0, 0.03);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
    overflow: hidden;
    width: min(var(--ac-connect-width, 240px), 92vw);
    text-align: center;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .ac-connect .ac-connect-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ac-connect .ac-connect-icon {
    width: 20px;
    height: 20px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 20px;
  }
  .ac-connect .ac-connect-icon svg {
    width: 18px;
    height: 18px;
  }
  .ac-connect .ac-connect-icon[data-provider="claude"] svg {
    fill: #d97757;
  }
  .ac-connect .ac-connect-icon[data-provider="cursor"] svg {
    fill: #26251e;
  }
  .ac-connect .ac-button:hover:not([disabled]) {
    transform: translateY(-2px);
    background: linear-gradient(
      165deg,
      rgba(255, 255, 255, 1) 0%,
      rgba(250, 252, 255, 0.95) 25%,
      rgba(245, 248, 255, 0.9) 50%,
      rgba(248, 250, 255, 0.95) 75%,
      rgba(255, 255, 255, 1) 100%
    );
    border-color: rgba(200, 170, 90, 0.65);
    box-shadow:
      0 0 0 1px rgba(215, 185, 100, 0.25),
      0 2px 4px rgba(0, 0, 0, 0.04),
      0 8px 24px rgba(0, 0, 0, 0.08),
      0 20px 50px rgba(0, 0, 0, 0.1),
      inset 0 1px 0 rgba(255, 255, 255, 1),
      inset 0 -1px 0 rgba(0, 0, 0, 0.02);
  }
  .ac-connect .ac-button:active:not([disabled]) {
    transform: translateY(0) scale(0.98);
    background: linear-gradient(
      165deg,
      rgba(245, 247, 252, 0.95) 0%,
      rgba(240, 243, 250, 0.9) 50%,
      rgba(245, 247, 252, 0.95) 100%
    );
    box-shadow:
      0 1px 2px rgba(0, 0, 0, 0.05),
      0 4px 12px rgba(0, 0, 0, 0.06),
      inset 0 1px 0 rgba(255, 255, 255, 0.9),
      inset 0 -1px 0 rgba(0, 0, 0, 0.02);
  }
`;
