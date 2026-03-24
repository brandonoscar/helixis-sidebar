/*
 * Helixis Copilot — panel.js
 * Tab switching, chat with quick actions, webhook tasks, context — all local, no backend.
 */

// ── STATE ─────────────────────────────────────────────

const state = {
  activeTab:  'chat',
  messages:   [],        // [{ role, text, ts }]
  tasks:      [],        // [{ id, title, description, priority, status, source, entity, createdAt }]
  taskFilter: 'open',
  context:    null       // { hostname, title, text, url, ts }
};

// ── STORAGE ───────────────────────────────────────────

async function loadState() {
  const data = await chrome.storage.local.get(
    ['activeTab', 'messages', 'tasks', 'context']
  );
  if (data.activeTab) state.activeTab = data.activeTab;
  if (data.messages)  state.messages  = data.messages;
  if (data.tasks)     state.tasks     = data.tasks;
  if (data.context)   state.context   = data.context;
}

function saveKeys(...keys) {
  const patch = {};
  keys.forEach(k => { patch[k] = state[k]; });
  chrome.storage.local.set(patch);
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
  if (name === 'tasks')   renderTasks();
}

// ── CHAT ──────────────────────────────────────────────

function renderMessages() {
  const list  = document.getElementById('messageList');
  const empty = document.getElementById('chatEmpty');

  list.querySelectorAll('.message').forEach(m => m.remove());

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

function handleSend() {
  const input = document.getElementById('chatInput');
  const text  = input.value.trim();
  if (!text) return;

  input.value = '';
  pushMessage('user', text);

  // Stub assistant response — replace with real API call later
  setTimeout(() => {
    pushMessage(
      'assistant',
      "AI responses are coming soon! For now, try the quick actions above to capture page context."
    );
  }, 500);
}

// ── QUICK ACTIONS (in Chat) ───────────────────────────

async function handleReadContext() {
  const btn = document.getElementById('qaReadContext');
  btn.classList.add('loading');
  btn.disabled = true;

  try {
    const ctx = await captureContext();
    state.context = ctx;
    saveKeys('context');
    pushMessage('assistant', `Captured context from ${ctx.hostname}.\n\nPage: ${ctx.title}\nText length: ${ctx.text.length} chars`);
  } catch (err) {
    pushMessage('assistant', `Could not capture page: ${err.message || err}`);
  } finally {
    btn.classList.remove('loading');
    btn.disabled = false;
  }
}

// ── TASKS (webhook-driven) ────────────────────────────

function renderTasks() {
  const list = document.getElementById('tasksList');
  list.innerHTML = '';

  let filtered = state.tasks;
  if (state.taskFilter === 'open') {
    filtered = state.tasks.filter(t => t.status === 'open' || t.status === 'in_progress');
  }

  if (filtered.length === 0) {
    list.innerHTML = `
      <div class="tasks-empty">
        <div class="tasks-empty-icon">
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
            <path d="M8 14l4 4 8-8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <circle cx="14" cy="14" r="11" stroke="currentColor" stroke-width="1.5" opacity="0.3"/>
          </svg>
        </div>
        <div class="tasks-empty-title">No tasks yet</div>
        <div class="tasks-empty-desc">Tasks appear here automatically from your connected integrations like Buildium.</div>
      </div>`;
    return;
  }

  const frag = document.createDocumentFragment();
  filtered.forEach(t => frag.appendChild(buildTaskEl(t)));
  list.appendChild(frag);

  updateTaskBadge();
}

function buildTaskEl(task) {
  const card = document.createElement('div');
  card.className = `task-card task-${task.priority || 'medium'} ${task.status === 'done' ? 'done' : ''}`;
  card.dataset.id = task.id;

  const priorityLabel = {
    urgent: 'Urgent',
    high:   'High',
    medium: 'Med',
    low:    'Low'
  }[task.priority] || 'Med';

  const sourceLabel = task.source === 'webhook' ? 'Buildium' : (task.source || 'Integration');

  card.innerHTML = `
    <div class="task-priority-bar"></div>
    <div class="task-body">
      <div class="task-header-row">
        <span class="task-priority-tag">${esc(priorityLabel)}</span>
        <span class="task-source-tag">${esc(sourceLabel)}</span>
      </div>
      <div class="task-title">${esc(task.title)}</div>
      ${task.description ? `<div class="task-desc">${esc(task.description)}</div>` : ''}
      ${task.entity ? `<div class="task-entity">${esc(task.entity)}</div>` : ''}
      <div class="task-meta">${fmtTs(task.createdAt || task.created_at)}</div>
    </div>
    <div class="task-actions">
      <button class="task-action-btn check" title="Mark done">
        <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
          <path d="M1.5 5.5L4.5 8.5L9.5 2.5" stroke="currentColor" stroke-width="1.5"
                stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
      <button class="task-action-btn dismiss" title="Dismiss">
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path d="M1.5 1.5L8.5 8.5M8.5 1.5L1.5 8.5" stroke="currentColor" stroke-width="1.5"
                stroke-linecap="round"/>
        </svg>
      </button>
    </div>`;

  card.querySelector('.check').addEventListener('click', () => updateTask(task.id, 'done'));
  card.querySelector('.dismiss').addEventListener('click', () => updateTask(task.id, 'dismissed'));
  return card;
}

function updateTask(id, newStatus) {
  const t = state.tasks.find(x => x.id === id);
  if (t) {
    t.status = newStatus;
    saveKeys('tasks');
    renderTasks();
  }
}

function updateTaskBadge() {
  const count = state.tasks.filter(t => t.status === 'open' || t.status === 'in_progress').length;
  document.getElementById('taskBadge').textContent = count > 0 ? count : '';
}

// ── PAGE CONTEXT CAPTURE ──────────────────────────────

async function captureContext() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) throw new Error('No active tab');

  let payload;

  // Try content script message first (fast, reliable when injected)
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
    // Fallback: executeScript (works on pages loaded before extension install)
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

  try {
    const ctx = await captureContext();
    state.context = ctx;
    saveKeys('context');
    renderContext();
    pushMessage('assistant', `Context refreshed from ${ctx.hostname}.`);
  } catch (err) {
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

function fmtTs(ts) {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleString([], {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  } catch { return String(ts); }
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

  // Quick actions in chat
  document.getElementById('qaReadContext').addEventListener('click', handleReadContext);

  // Task filter chips
  document.querySelectorAll('.filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      state.taskFilter = chip.dataset.filter;
      renderTasks();
    });
  });

  // Tasks
  renderTasks();
  updateTaskBadge();

  // Context
  document.getElementById('refreshCtxBtn').addEventListener('click', handleRefreshContext);

  // Restore last active tab
  switchTab(state.activeTab);
}

init();
