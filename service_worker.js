/**
 * Helixis Copilot — Service Worker
 *
 * Handles:
 * - Side panel behavior
 * - Tab change detection → notify panel
 * - Route change relay from content script → panel
 * - Context caching
 */

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  console.log("Helixis Copilot installed — v0.2.0");
});

// Cache latest context per tab
const tabContextCache = {};

// Relay messages from content scripts to the side panel
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type === "HELIXIS_CONTEXT_READY" || msg.type === "HELIXIS_ROUTE_CHANGE") {
    const tabId = sender.tab?.id;
    if (tabId) {
      tabContextCache[tabId] = msg.context;
    }
    // Forward to all extension pages (side panel)
    chrome.runtime.sendMessage({
      type: "HELIXIS_CONTEXT_UPDATE",
      context: msg.context,
      tabId,
    }).catch(() => {
      // Panel may not be open, ignore
    });
  }
});

// Detect tab activation changes
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const { tabId } = activeInfo;

  // Try to get cached context first
  if (tabContextCache[tabId]) {
    chrome.runtime.sendMessage({
      type: "HELIXIS_CONTEXT_UPDATE",
      context: tabContextCache[tabId],
      tabId,
    }).catch(() => {});
    return;
  }

  // Otherwise request context from the content script
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: "HELIXIS_GET_CONTEXT" });
    if (response) {
      tabContextCache[tabId] = response;
      chrome.runtime.sendMessage({
        type: "HELIXIS_CONTEXT_UPDATE",
        context: response,
        tabId,
      }).catch(() => {});
    }
  } catch {
    // Content script may not be injected, send a basic context
    try {
      const tab = await chrome.tabs.get(tabId);
      chrome.runtime.sendMessage({
        type: "HELIXIS_CONTEXT_UPDATE",
        context: {
          url: tab.url,
          hostname: tab.url ? new URL(tab.url).hostname : null,
          title: tab.title,
          provider: null,
          pageType: null,
          entities: [],
          text: null,
          timestamp: new Date().toISOString(),
        },
        tabId,
      }).catch(() => {});
    } catch {
      // Ignore
    }
  }
});

// Clean up cache when tabs close
chrome.tabs.onRemoved.addListener((tabId) => {
  delete tabContextCache[tabId];
});
