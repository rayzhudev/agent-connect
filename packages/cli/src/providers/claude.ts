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

export function getClaudeCommand(): string {
  const override = process.env.AGENTCONNECT_CLAUDE_COMMAND;
  const base = override || 'claude';
  const resolved = resolveCommandPath(base);
  return resolved || resolveWindowsCommand(base);
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
type PtyModule = typeof import('node-pty');
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
  };
  event?: {
    type?: string;
    delta?: { text?: string };
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

    const handleLine = (line: string): void => {
      const parsed = safeJsonParse(line);
      if (!parsed || typeof parsed !== 'object') return;
      const msg = parsed as ClaudeMessage;

      const sid = extractSessionId(msg);
      if (sid) finalSessionId = sid;

      const delta = extractAssistantDelta(msg);
      if (delta) {
        aggregated += delta;
        onEvent({ type: 'delta', text: delta });
        return;
      }

      const assistant = extractAssistantText(msg);
      if (assistant && !aggregated) {
        aggregated = assistant;
        onEvent({ type: 'delta', text: assistant });
        return;
      }

      const result = extractResultText(msg);
      if (result && !didFinalize) {
        didFinalize = true;
        onEvent({ type: 'final', text: aggregated || result });
      }
    };

    const stdoutParser = createLineParser(handleLine);
    const stderrParser = createLineParser(handleLine);

    child.stdout?.on('data', stdoutParser);
    child.stderr?.on('data', stderrParser);

    child.on('close', (code) => {
      if (!didFinalize) {
        if (code && code !== 0) {
          onEvent({ type: 'error', message: `Claude exited with code ${code}` });
        } else {
          onEvent({ type: 'final', text: aggregated });
        }
      }
      resolve({ sessionId: finalSessionId });
    });

    child.on('error', (err: Error) => {
      onEvent({ type: 'error', message: err?.message ?? 'Claude failed to start' });
      resolve({ sessionId: finalSessionId });
    });
  });
}
