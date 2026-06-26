/*
 * Helixis Copilot — panel.js
 *
 * Chat is wired to the AgenticHelixis backend (/agent/run SSE): every
 * turn auto-attaches the active tab's page context, streams the
 * orchestrator's tokens/tool activity live, and renders confirmation
 * cards the user can approve/deny. Reminders, actions, and context
 * tabs remain local.
 *
 * Slash commands: /new (fresh thread), /signout
 */

import { configured } from './config.js';
import { sendOtp, verifyOtp, getAccessToken, getSessionInfo, signOut } from './auth.js';
import { bootstrapCompany, runAgent, confirmAction } from './agent.js';

// ── STATE ─────────────────────────────────────────────

const state = {
  activeTab: 'chat',
  messages:  [],        // [{ role, text, ts, kind? }]  kind: 'activity' | 'error'
  reminders: [],        // [{ id, title, note, due, done }]
  context:   null,      // { hostname, title, text, url, ts }
  companyId: null,
  chatSessionId: null,
  signedIn:  false,
  running:   false,
  abort:     null,      // () => void — aborts the in-flight /agent/run stream
  finalizeTurn: null    // () => void — ends the current turn cleanly
};

// Send button swaps to a Stop control while a turn is in flight.
const SEND_ICON =
  '<svg width="14" height="14" viewBox="0 0 14 14" fill="none">' +
  '<path d="M2 7h10M8 3l4 4-4 4" stroke="currentColor" stroke-width="1.5" ' +
  'stroke-linecap="round" stroke-linejoin="round"/></svg>';
const STOP_ICON =
  '<svg width="14" height="14" viewBox="0 0 14 14" fill="none">' +
  '<rect x="3" y="3" width="8" height="8" rx="1.5" fill="currentColor"/></svg>';

// ── STORAGE ───────────────────────────────────────────

async function loadState() {
  const data = await chrome.storage.local.get(
    ['activeTab', 'messages', 'reminders', 'context', 'companyId', 'chatSessionId']
  );
  if (data.activeTab)     state.activeTab     = data.activeTab;
  if (data.messages)      state.messages      = data.messages;
  if (data.reminders)     state.reminders     = data.reminders;
  if (data.context)       state.context       = data.context;
  if (data.companyId)     state.companyId     = data.companyId;
  if (data.chatSessionId) state.chatSessionId = data.chatSessionId;
}

function saveKeys(...keys) {
  const patch = {};
  keys.forEach(k => { patch[k] = state[k]; });
  chrome.storage.local.set(patch);
}

// ── HEADER STATUS ─────────────────────────────────────

function setStatus(text, busy = false) {
  const pill = document.querySelector('.status-pill');
  if (!pill) return;
  pill.lastChild.textContent = ` ${text}`;
  pill.classList.toggle('busy', busy);
}

