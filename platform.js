// Occupella Copilot — platform seam (Chrome extension host).
//
// The panel runs in two hosts: this Chrome extension, and the Occupella
// desktop browser (helixiselectron), which ships these same panel files and
// swaps in its own platform.js. Everything host-specific lives behind this
// module so panel.js / auth.js / agent.js stay byte-identical in both.
//
// The desktop copy must export the same names with the same shapes.

export const host = 'chrome';

/** Key/value persistence (chrome.storage.local here). */
export const storage = {
  get: (keys) => chrome.storage.local.get(keys),
  set: (patch) => chrome.storage.local.set(patch),
  remove: (keys) => chrome.storage.local.remove(keys),
};

/** Network. Extension pages with host_permissions are not bound by CORS,
 *  so plain fetch reaches the backend and Supabase directly. */
export const http = (url, init) => fetch(url, init);

/**
 * Read the active tab: {url, title, text}. `allowed(url)` is checked BEFORE
 * any script touches the page, so a disallowed page is never read at all.
 * Throws when there is no usable tab or the page is not allowed.
 */
export async function captureActivePage(allowed) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) throw new Error('No active tab');
  if (!allowed(tab.url || '')) throw new ContextBlockedError();

  try {
    // Content script first (fast, reliable when injected).
    const res = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout')), 1500);
      chrome.tabs.sendMessage(tab.id, { type: 'HELIXIS_GET_CONTEXT' }, (r) => {
        clearTimeout(timer);
        if (chrome.runtime.lastError || !r) reject(chrome.runtime.lastError ?? new Error('no response'));
        else resolve(r);
      });
    });
    return { url: res.url || tab.url || '', title: res.title || tab.title || '', text: res.text || '' };
  } catch {
    // Fallback: executeScript (pages loaded before the extension was installed).
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => ({
        text: (document.body?.innerText ?? '').slice(0, 5000),
        title: document.title,
        url: location.href,
      }),
    });
    const r = result?.result ?? {};
    return { url: r.url || tab.url || '', title: r.title || tab.title || '', text: r.text || '' };
  }
}

/** Thrown by captureActivePage for a page the context policy excludes. */
export class ContextBlockedError extends Error {
  constructor() {
    super('Occupella does not read property-management system screens. Your PMS data reaches Occupella through its API connection.');
    this.name = 'ContextBlockedError';
  }
}

/** Unresolved approval cards in this panel → toolbar badge. */
export function setPendingApprovals(count) {
  chrome.action.setBadgeText({ text: count > 0 ? String(count) : '' });
  if (count > 0) chrome.action.setBadgeBackgroundColor({ color: '#d97706' });
}

/** A new approval card arrived. The extension shows it in the panel only;
 *  the desktop host raises a native notification when unfocused. */
export function notifyApproval(_approval) {}
