# AgentConnect

AgentConnect is a host-agnostic SDK and protocol that lets apps use local AI agent CLIs
(Claude Code, Codex CLI) and local models through a single interface. Apps run unchanged
in local development or inside any host app that implements ACP.

Status: spec-first. The SDK and host CLI are under development. This repo ships the
spec, schemas, app templates, and a reference app to maximize developer speed.

## Repo layout

- `SPEC.md`: protocol and SDK spec.
- `schemas/`: JSON schemas for ACP and app manifests.
- `scripts/new-app.mjs`: app scaffold script.
- `templates/app/`: starter app template.
- `apps/ai-writing-assistant/`: reference consumer app.
- `packages/`: SDK, UI, and CLI sources (app devs should not edit).
- `LICENSE`: MIT.

## Create a new app (recommended)

Prereqs: Node 20+ and bun.
App developers should scaffold from the template and treat the SDK as a dependency.
If you prefer another package manager, adapt the commands accordingly, but this repo is bun-first.

1. Scaffold a new app:

```bash
bun scripts/new-app.mjs --name "My App" --out ../my-app
```

NPM alternative:

```bash
node scripts/new-app.mjs --name "My App" --out ../my-app
```

2. Install dependencies:

```bash
cd ../my-app
bun install
```

NPM alternative:

```bash
cd ../my-app
npm install
```

3. Run the dev server:

```bash
bun run dev
```

NPM alternative:

```bash
npm run dev
```

4. Run the local host (separate terminal):

```bash
agentconnect dev --app . --ui http://localhost:5173
```

5. Open the app in the browser and use the login UI to install and sign in to a
   provider. The app connects via AgentConnect without code changes.

## Using the SDK before publish

Until `@agentconnect/sdk` and `@agentconnect/ui` are published, you have two options:

1. Keep your app inside this repo under `apps/` (preferred for now).
2. Use `bun link` to link the local packages into your app.

```bash
cd /path/to/agent-connect
bun link ./packages/sdk
bun link ./packages/ui

cd /path/to/your-app
bun link @agentconnect/sdk
bun link @agentconnect/ui
```

## UI components

The template and reference app use `@agentconnect/ui` Web Components:

- `agentconnect-connect` (wallet-connect style modal)

Optional building blocks (if you want a custom UX):

- `agentconnect-login-button`
- `agentconnect-model-picker`
- `agentconnect-provider-status`

`agentconnect-connect` emits events:

- `agentconnect:connected`
- `agentconnect:selection-changed`
- `agentconnect:disconnected`

Each event detail includes: `provider`, `model`, `reasoningEffort`, `scopeId`, and previous values when available.

## SDK examples

Browser usage:

```ts
import { AgentConnect } from '@agentconnect/sdk';

const client = await AgentConnect.connect();
const session = await client.sessions.create({ model: 'claude-opus' });

let output = '';
session.on('delta', (event) => {
  output += event.text;
  console.log(output);
});

session.on('final', (event) => {
  console.log('Final:', event.text);
});

await session.send('Summarize the following draft in 3 bullets...');
```

Node usage:

```ts
import { WebSocket } from 'ws';
import { AgentConnect } from '@agentconnect/sdk';

const client = await AgentConnect.connect({ webSocket: WebSocket });
const session = await client.sessions.create({ model: 'codex', reasoningEffort: 'medium' });
await session.send('Draft a product description for a local AI writing assistant.');
await session.close();
client.close();
```

Provider checks:

```ts
const providers = await client.providers.list();
const claude = await client.providers.status('claude');
if (!claude.loggedIn) {
  await client.providers.ensureInstalled('claude');
  await client.providers.login('claude');
}
```

## SDK usage notes

- Browser apps use the default WebSocket transport.
- Node apps must provide a WebSocket implementation:
  `AgentConnect.connect({ webSocket: WebSocket })`

## End-to-end flow (setup to publish)

1. Build the app:

```bash
bun run build
```

2. Package the app:

```bash
agentconnect pack --app . --out dist/app.zip
```

3. Validate schema and hashes:

```bash
agentconnect verify --app dist/app.zip
```

4. Sign the package:

```bash
agentconnect sign --app dist/app.zip --key /path/to/private.key
```

