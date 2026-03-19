/**
 * content.js  — Content script (injected into page context)
 *
 * Provides page-level signals to the side panel for context detection.
 *
 * SECURITY: NEVER handle API keys or call chrome.storage here.
 * Use chrome.runtime.sendMessage -> service_worker.js for privileged ops.
 *
 * REPLACE LATER: Add deeper DOM inspection for Buildium-specific elements
 * (lease tables, tenant cards, work order forms, etc.)
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

/**
 * Returns page signals for context detection.
 * Called via scripting.executeScript({ func: getPageSignals }).
 * @returns {{ url: string, title: string, headings: string[], meta: object }}
 */
// eslint-disable-next-line no-unused-vars
function getPageSignals() {
  const headings = Array.from(document.querySelectorAll('h1, h2, h3'))
    .slice(0, 5)
    .map(h => h.textContent?.trim() ?? '');

  const meta = {};
  // Look for Buildium-specific indicators
  const breadcrumb = document.querySelector('.breadcrumb, [class*="breadcrumb"], nav[aria-label="breadcrumb"]');
  if (breadcrumb) meta.breadcrumb = breadcrumb.textContent?.trim() ?? '';

  // Check for common property management page elements
  const pageTitle = document.querySelector('[class*="page-title"], [class*="pageTitle"], .main-title');
  if (pageTitle) meta.pageTitle = pageTitle.textContent?.trim() ?? '';

  return {
    url: window.location.href,
    title: document.title,
    headings,
    meta,
  };
}
