import type { ChildProcess } from 'child_process';

// JSON-RPC types
export type RpcId = string | number;

export interface RpcRequest {
  jsonrpc: '2.0';
  id: RpcId;
  method: string;
  params?: Record<string, unknown>;
}

export interface RpcSuccess {
  jsonrpc: '2.0';
  id: RpcId;
  result: Record<string, unknown>;
}

export type RpcErrorCode =
  | 'AC_ERR_UNAUTHORIZED'
  | 'AC_ERR_NOT_INSTALLED'
  | 'AC_ERR_INVALID_ARGS'
  | 'AC_ERR_UNSUPPORTED'
  | 'AC_ERR_INTERNAL'
  | 'AC_ERR_FS_READ'
  | 'AC_ERR_FS_WRITE'
  | 'AC_ERR_FS_LIST'
  | 'AC_ERR_FS_STAT'
  | 'AC_ERR_PROCESS'
  | 'AC_ERR_NET'
  | 'AC_ERR_BACKEND';

export interface RpcError {
  jsonrpc: '2.0';
  id: RpcId;
  error: {
    code: RpcErrorCode;
    message: string;
    data?: Record<string, unknown>;
  };
}

export type RpcResponse = RpcSuccess | RpcError;

// App manifest types
export type ProviderId = 'claude' | 'codex' | 'local';

export interface AppManifestEntry {
  type: 'web';
  path: string;
  devUrl?: string;
}

export interface AppManifestBackendHealthcheck {
  type: 'http';
  path: string;
}

export interface AppManifestBackend {
  runtime: 'node';
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  healthcheck?: AppManifestBackendHealthcheck;
}

export interface AppManifestAuthor {
  name?: string;
  email?: string;
  url?: string;
}

export interface AppManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  entry: AppManifestEntry;
  backend?: AppManifestBackend;
  capabilities?: string[];
  providers?: ProviderId[];
  models?: { default?: string };
  icon?: string;
  repo?: string;
  homepage?: string;
  license?: string;
  author?: AppManifestAuthor;
  keywords?: string[];
}

// Registry types
export interface RegistryAppVersion {
  path: string;
  manifest: AppManifest;
  signature?: {
    algorithm: string;
    publicKey: string;
    signature: string;
  };
  hash?: string;
}

export interface RegistryApp {
  versions: Record<string, RegistryAppVersion>;
  latest: string;
}

export interface RegistryIndex {
  apps: Record<string, RegistryApp>;
}

// Provider types
export interface ProviderStatus {
  installed: boolean;
  loggedIn: boolean;
  version?: string;
}

export interface ProviderInfo extends ProviderStatus {
  id: ProviderId;
  name: string;
}

export interface ReasoningEffort {
  id: string;
  label: string;
}

export interface ModelInfo {
  id: string;
  provider: ProviderId;
  displayName?: string;
  contextWindow?: number;
  maxOutputTokens?: number;
  reasoningEfforts?: ReasoningEffort[];
  defaultReasoningEffort?: string;
}

export interface ProviderLoginOptions {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  models?: string[];
  loginMethod?: 'claudeai' | 'console';
  loginExperience?: 'embedded' | 'terminal';
}

export interface SessionEvent {
  type: 'delta' | 'final' | 'usage' | 'status' | 'error' | 'raw_line' | 'provider_event';
  text?: string;
  message?: string;
  line?: string;
  provider?: ProviderId;
  event?: Record<string, unknown>;
  providerSessionId?: string | null;
  inputTokens?: number;
  outputTokens?: number;
}

export interface RunPromptOptions {
  prompt: string;
  resumeSessionId?: string | null;
  model?: string;
  reasoningEffort?: string | null;
  repoRoot?: string;
  cwd?: string;
  signal?: AbortSignal;
  onEvent: (event: SessionEvent) => void;
}

export interface RunPromptResult {
  sessionId: string | null;
}

export type PackageManagerType = 'bun' | 'pnpm' | 'npm' | 'brew' | 'script' | 'unknown';

export interface InstallResult {
  installed: boolean;
  version?: string;
  packageManager?: PackageManagerType;
}

export interface Provider {
  id: ProviderId;
  name: string;
  ensureInstalled(): Promise<InstallResult>;
  status(): Promise<ProviderStatus>;
  login(options?: ProviderLoginOptions): Promise<{ loggedIn: boolean }>;
  logout(): Promise<void>;
  listModels?(): Promise<ModelInfo[]>;
  runPrompt(options: RunPromptOptions): Promise<RunPromptResult>;
}

// Host session types
export interface SessionState {
  id: string;
  providerId: ProviderId;
  model: string;
  providerSessionId: string | null;
  reasoningEffort: string | null;
  cwd?: string;
  repoRoot?: string;
}

export interface BackendState {
  status: 'starting' | 'running' | 'stopped' | 'error' | 'disabled';
  pid?: number;
  url?: string;
}

export interface ProcessHandle {
  pid: number;
  process: ChildProcess;
}

// Validation types
export interface ValidationError {
  path: string;
  message: string;
}

export interface ValidationWarning {
  path: string;
  message: string;
}

export interface RegistryValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

// Capability tracking types
export interface ObservedCapabilities {
  requested: string[];
  observed: string[];
}

export interface ObservedTracker {
  record(capability: string): void;
  list(): string[];
  snapshot(): ObservedCapabilities;
  flush(): void;
}

// Command execution types
export interface CommandResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

export interface LineParser {
  push(chunk: Buffer | string): void;
  end(): void;
}

// File system types
export interface CollectFilesOptions {
  ignoreNames?: string[];
  ignorePaths?: string[];
}

export interface FileEntry {
  name: string;
  path: string;
  type: 'file' | 'dir' | 'link' | 'other';
  size: number;
}

export interface FileStat {
  type: 'file' | 'dir' | 'link' | 'other';
  size: number;
  mtime: string;
}

// Signature types
export interface SignatureData {
  algorithm: string;
  publicKey: string;
  signature: string;
}
