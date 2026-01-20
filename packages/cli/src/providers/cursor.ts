import { spawn } from 'child_process';
import path from 'path';
import type {
  ProviderStatus,
  RunPromptOptions,
  RunPromptResult,
  InstallResult,
  ModelInfo,
  ProviderLoginOptions,
  ProviderDetail,
} from '../types.js';
import {
  buildInstallCommand,
  buildLoginCommand,
  buildStatusCommand,
  checkCommandVersion,
  commandExists,
  createLineParser,
  debugLog,
  resolveWindowsCommand,
  resolveCommandPath,
  resolveCommandRealPath,
  runCommand,
} from './utils.js';

const INSTALL_UNIX = 'curl https://cursor.com/install -fsS | bash';
const DEFAULT_LOGIN = 'cursor-agent login';
const DEFAULT_STATUS = 'cursor-agent status';
const CURSOR_MODELS_COMMAND = 'cursor-agent models';
const CURSOR_MODELS_CACHE_TTL_MS = 60_000;
const CURSOR_UPDATE_COMMAND = 'cursor-agent update';
const CURSOR_UPDATE_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
let cursorModelsCache: ModelInfo[] | null = null;
let cursorModelsCacheAt = 0;
let cursorUpdateCache: {
  checkedAt: number;
  updateAvailable?: boolean;
  latestVersion?: string;
  updateMessage?: string;
} | null = null;
let cursorUpdatePromise: Promise<void> | null = null;

type CursorUpdateAction = {
  command: string;
  args: string[];
  source: 'brew' | 'script';
  commandLabel: string;
};

function trimOutput(value: string, limit = 400): string {
  const cleaned = value.trim();
  if (!cleaned) return '';
  if (cleaned.length <= limit) return cleaned;
  return `${cleaned.slice(0, limit)}...`;
}

