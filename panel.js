let selectedTabId = null;

async function getAllTabs() {
  return await chrome.tabs.query({ currentWindow: true });
}

function truncateUrl(url, maxLen = 50) {
  return url.length > maxLen ? url.substring(0, maxLen) + "..." : url;
}

function isWebTab(tab) {
  return tab.url?.startsWith("http://") || tab.url?.startsWith("https://");
}

async function populateTabs() {
  const tabs = await getAllTabs();
  console.log("Loaded tabs:", tabs.length);

  const selectEl = document.getElementById("tabSelect");
  selectEl.innerHTML = "";

  const webTabs = tabs.filter(isWebTab);

  if (webTabs.length === 0) {
    selectEl.innerHTML = '<option>No web tabs found</option>';
    console.log("No web tabs found");
    return;
  }

  // Default to the most recent web tab
  const defaultTab = webTabs[webTabs.length - 1];
  selectedTabId = defaultTab.id;

  webTabs.forEach(tab => {
    const option = document.createElement("option");
    option.value = tab.id;
    option.textContent = `${tab.title || "(untitled)"} - ${truncateUrl(tab.url)}`;
    if (tab.id === defaultTab.id) {
      option.selected = true;
    }
    selectEl.appendChild(option);
  });

  console.log("Selected default tab ID:", selectedTabId, "URL:", defaultTab.url);
  updateTargetUrl();
}

function updateTargetUrl() {
  const selectEl = document.getElementById("tabSelect");
  const selectedOption = selectEl.options[selectEl.selectedIndex];
  const targetUrlEl = document.getElementById("targetUrl");
  targetUrlEl.textContent = selectedOption?.textContent || "No tab selected";
}

document.getElementById("tabSelect").addEventListener("change", () => {
  const selectEl = document.getElementById("tabSelect");
  selectedTabId = parseInt(selectEl.value, 10);
  console.log("Tab selected: ID", selectedTabId);
  updateTargetUrl();
});

document.getElementById("refreshTabs").addEventListener("click", () => {
  console.log("Refreshing tabs list");
  populateTabs();
});

async function getPageText(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => (document.body?.innerText || "").slice(0, 4000)
    });
    const text = results?.[0]?.result || "";
    console.log("Successfully extracted text from tab", tabId);
    return text;
  } catch (error) {
    console.log("Failed to extract text from tab", tabId, ":", error);
    return "";
  }
}

document.getElementById("btn").addEventListener("click", async () => {
  if (!selectedTabId) {
    console.log("No tab selected");
    document.getElementById("out").textContent = "(No tab selected)";
    return;
  }

  const out = document.getElementById("out");
  out.textContent = "Loading...";
  console.log("Getting page context from tab ID:", selectedTabId);
  const text = await getPageText(selectedTabId);
  out.textContent = text || "(No text found)";
});

// Initialize on page load
populateTabs();
