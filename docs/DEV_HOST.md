# AgentConnect Dev Host

Use the CLI host during development or embed the host in your own app.

## Install

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
