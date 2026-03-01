(function(){
  async function getTabs() {
    try {
      return await chrome.tabs.query({ currentWindow: true });
    } catch (e) {
      console.error('bridge.getTabs error', e);
      return [];
    }
  }

  async function getActiveTab() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      return tab || null;
    } catch (e) {
      console.error('bridge.getActiveTab error', e);
      return null;
    }
  }

  async function getPageText(tabId) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => (document.body?.innerText || "").slice(0, 4000)
      });
      return results?.[0]?.result || "";
    } catch (e) {
      console.error('bridge.getPageText error', e);
      return "";
    }
  }

  async function getSelection(tabId) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => (window.getSelection ? window.getSelection().toString() : (document.getSelection ? document.getSelection().toString() : ""))
      });
      return results?.[0]?.result || "";
    } catch (e) {
      console.error('bridge.getSelection error', e);
      return "";
    }
  }

  window.helixis = {
    getTabs,
    getActiveTab,
    getPageText,
    getSelection
  };
})();
