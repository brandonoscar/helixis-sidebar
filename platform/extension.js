/**
 * platform/extension.js
 *
 * Thin adapter layer over chrome.* APIs.
 * Swap this file (or inject a different implementation) to port to
 * a native Chromium build or any other environment later.
 *
 * Rules:
 *  - No business logic here — pure delegation.
 *  - Keep method signatures stable so callers never need to change.
 */

// ─── Storage ─────────────────────────────────────────────────────────────────

export const storage = {
  /** @param {string|string[]} keys */
  get: (keys) => chrome.storage.local.get(keys),

  /** @param {Record<string, unknown>} items */
  set: (items) => chrome.storage.local.set(items),

  /** @param {string|string[]} keys */
  remove: (keys) => chrome.storage.local.remove(keys),
};

// ─── Messaging ───────────────────────────────────────────────────────────────

export const messaging = {
  /**
   * Send a message from the panel → service worker and await a response.
   * @param {{ type: string, payload?: unknown }} message
   * @returns {Promise<unknown>}
   */
  send(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(response);
        }
      });
    });
  },

  /**
   * Register a message listener in service_worker context.
   * The handler may return a value or a Promise; both are handled.
   * @param {(msg: unknown, sender: chrome.runtime.MessageSender) => unknown | Promise<unknown>} handler
   */
  onMessage(handler) {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      const result = handler(msg, sender);
      if (result instanceof Promise) {
        result
          .then(sendResponse)
          .catch((e) => sendResponse({ success: false, message: e.message }));
        return true; // keep the channel open for async response
      }
      if (result !== undefined) sendResponse(result);
    });
  },

  /**
   * Send a fire-and-forget message to the panel (from service worker).
   * Errors are swallowed — the panel may simply not be open.
   * @param {unknown} message
   */
  broadcast(message) {
    chrome.runtime.sendMessage(message).catch(() => {});
  },
};

// ─── Side Panel ──────────────────────────────────────────────────────────────

export const sidePanel = {
  setPanelBehavior: (opts) => chrome.sidePanel.setPanelBehavior(opts),
};

// ─── Tabs ────────────────────────────────────────────────────────────────────

export const tabs = {
  /** @param {chrome.tabs.QueryInfo} queryInfo */
  query: (queryInfo) => chrome.tabs.query(queryInfo),

  /** @param {number} tabId */
  get: (tabId) => chrome.tabs.get(tabId),
};

// ─── Scripting ───────────────────────────────────────────────────────────────

export const scripting = {
  /** @param {chrome.scripting.ScriptInjection} injection */
  executeScript: (injection) => chrome.scripting.executeScript(injection),
};

// ─── Alarms ──────────────────────────────────────────────────────────────────

export const alarms = {
  /** @param {string} name @param {chrome.alarms.AlarmCreateInfo} info */
  create: (name, info) => chrome.alarms.create(name, info),

  /** @param {string} name */
  clear: (name) => chrome.alarms.clear(name),

  /** @param {(alarm: chrome.alarms.Alarm) => void} handler */
  onAlarm: (handler) => chrome.alarms.onAlarm.addListener(handler),
};
