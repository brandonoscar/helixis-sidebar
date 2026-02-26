/**
 * content.js  — Content script (injected into page context)
 *
 * NOTE: Selection capture for the "Save Selection" action is performed via
 * chrome.scripting.executeScript({ func }) in panel.js — no persistent
 * content script injection is needed for that feature.
 *
 * This file is the right place for future page-level work such as:
 *   - In-page highlight / annotation overlays
 *   - DOM mutation observation
 *   - Context-menu integration
 *
 * SECURITY: NEVER handle API keys or call chrome.storage here.
 * Use chrome.runtime.sendMessage → service_worker.js for privileged ops.
 */

/**
 * Returns the current user text selection (trimmed).
 * Called via scripting.executeScript({ func: getSelectionText }).
 * @returns {string}
 */
// eslint-disable-next-line no-unused-vars
function getSelectionText() {
  return (window.getSelection()?.toString() ?? '').trim();
}
