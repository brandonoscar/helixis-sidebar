/**
 * panel.js  — Helixis Copilot side-panel UI  (v0.2.0)
 *
 * SECURITY CONTRACT:
 *   • Never reads API keys from chrome.storage.local.
 *   • Keys sent via MSG.SAVE_SETTINGS; SW stores them.
 *   • MSG.GET_SETTINGS_STATUS returns only boolean flags, never raw keys.
 *   • All chrome.* usage goes through platform/extension.js.
 */

import { MSG, sendToWorker } from './core/messaging.js';
import { tabs, scripting }   from './platform/extension.js';

// ─── Utility ─────────────────────────────────────────────────────────────────

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─── URL Guard ────────────────────────────────────────────────────────────────

const RESTRICTED_PREFIXES = ['chrome://', 'edge://', 'about:', 'chrome-extension://'];

function isRestrictedUrl(url) {
  if (!url) return true;
  return RESTRICTED_PREFIXES.some((p) => url.startsWith(p));
}

// ─── Toast ────────────────────────────────────────────────────────────────────

let _toastTimer;

function showToast(msg, ms = 2600) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('visible');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('visible'), ms);
}

// ─── Tab Navigation ───────────────────────────────────────────────────────────

const tabButtons = document.querySelectorAll('.tab[data-tab]');
const tabPanels  = document.querySelectorAll('.tab-panel');

function switchTab(tabId) {
  tabButtons.forEach((btn) => {
    const active = btn.dataset.tab === tabId;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', String(active));
  });
  tabPanels.forEach((panel) => panel.classList.toggle('active', panel.id === `tab-${tabId}`));

  // Keep header gear icon highlighted when Settings is active
  document.getElementById('btnHeaderSettings')?.classList.toggle('active', tabId === 'settings');

  if (tabId === 'settings')  loadSettingsStatus();
  if (tabId === 'reminders') loadReminders();
  if (tabId === 'tasks')     loadTasks();
}

tabButtons.forEach((btn) => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));

// Header gear icon → Settings shortcut
document.getElementById('btnHeaderSettings').addEventListener('click', () => switchTab('settings'));

// ─── Copilot: Context + URL Guard ────────────────────────────────────────────

async function getActiveTab() {
  const [tab] = await tabs.query({ active: true, currentWindow: true });
  return tab ?? null;
}

function setPrimaryCardEnabled(enabled) {
  const card = document.getElementById('primaryCard');
  card.classList.toggle('card-disabled', !enabled);
  card.setAttribute('aria-disabled', String(!enabled));
}

function setSaveSelectionEnabled(enabled) {
  const card = document.getElementById('cardSaveSelection');
  card.classList.toggle('card-disabled', !enabled);
  card.setAttribute('aria-disabled', String(!enabled));
}

async function refreshContext() {
  const tab = await getActiveTab();
  const el  = document.getElementById('contextDisplay');
  const notice = document.getElementById('copilotNotice');

  if (!tab?.url || isRestrictedUrl(tab.url)) {
    let label = 'No active context';
    if (tab?.url) {
      try { label = new URL(tab.url).protocol.replace(':', '') + ':// page'; } catch { label = tab.url; }
    }
    el.textContent = label;
    el.classList.toggle('is-empty', !tab?.url);
    notice.hidden = false;
    setPrimaryCardEnabled(false);
    setSaveSelectionEnabled(false);
    return;
  }

  try {
    el.textContent = new URL(tab.url).hostname || tab.url;
  } catch {
    el.textContent = tab.url;
  }
  el.classList.remove('is-empty');
  notice.hidden = true;
  setPrimaryCardEnabled(true);
  setSaveSelectionEnabled(true);
}

// ─── Copilot: Read Page Context ───────────────────────────────────────────────

function setLoading(on) {
  document.getElementById('loadingCard').classList.toggle('visible', on);
}

function showOutputCard(text) {
  document.getElementById('outputBody').textContent = text;
  document.getElementById('outputCard').classList.add('visible');
  updateEmptyState();
}

