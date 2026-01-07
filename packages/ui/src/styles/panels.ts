/**
 * Panel, modal, and popover styles.
 */

export const panelStyles = `
  .ac-overlay {
    position: fixed;
    inset: 0;
    display: none;
    z-index: 9999;
    background: rgba(8, 12, 20, 0.6);
    backdrop-filter: blur(10px);
  }
  .ac-overlay.open {
    display: block;
  }
  .ac-overlay[data-mode="popover"] {
    background: transparent;
    backdrop-filter: none;
  }
  .ac-panel {
    background: linear-gradient(
      165deg,
      rgba(255, 255, 255, 0.97) 0%,
      rgba(250, 251, 254, 0.95) 50%,
      rgba(255, 255, 255, 0.97) 100%
    );
    color: var(--ac-modal-color, #1a1f2e);
    border-radius: 24px;
    border: 1.5px solid rgba(195, 165, 90, 0.35);
    box-shadow:
      0 0 0 1px rgba(210, 180, 100, 0.12),
      0 8px 32px rgba(0, 0, 0, 0.08),
      0 30px 90px rgba(8, 12, 20, 0.12);
    padding: 20px;
    gap: 16px;
    position: fixed;
    display: none;
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
  }
  .ac-panel[data-active="true"] {
    display: grid;
  }
  .ac-modal {
    width: min(420px, 92vw);
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    padding: 24px;
    box-shadow:
      0 0 0 1px rgba(210, 180, 100, 0.15),
      0 12px 40px rgba(0, 0, 0, 0.1),
      0 40px 110px rgba(8, 12, 20, 0.15);
  }
  .ac-popover {
    width: min(320px, 92vw);
    top: var(--ac-popover-top, 80px);
    left: var(--ac-popover-left, 20px);
    transform-origin: top left;
    padding: 14px 16px;
    gap: 10px;
    box-shadow:
      0 0 0 1px rgba(210, 180, 100, 0.12),
      0 8px 28px rgba(0, 0, 0, 0.08),
      0 24px 70px rgba(8, 12, 20, 0.12);
  }
  .ac-modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .ac-modal-title {
    font-size: 20px;
    font-weight: 700;
    letter-spacing: 0.01em;
  }
  .ac-modal-subtitle {
    font-size: 12px;
    color: var(--ac-muted, #556070);
    text-transform: uppercase;
    letter-spacing: 0.14em;
  }
  .ac-popover-title {
    font-size: 16px;
    font-weight: 700;
  }
  .ac-popover-subtitle {
    font-size: 12px;
    color: var(--ac-muted, #556070);
  }
  .ac-section-title {
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--ac-muted, #556070);
    font-weight: 700;
  }
  .ac-actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
  }
  .ac-popover .ac-actions {
    justify-content: flex-end;
    margin-top: 2px;
    padding-top: 6px;
    border-top: 1px solid rgba(195, 165, 90, 0.15);
  }
  .ac-actions-right {
    display: flex;
    gap: 8px;
  }
  .ac-panel {
    opacity: 0;
    transition: opacity 0.2s ease, transform 0.2s ease;
  }
  .ac-panel[data-active="true"] {
    opacity: 1;
  }
  .ac-modal {
    transform: translate(-50%, calc(-50% + 8px));
  }
  .ac-modal[data-active="true"] {
    transform: translate(-50%, -50%);
  }
  .ac-popover {
    transform: translateY(8px);
  }
  .ac-popover[data-active="true"] {
    transform: translateY(0);
  }
  .ac-overlay {
    opacity: 0;
    transition: opacity 0.2s ease;
    pointer-events: none;
  }
  .ac-overlay.open {
    opacity: 1;
    pointer-events: auto;
  }
`;
