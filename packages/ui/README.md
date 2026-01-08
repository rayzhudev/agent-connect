# @agentconnect/ui

AgentConnect UI web components. Use these to drop a wallet-connect style modal into any app.

## Install

```bash
bun add @agentconnect/ui @agentconnect/sdk
```

```bash
npm install @agentconnect/ui @agentconnect/sdk
```

```bash
pnpm add @agentconnect/ui @agentconnect/sdk
```

## Quick start

```ts
import { defineAgentConnectComponents } from '@agentconnect/ui';

defineAgentConnectComponents();
```

```html
<agentconnect-connect></agentconnect-connect>
```

## Events

`agentconnect-connect` emits:

- `agentconnect:connected`
- `agentconnect:selection-changed`
- `agentconnect:disconnected`

Each event includes `provider`, `model`, `reasoningEffort`, `scopeId`, and previous values when available.

## Theming

Style via CSS custom properties:

- `--ac-font-family`
- `--ac-button-bg`
- `--ac-button-color`
- `--ac-modal-bg`
- `--ac-modal-color`
- `--ac-modal-border`
- `--ac-card-border`
- `--ac-card-active-bg`
- `--ac-chip-bg`
- `--ac-chip-color`
- `--ac-muted`

## Requirements

Runs in any modern browser. An AgentConnect host must be available (CLI dev host or embedded host).

## Docs

See `docs/SDK.md` in the repo for the full SDK reference and `docs/PROTOCOL.md` for the protocol contract.
