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
  updateAvailable?: boolean;
  latestVersion?: string;
  updateCheckedAt?: number;
  updateSource?: 'cli' | 'npm' | 'bun' | 'brew' | 'winget' | 'script' | 'unknown';
  updateCommand?: string;
  updateMessage?: string;
  updateInProgress?: boolean;
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

export type ProviderDetailLevel = 'minimal' | 'raw';

export type ProviderDetail = {
  eventType: string;
  data?: Record<string, unknown>;
  raw?: unknown;
};

export type SessionEvent =
  | {
      type: 'delta';
      text: string;
      providerSessionId?: string | null;
      providerDetail?: ProviderDetail;
    }
  | {
      type: 'final';
      text: string;
      cancelled?: boolean;
      providerSessionId?: string | null;
      providerDetail?: ProviderDetail;
    }
  | {
      type: 'summary';
      summary: string;
      source?: 'prompt';
      provider?: ProviderId;
      model?: string | null;
      createdAt?: string;
      providerSessionId?: string | null;
      providerDetail?: ProviderDetail;
    }
  | {
      type: 'usage';
      usage: Record<string, number>;
      providerSessionId?: string | null;
      providerDetail?: ProviderDetail;
    }
  | {
      type: 'status';
      status: 'thinking' | 'idle' | 'error';
      error?: string;
      providerSessionId?: string | null;
      providerDetail?: ProviderDetail;
    }
  | {
      type: 'error';
      message: string;
      cancelled?: boolean;
      providerSessionId?: string | null;
      providerDetail?: ProviderDetail;
    }
  | {
      type: 'raw_line';
      line: string;
      providerSessionId?: string | null;
      providerDetail?: ProviderDetail;
    }
  | {
      type: 'message';
      provider?: ProviderId;
      role: 'system' | 'user' | 'assistant';
      content: string;
      contentParts?: unknown;
      providerSessionId?: string | null;
      providerDetail?: ProviderDetail;
    }
  | {
      type: 'thinking';
      provider?: ProviderId;
      phase: 'delta' | 'start' | 'completed' | 'error';
      text?: string;
      timestampMs?: number;
      providerSessionId?: string | null;
      providerDetail?: ProviderDetail;
    }
  | {
      type: 'tool_call';
      provider?: ProviderId;
      name?: string;
      callId?: string;
      input?: unknown;
      output?: unknown;
      phase?: 'delta' | 'start' | 'completed' | 'error';
      providerSessionId?: string | null;
      providerDetail?: ProviderDetail;
    }
  | {
      type: 'detail';
      provider?: ProviderId;
      providerSessionId?: string | null;
      providerDetail: ProviderDetail;
    };

export type ProviderLoginOptions = {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  models?: string[];
  loginMethod?: 'claudeai' | 'console';
  loginExperience?: 'embedded' | 'terminal';
};

export type AgentConnectConnectOptions = {
  host?: string;
  preferInjected?: boolean;
  timeoutMs?: number;
  webSocket?: WebSocketConstructor;
};

export type SessionCreateOptions = {
  model?: string;
  provider?: ProviderId;
  reasoningEffort?: string;
  system?: string;
  metadata?: Record<string, unknown>;
  cwd?: string;
  repoRoot?: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  providerDetailLevel?: ProviderDetailLevel;
};

export type SessionSendOptions = {
  metadata?: Record<string, unknown>;
  cwd?: string;
  repoRoot?: string;
  providerDetailLevel?: ProviderDetailLevel;
};

export type SessionResumeOptions = {
  model?: string;
  reasoningEffort?: string;
  system?: string;
  providerSessionId?: string | null;
  cwd?: string;
  repoRoot?: string;
  providerDetailLevel?: ProviderDetailLevel;
};

export interface AgentConnectSession {
  id: string;
  send(message: string, metadata?: Record<string, unknown>): Promise<void>;
  send(message: string, options?: SessionSendOptions): Promise<void>;
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
    status(
      provider: ProviderId,
      options?: { fast?: boolean; force?: boolean }
    ): Promise<ProviderInfo>;
    ensureInstalled(provider: ProviderId): Promise<InstallResult>;
    update(provider: ProviderId): Promise<ProviderInfo>;
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

  storage: {
    get(key: string): Promise<{ value: unknown }>;
    set(key: string, value: unknown): Promise<{ ok: boolean }>;
  };

