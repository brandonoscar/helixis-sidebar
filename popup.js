document.getElementById("open").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  
  if (typeof chrome.sidePanel !== "undefined") {
    try {
      await chrome.sidePanel.open({ tabId: tab.id });
      console.log("Side panel opened successfully");
    } catch (error) {
      console.log("Failed to open side panel, falling back to new tab:", error);
      chrome.tabs.create({ url: chrome.runtime.getURL("panel.html") });
    }
  } else {
    console.log("Side panel API not available, opening in new tab");
    chrome.tabs.create({ url: chrome.runtime.getURL("panel.html") });
  }
  
  window.close();
});
