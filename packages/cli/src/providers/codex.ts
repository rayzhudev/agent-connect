import { spawn } from 'child_process';
import type {
  ProviderStatus,
  ModelInfo,
  RunPromptOptions,
  RunPromptResult,
  ReasoningEffort,
  InstallResult,
} from '../types.js';
import {
  buildInstallCommandAuto,
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

const CODEX_PACKAGE = '@openai/codex';
const DEFAULT_LOGIN = 'codex login';
const DEFAULT_STATUS = 'codex login status';
const CODEX_MODELS_CACHE_TTL_MS = 60_000;
let codexModelsCache: ModelInfo[] | null = null;
let codexModelsCacheAt = 0;

function trimOutput(value: string, limit = 400): string {
  const cleaned = value.trim();
  if (!cleaned) return '';
  if (cleaned.length <= limit) return cleaned;
  return `${cleaned.slice(0, limit)}...`;
}

export function getCodexCommand(): string {
  const override = process.env.AGENTCONNECT_CODEX_COMMAND;
  const base = override || 'codex';
  const resolved = resolveCommandPath(base);
  return resolved || resolveWindowsCommand(base);
}

export async function ensureCodexInstalled(): Promise<InstallResult> {
  const command = getCodexCommand();
  const versionCheck = await checkCommandVersion(command, [['--version'], ['-V']]);
  if (versionCheck.ok) {
    return { installed: true, version: versionCheck.version || undefined };
  }
  if (commandExists(command)) {
    return { installed: true, version: undefined };
  }

  const install = await buildInstallCommandAuto(CODEX_PACKAGE);
  if (!install.command) {
    return { installed: false, version: undefined, packageManager: install.packageManager };
  }

  debugLog('Codex', 'install', { command: install.command, args: install.args });
  const installResult = await runCommand(install.command, install.args, {
    shell: process.platform === 'win32',
  });
  debugLog('Codex', 'install-result', {
    code: installResult.code,
    stderr: trimOutput(installResult.stderr),
  });
  const after = await checkCommandVersion(command, [['--version'], ['-V']]);
  // Invalidate models cache after installation so fresh models are fetched
  codexModelsCache = null;
  codexModelsCacheAt = 0;
  return {
    installed: after.ok,
    version: after.version || undefined,
    packageManager: install.packageManager,
  };
}

export async function getCodexStatus(): Promise<ProviderStatus> {
  const command = getCodexCommand();
  const versionCheck = await checkCommandVersion(command, [['--version'], ['-V']]);
  const installed = versionCheck.ok || commandExists(command);
  let loggedIn = false;

  if (installed) {
    const status = buildStatusCommand('AGENTCONNECT_CODEX_STATUS', DEFAULT_STATUS);
    if (status.command) {
      const statusCommand = resolveWindowsCommand(status.command);
      const result = await runCommand(statusCommand, status.args);
      loggedIn = result.code === 0;
    }
  }

  return { installed, loggedIn, version: versionCheck.version || undefined };
}

export async function loginCodex(): Promise<{ loggedIn: boolean }> {
  const login = buildLoginCommand('AGENTCONNECT_CODEX_LOGIN', DEFAULT_LOGIN);
  if (!login.command) {
    return { loggedIn: false };
  }

  const command = resolveWindowsCommand(login.command);
  debugLog('Codex', 'login', { command, args: login.args });
  const result = await runCommand(command, login.args, { env: { ...process.env, CI: '1' } });
  debugLog('Codex', 'login-result', { code: result.code, stderr: trimOutput(result.stderr) });
  const status = await getCodexStatus();
  codexModelsCache = null;
  codexModelsCacheAt = 0;
  return { loggedIn: status.loggedIn };
}

function safeJsonParse(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

interface CodexEvent {
  type?: string;
  thread_id?: string;
  threadId?: string;
  session_id?: string;
  sessionId?: string;
  usage?: TokenUsage;
  token_usage?: TokenUsage;
  tokens?: TokenUsage;
  tokenUsage?: TokenUsage;
  text?: string;
  message?: string;
  item?: CodexItem;
  error?: { message?: string };
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
  cached_input_tokens?: number;
  cachedInputTokens?: number;
}

interface CodexItem {
  id?: string;
  type?: string;
  command?: string;
  aggregated_output?: string;
  exit_code?: number;
  status?: string;
  text?: string;
}

function extractSessionId(ev: CodexEvent): string | null {
  const t = String(ev.type ?? '');
  if (t === 'thread.started') {
    return typeof ev.thread_id === 'string' ? ev.thread_id : null;
  }
  const id = ev.thread_id ?? ev.threadId ?? ev.session_id ?? ev.sessionId;
  return typeof id === 'string' ? id : null;
}

interface ExtractedUsage {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  cached_input_tokens?: number;
}

function extractUsage(ev: CodexEvent): ExtractedUsage | null {
  const usage = ev.usage ?? ev.token_usage ?? ev.tokens ?? ev.tokenUsage;
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
  const cached = toNumber(usage.cached_input_tokens ?? usage.cachedInputTokens);
  const out: ExtractedUsage = {};
  if (input !== undefined) out.input_tokens = input;
  if (output !== undefined) out.output_tokens = output;
  if (total !== undefined) out.total_tokens = total;
  if (cached !== undefined) out.cached_input_tokens = cached;
  return Object.keys(out).length ? out : null;
}

interface NormalizedItem {
  id?: string;
  type?: string;
  command?: string;
  aggregated_output?: string;
  exit_code?: number;
  status?: string;
  text?: string;
}

function normalizeItem(raw: unknown): NormalizedItem | unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const item = raw as CodexItem;
  const type = item.type;
  const id = item.id;
  if (type === 'command_execution' && id) {
    return {
      id,
      type,
      command: item.command || '',
      aggregated_output: item.aggregated_output,
      exit_code: item.exit_code,
      status: item.status,
    };
  }
  if (type === 'reasoning' && id) {
    return { id, type, text: item.text || '' };
  }
  if (type === 'agent_message' && id) {
    return { id, type, text: item.text || '' };
  }
  return raw;
}

interface NormalizedEvent {
  type: string;
  item?: NormalizedItem;
  text?: string;
  message?: string;
  [key: string]: unknown;
}

function normalizeEvent(raw: CodexEvent): NormalizedEvent {
  const type = typeof raw.type === 'string' ? raw.type : 'unknown';
  if (type === 'item.started' || type === 'item.completed') {
    return { type, item: normalizeItem(raw.item) as NormalizedItem };
  }
  if (type === 'agent_message') {
    return { type, text: raw.text || '' };
  }
  if (type === 'error') {
    return { type, message: raw.message || 'Unknown error' };
  }
  return { ...raw, type };
}

function isTerminalEvent(ev: CodexEvent): boolean {
  const t = String(ev.type ?? '');
  return t === 'turn.completed' || t === 'turn.failed';
}

function normalizeEffortId(raw: unknown): string | null {
  if (!raw) return null;
  return String(raw).trim().toLowerCase();
}

function formatEffortLabel(id: string): string {
  if (!id) return '';
  const normalized = String(id).trim().toLowerCase();
  if (normalized === 'xhigh') return 'X-High';
  if (normalized === 'none') return 'None';
  if (normalized === 'minimal') return 'Minimal';
  if (normalized === 'low') return 'Low';
  if (normalized === 'medium') return 'Medium';
  if (normalized === 'high') return 'High';
  return normalized.toUpperCase();
}

interface RawEffortOption {
  reasoning_effort?: string;
  reasoningEffort?: string;
  effort?: string;
  level?: string;
}

function normalizeEffortOptions(raw: unknown): ReasoningEffort[] {
  if (!Array.isArray(raw)) return [];
  const options = raw
    .map((entry: unknown) => {
      if (!entry || typeof entry !== 'object') return null;
      const opt = entry as RawEffortOption;
      const id = normalizeEffortId(
        opt.reasoning_effort ?? opt.reasoningEffort ?? opt.effort ?? opt.level
      );
      if (!id) return null;
      const label = formatEffortLabel(id);
      return { id, label };
    })
    .filter((x): x is ReasoningEffort => x !== null);
  const seen = new Set<string>();
  return options.filter((option) => {
    if (seen.has(option.id)) return false;
    seen.add(option.id);
    return true;
  });
}

interface RawModelItem {
  id?: string;
  model?: string;
  displayName?: string;
  display_name?: string;
  name?: string;
  title?: string;
  supportedReasoningEfforts?: unknown[];
  supported_reasoning_efforts?: unknown[];
  supportedReasoningLevels?: unknown[];
  supported_reasoning_levels?: unknown[];
  defaultReasoningEffort?: string;
  default_reasoning_effort?: string;
}

interface RawModelsResponse {
  data?: RawModelItem[];
  items?: RawModelItem[];
}

function normalizeCodexModels(raw: unknown): ModelInfo[] {
  const response = raw as RawModelsResponse | null;
  const list = Array.isArray(response?.data)
    ? response.data
    : Array.isArray(response?.items)
      ? response.items
      : [];
  const mapped: ModelInfo[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const id = item.id || item.model;
    if (!id) continue;
    const displayName =
      item.displayName || item.display_name || item.name || item.title || String(id);
    const reasoningEfforts = normalizeEffortOptions(
      item.supportedReasoningEfforts ||
        item.supported_reasoning_efforts ||
        item.supportedReasoningLevels ||
        item.supported_reasoning_levels
    );
    const defaultReasoningEffort = normalizeEffortId(
      item.defaultReasoningEffort || item.default_reasoning_effort
    );
    mapped.push({
      id: String(id),
      provider: 'codex',
      displayName: String(displayName),
      reasoningEfforts: reasoningEfforts.length ? reasoningEfforts : undefined,
      defaultReasoningEffort: defaultReasoningEffort || undefined,
    });
  }
  if (!mapped.length) return [];
  const seen = new Set<string>();
  return mapped.filter((model) => {
    const key = model.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function fetchCodexModels(command: string): Promise<ModelInfo[] | null> {
  return new Promise((resolve) => {
    const child = spawn(command, ['app-server'], {
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let settled = false;
    const initId = 1;
    const listId = 2;
    const timeout = setTimeout(() => {
      finalize(null);
    }, 8000);

    const finalize = (models: ModelInfo[] | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.kill('SIGTERM');
      resolve(models);
    };

    const handleLine = (line: string): void => {
      const parsed = safeJsonParse(line) as {
        id?: number;
        result?: unknown;
        error?: unknown;
      } | null;
      if (!parsed || typeof parsed !== 'object') return;
      if (parsed.id === listId && parsed.result) {
        finalize(normalizeCodexModels(parsed.result));
      }
      if (parsed.id === listId && parsed.error) {
        finalize(null);
      }
    };

    const stdoutParser = createLineParser(handleLine);
    child.stdout?.on('data', stdoutParser);
    child.stderr?.on('data', () => {});

    child.on('error', () => finalize(null));
    child.on('close', () => finalize(null));

    if (!child.stdin) {
      finalize(null);
      return;
    }

    const initialize = {
      method: 'initialize',
      id: initId,
      params: {
        clientInfo: { name: 'agentconnect', title: 'AgentConnect', version: '0.1.0' },
      },
    };
    const initialized = { method: 'initialized' };
    const listRequest = { method: 'model/list', id: listId, params: { cursor: null, limit: null } };
    const payload = `${JSON.stringify(initialize)}\n${JSON.stringify(initialized)}\n${JSON.stringify(
      listRequest
    )}\n`;
    child.stdin.write(payload);
  });
}

export async function listCodexModels(): Promise<ModelInfo[]> {
  if (codexModelsCache && Date.now() - codexModelsCacheAt < CODEX_MODELS_CACHE_TTL_MS) {
    return codexModelsCache;
  }
  const command = getCodexCommand();
  const versionCheck = await checkCommandVersion(command, [['--version'], ['-V']]);
  if (!versionCheck.ok) {
    // Codex not installed - return empty, don't cache
    return [];
  }
  const models = await fetchCodexModels(command);
  if (models && models.length) {
    codexModelsCache = models;
    codexModelsCacheAt = Date.now();
    return models;
  }
  // Fetch failed - return empty, don't cache so it retries next time
  return [];
}

export function runCodexPrompt({
  prompt,
  resumeSessionId,
  model,
  reasoningEffort,
  repoRoot,
  onEvent,
  signal,
}: RunPromptOptions): Promise<RunPromptResult> {
  return new Promise((resolve) => {
    const command = getCodexCommand();
    const args = [
      'exec',
      '--skip-git-repo-check',
      '--experimental-json',
      '--yolo',
      '--cd',
      repoRoot || '.',
    ];
    if (model) {
      args.push('--model', String(model));
    }
    if (reasoningEffort) {
      args.push('--config', `model_reasoning_effort=${reasoningEffort}`);
    }
    if (resumeSessionId) {
      args.push('resume', resumeSessionId);
    }
    args.push(prompt);

    const argsPreview = [...args];
    if (argsPreview.length > 0) {
      argsPreview[argsPreview.length - 1] = '[prompt]';
    }
    debugLog('Codex', 'spawn', { command, args: argsPreview, cwd: repoRoot || '.' });

    const child = spawn(command, args, {
      cwd: repoRoot,
      env: { ...process.env },
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
    const stdoutLines: string[] = [];
    const stderrLines: string[] = [];
    const pushLine = (list: string[], line: string): void => {
      if (!line) return;
      list.push(line);
      if (list.length > 12) list.shift();
    };

    const handleLine = (line: string, source: 'stdout' | 'stderr'): void => {
      const parsed = safeJsonParse(line);
      if (!parsed || typeof parsed !== 'object') {
        if (source === 'stdout') {
          pushLine(stdoutLines, line);
        } else {
          pushLine(stderrLines, line);
        }
        return;
      }
      const ev = parsed as CodexEvent;
      const normalized = normalizeEvent(ev);
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

      if (normalized.type === 'agent_message') {
        const text = normalized.text;
        if (typeof text === 'string' && text) {
          aggregated += text;
          onEvent({ type: 'delta', text });
        }
      } else if (normalized.type === 'item.completed') {
        const item = normalized.item;
        if (item && typeof item === 'object') {
          if (item.type === 'command_execution' && typeof item.aggregated_output === 'string') {
            onEvent({ type: 'delta', text: item.aggregated_output });
          }
          if (item.type === 'agent_message' && typeof item.text === 'string') {
            aggregated += item.text;
            onEvent({ type: 'delta', text: item.text });
          }
        }
      }

      if (isTerminalEvent(ev) && !didFinalize) {
        didFinalize = true;
        onEvent({ type: 'final', text: aggregated });
        if (ev.type === 'turn.failed') {
          const message = ev.error?.message;
          if (typeof message === 'string') {
            onEvent({ type: 'error', message });
          }
        }
      }
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
          debugLog('Codex', 'exit', {
            code,
            stderr: stderrLines,
            stdout: stdoutLines,
          });
          onEvent({ type: 'error', message: `Codex exited with code ${code}${suffix}` });
        } else {
          onEvent({ type: 'final', text: aggregated });
        }
      }
      resolve({ sessionId: finalSessionId });
    });

    child.on('error', (err: Error) => {
      debugLog('Codex', 'spawn-error', { message: err?.message });
      onEvent({ type: 'error', message: err?.message ?? 'Codex failed to start' });
      resolve({ sessionId: finalSessionId });
    });
  });
}
