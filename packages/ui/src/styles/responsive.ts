/**
 * Responsive and touch-friendly styles.
 */

export const responsiveStyles = `
  @media (max-width: 480px) {
    .ac-modal {
      width: 100vw;
      max-width: 100vw;
      border-radius: 20px 20px 0 0;
      top: auto;
      bottom: 0;
      left: 0;
      transform: none;
      max-height: 85vh;
      overflow-y: auto;
    }
    .ac-popover {
      width: calc(100vw - 24px);
      left: 12px !important;
    }
    .ac-provider-card {
      grid-template-columns: 1fr;
      gap: 10px;
    }
    .ac-provider-actions {
      justify-content: flex-start;
    }
    .ac-actions {
      flex-direction: column;
    }
    .ac-actions .ac-button {
      width: 100%;
      justify-content: center;
    }
    .ac-actions-right {
      width: 100%;
      flex-direction: column;
    }
  }
  @media (pointer: coarse) {
    .ac-button {
      min-height: 44px;
    }
    .ac-input, .ac-select {
      min-height: 48px;
    }
    .ac-provider-card {
      min-height: 72px;
    }
  }
  @media (hover: none) {
    .ac-button:hover:not([disabled]) {
      transform: none;
      box-shadow: none;
    }
    .ac-provider-card:hover {
      transform: none;
      border-color: var(--ac-card-border, #e3e8ef);
      box-shadow: none;
    }
  }
`;