  backend: {
    start(appId: string): Promise<{ status: string; url?: string }>;
    stop(appId: string): Promise<{ status: string }>;
    status(appId: string): Promise<{ status: string; url?: string }>;
  };
}

type RpcId = string | number;

type RpcRequest = {
  jsonrpc: '2.0';
  id: RpcId;
  method: string;
  params?: Record<string, unknown>;
};

type RpcSuccess = {
  jsonrpc: '2.0';
  id: RpcId;
  result: unknown;
};

type RpcError = {
  jsonrpc: '2.0';
  id: RpcId;
  error: { code: string; message: string; data?: unknown };
};

type RpcNotification = {
  jsonrpc?: '2.0';
  method: string;
  params?: Record<string, unknown>;
};

type Unsubscribe = () => void;

type NotificationHandler = (notification: RpcNotification) => void;

type RpcTransport = {
  request(method: string, params?: Record<string, unknown>): Promise<unknown>;
  onNotification(handler: NotificationHandler): Unsubscribe;
  close?: () => void;
};

type AgentConnectBridge = {
  request(method: string, params?: Record<string, unknown>): Promise<unknown>;
  onEvent?: (handler: (event: RpcNotification) => void) => Unsubscribe;
};

type WebSocketLike = {
  addEventListener: (type: string, listener: (event: { data?: unknown }) => void) => void;
  removeEventListener: (type: string, listener: (event: { data?: unknown }) => void) => void;
  send: (data: string) => void;
  close: () => void;
};

type WebSocketConstructor = new (url: string) => WebSocketLike;

class WebSocketTransport implements RpcTransport {
  private socket: WebSocketLike;
  private pending = new Map<
    RpcId,
    { resolve: (value: unknown) => void; reject: (err: Error) => void }
  >();
  private notifyHandlers = new Set<NotificationHandler>();
  private nextId = 1;
  private ready: Promise<void>;
  private timeoutMs: number;
  private closed = false;

  constructor(url: string, timeoutMs: number, webSocket?: WebSocketConstructor) {
    const WebSocketCtor =
      webSocket || (globalThis as unknown as { WebSocket?: WebSocketConstructor }).WebSocket;
    if (!WebSocketCtor) {
      throw new Error(
        'WebSocket is not available in this environment. Provide AgentConnect.connect({ webSocket }) in Node.'
      );
    }

    this.socket = new WebSocketCtor(url);
    this.timeoutMs = timeoutMs;
    const handleDisconnect = (message: string) => {
      if (this.closed) return;
      this.closed = true;
      for (const pending of this.pending.values()) {
        pending.reject(new Error(message));
      }
      this.pending.clear();
    };

    this.ready = new Promise((resolve, reject) => {
      const onOpen = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error('Failed to connect to AgentConnect host.'));
      };
      const onClose = () => {
        cleanup();
        reject(new Error('AgentConnect connection closed.'));
      };
      const cleanup = () => {
        this.socket.removeEventListener('open', onOpen);
        this.socket.removeEventListener('error', onError);
        this.socket.removeEventListener('close', onClose);
      };
      this.socket.addEventListener('open', onOpen);
      this.socket.addEventListener('error', onError);
      this.socket.addEventListener('close', onClose);
    });

    this.socket.addEventListener('close', () => {
      handleDisconnect('AgentConnect connection closed.');
    });

    this.socket.addEventListener('error', () => {
      handleDisconnect('AgentConnect connection error.');
    });

    this.socket.addEventListener('message', (event) => {
      const payload = typeof event.data === 'string' ? event.data : '';
      if (!payload) return;
      let msg: RpcSuccess | RpcError | RpcNotification;
      try {
        msg = JSON.parse(payload);
      } catch {
        return;
      }

      if ('id' in msg && (msg as RpcSuccess).result !== undefined) {
        const pending = this.pending.get(msg.id);
        if (pending) {
          this.pending.delete(msg.id);
          pending.resolve((msg as RpcSuccess).result);
        }
        return;
      }

      if ('id' in msg && (msg as RpcError).error) {
        const pending = this.pending.get(msg.id);
        if (pending) {
          this.pending.delete(msg.id);
          const err = (msg as RpcError).error;
          pending.reject(new Error(`${err.code}: ${err.message}`));
        }
        return;
      }

      if ('method' in msg && !('id' in msg)) {
        for (const handler of this.notifyHandlers) {
          handler(msg as RpcNotification);
        }
      }
    });
  }

  async request(method: string, params?: Record<string, unknown>): Promise<unknown> {
    await this.ready;
    if (this.closed) {
      throw new Error('AgentConnect connection closed.');
    }
    const id = this.nextId++;
    const payload: RpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    const timeout = this.timeoutMs;
    return new Promise((resolve, reject) => {
      const timer = timeout
        ? setTimeout(() => {
            this.pending.delete(id);
            reject(new Error('AgentConnect request timed out.'));
          }, timeout)
        : null;

      this.pending.set(id, {
        resolve: (value) => {
          if (timer) clearTimeout(timer);
          resolve(value);
        },
        reject: (err) => {
          if (timer) clearTimeout(timer);
          reject(err);
        },
      });

      this.socket.send(JSON.stringify(payload));
    });
  }

  onNotification(handler: NotificationHandler): Unsubscribe {
    this.notifyHandlers.add(handler);
    return () => {
      this.notifyHandlers.delete(handler);
    };
  }

  close(): void {
    this.socket.close();
  }
}

