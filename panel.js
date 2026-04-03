/*
 * Helixis Copilot — panel.js
 * Agentic sidebar: dynamic status, streaming responses, tool-use visualization.
 */

// ── STATE ─────────────────────────────────────────────

const state = {
  activeTab: 'chat',
  messages:  [],        // [{ role, text, ts }]
  reminders: [],        // [{ id, title, note, due, done }]
  context:   null       // { hostname, title, text, url, ts }
};

// ── STORAGE ───────────────────────────────────────────

async function loadState() {
  const data = await chrome.storage.local.get(
    ['activeTab', 'messages', 'reminders', 'context']
  );
  if (data.activeTab) state.activeTab = data.activeTab;
  if (data.messages)  state.messages  = data.messages;
  if (data.reminders) state.reminders = data.reminders;
  if (data.context)   state.context   = data.context;
}

function saveKeys(...keys) {
  const patch = {};
  keys.forEach(k => { patch[k] = state[k]; });
  chrome.storage.local.set(patch);
}

// ── AGENT STATUS ──────────────────────────────────────

const statusConfig = {
  ready:     { label: 'Ready',           css: '' },
  thinking:  { label: 'Thinking…',       css: 'status-thinking' },
  reading:   { label: 'Reading page…',   css: 'status-reading' },
  searching: { label: 'Searching…',      css: 'status-searching' },
  writing:   { label: 'Composing…',      css: 'status-writing' },
  analyzing: { label: 'Analyzing…',      css: 'status-thinking' },
  acting:    { label: 'Taking action…',  css: 'status-searching' },
};

function setStatus(key) {
  const pill  = document.getElementById('statusPill');
  const label = document.getElementById('statusLabel');
  const cfg   = statusConfig[key] || statusConfig.ready;

  // Remove all status classes
  pill.className = 'status-pill' + (cfg.css ? ` ${cfg.css}` : '');
  label.textContent = cfg.label;
}

// ── TAB SWITCHING ─────────────────────────────────────

function switchTab(name) {
  state.activeTab = name;
  saveKeys('activeTab');

  document.querySelectorAll('.tab').forEach(t =>
    t.classList.toggle('active', t.dataset.tab === name)
  );
  document.querySelectorAll('.view').forEach(v =>
    v.classList.toggle('active', v.id === `view-${name}`)
  );

  if (name === 'context') renderContext();
}

// ── CHAT ──────────────────────────────────────────────

function renderMessages() {
  const list  = document.getElementById('messageList');
  const empty = document.getElementById('chatEmpty');

  list.querySelectorAll('.message, .tool-use-block').forEach(m => m.remove());

  if (state.messages.length === 0) {
    empty.style.display = '';
    return;
  }

  empty.style.display = 'none';
  const frag = document.createDocumentFragment();
  state.messages.forEach(m => frag.appendChild(buildMsgEl(m)));
  list.appendChild(frag);
  list.scrollTop = list.scrollHeight;
}

function buildMsgEl(msg) {
  const row    = document.createElement('div');
  row.className = `message message-${msg.role}`;
  row.style.animation = 'none'; // skip animation for restored messages
  const bubble = document.createElement('div');
  bubble.className  = 'message-bubble';
  bubble.textContent = msg.text;
  row.appendChild(bubble);
  return row;
}

function pushMessage(role, text) {
  const msg = { role, text, ts: Date.now() };
  state.messages.push(msg);
  saveKeys('messages');

  const list  = document.getElementById('messageList');
  const empty = document.getElementById('chatEmpty');
  empty.style.display = 'none';

  list.appendChild(buildMsgEl(msg));
  list.scrollTop = list.scrollHeight;
}

// ── TOOL-USE BLOCKS ───────────────────────────────────