function hideOutputCard() {
  document.getElementById('outputCard').classList.remove('visible');
  updateEmptyState();
}

function updateEmptyState() {
  const outputVisible    = document.getElementById('outputCard').classList.contains('visible');
  const selectionVisible = document.getElementById('selectionCard').classList.contains('visible');
  document.getElementById('emptyState').style.display =
    (outputVisible || selectionVisible) ? 'none' : '';
}

const primaryCard = document.getElementById('primaryCard');

primaryCard.addEventListener('click', async () => {
  if (primaryCard.classList.contains('card-disabled')) return;
  setLoading(true);
  hideOutputCard();
  try {
    const tab  = await getActiveTab();
    const results = await scripting.executeScript({
      target: { tabId: tab.id },
      func:   () => (document.body?.innerText || '').slice(0, 4000),
    });
    const text = results?.[0]?.result || '';
    setLoading(false);
    showOutputCard(text || '(No text found on this page)');
  } catch (e) {
    setLoading(false);
    showOutputCard('Error: ' + (e?.message || 'Could not read page content'));
  }
});

primaryCard.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); primaryCard.click(); }
});

document.getElementById('outputClose').addEventListener('click', hideOutputCard);

// ─── Copilot: Selection Capture ───────────────────────────────────────────────

function showSelectionCard({ text, url }) {
  const MAX = 280;
  const display = text.length > MAX ? text.slice(0, MAX) + '…' : text;
  document.getElementById('selectionText').textContent   = `"${display}"`;
  document.getElementById('selectionSource').textContent =
    (() => { try { return new URL(url).hostname; } catch { return url || ''; } })();
  document.getElementById('selectionCard').classList.add('visible');
  updateEmptyState();
}

function hideSelectionCard() {
  document.getElementById('selectionCard').classList.remove('visible');
  updateEmptyState();
}

/** Load the last saved selection from the SW on startup. */
async function loadSavedSelection() {
  try {
    const res = await sendToWorker(MSG.GET_SELECTION);
    if (res.selection) showSelectionCard(res.selection);
  } catch { /* panel may open before SW is ready — ignore */ }
}

// Save Selection card
const cardSaveSelection = document.getElementById('cardSaveSelection');

cardSaveSelection.addEventListener('click', async () => {
  if (cardSaveSelection.classList.contains('card-disabled')) return;
  const tab = await getActiveTab();
  if (!tab || isRestrictedUrl(tab?.url)) {
    document.getElementById('copilotNotice').hidden = false;
    return;
  }
  setLoading(true);
  try {
    const results = await scripting.executeScript({
      target: { tabId: tab.id },
      func:   () => (window.getSelection()?.toString() ?? '').trim(),
    });
    const text = results?.[0]?.result ?? '';
    setLoading(false);

    if (!text) { showToast('No text selected on this page.'); return; }

    await sendToWorker(MSG.SAVE_SELECTION, { text, url: tab.url, title: tab.title ?? '' });
    showSelectionCard({ text, url: tab.url });
    showToast('Selection saved!');
  } catch (e) {
    setLoading(false);
    showToast('Could not read selection: ' + e.message);
  }
});

cardSaveSelection.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); cardSaveSelection.click(); }
});

// Clear selection
document.getElementById('selectionClose').addEventListener('click', async () => {
  hideSelectionCard();
  await sendToWorker(MSG.CLEAR_SELECTION).catch(() => {});
});

// Add selection as reminder
document.getElementById('btnAddSelectionAsReminder').addEventListener('click', async () => {
  const raw = document.getElementById('selectionText').textContent
    .replace(/^"|"$/g, '').trim().slice(0, 150);
  if (!raw) return;
  await sendToWorker(MSG.CREATE_REMINDER, { text: raw });
  showToast('Added as reminder!');
  updateReminderBadge();
});

// ─── Reminders: Badge ─────────────────────────────────────────────────────────

