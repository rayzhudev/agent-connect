# AgentConnect SDK Specification (v0)

## Summary

AgentConnect is a host-agnostic SDK and protocol that lets apps use local AI agent CLIs
(Claude Code, Codex CLI, Cursor CLI) and local models through a single interface. Apps run unchanged
in two environments:

- Local development with a standalone AgentConnect host.
- Inside a native host app that exposes the same protocol.

The host owns privileged operations, provider login, and process management. Apps can
bundle their own backend service, but the host always launches and manages it.

## Goals

- Provide a unified interface for Claude Code, Codex CLI, Cursor CLI, and local models.
- Allow apps to run locally and in a native host app with no code changes.
- Support host-managed app backends for full local capabilities.
- Offer one-click provider install and login, with a simple fallback path.
- Ship first-class UI components for login and model selection.
- Keep the ecosystem open via a public registry and open protocol.

## Non-goals

- Guarantee local-only inference.
- Hide provider usage or billing details.
- Preserve backwards compatibility at all costs.
- Provide a full app store UI in the SDK (host apps handle that).

## Design Principles

- Open protocol, multiple hosts, zero app lock-in.
- Host-managed privileged operations for safety and portability.
- Install-time permission consent, no runtime popups.
- Minimal app changes, predictable developer workflow.

## System Overview

### Components

- App UI: Web app built with any framework.
- App Backend (optional): Local service launched by the host.
- AgentConnect Client SDK: JS library used by apps.
- AgentConnect Host: native host app or standalone local dev host.
- Provider Adapters: Claude CLI, Codex CLI, Cursor CLI, local model connectors.
- Public Registry: Signed manifests and package metadata.

### Architecture (simplified)

```
App UI (web) <-> AgentConnect SDK <-> Host (native host app or Dev Host)
                                       |  - provider adapters
                                       |  - backend manager
                                       |  - permissions metadata
                                       |  - registry trust
                                       +-> Claude CLI / Codex CLI / Cursor CLI / Local model
```

## Runtime Model

- The App UI runs in a sandboxed web environment (no Node integration).
- The App Backend is optional and is always launched and managed by the host.
- The host exposes a single protocol for models, sessions, and host capabilities.

## Connection Model

The SDK connects to the host with no app changes:

1. Use the injected host bridge if present:
   - `window.__AGENTCONNECT_BRIDGE__`
2. Otherwise connect to local host:
   - `ws://127.0.0.1:9630` (default)
3. Optional override:
   - `?agentconnect=ws://...` or `AGENTCONNECT_HOST` env in dev tools.

## AgentConnect Protocol (ACP)

ACP uses JSON-RPC 2.0 over WebSocket or direct in-process bridge.

### Handshake

`acp.hello` returns:

```
{
  "hostId": "agentconnect-host",
  "hostName": "AgentConnect Host",
  "hostVersion": "0.0.0",
  "protocolVersion": "0.1",
  "mode": "hosted" | "local",
  "capabilities": ["fs.read", "process.spawn", "..."],
  "providers": ["claude", "codex", "cursor", "local"]
}
```

### Core Methods

Provider management:

- `acp.providers.list`
- `acp.providers.status`
- `acp.providers.ensureInstalled`
- `acp.providers.login`
- `acp.providers.logout`

Model discovery:

- `acp.models.list`
- `acp.models.recent`
- `acp.models.info`

Sessions:

- `acp.sessions.create`
- `acp.sessions.resume`
- `acp.sessions.send`
- `acp.sessions.cancel`
- `acp.sessions.close`

Host capabilities:

- `acp.capabilities.observed`
- `acp.fs.read`
- `acp.fs.write`
- `acp.fs.list`
- `acp.fs.stat`
- `acp.process.spawn`
- `acp.process.kill`
- `acp.net.request`
- `acp.storage.get`
- `acp.storage.set`
- `acp.clipboard.read`
- `acp.clipboard.write`
- `acp.system.open`

Backend lifecycle:

- `acp.backend.start`
- `acp.backend.stop`
- `acp.backend.status`

### Session Events (server push)

Events are pushed to the client over the same WebSocket:

```
{
  "method": "acp.session.event",
  "params": {
    "sessionId": "sess_123",
    "type": "delta" | "final" | "usage" | "status" | "error" | "raw_line" | "message" | "thinking" | "tool_call" | "detail",
    "data": { ... }
  }
}
```

### Error Model

Standard JSON-RPC errors with structured `code` values:

- `AC_ERR_UNAUTHORIZED`
- `AC_ERR_NOT_INSTALLED`
- `AC_ERR_INVALID_ARGS`
- `AC_ERR_UNSUPPORTED`
- `AC_ERR_INTERNAL`

### ACP Schemas (JSON Schema)

Stored in:

