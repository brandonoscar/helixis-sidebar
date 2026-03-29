/*
 * Helixis Copilot — panel.js
 * Auth, workspace data, chat (Gemini), activity (webhook events),
 * screen capture, auto-context, actions, context.
 * All workspace references are dynamic — no hardcoded company data.
 */

// ── STATE ─────────────────────────────────────────────

const state = {
  activeTab: 'workspace',
  messages:  [],
  events:    [],
  context:   null,
  workspace: null,
  integrations: [],
  members: [],
  buildiumData: null,
  pendingScreenshot: null,
};

// ── STORAGE ───────────────────────────────────────────

async function loadState() {
  const data = await chrome.storage.local.get(['activeTab', 'messages', 'context']);
  if (data.activeTab) state.activeTab = data.activeTab;
  if (data.messages)  state.messages  = data.messages;
  if (data.context)   state.context   = data.context;
}

function saveKeys(...keys) {
  const patch = {};
  keys.forEach(k => { patch[k] = state[k]; });
  chrome.storage.local.set(patch);
}

// ── STATUS INDICATOR ─────────────────────────────────

function setStatus(level, label) {
  const pill = document.getElementById('statusPill');
  pill.className = 'status-pill status-' + level;
  document.getElementById('statusLabel').textContent = label;
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
  state.buildiumData = null;
  state.events       = [];
  if (eventPollTimer) clearInterval(eventPollTimer);
  showLogin();
}

// ── WORKSPACE DATA ────────────────────────────────────

async function loadWorkspaceData(token) {
  setStatus('warn', 'Loading...');
  try {
    const memberships = await supabaseQuery(token, 'workspace_members', {
      select: 'workspace_id,role',
      order: 'invited_at.desc'
    });

    if (memberships.length === 0) { renderWorkspaceEmpty(); setStatus('error', 'No workspace'); return; }

    const wsId = memberships[0].workspace_id;
    const userRole = memberships[0].role;

    const [workspaces, integrations, members] = await Promise.all([
      supabaseQuery(token, 'workspaces', { filters: `id=eq.${wsId}` }),
      supabaseQuery(token, 'integrations', { filters: `workspace_id=eq.${wsId}`, order: 'created_at.desc' }),
      supabaseQuery(token, 'workspace_members', { filters: `workspace_id=eq.${wsId}`, order: 'invited_at.asc' })
    ]);

    state.workspace    = workspaces[0] || null;
    state.integrations = integrations;
    state.members      = members;
    if (state.workspace) state.workspace._userRole = userRole;

    renderWorkspace();
    updateHeaderWorkspace();
    setStatus('ok', 'Connected');

    // Load Buildium data if integration exists
    const hasBuildium = integrations.some(i => i.provider === 'buildium' && (i.status === 'connected' || i.status === 'locked'));
    if (hasBuildium && state.workspace) {
      try {
        state.buildiumData = await fetchAllBuildiumData(state.workspace.id);
      } catch (e) {
        console.warn('Helixis: Buildium data fetch failed:', e.message);
      }
    }

    // Start loading events and polling
    if (state.workspace?.slug) {
      await loadEvents();
      startEventPolling();
    }
  } catch (err) {
    console.error('Failed to load workspace data:', err);
    renderWorkspaceError(err.message);
    setStatus('error', 'Error');
  }
}

// ── WORKSPACE RENDERING ──────────────────────────────

function updateHeaderWorkspace() {
  document.getElementById('headerWorkspace').textContent = state.workspace ? state.workspace.name : '';
}

function renderWorkspace() {
  const ws = state.workspace;
  if (!ws) { renderWorkspaceEmpty(); return; }

  document.getElementById('wsName').textContent = ws.name;
  const meta = [];
  if (ws._userRole) meta.push(capitalize(ws._userRole));
  if (ws.onboarding_completed_at) meta.push('Onboarding complete');
  else meta.push('Onboarding in progress');
  meta.push(`Created ${fmtDate(ws.created_at)}`);
  document.getElementById('wsMeta').textContent = meta.join(' · ');

  renderIntegrations();
  renderMembers();
}