5. Publish (registry repo placeholder):

```bash
git clone <registry-repo-url>
cd <registry-repo>
agentconnect publish --app dist/app.zip --registry . --signature dist/app.sig.json
```

## Dev host in this repo

Until the CLI is published, you can run the dev host directly:

```bash
bun ./packages/cli/src/index.ts dev
```

## Provider configuration (dev host)

The dev host expects `claude` and `codex` CLIs on your PATH. It attempts to install them with bun
if missing. You can override commands with environment variables:

- `AGENTCONNECT_CLAUDE_COMMAND`
- `AGENTCONNECT_CLAUDE_INSTALL`
- `AGENTCONNECT_CLAUDE_LOGIN`
- `AGENTCONNECT_CLAUDE_STATUS`
- `AGENTCONNECT_CODEX_COMMAND`
- `AGENTCONNECT_CODEX_INSTALL`
- `AGENTCONNECT_CODEX_LOGIN`
- `AGENTCONNECT_CODEX_STATUS`

Model selection passes `--model <model>` to each CLI. For Claude, `claude-opus`, `claude-sonnet`,
and `claude-haiku` map to `opus`, `sonnet`, and `haiku` automatically.

Default login/status behaviors:

- Claude install defaults to the official script (macOS/Linux/WSL: `curl -fsSL https://claude.ai/install.sh | bash`, Windows PowerShell: `irm https://claude.ai/install.ps1 | iex`). Override with `AGENTCONNECT_CLAUDE_INSTALL`.
- Claude login runs `claude --print` with `/login` and checks for local auth files (override with `AGENTCONNECT_CLAUDE_LOGIN` / `AGENTCONNECT_CLAUDE_STATUS`).
- Codex login runs `codex login` and status uses `codex login status` (override with `AGENTCONNECT_CODEX_STATUS`).
- For device auth, set `AGENTCONNECT_CODEX_LOGIN="codex login --device-auth"`.

Local model support (OpenAI-compatible HTTP API):

- `AGENTCONNECT_LOCAL_BASE_URL` (default `http://localhost:11434/v1`)
- `AGENTCONNECT_LOCAL_MODEL` (default empty, required for local runs)
- `AGENTCONNECT_LOCAL_API_KEY` (optional)
- `AGENTCONNECT_LOCAL_MODELS` (optional JSON array of model IDs)
  Runtime config can also be supplied via `acp.providers.login` options for the local provider.

Expected endpoints:

- `GET /v1/models` -> `{ data: [{ id: "model-id" }] }`
- `POST /v1/chat/completions` -> `{ choices: [{ message: { content: "..." } }] }`
- If streaming is available, the host emits `delta` events as data arrives.

## AI runbook (command-only)

Use this block as a strict step-by-step script for a coding agent.
If `agentconnect` is not installed yet, replace it with `bun /path/to/agent-connect/packages/cli/src/index.ts`.

```bash
AGENTCONNECT_REPO="/path/to/agent-connect"
APP_NAME="My App"
APP_DIR="$HOME/projects/my-app"
DEV_URL="http://localhost:5173"
REGISTRY_REPO="<registry-repo-url>"
SIGNING_KEY="/path/to/private.key"
SIGNATURE_PATH="$APP_DIR/dist/app.sig.json"

bun "$AGENTCONNECT_REPO/scripts/new-app.mjs" --name "$APP_NAME" --out "$APP_DIR"
cd "$APP_DIR"
bun install
bun run dev
agentconnect dev --app . --ui "$DEV_URL"

bun run build
agentconnect pack --app . --out dist/app.zip
agentconnect verify --app dist/app.zip
agentconnect sign --app dist/app.zip --key "$SIGNING_KEY" --out "$SIGNATURE_PATH"

git clone "$REGISTRY_REPO"
cd "$(basename "$REGISTRY_REPO" .git)"
agentconnect publish --app "$APP_DIR/dist/app.zip" --registry . --signature "$SIGNATURE_PATH"
```

## Schemas

- `schemas/acp-envelope.json`: JSON-RPC envelope + error schema.
- `schemas/acp-methods.json`: ACP method params/results.
- `schemas/app-manifest.json`: app manifest schema.

## License

MIT. See `LICENSE`.
