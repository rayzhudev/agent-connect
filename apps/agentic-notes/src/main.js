import { AgentConnect } from '@agentconnect/sdk';
import { defineAgentConnectComponents } from '@agentconnect/ui';

defineAgentConnectComponents();

const agentConnectEl = document.querySelector('#agentConnect');
const noteEditorEl = document.querySelector('#noteEditor');
const editorMetaEl = document.querySelector('#editorMeta');
const chatWindowEl = document.querySelector('#chatWindow');
const chatEmptyEl = document.querySelector('#chatEmpty');
const userInputEl = document.querySelector('#userInput');
const sendButtonEl = document.querySelector('#send');
const newSessionEl = document.querySelector('#newSession');
const contextMeterEl = document.querySelector('#contextMeter');
const quickActionsEl = document.querySelector('#quickActions');
const errorBannerEl = document.querySelector('#errorBanner');
const errorTextEl = document.querySelector('#errorText');

const AGENT_ICON = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
  <path stroke-linecap="round" stroke-linejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
</svg>`;

const USER_ICON = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
  <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
</svg>`;

const TYPING_INDICATOR = `<div class="typing-indicator"><span></span><span></span><span></span></div>`;

customElements.whenDefined('agentconnect-connect').then(() => {
  if (!agentConnectEl) return;
  if (agentConnectEl.shadowRoot?.querySelector('button')) return;
  if (typeof agentConnectEl.render === 'function') {
    agentConnectEl.render();
  }
});

const MAX_CONTEXT_CHARS = 14000;

const quickActions = [
  {
    label: 'Review for clarity',
    prompt: 'Review this draft for clarity and flow. Highlight the top 5 improvements.',
  },
  {
    label: 'Summarize',
    prompt: 'Summarize the main points in 5 bullets.',
  },
  {
    label: 'Key ideas',
    prompt: 'Extract key ideas and any open questions.',
  },
  {
    label: 'Rewrite tighter',
    prompt: 'Rewrite this to be tighter and more direct while keeping the tone.',
  },
];

let messages = [];
let clientPromise = null;
let session = null;
let sessionModel = null;
let sessionReasoningEffort = null;
let selectedModel = 'default';
let selectedReasoningEffort = null;
let chatBusy = false;

function getClient() {
  if (!clientPromise) {
    clientPromise = AgentConnect.connect();
  }
  return clientPromise;
}

function setError(message) {
  if (!errorBannerEl) return;
  if (!message) {
    errorBannerEl.hidden = true;
    if (errorTextEl) errorTextEl.textContent = '';
    return;
  }
  if (errorTextEl) errorTextEl.textContent = message;
  errorBannerEl.hidden = false;
}

function updateBusyState() {
  if (sendButtonEl) sendButtonEl.disabled = chatBusy;
  if (newSessionEl) newSessionEl.disabled = chatBusy;
  if (userInputEl) userInputEl.disabled = chatBusy;
  if (sendButtonEl) sendButtonEl.textContent = chatBusy ? 'Thinking...' : 'Send';
}

function normalizeText(raw) {
  if (!raw) return '';
  return raw.replace(/\r\n/g, '\n').replace(/\t/g, '  ').trim();
}

function getEditorContent() {
  return normalizeText(noteEditorEl?.value || '');
}

function buildContext() {
  const text = getEditorContent();
  if (!text) return { context: '', used: 0, total: 0, truncated: false };
  const context = text.slice(0, MAX_CONTEXT_CHARS);
  return {
    context,
    used: context.length,
    total: text.length,
    truncated: text.length > context.length,
  };
}

function buildPrompt(userPrompt) {
  const { context, used, total, truncated } = buildContext();
  if (!context) {
    return [
      'You are Agentic Notes, an editorial assistant.',
      'The user has not added any draft text yet.',
      'Ask them to paste or write text in the editor before answering.',
      '',
      `User request: ${userPrompt}`,
    ].join('\n');
  }
  return [
    'You are Agentic Notes, an editorial assistant.',
    'Respond using only the draft provided.',
    'If asked to rewrite, return a revised version with a short summary of changes.',
    'If asked to review, focus on clarity, structure, and tone.',
    truncated
      ? `The draft is truncated to the first ${used} of ${total} characters.`
      : 'The draft is complete.',
    '',
    'Draft:',
    context,
    '',
    `User request: ${userPrompt}`,
  ].join('\n');
}

function renderQuickActions() {
  if (!quickActionsEl) return;
  quickActionsEl.innerHTML = '';
  for (const action of quickActions) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.textContent = action.label;
    chip.addEventListener('click', () => {
      if (!userInputEl) return;
      userInputEl.value = action.prompt;
      userInputEl.focus();
    });
    quickActionsEl.appendChild(chip);
  }
}

function renderMessages() {
  if (!chatWindowEl) return;

  const existingEmpty = chatWindowEl.querySelector('.chat-empty');
  chatWindowEl.innerHTML = '';

  if (messages.length === 0) {
    if (chatEmptyEl) {
      chatWindowEl.appendChild(chatEmptyEl);
    } else if (existingEmpty) {
      chatWindowEl.appendChild(existingEmpty);
    }
    return;
  }

  for (const msg of messages) {
    const wrap = document.createElement('div');
    wrap.className = `message ${msg.role}`;
    wrap.dataset.id = msg.id;

    const avatar = document.createElement('div');
    avatar.className = 'message-avatar';
    avatar.innerHTML = msg.role === 'user' ? USER_ICON : AGENT_ICON;

    const content = document.createElement('div');
    content.className = 'message-content';

    const bubble = document.createElement('div');
    bubble.className = 'bubble';

    if (msg.text) {
      bubble.textContent = msg.text;
    } else if (msg.role === 'assistant') {
      bubble.innerHTML = TYPING_INDICATOR;
    }

    content.appendChild(bubble);
    wrap.append(avatar, content);
    chatWindowEl.appendChild(wrap);
  }
  chatWindowEl.scrollTop = chatWindowEl.scrollHeight;
}