function renderIntegrations() {
  const container = document.getElementById('wsIntegrations');
  if (state.integrations.length === 0) {
    container.innerHTML = '<div class="ws-empty">No integrations configured yet.</div>';
    return;
  }
  container.innerHTML = '';
  state.integrations.forEach(intg => {
    const card = document.createElement('div');
    card.className = 'ws-integration-card';
    const statusClass = getStatusClass(intg.status);
    const statusLabel = capitalize(intg.status.replace(/_/g, ' '));
    let details = `<span class="ws-int-env">${esc(intg.environment)}</span>`;
    if (intg.last_test_result?.success) details += `<span class="ws-int-latency">${intg.last_test_result.latency_ms}ms</span>`;
    if (intg.last_test_result?.message) details += `<span class="ws-int-msg">${esc(intg.last_test_result.message)}</span>`;
    card.innerHTML = `
      <div class="ws-int-header">
        <div class="ws-int-provider">${esc(capitalize(intg.provider))}</div>
        <div class="ws-int-status ${statusClass}">${esc(statusLabel)}</div>
      </div>
      <div class="ws-int-details">${details}</div>
      ${intg.last_tested_at ? `<div class="ws-int-tested">Last tested ${fmtDate(intg.last_tested_at)}</div>` : ''}`;
    container.appendChild(card);
  });
}

function renderMembers() {
  const container = document.getElementById('wsMembers');
  if (state.members.length === 0) {
    container.innerHTML = '<div class="ws-empty">No team members.</div>';
    return;
  }
  container.innerHTML = '';
  state.members.forEach(m => {
    const row = document.createElement('div');
    row.className = 'ws-member-row';
    row.innerHTML = `
      <div class="ws-member-avatar">${m.role === 'owner' ? '&#9733;' : '&#9679;'}</div>
      <div class="ws-member-info">
        <div class="ws-member-role">${esc(capitalize(m.role))}</div>
        <div class="ws-member-id">${esc(m.user_id.slice(0, 8))}...</div>
      </div>
      ${m.accepted_at ? '<div class="ws-member-status accepted">Joined</div>' : '<div class="ws-member-status pending">Pending</div>'}`;
    container.appendChild(row);
  });
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
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === `view-${name}`));
  if (name === 'context') renderContext();
}

// ── EVENTS (webhook activity) ─────────────────────────

let eventPollTimer = null;

async function loadEvents() {
  if (!state.workspace?.slug) return;
  try {
    const events = await fetchWebhookEvents(state.workspace.slug, 50);
    state.events = Array.isArray(events) ? events : [];
    renderEvents();
  } catch (err) {
    console.warn('Helixis: failed to load events:', err.message);
  }
}

function startEventPolling(intervalMs = 30000) {
  if (eventPollTimer) clearInterval(eventPollTimer);
  eventPollTimer = setInterval(loadEvents, intervalMs);
}

function renderEvents() {
  const list = document.getElementById('eventsList');
  list.innerHTML = '';
  if (!state.events || state.events.length === 0) {
    list.innerHTML = '<div class="reminders-empty">No events yet. Events will appear here automatically when activity occurs in your integrations.</div>';
  } else {
    const frag = document.createDocumentFragment();
    state.events.forEach(e => frag.appendChild(buildEventEl(e)));
    list.appendChild(frag);
  }
  updateBadge();
}

function buildEventEl(evt) {
  const card = document.createElement('div');
  card.className = 'reminder-card';

  const enriched = evt.payload?._enriched || {};
  const title = enriched.title || formatEventName(evt.event_name);
  const operation = getOperationLabel(evt.event_name);
  const description = getEventDescription(evt, enriched);
  const timeAgo = fmtTimeAgo(evt.event_datetime);
  const icon = getEventIcon(evt.event_name);
  const statusBadge = enriched.status ? `<span class="event-status-badge">${esc(enriched.status)}</span>` : '';
  const priorityBadge = enriched.priority ? `<span class="event-priority-badge">${esc(enriched.priority)}</span>` : '';

  card.innerHTML = `
    <div class="event-icon">${icon}</div>
    <div class="reminder-content">
      <div class="event-header">
        <div class="reminder-title">${esc(title)}</div>
        <span class="event-operation">${esc(operation)}</span>
      </div>
      ${description ? `<div class="event-description">${esc(description)}</div>` : ''}
      <div class="event-meta">
        ${statusBadge}${priorityBadge}
        <span class="reminder-due">${esc(timeAgo)}</span>
      </div>
    </div>
    <button class="reminder-btn del dismiss-btn" title="Dismiss">
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M1.5 1.5L8.5 8.5M8.5 1.5L1.5 8.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
    </button>`;
  card.querySelector('.dismiss-btn').addEventListener('click', () => handleDismiss(evt.id));
  return card;
}