function showToolUse(label, text) {
  const list = document.getElementById('messageList');
  const block = document.createElement('div');
  block.className = 'tool-use-block active';
  block.innerHTML = `
    <div class="tool-use-icon spinning">
      <svg viewBox="0 0 16 16" fill="none">
        <path d="M8 1.5v3M8 11.5v3M1.5 8h3M11.5 8h3M3.4 3.4l2.1 2.1M10.5 10.5l2.1 2.1M3.4 12.6l2.1-2.1M10.5 5.5l2.1-2.1"
              stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
      </svg>
    </div>
    <div class="tool-use-content">
      <div class="tool-use-label">${esc(label)}</div>
      <div class="tool-use-text">${esc(text)}</div>
    </div>`;

  list.appendChild(block);
  list.scrollTop = list.scrollHeight;
  return block;
}

function completeToolUse(block, result) {
  block.classList.remove('active');
  block.classList.add('done');
  const icon = block.querySelector('.tool-use-icon');
  icon.classList.remove('spinning');
  icon.innerHTML = `
    <svg viewBox="0 0 16 16" fill="none">
      <path d="M3 8.5L6.5 12L13 4" stroke="var(--success)" stroke-width="1.5"
            stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;

  if (result) {
    const res = document.createElement('div');
    res.className = 'tool-use-result';
    res.textContent = result;
    block.querySelector('.tool-use-content').appendChild(res);
  }

  const list = document.getElementById('messageList');
  list.scrollTop = list.scrollHeight;
}

// ── STREAMING TEXT ─────────────────────────────────────

function streamMessage(text, speed = 18) {
  return new Promise(resolve => {
    const list = document.getElementById('messageList');
    const row = document.createElement('div');
    row.className = 'message message-assistant';
    const bubble = document.createElement('div');
    bubble.className = 'message-bubble streaming';
    bubble.textContent = '';
    row.appendChild(bubble);
    list.appendChild(row);
    list.scrollTop = list.scrollHeight;

    let i = 0;
    const interval = setInterval(() => {
      // Stream in chunks of 1-3 chars for natural feel
      const chunk = Math.min(i + 1 + Math.floor(Math.random() * 2), text.length);
      bubble.textContent = text.slice(0, chunk);
      i = chunk;
      list.scrollTop = list.scrollHeight;

      if (i >= text.length) {
        clearInterval(interval);
        bubble.classList.remove('streaming');

        // Save to state
        const msg = { role: 'assistant', text, ts: Date.now() };
        state.messages.push(msg);
        saveKeys('messages');

        resolve();
      }
    }, speed);
  });
}

// ── AGENTIC RESPONSE ENGINE ───────────────────────────

const wait = ms => new Promise(r => setTimeout(r, ms));

// Fabricated agentic response sequences
function getAgentPlan(userText) {
  const lower = userText.toLowerCase();

  if (lower.includes('summarize') || lower.includes('summary') || lower.includes('tldr')) {
    return {
      steps: [
        { status: 'reading',   tool: 'Page Reader',    text: 'Extracting page content…',     delay: 1200, result: 'Captured 2,847 words' },
        { status: 'analyzing', tool: 'Text Analyzer',   text: 'Identifying key themes…',      delay: 1400, result: 'Found 5 main topics' },
        { status: 'writing',   tool: 'Compose',         text: 'Drafting summary…',            delay: 800 },
      ],
      response: state.context
        ? `Here's what I found on ${state.context.hostname}:\n\nThis page covers ${state.context.title || 'the current content'}. The main points are about the structure and content visible on the page. I've analyzed the key sections and identified the primary themes.\n\nWant me to go deeper on any specific section?`
        : `I'd need to read the page first. Try "Read Page Context" from the Actions tab, then ask me to summarize again.`,
    };
  }

  if (lower.includes('help') || lower.includes('what can you do') || lower.includes('how do')) {
    return {
      steps: [
        { status: 'thinking', tool: 'Reasoning', text: 'Understanding your question…', delay: 900 },
      ],
      response: `I can help you with:\n\n• Summarize any page you're viewing\n• Read and analyze page context\n• Draft replies and responses\n• Set reminders for follow-ups\n• Search and extract specific info\n\nTry capturing a page first (Actions tab), then ask me anything about it.`,
    };
  }

  if (lower.includes('remind') || lower.includes('remember') || lower.includes('don\'t forget')) {
    return {
      steps: [
        { status: 'thinking',  tool: 'Intent Parser', text: 'Extracting reminder details…', delay: 800, result: 'Parsed title + time' },
        { status: 'acting',    tool: 'Reminder API',  text: 'Creating reminder…',           delay: 600, result: 'Saved to reminders' },
      ],
      response: `Done — I've noted that for you. You can view and manage it in the Reminders tab.`,
    };
  }

  if (lower.includes('search') || lower.includes('find') || lower.includes('look for') || lower.includes('where')) {
    return {
      steps: [
        { status: 'thinking',   tool: 'Query Planner', text: 'Breaking down search…',        delay: 700 },
        { status: 'searching',  tool: 'Page Search',   text: 'Scanning page content…',       delay: 1500, result: 'Scanned 3 sections' },
        { status: 'analyzing',  tool: 'Relevance',     text: 'Ranking results…',             delay: 600, result: '2 matches found' },
      ],
      response: state.context
        ? `I searched through the content from ${state.context.hostname}. Based on what's available on the page, I found relevant sections that match your query. The page content discusses topics related to your search.\n\nWant me to extract specific details?`
        : `I don't have any page context loaded yet. Capture a page first (Actions tab) and I'll search through it for you.`,
    };
  }

  if (lower.includes('draft') || lower.includes('write') || lower.includes('compose') || lower.includes('reply')) {
    return {
      steps: [
        { status: 'reading',   tool: 'Context Loader', text: 'Loading page context…',       delay: 800, result: 'Context loaded' },
        { status: 'analyzing', tool: 'Tone Detector',  text: 'Analyzing tone and format…',  delay: 1000, result: 'Professional, concise' },
        { status: 'writing',   tool: 'Draft Engine',   text: 'Composing response…',         delay: 1600 },
      ],
      response: `Here's a draft based on the current context:\n\n"Thank you for sharing this. I've reviewed the key points and have a few thoughts on how we could move forward. Let me know if you'd like to discuss further."\n\nWant me to adjust the tone or add more detail?`,
    };
  }

  // Default: generic thinking response
  return {
    steps: [
      { status: 'thinking',  tool: 'Reasoning',    text: 'Processing your request…',     delay: 1000 },
      { status: 'analyzing', tool: 'Context Check', text: 'Checking available context…', delay: 800, result: state.context ? 'Page context available' : 'No page context' },
    ],
    response: state.context
      ? `I'm looking at content from ${state.context.hostname}. I can help you summarize it, search for specific info, draft a reply, or set reminders. What would you like to do?`
      : `I'm ready to help. For the best experience, capture a page first using the Actions tab — then I can analyze, summarize, search, and draft based on what you're viewing.`,
  };
}

