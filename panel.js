/*
 * Helixis Copilot — panel.js
 * Auth, workspace data, tab switching, chat, reminders, actions, context.
 */

// ── STATE ─────────────────────────────────────────────

const state = {
  activeTab: 'workspace',
  messages:  [],        // [{ role, text, ts }]
  reminders: [],        // [{ id, title, note, due, done }]
  context:   null,      // { hostname, title, text, url, ts }
  workspace: null,      // fetched workspace data
  integrations: [],     // fetched integrations
  members: []           // fetched workspace members
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

// ── AUTH FLOW ─────────────────────────────────────────

async function checkAuth() {
  const token = await getValidToken();
  if (token) {
    showApp();
    await loadWorkspaceData(token);
  } else {
    showLogin();
  }
}

function showLogin() {
  document.getElementById('loginScreen').hidden = false;
  document.getElementById('appMain').hidden     = true;
}

function showApp() {
  document.getElementById('loginScreen').hidden = true;
  document.getElementById('appMain').hidden     = false;
}

async function handleLogin() {
  const email    = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const errEl    = document.getElementById('loginError');
  const btn      = document.getElementById('loginBtn');

  errEl.textContent = '';
  if (!email || !password) {
    errEl.textContent = 'Please enter email and password.';
    return;
  }

  btn.disabled    = true;
  btn.textContent = 'Signing in...';

  try {
    const session = await supabaseSignIn(email, password);
    await saveSession(session);
    showApp();
    await loadWorkspaceData(session.access_token);
  } catch (err) {
    errEl.textContent = err.message || 'Sign-in failed.';
  } finally {
    btn.disabled    = false;
    btn.textContent = 'Sign In';
  }
}

async function handleLogout() {
  await clearSession();
  state.workspace    = null;
  state.integrations = [];
  state.members      = [];
  showLogin();
}

// ── WORKSPACE DATA ────────────────────────────────────

async function loadWorkspaceData(token) {
  try {
    // Get user's workspace memberships
    const memberships = await supabaseQuery(token, 'workspace_members', {
      select: 'workspace_id,role',
      order: 'invited_at.desc'
    });

    if (memberships.length === 0) {
      renderWorkspaceEmpty();
      return;
    }

    // Use the most recent workspace
    const wsId = memberships[0].workspace_id;
    const userRole = memberships[0].role;

    // Fetch workspace, integrations, and members in parallel
    const [workspaces, integrations, members] = await Promise.all([
      supabaseQuery(token, 'workspaces', {
        filters: `id=eq.${wsId}`
      }),
      supabaseQuery(token, 'integrations', {
        filters: `workspace_id=eq.${wsId}`,
        order: 'created_at.desc'
      }),
      supabaseQuery(token, 'workspace_members', {
        filters: `workspace_id=eq.${wsId}`,
        order: 'invited_at.asc'
      })
    ]);

    state.workspace    = workspaces[0] || null;
    state.integrations = integrations;
    state.members      = members;

    if (state.workspace) {
      state.workspace._userRole = userRole;
    }

    renderWorkspace();
    updateHeaderWorkspace();
  } catch (err) {
    console.error('Failed to load workspace data:', err);
    renderWorkspaceError(err.message);
  }
}

// ── WORKSPACE RENDERING ──────────────────────────────

function updateHeaderWorkspace() {
  const el = document.getElementById('headerWorkspace');
  if (state.workspace) {
    el.textContent = state.workspace.name;
  } else {
    el.textContent = '';
  }
}

function renderWorkspace() {
  const ws = state.workspace;
  if (!ws) { renderWorkspaceEmpty(); return; }

  // Workspace card
  document.getElementById('wsName').textContent = ws.name;

  const meta = [];
  if (ws._userRole)              meta.push(capitalize(ws._userRole));
  if (ws.onboarding_completed_at) meta.push('Onboarding complete');
  else                            meta.push('Onboarding in progress');
  meta.push(`Created ${fmtDate(ws.created_at)}`);
  document.getElementById('wsMeta').textContent = meta.join(' · ');

  // Integrations
  const intContainer = document.getElementById('wsIntegrations');
  if (state.integrations.length === 0) {
    intContainer.innerHTML = '<div class="ws-empty">No integrations configured yet.</div>';
  } else {
    intContainer.innerHTML = '';
    state.integrations.forEach(intg => {
      const card = document.createElement('div');
      card.className = 'ws-integration-card';

      const statusClass = getStatusClass(intg.status);
      const statusLabel = capitalize(intg.status.replace('_', ' '));
      const providerLabel = capitalize(intg.provider);

      let details = `<span class="ws-int-env">${intg.environment}</span>`;
      if (intg.last_test_result?.success) {
        details += `<span class="ws-int-latency">${intg.last_test_result.latency_ms}ms</span>`;
      }

      card.innerHTML = `
        <div class="ws-int-header">
          <div class="ws-int-provider">${esc(providerLabel)}</div>
          <div class="ws-int-status ${statusClass}">${esc(statusLabel)}</div>
        </div>
        <div class="ws-int-details">${details}</div>
        ${intg.last_tested_at ? `<div class="ws-int-tested">Last tested ${fmtDate(intg.last_tested_at)}</div>` : ''}
      `;
      intContainer.appendChild(card);
    });
  }

  // Members
  const memContainer = document.getElementById('wsMembers');
  if (state.members.length === 0) {
    memContainer.innerHTML = '<div class="ws-empty">No team members.</div>';
  } else {
    memContainer.innerHTML = '';
    state.members.forEach(m => {
      const row = document.createElement('div');
      row.className = 'ws-member-row';
      row.innerHTML = `
        <div class="ws-member-avatar">${m.role === 'owner' ? '&#9733;' : '&#9679;'}</div>
        <div class="ws-member-info">
          <div class="ws-member-role">${esc(capitalize(m.role))}</div>
          <div class="ws-member-id">${esc(m.user_id.slice(0, 8))}...</div>
        </div>
        ${m.accepted_at ? '<div class="ws-member-status accepted">Joined</div>' : '<div class="ws-member-status pending">Pending</div>'}
      `;
      memContainer.appendChild(row);
    });
  }
}

function renderWorkspaceEmpty() {
  document.getElementById('wsName').textContent = 'No workspace';
  document.getElementById('wsMeta').textContent = 'Complete onboarding to set up your workspace.';
  document.getElementById('wsIntegrations').innerHTML = '<div class="ws-empty">No integrations.</div>';
  document.getElementById('wsMembers').innerHTML      = '<div class="ws-empty">No team members.</div>';
}

function renderWorkspaceError(msg) {
  document.getElementById('wsName').textContent = 'Error loading workspace';
  document.getElementById('wsMeta').textContent = msg;
}

function getStatusClass(status) {
  switch (status) {
    case 'connected': case 'locked': return 'status-connected';
    case 'error':                     return 'status-error';
    case 'pending':                   return 'status-pending';
    case 'change_requested':          return 'status-warning';
    default:                          return 'status-pending';
  }
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
      "AI responses are coming soon! For now, try the Actions tab to capture page context."
    );
  }, 500);
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
    pushMessage('assistant', `Captured context from ${ctx.hostname}.`);
  } catch (err) {
    switchTab('chat');
    pushMessage('assistant', `Could not capture page: ${err.message || err}`);
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
  btn.textContent = 'Capturing...';

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

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
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

function fmtDate(dateStr) {
  try {
    return new Date(dateStr).toLocaleString([], {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  } catch { return dateStr; }
}

// ── INIT ──────────────────────────────────────────────

async function init() {
  await loadState();

  // Login handlers
  document.getElementById('loginBtn').addEventListener('click', handleLogin);
  document.getElementById('loginPassword').addEventListener('keydown', e => {
    if (e.key === 'Enter') handleLogin();
  });
  document.getElementById('logoutBtn').addEventListener('click', handleLogout);

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

  // Check auth and load data or show login
  await checkAuth();

  // Restore last active tab (after auth check)
  switchTab(state.activeTab);
}

init();