async function updateReminderBadge() {
  try {
    const res    = await sendToWorker(MSG.GET_REMINDERS);
    const now    = Date.now();
    const active = (res.reminders ?? []).filter(
      (r) => !r.doneAt && (!r.snoozeUntil || r.snoozeUntil <= now)
    ).length;
    const badge = document.getElementById('remindersBadge');
    badge.textContent = active > 9 ? '9+' : String(active);
    badge.hidden      = active === 0;
  } catch { /* ignore */ }
}

// ─── Reminders: CRUD ──────────────────────────────────────────────────────────

function formatSnoozeTime(ts) {
  const d   = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
    + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function renderReminderItem(r) {
  const now      = Date.now();
  const isDone   = Boolean(r.doneAt);
  const isSnoozed= !isDone && Boolean(r.snoozeUntil) && r.snoozeUntil > now;

  const cls = ['reminder-item', isDone ? 'is-done' : '', isSnoozed ? 'is-snoozed' : '']
    .filter(Boolean).join(' ');

  const snoozeLabel = isSnoozed
    ? `<div class="snooze-label">Snoozed until ${esc(formatSnoozeTime(r.snoozeUntil))}</div>`
    : '';

  // Snooze buttons only for active (non-done) items
  const snoozeButtons = !isDone ? `
    <button class="btn-icon" data-action="snooze30m" title="Snooze 30 min">
      <svg viewBox="0 0 12 12" fill="none">
        <circle cx="6" cy="6.5" r="4" stroke="currentColor" stroke-width="1.2"/>
        <path d="M6 4.5v2.5l1.5 1" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
      </svg>
    </button>
    <button class="btn-icon" data-action="snoozeTomorrow" title="Tomorrow 9 AM">
      <svg viewBox="0 0 12 12" fill="none">
        <rect x="1.5" y="2.5" width="9" height="8" rx="1.5" stroke="currentColor" stroke-width="1.2"/>
        <path d="M4 1.5v2M8 1.5v2M1.5 5.5h9" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
      </svg>
    </button>` : '';

  return `
    <li class="${cls}" data-id="${esc(r.id)}">
      <label class="reminder-check-wrap" title="${isDone ? 'Mark undone' : 'Mark done'}">
        <input type="checkbox" class="reminder-check" ${isDone ? 'checked' : ''}/>
        <span class="reminder-checkmark"></span>
      </label>
      <div class="reminder-body">
        <span class="reminder-text">${esc(r.text)}</span>
        ${snoozeLabel}
      </div>
      <div class="reminder-actions">
        ${snoozeButtons}
        <button class="btn-icon" data-action="delete" title="Delete reminder">
          <svg viewBox="0 0 10 10" fill="none">
            <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
          </svg>
        </button>
      </div>
    </li>`;
}

function renderReminderEmptyState() {
  return `
    <li class="reminder-empty-state">
      <div class="reminder-empty-icon">
        <svg viewBox="0 0 20 20" fill="none">
          <path d="M10 3C7.79 3 6 4.79 6 7v5l-1.5 2.5h11L14 12V7c0-2.21-1.79-4-4-4z"
                stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
          <path d="M8.5 17a1.5 1.5 0 003 0"
                stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
      </div>
      <div class="reminder-empty-title">All clear</div>
      <div class="reminder-empty-desc">Type a reminder above and press Enter — or enable Demo Mode in Settings to see examples.</div>
    </li>`;
}

async function loadReminders() {
  const list = document.getElementById('reminderList');
  try {
    const res       = await sendToWorker(MSG.GET_REMINDERS);
    const reminders = res.reminders ?? [];
    const now       = Date.now();

    if (!reminders.length) {
      list.innerHTML = renderReminderEmptyState();
      return;
    }

    // Sort: active → snoozed → done
    const active  = reminders.filter((r) => !r.doneAt && (!r.snoozeUntil || r.snoozeUntil <= now));
    const snoozed = reminders.filter((r) => !r.doneAt && r.snoozeUntil && r.snoozeUntil > now);
    const done    = reminders.filter((r) => Boolean(r.doneAt));

    const all = [...active, ...snoozed, ...done];
    list.innerHTML = all.map(renderReminderItem).join('');

    // Attach event listeners
    list.querySelectorAll('.reminder-item').forEach((item) => {
      const id = item.dataset.id;

      item.querySelector('.reminder-check')?.addEventListener('change', async (e) => {
        await sendToWorker(MSG.UPDATE_REMINDER, {
          id, updates: { doneAt: e.target.checked ? Date.now() : null },
        });
        loadReminders();
        updateReminderBadge();
      });

      item.querySelector('[data-action="snooze30m"]')?.addEventListener('click', async () => {
        await sendToWorker(MSG.UPDATE_REMINDER, {
          id, updates: { snoozeUntil: Date.now() + 30 * 60 * 1000 },
        });
        loadReminders();
        updateReminderBadge();
        showToast('Snoozed for 30 minutes.');
      });

      item.querySelector('[data-action="snoozeTomorrow"]')?.addEventListener('click', async () => {
        const tom = new Date();
        tom.setDate(tom.getDate() + 1);
        tom.setHours(9, 0, 0, 0);
        await sendToWorker(MSG.UPDATE_REMINDER, {
          id, updates: { snoozeUntil: tom.getTime() },
        });
        loadReminders();
        updateReminderBadge();
        showToast(`Snoozed until tomorrow at 9 AM.`);
      });

      item.querySelector('[data-action="delete"]')?.addEventListener('click', async () => {
        await sendToWorker(MSG.DELETE_REMINDER, { id });
        loadReminders();
        updateReminderBadge();
      });
    });
  } catch (e) {
    list.innerHTML = `<li class="reminder-empty-state"><div class="reminder-empty-desc" style="color:var(--danger)">Error: ${esc(e.message)}</div></li>`;
  }
}

async function addReminder() {
  const input = document.getElementById('reminderInput');
  const text  = input.value.trim();
  if (!text) return;
  input.value = '';
  await sendToWorker(MSG.CREATE_REMINDER, { text });
  loadReminders();
  updateReminderBadge();
}

document.getElementById('btnAddReminder').addEventListener('click', addReminder);
document.getElementById('reminderInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') addReminder();
});