- `schemas/acp-envelope.json` (RPC envelope and error schema)
- `schemas/acp-methods.json` (method params and result schemas)

Method map (method -> params/result defs):

- `acp.hello`: `HelloParams` / `HelloResult`
- `acp.capabilities.observed`: `CapabilitiesObservedParams` / `CapabilitiesObservedResult`
- `acp.providers.list`: `ProvidersListParams` / `ProvidersListResult`
- `acp.providers.status`: `ProviderStatusParams` / `ProviderStatusResult`
- `acp.providers.ensureInstalled`: `ProviderEnsureParams` / `ProviderEnsureResult`
- `acp.providers.login`: `ProviderLoginParams` / `ProviderLoginResult`
- `acp.providers.logout`: `ProviderLoginParams` / `ProviderLoginResult`
- `acp.models.list`: `ModelsListParams` / `ModelsListResult`
- `acp.models.recent`: `ModelsRecentParams` / `ModelsRecentResult`
- `acp.models.info`: `ModelsInfoParams` / `ModelsInfoResult`
- `acp.sessions.create`: `SessionCreateParams` / `SessionCreateResult`
- `acp.sessions.resume`: `SessionResumeParams` / `SessionResumeResult`
- `acp.sessions.send`: `SessionSendParams` / `SessionSendResult`
- `acp.sessions.cancel`: `SessionCancelParams` / `SessionCancelResult`
- `acp.sessions.close`: `SessionCloseParams` / `SessionCloseResult`
- `acp.fs.read`: `FsReadParams` / `FsReadResult`
- `acp.fs.write`: `FsWriteParams` / `FsWriteResult`
- `acp.fs.list`: `FsListParams` / `FsListResult`
- `acp.fs.stat`: `FsStatParams` / `FsStatResult`
- `acp.process.spawn`: `ProcessSpawnParams` / `ProcessSpawnResult`
- `acp.process.kill`: `ProcessKillParams` / `ProcessKillResult`
- `acp.net.request`: `NetRequestParams` / `NetRequestResult`
- `acp.storage.get`: `StorageGetParams` / `StorageGetResult`
- `acp.storage.set`: `StorageSetParams` / `StorageSetResult`
- `acp.clipboard.read`: `ClipboardReadParams` / `ClipboardReadResult`
- `acp.clipboard.write`: `ClipboardWriteParams` / `ClipboardWriteResult`
- `acp.system.open`: `SystemOpenParams` / `SystemOpenResult`
- `acp.backend.start`: `BackendStartParams` / `BackendStartResult`
- `acp.backend.stop`: `BackendStopParams` / `BackendStopResult`
- `acp.backend.status`: `BackendStatusParams` / `BackendStatusResult`

## Capability and Permission Model

Apps request capabilities in the manifest. The host displays these during install or
first run and stores the consent decision. There are no runtime popups.

### Requested vs Observed

- Requested: from manifest.
- Observed: derived from actual host API calls and displayed in app details.

### Common Capability Names

- `agent.connect`
- `model.claude`, `model.codex`, `model.cursor`, `model.local`
- `fs.read`, `fs.write`, `fs.watch`
- `process.spawn`, `process.kill`
- `network.request`
- `storage.kv`
- `clipboard.read`, `clipboard.write`
- `backend.run`

## App Manifest and Packaging

Each app includes a manifest file at the root of its package:
`agentconnect.app.json`.

Example:

```
{
  "id": "com.agentconnect.agentic-notes",
  "name": "Agentic Notes",
  "version": "0.1.0",
  "entry": {
    "type": "web",
    "path": "dist/index.html"
  },
  "backend": {
    "runtime": "node",
    "command": "node",
    "args": ["server.js"],
    "cwd": ".",
    "env": { "PORT": "0" },
    "healthcheck": { "type": "http", "path": "/health" }
  },
  "capabilities": [
    "agent.connect",
    "model.claude",
    "fs.read",
    "fs.write",
    "process.spawn",
    "backend.run"
  ],
  "providers": ["claude", "codex", "cursor", "local"],
  "models": { "default": "claude-sonnet" },
  "icon": "icon.png",
  "repo": "https://github.com/example/agentic-notes",
  "license": "MIT",
  "author": { "name": "Example", "url": "https://example.com" }
}
```

Packaging rules:

- The package is a directory or zip containing the manifest and assets.
- The entry `path` is resolved relative to the package root.
- The backend entry is optional.

### Manifest Schema (JSON Schema)

Stored in:

- `schemas/app-manifest.json`

## Backend Service (Host-Managed)

If a backend is declared:

- The host launches it when the app starts.
- The host injects connection details via env:
  - `AGENTCONNECT_HOST`
  - `AGENTCONNECT_APP_ID`
  - `AGENTCONNECT_APP_PORT` (if allocated)
