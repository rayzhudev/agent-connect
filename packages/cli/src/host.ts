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
} from './types.js';
import { listModels, listRecentModels, providers, resolveProviderForModel } from './providers/index.js';
import { debugLog } from './providers/utils.js';
import { createObservedTracker } from './observed.js';

interface RpcPayload {
  jsonrpc?: string;
  id?: RpcId;
  method?: string;
  params?: Record<string, unknown>;
}

type RpcResult = Record<string, unknown> | InstallResult;

function send(socket: WebSocket, payload: object): void {
  socket.send(JSON.stringify(payload));
}

function reply(socket: WebSocket, id: RpcId, result: RpcResult): void {
  send(socket, { jsonrpc: '2.0', id, result });
}

function replyError(socket: WebSocket, id: RpcId, code: RpcErrorCode, message: string): void {
  send(socket, {
    jsonrpc: '2.0',
    id,
    error: { code, message },
  });
}

function sessionEvent(
  socket: WebSocket,
  sessionId: string,
  type: string,
  data: Record<string, unknown>
): void {
  if (process.env.AGENTCONNECT_DEBUG?.trim()) {
    try {
      console.log(
        `[AgentConnect][Session ${sessionId}] ${type} ${JSON.stringify(data)}`
      );
    } catch {
      console.log(`[AgentConnect][Session ${sessionId}] ${type}`);
    }
  }
  send(socket, {
    jsonrpc: '2.0',
    method: 'acp.session.event',
    params: { sessionId, type, data },
  });
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

export interface DevHostOptions {
  host?: string;
  port?: number;
  appPath?: string;
  uiUrl?: string;
}

export function startDevHost({
  host = '127.0.0.1',
  port = 9630,
  appPath,
  uiUrl,
}: DevHostOptions = {}): void {
  process.env.AGENTCONNECT_HOST_MODE ||= 'dev';
  const server = http.createServer();
  const wss = new WebSocketServer({ server });
  const sessions = new Map<string, SessionState>();
  const activeRuns = new Map<string, AbortController>();
  const updatingProviders = new Map<ProviderId, Promise<ProviderStatus>>();
  const processTable = new Map<number, ChildProcess>();
  const backendState = new Map<string, BackendState>();
  const statusCache = new Map<string, { status: ProviderStatus; at: number }>();
  const statusCacheTtlMs = 8000;
  const statusInFlight = new Map<ProviderId, Promise<ProviderStatus>>();
  const basePath = appPath || process.cwd();
  const manifest = readManifest(basePath);
  const appId = manifest?.id || 'agentconnect-dev-app';
  const requestedCapabilities = Array.isArray(manifest?.capabilities) ? manifest.capabilities : [];
  const observedTracker = createObservedTracker({
    basePath,
    appId,
    requested: requestedCapabilities,
  });

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
      socket.listen(0, host, () => {
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

  function recordCapability(capability: string): void {
    observedTracker.record(capability);
  }

  function recordModelCapability(model: string): void {
    const providerId = resolveProviderForModel(model);
    if (!providerId) return;
    recordCapability(`model.${providerId}`);
  }

  async function getCachedStatus(
    provider: (typeof providers)[ProviderId]
  ): Promise<ProviderStatus> {
    const cached = statusCache.get(provider.id);
    const now = Date.now();
    if (cached && now - cached.at < statusCacheTtlMs) {
      return cached.status;
    }
    const existing = statusInFlight.get(provider.id);
    if (existing) return existing;
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

  function invalidateStatus(providerId: ProviderId): void {
    if (!providerId) return;
    statusCache.delete(providerId);
  }

  wss.on('connection', (socket: WebSocket) => {
    socket.on('message', async (raw: Buffer | string) => {
      let payload: RpcPayload;
      try {
        payload = JSON.parse(String(raw)) as RpcPayload;
      } catch {
        return;
      }

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
        const loginExperience =
          process.env.AGENTCONNECT_LOGIN_EXPERIENCE ||
          process.env.AGENTCONNECT_CLAUDE_LOGIN_EXPERIENCE ||
          (process.env.AGENTCONNECT_HOST_MODE === 'dev' ? 'terminal' : 'embedded');
        reply(socket, id, {
          hostId: 'agentconnect-dev',
          hostName: 'AgentConnect Dev Host',
          hostVersion: '0.1.0',
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
              return [provider.id, await getCachedStatus(provider)] as const;
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
        reply(socket, id, { providers: list });
        return;
      }

      if (method === 'acp.providers.status') {
        const providerId = params.provider as ProviderId;
        const provider = providers[providerId];
        if (!provider) {
          replyError(socket, id, 'AC_ERR_UNSUPPORTED', 'Unknown provider');
          return;
        }
        const status = await getCachedStatus(provider);
        reply(socket, id, {
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
          replyError(socket, id, 'AC_ERR_UNSUPPORTED', 'Unknown provider');
          return;
        }
        debugLog('Providers', 'update-start', { providerId });
        if (!updatingProviders.has(providerId)) {
          const promise = provider
            .update()
            .finally(() => {
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
          reply(socket, id, {
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
          replyError(socket, id, 'AC_ERR_INTERNAL', (err as Error)?.message || 'Update failed');
        }
        return;
      }

      if (method === 'acp.providers.ensureInstalled') {
        const providerId = params.provider as ProviderId;
        const provider = providers[providerId];
        if (!provider) {
          replyError(socket, id, 'AC_ERR_UNSUPPORTED', 'Unknown provider');
          return;
        }
        const result = await provider.ensureInstalled();
        invalidateStatus(provider.id);
        reply(socket, id, result);
        return;
      }

      if (method === 'acp.providers.login') {
        const providerId = params.provider as ProviderId;
        const provider = providers[providerId];
        if (!provider) {
          replyError(socket, id, 'AC_ERR_UNSUPPORTED', 'Unknown provider');
          return;
        }
        try {
          const result = await provider.login(params.options as Record<string, unknown> | undefined);
          invalidateStatus(provider.id);
          reply(socket, id, result);
        } catch (err) {
          replyError(
            socket,
            id,
            'AC_ERR_INTERNAL',
            (err as Error)?.message || 'Provider login failed.'
          );
        }
        return;
      }

      if (method === 'acp.providers.logout') {
        const providerId = params.provider as ProviderId;
        const provider = providers[providerId];
        if (!provider) {
          replyError(socket, id, 'AC_ERR_UNSUPPORTED', 'Unknown provider');
          return;
        }
        await provider.logout();
        invalidateStatus(provider.id);
        reply(socket, id, {});
        return;
      }

      if (method === 'acp.models.list') {
        const models = await listModels();
        const providerId = params.provider as string | undefined;
        if (providerId) {
          reply(socket, id, { models: models.filter((m) => m.provider === providerId) });
        } else {
          reply(socket, id, { models });
        }
        return;
      }

      if (method === 'acp.models.recent') {
        const providerId = params.provider as ProviderId | undefined;
        const models = await listRecentModels(providerId);
        reply(socket, id, { models });
        return;
      }

      if (method === 'acp.models.info') {
        const modelId = params.model as string;
        const model = (await listModels()).find((m) => m.id === modelId);
        if (!model) {
          replyError(socket, id, 'AC_ERR_INVALID_ARGS', 'Unknown model');
          return;
        }
        reply(socket, id, { model });
        return;
      }

      if (method === 'acp.sessions.create') {
        const sessionId = `sess_${Math.random().toString(36).slice(2, 10)}`;
        const model = (params.model as string) || 'claude-opus';
        const reasoningEffort = (params.reasoningEffort as string) || null;
        const cwd = params.cwd ? resolveAppPathInternal(params.cwd) : undefined;
        const repoRoot = params.repoRoot ? resolveAppPathInternal(params.repoRoot) : undefined;
        const providerDetailLevel = (params.providerDetailLevel as string) || undefined;
        const providerId = resolveProviderForModel(model);
        recordModelCapability(model);
        sessions.set(sessionId, {
          id: sessionId,
          providerId,
          model,
          providerSessionId: null,
          reasoningEffort,
          cwd,
          repoRoot,
          providerDetailLevel:
            providerDetailLevel === 'raw' || providerDetailLevel === 'minimal'
              ? providerDetailLevel
              : undefined,
        });
        reply(socket, id, { sessionId });
        return;
      }

      if (method === 'acp.sessions.resume') {
        const sessionId = params.sessionId as string;
        const existing = sessions.get(sessionId);
        if (!existing) {
          const model = (params.model as string) || 'claude-opus';
          const reasoningEffort = (params.reasoningEffort as string) || null;
          const cwd = params.cwd ? resolveAppPathInternal(params.cwd) : undefined;
          const repoRoot = params.repoRoot ? resolveAppPathInternal(params.repoRoot) : undefined;
          const providerDetailLevel = (params.providerDetailLevel as string) || undefined;
          recordModelCapability(model);
          sessions.set(sessionId, {
            id: sessionId,
            providerId: resolveProviderForModel(model),
            model,
            providerSessionId: (params.providerSessionId as string) || null,
            reasoningEffort,
            cwd,
            repoRoot,
            providerDetailLevel:
              providerDetailLevel === 'raw' || providerDetailLevel === 'minimal'
                ? providerDetailLevel
                : undefined,
          });
        } else {
          if (params.providerSessionId) {
            existing.providerSessionId = String(params.providerSessionId);
          }
          if (params.cwd) {
            existing.cwd = resolveAppPathInternal(params.cwd);
          }
          if (params.repoRoot) {
            existing.repoRoot = resolveAppPathInternal(params.repoRoot);
          }
          if (params.providerDetailLevel) {
            const level = String(params.providerDetailLevel);
            if (level === 'raw' || level === 'minimal') {
              existing.providerDetailLevel = level;
            }
          }
          recordModelCapability(existing.model);
        }
        reply(socket, id, { sessionId });
        return;
      }

      if (method === 'acp.sessions.send') {
        const sessionId = params.sessionId as string;
        const message = (params.message as { content?: string })?.content || '';
        const session = sessions.get(sessionId);
        if (!session) {
          replyError(socket, id, 'AC_ERR_INVALID_ARGS', 'Unknown session');
          return;
        }
        recordModelCapability(session.model);

        const provider = providers[session.providerId];
        if (!provider) {
          replyError(socket, id, 'AC_ERR_UNSUPPORTED', 'Unknown provider');
          return;
        }
        if (updatingProviders.has(session.providerId)) {
          replyError(socket, id, 'AC_ERR_BUSY', 'Provider update in progress.');
          return;
        }

        const status = await provider.status();
        if (!status.installed) {
          const installed = await provider.ensureInstalled();
          if (!installed.installed) {
            replyError(socket, id, 'AC_ERR_NOT_INSTALLED', 'Provider CLI is not installed.');
            return;
          }
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
        activeRuns.set(sessionId, controller);
        let sawError = false;

        provider
          .runPrompt({
            prompt: message,
            resumeSessionId: session.providerSessionId,
            model: session.model,
            reasoningEffort: session.reasoningEffort,
            repoRoot,
            cwd,
            providerDetailLevel,
            signal: controller.signal,
            onEvent: (event) => {
              if (event.type === 'error') {
                sawError = true;
              }
              if (sawError && event.type === 'final') {
                return;
              }
              sessionEvent(socket, sessionId, event.type, { ...event });
            },
          })
          .then((result) => {
            if (result?.sessionId) {
              session.providerSessionId = result.sessionId;
            }
          })
          .catch((err: Error) => {
            if (!sawError) {
              sessionEvent(socket, sessionId, 'error', {
                message: err?.message || 'Provider error',
              });
            }
          })
          .finally(() => {
            activeRuns.delete(sessionId);
          });

        reply(socket, id, { accepted: true });
        return;
      }

      if (method === 'acp.sessions.cancel') {
        const sessionId = params.sessionId as string;
        const controller = activeRuns.get(sessionId);
        if (controller) {
          controller.abort();
          activeRuns.delete(sessionId);
        }
        reply(socket, id, { cancelled: true });
        return;
      }

      if (method === 'acp.sessions.close') {
        const sessionId = params.sessionId as string;
        sessions.delete(sessionId);
        reply(socket, id, { closed: true });
        return;
      }

      if (method === 'acp.fs.read') {
        recordCapability('fs.read');
        try {
          const filePath = resolveAppPathInternal(params.path);
          const encoding = (params.encoding as BufferEncoding) || 'utf8';
          const content = await fsp.readFile(filePath, encoding);
          reply(socket, id, { content, encoding });
        } catch (err) {
          replyError(
            socket,
            id,
            'AC_ERR_FS_READ',
            (err as Error)?.message || 'Failed to read file.'
          );
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
          reply(socket, id, { bytes });
        } catch (err) {
          replyError(
            socket,
            id,
            'AC_ERR_FS_WRITE',
            (err as Error)?.message || 'Failed to write file.'
          );
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
          reply(socket, id, { entries: results });
        } catch (err) {
          replyError(
            socket,
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
          reply(socket, id, {
            type: mapFileType(stat),
            size: stat.size,
            mtime: stat.mtime.toISOString(),
          });
        } catch (err) {
          replyError(
            socket,
            id,
            'AC_ERR_FS_STAT',
            (err as Error)?.message || 'Failed to stat file.'
          );
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
          reply(socket, id, { pid: child.pid });
        } catch (err) {
          replyError(
            socket,
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
          reply(socket, id, { success: Boolean(success) });
        } catch (err) {
          replyError(
            socket,
            id,
            'AC_ERR_PROCESS',
            (err as Error)?.message || 'Failed to kill process.'
          );
        }
        return;
      }

      if (method === 'acp.net.request') {
        recordCapability('network.request');
        try {
          if (typeof fetch !== 'function') {
            replyError(socket, id, 'AC_ERR_NET', 'Fetch is not available.');
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
          reply(socket, id, { status: res.status, headers, body });
        } catch (err) {
          replyError(
            socket,
            id,
            'AC_ERR_NET',
            (err as Error)?.message || 'Network request failed.'
          );
        }
        return;
      }

      if (method === 'acp.backend.start') {
        recordCapability('backend.run');
        if (!manifest?.backend) {
          reply(socket, id, { status: 'disabled' });
          return;
        }
        const backendConfig = manifest.backend;
        const existing = backendState.get(appId);
        if (existing?.status === 'running') {
          reply(socket, id, { status: 'running', url: existing.url });
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
            AGENTCONNECT_HOST: `ws://${host}:${port}`,
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
          const url = assignedPort ? `http://${host}:${assignedPort}` : undefined;
          const record: BackendState = { status: 'starting', pid: child.pid, url };
          backendState.set(appId, record);
          child.on('exit', () => {
            backendState.set(appId, { status: 'stopped' });
          });
          if (backendConfig.healthcheck?.type === 'http' && assignedPort) {
            const healthUrl = `http://${host}:${assignedPort}${backendConfig.healthcheck.path}`;
            const ok = await waitForHealthcheck(healthUrl);
            if (!ok) {
              child.kill('SIGTERM');
              backendState.set(appId, { status: 'error' });
              reply(socket, id, { status: 'error' });
              return;
            }
          }
          backendState.set(appId, { status: 'running', pid: child.pid, url });
          reply(socket, id, { status: 'running', url });
        } catch (err) {
          replyError(
            socket,
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
          reply(socket, id, { status: 'stopped' });
          return;
        }
        try {
          process.kill(current.pid, 'SIGTERM');
        } catch {
          // ignore
        }
        backendState.set(appId, { status: 'stopped' });
        reply(socket, id, { status: 'stopped' });
        return;
      }

      if (method === 'acp.backend.status') {
        recordCapability('backend.run');
        const current = backendState.get(appId) || { status: 'stopped' };
        reply(socket, id, { status: current.status, url: current.url });
        return;
      }

      if (method === 'acp.capabilities.observed') {
        reply(socket, id, { ...observedTracker.snapshot() });
        return;
      }

      reply(socket, id, {});
    });
  });

  server.listen(port, host, () => {
    console.log(`AgentConnect dev host running at ws://${host}:${port}`);
    if (appPath) console.log(`App path: ${appPath}`);
    if (uiUrl) console.log(`UI dev server: ${uiUrl}`);
  });

  process.on('SIGINT', () => {
    try {
      observedTracker.flush();
    } catch {
      // ignore flush errors
    }
    server.close(() => process.exit(0));
  });
}
