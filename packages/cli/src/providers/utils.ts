import { spawn, type SpawnOptions } from 'child_process';
import { existsSync } from 'fs';
import os from 'os';
import path from 'path';
import type { CommandResult } from '../types.js';

export interface SplitCommandResult {
  command: string;
  args: string[];
}

export function splitCommand(value: string | string[] | undefined): SplitCommandResult {
  if (!value) return { command: '', args: [] };
  if (Array.isArray(value)) return { command: value[0] ?? '', args: value.slice(1) };

  const input = String(value).trim();
  const parts: string[] = [];
  let current = '';
  let quote: string | null = null;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (char === ' ') {
      if (current) {
        parts.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (current) parts.push(current);
  return { command: parts[0] ?? '', args: parts.slice(1) };
}

export function resolveWindowsCommand(command: string): string {
  if (process.platform !== 'win32') return command;
  if (!command) return command;
  if (command.endsWith('.cmd') || command.endsWith('.exe') || command.includes('\\')) {
    return command;
  }
  return `${command}.cmd`;
}

function getCommonBinPaths(): string[] {
  const home = os.homedir();
  const bunInstall = process.env.BUN_INSTALL || path.join(home, '.bun');
  const pnpmHome = process.env.PNPM_HOME || path.join(home, 'Library', 'pnpm');
  const npmPrefix = process.env.NPM_CONFIG_PREFIX;
  const npmBin = npmPrefix ? path.join(npmPrefix, 'bin') : '';
  const claudeLocal = process.env.CLAUDE_CONFIG_DIR
    ? path.join(process.env.CLAUDE_CONFIG_DIR, 'local')
    : path.join(home, '.claude', 'local');
  return [
    path.join(bunInstall, 'bin'),
    pnpmHome,
    path.join(home, '.local', 'bin'),
    claudeLocal,
    path.join(home, '.claude', 'bin'),
    npmBin,
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
  ].filter(Boolean);
}

function getCommandCandidates(command: string): string[] {
  if (process.platform !== 'win32') return [command];
  if (command.endsWith('.cmd') || command.endsWith('.exe') || command.endsWith('.bat')) {
    return [command];
  }
  return [command, `${command}.cmd`, `${command}.exe`, `${command}.bat`];
}

export function resolveCommandPath(command: string): string | null {
  if (!command) return null;
  if (command.includes('/') || command.includes('\\')) {
    return existsSync(command) ? command : null;
  }

  const candidates = getCommandCandidates(command);
  const searchPaths = new Set<string>();
  const pathEntries = process.env.PATH ? process.env.PATH.split(path.delimiter) : [];
  for (const entry of pathEntries) {
    if (entry) searchPaths.add(entry);
  }
  for (const entry of getCommonBinPaths()) {
    if (entry) searchPaths.add(entry);
  }

  for (const dir of searchPaths) {
    for (const candidate of candidates) {
      const fullPath = path.join(dir, candidate);
      if (existsSync(fullPath)) return fullPath;
    }
  }

  return null;
}

export function commandExists(command: string): boolean {
  return Boolean(resolveCommandPath(command));
}

export interface RunCommandOptions extends SpawnOptions {
  input?: string;
  timeoutMs?: number;
}

export function runCommand(
  command: string,
  args: string[],
  options: RunCommandOptions = {}
): Promise<CommandResult> {
  return new Promise((resolve) => {
    const { input, timeoutMs, ...spawnOptions } = options;
    const resolved = resolveCommandPath(command) ?? command;
    const child = spawn(resolved, args, {
      ...spawnOptions,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    let timeout: NodeJS.Timeout | undefined;
    if (typeof timeoutMs === 'number' && timeoutMs > 0) {
      timeout = setTimeout(() => {
        child.kill();
        resolve({ code: -1, stdout, stderr: `${stderr}Command timed out` });
      }, timeoutMs);
    }

    if (input) {
      child.stdin?.write(input);
    }
    child.stdin?.end();

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    child.on('error', (err: Error) => {
      if (timeout) clearTimeout(timeout);
      resolve({ code: -1, stdout, stderr: `${stderr}${err.message}` });
    });

    child.on('close', (code) => {
      if (timeout) clearTimeout(timeout);
      resolve({ code: code ?? 0, stdout, stderr });
    });
  });
}

export function createLineParser(onLine: (line: string) => void): (chunk: Buffer | string) => void {
  let buffer = '';
  return (chunk: Buffer | string) => {
    const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    buffer += text;
    let idx: number;
    while ((idx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (line) onLine(line);
    }
  };
}

export interface CheckVersionResult {
  ok: boolean;
  version: string;
}

export async function checkCommandVersion(
  command: string,
  argsList: string[][]
): Promise<CheckVersionResult> {
  for (const args of argsList) {
    const result = await runCommand(command, args);
    if (result.code === 0) {
      const version = result.stdout.trim().split('\n')[0] ?? '';
      return { ok: true, version };
    }
  }
  return { ok: false, version: '' };
}

export type PackageManager = 'bun' | 'pnpm' | 'npm' | 'brew' | 'unknown';

export interface InstallCommandResult extends SplitCommandResult {
  packageManager: PackageManager;
}

const packageManagerCache: { detected: PackageManager | null } = { detected: null };

async function isCommandAvailable(command: string): Promise<boolean> {
  const result = await runCommand(command, ['--version']);
  return result.code === 0;
}

export async function detectPackageManager(): Promise<PackageManager> {
  if (packageManagerCache.detected) {
    return packageManagerCache.detected;
  }

  // Priority: bun > pnpm > npm > brew
  if (await isCommandAvailable('bun')) {
    packageManagerCache.detected = 'bun';
    return 'bun';
  }
  if (await isCommandAvailable('pnpm')) {
    packageManagerCache.detected = 'pnpm';
    return 'pnpm';
  }
  if (await isCommandAvailable('npm')) {
    packageManagerCache.detected = 'npm';
    return 'npm';
  }
  if (process.platform === 'darwin' && (await isCommandAvailable('brew'))) {
    packageManagerCache.detected = 'brew';
    return 'brew';
  }

  packageManagerCache.detected = 'unknown';
  return 'unknown';
}

export function getInstallCommand(
  packageManager: PackageManager,
  packageName: string
): SplitCommandResult {
  switch (packageManager) {
    case 'bun':
      return { command: 'bun', args: ['add', '-g', packageName] };
    case 'pnpm':
      return { command: 'pnpm', args: ['add', '-g', packageName] };
    case 'npm':
      return { command: 'npm', args: ['install', '-g', packageName] };
    case 'brew':
      return { command: 'brew', args: ['install', packageName] };
    default:
      return { command: '', args: [] };
  }
}

export async function buildInstallCommandAuto(
  packageName: string
): Promise<InstallCommandResult> {
  const pm = await detectPackageManager();
  const cmd = getInstallCommand(pm, packageName);
  return { ...cmd, packageManager: pm };
}

export function buildInstallCommand(envVar: string, fallback: string): SplitCommandResult {
  const value = process.env[envVar] || fallback;
  return splitCommand(value);
}

export function buildLoginCommand(envVar: string, fallback: string): SplitCommandResult {
  const value = process.env[envVar] || fallback;
  return splitCommand(value);
}

export function buildStatusCommand(envVar: string, fallback: string): SplitCommandResult {
  const value = process.env[envVar] || fallback;
  return splitCommand(value);
}
