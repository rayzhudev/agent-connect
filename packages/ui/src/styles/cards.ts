/**
 * Provider card styles.
 */

export const cardStyles = `
  .ac-provider-list {
    display: grid;
    gap: 12px;
  }

  .ac-provider-card {
    border: 1px solid rgba(195, 165, 90, 0.28);
    border-radius: 16px;
    padding: 14px 16px;
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: center;
    gap: 12px;
    background: linear-gradient(
      165deg,
      rgba(255, 255, 255, 0.8) 0%,
      rgba(250, 251, 254, 0.7) 50%,
      rgba(255, 255, 255, 0.8) 100%
    );
    cursor: pointer;
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.8),
      0 2px 8px rgba(0, 0, 0, 0.04);
  }
  .ac-provider-card:hover {
    transform: translateY(-2px);
    border-color: rgba(200, 170, 90, 0.5);
    background: linear-gradient(
      165deg,
      rgba(255, 255, 255, 0.95) 0%,
      rgba(252, 253, 255, 0.9) 50%,
      rgba(255, 255, 255, 0.95) 100%
    );
    box-shadow:
      0 0 0 1px rgba(210, 180, 100, 0.12),
      inset 0 1px 0 rgba(255, 255, 255, 1),
      0 8px 24px rgba(0, 0, 0, 0.08);
  }
  .ac-provider-card:active {
    transform: scale(0.99);
  }
  .ac-provider-card.active {
    border-color: rgba(200, 170, 90, 0.6);
    background: linear-gradient(
      165deg,
      rgba(255, 255, 255, 1) 0%,
      rgba(253, 252, 250, 0.95) 50%,
      rgba(255, 255, 255, 1) 100%
    );
    box-shadow:
      0 0 0 1px rgba(210, 180, 100, 0.18),
      inset 0 1px 0 rgba(255, 255, 255, 1),
      0 8px 28px rgba(180, 150, 80, 0.15);
  }

  .ac-provider-card[data-provider="claude"]:hover {
    border-color: rgba(217, 119, 87, 0.45);
    box-shadow:
      0 0 0 1px rgba(217, 119, 87, 0.1),
      inset 0 1px 0 rgba(255, 255, 255, 1),
      0 8px 24px rgba(217, 119, 87, 0.12);
  }
  .ac-provider-card[data-provider="claude"].active {
    border-color: rgba(217, 119, 87, 0.55);
    box-shadow:
      0 0 0 1px rgba(217, 119, 87, 0.15),
      inset 0 1px 0 rgba(255, 255, 255, 1),
      0 8px 28px rgba(217, 119, 87, 0.18);
  }

  .ac-provider-card[data-provider="codex"]:hover {
    border-color: rgba(97, 108, 120, 0.45);
    box-shadow:
      0 0 0 1px rgba(97, 108, 120, 0.1),
      inset 0 1px 0 rgba(255, 255, 255, 1),
      0 8px 24px rgba(97, 108, 120, 0.12);
  }
  .ac-provider-card[data-provider="codex"].active {
    border-color: rgba(97, 108, 120, 0.55);
    box-shadow:
      0 0 0 1px rgba(97, 108, 120, 0.15),
      inset 0 1px 0 rgba(255, 255, 255, 1),
      0 8px 28px rgba(97, 108, 120, 0.18);
  }

  .ac-provider-card[data-provider="cursor"]:hover {
    border-color: rgba(20, 22, 26, 0.55);
    box-shadow:
      0 0 0 1px rgba(20, 22, 26, 0.18),
      inset 0 1px 0 rgba(255, 255, 255, 1),
      0 8px 24px rgba(20, 22, 26, 0.16);
  }
  .ac-provider-card[data-provider="cursor"].active {
    border-color: rgba(20, 22, 26, 0.65);
    box-shadow:
      0 0 0 1px rgba(20, 22, 26, 0.22),
      inset 0 1px 0 rgba(255, 255, 255, 1),
      0 8px 28px rgba(20, 22, 26, 0.2);
  }

  .ac-provider-card[data-provider="local"]:hover {
    border-color: rgba(100, 116, 139, 0.45);
    box-shadow:
      0 0 0 1px rgba(100, 116, 139, 0.1),
      inset 0 1px 0 rgba(255, 255, 255, 1),
      0 8px 24px rgba(100, 116, 139, 0.12);
  }
  .ac-provider-card[data-provider="local"].active {
    border-color: rgba(100, 116, 139, 0.55);
    box-shadow:
      0 0 0 1px rgba(100, 116, 139, 0.15),
      inset 0 1px 0 rgba(255, 255, 255, 1),
      0 8px 28px rgba(100, 116, 139, 0.18);
  }

  .ac-provider-row {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .ac-provider-meta {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .ac-provider-icon {
    width: 48px;
    height: 48px;
    border-radius: 14px;
    display: grid;
    place-items: center;
    font-weight: 700;
    letter-spacing: 0.06em;
    font-size: 11px;
    background: linear-gradient(
      145deg,
      rgba(255, 255, 255, 0.95) 0%,
      rgba(245, 243, 240, 0.9) 100%
    );
    color: rgba(100, 85, 60, 0.8);
    border: 1.5px solid rgba(195, 165, 90, 0.35);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 1),
      inset 0 -1px 0 rgba(0, 0, 0, 0.03),
      0 2px 6px rgba(0, 0, 0, 0.04);
  }
  .ac-provider-icon svg {
    width: 26px;
    height: 26px;
  }

  .ac-provider-icon[data-provider="claude"] {
    background: linear-gradient(145deg, #fff8f3 0%, #ffeee2 100%);
    border-color: rgba(217, 119, 87, 0.4);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 1),
      0 2px 8px rgba(217, 119, 87, 0.12);
  }
  .ac-provider-icon[data-provider="claude"] svg {
    fill: #d97757;
  }
  .ac-provider-card:hover .ac-provider-icon[data-provider="claude"] {
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 1),
      0 4px 16px rgba(217, 119, 87, 0.2);
  }

  .ac-provider-icon[data-provider="codex"] {
    background: linear-gradient(145deg, #f5f5f5 0%, #e8e8e8 100%);
    border-color: rgba(122, 132, 146, 0.4);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 1),
      0 2px 8px rgba(97, 108, 120, 0.14);
  }
  .ac-provider-icon[data-provider="codex"] svg {
    fill: #2a2f36;
  }
  .ac-provider-card:hover .ac-provider-icon[data-provider="codex"] {
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 1),
      0 4px 16px rgba(97, 108, 120, 0.2);
  }

  .ac-provider-icon[data-provider="cursor"] {
    background: linear-gradient(145deg, #fbfaf6 0%, #f0ede6 100%);
    border-color: rgba(29, 32, 38, 0.42);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 1),
      0 2px 8px rgba(20, 22, 26, 0.16);
  }
  .ac-provider-icon[data-provider="cursor"] svg {
    fill: #111316;
  }
  .ac-provider-card:hover .ac-provider-icon[data-provider="cursor"] {
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 1),
      0 4px 16px rgba(20, 22, 26, 0.24);
  }

  .ac-provider-icon[data-provider="local"] {
    background: linear-gradient(145deg, #f2f4f8 0%, #e4e8f0 100%);
    border-color: rgba(100, 116, 139, 0.4);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 1),
      0 2px 8px rgba(100, 116, 139, 0.12);
  }
  .ac-provider-icon[data-provider="local"] svg {
    fill: #64748b;
  }
  .ac-provider-card:hover .ac-provider-icon[data-provider="local"] {
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 1),
      0 4px 16px rgba(100, 116, 139, 0.2);
  }

  .ac-provider-name {
    font-size: 15px;
    font-weight: 700;
  }
  .ac-provider-name-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .ac-provider-update {
    display: inline-flex;
    align-items: center;
    padding: 3px 10px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.01em;
    background: transparent;
    color: #2b2f3a;
    border: 1px solid rgba(120, 129, 145, 0.45);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.9),
      0 6px 16px rgba(18, 24, 38, 0.12);
    background-image: linear-gradient(120deg, #6b7280 0%, #1f2937 45%, #64748b 100%);
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
  }
  .ac-provider-status {
    font-size: 12px;
    color: var(--ac-muted, #556070);
  }
  .ac-provider-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .ac-provider-card.loading {
    pointer-events: none;
  }
  .ac-provider-card.loading .ac-provider-name,
  .ac-provider-card.loading .ac-provider-status {
    background: var(--ac-skeleton-base, #e3e8ef);
    color: transparent;
    border-radius: 4px;
    animation: ac-shimmer 1.5s ease-in-out infinite;
    background-size: 200% 100%;
  }
  .ac-provider-card .ac-provider-actions .ac-button {
    pointer-events: none;
  }
  .ac-provider-card .ac-provider-actions .ac-button.update.icon {
    pointer-events: auto;
  }
`;
