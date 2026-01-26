import net from 'net';
import { startDevHost } from '@agentconnect/host';

const HOST_KEY = '__agentconnect_dev_host_state__';
const READY_TIMEOUT_MS = 15000;
const READY_POLL_MS = 200;

type HostState = {
  ready?: Promise<void>;
};

function getState(): HostState {
  const globalAny = globalThis as typeof globalThis & { [HOST_KEY]?: HostState };
  if (!globalAny[HOST_KEY]) {
    globalAny[HOST_KEY] = {};
  }
  return globalAny[HOST_KEY] as HostState;
}

function normalizeHost(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function isLocalHost(value: string): boolean {
  const host = normalizeHost(value).toLowerCase();
  return (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host === '0.0.0.0' ||
    host === '::'
  );
}

function parseHostString(raw: string): { host: string; port: number | null } {
  const trimmed = raw.trim();
  if (trimmed.includes('://')) {
    try {
      const url = new URL(trimmed);
      const port = url.port ? Number(url.port) : null;
      return { host: url.hostname || trimmed, port: Number.isFinite(port) ? port : null };
    } catch {
      return { host: trimmed, port: null };
    }
  }

  const lastColon = trimmed.lastIndexOf(':');
  if (lastColon > 0 && lastColon < trimmed.length - 1) {
    const hostPart = trimmed.slice(0, lastColon);
    const portPart = trimmed.slice(lastColon + 1);
    const port = Number(portPart);
    if (Number.isFinite(port)) {
      return { host: hostPart, port };
    }
  }

  return { host: trimmed, port: null };
}

function resolveHostPort(): { host: string; port: number; local: boolean } {
  const fallback = { host: '127.0.0.1', port: 9630 };
  const raw = process.env.AGENTCONNECT_HOST;
  if (raw) {
    const parsed = parseHostString(raw);
    const host = parsed.host || fallback.host;
    const port = parsed.port ?? fallback.port;
    return { host, port, local: isLocalHost(host) };
  }
  return { ...fallback, local: true };
}

function isPortOpen(host: string, port: number, timeoutMs = 300): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('error', () => done(false));
    socket.once('timeout', () => done(false));
    socket.connect(port, host, () => done(true));
  });
}

async function waitForPort(host: string, port: number, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isPortOpen(host, port)) return true;
    await new Promise((resolve) => setTimeout(resolve, READY_POLL_MS));
  }
  return isPortOpen(host, port);
}

export async function ensureAgentConnectHost(): Promise<void> {
  const state = getState();
  if (state.ready) return state.ready;

  state.ready = (async () => {
    const basePath = process.env.AGENTCONNECT_APP_PATH || process.cwd();
    const { host, port, local } = resolveHostPort();
    const portOverride = process.env.AGENTCONNECT_PORT;
    const resolvedPort = portOverride ? Number(portOverride) : port;
    const finalPort = Number.isFinite(resolvedPort) ? resolvedPort : port;

    const alreadyOpen = await isPortOpen(host, finalPort);
    if (alreadyOpen) return;
    if (!local) return;

    startDevHost({
      host,
      port: finalPort,
      appPath: basePath,
    });

    const ready = await waitForPort(host, finalPort, READY_TIMEOUT_MS);
    if (!ready) {
      throw new Error(`AgentConnect host did not start on ${host}:${finalPort}`);
    }
  })();

  return state.ready;
}
