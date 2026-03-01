/**
 * service_worker.js  — Helixis Copilot background worker
 *
 * SECURITY CONTRACT:
 *   • Only this context reads API keys from chrome.storage.local.
 *   • panel.js sends keys for storage but NEVER receives them back.
 *   • All outbound API calls use core/api.js (domain allowlist + auth header).
 *   • Responses to panel are always { success, message } — never raw keys.
 */

import { MSG, ok, err }                                      from './core/messaging.js';
import {
  KEYS, storageGet, storageSet, storageRemove,
  appendEvent, getReminders, appendReminder, patchReminder, removeReminder,
}                                                            from './core/storage.js';
import { apiFetch }                                          from './core/api.js';
import { messaging, sidePanel, alarms }                     from './platform/extension.js';

// ─── Constants ───────────────────────────────────────────────────────────────

const ALARM_RECONNECT   = 'helixis_channel_reconnect';
const DEFAULT_WS_URL    = 'ws://localhost:8765/events';
const DEFAULT_HTTP_BASE = 'http://localhost:8765';

const CHANNEL_EVENT_TYPES = new Set(['task.created', 'message.received']);

// ─── Side panel — set at top level so it runs every time the SW starts ────────
// This ensures the icon click opens the side panel even after SW restarts.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

// ─── Lifecycle ───────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  console.log('[Helixis] Extension installed / updated — v0.2.0');
  _scheduleReconnectAlarm();
});

// ─── Message Router ──────────────────────────────────────────────────────────

messaging.onMessage(async (msg) => {
  if (!msg?.type) return err('Missing message type');

  switch (msg.type) {
    // Settings
    case MSG.SAVE_SETTINGS:        return _handleSaveSettings(msg.payload ?? {});
    case MSG.GET_SETTINGS_STATUS:  return _handleGetSettingsStatus();
    case MSG.TEST_CONNECTION:      return _handleTestConnection(msg.payload ?? {});

    // Channel
    case MSG.CONNECT_CHANNEL:      return _handleConnectChannel();
    case MSG.DISCONNECT_CHANNEL:   return _handleDisconnectChannel();

    // Event log
    case MSG.GET_EVENTS:           return _handleGetEvents();
    case MSG.CLEAR_EVENTS:         return storageSet({ [KEYS.EVENTS]: [] }).then(() => ok('Event log cleared.'));

    // Selection
    case MSG.SAVE_SELECTION:       return _handleSaveSelection(msg.payload ?? {});
    case MSG.GET_SELECTION:        return _handleGetSelection();
    case MSG.CLEAR_SELECTION:      return storageRemove([KEYS.SELECTION]).then(() => ok('Selection cleared.'));

    // Reminders
    case MSG.GET_REMINDERS:        return _handleGetReminders();
    case MSG.CREATE_REMINDER:      return _handleCreateReminder(msg.payload ?? {});
    case MSG.UPDATE_REMINDER:      return _handleUpdateReminder(msg.payload ?? {});
    case MSG.DELETE_REMINDER:      return _handleDeleteReminder(msg.payload ?? {});

    default: return err(`Unknown message type: ${msg.type}`);
  }
});

// ─── Settings ────────────────────────────────────────────────────────────────

async function _handleSaveSettings({ apiKey, connectors, eventChannelUrl, demoMode } = {}) {
  const items = {};

  if (typeof apiKey === 'string' && apiKey.trim()) {
    items[KEYS.API_KEY_HELIXIS] = apiKey.trim();
  }
  if (connectors && typeof connectors === 'object') {
    if (typeof connectors.helixis === 'boolean')  items[KEYS.CONNECTOR_HELIXIS]  = connectors.helixis;
    if (typeof connectors.buildium === 'boolean') items[KEYS.CONNECTOR_BUILDIUM] = connectors.buildium;
  }
  if (typeof eventChannelUrl === 'string' && eventChannelUrl.trim()) {
    items[KEYS.EVENT_CHANNEL_URL] = eventChannelUrl.trim();
  }
  if (typeof demoMode === 'boolean') {
    items[KEYS.DEMO_MODE] = demoMode;
  }

  await storageSet(items);

  if (items[KEYS.DEMO_MODE] === true)            await _preloadDemoData();
  if (items[KEYS.CONNECTOR_HELIXIS] === true)    _maybeReconnect();

  return ok('Settings saved.');
}

