/**
 * panel.js  — Helixis Copilot side-panel UI
 *
 * SECURITY CONTRACT:
 *   • This file NEVER reads API keys from chrome.storage.local.
 *   • Keys are sent to service_worker.js via MSG.SAVE_SETTINGS.
 *   • MSG.GET_SETTINGS_STATUS returns only boolean flags — never the raw key.
 *   • All chrome.* usage goes through platform/extension.js.
 */

import { MSG, sendToWorker } from './core/messaging.js';
import { tabs, scripting }   from './platform/extension.js';

// ─── Utility ─────────────────────────────────────────────────────────────────

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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
  tabPanels.forEach((panel) => {
    panel.classList.toggle('active', panel.id === `tab-${tabId}`);
  });

  if (tabId === 'settings')  loadSettingsStatus();
  if (tabId === 'reminders') loadReminders();
  if (tabId === 'tasks')     loadTasks();
}

tabButtons.forEach((btn) =>
  btn.addEventListener('click', () => switchTab(btn.dataset.tab))
);

// ─── Copilot Tab ──────────────────────────────────────────────────────────────

async function getActiveTab() {
  const [tab] = await tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function getPageText(tabId) {
  const results = await scripting.executeScript({
    target: { tabId },
    func: () => (document.body?.innerText || '').slice(0, 4000),
  });
  return results?.[0]?.result || '';
}

async function refreshContext() {
  const tab = await getActiveTab();
  const el  = document.getElementById('contextDisplay');
  if (tab?.url) {
    try {
      const hostname = new URL(tab.url).hostname;
      el.textContent = hostname || tab.url;
      el.classList.remove('is-empty');
    } catch {
      el.textContent = tab.url;
      el.classList.remove('is-empty');
    }
  } else {
    el.textContent = 'No active context';
    el.classList.add('is-empty');
  }
}

function setLoading(on) {
  document.getElementById('loadingCard').classList.toggle('visible', on);
}

function showOutput(text) {
  document.getElementById('outputBody').textContent = text;
  document.getElementById('outputCard').classList.add('visible');
  document.getElementById('emptyState').style.display = 'none';
}

function clearOutput() {
  document.getElementById('outputCard').classList.remove('visible');
  document.getElementById('emptyState').style.display = '';
}

const primaryCard = document.getElementById('primaryCard');

primaryCard.addEventListener('click', async () => {
  setLoading(true);
  clearOutput();
  try {
    const tab  = await getActiveTab();
    const text = await getPageText(tab.id);
    setLoading(false);
    showOutput(text || '(No text found on this page)');
  } catch (err) {
    setLoading(false);
    showOutput('Error: ' + (err?.message || 'Could not read page content'));
  }
});

primaryCard.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    primaryCard.click();
  }
});

document.getElementById('outputClose').addEventListener('click', clearOutput);

refreshContext();

// ─── Event List Renderer ──────────────────────────────────────────────────────

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
    </li>
  `).join('');
}

// ─── Reminders Tab ────────────────────────────────────────────────────────────

async function loadReminders() {
  const list = document.getElementById('remindersList');
  list.innerHTML = '<li class="loading">Loading…</li>';
  try {
    const res    = await sendToWorker(MSG.GET_EVENTS);
    const events = (res.events ?? []).filter((e) => e.type === 'message.received');
    renderEventList(list, events, 'No reminders yet. Events from Helixis Cloud will appear here.');
  } catch (e) {
    list.innerHTML = `<li class="err">Error: ${esc(e.message)}</li>`;
  }
}

document.getElementById('btnRefreshReminders').addEventListener('click', loadReminders);

// ─── Tasks Tab ────────────────────────────────────────────────────────────────

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

// ─── Real-time Push ───────────────────────────────────────────────────────────

// SW broadcasts CHANNEL_EVENT when a live WS event arrives.
// Refresh the visible list tab automatically.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type !== MSG.CHANNEL_EVENT) return;
  const activeTab = document.querySelector('.tab.active')?.dataset?.tab;
  if (activeTab === 'reminders') loadReminders();
  if (activeTab === 'tasks')     loadTasks();
});

// ─── Settings Tab ─────────────────────────────────────────────────────────────

async function loadSettingsStatus() {
  try {
    const res = await sendToWorker(MSG.GET_SETTINGS_STATUS);
    if (!res.success) return;

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

    if (res.eventChannelUrl) {
      document.getElementById('channelUrl').value = res.eventChannelUrl;
    }
  } catch (e) {
    console.warn('[Helixis Panel] Could not load settings status:', e.message);
  }
}

document.getElementById('btnToggleKey').addEventListener('click', () => {
  const input    = document.getElementById('apiKeyInput');
  const btn      = document.getElementById('btnToggleKey');
  const isHidden = input.type === 'password';
  input.type      = isHidden ? 'text' : 'password';
  btn.textContent = isHidden ? 'Hide' : 'Show';
});

document.getElementById('btnSaveSettings').addEventListener('click', async () => {
  const apiKey          = document.getElementById('apiKeyInput').value.trim();
  const channelUrl      = document.getElementById('channelUrl').value.trim();
  const helixisEnabled  = document.getElementById('toggleHelixis').checked;
  const buildiumEnabled = document.getElementById('toggleBuildium').checked;

  setSettingsStatus('Saving…', 'info');

  try {
    const payload = {
      connectors:      { helixis: helixisEnabled, buildium: buildiumEnabled },
      eventChannelUrl: channelUrl || 'ws://localhost:8765/events',
    };
    // Only include the key if the user typed something.
    if (apiKey) payload.apiKey = apiKey;

    const res = await sendToWorker(MSG.SAVE_SETTINGS, payload);

    // SECURITY: clear the key from the DOM immediately after sending.
    document.getElementById('apiKeyInput').value        = '';
    document.getElementById('apiKeyInput').type         = 'password';
    document.getElementById('btnToggleKey').textContent = 'Show';

    setSettingsStatus(res.message ?? 'Saved.', 'success');
    loadSettingsStatus();
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
  const el = document.getElementById('settingsStatus');
  el.textContent = msg;
  el.className   = `settings-status ${type}`;
}
