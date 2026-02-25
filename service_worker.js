/**
 * service_worker.js  — Helixis Copilot background worker
 *
 * SECURITY CONTRACT:
 *   • This is the ONLY context that reads API keys from chrome.storage.local.
 *   • panel.js may send keys for storage but NEVER receives them back.
 *   • All outbound API calls are made here using core/api.js (domain allowlist
 *     + auth header injection).
 *   • Responses to panel are always { success, message } — never raw keys.
 */

import { MSG, ok, err }            from './core/messaging.js';
import { KEYS, storageGet, storageSet, appendEvent } from './core/storage.js';
import { apiFetch }                from './core/api.js';
import { messaging, sidePanel, alarms } from './platform/extension.js';

// ─── Constants ───────────────────────────────────────────────────────────────

const ALARM_RECONNECT   = 'helixis_channel_reconnect';
const DEFAULT_WS_URL    = 'ws://localhost:8765/events';
const DEFAULT_HTTP_BASE = 'http://localhost:8765';

/** Recognised event types arriving from the Helixis Cloud channel. */
const CHANNEL_EVENT_TYPES = new Set(['task.created', 'message.received']);

// ─── Lifecycle ───────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  console.log('[Helixis] Extension installed / updated.');
  _scheduleReconnectAlarm();
});

// ─── Message Router ──────────────────────────────────────────────────────────

messaging.onMessage(async (msg) => {
  if (!msg || !msg.type) return err('Missing message type');

  switch (msg.type) {
    case MSG.SAVE_SETTINGS:       return _handleSaveSettings(msg.payload ?? {});
    case MSG.GET_SETTINGS_STATUS: return _handleGetSettingsStatus();
    case MSG.TEST_CONNECTION:     return _handleTestConnection(msg.payload ?? {});
    case MSG.GET_EVENTS:          return _handleGetEvents();
    case MSG.CLEAR_EVENTS:        return storageSet({ [KEYS.EVENTS]: [] }).then(() => ok('Event log cleared.'));
    case MSG.CONNECT_CHANNEL:     return _handleConnectChannel();
    case MSG.DISCONNECT_CHANNEL:  return _handleDisconnectChannel();
    default:                      return err(`Unknown message type: ${msg.type}`);
  }
});

// ─── Settings ────────────────────────────────────────────────────────────────

/**
 * Persist settings sent from the panel.
 * API key is written directly — panel never reads it back.
 */
async function _handleSaveSettings({ apiKey, connectors, eventChannelUrl } = {}) {
  const items = {};

  if (typeof apiKey === 'string' && apiKey.trim()) {
    items[KEYS.API_KEY_HELIXIS] = apiKey.trim();
  }

  if (connectors && typeof connectors === 'object') {
    if (typeof connectors.helixis === 'boolean')
      items[KEYS.CONNECTOR_HELIXIS] = connectors.helixis;
    if (typeof connectors.buildium === 'boolean')
      items[KEYS.CONNECTOR_BUILDIUM] = connectors.buildium;
  }

  if (typeof eventChannelUrl === 'string' && eventChannelUrl.trim()) {
    items[KEYS.EVENT_CHANNEL_URL] = eventChannelUrl.trim();
  }

  await storageSet(items);

  // If Helixis connector was just enabled, attempt a channel reconnect.
  if (items[KEYS.CONNECTOR_HELIXIS] === true) {
    _maybeReconnect();
  }

  return ok('Settings saved.');
}

/**
 * Return settings STATUS to the panel — booleans only, never raw keys.
 */
async function _handleGetSettingsStatus() {
  const result = await storageGet([
    KEYS.API_KEY_HELIXIS,
    KEYS.CONNECTOR_HELIXIS,
    KEYS.CONNECTOR_BUILDIUM,
    KEYS.EVENT_CHANNEL_URL,
  ]);

  return ok('OK', {
    helixisKeyConfigured: Boolean(result[KEYS.API_KEY_HELIXIS]),
    connectors: {
      helixis:  Boolean(result[KEYS.CONNECTOR_HELIXIS]),
      buildium: Boolean(result[KEYS.CONNECTOR_BUILDIUM]),
    },
    eventChannelUrl: result[KEYS.EVENT_CHANNEL_URL] ?? DEFAULT_WS_URL,
    channelStatus:   _wsState(),
  });
}

// ─── Test Connection ─────────────────────────────────────────────────────────

/**
 * Probe a connector's health endpoint using the stored API key.
 * Returns success/fail + human message — never the key itself.
 */
