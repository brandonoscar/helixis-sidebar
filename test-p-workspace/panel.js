/*
 * Helixis Copilot (P Workspace Test) — panel.js
 * Auto-loads P Property Management workspace. No login required.
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
  pendingScreenshot: null   // base64 dataURL from captureVisibleTab
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

// ── WORKSPACE DATA ────────────────────────────────────

async function loadWorkspace() {
  try {
    const data = await fetchWorkspaceData();
    if (!data || !data.workspace) {
      renderWorkspaceEmpty();
      setStatus('No data', 'warn');
      return;
    }

    state.workspace    = data.workspace;
    state.integrations = data.integrations || [];
    state.members      = data.members || [];

    renderWorkspace();
    document.getElementById('headerWorkspace').textContent = state.workspace.name;
    setStatus('Connected', 'ok');

    // Fetch all Buildium data if integration exists
    const hasBuildium = state.integrations.some(i => i.provider === 'buildium' && (i.status === 'connected' || i.status === 'locked'));
    if (hasBuildium) {
      try {
        state.buildiumData = await fetchAllBuildiumData(state.workspace.id);
        const loaded = Object.entries(state.buildiumData)
          .filter(([, v]) => v.count > 0)
          .map(([k, v]) => `${k}: ${v.count}`)
          .join(', ');
        console.log('Helixis: loaded Buildium data —', loaded || 'no records');
      } catch (err) {
        console.warn('Helixis: could not load Buildium data:', err.message);
        state.buildiumData = null;
      }
    }
  } catch (err) {
    console.error('Failed to load workspace:', err);
    document.getElementById('wsName').textContent = 'Error';
    document.getElementById('wsMeta').textContent = err.message;
    setStatus('Error', 'error');
  }
}

function setStatus(text, type) {
  const pill = document.getElementById('statusPill');
  const label = document.getElementById('statusText');
  label.textContent = text;
  pill.className = 'status-pill';
  if (type === 'ok')    pill.classList.add('status-ok');
  if (type === 'warn')  pill.classList.add('status-warn');
  if (type === 'error') pill.classList.add('status-error');
}

// ── WORKSPACE RENDERING ──────────────────────────────

function renderWorkspace() {
  const ws = state.workspace;
  if (!ws) { renderWorkspaceEmpty(); return; }

  document.getElementById('wsName').textContent = ws.name;
  const meta = [];
  if (ws.onboarding_completed_at) meta.push('Onboarding complete');
  else meta.push('Onboarding in progress');
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
        ${m.accepted_at ? '<div class="ws-member-status accepted">Joined</div>' : '<div class="ws-member-status pending">Pending</div>'}`;
      memContainer.appendChild(row);
    });
  }
}

function renderWorkspaceEmpty() {
  document.getElementById('wsName').textContent = 'No workspace found';
  document.getElementById('wsMeta').textContent = '';
  document.getElementById('wsIntegrations').innerHTML = '<div class="ws-empty">No integrations.</div>';
  document.getElementById('wsMembers').innerHTML      = '<div class="ws-empty">No team members.</div>';
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

  // Grab pending screenshot before clearing
  const screenshot = state.pendingScreenshot;
  clearScreenshot();

  if (screenshot) {
    pushMessage('user', `📷 [Screenshot attached] ${text}`);
  } else {
    pushMessage('user', text);
  }

  // Show typing indicator
  const typingMsg = { role: 'assistant', text: 'Thinking...' };
  const typingEl = buildMsgEl(typingMsg);
  typingEl.classList.add('typing');
  typingEl.querySelector('.message-bubble').style.opacity = '0.5';
  document.getElementById('messageList').appendChild(typingEl);

  try {
    // Auto-capture page context silently on every message
    try {
      const ctx = await captureContext();
      state.context = ctx;
      saveKeys('context');
    } catch (e) {
      console.warn('Helixis: auto-context failed (ok):', e.message);
    }

    console.log('Helixis: buildiumData in state:', state.buildiumData ? `${state.buildiumData.rentals?.length || 0} rentals` : 'null');

    const systemPrompt = buildSystemPrompt(
      state.workspace || { name: 'P Property Management', slug: 'p-property-management' },
      state.integrations,
      state.context,
      state.buildiumData
    );
    console.log('Helixis: system prompt length:', systemPrompt.length);

    // Send recent messages (last 20 for context window)
    const recentMessages = state.messages.slice(-20);
    const reply = await sendToGemini(recentMessages, systemPrompt, screenshot);

    typingEl.remove();
    pushMessage('assistant', reply);
  } catch (err) {
    typingEl.remove();
    pushMessage('assistant', `Error: ${err.message}`);
  }
}

// ── EVENTS (from Buildium webhooks) ──────────────────

let eventPollTimer = null;

async function loadEvents() {
  try {
    const events = await fetchWebhookEvents(50);
    state.events = Array.isArray(events) ? events : [];
    renderEvents();
    console.log('Helixis: loaded', state.events.length, 'webhook events');
  } catch (err) {
    console.warn('Helixis: failed to load events:', err.message);
  }
}

function startEventPolling(intervalMs = 30000) {
  if (eventPollTimer) clearInterval(eventPollTimer);
  eventPollTimer = setInterval(loadEvents, intervalMs);
}

function renderEvents() {
  const list = document.getElementById('remindersList');
  list.innerHTML = '';
  if (!state.events || state.events.length === 0) {
    list.innerHTML = '<div class="reminders-empty">No Buildium events yet. Events will appear here automatically when activity occurs in Buildium.</div>';
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

  const eventLabel = formatEventName(evt.event_name);
  const entityInfo = evt.entity_type ? `${evt.entity_type} #${evt.entity_id}` : '';
  const timeAgo = fmtTimeAgo(evt.event_datetime);
  const icon = getEventIcon(evt.event_name);
  const details = extractEventDetails(evt);

  card.innerHTML = `
    <div class="event-icon">${icon}</div>
    <div class="reminder-content">
      <div class="reminder-title">${esc(eventLabel)}</div>
      ${entityInfo ? `<div class="reminder-note">${esc(entityInfo)}</div>` : ''}
      ${details ? `<div class="reminder-note">${esc(details)}</div>` : ''}
      <div class="reminder-due">${esc(timeAgo)}</div>
    </div>
    <button class="reminder-btn del dismiss-btn" title="Dismiss">
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M1.5 1.5L8.5 8.5M8.5 1.5L1.5 8.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
    </button>`;
  card.querySelector('.dismiss-btn').addEventListener('click', () => handleDismiss(evt.id));
  return card;
}

function formatEventName(name) {
  if (!name) return 'Unknown Event';
  // Buildium format: "Entity.Operation" e.g. "Rental.Updated", "TaskCategory.Created"
  if (name.includes('.')) {
    const [entity, operation] = name.split('.');
    // Add spaces before capitals: "TaskCategory" -> "Task Category"
    const readableEntity = entity.replace(/([a-z])([A-Z])/g, '$1 $2');
    return `${readableEntity} ${operation}`;
  }
  return name
    .replace(/([A-Z])/g, ' $1')
    .replace(/[._]/g, ' ')
    .replace(/^\s+/, '')
    .trim();
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

function extractEventDetails(evt) {
  const p = evt.payload;
  if (!p) return '';
  const parts = [];
  // Buildium uses entity-specific ID fields (PropertyId, TenantId, etc.)
  if (p.PropertyName || p.RentalName) parts.push(p.PropertyName || p.RentalName);
  if (p.TenantName || (p.FirstName && p.LastName)) parts.push(p.TenantName || `${p.FirstName} ${p.LastName}`);
  if (p.Amount) parts.push(`$${p.Amount}`);
  // Buildium payloads are minimal — show the entity ID if available
  const idFields = ['PropertyId', 'RentalId', 'UnitId', 'LeaseId', 'TenantId',
    'AssociationId', 'WorkOrderId', 'TaskId', 'VendorId', 'TaskCategoryId'];
  for (const f of idFields) {
    if (p[f] != null) { parts.push(`${f.replace('Id','')}: #${p[f]}`); break; }
  }
  if (p.Description) parts.push(p.Description.slice(0, 80));
  if (p.Subject || p.Title) parts.push((p.Subject || p.Title).slice(0, 80));
  return parts.join(' · ');
}

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
  return fmtDate(dt);
}

async function handleDismiss(eventId) {
  const ok = await dismissWebhookEvent(eventId);
  if (ok) {
    state.events = state.events.filter(e => e.id !== eventId);
    renderEvents();
  }
}

function updateBadge() {
  const count = state.events ? state.events.length : 0;
  document.getElementById('reminderBadge').textContent = count > 0 ? count : '';
}

// ── SCREEN CAPTURE ───────────────────────────────────

async function captureScreen() {
  // First check if the active tab is capturable
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab?.url || '';
  if (url.startsWith('chrome://') || url.startsWith('chrome-extension://') || url.startsWith('about:') || url.startsWith('chrome-search://')) {
    throw new Error('Cannot capture browser internal pages. Navigate to a website first.');
  }

  // Try direct capture first (works in most cases)
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'jpeg', quality: 75 });
    return dataUrl;
  } catch (directErr) {
    console.warn('Helixis: direct capture failed, trying service worker:', directErr.message);
  }

  // Fallback: ask service worker to capture (needed in some Chrome versions for side panel)
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: 'HELIXIS_CAPTURE_TAB' }, (res) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (res?.success) {
        resolve(res.dataUrl);
      } else {
        reject(new Error(res?.error || 'Screen capture failed'));
      }
    });
  });
}

async function handleCaptureScreen() {
  const btn = document.getElementById('captureScreenBtn');
  const indicator = document.getElementById('screenshotIndicator');
  btn.disabled = true;
  btn.classList.add('capturing');
  try {
    const dataUrl = await captureScreen();
    state.pendingScreenshot = dataUrl;
    indicator.style.display = '';
    indicator.title = 'Screenshot attached — will be sent with your next message';
    // Focus the chat input so user can type their question
    document.getElementById('chatInput').focus();
    switchTab('chat');
  } catch (err) {
    switchTab('chat');
    pushMessage('assistant', err.message);
  } finally {
    btn.disabled = false;
    btn.classList.remove('capturing');
  }
}

function clearScreenshot() {
  state.pendingScreenshot = null;
  const indicator = document.getElementById('screenshotIndicator');
  if (indicator) indicator.style.display = 'none';
}

// ── PAGE CONTEXT ──────────────────────────────────────

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
    const ctx = await captureContext(); state.context = ctx; saveKeys('context');
    switchTab('chat'); pushMessage('assistant', `Captured context from ${ctx.hostname}.`);
  } catch (err) { switchTab('chat'); pushMessage('assistant', `Could not capture page: ${err.message || err}`); }
  finally { card.style.pointerEvents = ''; card.style.opacity = ''; }
}

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
    const ctx = await captureContext(); state.context = ctx; saveKeys('context'); renderContext();
    pushMessage('assistant', `Context refreshed from ${ctx.hostname}.`);
  } catch (err) { pushMessage('assistant', `Refresh failed: ${err.message || err}`); }
  finally {
    btn.disabled = false;
    btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M11 6.5A4.5 4.5 0 1 1 6.5 2a4.5 4.5 0 0 1 3.18 1.32M11 2v3H8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg> Refresh Context`;
  }
}

// ── UTILS ─────────────────────────────────────────────

function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
function fmtDue(due) { try { return new Date(due).toLocaleString([], { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' }); } catch { return due; } }
function fmtTs(ts) { try { return new Date(ts).toLocaleString([], { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' }); } catch { return ts; } }
function fmtDate(d) { try { return new Date(d).toLocaleString([], { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' }); } catch { return d; } }

// ── INIT ──────────────────────────────────────────────

async function init() {
  await loadState();

  // Tabs
  document.querySelectorAll('.tab').forEach(tab => tab.addEventListener('click', () => switchTab(tab.dataset.tab)));

  // Chat
  renderMessages();
  document.getElementById('sendBtn').addEventListener('click', handleSend);
  document.getElementById('chatInput').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } });

  // Events (from Buildium webhooks)
  renderEvents();
  document.getElementById('refreshEventsBtn').addEventListener('click', loadEvents);

  // Screen capture
  document.getElementById('captureScreenBtn').addEventListener('click', handleCaptureScreen);
  document.getElementById('removeScreenshot').addEventListener('click', clearScreenshot);

  // Actions
  const readCtxCard = document.getElementById('actionReadCtx');
  readCtxCard.addEventListener('click', handleReadContext);
  readCtxCard.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleReadContext(); } });

  // Context
  document.getElementById('refreshCtxBtn').addEventListener('click', handleRefreshContext);

  switchTab(state.activeTab);

  // Load P workspace data automatically
  await loadWorkspace();

  // Load webhook events and poll every 30s
  await loadEvents();
  startEventPolling(30000);
}

init();
