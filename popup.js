// tabs.query gives us the browser window's ID (not the popup's own window).
// This runs immediately on popup load — the popup is an invisible 1px shim.
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  const tab = tabs[0];
  if (!tab) { window.close(); return; }
  chrome.sidePanel.open({ windowId: tab.windowId }, () => {
    if (chrome.runtime.lastError) {
      console.error('[Helixis] sidePanel.open failed:', chrome.runtime.lastError.message);
    }
    window.close();
  });
});