- The backend can expose its own HTTP or IPC port, but it must be declared in the manifest.

## Provider Install and Login Flow

The host provides a one-click path:

- `acp.providers.ensureInstalled` installs the CLI if missing.
- `acp.providers.login` runs the provider login flow (opens browser).
- If installation fails, the host presents a short fallback with copy/paste commands.

If already logged in, login is a no-op and the app proceeds.

## Local Provider (OpenAI-compatible)

The `local` provider targets the OpenAI-compatible HTTP API.

Required endpoints:

- `GET /v1/models` -> `{ data: [{ id: "model-id" }] }`
- `POST /v1/chat/completions` -> `{ choices: [{ message: { content: "..." } }] }`
- Streaming is optional; if supported, the host emits `delta` events per chunk.

Configuration (host environment):

- `AGENTCONNECT_LOCAL_BASE_URL` (default `http://localhost:11434/v1`)
- `AGENTCONNECT_LOCAL_API_KEY` (optional `Bearer` token)
- `AGENTCONNECT_LOCAL_MODEL` (fallback model when the app does not specify one)
- `AGENTCONNECT_LOCAL_MODELS` (optional JSON array to seed the model list)

Runtime configuration (optional):

- `acp.providers.login` can accept `options` with `baseUrl`, `apiKey`, `model`, and `models`.
- Hosts may persist these options in memory for the session.

Model selection:

- Apps can use `local` (fallback), `local:<id>`, or `local/<id>` to pin a specific model.
- The host resolves the model ID and sends it in the OpenAI-compatible request.

## SDK Surface

Minimal client API (TypeScript):

```
const client = await AgentConnect.connect();
const models = await client.models.list();
const session = await client.sessions.create({ model: "claude-opus" });
session.send("Hello");
session.on("delta", (text) => render(text));
```

### SDK API (TypeScript)

```ts
export type ProviderId = 'claude' | 'codex' | 'cursor' | 'local';

export type ProviderInfo = {
  id: ProviderId;
  name?: string;
  installed: boolean;
  loggedIn: boolean;
  version?: string;
};

export type ReasoningEffortOption = {
  id: string;
  label?: string;
};

export type ModelInfo = {
  id: string;
  provider: ProviderId;
  displayName?: string;
  contextWindow?: number;
  maxOutputTokens?: number;
  reasoningEfforts?: ReasoningEffortOption[];
  defaultReasoningEffort?: string;
};

export type SessionEvent =
  | { type: 'delta'; text: string; providerSessionId?: string | null; providerDetail?: ProviderDetail }
  | { type: 'final'; text: string; providerSessionId?: string | null; providerDetail?: ProviderDetail }
  | { type: 'usage'; usage: Record<string, number>; providerSessionId?: string | null; providerDetail?: ProviderDetail }
  | { type: 'status'; status: 'thinking' | 'idle' | 'error'; error?: string; providerSessionId?: string | null; providerDetail?: ProviderDetail }
  | { type: 'error'; message: string; providerSessionId?: string | null; providerDetail?: ProviderDetail }
  | { type: 'raw_line'; line: string; providerSessionId?: string | null; providerDetail?: ProviderDetail }
  | { type: 'message'; provider?: ProviderId; role: 'system' | 'user' | 'assistant'; content: string; contentParts?: unknown; providerSessionId?: string | null; providerDetail?: ProviderDetail }
  | { type: 'thinking'; provider?: ProviderId; phase: 'delta' | 'start' | 'completed' | 'error'; text?: string; timestampMs?: number; providerSessionId?: string | null; providerDetail?: ProviderDetail }
  | { type: 'tool_call'; provider?: ProviderId; name?: string; callId?: string; input?: unknown; output?: unknown; phase?: 'delta' | 'start' | 'completed' | 'error'; providerSessionId?: string | null; providerDetail?: ProviderDetail }
  | { type: 'detail'; provider?: ProviderId; providerSessionId?: string | null; providerDetail: ProviderDetail };

export type ProviderDetail = {
  eventType: string;
  data?: Record<string, unknown>;
  raw?: unknown;
};

export type ProviderLoginOptions = {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  models?: string[];
};

export type AgentConnectConnectOptions = {
  host?: string;
  preferInjected?: boolean;
  timeoutMs?: number;
};

export type SessionCreateOptions = {
  model: string;
  reasoningEffort?: string;
  system?: string;
  metadata?: Record<string, unknown>;
  cwd?: string;
  repoRoot?: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  providerDetailLevel?: 'minimal' | 'raw';
};

export type SessionSendOptions = {
  metadata?: Record<string, unknown>;
  cwd?: string;
  repoRoot?: string;
  providerDetailLevel?: 'minimal' | 'raw';
};

export type SessionResumeOptions = {
  model?: string;
  reasoningEffort?: string;
  providerSessionId?: string | null;
  cwd?: string;
  repoRoot?: string;
  providerDetailLevel?: 'minimal' | 'raw';
};

export interface AgentConnectSession {
  id: string;
  send(message: string, options?: SessionSendOptions | Record<string, unknown>): Promise<void>;
  cancel(): Promise<void>;
  close(): Promise<void>;
  on(type: SessionEvent['type'], handler: (ev: SessionEvent) => void): () => void;
}

export interface AgentConnectClient {
  hello(): Promise<{
    hostId: string;
    hostName: string;
    hostVersion: string;
    protocolVersion: string;
    mode: 'hosted' | 'local';
    capabilities: string[];
    providers: ProviderId[];
  }>;

  providers: {
    list(): Promise<ProviderInfo[]>;
    status(provider: ProviderId): Promise<ProviderInfo>;
    ensureInstalled(provider: ProviderId): Promise<{ installed: boolean; version?: string }>;
    login(provider: ProviderId, options?: ProviderLoginOptions): Promise<{ loggedIn: boolean }>;
    logout(provider: ProviderId): Promise<{ loggedIn: boolean }>;
  };

  models: {
    list(provider?: ProviderId): Promise<ModelInfo[]>;
    recent(provider?: ProviderId): Promise<ModelInfo[]>;
    info(model: string): Promise<ModelInfo>;
  };

  sessions: {
    create(options: SessionCreateOptions): Promise<AgentConnectSession>;
    resume(sessionId: string, options?: SessionResumeOptions): Promise<AgentConnectSession>;
  };

  fs: {
    read(path: string): Promise<{ content: string }>;
    write(path: string, content: string): Promise<{ bytes: number }>;
    list(path: string): Promise<{ entries: Array<{ name: string; path: string; type: string }> }>;
    stat(path: string): Promise<{ type: string; size: number; mtime: string }>;
  };

  process: {
    spawn(command: string, args?: string[]): Promise<{ pid: number }>;
    kill(pid: number, signal?: string): Promise<{ success: boolean }>;
  };

  net: {
    request(
      url: string,
      init?: { method?: string; headers?: Record<string, string>; body?: string }
    ): Promise<{
      status: number;
      headers: Record<string, string>;
      body: string;
    }>;
  };

  backend: {
    start(appId: string): Promise<{ status: string; url?: string }>;
    stop(appId: string): Promise<{ status: string }>;
    status(appId: string): Promise<{ status: string; url?: string }>;
  };
}
```

