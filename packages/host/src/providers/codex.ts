import { spawn } from 'child_process';
import { readFile } from 'fs/promises';
import https from 'https';
import os from 'os';
import path from 'path';
import type {
  ProviderStatus,
  ModelInfo,
  RunPromptOptions,
  RunPromptResult,
  ReasoningEffort,
  InstallResult,
  ProviderDetail,
  ProviderDetailLevel,
  CommandResult,
} from '../types.js';
import {
  buildInstallCommandAuto,
  buildLoginCommand,
  buildStatusCommand,
  checkCommandVersion,
  commandExists,
  createLineParser,
  debugLog,
  logProviderSpawn,
  resolveWindowsCommand,
  resolveCommandPath,
  resolveCommandRealPath,
  runCommand,
} from './utils.js';

const CODEX_PACKAGE = '@openai/codex';
const DEFAULT_LOGIN = 'codex login';
const DEFAULT_STATUS = 'codex login status';
const CODEX_MODELS_CACHE_TTL_MS = 60_000;
const CODEX_UPDATE_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
let codexModelsCache: ModelInfo[] | null = null;
let codexModelsCacheAt = 0;
let codexUpdateCache: {
  checkedAt: number;
  updateAvailable?: boolean;
  latestVersion?: string;
  updateMessage?: string;
} | null = null;
let codexUpdatePromise: Promise<void> | null = null;

type CodexUpdateAction = {
  command: string;
  args: string[];
  source: 'npm' | 'bun' | 'brew';
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

function getCodexConfigDir(): string {
  return process.env.CODEX_CONFIG_DIR || path.join(os.homedir(), '.codex');
}

function fetchJson(url: string): Promise<unknown> {
  return new Promise((resolve) => {
    https
      .get(url, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve(null);
          }
        });
      })
      .on('error', () => resolve(null));
  });
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

async function fetchLatestNpmVersion(pkg: string): Promise<string | null> {
  const encoded = encodeURIComponent(pkg);
  const data = (await fetchJson(`https://registry.npmjs.org/${encoded}`)) as
    | { 'dist-tags'?: { latest?: string } }
    | null;
  if (!data || typeof data !== 'object') return null;
  const latest = data['dist-tags']?.latest;
  return typeof latest === 'string' ? latest : null;
}

async function fetchBrewFormulaVersion(formula: string): Promise<string | null> {
  if (!commandExists('brew')) return null;
  const result = await runCommand('brew', ['info', '--json=v2', formula]);
  if (result.code !== 0) return null;
  try {
    const parsed = JSON.parse(result.stdout) as { formulae?: Array<{ versions?: { stable?: string } }> };
    const version = parsed?.formulae?.[0]?.versions?.stable;
    return typeof version === 'string' ? version : null;
  } catch {
    return null;
  }
}

function getCodexUpdateAction(commandPath: string | null): CodexUpdateAction | null {
  if (process.env.CODEX_MANAGED_BY_NPM) {
    return {
      command: 'npm',
      args: ['install', '-g', CODEX_PACKAGE],
      source: 'npm',
      commandLabel: 'npm install -g @openai/codex',
    };
  }
  if (process.env.CODEX_MANAGED_BY_BUN) {
    return {
      command: 'bun',
      args: ['install', '-g', CODEX_PACKAGE],
      source: 'bun',
      commandLabel: 'bun install -g @openai/codex',
    };
  }
  if (commandPath) {
    const normalized = normalizePath(commandPath);
    if (normalized.includes('.bun/install/global')) {
      return {
        command: 'bun',
        args: ['install', '-g', CODEX_PACKAGE],
        source: 'bun',
        commandLabel: 'bun install -g @openai/codex',
      };
    }
    if (normalized.includes('/node_modules/.bin/') || normalized.includes('/lib/node_modules/')) {
      return {
        command: 'npm',
        args: ['install', '-g', CODEX_PACKAGE],
        source: 'npm',
        commandLabel: 'npm install -g @openai/codex',
      };
    }
  }
  if (
    process.platform === 'darwin' &&
    commandPath &&
    (commandPath.startsWith('/opt/homebrew') || commandPath.startsWith('/usr/local'))
  ) {
    return {
      command: 'brew',
      args: ['upgrade', 'codex'],
      source: 'brew',
      commandLabel: 'brew upgrade codex',
    };
  }
  return null;
}