function getOperationLabel(name) {
  if (!name || !name.includes('.')) return '';
  return name.split('.')[1] || '';
}

function getEventDescription(evt, enriched) {
  const parts = [];
  if (enriched.description) parts.push(enriched.description.slice(0, 120));
  if (enriched.address) parts.push(enriched.address);
  if (enriched.category) parts.push(enriched.category);
  if (enriched.dueDate) parts.push(`Due: ${new Date(enriched.dueDate).toLocaleDateString()}`);
  if (enriched.email) parts.push(enriched.email);
  if (enriched.rent) parts.push(`Rent: $${enriched.rent}`);
  if (parts.length === 0) {
    const p = evt.payload || {};
    if (p.Subject || p.Title) parts.push((p.Subject || p.Title).slice(0, 120));
    if (p.Description) parts.push(p.Description.slice(0, 120));
    if (parts.length === 0 && evt.entity_type && evt.entity_id) {
      parts.push(`${evt.entity_type} #${evt.entity_id}`);
    }
  }
  return parts.join(' · ');
}

function formatEventName(name) {
  if (!name) return 'Unknown Event';
  if (name.includes('.')) {
    const [entity, operation] = name.split('.');
    const readableEntity = entity.replace(/([a-z])([A-Z])/g, '$1 $2');
    return `${readableEntity} ${operation}`;
  }
  return name.replace(/([A-Z])/g, ' $1').replace(/[._]/g, ' ').replace(/^\s+/, '').trim();
}

function getEventIcon(name) {
  const n = (name || '').toLowerCase();
  if (n.includes('lease'))       return '📋';
  if (n.includes('maintenance') || n.includes('workorder')) return '🔧';
  if (n.includes('payment'))     return '💰';
  if (n.includes('tenant'))      return '👤';
  if (n.includes('rental') || n.includes('property')) return '🏠';
  if (n.includes('association')) return '🏢';
  if (n.includes('vendor'))      return '🛠️';
  if (n.includes('task'))        return '✅';
  if (n.includes('bill'))        return '🧾';
  if (n.includes('applicant'))   return '📝';
  return '🔔';
}

async function handleDismiss(eventId) {
  if (!state.workspace?.slug) return;
  const ok = await dismissWebhookEvent(state.workspace.slug, eventId);
  if (ok) {
    state.events = state.events.filter(e => e.id !== eventId);
    renderEvents();
  }
}

function updateBadge() {
  const count = (state.events || []).filter(e => !e.dismissed).length;
  document.getElementById('activityBadge').textContent = count > 0 ? count : '';
}

// ── CHAT ──────────────────────────────────────────────

function renderMessages() {
  const list  = document.getElementById('messageList');
  const empty = document.getElementById('chatEmpty');
  list.querySelectorAll('.message').forEach(m => m.remove());
  if (state.messages.length === 0) { empty.style.display = ''; return; }
  empty.style.display = 'none';
  const frag = document.createDocumentFragment();
  state.messages.forEach(m => frag.appendChild(buildMsgEl(m)));
  list.appendChild(frag);
  list.scrollTop = list.scrollHeight;
}

function buildMsgEl(msg) {
  const row = document.createElement('div');
  row.className = `message message-${msg.role}`;
  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
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

async function handleSend() {
  const input = document.getElementById('chatInput');
  const text  = input.value.trim();
  if (!text) return;
  input.value = '';

  const screenshot = state.pendingScreenshot;
  clearScreenshot();

  pushMessage('user', text);

  // Auto-capture page context silently
  try {
    const ctx = await captureContext();
    state.context = ctx;
    saveKeys('context');
  } catch (e) {
    console.warn('Helixis: auto-context failed (ok):', e.message);
  }

  // Show typing indicator
  const typingEl = document.createElement('div');
  typingEl.className = 'message message-assistant typing-indicator';
  typingEl.innerHTML = '<div class="message-bubble"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>';
  const list = document.getElementById('messageList');
  list.appendChild(typingEl);
  list.scrollTop = list.scrollHeight;

  try {
    if (!state.workspace) throw new Error('No workspace loaded');

    const systemPrompt = buildSystemPrompt(
      state.workspace, state.integrations, state.context, state.buildiumData
    );

    const recent = state.messages.slice(-20).map(m => ({
      role: m.role === 'user' ? 'user' : 'model',
      parts: [{ text: m.text }]
    }));

    const reply = await sendToGemini(recent, systemPrompt, screenshot);
    typingEl.remove();
    pushMessage('assistant', reply);
  } catch (err) {
    typingEl.remove();
    pushMessage('assistant', `Sorry, I couldn't respond: ${err.message}`);
  }
}

// ── SCREEN CAPTURE ───────────────────────────────────

async function captureScreen() {
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'jpeg', quality: 75 });
    return dataUrl;
  } catch {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: 'HELIXIS_CAPTURE_TAB' }, res => {
        if (res?.success) resolve(res.dataUrl);
        else reject(new Error(res?.error || 'Capture failed'));
      });
    });
  }
}

