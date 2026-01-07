/**
 * Input and select styles.
 */

export const inputStyles = `
  .ac-select {
    width: 100%;
    border: 1px solid rgba(195, 165, 90, 0.3);
    border-radius: 12px;
    padding: 12px 14px;
    background: linear-gradient(
      165deg,
      rgba(255, 255, 255, 0.9) 0%,
      rgba(250, 251, 254, 0.85) 100%
    );
    color: #1a1f2e;
    font-weight: 600;
    appearance: none;
    background-image:
      linear-gradient(45deg, transparent 50%, rgba(160, 135, 70, 0.65) 50%),
      linear-gradient(135deg, rgba(160, 135, 70, 0.65) 50%, transparent 50%);
    background-position:
      calc(100% - 20px) calc(50% + 1px),
      calc(100% - 14px) calc(50% + 1px);
    background-size: 6px 6px, 6px 6px;
    background-repeat: no-repeat;
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.8),
      inset 0 -1px 0 rgba(0, 0, 0, 0.02),
      0 1px 3px rgba(0, 0, 0, 0.04);
    transition: all 0.2s ease;
  }
  .ac-select:focus {
    outline: none;
    border-color: rgba(200, 170, 90, 0.55);
    box-shadow:
      0 0 0 3px rgba(210, 180, 100, 0.12),
      inset 0 1px 0 rgba(255, 255, 255, 0.8),
      0 1px 3px rgba(0, 0, 0, 0.04);
  }
  .ac-input {
    width: 100%;
    border: 1px solid rgba(195, 165, 90, 0.3);
    border-radius: 12px;
    padding: 12px 14px;
    background: linear-gradient(
      165deg,
      rgba(255, 255, 255, 0.9) 0%,
      rgba(250, 251, 254, 0.85) 100%
    );
    color: #1a1f2e;
    font-weight: 600;
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.8),
      inset 0 -1px 0 rgba(0, 0, 0, 0.02),
      0 1px 3px rgba(0, 0, 0, 0.04);
    transition: all 0.2s ease;
  }
  .ac-input:focus {
    outline: none;
    border-color: rgba(200, 170, 90, 0.55);
    box-shadow:
      0 0 0 3px rgba(210, 180, 100, 0.12),
      inset 0 1px 0 rgba(255, 255, 255, 0.8),
      0 1px 3px rgba(0, 0, 0, 0.04);
  }
  .ac-input::placeholder {
    color: rgba(100, 90, 70, 0.5);
    font-weight: 500;
  }
  .ac-field.error .ac-input {
    border-color: rgba(200, 140, 120, 0.5);
    background: linear-gradient(165deg, rgba(255, 252, 250, 0.95) 0%, rgba(255, 248, 245, 0.9) 100%);
  }
  .ac-field-error {
    color: rgba(160, 80, 60, 0.9);
    font-size: 11px;
    margin-top: 4px;
  }
`;