async function _handleGetSettingsStatus() {
  const result = await storageGet([
    KEYS.API_KEY_HELIXIS,
    KEYS.CONNECTOR_HELIXIS,
    KEYS.CONNECTOR_BUILDIUM,
    KEYS.EVENT_CHANNEL_URL,
    KEYS.DEMO_MODE,
  ]);

  return ok('OK', {
    helixisKeyConfigured: Boolean(result[KEYS.API_KEY_HELIXIS]),
    connectors: {
      helixis:  Boolean(result[KEYS.CONNECTOR_HELIXIS]),
      buildium: Boolean(result[KEYS.CONNECTOR_BUILDIUM]),
    },
    eventChannelUrl: result[KEYS.EVENT_CHANNEL_URL] ?? DEFAULT_WS_URL,
    channelStatus:   _wsState(),
    demoMode:        Boolean(result[KEYS.DEMO_MODE]),
  });
}

// ─── Test Connection ──────────────────────────────────────────────────────────

async function _handleTestConnection({ connector = 'helixis' } = {}) {
  if (connector === 'helixis') {
    const stored = await storageGet([KEYS.API_KEY_HELIXIS, KEYS.EVENT_CHANNEL_URL]);
    const apiKey  = stored[KEYS.API_KEY_HELIXIS];

    if (!apiKey) return err('No Helixis Cloud API key configured. Add one in Settings.');

    const wsUrl    = stored[KEYS.EVENT_CHANNEL_URL] ?? DEFAULT_WS_URL;
    const httpBase = wsUrl
      .replace(/^ws:\/\//, 'http://')
      .replace(/^wss:\/\//, 'https://')
      .replace(/\/events$/, '');

    try {
      const res  = await apiFetch(`${httpBase}/health`, { apiKey, retries: 0, timeoutMs: 5_000 });
      const body = await res.json().catch(() => ({}));
      return ok(`Helixis Cloud reachable (HTTP ${res.status}).`, { detail: body });
    } catch (e) {
      console.warn('[Helixis] Health check failed (expected locally):', e.message);
      return ok('[STUB] Test simulated — server not running. Key and settings ARE saved.', { stubbed: true });
    }
  }

  if (connector === 'buildium') {
    return ok('[STUB] Buildium connector not yet implemented.', { stubbed: true });
  }

  return err(`Unknown connector: "${connector}"`);
}

// ─── Event Log ───────────────────────────────────────────────────────────────

async function _handleGetEvents() {
  const result = await storageGet([KEYS.EVENTS]);
  return ok('OK', { events: result[KEYS.EVENTS] ?? [] });
}

// ─── Selection ───────────────────────────────────────────────────────────────

async function _handleSaveSelection({ text, url, title } = {}) {
  if (!text?.trim()) return err('Selection text is required.');
  const selection = {
    text:    text.trim(),
    url:     url     ?? '',
    title:   title   ?? '',
    savedAt: Date.now(),
  };
  await storageSet({ [KEYS.SELECTION]: selection });
  return ok('Selection saved.', { selection });
}

async function _handleGetSelection() {
  const result = await storageGet([KEYS.SELECTION]);
  return ok('OK', { selection: result[KEYS.SELECTION] ?? null });
}

// ─── Reminders ───────────────────────────────────────────────────────────────

async function _handleGetReminders() {
  const reminders = await getReminders();
  return ok('OK', { reminders });
}

async function _handleCreateReminder({ text } = {}) {
  if (!text?.trim()) return err('Reminder text is required.');
  const reminder = {
    id:          _generateId(),
    text:        text.trim(),
    createdAt:   Date.now(),
    doneAt:      null,
    snoozeUntil: null,
  };
  await appendReminder(reminder);
  return ok('Reminder created.', { reminder });
}

async function _handleUpdateReminder({ id, updates } = {}) {
  if (!id) return err('Reminder id is required.');
  try {
    await patchReminder(id, updates);
    return ok('Reminder updated.');
  } catch (e) {
    return err(e.message);
  }
}

async function _handleDeleteReminder({ id } = {}) {
  if (!id) return err('Reminder id is required.');
  await removeReminder(id);
  return ok('Reminder deleted.');
}

// ─── Demo Mode ───────────────────────────────────────────────────────────────

async function _preloadDemoData() {
  const now = Date.now();

  const sampleReminders = [
    { id: 'demo-r1', text: 'Follow up with client re: contract renewal',    createdAt: now - 3_600_000, doneAt: null, snoozeUntil: null },
    { id: 'demo-r2', text: 'Review PR #142 before standup',                 createdAt: now - 1_800_000, doneAt: null, snoozeUntil: null },
    { id: 'demo-r3', text: 'Ping Alex about Buildium integration timeline',  createdAt: now - 7_200_000, doneAt: null, snoozeUntil: now + 30 * 60_000 },
    { id: 'demo-r4', text: 'Update changelog for v0.2 release',              createdAt: now - 9_000_000, doneAt: now - 3_600_000, snoozeUntil: null },
  ];

  const sampleSelection = {
    text:    'The Helixis platform enables seamless integration between your browser activity and backend workflows, surfacing the right context at the right time.',
    url:     'https://docs.helixis.io/overview',
    title:   'Helixis Documentation',
    savedAt: now - 600_000,
  };

  const sampleEvents = [
    { type: 'task.created',     title: 'Review Q1 metrics dashboard',   description: 'Due by end of week — assigned by Sarah', receivedAt: now - 1_200_000 },
    { type: 'message.received', title: 'Message from Alex Kim',         body: 'Can we sync on the Buildium integration timeline?', receivedAt: now - 900_000 },
  ];

  // Only write if the slot is empty — never clobber real user data.
  const current = await storageGet([KEYS.REMINDERS, KEYS.SELECTION, KEYS.EVENTS]);

  if (!current[KEYS.REMINDERS]?.length) await storageSet({ [KEYS.REMINDERS]: sampleReminders });
  if (!current[KEYS.SELECTION])         await storageSet({ [KEYS.SELECTION]:  sampleSelection  });
  if (!current[KEYS.EVENTS]?.length)    await storageSet({ [KEYS.EVENTS]:     sampleEvents     });

  console.log('[Helixis] Demo data preloaded.');
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function _generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ─── Event Channel (WebSocket) ────────────────────────────────────────────────

/** @type {WebSocket|null} */
let _ws = null;

function _wsState() {
  if (!_ws) return 'disconnected';
  return (['connecting', 'connected', 'closing', 'disconnected'][_ws.readyState]) ?? 'unknown';
}

function _scheduleReconnectAlarm() {
  alarms.create(ALARM_RECONNECT, { periodInMinutes: 1 });
}

alarms.onAlarm(async (alarm) => {
  if (alarm.name === ALARM_RECONNECT) await _maybeReconnect();
});

async function _maybeReconnect() {
  const stored = await storageGet([KEYS.CONNECTOR_HELIXIS, KEYS.EVENT_CHANNEL_URL]);
  if (!stored[KEYS.CONNECTOR_HELIXIS]) return;
  _openWebSocket(stored[KEYS.EVENT_CHANNEL_URL] ?? DEFAULT_WS_URL);
}

async function _handleConnectChannel() {
  const stored = await storageGet([KEYS.EVENT_CHANNEL_URL]);
  const wsUrl  = stored[KEYS.EVENT_CHANNEL_URL] ?? DEFAULT_WS_URL;
  _openWebSocket(wsUrl);
  return ok(`Connection attempt started: ${wsUrl}`);
}

function _handleDisconnectChannel() {
  _ws?.close(1000, 'User requested disconnect');
  _ws = null;
  return ok('Channel disconnected.');
}

function _openWebSocket(wsUrl) {
  if (_ws && _ws.readyState <= WebSocket.OPEN) return;

  console.log(`[Helixis] Opening event channel: ${wsUrl}`);
  try {
    _ws = new WebSocket(wsUrl);

    _ws.addEventListener('open',    ()        => console.log('[Helixis] Event channel connected.'));
    _ws.addEventListener('message', ({ data }) => {
      let event;
      try { event = JSON.parse(data); } catch { return; }
      _handleChannelEvent(event);
    });
    _ws.addEventListener('error',   ()        => console.warn('[Helixis] Event channel error (server may not be running).'));
    _ws.addEventListener('close',   ({ code }) => { console.log(`[Helixis] Event channel closed (${code}).`); _ws = null; });
  } catch (e) {
    console.warn('[Helixis] Could not create WebSocket:', e.message);
    _ws = null;
  }
}

async function _handleChannelEvent(event) {
  if (!event || !CHANNEL_EVENT_TYPES.has(event.type)) {
    console.log('[Helixis] Ignored unknown event type:', event?.type);
    return;
  }
  await appendEvent(event);
  messaging.broadcast({ type: MSG.CHANNEL_EVENT, event });
}
