import { AgentConnect } from '@agentconnect/sdk';
import { defineAgentConnectComponents } from '@agentconnect/ui';

defineAgentConnectComponents();

const inputEl = document.querySelector('#input');
const outputEl = document.querySelector('#output');
const statusEl = document.querySelector('#status');
const wordCountEl = document.querySelector('#wordCount');
const modeChipsEl = document.querySelector('#modeChips');
const modeSelectEl = document.querySelector('#modeSelect');
const toneSelectEl = document.querySelector('#toneSelect');
const audienceSelectEl = document.querySelector('#audienceSelect');
const lengthSelectEl = document.querySelector('#lengthSelect');
const formatSelectEl = document.querySelector('#formatSelect');
const goalInputEl = document.querySelector('#goalInput');
const runButton = document.querySelector('#run');
const newSessionButton = document.querySelector('#newSession');
const clearButton = document.querySelector('#clear');
const copyButton = document.querySelector('#copy');
const applyButton = document.querySelector('#apply');
const historyListEl = document.querySelector('#historyList');
const agentConnectEl = document.querySelector('#agentConnect');

customElements.whenDefined('agentconnect-connect').then(() => {
  if (!agentConnectEl) return;
  if (agentConnectEl.shadowRoot?.querySelector('button')) return;
  if (typeof agentConnectEl.render === 'function') {
    agentConnectEl.render();
  }
});

const MODES = [
  {
    id: 'rewrite',
    label: 'Rewrite',
    prompt: 'Rewrite the draft so it reads clean, confident, and easy to scan.',
  },
  {
    id: 'summarize',
    label: 'Summarize',
    prompt: 'Summarize the draft into clear bullet points.',
    outputHint: 'Return 3-5 bullets.',
  },
  {
    id: 'shorten',
    label: 'Shorten',
    prompt: 'Shorten the draft while keeping the core meaning intact.',
  },
  {
    id: 'expand',
    label: 'Expand',
    prompt: 'Expand the draft with more detail, examples, and specificity.',
  },
  {
    id: 'polish',
    label: 'Polish',
    prompt: 'Polish the draft for grammar, flow, and consistency.',
  },
  {
    id: 'headlines',
    label: 'Headlines',
    prompt: 'Generate punchy headline options for the draft.',
    outputHint: 'Return 5 options.',
  },
  {
    id: 'cta',
    label: 'CTA',
    prompt: 'Create calls-to-action that match the draft.',
    outputHint: 'Return 5 options.',
  },
  {
    id: 'outline',
    label: 'Outline',
    prompt: 'Provide a structured outline to improve the draft.',
  },
];

const TONES = ['Clear', 'Friendly', 'Confident', 'Persuasive', 'Professional', 'Playful', 'Direct'];

const AUDIENCES = [
  'General audience',
  'Customers',
  'Founders',
  'Executives',
  'Creators',
  'Students',
  'Technical peers',
];

const LENGTHS = ['Short', 'Medium', 'Long', 'Tight & punchy'];

const FORMATS = [
  'Plain text',
  'Bullet list',
  'Email',
  'Social post',
  'Blog intro',
  'Product description',
  'Press note',
];

let clientPromise = null;
let session = null;
let sessionModel = null;
let sessionReasoningEffort = null;
let selectedModel = 'claude-opus';
let selectedReasoningEffort = null;
let selectedMode = MODES[0]?.id ?? 'rewrite';
let activeOutput = '';
let isBusy = false;
let runFinalized = false;
let sessionUnsubs = [];
let history = [];
const HISTORY_KEY = 'agentconnect-app-history';

function setStatus(text) {
  if (statusEl) statusEl.textContent = text;
}

function setOutput(text) {
  if (!outputEl) return;
  outputEl.textContent = text;
}

function setBusy(nextBusy) {
  isBusy = nextBusy;
  if (runButton) runButton.disabled = nextBusy;
  if (newSessionButton) newSessionButton.disabled = nextBusy;
  if (runButton) runButton.textContent = nextBusy ? 'Generating...' : 'Generate';
}

function updateWordCount() {
  if (!wordCountEl || !inputEl) return;
  const text = inputEl.value.trim();
  const words = text ? text.split(/\s+/).length : 0;
  wordCountEl.textContent = `${words} words`;
}

function fillSelect(select, options, value) {
  if (!select) return;
  select.innerHTML = '';
  for (const option of options) {
    const entry = document.createElement('option');
    entry.value = option.value ?? option;
    entry.textContent = option.label ?? option;
    select.appendChild(entry);
  }
  if (value) select.value = value;
}

