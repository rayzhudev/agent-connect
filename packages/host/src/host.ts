import http from 'http';
import { WebSocketServer, type WebSocket } from 'ws';
import { spawn, type ChildProcess } from 'child_process';
import fs from 'fs';
import { promises as fsp } from 'fs';
import net from 'net';
import path from 'path';
import type {
  RpcId,
  RpcErrorCode,
  AppManifest,
  ProviderId,
  SessionState,
  BackendState,
  ProviderStatus,
  ProviderInfo,
  InstallResult,
  ProviderLoginOptions,
} from './types.js';
import {
  listModels,
  listRecentModels,
  providers,
  resolveProviderForModel,
} from './providers/index.js';
import { debugLog, setSpawnLogging } from './providers/utils.js';
import { createObservedTracker } from './observed.js';
import { createStorage } from './storage.js';
import {
  buildSummaryPrompt,
  buildSummaryPromptWithOverride,
  getSummaryModel,
  runSummaryPrompt,
  type SummaryPayload,
} from './summary.js';

interface RpcPayload {
  jsonrpc?: string;
  id?: RpcId;
  method?: string;
  params?: Record<string, unknown>;
}

type RpcResult = Record<string, unknown> | InstallResult;

type RpcNotification = {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown>;
};

type RpcResponder = {
  reply: (id: RpcId, result: RpcResult) => void;
  error: (id: RpcId, code: RpcErrorCode, message: string) => void;
  emit: (notification: RpcNotification) => void;
};

export type HostMode = 'embedded' | 'dev';

export type HostLogger = {
  debug?: (message: string, meta?: Record<string, unknown>) => void;
  info?: (message: string, meta?: Record<string, unknown>) => void;
  warn?: (message: string, meta?: Record<string, unknown>) => void;
  error?: (message: string, meta?: Record<string, unknown>) => void;
};

export interface HostOptions {
  mode?: HostMode;
  basePath?: string;
  appManifest?: AppManifest | null;
  providerConfig?: Partial<Record<ProviderId, ProviderLoginOptions>>;
  hostId?: string;
  hostName?: string;
  hostVersion?: string;
  logSpawn?: boolean;
  log?: HostLogger;
}

export interface DevHostOptions extends HostOptions {
  host?: string;
  port?: number;
  appPath?: string;
  uiUrl?: string;
}

export type AgentConnectBridge = {
  request: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
  onEvent?: (handler: (event: RpcNotification) => void) => () => void;
};

type HostRuntimeOptions = HostOptions & {
  modeDefault: HostMode;
  host?: string;
  port?: number;
};

type HostRuntime = {
  handleRpc: (payload: RpcPayload, responder: RpcResponder) => Promise<void>;
  flush: () => void;
};

type ActiveRun = {
  controller: AbortController;
  emit: RpcResponder['emit'];
  token: string;
};

function send(socket: WebSocket, payload: object): void {
  socket.send(JSON.stringify(payload));
}

function buildProviderList(statuses: Record<string, ProviderStatus>): ProviderInfo[] {
  return Object.values(providers).map((provider) => {
    const info = statuses[provider.id] || {};
    return {
      id: provider.id,
      name: provider.name,
      installed: info.installed ?? false,
      loggedIn: info.loggedIn ?? false,
      version: info.version,
      updateAvailable: info.updateAvailable,
      latestVersion: info.latestVersion,
      updateCheckedAt: info.updateCheckedAt,
      updateSource: info.updateSource,
      updateCommand: info.updateCommand,
      updateMessage: info.updateMessage,
      updateInProgress: info.updateInProgress,
    };
  });
}

function resolveLoginExperience(mode: HostMode): 'embedded' | 'terminal' {
  const raw =
    process.env.AGENTCONNECT_LOGIN_EXPERIENCE || process.env.AGENTCONNECT_CLAUDE_LOGIN_EXPERIENCE;
  if (raw) {
    const normalized = raw.trim().toLowerCase();
    if (normalized === 'terminal' || normalized === 'manual') return 'terminal';
    if (normalized === 'embedded' || normalized === 'pty') return 'embedded';
  }
  return mode === 'dev' ? 'terminal' : 'embedded';
}

