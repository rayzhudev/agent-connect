import { spawn } from 'child_process';
import path from 'path';
import type {
  ProviderStatus,
  RunPromptOptions,
  RunPromptResult,
  InstallResult,
  ModelInfo,
  ProviderLoginOptions,
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
  runCommand,
} from './utils.js';

const INSTALL_UNIX = 'curl https://cursor.com/install -fsS | bash';
const DEFAULT_LOGIN = 'cursor-agent login';
const DEFAULT_STATUS = 'cursor-agent status';
const CURSOR_MODELS_COMMAND = 'cursor-agent models';
const CURSOR_MODELS_CACHE_TTL_MS = 60_000;
let cursorModelsCache: ModelInfo[] | null = null;
let cursorModelsCacheAt = 0;

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
  debugLog('Cursor', 'status-check', {
    command,
    versionOk: versionCheck.ok,
    version: versionCheck.version,
    installed,
  });
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

  return { installed, loggedIn, version: versionCheck.version || undefined };
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
  onEvent,
  signal,
}: RunPromptOptions): Promise<RunPromptResult> {
  return new Promise((resolve) => {
    const command = getCursorCommand();
    const resolvedRepoRoot = repoRoot ? path.resolve(repoRoot) : null;
    const resolvedCwd = cwd ? path.resolve(cwd) : null;
    const runDir = resolvedCwd || resolvedRepoRoot || process.cwd();
    const cdTarget = resolvedRepoRoot || resolvedCwd || runDir;
    const args: string[] = ['--print', '--output-format', 'stream-json'];

    if (cdTarget) {
      args.push('--cwd', cdTarget);
    }
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
    debugLog('Cursor', 'spawn', { command, args: argsPreview, cwd: runDir });

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

    const pushLine = (list: string[], line: string): void => {
      if (!line) return;
      list.push(line);
      if (list.length > 12) list.shift();
    };

    const emitError = (message: string): void => {
      if (sawError) return;
      sawError = true;
      onEvent({ type: 'error', message });
    };

    const emitFinal = (text: string): void => {
      if (didFinalize) return;
      didFinalize = true;
      if (finalSessionId) {
        onEvent({ type: 'final', text, providerSessionId: finalSessionId });
      } else {
        onEvent({ type: 'final', text });
      }
    };

    const handleEvent = (ev: CursorEvent): void => {
      const normalized = normalizeCursorEvent(ev);
      onEvent({ type: 'provider_event', provider: 'cursor', event: normalized });

      const sid = extractSessionId(ev);
      if (sid) finalSessionId = sid;

      const usage = extractUsage(ev);
      if (usage) {
        onEvent({
          type: 'usage',
          inputTokens: usage.input_tokens,
          outputTokens: usage.output_tokens,
        });
      }

      if (isErrorEvent(ev)) {
        const message = extractErrorMessage(ev) || 'Cursor run failed';
        emitError(message);
        return;
      }

      const delta = extractAssistantDelta(ev);
      if (delta) {
        aggregated += delta;
        onEvent({ type: 'delta', text: delta });
      }

      if (ev.type === 'result') {
        const resultText = extractResultText(ev);
        if (!aggregated && resultText) {
          aggregated = resultText;
        }
        if (!sawError) {
          emitFinal(aggregated || resultText || '');
        }
      }
    };

    const handleLine = (line: string, source: 'stdout' | 'stderr'): void => {
      const trimmed = line.trim();
      if (!trimmed) return;
      const payload = trimmed.startsWith('data: ') ? trimmed.slice(6).trim() : trimmed;
      const parsed = safeJsonParse(payload);
      if (!parsed || typeof parsed !== 'object') {
        onEvent({ type: 'raw_line', line });
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