// ─── Tasks: Load ──────────────────────────────────────────────────────────────

async function loadTasks() {
  const list = document.getElementById('tasksList');
  list.innerHTML = '<li class="loading">Loading…</li>';
  try {
    const res    = await sendToWorker(MSG.GET_EVENTS);
    const events = (res.events ?? []).filter((e) => e.type === 'task.created');
    renderEventList(list, events, 'No tasks yet. Events from Helixis Cloud will appear here.');
  } catch (e) {
    list.innerHTML = `<li class="err">Error: ${esc(e.message)}</li>`;
  }
}

document.getElementById('btnRefreshTasks').addEventListener('click', loadTasks);

function renderEventList(listEl, events, emptyMsg) {
  if (!events.length) {
    listEl.innerHTML = `<li class="empty">${esc(emptyMsg)}</li>`;
    return;
  }
  listEl.innerHTML = events.map((e) => `
    <li class="event-item">
      <div class="event-title">${esc(e.title ?? e.type ?? 'Event')}</div>
      <div class="event-body">${esc(e.body ?? e.description ?? JSON.stringify(e.data ?? {}))}</div>
      <div class="event-time">${new Date(e.receivedAt).toLocaleString()}</div>
    </li>`).join('');
}

// ─── Real-time Push ───────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type !== MSG.CHANNEL_EVENT) return;
  const active = document.querySelector('.tab.active')?.dataset?.tab;
  if (active === 'tasks') loadTasks();
  updateReminderBadge();
});

// ─── Settings ─────────────────────────────────────────────────────────────────