function createHostRuntime(options: HostRuntimeOptions): HostRuntime {
  const mode = options.mode ?? options.modeDefault;
  process.env.AGENTCONNECT_HOST_MODE ||= mode;
  const basePath = options.basePath || process.cwd();
  const manifest = options.appManifest ?? readManifest(basePath);
  const appId = manifest?.id || (mode === 'dev' ? 'agentconnect-dev-app' : 'agentconnect-app');
  const requestedCapabilities = Array.isArray(manifest?.capabilities) ? manifest.capabilities : [];
  const observedTracker = createObservedTracker({
    basePath,
    appId,
    requested: requestedCapabilities,
  });
  const storage = createStorage({ basePath, appId });

  const sessions = new Map<string, SessionState>();
  const activeRuns = new Map<string, ActiveRun>();
  const updatingProviders = new Map<ProviderId, Promise<ProviderStatus>>();
  const processTable = new Map<number, ChildProcess>();
  const backendState = new Map<string, BackendState>();
  const statusCache = new Map<string, { status: ProviderStatus; at: number }>();
  const statusCacheTtlMs = 8000;
  const statusInFlight = new Map<ProviderId, Promise<ProviderStatus>>();
  const hostAddress = options.host || '127.0.0.1';
  const hostPort = options.port || 9630;
  const providerDefaults = options.providerConfig || {};
  const hostId = options.hostId || (mode === 'dev' ? 'agentconnect-dev' : 'agentconnect-host');
  const hostName =
    options.hostName || (mode === 'dev' ? 'AgentConnect Dev Host' : 'AgentConnect Host');
  const hostVersion = options.hostVersion || '0.1.0';
  setSpawnLogging(Boolean(options.logSpawn));

  function resolveAppPathInternal(input: unknown): string {
    if (!input) return basePath;
    const value = String(input);
    return path.isAbsolute(value) ? value : path.resolve(basePath, value);
  }

  function mapFileType(stat: fs.Stats): 'file' | 'dir' | 'link' | 'other' {
    if (stat.isFile()) return 'file';
    if (stat.isDirectory()) return 'dir';
    if (stat.isSymbolicLink()) return 'link';
    return 'other';
  }

  async function allocatePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const socket = net.createServer();
      socket.listen(0, hostAddress, () => {
        const address = socket.address();
        if (!address || typeof address === 'string') {
          socket.close();
          reject(new Error('Failed to allocate port.'));
          return;
        }
        const portValue = address.port;
        socket.close(() => resolve(portValue));
      });
      socket.on('error', reject);
    });
  }

  async function waitForHealthcheck(url: string, timeoutMs = 15000): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const res = await fetch(url, { method: 'GET' });
        if (res.ok) return true;
      } catch {
        // ignore
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    return false;
  }

  function readManifest(root: string): AppManifest | null {
    try {
      const raw = fs.readFileSync(path.join(root, 'agentconnect.app.json'), 'utf8');
      return JSON.parse(raw) as AppManifest;
    } catch {
      return null;
    }
  }

  function normalizeSummaryMode(value: unknown): 'auto' | 'off' | 'force' | undefined {
    const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
    if (raw === 'auto' || raw === 'off' || raw === 'force') return raw;
    return undefined;
  }

  function normalizeSummaryPrompt(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
  }

  function resolveSummaryMode(
    session: SessionState,
    requested?: 'auto' | 'off' | 'force'
  ): 'auto' | 'off' | 'force' {
    if (requested) return requested;
    return session.summaryMode ?? 'auto';
  }

  function resolveEffectiveSummaryMode(
    session: SessionState,
    requested?: 'auto' | 'off' | 'force'
  ): 'auto' | 'off' | 'force' {
    const mode = resolveSummaryMode(session, requested);
    if (mode === 'auto' && session.summaryAutoUsed) return 'off';
    return mode;
  }

  function recordCapability(capability: string): void {
    observedTracker.record(capability);
  }

  function recordModelCapability(model: string): void {
    const providerId = resolveProviderForModel(model);
    if (!providerId) return;
    recordCapability(`model.${providerId}`);
  }

  function recordProviderCapability(providerId: ProviderId): void {
    recordCapability(`model.${providerId}`);
  }

  function resolveSystemPrompt(providerId: ProviderId, input?: unknown): string | undefined {
    if (typeof input === 'string') {
      const trimmed = input.trim();
      return trimmed ? trimmed : undefined;
    }
    const envKey = `AGENTCONNECT_SYSTEM_PROMPT_${providerId.toUpperCase()}`;
    const envValue = process.env[envKey];
    if (envValue && envValue.trim()) return envValue.trim();
    return undefined;
  }

  const SUMMARY_REASONING_MAX_LINES = 3;
  const SUMMARY_REASONING_MAX_CHARS = 280;

  function appendSummaryReasoning(session: SessionState, text: string): void {
    if (!text.trim()) return;
    const existing = session.summaryReasoning
      ? session.summaryReasoning.split('\n').filter(Boolean)
      : [];
    if (existing.length >= SUMMARY_REASONING_MAX_LINES) return;
    const incoming = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    for (const line of incoming) {
      if (existing.length >= SUMMARY_REASONING_MAX_LINES) break;
      const base = existing.join('\n');
      const separator = base ? '\n' : '';
      const next = `${base}${separator}${line}`;
      if (next.length > SUMMARY_REASONING_MAX_CHARS) {
        const remaining = SUMMARY_REASONING_MAX_CHARS - (base.length + separator.length);
        if (remaining > 0) {
          existing.push(line.slice(0, remaining).trim());
        }
        break;
      }
      existing.push(line);
    }
    session.summaryReasoning = existing.join('\n');
  }

  function clearSummarySeed(session: SessionState): void {
    session.summarySeed = undefined;
    session.summaryReasoning = undefined;
    session.summaryNextMode = undefined;
    session.summaryNextPrompt = undefined;
  }

  async function startPromptSummary(options: {
    sessionId: string;
    session: SessionState;
    message: string;
    reasoning?: string;
    summaryPrompt?: string;
    mode?: 'auto' | 'off' | 'force';
    emit: RpcResponder['emit'];
  }): Promise<void> {
    const { sessionId, session, message, reasoning, summaryPrompt, mode, emit } = options;
    if (session.summaryRequested) return;
    session.summaryRequested = true;
    let completed = false;
    try {
      const provider = providers[session.providerId];
      if (!provider) return;
      const prompt = summaryPrompt
        ? buildSummaryPromptWithOverride(summaryPrompt, message, reasoning)
        : buildSummaryPrompt(message, reasoning);
      const summaryModel = getSummaryModel(session.providerId);
      const cwd = session.cwd || basePath;
      const repoRoot = session.repoRoot || basePath;
      const result = await runSummaryPrompt({
        provider,
        prompt,
        model: summaryModel,
        cwd,
        repoRoot,
      });
      if (!result) return;
      persistSummary(
        emit,
        sessionId,
        {
          summary: result.summary,
          source: 'prompt',
          provider: session.providerId,
          model: result.model ?? null,
          createdAt: new Date().toISOString(),
        },
        session
      );
      completed = true;
    } finally {
      session.summaryRequested = false;
      if (!completed && mode === 'auto') {
        session.summaryAutoUsed = true;
      }
      if (session.summarySeed) {
        maybeStartPromptSummary({
          sessionId,
          session,
          emit,
          trigger: 'output',
        });
      }
    }
  }

  async function getCachedStatus(
    provider: (typeof providers)[ProviderId],
    options: { allowFast?: boolean; force?: boolean } = {}
  ): Promise<ProviderStatus> {
    if (options.force) {
      statusCache.delete(provider.id);
      statusInFlight.delete(provider.id);
    }
    const cached = statusCache.get(provider.id);
    const now = Date.now();
    if (!options.force && cached && now - cached.at < statusCacheTtlMs) {
      return cached.status;
    }
    const existing = statusInFlight.get(provider.id);
    if (!options.force && existing) return existing;
    if (options.allowFast && provider.fastStatus) {
      try {
        const fast = await provider.fastStatus();
        const startedAt = Date.now();
        const promise = provider
          .status()
          .then((status) => {
            debugLog('Providers', 'status-check', {
              providerId: provider.id,
              durationMs: Date.now() - startedAt,
              completedAt: new Date().toISOString(),
            });
            statusCache.set(provider.id, { status, at: Date.now() });
            return status;
          })
          .finally(() => {
            statusInFlight.delete(provider.id);
          });
        statusInFlight.set(provider.id, promise);
        return fast;
      } catch {
        // fall through to full status
      }
    }
    const startedAt = Date.now();
    const promise = provider
      .status()
      .then((status) => {
        debugLog('Providers', 'status-check', {
          providerId: provider.id,
          durationMs: Date.now() - startedAt,
          completedAt: new Date().toISOString(),
        });
        statusCache.set(provider.id, { status, at: Date.now() });
        return status;
      })
      .finally(() => {
        statusInFlight.delete(provider.id);
      });
    statusInFlight.set(provider.id, promise);
    return promise;
  }

  async function isModelForProvider(model: string, providerId: ProviderId): Promise<boolean> {
    try {
      const models = await listModels();
      if (!models.length) return true;
      const match = models.find((entry) => entry.id === model);
      if (match) return match.provider === providerId;
    } catch {
      return true;
    }
    return resolveProviderForModel(model) === providerId;
  }

  async function pickDefaultModel(providerId: ProviderId): Promise<string | null> {
    try {
      const recent = await listRecentModels(providerId);
      if (recent.length > 0) return recent[0].id;
    } catch {
      // ignore recent model lookup failures
    }
    try {
      const models = await listModels();
      const match = models.find((entry) => entry.provider === providerId);
      if (match) return match.id;
    } catch {
      // ignore model lookup failures
    }
    if (providerId === 'claude') return 'default';
    if (providerId === 'local') return 'local';
    return null;
  }

  function invalidateStatus(providerId: ProviderId): void {
    if (!providerId) return;
    statusCache.delete(providerId);
  }

  function emitSessionEvent(
    emit: RpcResponder['emit'],
    sessionId: string,
    type: string,
    data: Record<string, unknown>
  ): void {
    if (process.env.AGENTCONNECT_DEBUG?.trim()) {
      try {
        console.log(`[AgentConnect][Session ${sessionId}] ${type} ${JSON.stringify(data)}`);
      } catch {
        console.log(`[AgentConnect][Session ${sessionId}] ${type}`);
      }
    }
    emit({
      jsonrpc: '2.0',
      method: 'acp.session.event',
      params: { sessionId, type, data },
    });
  }

  function maybeStartPromptSummary(options: {
    sessionId: string;
    session: SessionState;
    emit: RpcResponder['emit'];
    trigger: 'reasoning' | 'output';
  }): void {
    const { sessionId, session, emit, trigger } = options;
    const mode = resolveEffectiveSummaryMode(session, session.summaryNextMode);
    if (mode === 'off') return;
    if (session.summaryRequested) return;
    if (!session.summarySeed) return;
    if (trigger === 'reasoning' && !session.summaryReasoning) return;
    const message = session.summarySeed;
    const reasoning = session.summaryReasoning;
    const summaryPrompt = session.summaryNextPrompt ?? session.summaryPrompt;
    clearSummarySeed(session);
    void startPromptSummary({
      sessionId,
      session,
      message,
      reasoning,
      summaryPrompt,
      mode,
      emit,
    });
  }

  function sessionSummaryKey(sessionId: string): string {
    return `session:${sessionId}:summary`;
  }

  function persistSummary(
    emit: RpcResponder['emit'],
    sessionId: string,
    payload: SummaryPayload,
    session?: SessionState
  ): void {
    if (!payload.summary) return;
    if (session) {
      if (session.summary === payload.summary && session.summarySource === payload.source) {
        return;
      }
      session.summary = payload.summary;
      session.summarySource = payload.source;
      session.summaryModel = payload.model ?? null;
      session.summaryCreatedAt = payload.createdAt;
      session.summaryAutoUsed = true;
    }
    emitSessionEvent(emit, sessionId, 'summary', payload);
    storage.set(sessionSummaryKey(sessionId), payload);
  }

  async function handleRpc(payload: RpcPayload, responder: RpcResponder): Promise<void> {
    if (!payload || payload.jsonrpc !== '2.0' || payload.id === undefined) {
      return;
    }

    const id = payload.id;
    const method = payload.method;
    const params = (payload.params ?? {}) as Record<string, unknown>;

    if (typeof method === 'string' && method.startsWith('acp.')) {
      recordCapability('agent.connect');
    }

    if (method === 'acp.hello') {
      const loginExperience = resolveLoginExperience(mode);
      responder.reply(id, {
        hostId,
        hostName,
        hostVersion,
        protocolVersion: '0.1',
        mode: 'local',
        capabilities: [],
        providers: Object.keys(providers),
        loginExperience,
      });
      return;
    }

    if (method === 'acp.providers.list') {
      const statusEntries = await Promise.all(
        Object.values(providers).map(async (provider) => {
          try {
            return [provider.id, await getCachedStatus(provider, { allowFast: true })] as const;
          } catch {
            return [provider.id, { installed: false, loggedIn: false }] as const;
          }
        })
      );
      const statuses = Object.fromEntries(statusEntries);
      const list = buildProviderList(statuses).map((entry) => ({
        ...entry,
        updateInProgress: updatingProviders.has(entry.id),
      }));
      responder.reply(id, { providers: list });
      return;
    }

    if (method === 'acp.providers.status') {
      const providerId = params.provider as ProviderId;
      const provider = providers[providerId];
      if (!provider) {
        responder.error(id, 'AC_ERR_UNSUPPORTED', 'Unknown provider');
        return;
      }
      const statusOptions =
        (params.options as { fast?: boolean; force?: boolean } | undefined) ?? {};
      const allowFast = statusOptions.fast !== false;
      const force = Boolean(statusOptions.force);
      const status = await getCachedStatus(provider, { allowFast, force });
      responder.reply(id, {
        provider: {
          id: provider.id,
          name: provider.name,
          installed: status.installed,
          loggedIn: status.loggedIn,
          version: status.version,
          updateAvailable: status.updateAvailable,
          latestVersion: status.latestVersion,
          updateCheckedAt: status.updateCheckedAt,
          updateSource: status.updateSource,
          updateCommand: status.updateCommand,
          updateMessage: status.updateMessage,
          updateInProgress: updatingProviders.has(provider.id) || status.updateInProgress,
        },
      });
      return;
    }

    if (method === 'acp.providers.update') {
      const providerId = params.provider as ProviderId;
      const provider = providers[providerId];
      if (!provider) {
        responder.error(id, 'AC_ERR_UNSUPPORTED', 'Unknown provider');
        return;
      }
      debugLog('Providers', 'update-start', { providerId });
      if (!updatingProviders.has(providerId)) {
        const promise = provider.update().finally(() => {
          updatingProviders.delete(providerId);
          invalidateStatus(providerId);
        });
        updatingProviders.set(providerId, promise);
      }
      try {
        const status = await updatingProviders.get(providerId)!;
        debugLog('Providers', 'update-complete', {
          providerId,
          updateAvailable: status.updateAvailable,
          latestVersion: status.latestVersion,
          updateMessage: status.updateMessage,
        });
        responder.reply(id, {
          provider: {
            id: provider.id,
            name: provider.name,
            installed: status.installed,
            loggedIn: status.loggedIn,
            version: status.version,
            updateAvailable: status.updateAvailable,
            latestVersion: status.latestVersion,
            updateCheckedAt: status.updateCheckedAt,
            updateSource: status.updateSource,
            updateCommand: status.updateCommand,
            updateMessage: status.updateMessage,
            updateInProgress: false,
          },
        });
      } catch (err: unknown) {
        debugLog('Providers', 'update-error', {
          providerId,
          message: err instanceof Error ? err.message : String(err),
        });
        responder.error(id, 'AC_ERR_INTERNAL', (err as Error)?.message || 'Update failed');
      }
      return;
    }

    if (method === 'acp.providers.ensureInstalled') {
      const providerId = params.provider as ProviderId;
      const provider = providers[providerId];
      if (!provider) {
        responder.error(id, 'AC_ERR_UNSUPPORTED', 'Unknown provider');
        return;
      }
      const result = await provider.ensureInstalled();
      invalidateStatus(provider.id);
      responder.reply(id, result);
      return;
    }

    if (method === 'acp.providers.login') {
      const providerId = params.provider as ProviderId;
      const provider = providers[providerId];
      if (!provider) {
        responder.error(id, 'AC_ERR_UNSUPPORTED', 'Unknown provider');
        return;
      }
      try {
        const defaults = providerDefaults[providerId];
        const incoming = params.options as ProviderLoginOptions | undefined;
        const result = await provider.login({
          ...(defaults || {}),
          ...(incoming || {}),
        });
        invalidateStatus(provider.id);
        responder.reply(id, result);
      } catch (err) {
        responder.error(id, 'AC_ERR_INTERNAL', (err as Error)?.message || 'Provider login failed.');
      }
      return;
    }

    if (method === 'acp.providers.logout') {
      const providerId = params.provider as ProviderId;
      const provider = providers[providerId];
      if (!provider) {
        responder.error(id, 'AC_ERR_UNSUPPORTED', 'Unknown provider');
        return;
      }
      await provider.logout();
      invalidateStatus(provider.id);
      responder.reply(id, {});
      return;
    }

    if (method === 'acp.models.list') {
      const models = await listModels();
      const providerId = params.provider as string | undefined;
      if (providerId) {
        responder.reply(id, { models: models.filter((m) => m.provider === providerId) });
      } else {
        responder.reply(id, { models });
      }
      return;
    }

    if (method === 'acp.models.recent') {
      const providerId = params.provider as ProviderId | undefined;
      const models = await listRecentModels(providerId);
      responder.reply(id, { models });
      return;
    }

    if (method === 'acp.models.info') {
      const modelId = params.model as string;
      const model = (await listModels()).find((m) => m.id === modelId);
      if (!model) {
        responder.error(id, 'AC_ERR_INVALID_ARGS', 'Unknown model');
        return;
      }
      responder.reply(id, { model });
      return;
    }

    if (method === 'acp.sessions.create') {
      const sessionId = `sess_${Math.random().toString(36).slice(2, 10)}`;
      const rawProvider = params.provider as ProviderId | undefined;
      if (rawProvider && !providers[rawProvider]) {
        responder.error(id, 'AC_ERR_UNSUPPORTED', 'Unknown provider');
        return;
      }
      const rawModel = typeof params.model === 'string' ? params.model.trim() : '';
      const modelInput = rawModel ? rawModel : undefined;
      if (!rawProvider && !modelInput) {
        responder.error(id, 'AC_ERR_INVALID_ARGS', 'Model or provider is required');
        return;
      }
      const providerId = rawProvider ?? resolveProviderForModel(modelInput);
      let model: string | null = modelInput ?? null;
      if (rawProvider && modelInput) {
        const matches = await isModelForProvider(modelInput, rawProvider);
        if (!matches) {
          responder.error(id, 'AC_ERR_INVALID_ARGS', 'Model does not belong to provider');
          return;
        }
      }
      if (rawProvider && !modelInput) {
        model = await pickDefaultModel(rawProvider);
      }
      const reasoningEffort = (params.reasoningEffort as string) || null;
      const systemPrompt = resolveSystemPrompt(providerId, params.system);
      const cwd = params.cwd ? resolveAppPathInternal(params.cwd) : undefined;
      const repoRoot = params.repoRoot ? resolveAppPathInternal(params.repoRoot) : undefined;
      const providerDetailLevel = (params.providerDetailLevel as string) || undefined;
      if (model) {
        recordModelCapability(model);
      } else {
        recordProviderCapability(providerId);
      }
      const summaryMode = normalizeSummaryMode(
        (params.summary as { mode?: string } | undefined)?.mode
      );
      const summaryPrompt = normalizeSummaryPrompt(
        (params.summary as { prompt?: string } | undefined)?.prompt
      );
      sessions.set(sessionId, {
        id: sessionId,
        providerId,
        model,
        providerSessionId: null,
        reasoningEffort,
        cwd,
        repoRoot,
        systemPrompt,
        providerDetailLevel:
          providerDetailLevel === 'raw' || providerDetailLevel === 'minimal'
            ? providerDetailLevel
            : undefined,
        summaryMode: summaryMode === 'force' ? 'auto' : summaryMode ?? 'auto',
        summaryPrompt,
        summaryAutoUsed: false,
      });
      responder.reply(id, { sessionId });
      return;
    }

    if (method === 'acp.sessions.resume') {
      const sessionId = params.sessionId as string;
      const existing = sessions.get(sessionId);
      if (!existing) {
        responder.error(id, 'AC_ERR_INVALID_ARGS', 'Unknown session');
        return;
      }
      if (params.providerSessionId) {
        existing.providerSessionId = String(params.providerSessionId);
      }
      if (params.cwd) {
        existing.cwd = resolveAppPathInternal(params.cwd);
      }
      if (params.repoRoot) {
        existing.repoRoot = resolveAppPathInternal(params.repoRoot);
      }
      if ('system' in params) {
        existing.systemPrompt = resolveSystemPrompt(existing.providerId, params.system);
      }
      if (params.providerDetailLevel) {
        const level = String(params.providerDetailLevel);
        if (level === 'raw' || level === 'minimal') {
          existing.providerDetailLevel = level;
        }
      }
      if ('summary' in params) {
        const summaryMode = normalizeSummaryMode(
          (params.summary as { mode?: string } | undefined)?.mode
        );
        const summaryPrompt = normalizeSummaryPrompt(
          (params.summary as { prompt?: string } | undefined)?.prompt
        );
        if (summaryMode) {
          existing.summaryMode = summaryMode === 'force' ? 'auto' : summaryMode;
        }
        if (summaryPrompt !== undefined) {
          existing.summaryPrompt = summaryPrompt;
        }
      }
      if (!existing.model && typeof params.model === 'string' && params.model.trim()) {
        const candidate = params.model.trim();
        const matches = await isModelForProvider(candidate, existing.providerId);
        if (!matches) {
          responder.error(id, 'AC_ERR_INVALID_ARGS', 'Model does not belong to provider');
          return;
        }
        existing.model = candidate;
      }
      if (existing.model) {
        recordModelCapability(existing.model);
      } else {
        recordProviderCapability(existing.providerId);
      }
      responder.reply(id, { sessionId });
      return;
    }

    if (method === 'acp.sessions.send') {
      const sessionId = params.sessionId as string;
      const message = (params.message as { content?: string })?.content || '';
      const session = sessions.get(sessionId);
      if (!session) {
        responder.error(id, 'AC_ERR_INVALID_ARGS', 'Unknown session');
        return;
      }
      let model = session.model;
      if (!model) {
        model = await pickDefaultModel(session.providerId);
        if (model) session.model = model;
      }
      if (model) {
        recordModelCapability(model);
      } else {
        recordProviderCapability(session.providerId);
      }

      const provider = providers[session.providerId];
      if (!provider) {
        responder.error(id, 'AC_ERR_UNSUPPORTED', 'Unknown provider');
        return;
      }
      if (updatingProviders.has(session.providerId)) {
        responder.error(id, 'AC_ERR_BUSY', 'Provider update in progress.');
        return;
      }

      const status = await provider.status();
      if (!status.installed) {
        const installed = await provider.ensureInstalled();
        if (!installed.installed) {
          responder.error(id, 'AC_ERR_NOT_INSTALLED', 'Provider CLI is not installed.');
          return;
        }
      }

      const summaryMode = resolveEffectiveSummaryMode(
        session,
        normalizeSummaryMode((params.summary as { mode?: string } | undefined)?.mode)
      );
      const summaryPrompt = normalizeSummaryPrompt(
        (params.summary as { prompt?: string } | undefined)?.prompt
      );
      session.summaryNextMode = summaryMode;
      if (summaryPrompt !== undefined) {
        session.summaryNextPrompt = summaryPrompt;
      }
      if (summaryMode !== 'off' && message.trim()) {
        session.summarySeed = message;
        session.summaryReasoning = '';
      }

      const controller = new AbortController();
      const cwd = params.cwd ? resolveAppPathInternal(params.cwd) : session.cwd || basePath;
      const repoRoot = params.repoRoot
        ? resolveAppPathInternal(params.repoRoot)
        : session.repoRoot || basePath;
      const providerDetailLevel =
        params.providerDetailLevel === 'raw' || params.providerDetailLevel === 'minimal'
          ? (params.providerDetailLevel as 'raw' | 'minimal')
          : session.providerDetailLevel || 'minimal';
      const runToken = `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      activeRuns.set(sessionId, { controller, emit: responder.emit, token: runToken });
      let sawError = false;

      provider
        .runPrompt({
          prompt: message,
          resumeSessionId: session.providerSessionId,
          model: model ?? undefined,
          reasoningEffort: session.reasoningEffort,
          repoRoot,
          cwd,
          providerDetailLevel,
          system: session.systemPrompt,
          signal: controller.signal,
          onEvent: (event) => {
            const current = activeRuns.get(sessionId);
            if (!current || current.token !== runToken) return;
            if (event.type === 'error') {
              sawError = true;
            }
            if (sawError && event.type === 'final') {
              return;
            }
            if (event.type === 'thinking' && typeof event.text === 'string') {
              appendSummaryReasoning(session, event.text);
              maybeStartPromptSummary({
                sessionId,
                session,
                emit: current.emit,
                trigger: 'reasoning',
              });
            }
            if (event.type === 'delta' || event.type === 'message' || event.type === 'final') {
              maybeStartPromptSummary({
                sessionId,
                session,
                emit: current.emit,
                trigger: 'output',
              });
            }
            emitSessionEvent(current.emit, sessionId, event.type, { ...event });
          },
        })
        .then((result) => {
          const current = activeRuns.get(sessionId);
          if (!current || current.token !== runToken) return;
          if (result?.sessionId) {
            session.providerSessionId = result.sessionId;
          }
        })
        .catch((err: Error) => {
          const current = activeRuns.get(sessionId);
          if (!current || current.token !== runToken) return;
          if (!sawError) {
            emitSessionEvent(current.emit, sessionId, 'error', {
              message: err?.message || 'Provider error',
            });
          }
        })
        .finally(() => {
          const current = activeRuns.get(sessionId);
          if (current && current.token === runToken) {
            activeRuns.delete(sessionId);
          }
          if (!session.summaryRequested && session.summarySeed) {
            clearSummarySeed(session);
          }
        });

      responder.reply(id, { accepted: true });
      return;
    }

    if (method === 'acp.sessions.cancel') {
      const sessionId = params.sessionId as string;
      const run = activeRuns.get(sessionId);
      if (run) {
        activeRuns.delete(sessionId);
        run.controller.abort();
        emitSessionEvent(run.emit, sessionId, 'final', { cancelled: true });
      }
      const session = sessions.get(sessionId);
      if (session && session.summarySeed && !session.summaryRequested) {
        clearSummarySeed(session);
      }
      responder.reply(id, { cancelled: true });
      return;
    }

    if (method === 'acp.sessions.close') {
      const sessionId = params.sessionId as string;
      sessions.delete(sessionId);
      responder.reply(id, { closed: true });
      return;
    }

    if (method === 'acp.fs.read') {
      recordCapability('fs.read');
      try {
        const filePath = resolveAppPathInternal(params.path);
        const encoding = (params.encoding as BufferEncoding) || 'utf8';
        const content = await fsp.readFile(filePath, encoding);
        responder.reply(id, { content, encoding });
      } catch (err) {
        responder.error(id, 'AC_ERR_FS_READ', (err as Error)?.message || 'Failed to read file.');
      }
      return;
    }

    if (method === 'acp.fs.write') {
      recordCapability('fs.write');
      try {
        const filePath = resolveAppPathInternal(params.path);
        const encoding = (params.encoding as BufferEncoding) || 'utf8';
        const content = (params.content as string) ?? '';
        await fsp.mkdir(path.dirname(filePath), { recursive: true });
        await fsp.writeFile(filePath, content, {
          encoding,
          mode: params.mode as number | undefined,
        });
        const bytes = Buffer.byteLength(String(content), encoding);
        responder.reply(id, { bytes });
      } catch (err) {
        responder.error(id, 'AC_ERR_FS_WRITE', (err as Error)?.message || 'Failed to write file.');
      }
      return;
    }

    if (method === 'acp.fs.list') {
      recordCapability('fs.read');
      try {
        const dirPath = resolveAppPathInternal(params.path);
        const entries = await fsp.readdir(dirPath, { withFileTypes: true });
        const results: Array<{ name: string; path: string; type: string; size: number }> = [];
        for (const entry of entries) {
          const entryPath = path.join(dirPath, entry.name);
          let size = 0;
          let type: string = 'other';
          try {
            const stat = await fsp.lstat(entryPath);
            type = mapFileType(stat);
            if (type === 'file') size = stat.size;
          } catch {
            type = entry.isDirectory() ? 'dir' : entry.isFile() ? 'file' : 'other';
          }
          results.push({
            name: entry.name,
            path: entryPath,
            type,
            size,
          });
        }
        responder.reply(id, { entries: results });
      } catch (err) {
        responder.error(
          id,
          'AC_ERR_FS_LIST',
          (err as Error)?.message || 'Failed to list directory.'
        );
      }
      return;
    }

    if (method === 'acp.fs.stat') {
      recordCapability('fs.read');
      try {
        const filePath = resolveAppPathInternal(params.path);
        const stat = await fsp.lstat(filePath);
        responder.reply(id, {
          type: mapFileType(stat),
          size: stat.size,
          mtime: stat.mtime.toISOString(),
        });
      } catch (err) {
        responder.error(id, 'AC_ERR_FS_STAT', (err as Error)?.message || 'Failed to stat file.');
      }
      return;
    }

    if (method === 'acp.process.spawn') {
      recordCapability('process.spawn');
      try {
        const command = String(params.command || '');
        const args = Array.isArray(params.args) ? params.args.map(String) : [];
        const cwd = params.cwd ? resolveAppPathInternal(params.cwd) : basePath;
        const env = { ...process.env, ...((params.env as Record<string, string>) || {}) };
        const useTty = Boolean(params.tty);
        const child = spawn(command, args, {
          cwd,
          env,
          stdio: useTty ? 'inherit' : ['pipe', 'pipe', 'pipe'],
        });
        if (!useTty) {
          child.stdout?.on('data', () => undefined);
          child.stderr?.on('data', () => undefined);
        }
        if (typeof params.stdin === 'string' && child.stdin) {
          child.stdin.write(params.stdin);
          child.stdin.end();
        }
        if (child.pid) {
          processTable.set(child.pid, child);
          child.on('close', () => {
            if (child.pid) processTable.delete(child.pid);
          });
        }
        responder.reply(id, { pid: child.pid });
      } catch (err) {
        responder.error(
          id,
          'AC_ERR_PROCESS',
          (err as Error)?.message || 'Failed to spawn process.'
        );
      }
      return;
    }

    if (method === 'acp.process.kill') {
      recordCapability('process.kill');
      const pid = Number(params.pid);
      const signal = (params.signal as NodeJS.Signals) || 'SIGTERM';
      const child = processTable.get(pid);
      try {
        const success = child ? child.kill(signal) : process.kill(pid, signal);
        responder.reply(id, { success: Boolean(success) });
      } catch (err) {
        responder.error(id, 'AC_ERR_PROCESS', (err as Error)?.message || 'Failed to kill process.');
      }
      return;
    }

    if (method === 'acp.net.request') {
      recordCapability('network.request');
      try {
        if (typeof fetch !== 'function') {
          responder.error(id, 'AC_ERR_NET', 'Fetch is not available.');
          return;
        }
        const controller = new AbortController();
        const timeout = params.timeoutMs as number | undefined;
        let timer: ReturnType<typeof setTimeout> | null = null;
        if (timeout) {
          timer = setTimeout(() => controller.abort(), Number(timeout));
        }
        const res = await fetch(String(params.url), {
          method: (params.method as string) || 'GET',
          headers: (params.headers as Record<string, string>) || {},
          body: params.body as string | undefined,
          signal: controller.signal,
        });
        if (timer) clearTimeout(timer);
        const body = await res.text();
        const headers: Record<string, string> = {};
        res.headers.forEach((value, key) => {
          headers[key] = value;
        });
        responder.reply(id, { status: res.status, headers, body });
      } catch (err) {
        responder.error(id, 'AC_ERR_NET', (err as Error)?.message || 'Network request failed.');
      }
      return;
    }

    if (method === 'acp.storage.get') {
      recordCapability('storage.kv');
      const key = typeof params.key === 'string' ? params.key : '';
      if (!key) {
        responder.error(id, 'AC_ERR_INVALID_ARGS', 'Storage key is required.');
        return;
      }
      responder.reply(id, { value: storage.get(key) });
      return;
    }

    if (method === 'acp.storage.set') {
      recordCapability('storage.kv');
      const key = typeof params.key === 'string' ? params.key : '';
      if (!key) {
        responder.error(id, 'AC_ERR_INVALID_ARGS', 'Storage key is required.');
        return;
      }
      storage.set(key, params.value);
      responder.reply(id, { ok: true });
      return;
    }

    if (method === 'acp.backend.start') {
      recordCapability('backend.run');
      if (!manifest?.backend) {
        responder.reply(id, { status: 'disabled' });
        return;
      }
      const backendConfig = manifest.backend;
      const existing = backendState.get(appId);
      if (existing?.status === 'running') {
        responder.reply(id, { status: 'running', url: existing.url });
        return;
      }
      try {
        let assignedPort: number | null = null;
        const declaredPort = backendConfig.env?.PORT;
        if (declaredPort === undefined || String(declaredPort) === '0') {
          assignedPort = await allocatePort();
        } else if (!Number.isNaN(Number(declaredPort))) {
          assignedPort = Number(declaredPort);
        }
        const env: Record<string, string> = {
          ...process.env,
          ...(backendConfig.env || {}),
          AGENTCONNECT_HOST: `ws://${hostAddress}:${hostPort}`,
          AGENTCONNECT_APP_ID: appId,
        } as Record<string, string>;
        if (assignedPort) {
          env.PORT = String(assignedPort);
          env.AGENTCONNECT_APP_PORT = String(assignedPort);
        }
        const cwd = backendConfig.cwd ? resolveAppPathInternal(backendConfig.cwd) : basePath;
        const args = backendConfig.args || [];
        const child = spawn(backendConfig.command, args, {
          cwd,
          env,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        child.stdout?.on('data', () => undefined);
        child.stderr?.on('data', () => undefined);
        const url = assignedPort ? `http://${hostAddress}:${assignedPort}` : undefined;
        const record: BackendState = { status: 'starting', pid: child.pid, url };
        backendState.set(appId, record);
        child.on('exit', () => {
          backendState.set(appId, { status: 'stopped' });
        });
        if (backendConfig.healthcheck?.type === 'http' && assignedPort) {
          const healthUrl = `http://${hostAddress}:${assignedPort}${backendConfig.healthcheck.path}`;
          const ok = await waitForHealthcheck(healthUrl);
          if (!ok) {
            child.kill('SIGTERM');
            backendState.set(appId, { status: 'error' });
            responder.reply(id, { status: 'error' });
            return;
          }
        }
        backendState.set(appId, { status: 'running', pid: child.pid, url });
        responder.reply(id, { status: 'running', url });
      } catch (err) {
        responder.error(
          id,
          'AC_ERR_BACKEND',
          (err as Error)?.message || 'Failed to start backend.'
        );
      }
      return;
    }

    if (method === 'acp.backend.stop') {
      recordCapability('backend.run');
      const current = backendState.get(appId);
      if (!current?.pid) {
        backendState.set(appId, { status: 'stopped' });
        responder.reply(id, { status: 'stopped' });
        return;
      }
      try {
        process.kill(current.pid, 'SIGTERM');
      } catch {
        // ignore
      }
      backendState.set(appId, { status: 'stopped' });
      responder.reply(id, { status: 'stopped' });
      return;
    }

    if (method === 'acp.backend.status') {
      recordCapability('backend.run');
      const current = backendState.get(appId) || { status: 'stopped' };
      responder.reply(id, { status: current.status, url: current.url });
      return;
    }

    if (method === 'acp.capabilities.observed') {
      responder.reply(id, { ...observedTracker.snapshot() });
      return;
    }

    responder.reply(id, {});
  }

  return {
    handleRpc,
    flush: () => {
      observedTracker.flush();
      storage.flush();
    },
  };
}