function normalizePath(value: string): string {
  const normalized = value.replace(/\\/g, '/');
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function parseSemver(value: string | undefined): [number, number, number] | null {
  if (!value) return null;
  const match = value.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareSemver(a: [number, number, number], b: [number, number, number]): number {
  if (a[0] !== b[0]) return a[0] - b[0];
  if (a[1] !== b[1]) return a[1] - b[1];
  return a[2] - b[2];
}

async function fetchBrewCaskVersion(cask: string): Promise<string | null> {
  if (!commandExists('brew')) return null;
  const result = await runCommand('brew', ['info', '--json=v2', '--cask', cask]);
  if (result.code !== 0) return null;
  try {
    const parsed = JSON.parse(result.stdout) as { casks?: Array<{ version?: string }> };
    const version = parsed?.casks?.[0]?.version;
    return typeof version === 'string' ? version : null;
  } catch {
    return null;
  }
}

function getCursorUpdateAction(commandPath: string | null): CursorUpdateAction | null {
  if (!commandPath) return null;
  const normalized = normalizePath(commandPath);

  if (
    normalized.includes('/cellar/') ||
    normalized.includes('/caskroom/') ||
    normalized.includes('/homebrew/')
  ) {
    return {
      command: 'brew',
      args: ['upgrade', '--cask', 'cursor'],
      source: 'brew',
      commandLabel: 'brew upgrade --cask cursor',
    };
  }

  if (
    normalized.includes('/.local/bin/') ||
    normalized.includes('/.local/share/cursor-agent/versions/')
  ) {
    return {
      command: 'bash',
      args: ['-lc', INSTALL_UNIX],
      source: 'script',
      commandLabel: INSTALL_UNIX,
    };
  }

  return null;
}
export function getCursorCommand(): string {
  const override = process.env.AGENTCONNECT_CURSOR_COMMAND;
  const base = override || 'cursor-agent';
  const resolved = resolveCommandPath(base);
  return resolved || resolveWindowsCommand(base);
}

function getCursorApiKey(): string {
  return process.env.CURSOR_API_KEY || process.env.AGENTCONNECT_CURSOR_API_KEY || '';
}

function getCursorDefaultModel(): string {
  return process.env.AGENTCONNECT_CURSOR_MODEL?.trim() || '';
}

function resolveCursorEndpoint(): string {
  return process.env.AGENTCONNECT_CURSOR_ENDPOINT?.trim() || '';
}

function withCursorEndpoint(args: string[]): string[] {
  const endpoint = resolveCursorEndpoint();
  if (!endpoint) return args;
  if (args.includes('--endpoint')) return args;
  return [...args, '--endpoint', endpoint];
}

function resolveCursorModel(model: string | undefined, fallback: string): string {
  if (!model) return fallback;
  const raw = String(model);
  if (raw === 'cursor' || raw === 'cursor-default') return fallback;
  if (raw.startsWith('cursor:')) return raw.slice('cursor:'.length);
  if (raw.startsWith('cursor/')) return raw.slice('cursor/'.length);
  return raw;
}

function formatCursorDefaultLabel(fallback: string): string {
  if (!fallback) return 'Default';
  return `Default · ${fallback}`;
}

function normalizeCursorModelId(value: string): string {
  if (value.startsWith('cursor:') || value.startsWith('cursor/')) return value;
  return `cursor:${value}`;
}

function normalizeCursorModelDisplay(value: string): string {
  if (value.startsWith('cursor:')) return value.slice('cursor:'.length);
  if (value.startsWith('cursor/')) return value.slice('cursor/'.length);
  return value;
}

async function listCursorModelsFromCli(): Promise<ModelInfo[]> {
  const command = getCursorCommand();
  if (!commandExists(command)) return [];
  const modelsCommand = buildStatusCommand(
    'AGENTCONNECT_CURSOR_MODELS_COMMAND',
    CURSOR_MODELS_COMMAND
  );
  if (!modelsCommand.command) return [];
  const resolvedCommand = resolveWindowsCommand(modelsCommand.command);
  const result = await runCommand(resolvedCommand, withCursorEndpoint(modelsCommand.args), {
    env: buildCursorEnv(),
  });
  const output = `${result.stdout}\n${result.stderr}`.trim();
  if (!output) return [];
  const parsed = safeJsonParse(output);
  if (Array.isArray(parsed)) {
    const models = parsed
      .map((entry) => {
        if (typeof entry === 'string' && entry.trim()) {
          const value = entry.trim();
          return {
            id: normalizeCursorModelId(value),
            provider: 'cursor',
            displayName: normalizeCursorModelDisplay(value),
          } as ModelInfo;
        }
        if (entry && typeof entry === 'object') {
          const record = entry as Record<string, unknown>;
          const idRaw = typeof record.id === 'string' ? record.id.trim() : '';
          const nameRaw = typeof record.name === 'string' ? record.name.trim() : '';
          const displayRaw =
            typeof record.displayName === 'string' ? record.displayName.trim() : '';
          const value = idRaw || nameRaw || displayRaw;
          if (!value) return null;
          return {
            id: normalizeCursorModelId(value),
            provider: 'cursor',
            displayName: normalizeCursorModelDisplay(displayRaw || nameRaw || value),
          } as ModelInfo;
        }
        return null;
      })
      .filter(Boolean) as ModelInfo[];
    return models;
  }
  const lines = output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.toLowerCase().startsWith('model'))
    .filter((line) => !/^[-=]{2,}$/.test(line));
  return lines.map((line) => {
    const cleaned = line.replace(/^[-*•]\s*/, '');
    const value = cleaned.split(/\s+/)[0] || cleaned;
    return {
      id: normalizeCursorModelId(value),
      provider: 'cursor',
      displayName: normalizeCursorModelDisplay(value),
    };
  });
}

export async function listCursorModels(): Promise<ModelInfo[]> {
  if (cursorModelsCache && Date.now() - cursorModelsCacheAt < CURSOR_MODELS_CACHE_TTL_MS) {
    return cursorModelsCache;
  }
  const fallback = getCursorDefaultModel();
  const base: ModelInfo[] = [
    {
      id: 'cursor-default',
      provider: 'cursor',
      displayName: formatCursorDefaultLabel(fallback),
    },
  ];

  const envModels = process.env.AGENTCONNECT_CURSOR_MODELS;
  if (envModels) {
    try {
      const parsed = JSON.parse(envModels) as unknown;
      if (Array.isArray(parsed)) {
        for (const entry of parsed) {
          if (typeof entry === 'string' && entry.trim()) {
            const trimmed = entry.trim();
            base.push({
              id: normalizeCursorModelId(trimmed),
              provider: 'cursor',
              displayName: normalizeCursorModelDisplay(trimmed),
            });
          }
        }
      }
    } catch {
      // ignore invalid json
    }
  }

  const cliModels = await listCursorModelsFromCli();
  base.push(...cliModels);

  const seen = new Set<string>();
  const list = base.filter((entry) => {
    const key = `${entry.provider}:${entry.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  cursorModelsCache = list;
  cursorModelsCacheAt = Date.now();
  return list;
}

function normalizeCursorStatusOutput(output: string): boolean | null {
  const text = output.toLowerCase();
  if (
    text.includes('not authenticated') ||
    text.includes('not logged in') ||
    text.includes('login required') ||
    text.includes('please login') ||
    text.includes('please log in') ||
    text.includes('unauthorized')
  ) {
    return false;
  }
  if (
    text.includes('authenticated') ||
    text.includes('logged in') ||
    text.includes('signed in') ||
    text.includes('account')
  ) {
    return true;
  }
  return null;
}

function parseUpdateOutput(output: string): {
  updateAvailable?: boolean;
  latestVersion?: string;
  updateMessage?: string;
} {
  const text = output.toLowerCase();
  const message = output.trim() || undefined;
  if (
    text.includes('already up to date') ||
    text.includes('already up-to-date') ||
    text.includes('up to date') ||
    text.includes('up-to-date') ||
    text.includes('no updates')
  ) {
    return { updateAvailable: false, updateMessage: message };
  }
  if (
    text.includes('update available') ||
    text.includes('new version') ||
    text.includes('update found')
  ) {
    return { updateAvailable: true, updateMessage: message };
  }
  if (text.includes('updated') || text.includes('upgraded') || text.includes('installing')) {
    return { updateAvailable: false, updateMessage: message };
  }
  return { updateAvailable: undefined, updateMessage: message };
}

function getCursorUpdateSnapshot(commandPath: string | null): {
  updateAvailable?: boolean;
  latestVersion?: string;
  updateCheckedAt?: number;
  updateSource?: 'cli' | 'npm' | 'bun' | 'brew' | 'winget' | 'script' | 'unknown';
  updateCommand?: string;
  updateMessage?: string;
} {
  if (cursorUpdateCache && Date.now() - cursorUpdateCache.checkedAt < CURSOR_UPDATE_CACHE_TTL_MS) {
    const action = getCursorUpdateAction(commandPath);
    return {
      updateAvailable: cursorUpdateCache.updateAvailable,
      latestVersion: cursorUpdateCache.latestVersion,
      updateCheckedAt: cursorUpdateCache.checkedAt,
      updateSource: action?.source ?? 'unknown',
      updateCommand: action?.commandLabel,
      updateMessage: cursorUpdateCache.updateMessage,
    };
  }
  return {};
}

function ensureCursorUpdateCheck(currentVersion?: string, commandPath?: string | null): void {
  if (cursorUpdateCache && Date.now() - cursorUpdateCache.checkedAt < CURSOR_UPDATE_CACHE_TTL_MS) {
    return;
  }
  if (cursorUpdatePromise) return;
  cursorUpdatePromise = (async () => {
    const action = getCursorUpdateAction(commandPath || null);
    let latest: string | null = null;
    let updateAvailable: boolean | undefined;
    let updateMessage: string | undefined;

    if (action?.source === 'brew') {
      latest = await fetchBrewCaskVersion('cursor');
    }

    if (latest && currentVersion) {
      const a = parseSemver(currentVersion);
      const b = parseSemver(latest);
      if (a && b) {
        updateAvailable = compareSemver(a, b) < 0;
        updateMessage = updateAvailable
          ? `Update available: ${currentVersion} -> ${latest}`
          : `Up to date (${currentVersion})`;
      }
    } else if (!action) {
      updateMessage = 'Update check unavailable';
    }

    debugLog('Cursor', 'update-check', {
      updateAvailable,
      message: updateMessage,
    });
    cursorUpdateCache = {
      checkedAt: Date.now(),
      updateAvailable,
      latestVersion: latest ?? undefined,
      updateMessage,
    };
  })().finally(() => {
    cursorUpdatePromise = null;
  });
}

export async function ensureCursorInstalled(): Promise<InstallResult> {
  const command = getCursorCommand();
  const versionCheck = await checkCommandVersion(command, [['--version'], ['-V']]);
  debugLog('Cursor', 'install-check', {
    command,
    versionOk: versionCheck.ok,
    version: versionCheck.version,
  });
  if (versionCheck.ok) {
    return { installed: true, version: versionCheck.version || undefined };
  }
  if (commandExists(command)) {
    return { installed: true, version: undefined };
  }

  const override = buildInstallCommand('AGENTCONNECT_CURSOR_INSTALL', '');
  let install = override;
  let packageManager: InstallResult['packageManager'] = override.command ? 'unknown' : 'unknown';

  if (!install.command) {
    if (process.platform !== 'win32' && commandExists('bash') && commandExists('curl')) {
      install = { command: 'bash', args: ['-lc', INSTALL_UNIX] };
      packageManager = 'script';
    }
  }

  if (!install.command) {
    return { installed: false, version: undefined, packageManager };
  }

  await runCommand(install.command, install.args, { shell: process.platform === 'win32' });
  const after = await checkCommandVersion(command, [['--version'], ['-V']]);
  return {
    installed: after.ok,
    version: after.version || undefined,
    packageManager,
  };
}

export async function getCursorStatus(): Promise<ProviderStatus> {
  const command = getCursorCommand();
  const versionCheck = await checkCommandVersion(command, [['--version'], ['-V']]);
  const installed = versionCheck.ok || commandExists(command);
  let loggedIn = false;

  if (installed) {
    const status = buildStatusCommand('AGENTCONNECT_CURSOR_STATUS', DEFAULT_STATUS);
    if (status.command) {
      const statusCommand = resolveWindowsCommand(status.command);
      const result = await runCommand(statusCommand, withCursorEndpoint(status.args), {
        env: buildCursorEnv(),
      });
      const output = `${result.stdout}\n${result.stderr}`;
      const parsed = normalizeCursorStatusOutput(output);
      loggedIn = parsed ?? result.code === 0;
    }
    if (!loggedIn) {
      loggedIn = Boolean(getCursorApiKey().trim());
    }
  }

  if (installed) {
    const resolved = resolveCommandRealPath(command);
    ensureCursorUpdateCheck(versionCheck.version, resolved || null);
  }
  const resolved = resolveCommandRealPath(command);
  const updateInfo = installed ? getCursorUpdateSnapshot(resolved || null) : {};
  return { installed, loggedIn, version: versionCheck.version || undefined, ...updateInfo };
}

export async function getCursorFastStatus(): Promise<ProviderStatus> {
  const command = getCursorCommand();
  const installed = commandExists(command);
  if (!installed) {
    return { installed: false, loggedIn: false };
  }
  return { installed: true, loggedIn: true };
}

export async function updateCursor(): Promise<ProviderStatus> {
  const command = getCursorCommand();
  if (!commandExists(command)) {
    return { installed: false, loggedIn: false };
  }
  const resolved = resolveCommandRealPath(command);
  const updateOverride = buildStatusCommand('AGENTCONNECT_CURSOR_UPDATE', '');
  const action = updateOverride.command ? null : getCursorUpdateAction(resolved || null);
  const updateCommand = updateOverride.command || action?.command || '';
  const updateArgs = updateOverride.command ? updateOverride.args : action?.args || [];

  if (!updateCommand) {
    throw new Error('No update command available. Please update Cursor manually.');
  }

  const cmd = resolveWindowsCommand(updateCommand);
  debugLog('Cursor', 'update-run', { command: cmd, args: updateArgs });
  const result = await runCommand(cmd, updateArgs, { env: buildCursorEnv() });
  debugLog('Cursor', 'update-result', {
    code: result.code,
    stdout: trimOutput(result.stdout),
    stderr: trimOutput(result.stderr),
  });
  if (result.code !== 0 && result.code !== null) {
    const message = trimOutput(`${result.stdout}\n${result.stderr}`, 800) || 'Update failed';
    throw new Error(message);
  }
  cursorUpdateCache = null;
  cursorUpdatePromise = null;
  return getCursorStatus();
}

function buildCursorEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  const apiKey = getCursorApiKey().trim();
  if (apiKey) {
    env.CURSOR_API_KEY = apiKey;
  }
  return env;
}

export async function loginCursor(options?: ProviderLoginOptions): Promise<{ loggedIn: boolean }> {
  if (typeof options?.apiKey === 'string') {
    process.env.CURSOR_API_KEY = options.apiKey;
  }
  if (typeof options?.baseUrl === 'string') {
    process.env.AGENTCONNECT_CURSOR_ENDPOINT = options.baseUrl;
  }
  if (typeof options?.model === 'string') {
    process.env.AGENTCONNECT_CURSOR_MODEL = options.model;
    cursorModelsCache = null;
    cursorModelsCacheAt = 0;
  }
  if (Array.isArray(options?.models)) {
    process.env.AGENTCONNECT_CURSOR_MODELS = JSON.stringify(options.models.filter(Boolean));
    cursorModelsCache = null;
    cursorModelsCacheAt = 0;
  }

  if (!options?.apiKey) {
    const login = buildLoginCommand('AGENTCONNECT_CURSOR_LOGIN', DEFAULT_LOGIN);
    if (login.command) {
      const command = resolveWindowsCommand(login.command);
      await runCommand(command, withCursorEndpoint(login.args), { env: buildCursorEnv() });
    }
  }

  const timeoutMs = Number(process.env.AGENTCONNECT_CURSOR_LOGIN_TIMEOUT_MS || 20_000);
  const pollIntervalMs = Number(process.env.AGENTCONNECT_CURSOR_LOGIN_POLL_MS || 1_000);
  const start = Date.now();
  let status = await getCursorStatus();
  while (!status.loggedIn && Date.now() - start < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    status = await getCursorStatus();
  }
  return { loggedIn: status.loggedIn };
}

function safeJsonParse(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

interface CursorEvent {
  type?: string;
  subtype?: string;
  apiKeySource?: string;
  cwd?: string;
  model?: string;
  permissionMode?: string;
  timestamp_ms?: number;
  call_id?: string;
  tool_call?: Record<string, unknown>;
  session_id?: string;
  sessionId?: string;
  message?: { role?: string; content?: unknown };
  content?: unknown;
  text?: string;
  delta?: string;
  result?: unknown;
  error?: { message?: string } | string;
  usage?: TokenUsage;
  token_usage?: TokenUsage;
  tokenUsage?: TokenUsage;
  tokens?: TokenUsage;
}

function extractSessionId(ev: CursorEvent): string | null {
  const id = ev.session_id ?? ev.sessionId;
  return typeof id === 'string' ? id : null;
}

interface TokenUsage {
  input_tokens?: number;
  prompt_tokens?: number;
  inputTokens?: number;
  promptTokens?: number;
  output_tokens?: number;
  completion_tokens?: number;
  outputTokens?: number;
  completionTokens?: number;
  total_tokens?: number;
  totalTokens?: number;
}

interface ExtractedUsage {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
}

function extractUsage(ev: CursorEvent): ExtractedUsage | null {
  const usage = ev.usage ?? ev.token_usage ?? ev.tokenUsage ?? ev.tokens;
  if (!usage || typeof usage !== 'object') return null;
  const toNumber = (v: unknown): number | undefined =>
    typeof v === 'number' && Number.isFinite(v) ? v : undefined;
  const input = toNumber(
    usage.input_tokens ?? usage.prompt_tokens ?? usage.inputTokens ?? usage.promptTokens
  );
  const output = toNumber(
    usage.output_tokens ?? usage.completion_tokens ?? usage.outputTokens ?? usage.completionTokens
  );
  const total = toNumber(usage.total_tokens ?? usage.totalTokens);
  const out: ExtractedUsage = {};
  if (input !== undefined) out.input_tokens = input;
  if (output !== undefined) out.output_tokens = output;
  if (total !== undefined) out.total_tokens = total;
  return Object.keys(out).length ? out : null;
}

function extractTextFromContent(content: unknown): string {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (!part) return '';
        if (typeof part === 'string') return part;
        if (typeof part === 'object') {
          const text = (part as { text?: unknown }).text;
          if (typeof text === 'string') return text;
        }
        return '';
      })
      .join('');
  }
  if (typeof content === 'object') {
    const text = (content as { text?: unknown }).text;
    if (typeof text === 'string') return text;
  }
  return '';
}

type CursorToolCall = {
  name?: string;
  input?: unknown;
  output?: unknown;
  callId?: string;
  phase?: 'start' | 'delta' | 'completed' | 'error';
};

function extractToolCall(ev: CursorEvent): CursorToolCall | null {
  if (ev.type !== 'tool_call') return null;
  const toolCall = ev.tool_call && typeof ev.tool_call === 'object' ? ev.tool_call : null;
  if (!toolCall) return null;
  const keys = Object.keys(toolCall);
  if (!keys.length) return null;
  const name = keys[0];
  const entry = (toolCall as Record<string, unknown>)[name];
  const record = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : null;
  const input = record?.args ?? record?.input ?? undefined;
  const output = record?.output ?? record?.result ?? undefined;
  const subtype = typeof ev.subtype === 'string' ? ev.subtype : '';
  const phase =
    subtype === 'completed'
      ? 'completed'
      : subtype === 'started'
        ? 'start'
        : subtype === 'error'
          ? 'error'
          : subtype === 'delta'
            ? 'delta'
            : undefined;
  return {
    name,
    input,
    output,
    callId: typeof ev.call_id === 'string' ? ev.call_id : undefined,
    phase,
  };
}

function extractTextFromMessage(message: unknown): string {
  if (!message || typeof message !== 'object') return '';
  const content = (message as { content?: unknown }).content;
  return extractTextFromContent(content);
}

function extractAssistantDelta(ev: CursorEvent): string | null {
  if (ev.type !== 'assistant' && ev.message?.role !== 'assistant') return null;
  if (typeof ev.text === 'string') return ev.text;
  if (typeof ev.delta === 'string') return ev.delta;
  if (ev.message) {
    const text = extractTextFromMessage(ev.message);
    return text || null;
  }
  if (ev.content) {
    const text = extractTextFromContent(ev.content);
    return text || null;
  }
  return null;
}

function extractResultText(ev: CursorEvent): string | null {
  if (typeof ev.result === 'string') return ev.result;
  if (ev.result && typeof ev.result === 'object') {
    const result = ev.result as { text?: unknown; message?: unknown; content?: unknown };
    if (typeof result.text === 'string') return result.text;
    if (result.message) {
      const text = extractTextFromMessage(result.message);
      if (text) return text;
    }
    if (result.content) {
      const text = extractTextFromContent(result.content);
      if (text) return text;
    }
  }
  if (ev.message) {
    const text = extractTextFromMessage(ev.message);
    if (text) return text;
  }
  return null;
}

function isErrorEvent(ev: CursorEvent): boolean {
  if (ev.type === 'error') return true;
  if (ev.type === 'result' && ev.subtype) {
    const subtype = String(ev.subtype).toLowerCase();
    if (subtype.includes('error') || subtype.includes('failed')) return true;
  }
  return false;
}

function extractErrorMessage(ev: CursorEvent): string | null {
  if (typeof ev.error === 'string') return ev.error;
  if (ev.error && typeof ev.error === 'object' && typeof ev.error.message === 'string') {
    return ev.error.message;
  }
  if (typeof ev.text === 'string' && ev.type === 'error') return ev.text;
  if (typeof ev.result === 'string' && ev.type === 'result') return ev.result;
  return null;
}

function normalizeCursorEvent(raw: CursorEvent): Record<string, unknown> {
  if (!raw || typeof raw !== 'object') return { type: 'unknown' };
  const type = typeof raw.type === 'string' ? raw.type : 'unknown';
  return { ...raw, type };
}

export function runCursorPrompt({
  prompt,
  resumeSessionId,
  model,
  repoRoot,
  cwd,
  providerDetailLevel,
  onEvent,
  signal,
}: RunPromptOptions): Promise<RunPromptResult> {
  return new Promise((resolve) => {
    const command = getCursorCommand();
    const resolvedRepoRoot = repoRoot ? path.resolve(repoRoot) : null;
    const resolvedCwd = cwd ? path.resolve(cwd) : null;
    const runDir = resolvedCwd || resolvedRepoRoot || process.cwd();
    const args: string[] = ['--print', '--output-format', 'stream-json'];

    if (resumeSessionId) {
      args.push('--resume', resumeSessionId);
    }
    const fallbackModel = getCursorDefaultModel();
    const resolvedModel = resolveCursorModel(model, fallbackModel);
    if (resolvedModel) {
      args.push('--model', resolvedModel);
    }
    const endpoint = resolveCursorEndpoint();
    if (endpoint) {
      args.push('--endpoint', endpoint);
    }

    args.push(prompt);

    const argsPreview = [...args];
    if (argsPreview.length > 0) {
      argsPreview[argsPreview.length - 1] = '[prompt]';
    }
    debugLog('Cursor', 'spawn', {
      command,
      args: argsPreview,
      cwd: runDir,
      model: resolvedModel || null,
      endpoint: endpoint || null,
      resume: resumeSessionId || null,
      apiKeyConfigured: Boolean(getCursorApiKey().trim()),
      promptChars: prompt.length,
    });

    const child = spawn(command, args, {
      cwd: runDir,
      env: buildCursorEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    if (signal) {
      signal.addEventListener('abort', () => {
        child.kill('SIGTERM');
      });
    }

    let aggregated = '';
    let finalSessionId: string | null = null;
    let didFinalize = false;
    let sawError = false;
    let sawJson = false;
    let rawOutput = '';
    const stdoutLines: string[] = [];
    const stderrLines: string[] = [];

    const includeRaw = providerDetailLevel === 'raw';
    const buildProviderDetail = (
      eventType: string,
      data?: Record<string, unknown>,
      raw?: unknown
    ): ProviderDetail => {
      const detail: ProviderDetail = { eventType };
      if (data && Object.keys(data).length) detail.data = data;
      if (includeRaw && raw !== undefined) detail.raw = raw;
      return detail;
    };
    const emit = (event: Parameters<RunPromptOptions['onEvent']>[0]): void => {
      if (finalSessionId) {
        onEvent({ ...event, providerSessionId: finalSessionId });
      } else {
        onEvent(event);
      }
    };

    const pushLine = (list: string[], line: string): void => {
      if (!line) return;
      list.push(line);
      if (list.length > 12) list.shift();
    };

    const emitError = (message: string, providerDetail?: ProviderDetail): void => {
      if (sawError) return;
      sawError = true;
      emit({ type: 'error', message, providerDetail });
    };

    const emitFinal = (text: string): void => {
      if (didFinalize) return;
      didFinalize = true;
      emit({ type: 'final', text });
    };

    const handleEvent = (ev: CursorEvent): void => {
      const normalized = normalizeCursorEvent(ev);
      if (ev?.type === 'system' && ev?.subtype === 'init') {
        debugLog('Cursor', 'init', {
          apiKeySource: ev.apiKeySource || null,
          cwd: ev.cwd || null,
          model: ev.model || null,
          permissionMode: ev.permissionMode || null,
          sessionId: ev.session_id ?? ev.sessionId ?? null,
        });
        emit({
          type: 'detail',
          provider: 'cursor',
          providerDetail: buildProviderDetail(
            'system.init',
            {
              apiKeySource: ev.apiKeySource,
              cwd: ev.cwd,
              model: ev.model,
              permissionMode: ev.permissionMode,
            },
            ev
          ),
        });
      }

      const sid = extractSessionId(ev);
      if (sid) finalSessionId = sid;

      if (ev?.type === 'thinking') {
        const subtype = typeof ev.subtype === 'string' ? ev.subtype : '';
        const phase =
          subtype === 'completed'
            ? 'completed'
            : subtype === 'started'
              ? 'start'
              : subtype === 'error'
                ? 'error'
                : 'delta';
        emit({
          type: 'thinking',
          provider: 'cursor',
          phase,
          text: typeof ev.text === 'string' ? ev.text : '',
          timestampMs: typeof ev.timestamp_ms === 'number' ? ev.timestamp_ms : undefined,
          providerDetail: buildProviderDetail(
            subtype ? `thinking.${subtype}` : 'thinking',
            {
              subtype: subtype || undefined,
            },
            ev
          ),
        });
      }

      if (ev?.type === 'assistant' || ev?.type === 'user') {
        const role =
          ev.message?.role === 'assistant' || ev.message?.role === 'user'
            ? ev.message?.role
            : ev.type;
        const rawContent = ev.message?.content ?? ev.content;
        const content = extractTextFromContent(rawContent);
        emit({
          type: 'message',
          provider: 'cursor',
          role,
          content,
          contentParts: rawContent ?? null,
          providerDetail: buildProviderDetail(ev.type, {}, ev),
        });
      }

      const toolCall = extractToolCall(ev);
      if (toolCall) {
        emit({
          type: 'tool_call',
          provider: 'cursor',
          name: toolCall.name,
          callId: toolCall.callId,
          input: toolCall.input,
          output: toolCall.output,
          phase: toolCall.phase,
          providerDetail: buildProviderDetail(
            ev.subtype ? `tool_call.${ev.subtype}` : 'tool_call',
            {
              name: toolCall.name,
              callId: toolCall.callId,
              subtype: ev.subtype,
            },
            ev
          ),
        });
      }

      const usage = extractUsage(ev);
      if (usage) {
        emit({
          type: 'usage',
          inputTokens: usage.input_tokens,
          outputTokens: usage.output_tokens,
        });
      }

      if (isErrorEvent(ev)) {
        const message = extractErrorMessage(ev) || 'Cursor run failed';
        emitError(message, buildProviderDetail(ev.subtype ? `error.${ev.subtype}` : 'error', {}, ev));
        return;
      }

      const delta = extractAssistantDelta(ev);
      if (delta) {
        aggregated += delta;
        emit({ type: 'delta', text: delta, providerDetail: buildProviderDetail('delta', {}, ev) });
      }

      if (ev.type === 'result') {
        const resultText = extractResultText(ev);
        if (!aggregated && resultText) {
          aggregated = resultText;
        }
        if (!sawError) {
          emitFinal(aggregated || resultText || '');
          emit({
            type: 'detail',
            provider: 'cursor',
            providerDetail: buildProviderDetail(
              'result',
              {
                subtype: ev.subtype,
                duration_ms:
                  typeof (ev as { duration_ms?: unknown }).duration_ms === 'number'
                    ? (ev as { duration_ms?: number }).duration_ms
                    : undefined,
                request_id:
                  typeof (ev as { request_id?: unknown }).request_id === 'string'
                    ? (ev as { request_id?: string }).request_id
                    : undefined,
                is_error:
                  typeof (ev as { is_error?: unknown }).is_error === 'boolean'
                    ? (ev as { is_error?: boolean }).is_error
                    : undefined,
              },
              ev
            ),
          });
        }
      }
    };

    const handleLine = (line: string, source: 'stdout' | 'stderr'): void => {
      const trimmed = line.trim();
      if (!trimmed) return;
      const payload = trimmed.startsWith('data: ') ? trimmed.slice(6).trim() : trimmed;
      const parsed = safeJsonParse(payload);
      if (!parsed || typeof parsed !== 'object') {
        emit({ type: 'raw_line', line });
        if (source === 'stdout') {
          rawOutput += `${line}\n`;
          pushLine(stdoutLines, line);
        } else {
          pushLine(stderrLines, line);
        }
        return;
      }
      sawJson = true;
      handleEvent(parsed as CursorEvent);
    };

    const stdoutParser = createLineParser((line) => handleLine(line, 'stdout'));
    const stderrParser = createLineParser((line) => handleLine(line, 'stderr'));

    child.stdout?.on('data', stdoutParser);
    child.stderr?.on('data', stderrParser);

    child.on('close', (code) => {
      if (!didFinalize) {
        if (code && code !== 0) {
          const hint = stderrLines.at(-1) || stdoutLines.at(-1) || '';
          const suffix = hint ? `: ${hint}` : '';
          debugLog('Cursor', 'exit', { code, stderr: stderrLines, stdout: stdoutLines });
          emitError(`Cursor CLI exited with code ${code}${suffix}`);
        } else if (!sawError) {
          const fallback = !sawJson ? rawOutput.trim() : '';
          emitFinal(aggregated || fallback);
        }
      }
      resolve({ sessionId: finalSessionId });
    });

    child.on('error', (err: Error) => {
      debugLog('Cursor', 'spawn-error', { message: err?.message });
      emitError(err?.message ?? 'Cursor failed to start');
      resolve({ sessionId: finalSessionId });
    });
  });
}