async function runAgentResponse(userText) {
  const plan = getAgentPlan(userText);
  const input = document.getElementById('chatInput');
  const sendBtn = document.getElementById('sendBtn');
  input.disabled = true;
  sendBtn.disabled = true;

  for (const step of plan.steps) {
    setStatus(step.status);
    const block = showToolUse(step.tool, step.text);
    await wait(step.delay);
    completeToolUse(block, step.result || null);
    await wait(200);
  }

  setStatus('writing');
  await wait(300);
  await streamMessage(plan.response);
  setStatus('ready');

  input.disabled = false;
  sendBtn.disabled = false;
  input.focus();
}

// ── SEND HANDLER ──────────────────────────────────────

function handleSend() {
  const input = document.getElementById('chatInput');
  const text  = input.value.trim();
  if (!text) return;

  input.value = '';
  pushMessage('user', text);
  runAgentResponse(text);
}

// ── REMINDERS ─────────────────────────────────────────

function renderReminders() {
  const list = document.getElementById('remindersList');
  list.innerHTML = '';

  if (state.reminders.length === 0) {
    list.innerHTML = '<div class="reminders-empty">No reminders yet — press + to add one.</div>';
  } else {
    const frag = document.createDocumentFragment();
    state.reminders.forEach(r => frag.appendChild(buildReminderEl(r)));
    list.appendChild(frag);
  }

  updateBadge();
}

