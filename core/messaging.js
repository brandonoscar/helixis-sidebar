/**
 * core/messaging.js
 *
 * Message-type constants and lightweight helpers for the
 * panel ↔ service-worker communication channel.
 *
 * Import this in BOTH panel.js and service_worker.js.
 * Neither side should hard-code message strings.
 */

import { messaging as platformMessaging } from '../platform/extension.js';

// ─── Message Type Registry ────────────────────────────────────────────────────

/** All valid message types exchanged between panel and service worker. */
export const MSG = Object.freeze({
  // ── Settings ──────────────────────────────────────────────────────────────
  /** Save connector settings (API keys, toggles, channel URL, demo mode). */
  SAVE_SETTINGS:        'SAVE_SETTINGS',

  /** Query current settings STATUS — panel receives booleans, never raw keys. */
  GET_SETTINGS_STATUS:  'GET_SETTINGS_STATUS',

  // ── Connection ────────────────────────────────────────────────────────────
  /** Trigger a test-connection call for a named connector. */
  TEST_CONNECTION:      'TEST_CONNECTION',

  // ── Event Channel ─────────────────────────────────────────────────────────
  /** Manually trigger an event-channel connect attempt. */
  CONNECT_CHANNEL:      'CONNECT_CHANNEL',

  /** Cleanly close the event-channel WebSocket. */
  DISCONNECT_CHANNEL:   'DISCONNECT_CHANNEL',

  // ── Event Log ─────────────────────────────────────────────────────────────
  /** Retrieve all stored events (tasks + messages). */
  GET_EVENTS:           'GET_EVENTS',

  /** Wipe the stored event log. */
  CLEAR_EVENTS:         'CLEAR_EVENTS',

  // ── Selection ─────────────────────────────────────────────────────────────
  /** Save captured page selection text. */
  SAVE_SELECTION:       'SAVE_SELECTION',

  /** Retrieve the last saved selection. */
  GET_SELECTION:        'GET_SELECTION',

  /** Clear the saved selection. */
  CLEAR_SELECTION:      'CLEAR_SELECTION',

  // ── Reminders ─────────────────────────────────────────────────────────────
  /** Retrieve full reminders list. */
  GET_REMINDERS:        'GET_REMINDERS',

  /** Create a new reminder. */
  CREATE_REMINDER:      'CREATE_REMINDER',

  /** Update an existing reminder (done, snooze, text). */
  UPDATE_REMINDER:      'UPDATE_REMINDER',

  /** Permanently delete a reminder. */
  DELETE_REMINDER:      'DELETE_REMINDER',

  // ── Push (SW → panel) ─────────────────────────────────────────────────────
  /** Service worker broadcasts this when a real-time channel event arrives. */
  CHANNEL_EVENT:        'CHANNEL_EVENT',
});

// ─── Panel → Service Worker ──────────────────────────────────────────────────

/**
 * Send a typed message from the panel to the service worker and await a response.
 * @template T
 * @param {keyof typeof MSG} type
 * @param {Record<string, unknown>} [payload]
 * @returns {Promise<T>}
 */
export function sendToWorker(type, payload = {}) {
  return platformMessaging.send({ type, payload });
}

// ─── Response Builders (used in service_worker.js) ───────────────────────────

/**
 * Build a standard success response.
 * @param {string} message
 * @param {Record<string, unknown>} [extra]
 */
export const ok = (message, extra = {}) => ({ success: true, message, ...extra });

/**
 * Build a standard error response.
 * @param {string} message
 */
export const err = (message) => ({ success: false, message });
