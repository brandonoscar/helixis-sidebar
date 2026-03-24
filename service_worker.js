/**
 * Helixis Copilot — Service Worker (Background Script)
 *
 * Responsibilities:
 *   1. Opens side panel on extension icon click
 *   2. Routes context requests between panel and content scripts
 *   3. Tracks active tab for context awareness
 *   4. Caches the latest light context per tab
 *
 * The service worker does NOT do heavy context extraction — that
 * happens in the content script (which has DOM access). The service
 * worker is a coordinator.
 */

// ── Setup ─────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  console.log("Helixis Copilot installed");
});

// ── Tab Tracking ──────────────────────────────────────

// Cache the last known light context per tab so the panel can
// instantly show what page the user is on without waiting for
// a full capture round-trip.
const tabContextCache = new Map();

// When the active tab changes, request a light context snapshot
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const response = await chrome.tabs.sendMessage(activeInfo.tabId, {
      type: "HELIXIS_GET_LIGHT_CONTEXT",
      tabId: activeInfo.tabId,
    });
    if (response) {
      tabContextCache.set(activeInfo.tabId, response);
    }
  } catch {
    // Content script not loaded on this tab (chrome://, new tab, etc.)
    tabContextCache.delete(activeInfo.tabId);
  }
});

// When a tab navigates, update the cache
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (changeInfo.status === "complete") {
    try {
      const response = await chrome.tabs.sendMessage(tabId, {
        type: "HELIXIS_GET_LIGHT_CONTEXT",
        tabId,
      });
      if (response) {
        tabContextCache.set(tabId, response);
      }
    } catch {
      tabContextCache.delete(tabId);
    }
  }
});

// Clean up when tabs close
chrome.tabs.onRemoved.addListener((tabId) => {
  tabContextCache.delete(tabId);
});

// SPA route-change: content script notifies us when an in-page navigation
// happened (pushState, popstate, hashchange). Re-fetch a light context
// snapshot so the panel always shows the current page.
// The content script's SPA observer sends this after DOM stabilisation.
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type === "HELIXIS_ROUTE_CHANGED" && sender.tab?.id) {
    const tabId = sender.tab.id;
    (async () => {
      try {
        const response = await chrome.tabs.sendMessage(tabId, {
          type: "HELIXIS_GET_LIGHT_CONTEXT",
          tabId,
        });
        if (response) {
          tabContextCache.set(tabId, response);
        }
      } catch {
        tabContextCache.delete(tabId);
      }
    })();
  }
  // Don't return true — this listener doesn't use sendResponse
});

// ── Message Routing ───────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.type) {
    // Panel requests the cached light context for quick display
    case "HELIXIS_GET_CACHED_CONTEXT": {
      (async () => {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const cached = tab ? tabContextCache.get(tab.id) : null;
        sendResponse(cached || null);
      })();
      return true;
    }

    // Panel requests a full context capture from the active tab
    case "HELIXIS_REQUEST_FULL_CONTEXT": {
      (async () => {
        try {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (!tab) {
            sendResponse({ error: "No active tab" });
            return;
          }
          const ctx = await chrome.tabs.sendMessage(tab.id, {
            type: "HELIXIS_GET_CONTEXT",
            tabId: tab.id,
          });
          // Also update cache with the classification
          if (ctx) {
            tabContextCache.set(tab.id, {
              tabId: tab.id,
              url: ctx.raw.url,
              hostname: ctx.raw.hostname,
              pageTitle: ctx.raw.pageTitle,
              pageType: ctx.classification.pageType,
              software: ctx.classification.software,
              timestamp: ctx.timestamp,
            });
          }
          sendResponse(ctx);
        } catch (err) {
          sendResponse({ error: err.message || "Context capture failed" });
        }
      })();
      return true;
    }

    // Panel requests just the selected text
    case "HELIXIS_REQUEST_SELECTION": {
      (async () => {
        try {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (!tab) {
            sendResponse({ selectedText: "" });
            return;
          }
          const result = await chrome.tabs.sendMessage(tab.id, {
            type: "HELIXIS_GET_SELECTION",
          });
          sendResponse(result);
        } catch {
          sendResponse({ selectedText: "" });
        }
      })();
      return true;
    }

    default:
      break;
  }
});
