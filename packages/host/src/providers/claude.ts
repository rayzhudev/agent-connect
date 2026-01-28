import { spawn } from 'child_process';
import { access, mkdir, readFile, rm, writeFile } from 'fs/promises';
import https from 'https';
import os from 'os';
import path from 'path';
import type { IPty } from 'node-pty';
import type {
  ProviderStatus,
  RunPromptOptions,
  RunPromptResult,
  InstallResult,
  ProviderLoginOptions,
  ModelInfo,
  ProviderDetail,
} from '../types.js';
import {
  buildInstallCommand,
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

const CLAUDE_PACKAGE = '@anthropic-ai/claude-code';
const INSTALL_UNIX = 'curl -fsSL https://claude.ai/install.sh | bash';
const INSTALL_WINDOWS_PS = 'irm https://claude.ai/install.ps1 | iex';
const INSTALL_WINDOWS_CMD =
  'curl -fsSL https://claude.ai/install.cmd -o install.cmd && install.cmd && del install.cmd';
const DEFAULT_LOGIN = '';
const DEFAULT_STATUS = '';
const CLAUDE_MODELS_CACHE_TTL_MS = 60_000;
const CLAUDE_RECENT_MODELS_CACHE_TTL_MS = 60_000;
const CLAUDE_UPDATE_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
let claudeModelsCache: ModelInfo[] | null = null;
let claudeModelsCacheAt = 0;
let claudeRecentModelsCache: ModelInfo[] | null = null;
let claudeRecentModelsCacheAt = 0;
let claudeUpdateCache: {
  checkedAt: number;
  updateAvailable?: boolean;
  latestVersion?: string;
  updateMessage?: string;
} | null = null;
let claudeUpdatePromise: Promise<void> | null = null;
const CLAUDE_LOGIN_CACHE_TTL_MS = 30_000;
type ClaudeLoginHint = 'setup' | 'login';
type ClaudeCliLoginStatus = {
  loggedIn: boolean | null;
  loginHint?: ClaudeLoginHint;
  apiKeySource?: string;
  authError?: string;
};
let claudeLoginCache: { checkedAt: number; status: ClaudeCliLoginStatus } | null = null;
let claudeLoginPromise: Promise<ClaudeCliLoginStatus> | null = null;

type ClaudeUpdateAction = {
  command: string;
  args: string[];
  source: 'npm' | 'bun' | 'brew' | 'winget' | 'script';
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

async function fetchLatestNpmVersion(pkg: string): Promise<string | null> {
  const encoded = encodeURIComponent(pkg);
  const data = await fetchJson(`https://registry.npmjs.org/${encoded}`);
  if (!data || typeof data !== 'object') return null;
  const latest = (data as { 'dist-tags'?: { latest?: string } })['dist-tags']?.latest;
  return typeof latest === 'string' ? latest : null;
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

function getClaudeUpdateAction(commandPath: string | null): ClaudeUpdateAction | null {
  if (!commandPath) return null;
  const normalized = normalizePath(commandPath);
  const home = normalizePath(os.homedir());

  if (normalized.startsWith(`${home}/.bun/bin/`)) {
    return {
      command: 'bun',
      args: ['install', '-g', CLAUDE_PACKAGE],
      source: 'bun',
      commandLabel: 'bun install -g @anthropic-ai/claude-code',
    };
  }
  if (normalized.includes('/node_modules/.bin/')) {
    return {
      command: 'npm',
      args: ['install', '-g', CLAUDE_PACKAGE],
      source: 'npm',
      commandLabel: 'npm install -g @anthropic-ai/claude-code',
    };
  }

  if (
    normalized.includes('/cellar/') ||
    normalized.includes('/caskroom/') ||
    normalized.includes('/homebrew/')
  ) {
    return {
      command: 'brew',
      args: ['upgrade', '--cask', 'claude-code'],
      source: 'brew',
      commandLabel: 'brew upgrade --cask claude-code',
    };
  }

  if (
    process.platform === 'win32' &&
    (normalized.includes('/program files/claudecode') ||
      normalized.includes('/programdata/claudecode'))
  ) {
    return {
      command: 'winget',
      args: ['upgrade', 'Anthropic.ClaudeCode'],
      source: 'winget',
      commandLabel: 'winget upgrade Anthropic.ClaudeCode',
    };
  }

  if (
    normalized.includes('/.local/bin/') ||
    normalized.includes('/.local/share/claude/versions/') ||
    normalized.includes('/.local/share/claude-code/versions/')
  ) {
    if (process.platform === 'win32') {
      return {
        command: 'powershell',
        args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', INSTALL_WINDOWS_PS],
        source: 'script',
        commandLabel: INSTALL_WINDOWS_PS,
      };
    }
    return {
      command: 'bash',
      args: ['-lc', INSTALL_UNIX],
      source: 'script',
      commandLabel: INSTALL_UNIX,
    };
  }

  return null;
}

const DEFAULT_CLAUDE_MODELS = [
  {
    id: 'default',
    displayName: 'Default · Opus 4.5',
  },
  {
    id: 'sonnet',
    displayName: 'Sonnet 4.5',
  },
  {
    id: 'haiku',
    displayName: 'Haiku 4.5',
  },
  {
    id: 'opus',
    displayName: 'Opus',
  },
];

export function getClaudeCommand(): string {
  const override = process.env.AGENTCONNECT_CLAUDE_COMMAND;
  const base = override || 'claude';
  const resolved = resolveCommandPath(base);
  return resolved || resolveWindowsCommand(base);
}

function getClaudeConfigDir(): string {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
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

function formatClaudeDisplayName(modelId: string): string {
  const value = modelId.trim();
  if (!value.startsWith('claude-')) return value;
  const parts = value
    .replace(/^claude-/, '')
    .split('-')
    .filter(Boolean);
  if (!parts.length) return value;
  const family = parts[0];
  const numeric = parts.slice(1).filter((entry) => /^\d+$/.test(entry));
  let version = '';
  if (numeric.length >= 2) {
    version = `${numeric[0]}.${numeric[1]}`;
  } else if (numeric.length === 1) {
    version = numeric[0];
  }
  const familyLabel = family.charAt(0).toUpperCase() + family.slice(1);
  return `Claude ${familyLabel}${version ? ` ${version}` : ''}`;
}

async function readClaudeStatsModels(): Promise<string[]> {
  const statsPath = path.join(getClaudeConfigDir(), 'stats-cache.json');
  try {
    const raw = await readFile(statsPath, 'utf8');
    const parsed = JSON.parse(raw) as { modelUsage?: Record<string, unknown> } | null;
    const usage = parsed?.modelUsage;
    if (!usage || typeof usage !== 'object') return [];
    return Object.keys(usage).filter(Boolean);
  } catch {
    return [];
  }
}

export async function listClaudeModels(): Promise<ModelInfo[]> {
  if (claudeModelsCache && Date.now() - claudeModelsCacheAt < CLAUDE_MODELS_CACHE_TTL_MS) {
    return claudeModelsCache;
  }
  const list = DEFAULT_CLAUDE_MODELS.map((entry) => ({
    id: entry.id,
    provider: 'claude' as const,
    displayName: entry.displayName,
  }));
  claudeModelsCache = list;
  claudeModelsCacheAt = Date.now();
  return list;
}

export async function listClaudeRecentModels(): Promise<ModelInfo[]> {
  if (
    claudeRecentModelsCache &&
    Date.now() - claudeRecentModelsCacheAt < CLAUDE_RECENT_MODELS_CACHE_TTL_MS
  ) {
    return claudeRecentModelsCache;
  }
  const discovered = await readClaudeStatsModels();
  const mapped: ModelInfo[] = [];
  const seen = new Set<string>();
  for (const modelId of discovered) {
    const id = modelId.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    mapped.push({
      id,
      provider: 'claude',
      displayName: formatClaudeDisplayName(id),
    });
  }
  claudeRecentModelsCache = mapped;
  claudeRecentModelsCacheAt = Date.now();
  return mapped;
}

function getClaudeAuthPaths(): string[] {
  const home = os.homedir();
  return [
    path.join(home, '.claude.json'),
    path.join(home, '.claude', 'settings.json'),
    path.join(home, '.config', 'claude', 'auth.json'),
  ];
}

type ClaudeLoginMethod = 'claudeai' | 'console';
type PtyModule = {
  spawn: (
    file: string,
    args?: string[],
    options?: {
      name?: string;
      cols?: number;
      rows?: number;
      cwd?: string;
      env?: NodeJS.ProcessEnv;
    }
  ) => IPty;
};
type ClaudeLoginExperience = 'embedded' | 'terminal';

function resolveClaudeTheme(): string {
  const raw = process.env.AGENTCONNECT_CLAUDE_THEME;
  return raw && raw.trim() ? raw.trim() : 'dark';
}

function resolveClaudeLoginMethod(options?: ProviderLoginOptions): ClaudeLoginMethod | null {
  const raw = options?.loginMethod ?? process.env.AGENTCONNECT_CLAUDE_LOGIN_METHOD;
  if (!raw) return 'claudeai';
  const normalized = String(raw).trim().toLowerCase();
  if (normalized === 'console') return 'console';
  if (normalized === 'claudeai' || normalized === 'claude') return 'claudeai';
  return 'claudeai';
}

function resolveClaudeLoginExperience(options?: ProviderLoginOptions): ClaudeLoginExperience {
  const raw =
    options?.loginExperience ??
    process.env.AGENTCONNECT_CLAUDE_LOGIN_EXPERIENCE ??
    process.env.AGENTCONNECT_LOGIN_EXPERIENCE;
  if (raw) {
    const normalized = String(raw).trim().toLowerCase();
    if (normalized === 'terminal' || normalized === 'manual') return 'terminal';
    if (normalized === 'embedded' || normalized === 'pty') return 'embedded';
  }
  if (process.env.AGENTCONNECT_HOST_MODE === 'dev') return 'terminal';
  return 'embedded';
}

async function resolveClaudeLoginHint(options?: ProviderLoginOptions): Promise<ClaudeLoginHint> {
  const raw = process.env.AGENTCONNECT_CLAUDE_LOGIN_HINT;
  if (raw) {
    const normalized = String(raw).trim().toLowerCase();
    if (normalized === 'setup') return 'setup';
    if (normalized === 'login') return 'login';
  }
  if (options?.loginExperience) {
    // no-op; keep for future overrides
  }
  const status = await checkClaudeCliStatus();
  return status.loginHint ?? 'login';
}

async function createClaudeLoginSettingsFile(
  loginMethod: ClaudeLoginMethod | null
): Promise<string | null> {
  if (!loginMethod) return null;
  const fileName = `agentconnect-claude-login-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}.json`;
  const filePath = path.join(os.tmpdir(), fileName);
  const theme = resolveClaudeTheme();
  const payload = {
    forceLoginMethod: loginMethod,
    theme,
    hasCompletedOnboarding: true,
  };
  await writeFile(filePath, JSON.stringify(payload), 'utf8');
  return filePath;
}

async function ensureClaudeOnboardingSettings(): Promise<void> {
  const configDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  const settingsPath = path.join(configDir, 'settings.json');
  let settings: Record<string, unknown> = {};

  try {
    const raw = await readFile(settingsPath, 'utf8');
    try {
      settings = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    if (code && code !== 'ENOENT') return;
  }

  let updated = false;
  if (!settings.theme) {
    settings.theme = resolveClaudeTheme();
    updated = true;
  }
  if (settings.hasCompletedOnboarding !== true) {
    settings.hasCompletedOnboarding = true;
    updated = true;
  }

  if (!updated) return;

  await mkdir(configDir, { recursive: true });
  await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
}

async function loadPtyModule(): Promise<PtyModule | null> {
  try {
    const mod = (await import('node-pty')) as PtyModule & { default?: PtyModule };
    if (typeof mod.spawn === 'function') return mod;
    if (mod.default && typeof mod.default.spawn === 'function') return mod.default;
    return null;
  } catch {
    return null;
  }
}

function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function cmdEscape(value: string): string {
  if (!value) return '""';
  const escaped = value.replace(/"/g, '""');
  return `"${escaped}"`;
}

function buildClaudeCommand(command: string, args: string[], includeLogin = false): string {
  const parts = includeLogin ? [command, ...args, '/login'] : [command, ...args];
  return parts.map(shellEscape).join(' ');
}

function buildClaudeCmd(command: string, args: string[], includeLogin = false): string {
  const parts = includeLogin ? [command, ...args, '/login'] : [command, ...args];
  return parts.map(cmdEscape).join(' ');
}

async function openClaudeLoginTerminal(
  command: string,
  args: string[],
  includeLogin = false
): Promise<void> {
  const message =
    'AgentConnect: complete Claude login in this terminal. If login does not start automatically, run /login.';

  if (process.platform === 'win32') {
    const cmdLine = `echo ${message} & ${buildClaudeCmd(command, args, includeLogin)}`;
    await runCommand('cmd', ['/c', 'start', '', 'cmd', '/k', cmdLine], { shell: true });
    return;
  }

  const loginCommand = buildClaudeCommand(command, args, includeLogin);
  const shellCommand = `printf "%s\\n\\n" ${shellEscape(message)}; ${loginCommand}`;

  if (process.platform === 'darwin') {
    const script = `tell application "Terminal"
activate
do script "${shellCommand.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"
end tell`;
    await runCommand('osascript', ['-e', script]);
    return;
  }

  if (commandExists('x-terminal-emulator')) {
    await runCommand('x-terminal-emulator', ['-e', 'bash', '-lc', shellCommand]);
    return;
  }
  if (commandExists('gnome-terminal')) {
    await runCommand('gnome-terminal', ['--', 'bash', '-lc', shellCommand]);
    return;
  }
  if (commandExists('konsole')) {
    await runCommand('konsole', ['-e', 'bash', '-lc', shellCommand]);
    return;
  }
  if (commandExists('xterm')) {
    await runCommand('xterm', ['-e', 'bash', '-lc', shellCommand]);
    return;
  }

  throw new Error('No terminal emulator found to launch Claude login.');
}

function maybeAdvanceClaudeOnboarding(
  output: string,
  loginMethod: ClaudeLoginMethod | null,
  write: (input: string) => void
): boolean {
  const text = output.toLowerCase();
  if (text.includes('select login method') || text.includes('claude account with subscription')) {
    if (loginMethod === 'console') {
      write('\x1b[B');
    }
    write('\r');
    return true;
  }
  if (text.includes('choose the text style') || text.includes('text style that looks best')) {
    write('\r');
    return true;
  }
  if (text.includes('press enter') || text.includes('enter to confirm')) {
    write('\r');
    return true;
  }
  return false;
}

async function hasClaudeAuth(): Promise<boolean> {
  if (typeof process.env.CLAUDE_CODE_OAUTH_TOKEN === 'string') {
    return process.env.CLAUDE_CODE_OAUTH_TOKEN.trim().length > 0;
  }

  for (const filePath of getClaudeAuthPaths()) {
    try {
      await access(filePath);
      const raw = await readFile(filePath, 'utf8');
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const auth = parsed?.claudeAiOauth as Record<string, unknown> | undefined;
      if (typeof auth?.accessToken === 'string' && auth.accessToken.trim()) {
        return true;
      }
      if (typeof parsed.primaryApiKey === 'string' && parsed.primaryApiKey.trim()) {
        return true;
      }
      if (typeof parsed.accessToken === 'string' && parsed.accessToken.trim()) {
        return true;
      }
      if (typeof parsed.token === 'string' && parsed.token.trim()) {
        return true;
      }
      const oauthAccount = parsed.oauthAccount as Record<string, unknown> | undefined;
      if (typeof oauthAccount?.emailAddress === 'string' && oauthAccount.emailAddress.trim()) {
        return true;
      }
      if (typeof oauthAccount?.accountUuid === 'string' && oauthAccount.accountUuid.trim()) {
        return true;
      }
      const oauth = parsed.oauth as Record<string, unknown> | undefined;
      if (typeof oauth?.access_token === 'string' && oauth.access_token.trim()) {
        return true;
      }
    } catch {
      // try next path
    }
  }
  return false;
}

function isClaudeAuthErrorText(value: string): boolean {
  const text = value.toLowerCase();
  return (
    text.includes('authentication_error') ||
    text.includes('authentication_failed') ||
    text.includes('oauth token has expired') ||
    text.includes('token has expired') ||
    text.includes('please run /login') ||
    text.includes('unauthorized') ||
    text.includes('api error: 401') ||
    text.includes('status 401') ||
    text.includes('invalid api key')
  );
}

function extractClaudeMessageText(content: unknown): string {
  if (Array.isArray(content)) {
    return content.map((part) => (part as { text?: string })?.text ?? '').join(' ');
  }
  return typeof content === 'string' ? content : '';
}

function resolveClaudeLoginHintFromSource(apiKeySource?: string): ClaudeLoginHint {
  if (apiKeySource && apiKeySource.toLowerCase() === 'none') return 'setup';
  return 'login';
}

async function checkClaudeCliStatus(): Promise<ClaudeCliLoginStatus> {
  if (claudeLoginCache && Date.now() - claudeLoginCache.checkedAt < CLAUDE_LOGIN_CACHE_TTL_MS) {
    return claudeLoginCache.status;
  }
  if (claudeLoginPromise) return claudeLoginPromise;

  claudeLoginPromise = (async (): Promise<ClaudeCliLoginStatus> => {
    const command = resolveWindowsCommand(getClaudeCommand());
    const args = [
      '--print',
      '--output-format',
      'stream-json',
      '--no-session-persistence',
      '--max-budget-usd',
      '0.01',
    ];
    const result = await runCommand(command, args, {
      env: { ...process.env, CI: '1' },
      input: 'ping\n',
      timeoutMs: 8000,
    });
    const output = `${result.stdout}\n${result.stderr}`.trim();
    if (!output) return { loggedIn: null };

    let apiKeySource: string | undefined;
    let authError: string | null = null;
    let sawAssistant = false;
    let sawSuccess = false;
    const lines = output.split('\n');
    for (const line of lines) {
      const parsed = safeJsonParse(line);
      if (!parsed || typeof parsed !== 'object') continue;
      const record = parsed as Record<string, unknown>;
      const type = typeof record.type === 'string' ? record.type : '';
      if (type === 'system' && record.subtype === 'init') {
        const source = typeof record.apiKeySource === 'string' ? record.apiKeySource : undefined;
        if (source) apiKeySource = source;
      }
      if (type === 'result') {
        const isError = Boolean(record.is_error);
        const resultText =
          typeof record.result === 'string'
            ? record.result
            : typeof record.error === 'string'
              ? record.error
              : JSON.stringify(record.error || record);
        if (isError && isClaudeAuthErrorText(resultText)) {
          authError = authError ?? resultText;
        }
        if (!isError) sawSuccess = true;
      }
      if (type === 'message') {
        const message = record.message as Record<string, unknown> | undefined;
        const role = typeof message?.role === 'string' ? message.role : '';
        if (role === 'assistant') {
          const text = extractClaudeMessageText(message?.content);
          const errorText =
            typeof record.error === 'string'
              ? record.error
              : typeof message?.error === 'string'
                ? message.error
                : '';
          if (isClaudeAuthErrorText(text) || (errorText && isClaudeAuthErrorText(errorText))) {
            authError = authError ?? (text || errorText);
          } else if (text.trim()) {
            sawAssistant = true;
          }
        }
      }
    }

    if (authError) {
      return {
        loggedIn: false,
        apiKeySource,
        loginHint: resolveClaudeLoginHintFromSource(apiKeySource),
        authError,
      };
    }
    if (sawAssistant || sawSuccess) {
      return { loggedIn: true, apiKeySource };
    }
    if (apiKeySource && apiKeySource.toLowerCase() === 'none') {
      return { loggedIn: false, apiKeySource, loginHint: 'setup' as ClaudeLoginHint };
    }
    return { loggedIn: null, apiKeySource };
  })()
    .then((status) => {
      claudeLoginCache = { checkedAt: Date.now(), status };
      return status;
    })
    .finally(() => {
      claudeLoginPromise = null;
    });

  return claudeLoginPromise!;
}

function getClaudeUpdateSnapshot(commandPath: string | null): {
  updateAvailable?: boolean;
  latestVersion?: string;
  updateCheckedAt?: number;
  updateSource?: 'cli' | 'npm' | 'bun' | 'brew' | 'winget' | 'script' | 'unknown';
  updateCommand?: string;
  updateMessage?: string;
} {
  if (claudeUpdateCache && Date.now() - claudeUpdateCache.checkedAt < CLAUDE_UPDATE_CACHE_TTL_MS) {
    const action = getClaudeUpdateAction(commandPath);
    return {
      updateAvailable: claudeUpdateCache.updateAvailable,
      latestVersion: claudeUpdateCache.latestVersion,
      updateCheckedAt: claudeUpdateCache.checkedAt,
      updateSource: action?.source ?? 'unknown',
      updateCommand: action?.commandLabel,
      updateMessage: claudeUpdateCache.updateMessage,
    };
  }
  return {};
}

function ensureClaudeUpdateCheck(currentVersion?: string, commandPath?: string | null): void {
  if (claudeUpdateCache && Date.now() - claudeUpdateCache.checkedAt < CLAUDE_UPDATE_CACHE_TTL_MS) {
    return;
  }
  if (claudeUpdatePromise) return;
  claudeUpdatePromise = (async () => {
    const action = getClaudeUpdateAction(commandPath || null);
    let latest: string | null = null;
    let updateAvailable: boolean | undefined;
    let updateMessage: string | undefined;

    if (action?.source === 'npm' || action?.source === 'bun') {
      latest = await fetchLatestNpmVersion(CLAUDE_PACKAGE);
    } else if (action?.source === 'brew') {
      latest = await fetchBrewCaskVersion('claude-code');
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

    debugLog('Claude', 'update-check', {
      updateAvailable,
      message: updateMessage,
    });
    claudeUpdateCache = {
      checkedAt: Date.now(),
      updateAvailable,
      latestVersion: latest ?? undefined,
      updateMessage,
    };
  })().finally(() => {
    claudeUpdatePromise = null;
  });
}

export async function ensureClaudeInstalled(): Promise<InstallResult> {
  const command = getClaudeCommand();
  const versionCheck = await checkCommandVersion(command, [['--version'], ['-V']]);
  if (versionCheck.ok) {
    return { installed: true, version: versionCheck.version || undefined };
  }
  if (commandExists(command)) {
    return { installed: true, version: undefined };
  }

  const override = buildInstallCommand('AGENTCONNECT_CLAUDE_INSTALL', '');
  let install = override;
  let packageManager: InstallResult['packageManager'] = override.command ? 'unknown' : 'unknown';

  if (!install.command) {
    if (process.platform === 'win32') {
      if (commandExists('powershell')) {
        install = {
          command: 'powershell',
          args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', INSTALL_WINDOWS_PS],
        };
        packageManager = 'script';
      } else if (commandExists('pwsh')) {
        install = {
          command: 'pwsh',
          args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', INSTALL_WINDOWS_PS],
        };
        packageManager = 'script';
      } else if (commandExists('cmd') && commandExists('curl')) {
        install = { command: 'cmd', args: ['/c', INSTALL_WINDOWS_CMD] };
        packageManager = 'script';
      }
    } else if (commandExists('bash') && commandExists('curl')) {
      install = { command: 'bash', args: ['-lc', INSTALL_UNIX] };
      packageManager = 'script';
    } else {
      const auto = await buildInstallCommandAuto(CLAUDE_PACKAGE);
      install = { command: auto.command, args: auto.args };
      packageManager = auto.packageManager;
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

export async function getClaudeStatus(): Promise<ProviderStatus> {
  const command = getClaudeCommand();
  const versionCheck = await checkCommandVersion(command, [['--version'], ['-V']]);
  const installed = versionCheck.ok || commandExists(command);
  let loggedIn = false;

  if (installed) {
    const status = buildStatusCommand('AGENTCONNECT_CLAUDE_STATUS', DEFAULT_STATUS);
    if (status.command) {
      const statusCommand = resolveWindowsCommand(status.command);
      const result = await runCommand(statusCommand, status.args);
      loggedIn = result.code === 0;
    } else {
      const cliStatus = await checkClaudeCliStatus();
      if (cliStatus.loggedIn === false) {
        loggedIn = false;
      } else if (cliStatus.loggedIn === true) {
        loggedIn = true;
      } else if (cliStatus.apiKeySource?.toLowerCase() === 'none') {
        loggedIn = false;
      } else {
        loggedIn = await hasClaudeAuth();
      }
    }
  }

  if (installed) {
    const resolved = resolveCommandRealPath(command);
    ensureClaudeUpdateCheck(versionCheck.version, resolved || null);
  }
  const resolved = resolveCommandRealPath(command);
  const updateInfo = installed ? getClaudeUpdateSnapshot(resolved || null) : {};
  return { installed, loggedIn, version: versionCheck.version || undefined, ...updateInfo };
}

export async function getClaudeFastStatus(): Promise<ProviderStatus> {
  const command = getClaudeCommand();
  const installed = commandExists(command);
  const loggedIn = installed ? await hasClaudeAuth() : false;
  return { installed, loggedIn };
}

export async function updateClaude(): Promise<ProviderStatus> {
  const command = getClaudeCommand();
  if (!commandExists(command)) {
    return { installed: false, loggedIn: false };
  }
  const resolved = resolveCommandRealPath(command);
  const updateOverride = buildStatusCommand('AGENTCONNECT_CLAUDE_UPDATE', '');
  const action = updateOverride.command ? null : getClaudeUpdateAction(resolved || null);
  const updateCommand = updateOverride.command || action?.command || '';
  const updateArgs = updateOverride.command ? updateOverride.args : action?.args || [];

  if (!updateCommand) {
    throw new Error('No update command available. Please update Claude manually.');
  }

  const cmd = resolveWindowsCommand(updateCommand);
  debugLog('Claude', 'update-run', { command: cmd, args: updateArgs });
  const result = await runCommand(cmd, updateArgs, { env: { ...process.env, CI: '1' } });
  debugLog('Claude', 'update-result', {
    code: result.code,
    stdout: trimOutput(result.stdout),
    stderr: trimOutput(result.stderr),
  });
  if (result.code !== 0 && result.code !== null) {
    const message = trimOutput(`${result.stdout}\n${result.stderr}`, 800) || 'Update failed';
    throw new Error(message);
  }
  claudeUpdateCache = null;
  claudeUpdatePromise = null;
  return getClaudeStatus();
}

export async function loginClaude(options?: ProviderLoginOptions): Promise<{ loggedIn: boolean }> {
  const login = buildLoginCommand('AGENTCONNECT_CLAUDE_LOGIN', DEFAULT_LOGIN);
  if (login.command) {
    const command = resolveWindowsCommand(login.command);
    await runCommand(command, login.args);
  } else {
    await runClaudeLoginFlow(options);
  }
  const status = await getClaudeStatus();
  return { loggedIn: status.loggedIn };
}

async function runClaudeLoginFlow(options?: ProviderLoginOptions): Promise<void> {
  const command = resolveWindowsCommand(getClaudeCommand());
  const loginMethod = resolveClaudeLoginMethod(options);
  const loginExperience = resolveClaudeLoginExperience(options);
  const loginHint = await resolveClaudeLoginHint(options);
  await ensureClaudeOnboardingSettings();
  const settingsPath = await createClaudeLoginSettingsFile(loginMethod);
  const loginTimeoutMs = Number(process.env.AGENTCONNECT_CLAUDE_LOGIN_TIMEOUT_MS || 180_000);
  const loginArgs = settingsPath ? ['--settings', settingsPath] : [];
  const includeLogin = loginHint === 'login';
  let ptyProcess: IPty | null = null;
  let childExited = false;

  const cleanup = async (): Promise<void> => {
    if (ptyProcess) {
      try {
        ptyProcess.kill();
      } catch {
        // ignore
      }
    }
    if (settingsPath && loginExperience !== 'terminal') {
      try {
        await rm(settingsPath, { force: true });
      } catch {
        // ignore
      }
    }
  };

  try {
    if (loginExperience === 'terminal') {
      await openClaudeLoginTerminal(command, loginArgs, includeLogin);
      if (settingsPath) {
        setTimeout(() => {
          rm(settingsPath, { force: true }).catch(() => {});
        }, loginTimeoutMs);
      }
    } else {
      const ptyModule = await loadPtyModule();
      if (!ptyModule) {
        throw new Error(
          'Claude login requires node-pty. Reinstall AgentConnect or run `claude /login` manually.'
        );
      }

      const spawnArgs = includeLogin ? [...loginArgs, '/login'] : loginArgs;
      ptyProcess = ptyModule.spawn(command, spawnArgs, {
        name: 'xterm-256color',
        cols: 100,
        rows: 30,
        cwd: os.homedir(),
        env: { ...process.env, TERM: 'xterm-256color' },
      });

      let outputBuffer = '';
      ptyProcess.onData((data) => {
        outputBuffer += data;
        if (outputBuffer.length > 6000) {
          outputBuffer = outputBuffer.slice(-3000);
        }
        const advanced = maybeAdvanceClaudeOnboarding(outputBuffer, loginMethod, (input) => {
          ptyProcess?.write(input);
        });
        if (advanced) outputBuffer = '';
      });

      ptyProcess.onExit(() => {
        childExited = true;
      });
    }

    const start = Date.now();
    while (Date.now() - start < loginTimeoutMs) {
      const authed = await hasClaudeAuth();
      if (authed) {
        return;
      }
      if (childExited) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    throw new Error(
      'Claude login timed out. Finish login in your browser or run `claude` manually to authenticate.'
    );
  } finally {
    await cleanup();
  }
}

function safeJsonParse(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function mapClaudeModel(model: string | undefined): string | null {
  if (!model) return null;
  const value = String(model).toLowerCase();
  if (value === 'default' || value === 'recommended') return null;
  if (value === 'claude-default' || value === 'claude-recommended') return null;
  if (value.includes('opus')) return 'opus';
  if (value.includes('sonnet')) return 'sonnet';
  if (value.includes('haiku')) return 'haiku';
  if (value.startsWith('claude-')) return value.replace('claude-', '');
  return model;
}

interface ClaudeMessage {
  type?: string;
  session_id?: string;
  sessionId?: string;
  modelUsage?: Record<string, unknown>;
  context_management?: unknown;
  usage?: Record<string, unknown>;
  context_usage?: Record<string, unknown>;
  contextUsage?: Record<string, unknown>;
  message?: {
    session_id?: string;
    sessionId?: string;
    content?: Array<{ type?: string; text?: string }>;
    role?: string;
    modelUsage?: Record<string, unknown>;
    usage?: Record<string, unknown>;
    context_usage?: Record<string, unknown>;
    contextUsage?: Record<string, unknown>;
  };
  event?: {
    type?: string;
    index?: number;
    content_block?: {
      type?: string;
      id?: string;
      name?: string;
      input?: unknown;
      text?: string;
      thinking?: string;
    };
    delta?: {
      type?: string;
      text?: string;
      partial_json?: string;
      thinking?: string;
      signature?: string;
    };
    usage?: Record<string, unknown>;
    context_usage?: Record<string, unknown>;
    contextUsage?: Record<string, unknown>;
  };
  delta?: { text?: string; usage?: Record<string, unknown> };
  result?: string | Record<string, unknown>;
}

interface ExtractedUsage {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  cached_input_tokens?: number;
  reasoning_tokens?: number;
}

interface ExtractedContextUsage {
  context_window?: number;
  context_tokens?: number;
  context_cached_tokens?: number;
  context_remaining_tokens?: number;
  context_truncated?: boolean;
}

function extractUsageFromValue(value: unknown): ExtractedUsage | null {
  if (!value || typeof value !== 'object') return null;
  const usage = value as Record<string, unknown>;
  const toNumber = (v: unknown): number | undefined => {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim()) {
      const parsed = Number(v);
      return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
  };
  const input = toNumber(
    usage.input_tokens ?? usage.prompt_tokens ?? usage.inputTokens ?? usage.promptTokens
  );
  const output = toNumber(
    usage.output_tokens ?? usage.completion_tokens ?? usage.outputTokens ?? usage.completionTokens
  );
  const total = toNumber(usage.total_tokens ?? usage.totalTokens);
  let cached = toNumber(usage.cached_input_tokens ?? usage.cachedInputTokens);
  const cacheCreation = toNumber(
    usage.cache_creation_input_tokens ?? usage.cacheCreationInputTokens
  );
  const cacheRead = toNumber(usage.cache_read_input_tokens ?? usage.cacheReadInputTokens);
  if (cached === undefined) {
    const sum = (cacheCreation ?? 0) + (cacheRead ?? 0);
    if (sum > 0) cached = sum;
  }
  const reasoning = toNumber(usage.reasoning_tokens ?? usage.reasoningTokens);
  const out: ExtractedUsage = {};
  if (input !== undefined) out.input_tokens = input;
  if (output !== undefined) out.output_tokens = output;
  if (total !== undefined) out.total_tokens = total;
  if (cached !== undefined) out.cached_input_tokens = cached;
  if (reasoning !== undefined) out.reasoning_tokens = reasoning;
  return Object.keys(out).length ? out : null;
}

function pickModelUsage(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null;
  const entries = Object.values(value as Record<string, unknown>);
  for (const entry of entries) {
    if (entry && typeof entry === 'object') return entry as Record<string, unknown>;
  }
  return null;
}

function extractClaudeUsage(msg: ClaudeMessage): ExtractedUsage | null {
  const usage =
    msg.usage ??
    msg.message?.usage ??
    msg.event?.usage ??
    msg.delta?.usage ??
    (msg as { token_usage?: Record<string, unknown> }).token_usage ??
    (msg as { tokenUsage?: Record<string, unknown> }).tokenUsage;
  if (usage) return extractUsageFromValue(usage);
  const resultRecord =
    msg.result && typeof msg.result === 'object' ? (msg.result as Record<string, unknown>) : null;
  const nestedUsage =
    resultRecord?.usage ??
    resultRecord?.token_usage ??
    resultRecord?.tokenUsage ??
    resultRecord?.token_usage;
  if (nestedUsage) return extractUsageFromValue(nestedUsage);
  const modelUsage = pickModelUsage(
    msg.modelUsage ?? msg.message?.modelUsage ?? resultRecord?.modelUsage
  );
  return extractUsageFromValue(modelUsage);
}

function extractClaudeContextUsage(
  msg: ClaudeMessage,
  usage: ExtractedUsage | null
): ExtractedContextUsage | null {
  const context =
    msg.context_usage ??
    msg.contextUsage ??
    msg.message?.context_usage ??
    msg.message?.contextUsage ??
    msg.event?.context_usage ??
    msg.event?.contextUsage;
  const resultRecord =
    msg.result && typeof msg.result === 'object' ? (msg.result as Record<string, unknown>) : null;
  const modelUsage = pickModelUsage(
    msg.modelUsage ?? msg.message?.modelUsage ?? resultRecord?.modelUsage
  );
  const toNumber = (v: unknown): number | undefined => {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim()) {
      const parsed = Number(v);
      return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
  };
  const toBoolean = (v: unknown): boolean | undefined =>
    typeof v === 'boolean' ? v : undefined;
  const contextWindow = toNumber(
    (context as Record<string, unknown> | undefined)?.context_window ??
      (context as Record<string, unknown> | undefined)?.contextWindow ??
      (modelUsage as Record<string, unknown> | undefined)?.contextWindow ??
      (modelUsage as Record<string, unknown> | undefined)?.context_window ??
      (msg as { context_window?: unknown }).context_window ??
      (msg as { contextWindow?: unknown }).contextWindow
  );
  let contextTokens = toNumber(
    (context as Record<string, unknown> | undefined)?.context_tokens ??
      (context as Record<string, unknown> | undefined)?.contextTokens ??
      (msg as { context_tokens?: unknown }).context_tokens ??
      (msg as { contextTokens?: unknown }).contextTokens
  );
  let contextCachedTokens = toNumber(
    (context as Record<string, unknown> | undefined)?.context_cached_tokens ??
      (context as Record<string, unknown> | undefined)?.contextCachedTokens ??
      (msg as { context_cached_tokens?: unknown }).context_cached_tokens ??
      (msg as { contextCachedTokens?: unknown }).contextCachedTokens
  );
  let contextRemainingTokens = toNumber(
    (context as Record<string, unknown> | undefined)?.context_remaining_tokens ??
      (context as Record<string, unknown> | undefined)?.contextRemainingTokens ??
      (msg as { context_remaining_tokens?: unknown }).context_remaining_tokens ??
      (msg as { contextRemainingTokens?: unknown }).contextRemainingTokens
  );
  const contextTruncated = toBoolean(
    (context as Record<string, unknown> | undefined)?.context_truncated ??
      (context as Record<string, unknown> | undefined)?.contextTruncated ??
      (msg as { context_truncated?: unknown }).context_truncated ??
      (msg as { contextTruncated?: unknown }).contextTruncated
  );
  if (contextCachedTokens === undefined) {
    const cached =
      toNumber((context as Record<string, unknown> | undefined)?.cache_creation_input_tokens) ??
      toNumber((context as Record<string, unknown> | undefined)?.cacheCreationInputTokens) ??
      toNumber((context as Record<string, unknown> | undefined)?.cache_read_input_tokens) ??
      toNumber((context as Record<string, unknown> | undefined)?.cacheReadInputTokens);
    if (cached !== undefined) contextCachedTokens = cached;
  }
  if (contextTokens === undefined) {
    if (
      usage?.input_tokens !== undefined &&
      usage?.cached_input_tokens !== undefined
    ) {
      contextTokens = usage.input_tokens + usage.cached_input_tokens;
    } else if (usage?.input_tokens !== undefined) {
      contextTokens = usage.input_tokens;
    }
  }
  if (contextCachedTokens === undefined && usage?.cached_input_tokens !== undefined) {
    contextCachedTokens = usage.cached_input_tokens;
  }
  if (
    contextRemainingTokens === undefined &&
    contextWindow !== undefined &&
    contextTokens !== undefined
  ) {
    contextRemainingTokens = Math.max(0, contextWindow - contextTokens);
  }
  const out: ExtractedContextUsage = {};
  if (contextWindow !== undefined) out.context_window = contextWindow;
  if (contextTokens !== undefined) out.context_tokens = contextTokens;
  if (contextCachedTokens !== undefined) out.context_cached_tokens = contextCachedTokens;
  if (contextRemainingTokens !== undefined) out.context_remaining_tokens = contextRemainingTokens;
  if (contextTruncated !== undefined) out.context_truncated = contextTruncated;
  return Object.keys(out).length ? out : null;
}

function mergeUsage(current: ExtractedUsage | null, next: ExtractedUsage): ExtractedUsage {
  const out: ExtractedUsage = { ...(current ?? {}) };
  if (next.input_tokens !== undefined) out.input_tokens = next.input_tokens;
  if (next.output_tokens !== undefined) out.output_tokens = next.output_tokens;
  if (next.total_tokens !== undefined) out.total_tokens = next.total_tokens;
  if (next.cached_input_tokens !== undefined) out.cached_input_tokens = next.cached_input_tokens;
  if (next.reasoning_tokens !== undefined) out.reasoning_tokens = next.reasoning_tokens;
  return out;
}

function mergeContextUsage(
  current: ExtractedContextUsage | null,
  next: ExtractedContextUsage
): ExtractedContextUsage {
  const out: ExtractedContextUsage = { ...(current ?? {}) };
  if (next.context_window !== undefined) out.context_window = next.context_window;
  if (next.context_tokens !== undefined) out.context_tokens = next.context_tokens;
  if (next.context_cached_tokens !== undefined)
    out.context_cached_tokens = next.context_cached_tokens;
  if (next.context_remaining_tokens !== undefined)
    out.context_remaining_tokens = next.context_remaining_tokens;
  if (next.context_truncated !== undefined) out.context_truncated = next.context_truncated;
  return out;
}

function extractSessionId(msg: ClaudeMessage): string | null {
  const direct = msg.session_id ?? msg.sessionId;
  if (typeof direct === 'string' && direct) return direct;
  const nested = msg.message?.session_id ?? msg.message?.sessionId;
  return typeof nested === 'string' && nested ? nested : null;
}

function extractAssistantDelta(msg: ClaudeMessage): string | null {
  const type = String(msg.type ?? '');
  if (type === 'stream_event') {
    const ev = msg.event ?? {};
    if (ev.type === 'content_block_delta') {
      const text = ev.delta?.text;
      return typeof text === 'string' && text ? text : null;
    }
  }

  if (type === 'content_block_delta') {
    const text = msg.delta?.text;
    return typeof text === 'string' && text ? text : null;
  }

  const text = msg.delta?.text;
  return typeof text === 'string' && text ? text : null;
}

function extractTextFromContent(content: unknown): string {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (!part || typeof part !== 'object') return '';
        const text = (part as { type?: string; text?: unknown }).text;
        if (typeof text === 'string') return text;
        return '';
      })
      .filter(Boolean)
      .join('');
  }
  return '';
}

function extractAssistantText(msg: ClaudeMessage): string | null {
  if (String(msg.type ?? '') !== 'assistant') return null;
  const content = msg.message?.content;
  if (!Array.isArray(content)) return null;
  const textBlock = content.find((c) => c && typeof c === 'object' && c.type === 'text');
  const text = textBlock?.text;
  return typeof text === 'string' && text ? text : null;
}

function extractResultText(msg: ClaudeMessage): string | null {
  if (String(msg.type ?? '') !== 'result') return null;
  const text = msg.result;
  return typeof text === 'string' && text ? text : null;
}

export function runClaudePrompt({
  prompt,
  system,
  resumeSessionId,
  model,
  cwd,
  providerDetailLevel,
  onEvent,
  signal,
}: RunPromptOptions): Promise<RunPromptResult> {
  return new Promise((resolve) => {
    const command = getClaudeCommand();
    const args = [
      '-p',
      '--output-format=stream-json',
      '--verbose',
      '--permission-mode',
      'bypassPermissions',
    ];
    const systemPrompt = typeof system === 'string' ? system.trim() : '';
    if (systemPrompt) {
      args.push('--append-system-prompt', systemPrompt);
    }
    const modelValue = mapClaudeModel(model);
    if (modelValue) {
      args.push('--model', modelValue);
    }
    if (resumeSessionId) args.push('--resume', resumeSessionId);
    args.push(prompt);

    logProviderSpawn({
      provider: 'claude',
      command,
      args,
      cwd: cwd || process.cwd(),
      resumeSessionId,
    });

    const child = spawn(command, args, {
      cwd,
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
    let sawError = false;
    let usageEmitted = false;
    let latestUsage: ExtractedUsage | null = null;
    let latestContextUsage: ExtractedContextUsage | null = null;
    let latestUsageDetail: ProviderDetail | undefined;
    let latestContextUsageDetail: ProviderDetail | undefined;
    const toolBlocks = new Map<number, { id?: string; name?: string }>();
    const thinkingBlocks = new Set<number>();

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

    const emitError = (message: string): void => {
      if (sawError) return;
      sawError = true;
      emitUsageIfAvailable();
      emit({ type: 'error', message });
    };

    const emitFinal = (text: string, providerDetail?: ProviderDetail): void => {
      emitUsageIfAvailable();
      emit({ type: 'final', text, providerDetail });
    };

    const captureUsage = (msg: ClaudeMessage, providerDetail: ProviderDetail): void => {
      const usage = extractClaudeUsage(msg);
      if (usage) {
        latestUsage = mergeUsage(latestUsage, usage);
        latestUsageDetail = providerDetail;
      }
      const contextUsage = extractClaudeContextUsage(msg, latestUsage);
      if (contextUsage) {
        latestContextUsage = mergeContextUsage(latestContextUsage, contextUsage);
        latestContextUsageDetail = providerDetail;
      }
    };

    const emitUsageIfAvailable = (): void => {
      if (usageEmitted) return;
      if (!latestUsage && !latestContextUsage) return;
      if (latestUsage) {
        emit({
          type: 'usage',
          usage: latestUsage,
          providerDetail: latestUsageDetail,
        });
      }
      if (latestContextUsage) {
        emit({
          type: 'context_usage',
          contextUsage: latestContextUsage,
          providerDetail: latestContextUsageDetail ?? latestUsageDetail,
        });
      }
      usageEmitted = true;
    };

    const handleLine = (line: string): void => {
      const parsed = safeJsonParse(line);
      if (!parsed || typeof parsed !== 'object') {
        if (line.trim()) {
          emit({ type: 'raw_line', line });
        }
        return;
      }
      const msg = parsed as ClaudeMessage;

      const sid = extractSessionId(msg);
      if (sid) finalSessionId = sid;

      const msgType = String(msg.type ?? '');
      let handled = false;
      const detail = buildProviderDetail(msgType || 'unknown', {}, msg);
      captureUsage(msg, detail);

      if (msgType === 'assistant' || msgType === 'user' || msgType === 'system') {
        const role =
          msg.message?.role === 'assistant' ||
          msg.message?.role === 'user' ||
          msg.message?.role === 'system'
            ? msg.message.role
            : msgType;
        const rawContent = msg.message?.content;
        const content = extractTextFromContent(rawContent);
        emit({
          type: 'message',
          provider: 'claude',
          role,
          content,
          contentParts: rawContent ?? null,
          providerDetail: detail,
        });
        handled = true;
      }

      if (msgType === 'stream_event' && msg.event) {
        const evType = String(msg.event.type ?? '');
        const index = typeof msg.event.index === 'number' ? msg.event.index : undefined;
        const block = msg.event.content_block;
        if (evType === 'content_block_start' && block && typeof index === 'number') {
          if (
            block.type === 'tool_use' ||
            block.type === 'server_tool_use' ||
            block.type === 'mcp_tool_use'
          ) {
            toolBlocks.set(index, { id: block.id, name: block.name });
            emit({
              type: 'tool_call',
              provider: 'claude',
              name: block.name,
              callId: block.id,
              input: block.input,
              phase: 'start',
              providerDetail: buildProviderDetail(
                'content_block_start',
                { blockType: block.type, index, name: block.name, id: block.id },
                msg
              ),
            });
          }
          if (block.type === 'thinking' || block.type === 'redacted_thinking') {
            thinkingBlocks.add(index);
            emit({
              type: 'thinking',
              provider: 'claude',
              phase: 'start',
              text: typeof block.thinking === 'string' ? block.thinking : undefined,
              providerDetail: buildProviderDetail(
                'content_block_start',
                { blockType: block.type, index },
                msg
              ),
            });
          }
          handled = true;
        }
        if (evType === 'content_block_delta') {
          const delta = msg.event.delta ?? {};
          if (delta.type === 'thinking_delta') {
            emit({
              type: 'thinking',
              provider: 'claude',
              phase: 'delta',
              text: typeof delta.thinking === 'string' ? delta.thinking : undefined,
              providerDetail: buildProviderDetail(
                'content_block_delta',
                { deltaType: delta.type, index },
                msg
              ),
            });
            handled = true;
          }
          if (delta.type === 'input_json_delta') {
            const tool = typeof index === 'number' ? toolBlocks.get(index) : undefined;
            emit({
              type: 'tool_call',
              provider: 'claude',
              name: tool?.name,
              callId: tool?.id,
              input: delta.partial_json,
              phase: 'delta',
              providerDetail: buildProviderDetail(
                'content_block_delta',
                { deltaType: delta.type, index, name: tool?.name, id: tool?.id },
                msg
              ),
            });
            handled = true;
          }
        }
        if (evType === 'content_block_stop' && typeof index === 'number') {
          if (toolBlocks.has(index)) {
            const tool = toolBlocks.get(index);
            emit({
              type: 'tool_call',
              provider: 'claude',
              name: tool?.name,
              callId: tool?.id,
              phase: 'completed',
              providerDetail: buildProviderDetail(
                'content_block_stop',
                { index, name: tool?.name, id: tool?.id },
                msg
              ),
            });
            toolBlocks.delete(index);
          }
          if (thinkingBlocks.has(index)) {
            emit({
              type: 'thinking',
              provider: 'claude',
              phase: 'completed',
              providerDetail: buildProviderDetail('content_block_stop', { index }, msg),
            });
            thinkingBlocks.delete(index);
          }
          handled = true;
        }
      }

      const delta = extractAssistantDelta(msg);
      if (delta) {
        aggregated += delta;
        emit({
          type: 'delta',
          text: delta,
          providerDetail: detail,
        });
        return;
      }

      const assistant = extractAssistantText(msg);
      if (assistant && !aggregated) {
        aggregated = assistant;
        emit({
          type: 'delta',
          text: assistant,
          providerDetail: detail,
        });
        return;
      }

      const result = extractResultText(msg);
      if (result && !didFinalize && !sawError) {
        didFinalize = true;
        emitFinal(aggregated || result, detail);
        handled = true;
      }

      if (!handled) {
        emit({
          type: 'detail',
          provider: 'claude',
          providerDetail: detail,
        });
      }
    };

    const stdoutParser = createLineParser(handleLine);
    const stderrParser = createLineParser(handleLine);

    child.stdout?.on('data', stdoutParser);
    child.stderr?.on('data', stderrParser);

    child.on('close', (code) => {
      if (!didFinalize) {
        if (code && code !== 0) {
          emitError(`Claude exited with code ${code}`);
        } else if (!sawError) {
          emitFinal(aggregated);
        }
      }
      if (!usageEmitted) {
        emitUsageIfAvailable();
      }
      resolve({ sessionId: finalSessionId });
    });

    child.on('error', (err: Error) => {
      emitError(err?.message ?? 'Claude failed to start');
      resolve({ sessionId: finalSessionId });
    });
  });
}