class BridgeTransport implements RpcTransport {
  private bridge: AgentConnectBridge;

  constructor(bridge: AgentConnectBridge) {
    this.bridge = bridge;
  }

  request(method: string, params?: Record<string, unknown>): Promise<unknown> {
    return this.bridge.request(method, params);
  }

  onNotification(handler: NotificationHandler): Unsubscribe {
    if (!this.bridge.onEvent) {
      return () => {};
    }
    return this.bridge.onEvent(handler);
  }
}

class AgentConnectSessionImpl implements AgentConnectSession {
  readonly id: string;
  private client: AgentConnectClientImpl;
  private listeners = new Map<SessionEvent['type'], Set<(ev: SessionEvent) => void>>();

  constructor(id: string, client: AgentConnectClientImpl) {
    this.id = id;
    this.client = client;
  }

  async send(
    message: string,
    options?: SessionSendOptions | Record<string, unknown>
  ): Promise<void> {
    const normalized = this.normalizeSendOptions(options);
    await this.client.request('acp.sessions.send', {
      sessionId: this.id,
      message: { role: 'user', content: message },
      metadata: normalized.metadata,
      cwd: normalized.cwd,
      repoRoot: normalized.repoRoot,
      providerDetailLevel: normalized.providerDetailLevel,
    });
  }

  async cancel(): Promise<void> {
    await this.client.request('acp.sessions.cancel', { sessionId: this.id });
  }

  async close(): Promise<void> {
    try {
      await this.client.request('acp.sessions.close', { sessionId: this.id });
    } finally {
      this.client.dropSession(this.id);
    }
  }

  on(type: SessionEvent['type'], handler: (ev: SessionEvent) => void): Unsubscribe {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    const set = this.listeners.get(type);
    if (set) set.add(handler);
    return () => {
      set?.delete(handler);
    };
  }

  emit(event: SessionEvent): void {
    const handlers = this.listeners.get(event.type);
    if (!handlers) return;
    for (const handler of handlers) {
      handler(event);
    }
  }

  private normalizeSendOptions(
    options?: SessionSendOptions | Record<string, unknown>
  ): SessionSendOptions {
    if (!options) return {};
    const candidate = options as SessionSendOptions;
    if (
      'metadata' in candidate ||
      'cwd' in candidate ||
      'repoRoot' in candidate ||
      'providerDetailLevel' in candidate
    ) {
      return candidate;
    }
    return { metadata: options };
  }
}

class AgentConnectClientImpl implements AgentConnectClient {
  private transport: RpcTransport;
  private sessionStore = new Map<string, AgentConnectSessionImpl>();

  constructor(transport: RpcTransport) {
    this.transport = transport;
    this.transport.onNotification((notification) => {
      if (notification.method !== 'acp.session.event') return;
      const params = notification.params ?? {};
      const sessionId = String(params.sessionId ?? '');
      if (!sessionId) return;
      const session = this.sessionStore.get(sessionId);
      if (!session) return;
      const type = String(params.type ?? '');
      const data = params.data as Record<string, unknown> | undefined;
      const event = this.normalizeEvent(type, data);
      if (event) session.emit(event);
    });
  }

