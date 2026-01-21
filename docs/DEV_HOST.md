# AgentConnect Dev Host

Use the CLI host during development. For embedded hosts (apps with a backend), use `@agentconnect/host`.

## Install (CLI dev host)

```bash
npm install -g @agentconnect/cli
```

```bash
bun add -g @agentconnect/cli
```

## Run

```bash
agentconnect dev --app . --ui http://localhost:5173
```

`@agentconnect/cli` is a thin wrapper around `startDevHost` from `@agentconnect/host`.

## Embedded host (server/runtime)

Install the host package alongside your backend:

```bash
npm install @agentconnect/host
```

```bash
bun add @agentconnect/host
```

Create and inject a bridge (exposed for the SDK to pick up):

```ts
import { createHostBridge } from '@agentconnect/host';

const bridge = createHostBridge({
  mode: 'embedded',
  basePath: process.cwd(),
});

globalThis.__AGENTCONNECT_BRIDGE__ = bridge;
```

The SDK will automatically use the injected bridge when `preferInjected` is true (default).

## Embedded host patterns

### Same-process usage (Node routes, workers, desktop apps)

Use the in-process bridge when the SDK runs in the same JavaScript runtime as the host:

```ts
import { AgentConnect } from '@agentconnect/sdk';
import { createHostBridge } from '@agentconnect/host';

globalThis.__AGENTCONNECT_BRIDGE__ = createHostBridge({
  mode: 'embedded',
  basePath: process.cwd(),
});

const client = await AgentConnect.connect({ preferInjected: true });
```

For desktop apps (Electron/Tauri), inject the bridge in the preload/main process so
`window.__AGENTCONNECT_BRIDGE__` is available to the renderer.

### Separate frontend (browser) + backend

If the SDK runs in the browser, it cannot access the backend bridge directly.
In that case, run a WebSocket host in your backend using `startDevHost`:

```ts
import { startDevHost } from '@agentconnect/host';

startDevHost({
  host: '127.0.0.1',
  port: 9630,
  appPath: process.cwd(),
  mode: 'dev',
});
```

Then connect from the browser:

```ts
import { AgentConnect } from '@agentconnect/sdk';

const client = await AgentConnect.connect({
  host: 'ws://127.0.0.1:9630',
});
```

## Provider configuration

The host expects `claude`, `codex`, and `cursor-agent` CLIs on your PATH. Override commands with:

- `AGENTCONNECT_CLAUDE_COMMAND`
- `AGENTCONNECT_CLAUDE_INSTALL`
- `AGENTCONNECT_CLAUDE_LOGIN`
- `AGENTCONNECT_CLAUDE_STATUS`
- `AGENTCONNECT_CODEX_COMMAND`
- `AGENTCONNECT_CODEX_INSTALL`
- `AGENTCONNECT_CODEX_LOGIN`
- `AGENTCONNECT_CODEX_STATUS`
- `AGENTCONNECT_CURSOR_COMMAND`
- `AGENTCONNECT_CURSOR_INSTALL`
- `AGENTCONNECT_CURSOR_LOGIN`
- `AGENTCONNECT_CURSOR_STATUS`

Default login/status behaviors:

- Claude install defaults to the official script (macOS/Linux/WSL: `curl -fsSL https://claude.ai/install.sh | bash`, Windows PowerShell: `irm https://claude.ai/install.ps1 | iex`).
- Claude login runs `claude --print` with `/login` and checks for local auth files.
- Codex login runs `codex login` and status uses `codex login status`.
- For device auth, set `AGENTCONNECT_CODEX_LOGIN="codex login --device-auth"`.
- Cursor install defaults to `curl https://cursor.com/install -fsS | bash`.
- Cursor login runs `cursor-agent login` and status uses `cursor-agent status`.

Cursor environment variables (optional):

- `CURSOR_API_KEY` or `AGENTCONNECT_CURSOR_API_KEY` (non-interactive auth)
- `AGENTCONNECT_CURSOR_ENDPOINT` (override API endpoint)
- `AGENTCONNECT_CURSOR_MODEL` (default model ID)
- `AGENTCONNECT_CURSOR_MODELS` (JSON array of model IDs)

## Local model support (OpenAI-compatible HTTP API)

Environment variables:

- `AGENTCONNECT_LOCAL_BASE_URL` (default `http://localhost:11434/v1`)
- `AGENTCONNECT_LOCAL_MODEL` (default empty, required for local runs)
- `AGENTCONNECT_LOCAL_API_KEY` (optional)
- `AGENTCONNECT_LOCAL_MODELS` (optional JSON array of model IDs)

Runtime configuration can also be supplied via `acp.providers.login` options.

Expected endpoints:

- `GET /v1/models` -> `{ data: [{ id: "model-id" }] }`
- `POST /v1/chat/completions` -> `{ choices: [{ message: { content: "..." } }] }`
