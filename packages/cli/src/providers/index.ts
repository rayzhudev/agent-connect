import type { Provider, ProviderId, ModelInfo } from '../types.js';
import { ensureClaudeInstalled, getClaudeStatus, loginClaude, runClaudePrompt } from './claude.js';
import {
  ensureCodexInstalled,
  getCodexStatus,
  listCodexModels,
  loginCodex,
  runCodexPrompt,
} from './codex.js';
import {
  ensureLocalInstalled,
  getLocalStatus,
  listLocalModels,
  loginLocal,
  runLocalPrompt,
} from './local.js';

export const providers: Record<ProviderId, Provider> = {
  claude: {
    id: 'claude',
    name: 'Claude',
    ensureInstalled: ensureClaudeInstalled,
    status: getClaudeStatus,
    login: loginClaude,
    logout: async () => {},
    runPrompt: runClaudePrompt,
  },
  codex: {
    id: 'codex',
    name: 'Codex',
    ensureInstalled: ensureCodexInstalled,
    status: getCodexStatus,
    login: loginCodex,
    logout: async () => {},
    runPrompt: runCodexPrompt,
  },
  local: {
    id: 'local',
    name: 'Local',
    ensureInstalled: ensureLocalInstalled,
    status: getLocalStatus,
    login: loginLocal,
    logout: async () => {},
    runPrompt: runLocalPrompt,
  },
};

export async function listModels(): Promise<ModelInfo[]> {
  const codexModels = await listCodexModels();
  const base: ModelInfo[] = [
    { id: 'claude-opus', provider: 'claude', displayName: 'Claude Opus' },
    { id: 'claude-sonnet', provider: 'claude', displayName: 'Claude Sonnet' },
    { id: 'claude-haiku', provider: 'claude', displayName: 'Claude Haiku' },
    { id: 'local', provider: 'local', displayName: 'Local Model' },
  ];
  const envModels = process.env.AGENTCONNECT_LOCAL_MODELS;
  if (envModels) {
    try {
      const parsed = JSON.parse(envModels) as unknown;
      if (Array.isArray(parsed)) {
        for (const entry of parsed) {
          if (typeof entry === 'string' && entry) {
            base.push({ id: entry, provider: 'local', displayName: entry });
          }
        }
      }
    } catch {
      // ignore invalid json
    }
  }
  const discovered = await listLocalModels();
  const all = [...base, ...codexModels, ...discovered.filter((entry) => entry.id !== 'local')];
  const seen = new Set<string>();
  return all.filter((entry) => {
    const key = `${entry.provider}:${entry.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function resolveProviderForModel(model: string | undefined): ProviderId {
  const lower = String(model || '').toLowerCase();
  if (lower.includes('codex')) return 'codex';
  if (
    lower.startsWith('gpt') ||
    lower.startsWith('o1') ||
    lower.startsWith('o3') ||
    lower.startsWith('o4')
  ) {
    return 'codex';
  }
  if (lower.includes('local')) return 'local';
  if (lower.includes('opus') || lower.includes('sonnet') || lower.includes('haiku'))
    return 'claude';
  if (lower.includes('claude')) return 'claude';
  return 'claude';
}