  private normalizeEvent(type: string, data?: Record<string, unknown>): SessionEvent | null {
    const parseProviderDetail = (): ProviderDetail | undefined => {
      const detail = data?.providerDetail;
      if (!detail || typeof detail !== 'object') return undefined;
      const record = detail as Record<string, unknown>;
      const eventType = typeof record.eventType === 'string' ? record.eventType : '';
      if (!eventType) return undefined;
      const raw = 'raw' in record ? record.raw : undefined;
      const dataField =
        record.data && typeof record.data === 'object'
          ? (record.data as Record<string, unknown>)
          : undefined;
      const out: ProviderDetail = { eventType };
      if (dataField) out.data = dataField;
      if (raw !== undefined) out.raw = raw;
      return out;
    };
    const providerDetail = parseProviderDetail();
    const providerSessionId =
      typeof data?.providerSessionId === 'string' ? data.providerSessionId : undefined;
    if (type === 'delta') {
      return {
        type: 'delta',
        text: String(data?.text ?? ''),
        providerSessionId,
        ...(providerDetail && { providerDetail }),
      };
    }
    if (type === 'final') {
      const providerSessionId =
        typeof data?.providerSessionId === 'string'
          ? data.providerSessionId
          : typeof data?.sessionId === 'string'
            ? data.sessionId
            : undefined;
      return {
        type: 'final',
        text: String(data?.text ?? ''),
        cancelled: typeof data?.cancelled === 'boolean' ? data.cancelled : undefined,
        providerSessionId,
        ...(providerDetail && { providerDetail }),
      };
    }
    if (type === 'summary') {
      const summary = typeof data?.summary === 'string' ? data.summary : '';
      if (!summary) return null;
      const provider =
        typeof data?.provider === 'string' ? (data.provider as ProviderId) : undefined;
      const source = data?.source === 'prompt' ? data.source : undefined;
      const model = typeof data?.model === 'string' ? data.model : undefined;
      const createdAt = typeof data?.createdAt === 'string' ? data.createdAt : undefined;
      return {
        type: 'summary',
        summary,
        source,
        provider,
        model,
        createdAt,
        providerSessionId,
        ...(providerDetail && { providerDetail }),
      };
    }
    if (type === 'usage') {
      return {
        type: 'usage',
        usage: (data?.usage as Record<string, number>) ?? {},
        providerSessionId,
        ...(providerDetail && { providerDetail }),
      };
    }
    if (type === 'status') {
      const status = String(data?.status ?? 'idle') as 'thinking' | 'idle' | 'error';
      const error = typeof data?.error === 'string' ? data.error : undefined;
      return {
        type: 'status',
        status,
        error,
        providerSessionId,
        ...(providerDetail && { providerDetail }),
      };
    }
    if (type === 'error') {
      return {
        type: 'error',
        message: String(data?.message ?? 'Unknown error'),
        cancelled: typeof data?.cancelled === 'boolean' ? data.cancelled : undefined,
        providerSessionId,
        ...(providerDetail && { providerDetail }),
      };
    }
    if (type === 'raw_line') {
      return {
        type: 'raw_line',
        line: String(data?.line ?? ''),
        providerSessionId,
        ...(providerDetail && { providerDetail }),
      };
    }
    if (type === 'message') {
      const provider =
        typeof data?.provider === 'string' ? (data.provider as ProviderId) : undefined;
      const role =
        data?.role === 'system' || data?.role === 'user' || data?.role === 'assistant'
          ? data.role
          : 'assistant';
      const content = String(data?.content ?? '');
      const contentParts = data?.contentParts;
      return {
        type: 'message',
        provider,
        role,
        content,
        contentParts,
        providerSessionId,
        providerDetail,
      };
    }
    if (type === 'thinking') {
      const provider =
        typeof data?.provider === 'string' ? (data.provider as ProviderId) : undefined;
      const phase =
        data?.phase === 'start' ||
        data?.phase === 'completed' ||
        data?.phase === 'error' ||
        data?.phase === 'delta'
          ? data.phase
          : 'delta';
      const text = typeof data?.text === 'string' ? data.text : undefined;
      const timestampMs = typeof data?.timestampMs === 'number' ? data.timestampMs : undefined;
      return {
        type: 'thinking',
        provider,
        phase,
        text,
        timestampMs,
        providerSessionId,
        providerDetail,
      };
    }
    if (type === 'tool_call') {
      const provider =
        typeof data?.provider === 'string' ? (data.provider as ProviderId) : undefined;
      const name = typeof data?.name === 'string' ? data.name : undefined;
      const callId = typeof data?.callId === 'string' ? data.callId : undefined;
      const phase =
        data?.phase === 'start' ||
        data?.phase === 'completed' ||
        data?.phase === 'error' ||
        data?.phase === 'delta'
          ? data.phase
          : undefined;
      return {
        type: 'tool_call',
        provider,
        name,
        callId,
        input: data?.input,
        output: data?.output,
        phase,
        providerSessionId,
        providerDetail,
      };
    }
    if (type === 'detail' && providerDetail) {
      const provider =
        typeof data?.provider === 'string' ? (data.provider as ProviderId) : undefined;
      return { type: 'detail', provider, providerDetail, providerSessionId };
    }
    return null;
  }