/** Toggle the send button between Send and Stop. */
function setSendMode(running) {
  const btn = document.getElementById('sendBtn');
  if (!btn) return;
  btn.innerHTML = running ? STOP_ICON : SEND_ICON;
  btn.title = running ? 'Stop' : 'Send';
  btn.classList.toggle('stopping', running);
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

// ── AUTH UI ───────────────────────────────────────────

function showAuthUI(visible) {
  document.getElementById('authCard').hidden = !visible;
  document.querySelector('.input-bar').style.display = visible ? 'none' : '';
}

async function refreshAuthState() {
  if (!configured()) {
    setStatus('Not configured');
    showAuthUI(true);
    document.getElementById('authTitle').textContent = 'Setup required';
    document.getElementById('authDesc').textContent =
      'Paste the Supabase anon key into config.js and reload the extension.';
    document.getElementById('authForm').hidden = true;
    return;
  }

  const token = await getAccessToken();
  state.signedIn = Boolean(token);

  if (state.signedIn) {
    showAuthUI(false);
    const info = await getSessionInfo();
    setStatus(info?.email || 'Ready');
    // Idempotent company provisioning — same call the web app makes.
    if (!state.companyId) {
      try {
        state.companyId = await bootstrapCompany();
        saveKeys('companyId');
      } catch (err) {
        pushMessage('assistant', `⚠ Could not reach Helixis: ${err.message}`, 'error');
      }
    }
  } else {
    showAuthUI(true);
    setStatus('Signed out');
  }
}

async function handleAuthSend() {
  const email = document.getElementById('authEmail').value.trim();
  const errEl = document.getElementById('authError');
  errEl.textContent = '';
  if (!email.includes('@')) { errEl.textContent = 'Enter a valid email.'; return; }

  const btn = document.getElementById('authSend');
  btn.disabled = true;
  btn.textContent = 'Sending…';
  try {
    await sendOtp(email);
    document.getElementById('authCodeRow').hidden = false;
    document.getElementById('authCode').focus();
    btn.textContent = 'Resend code';
  } catch (err) {
    errEl.textContent = err.message;
    btn.textContent = 'Email me a code';
  } finally {
    btn.disabled = false;
  }
}

async function handleAuthVerify() {
  const email = document.getElementById('authEmail').value.trim();
  const code  = document.getElementById('authCode').value.trim();
  const errEl = document.getElementById('authError');
  errEl.textContent = '';

  const btn = document.getElementById('authVerify');
  btn.disabled = true;
  try {
    await verifyOtp(email, code);
    await refreshAuthState();
    pushMessage('assistant', '✓ Signed in. Ask me anything about your properties.');
  } catch (err) {
    errEl.textContent = err.message;
  } finally {
    btn.disabled = false;
  }
}

// ── CHAT ──────────────────────────────────────────────

function renderMessages() {
  const list  = document.getElementById('messageList');
  const empty = document.getElementById('chatEmpty');

  list.querySelectorAll('.message, .activity-line, .confirm-card').forEach(m => m.remove());

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
  if (msg.kind === 'activity') {
    const line = document.createElement('div');
    line.className = 'activity-line';
    line.textContent = msg.text;
    return line;
  }
  const row    = document.createElement('div');
  row.className = `message message-${msg.role}`;
  const bubble = document.createElement('div');
  bubble.className  = 'message-bubble' + (msg.kind === 'error' ? ' message-error' : '');
  bubble.textContent = msg.text;
  row.appendChild(bubble);
  return row;
}

function appendEl(el) {
  const list  = document.getElementById('messageList');
  document.getElementById('chatEmpty').style.display = 'none';
  list.appendChild(el);
  list.scrollTop = list.scrollHeight;
}

function pushMessage(role, text, kind) {
  const msg = { role, text, ts: Date.now(), ...(kind ? { kind } : {}) };
  state.messages.push(msg);
  saveKeys('messages');
  appendEl(buildMsgEl(msg));
}

// ── CONFIRMATION CARDS ────────────────────────────────

/**
 * Normalize the backend's two confirmation event shapes into one.
 * The /agent/run chat path emits `confirm_gate` (PR #75):
 *   {confirm_id, summary, payload_preview:{action,items}, confirm_label, cancel_label}
 * The older `confirm` shape is {confirm_id, action, title, details, items}.
 * Both resolve via POST /agent/confirm {confirm_id, approved}.
 */
function normalizeConfirm(type, d) {
  if (type === 'confirm_gate') {
    const preview = d.payload_preview || {};
    return {
      confirm_id: d.confirm_id,
      title: d.summary || preview.action || 'Approve this action?',
      details: '',
      items: preview.items || [],
      approveLabel: d.confirm_label || 'Approve',
      denyLabel: d.cancel_label || 'Deny'
    };
  }
  return {
    confirm_id: d.confirm_id,
    title: d.title || d.action || 'Approve this action?',
    details: d.details || '',
    items: d.items || [],
    approveLabel: 'Approve',
    denyLabel: 'Deny'
  };
}

function renderConfirmCard(c) {
  if (!c.confirm_id) return; // nothing to resolve against — ignore

  const card = document.createElement('div');
  card.className = 'confirm-card';

  const title = document.createElement('div');
  title.className = 'confirm-title';
  title.textContent = c.title;
  card.appendChild(title);

  if (c.details) {
    const details = document.createElement('div');
    details.className = 'confirm-details';
    details.textContent = c.details;
    card.appendChild(details);
  }

  (c.items || []).forEach(item => {
    const li = document.createElement('div');
    li.className = 'confirm-item';
    li.textContent = `• ${item}`;
    card.appendChild(li);
  });

  const row = document.createElement('div');
  row.className = 'confirm-btn-row';

  const resolve = async (approved) => {
    row.querySelectorAll('button').forEach(b => { b.disabled = true; });
    try {
      const res = await confirmAction(c.confirm_id, approved);
      const outcome =
        res.status === 'approved' ? '✓ Approved' :
        res.status === 'denied'   ? '✗ Denied'   :
        `⚠ ${res.status} — the action did not run`;
      card.remove();
      pushMessage('assistant', `${outcome}: ${c.title}`, 'activity');
    } catch (err) {
      pushMessage('assistant', `⚠ Could not send your answer: ${err.message}`, 'error');
      row.querySelectorAll('button').forEach(b => { b.disabled = false; });
    }
  };

  const approve = document.createElement('button');
  approve.className = 'confirm-btn approve';
  approve.textContent = c.approveLabel;
  approve.addEventListener('click', () => resolve(true));

  const deny = document.createElement('button');
  deny.className = 'confirm-btn deny';
  deny.textContent = c.denyLabel;
  deny.addEventListener('click', () => resolve(false));

  row.appendChild(approve);
  row.appendChild(deny);
  card.appendChild(row);
  appendEl(card);
}

// ── AGENT TURN ────────────────────────────────────────

async function handleSend() {
  const input = document.getElementById('chatInput');
  const text  = input.value.trim();
  if (!text || state.running) return;
  input.value = '';

  // Slash commands
  if (text === '/new') {
    state.messages = [];
    state.chatSessionId = null;
    saveKeys('messages', 'chatSessionId');
    renderMessages();
    return;
  }
  if (text === '/signout') {
    await signOut();
    state.companyId = null;
    saveKeys('companyId');
    await refreshAuthState();
    return;
  }

  if (!state.signedIn || !state.companyId) {
    pushMessage('assistant', 'Sign in first — your Helixis account connects the copilot to your data.', 'error');
    return;
  }

  pushMessage('user', text);
  state.running = true;
  setStatus('Working…', true);
  setSendMode(true);

  // Best-effort page context: what the user is looking at right now.
  // Failure (chrome:// pages, no permission) is silent — the turn
  // still runs, just without the context block.
  let context = {};
  try {
    const ctx = await captureContext();
    state.context = ctx;
    saveKeys('context');
    context = {
      current_page_url:   ctx.url,
      current_page_title: ctx.title,
      current_page_text:  (ctx.text || '').slice(0, 4000)
    };
  } catch { /* no usable tab — proceed without context */ }

  if (!state.chatSessionId) {
    state.chatSessionId = crypto.randomUUID();
    saveKeys('chatSessionId');
  }

  // Live assistant bubble that tokens stream into.
  let liveText = '';
  let liveEl = null;
  let sawTurnTokens = false;   // assistant_message_token supersedes raw token
  const ensureLive = () => {
    if (liveEl) return;
    liveEl = buildMsgEl({ role: 'assistant', text: '' });
    appendEl(liveEl);
  };
  const appendToken = (content) => {
    if (!content) return;
    ensureLive();
    liveText += content;
    liveEl.querySelector('.message-bubble').textContent = liveText;
    const list = document.getElementById('messageList');
    list.scrollTop = list.scrollHeight;
  };
  const finalize = (fallback) => {
    if (!state.running) return;
    state.running = false;
    state.abort = null;
    state.finalizeTurn = null;
    if (liveText) {
      state.messages.push({ role: 'assistant', text: liveText, ts: Date.now() });
      saveKeys('messages');
    } else if (fallback) {
      if (liveEl) liveEl.remove();
      pushMessage('assistant', fallback);
    } else if (liveEl) {
      liveEl.remove();
    }
    setStatus(state.signedIn ? 'Ready' : 'Signed out');
    setSendMode(false);
  };
  // Exposed so the Stop button can end this turn from outside handleSend.
  state.finalizeTurn = finalize;

  const controller = await runAgent({
    task: text,
    companyId: state.companyId,
    sessionId: state.chatSessionId,
    context,
    onEvent: (ev) => {
      const d = ev.data || {};
      switch (ev.type) {
        case 'assistant_message_token':
          sawTurnTokens = true;
          appendToken(d.content);
          break;
        case 'token':
          if (!sawTurnTokens) appendToken(d.content);
          break;
        case 'thinking':
          setStatus('Thinking…', true);
          break;
        case 'narration':
          if (d.content) pushMessage('assistant', d.content, 'activity');
          break;
        case 'tool_start':
          setStatus('Running tools…', true);
          pushMessage('assistant', `⚙ ${d.tool}${d.description ? ` — ${d.description}` : ''}`, 'activity');
          break;
        case 'browser_action':
          if (d.description) pushMessage('assistant', `🌐 ${d.description}`, 'activity');
          break;
        case 'confirm_gate':
        case 'confirm':
          renderConfirmCard(normalizeConfirm(ev.type, d));
          break;
        case 'error':
          pushMessage('assistant', `⚠ ${d.message || 'Something went wrong.'}`, 'error');
          if (!d.recoverable) finalize();
          break;
        case 'done':
          finalize(typeof d.summary === 'string' ? d.summary : undefined);
          break;
        default:
          break; // todo_update, memory_recall, files, chips — not rendered v1
      }
    },
    onError: (err) => {
      pushMessage('assistant', `⚠ ${err.message}`, 'error');
      finalize();
    },
    onDone: () => finalize()
  });

  // Capture the abort handle so Stop can cancel the in-flight stream.
  // Aborting makes the reader throw AbortError (swallowed in agent.js), so
  // neither onDone nor onError fires — handleStop calls finalize itself.
  state.abort = () => { try { controller.abort(); } catch { /* already done */ } };
}

function handleStop() {
  if (!state.running) return;
  state.abort?.();
  pushMessage('assistant', 'Stopped.', 'activity');
  state.finalizeTurn?.();
}

/** Send button: starts a turn, or stops the in-flight one. */
function handleSendClick() {
  if (state.running) handleStop();
  else handleSend();
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

// ── ACTIONS TAB ───────────────────────────────────────

async function handleReadContext() {
  const card = document.getElementById('actionReadCtx');
  card.style.pointerEvents = 'none';
  card.style.opacity = '0.55';

  try {
    const ctx = await captureContext();
    state.context = ctx;
    saveKeys('context');
    switchTab('chat');
    pushMessage('assistant', `✓ Captured context from ${ctx.hostname}.`, 'activity');
  } catch (err) {
    switchTab('chat');
    pushMessage('assistant', `⚠ Could not capture page: ${err.message || err}`, 'error');
  } finally {
    card.style.pointerEvents = '';
    card.style.opacity = '';
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

  try {
    const ctx = await captureContext();
    state.context = ctx;
    saveKeys('context');
    renderContext();
  } catch (err) {
    pushMessage('assistant', `⚠ Refresh failed: ${err.message || err}`, 'error');
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

  // Auth
  await refreshAuthState();
  document.getElementById('authSend').addEventListener('click', handleAuthSend);
  document.getElementById('authVerify').addEventListener('click', handleAuthVerify);
  document.getElementById('authCode').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); handleAuthVerify(); }
  });

  // Chat
  renderMessages();
  document.getElementById('sendBtn').addEventListener('click', handleSendClick);
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