async function handleCaptureScreen() {
  const btn = document.getElementById('captureScreenBtn');
  btn.classList.add('capturing');
  try {
    const dataUrl = await captureScreen();
    state.pendingScreenshot = dataUrl;
    document.getElementById('screenshotIndicator').style.display = '';
  } catch (e) {
    console.warn('Helixis: capture failed:', e.message);
  } finally {
    btn.classList.remove('capturing');
  }
}

function clearScreenshot() {
  state.pendingScreenshot = null;
  document.getElementById('screenshotIndicator').style.display = 'none';
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
      func: () => ({ text: (document.body?.innerText ?? '').slice(0, 5000), title: document.title, url: location.href })
    });
    payload = result?.result;
  }
  let hostname = '(unknown)';
  try { hostname = new URL(tab.url).hostname; } catch { hostname = tab.url ?? ''; }
  return { hostname, title: payload?.title || tab.title || '', text: payload?.text || '', url: payload?.url || tab.url || '', ts: Date.now() };
}

async function handleReadContext() {
  const card = document.getElementById('actionReadCtx');
  card.style.pointerEvents = 'none'; card.style.opacity = '0.55';
  try {
    const ctx = await captureContext();
    state.context = ctx; saveKeys('context');
    switchTab('chat');
    pushMessage('assistant', `Captured context from ${ctx.hostname}.`);
  } catch (err) {
    switchTab('chat');
    pushMessage('assistant', `Could not capture page: ${err.message || err}`);
  } finally { card.style.pointerEvents = ''; card.style.opacity = ''; }
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
  btn.disabled = true; btn.textContent = 'Capturing...';
  try {
    const ctx = await captureContext();
    state.context = ctx; saveKeys('context'); renderContext();
  } catch (err) {
    console.warn('Helixis: context refresh failed:', err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M11 6.5A4.5 4.5 0 1 1 6.5 2a4.5 4.5 0 0 1 3.18 1.32M11 2v3H8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg> Refresh Context`;
  }
}

// ── TIME FORMATTING ──────────────────────────────────

function fmtTimeAgo(dt) {
  if (!dt) return '';
  const diff = Date.now() - new Date(dt).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dt).toLocaleDateString();
}

// ── UTILS ─────────────────────────────────────────────

function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
function fmtDue(due) { try { return new Date(due).toLocaleString([], { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' }); } catch { return due; } }
function fmtTs(ts)   { try { return new Date(ts).toLocaleString([], { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' }); } catch { return ts; } }
function fmtDate(d)  { try { return new Date(d).toLocaleString([], { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' }); } catch { return d; } }

// ── INIT ──────────────────────────────────────────────

async function init() {
  await loadState();

  // Login
  document.getElementById('loginBtn').addEventListener('click', handleLogin);
  document.getElementById('loginPassword').addEventListener('keydown', e => { if (e.key === 'Enter') handleLogin(); });
  document.getElementById('logoutBtn').addEventListener('click', handleLogout);

  // Tabs
  document.querySelectorAll('.tab').forEach(tab => tab.addEventListener('click', () => switchTab(tab.dataset.tab)));

  // Chat
  renderMessages();
  document.getElementById('sendBtn').addEventListener('click', handleSend);
  document.getElementById('chatInput').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } });

  // Screenshot
  document.getElementById('captureScreenBtn').addEventListener('click', handleCaptureScreen);
  document.getElementById('removeScreenshot').addEventListener('click', clearScreenshot);

  // Activity
  document.getElementById('refreshEventsBtn').addEventListener('click', loadEvents);

  // Actions
  const readCtxCard = document.getElementById('actionReadCtx');
  readCtxCard.addEventListener('click', handleReadContext);
  readCtxCard.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleReadContext(); } });

  // Context
  document.getElementById('refreshCtxBtn').addEventListener('click', handleRefreshContext);

  // Auth check
  await checkAuth();
  switchTab(state.activeTab);
}

init();