function renderModeChips() {
  if (!modeChipsEl) return;
  modeChipsEl.innerHTML = '';
  const featured = MODES.slice(0, 6);
  for (const mode of featured) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.textContent = mode.label;
    chip.dataset.mode = mode.id;
    chip.addEventListener('click', () => {
      selectedMode = mode.id;
      if (modeSelectEl) modeSelectEl.value = mode.id;
      updateModeChips();
    });
    modeChipsEl.appendChild(chip);
  }
  updateModeChips();
}

function updateModeChips() {
  if (!modeChipsEl) return;
  for (const chip of modeChipsEl.querySelectorAll('.chip')) {
    chip.classList.toggle('active', chip.dataset.mode === selectedMode);
  }
}

function buildPrompt() {
  const draft = inputEl?.value?.trim() ?? '';
  const mode = MODES.find((entry) => entry.id === selectedMode) ?? MODES[0];
  const tone = toneSelectEl?.value ?? TONES[0];
  const audience = audienceSelectEl?.value ?? AUDIENCES[0];
  const length = lengthSelectEl?.value ?? LENGTHS[0];
  const format = formatSelectEl?.value ?? FORMATS[0];
  const goal = goalInputEl?.value?.trim();

  const parts = [
    'You are a writing assistant focused on clarity and utility.',
    `Task: ${mode.prompt}`,
    `Tone: ${tone}.`,
    `Audience: ${audience}.`,
    `Length: ${length}.`,
    `Format: ${format}.`,
  ];

  if (goal) parts.push(`Goal: ${goal}.`);
  if (mode.outputHint) parts.push(mode.outputHint);
  parts.push('Return only the final output.');
  parts.push('');
  parts.push('Draft:');
  parts.push(draft);

  return parts.join('\n');
}

function formatRunError(err) {
  const message = err?.message ? String(err.message) : '';
  if (message.includes('Failed to connect') || message.includes('timed out')) {
    return 'AgentConnect host is not reachable. Start it with `agentconnect dev --app . --ui http://localhost:5173`.';
  }
  if (message.includes('AC_ERR_NOT_INSTALLED')) {
    return 'Provider CLI is not installed yet. Use the Login button to install it, then try again.';
  }
  if (message.includes('AC_ERR_UNSUPPORTED')) {
    return 'Selected provider is not supported by the dev host.';
  }
  if (message) {
    return `AgentConnect error: ${message}`;
  }
  return 'AgentConnect error: Unknown error.';
}

async function getClient() {
  if (!clientPromise) {
    setStatus('Connecting...');
    clientPromise = AgentConnect.connect()
      .then(async (client) => {
        await client.hello();
        return client;
      })
      .catch((err) => {
        clientPromise = null;
        throw err;
      });
  }
  return clientPromise;
}

async function checkHost() {
  await getClient();
}

function releaseSession() {
  for (const unsub of sessionUnsubs) {
    try {
      unsub();
    } catch {
      // ignore cleanup errors
    }
  }
  sessionUnsubs = [];
  session = null;
  sessionModel = null;
  sessionReasoningEffort = null;
}

async function ensureSession() {
  if (
    session &&
    sessionModel === selectedModel &&
    sessionReasoningEffort === selectedReasoningEffort
  ) {
    return session;
  }
  if (session) {
    await session.close().catch(() => undefined);
    releaseSession();
  }
  const client = await getClient();
  session = await client.sessions.create({
    model: selectedModel,
    reasoningEffort: selectedReasoningEffort || undefined,
    system: 'You help refine and improve written communication.',
  });
  sessionModel = selectedModel;
  sessionReasoningEffort = selectedReasoningEffort;
  sessionUnsubs = [
    session.on('delta', (event) => {
      if (event.type !== 'delta') return;
      activeOutput += event.text;
      setOutput(activeOutput);
    }),
    session.on('final', (event) => {
      if (event.type !== 'final') return;
      activeOutput = event.text;
      setOutput(activeOutput);
      finalizeRun();
    }),
    session.on('message', (event) => {
      if (event.type !== 'message') return;
      if (event.role !== 'assistant') return;
      activeOutput = event.content || '';
      setOutput(activeOutput);
      finalizeRun();
    }),
    session.on('error', (event) => {
      if (event.type !== 'error') return;
      setOutput(`Error: ${event.message}`);
      finalizeRun();
    }),
  ];
  return session;
}

function finalizeRun() {
  if (runFinalized) return;
  runFinalized = true;
  setBusy(false);
  setStatus('Idle');
  if (activeOutput.trim()) {
    pushHistory({
      output: activeOutput,
      mode: selectedMode,
      tone: toneSelectEl?.value ?? '',
      length: lengthSelectEl?.value ?? '',
      timestamp: new Date().toLocaleTimeString(),
      input: inputEl?.value ?? '',
    });
  }
}

