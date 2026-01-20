import type { Provider, ProviderId, ModelInfo } from '../types.js';
import {
  ensureClaudeInstalled,
  getClaudeFastStatus,
  getClaudeStatus,
  listClaudeModels,
  listClaudeRecentModels,
  loginClaude,
  runClaudePrompt,
  updateClaude,
} from './claude.js';
import {
  ensureCodexInstalled,
  getCodexFastStatus,
  getCodexStatus,
  listCodexModels,
  loginCodex,
  runCodexPrompt,
  updateCodex,
} from './codex.js';
import {
  ensureCursorInstalled,
  getCursorFastStatus,
  getCursorStatus,
  listCursorModels,
  loginCursor,
  runCursorPrompt,
  updateCursor,
} from './cursor.js';
import {
  ensureLocalInstalled,
  getLocalStatus,
  listLocalModels,
  loginLocal,
  runLocalPrompt,
  updateLocal,
} from './local.js';

export const providers: Record<ProviderId, Provider> = {
  claude: {
    id: 'claude',
    name: 'Claude',
    ensureInstalled: ensureClaudeInstalled,
    fastStatus: getClaudeFastStatus,
    status: getClaudeStatus,
    update: updateClaude,
    login: loginClaude,
    logout: async () => {},
    runPrompt: runClaudePrompt,
  },
  codex: {
    id: 'codex',
    name: 'Codex',
    ensureInstalled: ensureCodexInstalled,
    fastStatus: getCodexFastStatus,
    status: getCodexStatus,
    update: updateCodex,
    login: loginCodex,
    logout: async () => {},
    runPrompt: runCodexPrompt,
  },
  cursor: {
    id: 'cursor',
    name: 'Cursor',
    ensureInstalled: ensureCursorInstalled,
    fastStatus: getCursorFastStatus,
    status: getCursorStatus,
    update: updateCursor,
    login: loginCursor,
    logout: async () => {},
    runPrompt: runCursorPrompt,
  },
  local: {
    id: 'local',
    name: 'Local',
    ensureInstalled: ensureLocalInstalled,
    status: getLocalStatus,
    update: updateLocal,
    login: loginLocal,
    logout: async () => {},
    runPrompt: runLocalPrompt,
  },
};

export async function listModels(): Promise<ModelInfo[]> {
  const claudeModels = await listClaudeModels();
  const codexModels = await listCodexModels();
  const cursorModels = await listCursorModels();
  const base: ModelInfo[] = [
    ...claudeModels,
    ...cursorModels,
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

export async function listRecentModels(
  providerId?: ProviderId
): Promise<ModelInfo[]> {
  if (providerId && providerId !== 'claude') return [];
  const recent = await listClaudeRecentModels();
  return recent.filter((entry) => entry.provider === 'claude');
}

export function resolveProviderForModel(model: string | undefined): ProviderId {
  const lower = String(model || '').toLowerCase();
  if (lower.includes('cursor')) return 'cursor';
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