function getCodexUpdateSnapshot(commandPath: string | null): {
  updateAvailable?: boolean;
  latestVersion?: string;
  updateCheckedAt?: number;
  updateSource?: 'npm' | 'bun' | 'brew' | 'unknown';
  updateCommand?: string;
  updateMessage?: string;
} {
  if (codexUpdateCache && Date.now() - codexUpdateCache.checkedAt < CODEX_UPDATE_CACHE_TTL_MS) {
    const action = getCodexUpdateAction(commandPath);
    return {
      updateAvailable: codexUpdateCache.updateAvailable,
      latestVersion: codexUpdateCache.latestVersion,
      updateCheckedAt: codexUpdateCache.checkedAt,
      updateSource: action?.source ?? 'unknown',
      updateCommand: action?.commandLabel,
      updateMessage: codexUpdateCache.updateMessage,
    };
  }
  return {};
}

function ensureCodexUpdateCheck(currentVersion?: string, commandPath?: string | null): void {
  if (codexUpdateCache && Date.now() - codexUpdateCache.checkedAt < CODEX_UPDATE_CACHE_TTL_MS) {
    return;
  }
  if (codexUpdatePromise) return;
  codexUpdatePromise = (async () => {
    const action = getCodexUpdateAction(commandPath || null);
    let latest: string | null = null;
    if (action?.source === 'brew') {
      latest = await fetchBrewFormulaVersion('codex');
    } else {
      latest = await fetchLatestNpmVersion(CODEX_PACKAGE);
    }
    let updateAvailable: boolean | undefined;
    let updateMessage: string | undefined;
    if (latest && currentVersion) {
      const a = parseSemver(currentVersion);
      const b = parseSemver(latest);
      if (a && b) {
        updateAvailable = compareSemver(a, b) < 0;
        updateMessage = updateAvailable
          ? `Update available: ${currentVersion} -> ${latest}`
          : `Up to date (${currentVersion})`;
      }
    }
    codexUpdateCache = {
      checkedAt: Date.now(),
      updateAvailable,
      latestVersion: latest ?? undefined,
      updateMessage,
    };
    debugLog('Codex', 'update-check', {
      currentVersion,
      latest,
      updateAvailable,
      message: updateMessage,
    });
  })().finally(() => {
    codexUpdatePromise = null;
  });
}

