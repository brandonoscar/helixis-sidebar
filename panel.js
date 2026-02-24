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

async function refreshContext() {
  const tab = await getActiveTab();
  const el = document.getElementById("contextDisplay");
  if (tab?.url) {
    try {
      const hostname = new URL(tab.url).hostname;
      el.textContent = hostname || tab.url;
      el.classList.remove("is-empty");
    } catch {
      el.textContent = tab.url;
      el.classList.remove("is-empty");
    }
  } else {
    el.textContent = "No active context";
    el.classList.add("is-empty");
  }
}

function setLoading(on) {
  document.getElementById("loadingCard").classList.toggle("visible", on);
}

function showOutput(text) {
  document.getElementById("outputBody").textContent = text;
  document.getElementById("outputCard").classList.add("visible");
  document.getElementById("emptyState").style.display = "none";
}

function clearOutput() {
  document.getElementById("outputCard").classList.remove("visible");
  document.getElementById("emptyState").style.display = "";
}

// Primary card: click and keyboard
const primaryCard = document.getElementById("primaryCard");

primaryCard.addEventListener("click", async () => {
  setLoading(true);
  clearOutput();
  try {
    const tab = await getActiveTab();
    const text = await getPageText(tab.id);
    setLoading(false);
    showOutput(text || "(No text found on this page)");
  } catch (err) {
    setLoading(false);
    showOutput("Error: " + (err?.message || "Could not read page content"));
  }
});

primaryCard.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    primaryCard.click();
  }
});

document.getElementById("outputClose").addEventListener("click", clearOutput);

refreshContext();