function buildReminderEl(r) {
  const now     = Date.now();
  const dueSoon = r.due && !r.done && (new Date(r.due).getTime() - now) < 86_400_000;
  const card    = document.createElement('div');
  card.className  = 'reminder-card' + (r.done ? ' done' : '');
  card.dataset.id = r.id;

  const titleHtml =
    esc(r.title) + (dueSoon ? '<span class="due-soon-badge">Soon</span>' : '');

  card.innerHTML = `
    <div class="reminder-content">
      <div class="reminder-title">${titleHtml}</div>
      ${r.note ? `<div class="reminder-note">${esc(r.note)}</div>` : ''}
      ${r.due  ? `<div class="reminder-due">${fmtDue(r.due)}</div>` : ''}
    </div>
    <div class="reminder-btns">
      <button class="reminder-btn check" title="${r.done ? 'Mark undone' : 'Mark done'}">
        <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
          <path d="M1.5 5.5L4.5 8.5L9.5 2.5" stroke="currentColor" stroke-width="1.5"
                stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
      <button class="reminder-btn del" title="Delete">
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path d="M1.5 1.5L8.5 8.5M8.5 1.5L1.5 8.5" stroke="currentColor" stroke-width="1.5"
                stroke-linecap="round"/>
        </svg>
      </button>
    </div>`;

  card.querySelector('.check').addEventListener('click', () => toggleReminder(r.id));
  card.querySelector('.del').addEventListener('click',   () => deleteReminder(r.id));
  return card;
}

function toggleReminder(id) {
  const r = state.reminders.find(x => x.id === id);
  if (r) { r.done = !r.done; saveKeys('reminders'); renderReminders(); }
}

function deleteReminder(id) {
  state.reminders = state.reminders.filter(x => x.id !== id);
  saveKeys('reminders');
  renderReminders();
}

function updateBadge() {
  const count = state.reminders.filter(r => !r.done).length;
  document.getElementById('reminderBadge').textContent = count > 0 ? count : '';
}

function showForm(visible) {
  const form = document.getElementById('reminderForm');
  form.hidden = !visible;
  if (visible) {
    document.getElementById('reminderTitle').value = '';
    document.getElementById('reminderNote').value  = '';
    document.getElementById('reminderDue').value   = '';
    document.getElementById('reminderTitle').focus();
  }
}

function saveReminder() {
  const title = document.getElementById('reminderTitle').value.trim();
  if (!title) { document.getElementById('reminderTitle').focus(); return; }

  state.reminders.unshift({
    id:    Date.now().toString(),
    title,
    note:  document.getElementById('reminderNote').value.trim(),
    due:   document.getElementById('reminderDue').value,
    done:  false
  });

  saveKeys('reminders');
  showForm(false);
  renderReminders();
}

// ── PAGE CONTEXT CAPTURE ──────────────────────────────

async function captureContext() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) throw new Error('No active tab');

  let payload;

  try {
    payload = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout')), 1500);
      chrome.tabs.sendMessage(tab.id, { type: 'HELIXIS_GET_CONTEXT' }, res => {
        clearTimeout(timer);
        if (chrome.runtime.lastError || !res) reject(chrome.runtime.lastError ?? new Error('no response'));
        else resolve(res);
      });
    });
  } catch {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => ({
        text:  (document.body?.innerText ?? '').slice(0, 5000),
        title: document.title,
        url:   location.href
      })
    });
    payload = result?.result;
  }

  let hostname = '(unknown)';
  try { hostname = new URL(tab.url).hostname; } catch { hostname = tab.url ?? ''; }

  return {
    hostname,
    title: payload?.title || tab.title || '',
    text:  payload?.text  || '',
    url:   payload?.url   || tab.url  || '',
    ts:    Date.now()
  };
}

// ── ACTIONS TAB (AGENTIC) ────────────────────────────