function hasAuthValue(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

async function hasCodexAuth(): Promise<boolean> {
  const home = os.homedir();
  const candidates = [
    path.join(getCodexConfigDir(), 'auth.json'),
    path.join(home, '.config', 'codex', 'auth.json'),
  ];

  for (const filePath of candidates) {
    try {
      const raw = await readFile(filePath, 'utf8');
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (hasAuthValue(parsed.OPENAI_API_KEY)) return true;
      if (hasAuthValue(parsed.access_token)) return true;
      if (hasAuthValue(parsed.token)) return true;
      const tokens = parsed.tokens as Record<string, unknown> | undefined;
      if (tokens) {
        if (hasAuthValue(tokens.access_token)) return true;
        if (hasAuthValue(tokens.refresh_token)) return true;
        if (hasAuthValue(tokens.id_token)) return true;
      }
    } catch {
      // try next path
    }
  }

  return false;
}

type CodexExecMode = 'modern' | 'legacy';

function buildCodexExecArgs(options: {
  prompt: string;
  cdTarget: string;
  resumeSessionId?: string | null;
  model?: string;
  reasoningEffort?: string | null;
  providerDetailLevel?: ProviderDetailLevel;
  mode: CodexExecMode;
}): string[] {
  const { prompt, cdTarget, resumeSessionId, model, reasoningEffort, providerDetailLevel, mode } =
    options;
  const args: string[] = ['exec', '--skip-git-repo-check'];
  if (mode === 'legacy') {
    args.push('--json', '-C', cdTarget);
  } else {
    args.push('--experimental-json', '--cd', cdTarget);
  }
  args.push('--yolo');
  const summarySetting = process.env.AGENTCONNECT_CODEX_REASONING_SUMMARY;
  const summary =
    summarySetting && summarySetting.trim()
      ? summarySetting.trim()
      : 'detailed';
  const summaryDisabled = ['0', 'false', 'off', 'none'].includes(summary.toLowerCase());
  if (!summaryDisabled) {
    args.push('--config', `model_reasoning_summary=${summary}`);
    const supportsSetting = process.env.AGENTCONNECT_CODEX_SUPPORTS_REASONING_SUMMARIES;
    const supportsValue =
      supportsSetting && supportsSetting.trim() ? supportsSetting.trim() : 'true';
    args.push('--config', `model_supports_reasoning_summaries=${supportsValue}`);
  }
  const verbositySetting = process.env.AGENTCONNECT_CODEX_MODEL_VERBOSITY;
  if (verbositySetting && verbositySetting.trim()) {
    args.push('--config', `model_verbosity=${verbositySetting.trim()}`);
  }
  const rawSetting = process.env.AGENTCONNECT_CODEX_SHOW_RAW_REASONING;
  const rawEnabled =
    providerDetailLevel === 'raw' ||
    (rawSetting ? ['1', 'true', 'yes', 'on'].includes(rawSetting.trim().toLowerCase()) : false);
  if (rawEnabled) {
    args.push('--config', 'show_raw_agent_reasoning=true');
  }
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
  return args;
}

function shouldFallbackToLegacy(lines: string[]): boolean {
  const combined = lines.join(' ').toLowerCase();
  if (
    !(
      combined.includes('unknown flag') ||
      combined.includes('unknown option') ||
      combined.includes('unrecognized option') ||
      combined.includes('unknown argument') ||
      combined.includes('unexpected argument') ||
      combined.includes('invalid option') ||
      combined.includes('invalid argument')
    )
  ) {
    return false;
  }
  return combined.includes('experimental-json') || combined.includes('--cd');
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
  let explicitLoggedOut = false;

  if (installed) {
    const status = buildStatusCommand('AGENTCONNECT_CODEX_STATUS', DEFAULT_STATUS);
    if (status.command) {
      const statusCommand = resolveWindowsCommand(status.command);
      const result = await runCommand(statusCommand, status.args, { env: { ...process.env, CI: '1' } });
      const output = `${result.stdout}\n${result.stderr}`.toLowerCase();
      if (
        output.includes('not logged in') ||
        output.includes('not logged') ||
        output.includes('login required') ||
        output.includes('please login') ||
        output.includes('run codex login')
      ) {
        explicitLoggedOut = true;
        loggedIn = false;
      } else if (
        output.includes('logged in') ||
        output.includes('signed in') ||
        output.includes('authenticated')
      ) {
        loggedIn = true;
      } else {
        loggedIn = result.code === 0;
      }
    }
    if (!loggedIn && !explicitLoggedOut) {
      loggedIn = await hasCodexAuth();
    }
  }

  const resolved = resolveCommandRealPath(command);
  if (installed) {
    ensureCodexUpdateCheck(versionCheck.version, resolved || null);
  }
  const updateInfo = installed ? getCodexUpdateSnapshot(resolved || null) : {};
  return { installed, loggedIn, version: versionCheck.version || undefined, ...updateInfo };
}

export async function getCodexFastStatus(): Promise<ProviderStatus> {
  const command = getCodexCommand();
  const loggedIn = await hasCodexAuth();
  const installed = commandExists(command) || loggedIn;
  return { installed, loggedIn };
}

export async function updateCodex(): Promise<ProviderStatus> {
  const command = getCodexCommand();
  if (!commandExists(command)) {
    return { installed: false, loggedIn: false };
  }
  const resolved = resolveCommandRealPath(command);
  const updateOverride = buildStatusCommand('AGENTCONNECT_CODEX_UPDATE', '');
  const action = updateOverride.command ? null : getCodexUpdateAction(resolved || null);
  const updateCommand = updateOverride.command || action?.command || '';
  const updateArgs = updateOverride.command ? updateOverride.args : action?.args || [];

  if (!updateCommand) {
    throw new Error('No update command available. Please update Codex manually.');
  }

  const cmd = resolveWindowsCommand(updateCommand);
  debugLog('Codex', 'update-run', { command: cmd, args: updateArgs });
  const result: CommandResult = await runCommand(cmd, updateArgs, {
    env: { ...process.env, CI: '1' },
  });
  debugLog('Codex', 'update-result', {
    code: result.code,
    stdout: trimOutput(result.stdout),
    stderr: trimOutput(result.stderr),
  });
  if (result.code !== 0 && result.code !== null) {
    const message = trimOutput(`${result.stdout}\n${result.stderr}`, 800) || 'Update failed';
    throw new Error(message);
  }
  codexUpdateCache = null;
  codexUpdatePromise = null;
  return getCodexStatus();
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
  name?: string;
  input?: unknown;
  output?: unknown;
  [key: string]: unknown;
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
  cwd,
  providerDetailLevel,
  onEvent,
  signal,
}: RunPromptOptions): Promise<RunPromptResult> {
  return new Promise((resolve) => {
    const command = getCodexCommand();
    const resolvedRepoRoot = repoRoot ? path.resolve(repoRoot) : null;
    const resolvedCwd = cwd ? path.resolve(cwd) : null;
    const runDir = resolvedCwd || resolvedRepoRoot || process.cwd();
    const cdTarget = resolvedRepoRoot || resolvedCwd || '.';

    const runAttempt = (mode: CodexExecMode): Promise<{ sessionId: string | null; fallback: boolean }> =>
      new Promise((attemptResolve) => {
        const args = buildCodexExecArgs({
          prompt,
          cdTarget,
          resumeSessionId,
          model,
          reasoningEffort,
          providerDetailLevel,
          mode,
        });

        logProviderSpawn({
          provider: 'codex',
          command,
          args,
          cwd: runDir,
          resumeSessionId,
        });

        const argsPreview = [...args];
        if (argsPreview.length > 0) {
          argsPreview[argsPreview.length - 1] = '[prompt]';
        }
        debugLog('Codex', 'spawn', { command, args: argsPreview, cwd: runDir, mode });

        const child = spawn(command, args, {
          cwd: runDir,
          env: (() => {
            const env = { ...process.env };
            if (!env.RUST_LOG) {
              const override = process.env.AGENTCONNECT_CODEX_RUST_LOG;
              if (override && override.trim()) {
                env.RUST_LOG = override.trim();
              } else {
                const debugFlag = process.env.AGENTCONNECT_CODEX_DEBUG_LOGS;
                const enabled = debugFlag
                  ? ['1', 'true', 'yes', 'on'].includes(debugFlag.trim().toLowerCase())
                  : false;
                if (enabled) {
                  env.RUST_LOG = 'codex_exec=debug,codex_core=debug';
                }
              }
            }
            return env;
          })(),
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
        let pendingError: { message: string; providerDetail?: ProviderDetail } | null = null;

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

        const emitError = (message: string, providerDetail?: ProviderDetail): void => {
          if (sawError) return;
          sawError = true;
          emit({ type: 'error', message, providerDetail });
        };
        const emitItemEvent = (item: CodexItem, phase: 'start' | 'completed'): void => {
          const itemType = typeof item.type === 'string' ? item.type : '';
          if (!itemType) return;
          const providerDetail = buildProviderDetail(
            phase === 'start' ? 'item.started' : 'item.completed',
            {
              itemType,
              itemId: item.id,
              status: item.status,
            },
            item
          );
          if (itemType === 'agent_message') {
            if (phase === 'completed' && typeof item.text === 'string') {
              emit({
                type: 'message',
                provider: 'codex',
                role: 'assistant',
                content: item.text,
                contentParts: item,
                providerDetail,
              });
            }
            return;
          }
          if (itemType === 'reasoning') {
            emit({
              type: 'thinking',
              provider: 'codex',
              phase,
              text: typeof item.text === 'string' ? item.text : undefined,
              providerDetail,
            });
            return;
          }
          if (itemType === 'command_execution') {
            const output =
              phase === 'completed'
                ? {
                    output: item.aggregated_output,
                    exitCode: item.exit_code,
                    status: item.status,
                  }
                : undefined;
            emit({
              type: 'tool_call',
              provider: 'codex',
              name: 'command_execution',
              callId: item.id,
              input: { command: item.command },
              output,
              phase,
              providerDetail,
            });
            return;
          }
          emit({
            type: 'tool_call',
            provider: 'codex',
            name: itemType,
            callId: item.id,
            input: phase === 'start' ? item : undefined,
            output: phase === 'completed' ? item : undefined,
            phase,
            providerDetail,
          });
        };
        let sawJson = false;
        const stdoutLines: string[] = [];
        const stderrLines: string[] = [];
        const pushLine = (list: string[], line: string): void => {
          if (!line) return;
          list.push(line);
          if (list.length > 12) list.shift();
        };

        const emitFinal = (text: string, providerDetail?: ProviderDetail): void => {
          emit({ type: 'final', text, providerDetail });
        };

        const handleLine = (line: string, source: 'stdout' | 'stderr'): void => {
          const parsed = safeJsonParse(line);
          if (!parsed || typeof parsed !== 'object') {
            if (line.trim()) {
              emit({ type: 'raw_line', line });
            }
            if (source === 'stdout') {
              pushLine(stdoutLines, line);
            } else {
              pushLine(stderrLines, line);
            }
            return;
          }
          sawJson = true;
          const ev = parsed as CodexEvent;
          const normalized = normalizeEvent(ev);
          const sid = extractSessionId(ev);
          if (sid) finalSessionId = sid;

          const eventType = typeof ev.type === 'string' ? ev.type : normalized.type;
          const detailData: Record<string, unknown> = {};
          const threadId = ev.thread_id ?? ev.threadId;
          if (typeof threadId === 'string' && threadId) detailData.threadId = threadId;
          if (normalized.type === 'error' && normalized.message) {
            detailData.message = normalized.message;
          }
          const providerDetail = buildProviderDetail(eventType || 'unknown', detailData, ev);
          let handled = false;

          const usage = extractUsage(ev);
          if (usage) {
            emit({
              type: 'usage',
              inputTokens: usage.input_tokens,
              outputTokens: usage.output_tokens,
              providerDetail,
            });
            handled = true;
          }

          if (normalized.type === 'agent_message') {
            const text = normalized.text;
            if (typeof text === 'string' && text) {
              aggregated += text;
              emit({ type: 'delta', text, providerDetail });
              emit({
                type: 'message',
                provider: 'codex',
                role: 'assistant',
                content: text,
                contentParts: ev,
                providerDetail,
              });
              handled = true;
            }
          } else if (normalized.type === 'item.completed') {
            const item = normalized.item;
            if (item && typeof item === 'object') {
              const itemDetail = buildProviderDetail('item.completed', {
                itemType: (item as CodexItem).type,
                itemId: (item as CodexItem).id,
                status: (item as CodexItem).status,
              }, item);
              if (item.type === 'command_execution' && typeof item.aggregated_output === 'string') {
                emit({ type: 'delta', text: item.aggregated_output, providerDetail: itemDetail });
              }
              if (item.type === 'agent_message' && typeof item.text === 'string') {
                aggregated += item.text;
                emit({ type: 'delta', text: item.text, providerDetail: itemDetail });
              }
            }
          }
          if (normalized.type === 'item.started' && ev.item && typeof ev.item === 'object') {
            emitItemEvent(ev.item as CodexItem, 'start');
            handled = true;
          }
          if (normalized.type === 'item.completed' && ev.item && typeof ev.item === 'object') {
            emitItemEvent(ev.item as CodexItem, 'completed');
            handled = true;
          }

          if (normalized.type === 'error') {
            const message = normalized.message || 'Codex run failed';
            pendingError = { message, providerDetail };
            debugLog('Codex', 'event-error', { message });
          }

          if (isTerminalEvent(ev) && !didFinalize) {
            if (ev.type === 'turn.failed') {
              const message =
                typeof ev.error?.message === 'string'
                  ? ev.error.message
                  : pendingError?.message;
              emitError(message ?? 'Codex run failed', providerDetail);
              didFinalize = true;
              handled = true;
              return;
            }
            if (!sawError) {
              didFinalize = true;
              emitFinal(aggregated, providerDetail);
              handled = true;
            }
          }

          if (!handled) {
            emit({ type: 'detail', provider: 'codex', providerDetail });
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
              const context = pendingError?.message || hint;
              const suffix = context ? `: ${context}` : '';
              const fallback = mode === 'modern' && !sawJson && shouldFallbackToLegacy([
                ...stderrLines,
                ...stdoutLines,
              ]);
              debugLog('Codex', 'exit', {
                code,
                stderr: stderrLines,
                stdout: stdoutLines,
                fallback,
              });
              if (fallback) {
                attemptResolve({ sessionId: finalSessionId, fallback: true });
                return;
              }
              emitError(`Codex exited with code ${code}${suffix}`, pendingError?.providerDetail);
            } else if (!sawError) {
              if (pendingError) {
                emitError(pendingError.message, pendingError.providerDetail);
              } else {
                emitFinal(aggregated);
              }
            }
          }
          attemptResolve({ sessionId: finalSessionId, fallback: false });
        });

        child.on('error', (err: Error) => {
          debugLog('Codex', 'spawn-error', { message: err?.message });
          emitError(err?.message ?? 'Codex failed to start');
          attemptResolve({ sessionId: finalSessionId, fallback: false });
        });
      });

    void (async () => {
      const primary = await runAttempt('modern');
      if (primary.fallback) {
        debugLog('Codex', 'fallback', { from: 'modern', to: 'legacy' });
        const legacy = await runAttempt('legacy');
        resolve({ sessionId: legacy.sessionId });
        return;
      }
      resolve({ sessionId: primary.sessionId });
    })();
  });
}
