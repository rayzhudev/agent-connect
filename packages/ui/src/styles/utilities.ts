/**
 * Utility styles - spinner, skeleton, alerts.
 */

export const utilityStyles = `
  .ac-spinner {
    width: 16px;
    height: 16px;
    border: 2px solid var(--ac-spinner-track, #e3e8ef);
    border-top-color: var(--ac-spinner-color, #2f6bff);
    border-radius: 50%;
    animation: ac-spin 0.8s linear infinite;
    display: inline-block;
  }
  @keyframes ac-spin {
    to { transform: rotate(360deg); }
  }
  .ac-skeleton {
    background: linear-gradient(90deg, #e3e8ef 25%, #f5f8fc 50%, #e3e8ef 75%);
    background-size: 200% 100%;
    animation: ac-shimmer 1.5s ease-in-out infinite;
    border-radius: 8px;
  }
  @keyframes ac-shimmer {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }
  .ac-alert {
    background: linear-gradient(
      165deg,
      rgba(255, 255, 255, 0.85) 0%,
      rgba(250, 249, 247, 0.8) 100%
    );
    color: rgba(80, 70, 50, 0.9);
    border: 1px solid rgba(195, 165, 90, 0.28);
    border-radius: 12px;
    padding: 12px 14px;
    font-size: 13px;
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.8),
      0 1px 3px rgba(0, 0, 0, 0.03);
  }
  .ac-alert {
    display: grid;
    gap: 4px;
  }
  .ac-alert-title {
    font-weight: 600;
    font-size: 13px;
  }
  .ac-alert-message {
    font-size: 12px;
    opacity: 0.85;
    line-height: 1.4;
  }
  .ac-alert.error {
    background: linear-gradient(
      165deg,
      rgba(255, 250, 248, 0.95) 0%,
      rgba(255, 245, 242, 0.9) 100%
    );
    border-color: rgba(200, 140, 120, 0.4);
    color: rgba(160, 80, 60, 0.95);
  }
  .ac-alert-actions {
    margin-top: 8px;
  }
  .ac-alert-actions .ac-button {
    padding: 6px 12px;
    font-size: 12px;
  }
  .ac-model-loading {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 14px;
    font-size: 13px;
    color: var(--ac-muted, #556070);
    background: linear-gradient(
      165deg,
      rgba(255, 255, 255, 0.9) 0%,
      rgba(250, 251, 254, 0.85) 100%
    );
    border: 1px solid rgba(195, 165, 90, 0.25);
    border-radius: 10px;
  }
`;
