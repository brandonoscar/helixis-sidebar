/**
 * core/storage.js
 *
 * Typed wrappers around chrome.storage.local via the platform adapter.
 *
 * SECURITY:
 *   This module is imported ONLY by service_worker.js.
 *   panel.js must NEVER import or use this module directly.
 *   API keys are write-only from the panel's perspective
 *   (sent via a message → SW stores them here → SW uses them for requests).
 */

import { storage as platformStorage } from '../platform/extension.js';

// ─── Storage Key Registry ────────────────────────────────────────────────────

export const KEYS = Object.freeze({
  // Connector credentials (service-worker only)
  API_KEY_HELIXIS:       'apiKey_helixis',

  // Connector enable/disable flags
  CONNECTOR_HELIXIS:     'connector_helixis_enabled',
  CONNECTOR_BUILDIUM:    'connector_buildium_enabled',

  // Event channel config
  EVENT_CHANNEL_URL:     'event_channel_url',

  // Event log (tasks + messages from Helixis Cloud)
  EVENTS:                'events',
});

// Max events to keep in storage before the oldest are dropped.
const MAX_EVENTS = 200;

// ─── Generic helpers ─────────────────────────────────────────────────────────

/**
 * Write one or more key/value pairs.
 * @param {Record<string, unknown>} items
 */
export function storageSet(items) {
  return platformStorage.set(items);
}

/**
 * Read one or more keys. Returns the full result object.
 * @param {string|string[]} keys
 * @returns {Promise<Record<string, unknown>>}
 */
export function storageGet(keys) {
  return platformStorage.get(keys);
}

/**
 * Remove one or more keys.
 * @param {string|string[]} keys
 */
export function storageRemove(keys) {
  return platformStorage.remove(keys);
}

// ─── Domain-specific helpers ─────────────────────────────────────────────────

/**
 * Prepend an event to the events log, keeping at most MAX_EVENTS entries.
 * @param {{ type: string, [key: string]: unknown }} event
 */
export async function appendEvent(event) {
  const result = await storageGet([KEYS.EVENTS]);
  const events = Array.isArray(result[KEYS.EVENTS]) ? result[KEYS.EVENTS] : [];

  events.unshift({ ...event, receivedAt: Date.now() });

  if (events.length > MAX_EVENTS) {
    events.length = MAX_EVENTS;
  }

  return storageSet({ [KEYS.EVENTS]: events });
}
