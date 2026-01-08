# AgentConnect

[![CI](https://github.com/rayzhudev/agent-connect/actions/workflows/ci.yml/badge.svg)](https://github.com/rayzhudev/agent-connect/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@agentconnect/sdk)](https://www.npmjs.com/package/@agentconnect/sdk)
[![npm](https://img.shields.io/npm/v/@agentconnect/ui)](https://www.npmjs.com/package/@agentconnect/ui)
[![npm](https://img.shields.io/npm/v/@agentconnect/cli)](https://www.npmjs.com/package/@agentconnect/cli)

AgentConnect allows any local app to connect to a user's coding agent CLIs e.g. Claude Code, ChatGPT Codex. This allows users to bring along their existing AI subscription rather than having to subscribe separately for AI usage for each app.

AgentConnect features a Connect Agent modal that installs and logs into different AI providers, and allows users to select their choice of provider and model.

Currently supported coding agent providers:
- Claude Code
- ChatGPT Codex
- Local model (in alpha)

## How it works

1. Your app adds the SDK and optional UI components.
2. A local host (AgentConnect CLI or embedded host) bridges to the user's agent CLI.
3. Your app uses a single session API to send prompts and stream responses.

## Quick start

Install the SDK and UI:

Bun
```bash
bun add @agentconnect/sdk @agentconnect/ui
```

NPM
```bash
npm install @agentconnect/sdk @agentconnect/ui
```

PNPM
```bash
pnpm add @agentconnect/sdk @agentconnect/ui
```

Add the modal:

```ts
import { defineAgentConnectComponents } from '@agentconnect/ui';

defineAgentConnectComponents();
```

```html
<agentconnect-connect></agentconnect-connect>
```

Send a prompt:

```ts
import { AgentConnect } from '@agentconnect/sdk';

const client = await AgentConnect.connect();
const session = await client.sessions.create({ model: 'default' });

session.on('delta', (event) => {
  console.log(event.text);
});

session.on('final', (event) => {
  console.log('Final:', event.text);
});

await session.send('Summarize the following draft in 3 bullets...');
```

Run the local host (separate terminal):

```bash
npm install -g @agentconnect/cli
agentconnect dev --app . --ui http://localhost:5173
```

## Try the examples

From the repo root, install dependencies (this also builds the SDK and CLI):

```bash
bun install
```

Start the dev host (separate terminal):

```bash
agentconnect dev --app . --ui http://localhost:5173
```

Run the client-only example:

```bash
bun --cwd apps/agentic-notes dev
```

Run the Next.js example:

```bash
bun --cwd apps/sheets-ai dev
```

## Examples

- `apps/agentic-notes`: client-only writing assistant demo.
- `apps/sheets-ai`: spreadsheet + agent example with a backend.

## Docs

- `docs/SDK.md`: full SDK reference and examples.
- `docs/PROTOCOL.md`: ACP protocol reference.
- `docs/DEV_HOST.md`: provider configuration and local host behavior.
- `docs/PUBLISHING.md`: packaging and registry publishing flow.
- `docs/AI_RUNBOOK.md`: command-only flow for coding agents.
- `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, `CHANGELOG.md`.