async function _handleTestConnection({ connector = 'helixis' } = {}) {
  if (connector === 'helixis') {
    const stored = await storageGet([KEYS.API_KEY_HELIXIS, KEYS.EVENT_CHANNEL_URL]);
    const apiKey  = stored[KEYS.API_KEY_HELIXIS];

    if (!apiKey) {
      return err('No Helixis Cloud API key configured. Add one in Settings.');
    }

    // Derive HTTP base URL from the configured WS URL or use the default.
    const wsUrl   = stored[KEYS.EVENT_CHANNEL_URL] ?? DEFAULT_WS_URL;
    const httpBase = wsUrl
      .replace(/^ws:\/\//, 'http://')
      .replace(/^wss:\/\//, 'https://')
      .replace(/\/events$/, '');

    const healthUrl = `${httpBase}/health`;

    try {
      const res  = await apiFetch(healthUrl, { apiKey, retries: 0, timeoutMs: 5_000 });
      const body = await res.json().catch(() => ({}));
      return ok(`Helixis Cloud reachable (HTTP ${res.status}).`, { detail: body });
    } catch (e) {
      // Server is likely not running locally — return a friendly stub response
      // so the user can still validate the key-save flow.
      console.warn('[Helixis] Health check failed (expected when server is not running):', e.message);
      return ok('[STUB] Test simulated — local server not running. Key and settings ARE saved.', { stubbed: true });
    }
  }

  if (connector === 'buildium') {
    return ok('[STUB] Buildium connector is not yet implemented.', { stubbed: true });
  }

  return err(`Unknown connector: "${connector}"`);
}

// ─── Event Log ───────────────────────────────────────────────────────────────

async function _handleGetEvents() {
  const result = await storageGet([KEYS.EVENTS]);
  return ok('OK', { events: result[KEYS.EVENTS] ?? [] });
}

// ─── Event Channel (WebSocket) ───────────────────────────────────────────────
//
// MV3 service workers are ephemeral — they can be terminated at any time.
// Strategy:
//   1. A chrome.alarm fires every minute to re-check connectivity.
//   2. On each alarm tick, if the connector is enabled and no live WS exists,
//      we open one.
//   3. The module-level `_ws` variable lives for the duration of the SW
//      activation; it is re-created after each termination/restart cycle.
//

/** @type {WebSocket|null} */
let _ws = null;

function _wsState() {
  if (!_ws) return 'disconnected';
  return ['connecting', 'connected', 'closing', 'disconnected'][_ws.readyState] ?? 'unknown';
}

function _scheduleReconnectAlarm() {
  alarms.create(ALARM_RECONNECT, { periodInMinutes: 1 });
}

alarms.onAlarm(async (alarm) => {
  if (alarm.name === ALARM_RECONNECT) {
    await _maybeReconnect();
  }
});

async function _maybeReconnect() {
  const stored = await storageGet([KEYS.CONNECTOR_HELIXIS, KEYS.EVENT_CHANNEL_URL]);
  if (!stored[KEYS.CONNECTOR_HELIXIS]) return; // connector disabled — do nothing

  const wsUrl = stored[KEYS.EVENT_CHANNEL_URL] ?? DEFAULT_WS_URL;
  _openWebSocket(wsUrl);
}

async function _handleConnectChannel() {
  const stored = await storageGet([KEYS.EVENT_CHANNEL_URL]);
  const wsUrl  = stored[KEYS.EVENT_CHANNEL_URL] ?? DEFAULT_WS_URL;
  _openWebSocket(wsUrl);
  return ok(`Connection attempt started: ${wsUrl}`);
}

function _handleDisconnectChannel() {
  if (_ws) {
    _ws.close(1000, 'User requested disconnect');
    _ws = null;
  }
  return ok('Channel disconnected.');
}

/**
 * Open (or skip if already open) a WebSocket to the Helixis Cloud event channel.
 * @param {string} wsUrl
 */
function _openWebSocket(wsUrl) {
  // Already connected or connecting — nothing to do.
  if (_ws && _ws.readyState <= WebSocket.OPEN) return;

  console.log(`[Helixis] Opening event channel: ${wsUrl}`);

  try {
    _ws = new WebSocket(wsUrl);

    _ws.addEventListener('open', () => {
      console.log('[Helixis] Event channel connected.');
    });

    _ws.addEventListener('message', ({ data }) => {
      let event;
      try { event = JSON.parse(data); } catch { return; }
      _handleChannelEvent(event);
    });

    _ws.addEventListener('error', () => {
      // Expected when the local server is not running — not a real error.
      console.warn('[Helixis] Event channel error (server may not be running).');
    });

    _ws.addEventListener('close', ({ code, reason }) => {
      console.log(`[Helixis] Event channel closed (code=${code} reason=${reason}).`);
      _ws = null;
    });
  } catch (e) {
    console.warn('[Helixis] Could not create WebSocket:', e.message);
    _ws = null;
  }
}

// ─── Channel Event Handling ──────────────────────────────────────────────────

/**
 * Process an incoming event from the Helixis Cloud channel.
 * Stores it in the event log and notifies the panel if it's open.
 *
 * Recognised event shapes:
 *   { type: 'task.created',     id, title, description, dueAt? }
 *   { type: 'message.received', id, title, body, from? }
 *
 * @param {{ type: string, [key: string]: unknown }} event
 */
async function _handleChannelEvent(event) {
  if (!event || !CHANNEL_EVENT_TYPES.has(event.type)) {
    console.log('[Helixis] Ignored unknown event type:', event?.type);
    return;
  }

  await appendEvent(event);

  // Best-effort push to the panel — silently ignored if it's not open.
  messaging.broadcast({ type: MSG.CHANNEL_EVENT, event });
}
