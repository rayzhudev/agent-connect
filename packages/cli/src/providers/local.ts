import type {
  ProviderStatus,
  ProviderLoginOptions,
  ModelInfo,
  RunPromptOptions,
  RunPromptResult,
  InstallResult,
} from '../types.js';

function getLocalBaseUrl(): string {
  const base = process.env.AGENTCONNECT_LOCAL_BASE_URL || 'http://localhost:11434/v1';
  return base.replace(/\/+$/, '');
}

function getLocalApiKey(): string {
  return process.env.AGENTCONNECT_LOCAL_API_KEY || '';
}

function resolveLocalModel(model: string | undefined, fallback: string): string {
  if (!model) return fallback;
  const raw = String(model);
  if (raw === 'local') return fallback;
  if (raw.startsWith('local:')) return raw.slice('local:'.length);
  if (raw.startsWith('local/')) return raw.slice('local/'.length);
  return raw;
}

interface FetchJsonResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
}

async function fetchJson<T = unknown>(
  url: string,
  options: RequestInit = {}
): Promise<FetchJsonResult<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    if (!res.ok) {
      return { ok: false, status: res.status, data: null };
    }
    const data = (await res.json()) as T;
    return { ok: true, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: null };
  } finally {
    clearTimeout(timer);
  }
}

export async function ensureLocalInstalled(): Promise<InstallResult> {
  const base = getLocalBaseUrl();
  const res = await fetchJson(`${base}/models`);
  return { installed: res.ok };
}

export async function getLocalStatus(): Promise<ProviderStatus> {
  const base = getLocalBaseUrl();
  const res = await fetchJson(`${base}/models`);
  if (!res.ok) return { installed: false, loggedIn: false };
  return { installed: true, loggedIn: true };
}

export async function loginLocal(
  options: ProviderLoginOptions = {}
): Promise<{ loggedIn: boolean }> {
  if (typeof options.baseUrl === 'string') {
    process.env.AGENTCONNECT_LOCAL_BASE_URL = options.baseUrl;
  }
  if (typeof options.apiKey === 'string') {
    process.env.AGENTCONNECT_LOCAL_API_KEY = options.apiKey;
  }
  if (typeof options.model === 'string') {
    process.env.AGENTCONNECT_LOCAL_MODEL = options.model;
  }
  if (Array.isArray(options.models)) {
    process.env.AGENTCONNECT_LOCAL_MODELS = JSON.stringify(options.models.filter(Boolean));
  }
  const status = await getLocalStatus();
  return { loggedIn: status.installed };
}

interface ModelsResponse {
  data: Array<{ id: string }>;
}

export async function listLocalModels(): Promise<ModelInfo[]> {
  const base = getLocalBaseUrl();
  const res = await fetchJson<ModelsResponse>(`${base}/models`);
  if (!res.ok || !res.data || !Array.isArray(res.data.data)) return [];
  return res.data.data
    .map((entry) => ({ id: entry.id, provider: 'local' as const, displayName: entry.id }))
    .filter((entry) => entry.id);
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

export async function runLocalPrompt({
  prompt,
  model,
  onEvent,
}: RunPromptOptions): Promise<RunPromptResult> {
  const base = getLocalBaseUrl();
  const fallback = process.env.AGENTCONNECT_LOCAL_MODEL || '';
  const resolvedModel = resolveLocalModel(model, fallback);
  if (!resolvedModel) {
    onEvent({ type: 'error', message: 'Local provider model is not configured.' });
    return { sessionId: null };
  }

  const payload = {
    model: resolvedModel,
    messages: [{ role: 'user', content: prompt }],
    stream: false,
  };

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const apiKey = getLocalApiKey();
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const res = await fetchJson<ChatCompletionResponse>(`${base}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    onEvent({ type: 'error', message: 'Local provider request failed.' });
    return { sessionId: null };
  }

  const message = res.data?.choices?.[0]?.message?.content;
  const text = typeof message === 'string' ? message : '';
  if (text) {
    onEvent({ type: 'delta', text });
    onEvent({ type: 'final', text });
  } else {
    onEvent({ type: 'error', message: 'Local provider returned no content.' });
  }
  return { sessionId: null };
}