async function loadSettingsStatus() {
  try {
    const res = await sendToWorker(MSG.GET_SETTINGS_STATUS);
    if (!res.success) return;

    // Status pill
    const pill = document.getElementById('statusPill');
    const text = document.getElementById('statusText');
    if (res.demoMode) {
      pill.classList.add('is-demo');
      text.textContent = 'Ready (Demo)';
    } else {
      pill.classList.remove('is-demo');
      text.textContent = 'Ready';
    }

    // Key badge
    const keyStatus = document.getElementById('keyStatus');
    if (res.helixisKeyConfigured) {
      keyStatus.textContent = '● Key saved';
      keyStatus.className   = 'key-status configured';
      document.getElementById('apiKeyInput').placeholder = '●●●●●●●●●●●● (leave blank to keep current)';
    } else {
      keyStatus.textContent = '○ Not configured';
      keyStatus.className   = 'key-status not-configured';
      document.getElementById('apiKeyInput').placeholder = 'Enter API key…';
    }

    document.getElementById('toggleHelixis').checked  = Boolean(res.connectors?.helixis);
    document.getElementById('toggleBuildium').checked = Boolean(res.connectors?.buildium);
    document.getElementById('toggleDemoMode').checked = Boolean(res.demoMode);
    if (res.eventChannelUrl) document.getElementById('channelUrl').value = res.eventChannelUrl;
  } catch (e) {
    console.warn('[Helixis Panel] Could not load settings status:', e.message);
  }
}

document.getElementById('btnToggleKey').addEventListener('click', () => {
  const input = document.getElementById('apiKeyInput');
  const btn   = document.getElementById('btnToggleKey');
  const hidden = input.type === 'password';
  input.type      = hidden ? 'text' : 'password';
  btn.textContent = hidden ? 'Hide' : 'Show';
});

document.getElementById('btnSaveSettings').addEventListener('click', async () => {
  const apiKey          = document.getElementById('apiKeyInput').value.trim();
  const channelUrl      = document.getElementById('channelUrl').value.trim();
  const helixisEnabled  = document.getElementById('toggleHelixis').checked;
  const buildiumEnabled = document.getElementById('toggleBuildium').checked;
  const demoMode        = document.getElementById('toggleDemoMode').checked;

  setSettingsStatus('Saving…', 'info');

  try {
    const payload = {
      connectors:      { helixis: helixisEnabled, buildium: buildiumEnabled },
      eventChannelUrl: channelUrl || 'ws://localhost:8765/events',
      demoMode,
    };
    if (apiKey) payload.apiKey = apiKey;

    const res = await sendToWorker(MSG.SAVE_SETTINGS, payload);

    // SECURITY: clear key from DOM immediately after sending.
    document.getElementById('apiKeyInput').value        = '';
    document.getElementById('apiKeyInput').type         = 'password';
    document.getElementById('btnToggleKey').textContent = 'Show';

    setSettingsStatus(res.message ?? 'Saved.', 'success');
    loadSettingsStatus();       // refresh pill + states
    updateReminderBadge();      // demo data may have loaded reminders
  } catch (e) {
    setSettingsStatus(`Error: ${e.message}`, 'error');
  }
});

document.getElementById('btnTestConnection').addEventListener('click', async () => {
  setSettingsStatus('Testing connection…', 'info');
  try {
    const res       = await sendToWorker(MSG.TEST_CONNECTION, { connector: 'helixis' });
    const stubBadge = res.stubbed ? ' [STUB]' : '';
    setSettingsStatus(
      (res.success ? '✓ ' : '✗ ') + (res.message ?? '') + stubBadge,
      res.success ? 'success' : 'error',
    );
  } catch (e) {
    setSettingsStatus(`Error: ${e.message}`, 'error');
  }
});

function setSettingsStatus(msg, type = 'info') {
  const el  = document.getElementById('settingsStatus');
  el.textContent = msg;
  el.className   = `settings-status ${type}`;
}

// ─── Init ─────────────────────────────────────────────────────────────────────

refreshContext();
loadSettingsStatus();   // update status pill (demo mode, etc.)
updateReminderBadge();  // show count on tab
loadSavedSelection();   // restore last saved selection if any