UI components (first-class, themeable):

- `AgentConnectProvider`
- `LoginButton`
- `LoginModal`
- `ModelPicker`
- `ProviderStatus`
- `PermissionList`

UI is delivered as Web Components with optional React/Svelte wrappers.

## Local Dev Host

The standalone host powers local development for any framework.

Suggested CLI commands:

- `agentconnect dev --app <path> --ui <url>`
- `agentconnect pack --app <path>`
- `agentconnect verify --app <path>`

The dev host exposes ACP at `ws://127.0.0.1:9630` by default.

## Registry

The public registry is a git repository containing:

- Manifest entries
- Package hashes
- Signature files

Auto-merge checks:

- JSON schema validation
- Package hash verification
- Signature verification

Host apps can show curated verified apps, while allowing direct installs by name or URL.

## Security Model

- App UI runs sandboxed with no Node integration.
- All privileged operations go through ACP.
- Host verifies signatures for registry installs.
- No runtime permission prompts; install-time consent only.

## Versioning

- ACP uses a `protocolVersion` string (start at `0.1`).
- The host reports its supported protocol versions.
- Breaking changes are allowed in `0.x` and can be gated by version checks.

## Open Ecosystem Commitments

- ACP is a published spec.
- SDK and reference host are open source.
- Apps are free to run outside any specific host if another host supports ACP.

## Reference Implementation Checklist

Host (native host app or local dev):

- Implement ACP server with JSON-RPC 2.0 envelope validation.
- Implement provider adapters for Claude CLI, Codex CLI, Cursor CLI, and local model backends.
- Provide one-click install/login flows and fallback instructions.
- Launch app backends with declared env and health checks.
- Persist app consent for install-time permissions.
- Emit session streaming events with delta/final/usage/status/message/thinking/tool_call/detail when available.
- Expose a sandboxed webview with injected bridge support.

SDK (client):

- Auto-connect flow (injected bridge -> localhost -> override).
- Typed wrappers for ACP methods and streaming events.
- First-class UI components with theme overrides.
- Dev tooling helpers for local host discovery.

Registry:

- JSON schema validation for manifests.
- Package hash verification.
- Signature verification.
- Automated PR checks and auto-merge rules.
