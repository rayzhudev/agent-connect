import { spawn } from 'child_process';
import { access, mkdir, readFile, rm, writeFile } from 'fs/promises';
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
  resolveWindowsCommand,
  resolveCommandPath,
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
let claudeModelsCache: ModelInfo[] | null = null;
let claudeModelsCacheAt = 0;
let claudeRecentModelsCache: ModelInfo[] | null = null;
let claudeRecentModelsCacheAt = 0;

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

function formatClaudeDisplayName(modelId: string): string {
  const value = modelId.trim();
  if (!value.startsWith('claude-')) return value;
  const parts = value.replace(/^claude-/, '').split('-').filter(Boolean);
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

function resolveClaudeLoginExperience(
  options?: ProviderLoginOptions
): ClaudeLoginExperience {
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

async function checkClaudeCliStatus(): Promise<boolean | null> {
  const command = resolveWindowsCommand(getClaudeCommand());
  const result = await runCommand(command, ['--print'], {
    env: { ...process.env, CI: '1' },
    input: '/status\n',
    timeoutMs: 4000,
  });
  const output = `${result.stdout}\n${result.stderr}`.toLowerCase();
  if (!output.trim()) {
    return null;
  }
  if (
    output.includes('not logged in') ||
    output.includes('not authenticated') ||
    output.includes('please log in') ||
    output.includes('please login') ||
    output.includes('run /login') ||
    output.includes('sign in') ||
    output.includes('invalid api key')
  ) {
    return false;
  }
  if (
    output.includes('logged in') ||
    output.includes('authenticated') ||
    output.includes('signed in') ||
    output.includes('account') ||
    output.includes('@')
  ) {
    return true;
  }
  return null;
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
      const hasAuth = await hasClaudeAuth();
      const cliStatus = await checkClaudeCliStatus();
      if (cliStatus === false) {
        loggedIn = false;
      } else if (cliStatus === true) {
        loggedIn = true;
      } else {
        loggedIn = hasAuth;
      }
    }
  }

  return { installed, loggedIn, version: versionCheck.version || undefined };
}

export async function loginClaude(
  options?: ProviderLoginOptions
): Promise<{ loggedIn: boolean }> {
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
  await ensureClaudeOnboardingSettings();
  const settingsPath = await createClaudeLoginSettingsFile(loginMethod);
  const loginTimeoutMs = Number(process.env.AGENTCONNECT_CLAUDE_LOGIN_TIMEOUT_MS || 180_000);
  const loginArgs = settingsPath ? ['--settings', settingsPath] : [];
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
    if (settingsPath) {
      try {
        await rm(settingsPath, { force: true });
      } catch {
        // ignore
      }
    }
  };

  try {
    if (loginExperience === 'terminal') {
      await openClaudeLoginTerminal(command, loginArgs, false);
    } else {
      const ptyModule = await loadPtyModule();
      if (!ptyModule) {
        throw new Error(
          'Claude login requires node-pty. Reinstall AgentConnect or run `claude /login` manually.'
        );
      }

      ptyProcess = ptyModule.spawn(command, [...loginArgs, '/login'], {
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
  message?: {
    session_id?: string;
    sessionId?: string;
    content?: Array<{ type?: string; text?: string }>;
    role?: string;
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
  };
  delta?: { text?: string };
  result?: string;
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
    const modelValue = mapClaudeModel(model);
    if (modelValue) {
      args.push('--model', modelValue);
    }
    if (resumeSessionId) args.push('--resume', resumeSessionId);
    args.push(prompt);

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
      emit({ type: 'error', message });
    };

    const emitFinal = (text: string, providerDetail?: ProviderDetail): void => {
      emit({ type: 'final', text, providerDetail });
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
          providerDetail: buildProviderDetail(msgType, {}, msg),
        });
        handled = true;
      }

      if (msgType === 'stream_event' && msg.event) {
        const evType = String(msg.event.type ?? '');
        const index = typeof msg.event.index === 'number' ? msg.event.index : undefined;
        const block = msg.event.content_block;
        if (evType === 'content_block_start' && block && typeof index === 'number') {
          if (block.type === 'tool_use' || block.type === 'server_tool_use' || block.type === 'mcp_tool_use') {
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
          providerDetail: buildProviderDetail(msgType || 'delta', {}, msg),
        });
        return;
      }

      const assistant = extractAssistantText(msg);
      if (assistant && !aggregated) {
        aggregated = assistant;
        emit({
          type: 'delta',
          text: assistant,
          providerDetail: buildProviderDetail(msgType || 'assistant', {}, msg),
        });
        return;
      }

      const result = extractResultText(msg);
      if (result && !didFinalize && !sawError) {
        didFinalize = true;
        emitFinal(aggregated || result, buildProviderDetail('result', {}, msg));
        handled = true;
      }

      if (!handled) {
        emit({
          type: 'detail',
          provider: 'claude',
          providerDetail: buildProviderDetail(msgType || 'unknown', {}, msg),
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
      resolve({ sessionId: finalSessionId });
    });

    child.on('error', (err: Error) => {
      emitError(err?.message ?? 'Claude failed to start');
      resolve({ sessionId: finalSessionId });
    });
  });
}