function addMessage(role, text) {
  const id =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const message = { id, role, text };
  messages.push(message);
  renderMessages();
  return message;
}

function removeMessage(id) {
  messages = messages.filter((entry) => entry.id !== id);
  renderMessages();
}

function updateMessage(id, text) {
  const target = chatWindowEl?.querySelector(`[data-id="${id}"] .bubble`);
  if (target) target.textContent = text;
  const msg = messages.find((entry) => entry.id === id);
  if (msg) msg.text = text;
  if (chatWindowEl) chatWindowEl.scrollTop = chatWindowEl.scrollHeight;
}

function updateEditorMeta() {
  const text = getEditorContent();
  const words = text ? text.split(/\s+/).filter(Boolean).length : 0;
  if (editorMetaEl) {
    editorMetaEl.textContent = `${text.length.toLocaleString()} chars · ${words.toLocaleString()} words`;
  }
  if (contextMeterEl) {
    const used = Math.min(text.length, MAX_CONTEXT_CHARS);
    const statusText = text.length === 0 ? 'Ready' : `${used.toLocaleString()} chars`;
    contextMeterEl.innerHTML = `<span class="helper-dot"></span><span>${statusText}</span>`;
  }
}

async function ensureSession() {
  if (!selectedModel) return null;
  if (
    session &&
    sessionModel === selectedModel &&
    sessionReasoningEffort === selectedReasoningEffort
  ) {
    return session;
  }
  if (session) {
    await session.close().catch(() => {});
  }
  const client = await getClient();
  session = await client.sessions.create({
    model: selectedModel,
    reasoningEffort: selectedReasoningEffort || undefined,
  });
  sessionModel = selectedModel;
  sessionReasoningEffort = selectedReasoningEffort;
  return session;
}

async function sendPrompt(rawPrompt) {
  const trimmed = rawPrompt.trim();
  if (!trimmed || chatBusy) return;
  const prompt = buildPrompt(trimmed);

  setError('');
  addMessage('user', trimmed);
  addMessage('assistant', '');
  const assistantId = messages[messages.length - 1].id;

  chatBusy = true;
  updateBusyState();

  let activeSession = null;
  try {
    activeSession = await ensureSession();
  } catch (err) {
    removeMessage(assistantId);
    setError(err?.message || 'Failed to start session.');
    chatBusy = false;
    updateBusyState();
    return;
  }

  if (!activeSession) {
    removeMessage(assistantId);
    setError('Connect an agent to start.');
    chatBusy = false;
    updateBusyState();
    return;
  }

  let buffer = '';
  const unsubs = [];
  const cleanup = () => {
    while (unsubs.length) unsubs.pop()();
  };

  unsubs.push(
    activeSession.on('delta', (ev) => {
      buffer += ev.text || '';
      updateMessage(assistantId, buffer || '');
    })
  );

  unsubs.push(
    activeSession.on('final', (ev) => {
      if (ev.text) buffer = ev.text;
      updateMessage(assistantId, buffer || '');
      chatBusy = false;
      updateBusyState();
      cleanup();
    })
  );

  unsubs.push(
    activeSession.on('error', (ev) => {
      if (!buffer) {
        removeMessage(assistantId);
      }
      setError(ev.message || 'Agent error.');
      chatBusy = false;
      updateBusyState();
      cleanup();
    })
  );

  activeSession.send(prompt).catch((err) => {
    if (!buffer) {
      removeMessage(assistantId);
    }
    setError(err?.message || 'Failed to send prompt.');
    chatBusy = false;
    updateBusyState();
    cleanup();
  });
}

function resetSession() {
  if (session) {
    session.close().catch(() => {});
  }
  session = null;
  sessionModel = null;
  sessionReasoningEffort = null;
  messages = [];
  renderMessages();
  setError('');
}

agentConnectEl?.addEventListener('agentconnect:connected', (event) => {
  const detail = event.detail || {};
  selectedModel = detail.model || selectedModel;
  selectedReasoningEffort = detail.reasoningEffort || null;
  resetSession();
});

agentConnectEl?.addEventListener('agentconnect:selection-changed', (event) => {
  const detail = event.detail || {};
  selectedModel = detail.model || selectedModel;
  selectedReasoningEffort = detail.reasoningEffort || null;
  resetSession();
});

agentConnectEl?.addEventListener('agentconnect:disconnected', () => {
  resetSession();
});

sendButtonEl?.addEventListener('click', () => {
  if (!userInputEl) return;
  const value = userInputEl.value;
  userInputEl.value = '';
  void sendPrompt(value);
});

userInputEl?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    sendButtonEl?.click();
  }
});

newSessionEl?.addEventListener('click', () => {
  resetSession();
});

noteEditorEl?.addEventListener('input', () => {
  updateEditorMeta();
});

renderQuickActions();
renderMessages();
updateEditorMeta();
updateBusyState();
