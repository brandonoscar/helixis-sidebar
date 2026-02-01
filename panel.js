async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function getPageText(tabId) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => (document.body?.innerText || "").slice(0, 4000)
  });
  return results?.[0]?.result || "";
}

async function refreshTabUrl() {
  const tab = await getActiveTab();
  document.getElementById("tabUrl").textContent = tab?.url || "unknown";
}

document.getElementById("btn").addEventListener("click", async () => {
  const out = document.getElementById("out");
  out.textContent = "Loading...";
  const tab = await getActiveTab();
  const text = await getPageText(tab.id);
  out.textContent = text || "(No text found)";
});

refreshTabUrl();
