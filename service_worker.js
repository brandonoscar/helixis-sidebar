/**
 * Helixis Copilot — Service Worker
 *
 * Handles:
 * - Side panel behavior
 * - Tab change detection → notify panel
 * - Route change relay from content script → panel
 * - Context caching
 * - Badge updates for open task count (#9)
 * - Periodic task polling (#6)
 */

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  console.log("Helixis Copilot installed — v0.3.0");

  // Set up periodic task polling (every 2 minutes)
  chrome.alarms.create("helixis-task-poll", { periodInMinutes: 2 });
});

// Cache latest context per tab
const tabContextCache = {};

// ─── Badge: Open Task Count ──────────────────────────────────────────

async function updateBadge() {
  try {
    const { helixisConfig } = await chrome.storage.local.get(["helixisConfig"]);
    if (!helixisConfig?.supabaseUrl || !helixisConfig?.supabaseAnonKey || !helixisConfig?.workspaceId) return;

    const headers = {
      "Content-Type": "application/json",
      "apikey": helixisConfig.supabaseAnonKey,
    };
    if (helixisConfig.accessToken) {
      headers["Authorization"] = `Bearer ${helixisConfig.accessToken}`;
    }

    const res = await fetch(`${helixisConfig.supabaseUrl}/functions/v1/task-engine?action=list`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        workspaceId: helixisConfig.workspaceId,
        status: "open",
        limit: 100,
      }),
    });

    if (!res.ok) return;
    const data = await res.json();
    const count = data?.tasks?.length ?? 0;

    if (count > 0) {
      chrome.action.setBadgeText({ text: String(count) });
      chrome.action.setBadgeBackgroundColor({ color: "#7c6ff0" });
    } else {
      chrome.action.setBadgeText({ text: "" });
    }

    // Notify panel of fresh task data for live updates
    chrome.runtime.sendMessage({
      type: "HELIXIS_TASKS_UPDATED",
      tasks: data?.tasks ?? [],
    }).catch(() => {});
  } catch {
    // Silently fail — badge is non-critical
  }
}

// Poll on alarm
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "helixis-task-poll") {
    updateBadge();
  }
});

// ─── Message Relay ───────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type === "HELIXIS_CONTEXT_READY" || msg.type === "HELIXIS_ROUTE_CHANGE") {
    const tabId = sender.tab?.id;
    if (tabId) {
      tabContextCache[tabId] = msg.context;
    }
    chrome.runtime.sendMessage({
      type: "HELIXIS_CONTEXT_UPDATE",
      context: msg.context,
      tabId,
    }).catch(() => {});
  }

  // Panel can request a badge refresh
  if (msg.type === "HELIXIS_REFRESH_BADGE") {
    updateBadge();
  }
});

// ─── Tab Activation ──────────────────────────────────────────────────

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const { tabId } = activeInfo;

  if (tabContextCache[tabId]) {
    chrome.runtime.sendMessage({
      type: "HELIXIS_CONTEXT_UPDATE",
      context: tabContextCache[tabId],
      tabId,
    }).catch(() => {});
    return;
  }

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

// Initial badge update
updateBadge();