async function handleReadContext() {
  const card = document.getElementById('actionReadCtx');
  card.style.pointerEvents = 'none';
  card.style.opacity = '0.55';

  switchTab('chat');
  const input = document.getElementById('chatInput');
  const sendBtn = document.getElementById('sendBtn');
  input.disabled = true;
  sendBtn.disabled = true;

  setStatus('reading');
  const block1 = showToolUse('Page Reader', 'Connecting to active tab…');
  await wait(600);

  try {
    const ctx = await captureContext();
    completeToolUse(block1, `Connected to ${ctx.hostname}`);
    await wait(300);

    setStatus('analyzing');
    const block2 = showToolUse('Content Extractor', `Extracting text from ${ctx.hostname}…`);
    await wait(1000);
    const wordCount = ctx.text.split(/\s+/).filter(Boolean).length;
    completeToolUse(block2, `${wordCount.toLocaleString()} words captured`);
    await wait(300);

    state.context = ctx;
    saveKeys('context');

    setStatus('writing');
    await wait(200);
    await streamMessage(`Got it — I've captured the page from ${ctx.hostname}. ${wordCount.toLocaleString()} words loaded into context.\n\nI can now summarize, search, or draft a reply based on this page. What would you like to do?`);
    setStatus('ready');
  } catch (err) {
    completeToolUse(block1, `Failed: ${err.message || err}`);
    setStatus('ready');
    pushMessage('assistant', `Could not capture page: ${err.message || err}`);
  } finally {
    card.style.pointerEvents = '';
    card.style.opacity = '';
    input.disabled = false;
    sendBtn.disabled = false;
  }
}

// ── CONTEXT TAB ───────────────────────────────────────

function renderContext() {
  const ctx = state.context;
  document.getElementById('ctxHostname').textContent  = ctx?.hostname || '—';
  document.getElementById('ctxTitle').textContent     = ctx?.title    || '—';
  document.getElementById('ctxTimestamp').textContent = ctx?.ts ? fmtTs(ctx.ts) : '—';
  document.getElementById('ctxText').value            = ctx?.text     || '';
}

async function handleRefreshContext() {
  const btn = document.getElementById('refreshCtxBtn');
  btn.disabled    = true;
  btn.textContent = 'Capturing…';

  setStatus('reading');

  try {
    const ctx = await captureContext();
    state.context = ctx;
    saveKeys('context');
    renderContext();
    setStatus('ready');
    pushMessage('assistant', `Context refreshed from ${ctx.hostname}.`);
  } catch (err) {
    setStatus('ready');
    pushMessage('assistant', `Refresh failed: ${err.message || err}`);
  } finally {
    btn.disabled   = false;
    btn.innerHTML  = `
      <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
        <path d="M11 6.5A4.5 4.5 0 1 1 6.5 2a4.5 4.5 0 0 1 3.18 1.32M11 2v3H8"
              stroke="currentColor" stroke-width="1.3"
              stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      Refresh Context`;
  }
}

// ── UTILS ─────────────────────────────────────────────

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtDue(due) {
  try {
    return new Date(due).toLocaleString([], {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  } catch { return due; }
}

function fmtTs(ts) {
  try {
    return new Date(ts).toLocaleString([], {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  } catch { return ts; }
}

// ── INIT ──────────────────────────────────────────────

async function init() {
  await loadState();

  // Tab bar
  document.querySelectorAll('.tab').forEach(tab =>
    tab.addEventListener('click', () => switchTab(tab.dataset.tab))
  );

  // Chat
  renderMessages();
  document.getElementById('sendBtn').addEventListener('click', handleSend);
  document.getElementById('chatInput').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  });

  // Reminders
  renderReminders();
  document.getElementById('addReminderBtn').addEventListener('click', () => showForm(true));
  document.getElementById('reminderSave').addEventListener('click', saveReminder);
  document.getElementById('reminderCancel').addEventListener('click', () => showForm(false));

  // Actions
  const readCtxCard = document.getElementById('actionReadCtx');
  readCtxCard.addEventListener('click', handleReadContext);
  readCtxCard.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleReadContext(); }
  });

  // Context
  document.getElementById('refreshCtxBtn').addEventListener('click', handleRefreshContext);

  // Restore last active tab
  switchTab(state.activeTab);
}

init();
