# AgentConnect SDK Reference

This document describes the public SDK surface. It is source-of-truth for SDK consumers.

## Connect

```ts
import { AgentConnect } from '@agentconnect/sdk';

const client = await AgentConnect.connect({
  host: 'ws://127.0.0.1:9630',
  preferInjected: true,
  timeoutMs: 8000,
  webSocket: WebSocket, // Node only
});
```

## Types

```ts
export type ProviderId = 'claude' | 'codex' | 'cursor' | 'local';

export type PackageManager = 'bun' | 'pnpm' | 'npm' | 'brew' | 'unknown';

export type InstallResult = {
  installed: boolean;
  version?: string;
  packageManager?: PackageManager;
};

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

export type ProviderLoginOptions = {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  models?: string[];
  loginMethod?: 'claudeai' | 'console';
  loginExperience?: 'embedded' | 'terminal';
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
```

## Client API

```ts
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
    loginExperience?: 'embedded' | 'terminal';
  }>;

  close(): void;

  providers: {
    list(): Promise<ProviderInfo[]>;
    status(provider: ProviderId): Promise<ProviderInfo>;
    ensureInstalled(provider: ProviderId): Promise<InstallResult>;
    login(provider: ProviderId, options?: ProviderLoginOptions): Promise<{ loggedIn: boolean }>;
    logout(provider: ProviderId): Promise<{ loggedIn: boolean }>;
  };

  models: {
    list(provider?: ProviderId): Promise<ModelInfo[]>;
    recent(provider?: ProviderId): Promise<ModelInfo[]>;
    info(model: string): Promise<ModelInfo>;
  };

  capabilities: {
    observed(appId?: string): Promise<{
      appId: string;
      requested: string[];
      observed: string[];
      updatedAt: string;
    }>;
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
    ): Promise<{ status: number; headers: Record<string, string>; body: string }>;
  };

  backend: {
    start(appId: string): Promise<{ status: string; url?: string }>;
    stop(appId: string): Promise<{ status: string }>;
    status(appId: string): Promise<{ status: string; url?: string }>;
  };
}
```

## Usage examples

### Streaming

```ts
const client = await AgentConnect.connect();
const session = await client.sessions.create({ model: 'default' });

session.on('delta', (event) => {
  process.stdout.write(event.text);
});

session.on('final', (event) => {
  console.log('\nFinal:', event.text);
});

session.on('error', (event) => {
  console.error('Error:', event.message);
});

await session.send('Summarize the main points.');
```

### Working directory and resume

```ts
const session = await client.sessions.create({
  model: 'codex',
  cwd: '/path/to/project',
  repoRoot: '/path/to/project',
});

session.on('final', (event) => {
  console.log('Provider session:', event.providerSessionId);
});

await session.send('Review the README for clarity.', { cwd: '/path/to/project/docs' });

await client.sessions.resume('sess_123', {
  providerSessionId: 'provider-session-id',
  cwd: '/path/to/project',
});
```

### Provider detail

```ts
session.on('raw_line', (event) => {
  console.log('[cli]', event.line);
});

session.on('detail', (event) => {
  if (event.provider === 'codex') {
    console.log(event.providerDetail);
  }
});
```
