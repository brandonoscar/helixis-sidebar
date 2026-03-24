/**
 * Helixis Browser Context — SPA Route-Change Detection
 *
 * Single-page apps (Buildium, AppFolio, etc.) navigate via
 * history.pushState/replaceState without full page reloads.
 * The content script only runs once at document_idle, so we
 * need to detect these in-page navigations and re-capture context.
 *
 * Detection methods (layered):
 *   1. Intercept history.pushState / replaceState
 *   2. Listen to popstate event (back/forward)
 *   3. Listen to hashchange event (hash-based routing)
 *   4. Poll URL as fallback (200ms interval, auto-stops after idle)
 *
 * After detecting a route change:
 *   - Debounce (300ms) to let the SPA render new content
 *   - Optionally use a targeted MutationObserver to wait for
 *     meaningful DOM changes before re-capturing
 *   - Notify the callback with the new URL
 *
 * This module exports a single `startRouteObserver(callback)` function
 * that the content script calls at initialization.
 */

/**
 * Start observing for SPA route changes.
 *
 * @param {(newUrl: string, method: string) => void} onRouteChange
 *   Called when a route change is detected. `method` is one of:
 *   'pushState', 'replaceState', 'popstate', 'hashchange', 'poll'
 * @returns {{ stop: () => void }} Cleanup handle
 */
export function startRouteObserver(onRouteChange) {
  let lastUrl = location.href;
  let debounceTimer = null;
  let pollInterval = null;
  let mutationObserver = null;
  let stopped = false;

  function handleChange(method) {
    const newUrl = location.href;
    if (newUrl === lastUrl) return;
    lastUrl = newUrl;

    // Debounce: SPAs often trigger multiple events during a single navigation
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      if (stopped) return;
      // Start a brief MutationObserver to wait for DOM to stabilize
      waitForDOMStable(() => {
        if (!stopped) onRouteChange(newUrl, method);
      });
    }, 300);
  }

  // ── Method 1: Intercept history.pushState / replaceState ──
  // We patch these methods to fire a custom event.
  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;

  history.pushState = function (...args) {
    originalPushState.apply(this, args);
    handleChange("pushState");
  };

  history.replaceState = function (...args) {
    originalReplaceState.apply(this, args);
    handleChange("replaceState");
  };

  // ── Method 2: popstate (back/forward navigation) ──
  const onPopState = () => handleChange("popstate");
  window.addEventListener("popstate", onPopState);

  // ── Method 3: hashchange (hash-based routing) ──
  const onHashChange = () => handleChange("hashchange");
  window.addEventListener("hashchange", onHashChange);

  // ── Method 4: URL polling fallback ──
  // Catches edge cases where pushState is called by frameworks
  // that bypass our patch (e.g., using their own saved reference).
  pollInterval = setInterval(() => {
    if (location.href !== lastUrl) {
      handleChange("poll");
    }
  }, 500);

  // ── Cleanup ──
  function stop() {
    stopped = true;
    clearTimeout(debounceTimer);
    clearInterval(pollInterval);
    window.removeEventListener("popstate", onPopState);
    window.removeEventListener("hashchange", onHashChange);
    history.pushState = originalPushState;
    history.replaceState = originalReplaceState;
    if (mutationObserver) {
      mutationObserver.disconnect();
      mutationObserver = null;
    }
  }

  /**
   * After a route change, briefly observe the DOM for meaningful content
   * changes before triggering the callback. This handles SPAs that load
   * content asynchronously after route change.
   *
   * Strategy: Watch for changes in <main>, [role=main], or body.
   * Resolve when we see heading/table/card additions, or after 2s max.
   */
  function waitForDOMStable(callback) {
    if (mutationObserver) {
      mutationObserver.disconnect();
    }

    const target =
      document.querySelector("main") ||
      document.querySelector('[role="main"]') ||
      document.querySelector('[class*="content"]') ||
      document.body;

    if (!target) {
      callback();
      return;
    }

    let settled = false;
    let settleTimer = null;

    function settle() {
      if (settled) return;
      settled = true;
      if (mutationObserver) mutationObserver.disconnect();
      clearTimeout(settleTimer);
      callback();
    }

    // Max wait: 2 seconds
    settleTimer = setTimeout(settle, 2000);

    // Watch for meaningful DOM additions
    let changeCount = 0;
    mutationObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "childList" && mutation.addedNodes.length > 0) {
          for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              // Check if a meaningful element was added
              const tag = node.tagName?.toLowerCase();
              if (
                tag === "h1" || tag === "h2" || tag === "table" ||
                node.querySelector?.("h1, h2, table, [class*='card']")
              ) {
                settle();
                return;
              }
              changeCount++;
            }
          }
        }
      }
      // After enough generic changes, settle anyway
      if (changeCount > 20) settle();
    });

    mutationObserver.observe(target, {
      childList: true,
      subtree: true,
    });
  }

  return { stop };
}