function pushHistory(entry) {
  history = [entry, ...history].slice(0, 6);
  saveHistory();
  renderHistory();
}

function loadHistory() {
  if (typeof localStorage === 'undefined') return;
  try {
    const saved = localStorage.getItem(HISTORY_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) {
        history = parsed;
      }
    }
  } catch {
    history = [];
  }
}

function saveHistory() {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  } catch {
    // ignore storage errors
  }
}

function renderHistory() {
  if (!historyListEl) return;
  historyListEl.innerHTML = '';
  if (!history.length) {
    const empty = document.createElement('div');
    empty.className = 'history-item';
    empty.textContent = 'No history yet.';
    historyListEl.appendChild(empty);
    return;
  }
  for (const item of history) {
    const row = document.createElement('div');
    row.className = 'history-item';
    const title = document.createElement('strong');
    const modeLabel = MODES.find((mode) => mode.id === item.mode)?.label ?? item.mode;
    title.textContent = `${modeLabel} - ${item.timestamp}`;
    const summary = document.createElement('span');
    summary.textContent = item.output.slice(0, 140);
    row.append(title, summary);
    row.addEventListener('click', () => {
      setOutput(item.output);
      activeOutput = item.output;
      if (inputEl) inputEl.value = item.input;
      updateWordCount();
    });
    historyListEl.appendChild(row);
  }
}

async function handleRun() {
  if (isBusy) return;
  const draft = inputEl?.value?.trim() ?? '';
  if (!draft) {
    setOutput('Paste a draft to work on first.');
    return;
  }
  setBusy(true);
  runFinalized = false;
  activeOutput = '';
  setOutput('');
  setStatus('Working...');
  try {
    const current = await ensureSession();
    await current.send(buildPrompt());
  } catch (err) {
    runFinalized = true;
    setBusy(false);
    setStatus('Error');
    setOutput(formatRunError(err));
  }
}

async function handleCopy() {
  const text = outputEl?.textContent ?? '';
  if (!text.trim()) return;
  try {
    await navigator.clipboard.writeText(text);
    setStatus('Copied');
    setTimeout(() => setStatus('Idle'), 1200);
  } catch {
    setStatus('Copy failed');
  }
}

function handleApply() {
  if (!inputEl || !outputEl) return;
  const text = outputEl.textContent ?? '';
  if (!text.trim()) return;
  inputEl.value = text;
  updateWordCount();
}

function handleNewSession() {
  releaseSession();
  activeOutput = '';
  setOutput('Session reset. Ready for a new prompt.');
  setStatus('Idle');
}

function handleClear() {
  if (!inputEl) return;
  inputEl.value = '';
  updateWordCount();
}

function bindEvents() {
  inputEl?.addEventListener('input', updateWordCount);
  modeSelectEl?.addEventListener('change', (event) => {
    selectedMode = event.target.value;
    updateModeChips();
  });
  runButton?.addEventListener('click', handleRun);
  newSessionButton?.addEventListener('click', handleNewSession);
  clearButton?.addEventListener('click', handleClear);
  copyButton?.addEventListener('click', handleCopy);
  applyButton?.addEventListener('click', handleApply);
  const handleSelection = (event) => {
    const next = event.detail?.model;
    if (!next) return;
    selectedModel = next;
    selectedReasoningEffort = event.detail?.reasoningEffort || null;
    releaseSession();
  };
  agentConnectEl?.addEventListener('agentconnect:connected', handleSelection);
  agentConnectEl?.addEventListener('agentconnect:selection-changed', handleSelection);
  agentConnectEl?.addEventListener('agentconnect:disconnected', () => {
    selectedModel = 'claude-opus';
    selectedReasoningEffort = null;
    releaseSession();
    setStatus('Disconnected');
  });
}

function init() {
  fillSelect(
    modeSelectEl,
    MODES.map((mode) => ({ value: mode.id, label: mode.label })),
    selectedMode
  );
  fillSelect(toneSelectEl, TONES);
  fillSelect(audienceSelectEl, AUDIENCES);
  fillSelect(lengthSelectEl, LENGTHS);
  fillSelect(formatSelectEl, FORMATS);
  renderModeChips();
  loadHistory();
  renderHistory();
  updateWordCount();
  bindEvents();
  checkHost()
    .then(() => setStatus('Idle'))
    .catch(() => setStatus('Host unavailable'));
}

init();
