/**
 * core/storage.js
 *
 * Typed wrappers around chrome.storage.local via the platform adapter.
 *
 * SECURITY:
 *   API keys must ONLY be read from service_worker.js context.
 *   panel.js must NEVER import this module directly.
 *   Reminders, selections, and demo data are NOT sensitive — they may be
 *   read by the panel via message responses (never via direct storage access).
 */

import { storage as platformStorage } from '../platform/extension.js';

// ─── Storage Key Registry ────────────────────────────────────────────────────

export const KEYS = Object.freeze({
  // ── Connector credentials (service-worker only) ───────────────────────────
  API_KEY_HELIXIS:    'apiKey_helixis',

  // ── Connector flags ───────────────────────────────────────────────────────
  CONNECTOR_HELIXIS:  'connector_helixis_enabled',
  CONNECTOR_BUILDIUM: 'connector_buildium_enabled',

  // ── Event channel ─────────────────────────────────────────────────────────
  EVENT_CHANNEL_URL:  'event_channel_url',

  // ── Event log (tasks + messages from Helixis Cloud) ──────────────────────
  EVENTS:             'events',

  // ── Selection (last captured page selection) ──────────────────────────────
  SELECTION:          'saved_selection',

  // ── Reminders ─────────────────────────────────────────────────────────────
  REMINDERS:          'reminders',

  // ── Demo mode flag ────────────────────────────────────────────────────────
  DEMO_MODE:          'demo_mode',
});

const MAX_EVENTS = 200;

// ─── Generic helpers ─────────────────────────────────────────────────────────

/** @param {Record<string, unknown>} items */
export function storageSet(items)  { return platformStorage.set(items);    }

/** @param {string|string[]} keys  */
export function storageGet(keys)   { return platformStorage.get(keys);     }

/** @param {string|string[]} keys  */
export function storageRemove(keys){ return platformStorage.remove(keys);  }

// ─── Event log ────────────────────────────────────────────────────────────────

/**
 * Prepend an event to the events log (max MAX_EVENTS entries).
 * @param {{ type: string, [key: string]: unknown }} event
 */
export async function appendEvent(event) {
  const result = await storageGet([KEYS.EVENTS]);
  const events = Array.isArray(result[KEYS.EVENTS]) ? result[KEYS.EVENTS] : [];

  events.unshift({ ...event, receivedAt: Date.now() });
  if (events.length > MAX_EVENTS) events.length = MAX_EVENTS;

  return storageSet({ [KEYS.EVENTS]: events });
}

// ─── Reminders ────────────────────────────────────────────────────────────────

/**
 * Return the full reminders array.
 * @returns {Promise<Array>}
 */
export async function getReminders() {
  const result = await storageGet([KEYS.REMINDERS]);
  return Array.isArray(result[KEYS.REMINDERS]) ? result[KEYS.REMINDERS] : [];
}

/**
 * Prepend a new reminder.
 * @param {{ id: string, text: string, createdAt: number, doneAt: null, snoozeUntil: null }} reminder
 */
export async function appendReminder(reminder) {
  const reminders = await getReminders();
  reminders.unshift(reminder);
  return storageSet({ [KEYS.REMINDERS]: reminders });
}

/**
 * Merge updates into the reminder with the given id.
 * @param {string} id
 * @param {Partial<{doneAt: number|null, snoozeUntil: number|null, text: string}>} updates
 */
export async function patchReminder(id, updates) {
  const reminders = await getReminders();
  const idx = reminders.findIndex((r) => r.id === id);
  if (idx === -1) throw new Error(`Reminder "${id}" not found.`);
  reminders[idx] = { ...reminders[idx], ...updates };
  return storageSet({ [KEYS.REMINDERS]: reminders });
}

/**
 * Remove reminder by id.
 * @param {string} id
 */
export async function removeReminder(id) {
  const reminders = await getReminders();
  return storageSet({ [KEYS.REMINDERS]: reminders.filter((r) => r.id !== id) });
}