export function startDevHost({
  host = '127.0.0.1',
  port = 9630,
  appPath,
  uiUrl,
  ...options
}: DevHostOptions = {}): void {
  const basePath = options.basePath || appPath || process.cwd();
  const runtime = createHostRuntime({
    ...options,
    basePath,
    host,
    port,
    modeDefault: 'dev',
  });
  const server = http.createServer();
  const wss = new WebSocketServer({ server });
  const logger = options.log?.info || console.log;

  wss.on('connection', (socket: WebSocket) => {
    socket.on('message', async (raw: Buffer | string) => {
      let payload: RpcPayload;
      try {
        payload = JSON.parse(String(raw)) as RpcPayload;
      } catch {
        return;
      }

      const responder: RpcResponder = {
        reply: (id, result) => {
          send(socket, { jsonrpc: '2.0', id, result });
        },
        error: (id, code, message) => {
          send(socket, {
            jsonrpc: '2.0',
            id,
            error: { code, message },
          });
        },
        emit: (notification) => {
          send(socket, notification);
        },
      };

      await runtime.handleRpc(payload, responder);
    });
  });

  server.listen(port, host, () => {
    logger(`AgentConnect dev host running at ws://${host}:${port}`);
    if (appPath) logger(`App path: ${appPath}`);
    if (uiUrl) logger(`UI dev server: ${uiUrl}`);
  });

  process.on('SIGINT', () => {
    try {
      runtime.flush();
    } catch {
      // ignore flush errors
    }
    server.close(() => process.exit(0));
  });
}

export function createHostBridge(options: HostOptions = {}): AgentConnectBridge {
  const runtime = createHostRuntime({
    ...options,
    basePath: options.basePath || process.cwd(),
    modeDefault: 'embedded',
  });
  const handlers = new Set<(event: RpcNotification) => void>();
  let nextId = 1;

  const emit = (notification: RpcNotification): void => {
    for (const handler of handlers) {
      try {
        handler(notification);
      } catch (err) {
        options.log?.error?.('AgentConnect bridge handler error', {
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
  };

  return {
    request: async (method: string, params?: Record<string, unknown>): Promise<unknown> => {
      return new Promise((resolve, reject) => {
        const payload: RpcPayload = {
          jsonrpc: '2.0',
          id: nextId++,
          method,
          params,
        };
        const responder: RpcResponder = {
          reply: (_id, result) => resolve(result),
          error: (_id, code, message) => reject(new Error(`${code}: ${message}`)),
          emit,
        };

        runtime.handleRpc(payload, responder).catch((err) => {
          reject(err instanceof Error ? err : new Error(String(err)));
        });
      });
    },
    onEvent: (handler: (event: RpcNotification) => void) => {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },
  };
}