  request(method: string, params?: Record<string, unknown>): Promise<unknown> {
    return this.transport.request(method, params);
  }

  async hello(): Promise<{
    hostId: string;
    hostName: string;
    hostVersion: string;
    protocolVersion: string;
    mode: 'hosted' | 'local';
    capabilities: string[];
    providers: ProviderId[];
    loginExperience?: 'embedded' | 'terminal';
  }> {
    return (await this.request('acp.hello')) as AgentConnectClient['hello'] extends () => Promise<
      infer T
    >
      ? T
      : never;
  }

  close(): void {
    this.transport.close?.();
  }

  providers = {
    list: async (): Promise<ProviderInfo[]> => {
      const res = (await this.request('acp.providers.list')) as { providers: ProviderInfo[] };
      return res.providers ?? [];
    },
    status: async (
      provider: ProviderId,
      options?: { fast?: boolean; force?: boolean }
    ): Promise<ProviderInfo> => {
      const res = (await this.request('acp.providers.status', { provider, options })) as {
        provider: ProviderInfo;
      };
      return res.provider;
    },
    update: async (provider: ProviderId): Promise<ProviderInfo> => {
      const res = (await this.request('acp.providers.update', { provider })) as {
        provider: ProviderInfo;
      };
      return res.provider;
    },
    ensureInstalled: async (provider: ProviderId): Promise<InstallResult> => {
      return (await this.request('acp.providers.ensureInstalled', { provider })) as InstallResult;
    },
    login: async (
      provider: ProviderId,
      options?: ProviderLoginOptions
    ): Promise<{ loggedIn: boolean }> => {
      return (await this.request('acp.providers.login', { provider, options })) as {
        loggedIn: boolean;
      };
    },
    logout: async (provider: ProviderId): Promise<{ loggedIn: boolean }> => {
      return (await this.request('acp.providers.logout', { provider })) as { loggedIn: boolean };
    },
  };

  models = {
    list: async (provider?: ProviderId): Promise<ModelInfo[]> => {
      const res = (await this.request('acp.models.list', provider ? { provider } : undefined)) as {
        models: ModelInfo[];
      };
      return res.models ?? [];
    },
    recent: async (provider?: ProviderId): Promise<ModelInfo[]> => {
      const res = (await this.request(
        'acp.models.recent',
        provider ? { provider } : undefined
      )) as { models: ModelInfo[] };
      return res.models ?? [];
    },
    info: async (model: string): Promise<ModelInfo> => {
      const res = (await this.request('acp.models.info', { model })) as { model: ModelInfo };
      return res.model;
    },
  };

  capabilities = {
    observed: async (
      appId?: string
    ): Promise<{
      appId: string;
      requested: string[];
      observed: string[];
      updatedAt: string;
    }> => {
      return (await this.request('acp.capabilities.observed', appId ? { appId } : undefined)) as {
        appId: string;
        requested: string[];
        observed: string[];
        updatedAt: string;
      };
    },
  };

