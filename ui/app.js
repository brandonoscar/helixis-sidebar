let selectedTabId = null;

function truncateUrl(url, maxLen = 50) {
  if (!url) return '';
  return url.length > maxLen ? url.substring(0, maxLen) + "..." : url;
}

function isWebTab(tab) {
  return tab?.url?.startsWith("http://") || tab?.url?.startsWith("https://");
}

async function populateTabs() {
  const tabs = await window.helixis.getTabs();
  console.log("Loaded tabs:", tabs.length);

  const selectEl = document.getElementById("tabSelect");
  selectEl.innerHTML = "";

  const webTabs = tabs.filter(isWebTab);

  if (webTabs.length === 0) {
    selectEl.innerHTML = '<option>No web tabs found</option>';
    console.log("No web tabs found");
    document.getElementById('tabUrl').textContent = 'none';
    return;
  }

  const defaultTab = webTabs[webTabs.length - 1];
  selectedTabId = defaultTab.id;

  webTabs.forEach(tab => {
    const option = document.createElement("option");
    option.value = tab.id;
    option.textContent = `${tab.title || "(untitled)"} - ${truncateUrl(tab.url)}`;
    if (tab.id === defaultTab.id) option.selected = true;
    selectEl.appendChild(option);
  });

  console.log("Selected default tab ID:", selectedTabId, "URL:", defaultTab.url);
  updateTargetUrl();
  document.getElementById('tabUrl').textContent = defaultTab.url || 'unknown';
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
    const text = await window.helixis.getPageText(tabId);
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