  sessions = {
    create: async (options: SessionCreateOptions): Promise<AgentConnectSession> => {
      const res = (await this.request('acp.sessions.create', options)) as { sessionId: string };
      return this.getOrCreateSession(res.sessionId);
    },
    resume: async (
      sessionId: string,
      options?: SessionResumeOptions
    ): Promise<AgentConnectSession> => {
      await this.request('acp.sessions.resume', { sessionId, ...(options ?? {}) });
      return this.getOrCreateSession(sessionId);
    },
  };

  fs = {
    read: async (path: string): Promise<{ content: string }> => {
      return (await this.request('acp.fs.read', { path })) as { content: string };
    },
    write: async (path: string, content: string): Promise<{ bytes: number }> => {
      return (await this.request('acp.fs.write', { path, content })) as { bytes: number };
    },
    list: async (
      path: string
    ): Promise<{ entries: Array<{ name: string; path: string; type: string }> }> => {
      return (await this.request('acp.fs.list', { path })) as {
        entries: Array<{ name: string; path: string; type: string }>;
      };
    },
    stat: async (path: string): Promise<{ type: string; size: number; mtime: string }> => {
      return (await this.request('acp.fs.stat', { path })) as {
        type: string;
        size: number;
        mtime: string;
      };
    },
  };

  process = {
    spawn: async (command: string, args?: string[]): Promise<{ pid: number }> => {
      return (await this.request('acp.process.spawn', { command, args })) as { pid: number };
    },
    kill: async (pid: number, signal?: string): Promise<{ success: boolean }> => {
      return (await this.request('acp.process.kill', { pid, signal })) as { success: boolean };
    },
  };

  net = {
    request: async (
      url: string,
      init?: { method?: string; headers?: Record<string, string>; body?: string }
    ): Promise<{ status: number; headers: Record<string, string>; body: string }> => {
      return (await this.request('acp.net.request', { url, ...init })) as {
        status: number;
        headers: Record<string, string>;
        body: string;
      };
    },
  };

  storage = {
    get: async (key: string): Promise<{ value: unknown }> => {
      return (await this.request('acp.storage.get', { key })) as { value: unknown };
    },
    set: async (key: string, value: unknown): Promise<{ ok: boolean }> => {
      return (await this.request('acp.storage.set', { key, value })) as { ok: boolean };
    },
  };

  backend = {
    start: async (appId: string): Promise<{ status: string; url?: string }> => {
      return (await this.request('acp.backend.start', { appId })) as {
        status: string;
        url?: string;
      };
    },
    stop: async (appId: string): Promise<{ status: string }> => {
      return (await this.request('acp.backend.stop', { appId })) as { status: string };
    },
    status: async (appId: string): Promise<{ status: string; url?: string }> => {
      return (await this.request('acp.backend.status', { appId })) as {
        status: string;
        url?: string;
      };
    },
  };

  private getOrCreateSession(sessionId: string): AgentConnectSessionImpl {
    const existing = this.sessionStore.get(sessionId);
    if (existing) return existing;
    const session = new AgentConnectSessionImpl(sessionId, this);
    this.sessionStore.set(sessionId, session);
    return session;
  }

  dropSession(sessionId: string): void {
    this.sessionStore.delete(sessionId);
  }
}

export class AgentConnect {
  static async connect(options: AgentConnectConnectOptions = {}): Promise<AgentConnectClient> {
    const { host, preferInjected = true, timeoutMs = 8000, webSocket } = options;

    const injected = getInjectedBridge();
    if (preferInjected && injected) {
      return new AgentConnectClientImpl(new BridgeTransport(injected));
    }

    const target = host || resolveHostOverride() || 'ws://127.0.0.1:9630';
    const transport = new WebSocketTransport(target, timeoutMs, webSocket);
    return new AgentConnectClientImpl(transport);
  }
}

function getInjectedBridge(): AgentConnectBridge | null {
  const candidate = (globalThis as unknown as { __AGENTCONNECT_BRIDGE__?: AgentConnectBridge })
    .__AGENTCONNECT_BRIDGE__;
  return candidate ?? null;
}

function resolveHostOverride(): string | null {
  const location = (globalThis as unknown as { location?: { search?: string } }).location;
  if (location?.search) {
    const params = new URLSearchParams(location.search);
    const override = params.get('agentconnect');
    if (override) return override;
  }

  if (typeof process !== 'undefined' && typeof process.env !== 'undefined') {
    const env = process.env.AGENTCONNECT_HOST;
    if (env) return env;
  }

  return null;
}
