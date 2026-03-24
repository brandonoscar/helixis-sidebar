/**
 * Helixis Copilot — panel-app.js
 *
 * Production extension entry point with auth, backend context, and AI chat.
 * Replaces the original all-local panel.js with a connected experience.
 */

import {
  signIn,
  signOut,
  getSession,
  isAuthenticated,
} from "./lib/supabase.js";

import {
  fetchBusinessContext,
  getCachedContext,
  clearCachedContext,
  sendChatMessage,
  getBusinessMembership,
} from "./lib/helixis-api.js";

// ── STATE ─────────────────────────────────────────────

const state = {
  activeTab: "chat",
  messages: [],          // [{ role, text, ts }]
  reminders: [],         // [{ id, title, note, due, done }]
  context: null,         // { hostname, title, text, url, ts }
  businessContext: null,  // Full business context from backend
  businessId: null,
  aiConversation: [],    // [{ role, content }] — AI message format
};

// ── STORAGE (local UI state persists in chrome.storage.local) ──

async function loadState() {
  const data = await chrome.storage.local.get([
    "activeTab", "messages", "reminders", "context", "businessId",
  ]);
  if (data.activeTab)  state.activeTab  = data.activeTab;
  if (data.messages)   state.messages   = data.messages;
  if (data.reminders)  state.reminders  = data.reminders;
  if (data.context)    state.context    = data.context;
  if (data.businessId) state.businessId = data.businessId;
}

function saveKeys(...keys) {
  const patch = {};
  keys.forEach((k) => { patch[k] = state[k]; });
  chrome.storage.local.set(patch);
}

// ── SCREENS ───────────────────────────────────────────

function showScreen(screenId) {
  ["loginScreen", "businessPicker", "loadingScreen", "mainApp"].forEach((id) => {
    document.getElementById(id).hidden = id !== screenId;
  });
}

// ── AUTH FLOW ─────────────────────────────────────────

async function handleLogin() {
  const emailInput = document.getElementById("loginEmail");
  const passwordInput = document.getElementById("loginPassword");
  const errorEl = document.getElementById("loginError");
  const btn = document.getElementById("loginBtn");

  const email = emailInput.value.trim();
  const password = passwordInput.value;

  if (!email || !password) {
    errorEl.textContent = "Email and password are required";
    errorEl.hidden = false;
    return;
  }

  btn.disabled = true;
  btn.textContent = "Signing in...";
  errorEl.hidden = true;

  try {
    await signIn(email, password);
    await resolveBusinessAndLoad();
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = "Sign In";
  }
}

async function handleLogout() {
  await signOut();
  clearCachedContext();
  state.businessContext = null;
  state.businessId = null;
  state.aiConversation = [];
  saveKeys("businessId");
  showScreen("loginScreen");
}

/**
 * After login, resolve which business the user belongs to.
 * If multiple, show a picker. If one, load directly.
 */
async function resolveBusinessAndLoad() {
  showScreen("loadingScreen");

  try {
    const memberships = await getBusinessMembership();

    if (!memberships || memberships.length === 0) {
      showScreen("loginScreen");
      document.getElementById("loginError").textContent =
        "No business found. Complete onboarding first.";
      document.getElementById("loginError").hidden = false;
      return;
    }

    if (memberships.length === 1) {
      // Single business — load directly
      state.businessId = memberships[0].business_id;
      saveKeys("businessId");
      await loadBusinessAndShowApp();
    } else {
      // Multiple businesses — show picker
      renderBusinessPicker(memberships);
      showScreen("businessPicker");
    }
  } catch (err) {
    console.error("Failed to resolve business:", err);
    showScreen("loginScreen");
    document.getElementById("loginError").textContent =
      "Failed to load business data. Try again.";
    document.getElementById("loginError").hidden = false;
  }
}

function renderBusinessPicker(memberships) {
  const list = document.getElementById("businessList");
  list.innerHTML = "";

  memberships.forEach((m) => {
    const btn = document.createElement("button");
    btn.className = "business-option";
    btn.innerHTML = `
      <div>${esc(m.business_id)}</div>
      <div class="business-option-role">${esc(m.role)}</div>
    `;
    btn.addEventListener("click", async () => {
      state.businessId = m.business_id;
      saveKeys("businessId");
      showScreen("loadingScreen");
      await loadBusinessAndShowApp();
    });
    list.appendChild(btn);
  });
}

/**
 * Fetch business context from backend and show the main app.
 */
async function loadBusinessAndShowApp() {
  try {
    const ctx = await fetchBusinessContext(state.businessId);
    state.businessContext = ctx;

    // Update UI with business info
    const nameEl = document.getElementById("businessName");
    nameEl.textContent = ctx.business?.name || "";

    // Update status based on onboarding
    const statusText = document.getElementById("statusText");
    if (ctx.business?.onboarding_completed) {
      statusText.textContent = "Ready";
    } else {
      statusText.textContent = "Setup needed";
    }

    showScreen("mainApp");
    switchTab(state.activeTab);
  } catch (err) {
    console.error("Failed to load business context:", err);
    showScreen("loginScreen");
    document.getElementById("loginError").textContent =
      "Failed to load business context.";
    document.getElementById("loginError").hidden = false;
  }
}

// ── TAB SWITCHING ─────────────────────────────────────

function switchTab(name) {
  state.activeTab = name;
  saveKeys("activeTab");

  document.querySelectorAll(".tab").forEach((t) =>
    t.classList.toggle("active", t.dataset.tab === name)
  );
  document.querySelectorAll(".view").forEach((v) =>
    v.classList.toggle("active", v.id === `view-${name}`)
  );

  if (name === "context") renderContext();
}

// ── CHAT (now backed by AI) ───────────────────────────

function renderMessages() {
  const list = document.getElementById("messageList");
  const empty = document.getElementById("chatEmpty");

  list.querySelectorAll(".message").forEach((m) => m.remove());

  if (state.messages.length === 0) {
    empty.style.display = "";
    return;
  }

  empty.style.display = "none";
  const frag = document.createDocumentFragment();
  state.messages.forEach((m) => frag.appendChild(buildMsgEl(m)));
  list.appendChild(frag);
  list.scrollTop = list.scrollHeight;
}

function buildMsgEl(msg) {
  const row = document.createElement("div");
  row.className = `message message-${msg.role}`;
  const bubble = document.createElement("div");
  bubble.className = "message-bubble";
  bubble.textContent = msg.text;
  row.appendChild(bubble);
  return row;
}

function pushMessage(role, text) {
  const msg = { role, text, ts: Date.now() };
  state.messages.push(msg);
  saveKeys("messages");

  const list = document.getElementById("messageList");
  const empty = document.getElementById("chatEmpty");
  empty.style.display = "none";

  list.appendChild(buildMsgEl(msg));
  list.scrollTop = list.scrollHeight;
}

async function handleSend() {
  const input = document.getElementById("chatInput");
  const text = input.value.trim();
  if (!text) return;

  input.value = "";
  pushMessage("user", text);

  // Build AI conversation from recent messages
  state.aiConversation.push({ role: "user", content: text });

  // Show typing indicator
  const typingMsg = { role: "assistant", text: "Thinking..." };
  const typingEl = buildMsgEl(typingMsg);
  typingEl.classList.add("typing-indicator");
  const list = document.getElementById("messageList");
  list.appendChild(typingEl);
  list.scrollTop = list.scrollHeight;

  try {
    // Build page context string from structured browser context
    const pageCtx = state.context ? formatContextForAI(state.context) : undefined;
    const result = await sendChatMessage(
      state.aiConversation.slice(-20), // Last 20 messages
      pageCtx                          // Include structured page context
    );

    // Remove typing indicator
    typingEl.remove();

    const response = result.response;
    pushMessage("assistant", response);
    state.aiConversation.push({ role: "assistant", content: response });
  } catch (err) {
    typingEl.remove();
    pushMessage(
      "assistant",
      `Sorry, I couldn't process that: ${err.message}`
    );
  }
}

// ── REMINDERS (unchanged from original) ───────────────

function renderReminders() {
  const list = document.getElementById("remindersList");
  list.innerHTML = "";

  if (state.reminders.length === 0) {
    list.innerHTML =
      '<div class="reminders-empty">No reminders yet — press + to add one.</div>';
  } else {
    const frag = document.createDocumentFragment();
    state.reminders.forEach((r) => frag.appendChild(buildReminderEl(r)));
    list.appendChild(frag);
  }
  updateBadge();
}

function buildReminderEl(r) {
  const now = Date.now();
  const dueSoon = r.due && !r.done && new Date(r.due).getTime() - now < 86_400_000;
  const card = document.createElement("div");
  card.className = "reminder-card" + (r.done ? " done" : "");
  card.dataset.id = r.id;

  const titleHtml =
    esc(r.title) + (dueSoon ? '<span class="due-soon-badge">Soon</span>' : "");

  card.innerHTML = `
    <div class="reminder-content">
      <div class="reminder-title">${titleHtml}</div>
      ${r.note ? `<div class="reminder-note">${esc(r.note)}</div>` : ""}
      ${r.due ? `<div class="reminder-due">${fmtDue(r.due)}</div>` : ""}
    </div>
    <div class="reminder-btns">
      <button class="reminder-btn check" title="${r.done ? "Mark undone" : "Mark done"}">
        <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
          <path d="M1.5 5.5L4.5 8.5L9.5 2.5" stroke="currentColor" stroke-width="1.5"
                stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
      <button class="reminder-btn del" title="Delete">
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path d="M1.5 1.5L8.5 8.5M8.5 1.5L1.5 8.5" stroke="currentColor" stroke-width="1.5"
                stroke-linecap="round"/>
        </svg>
      </button>
    </div>`;

  card.querySelector(".check").addEventListener("click", () => toggleReminder(r.id));
  card.querySelector(".del").addEventListener("click", () => deleteReminder(r.id));
  return card;
}

function toggleReminder(id) {
  const r = state.reminders.find((x) => x.id === id);
  if (r) { r.done = !r.done; saveKeys("reminders"); renderReminders(); }
}

function deleteReminder(id) {
  state.reminders = state.reminders.filter((x) => x.id !== id);
  saveKeys("reminders");
  renderReminders();
}

function updateBadge() {
  const count = state.reminders.filter((r) => !r.done).length;
  document.getElementById("reminderBadge").textContent = count > 0 ? count : "";
}

function showForm(visible) {
  const form = document.getElementById("reminderForm");
  form.hidden = !visible;
  if (visible) {
    document.getElementById("reminderTitle").value = "";
    document.getElementById("reminderNote").value = "";
    document.getElementById("reminderDue").value = "";
    document.getElementById("reminderTitle").focus();
  }
}

function saveReminder() {
  const title = document.getElementById("reminderTitle").value.trim();
  if (!title) { document.getElementById("reminderTitle").focus(); return; }

  state.reminders.unshift({
    id: Date.now().toString(),
    title,
    note: document.getElementById("reminderNote").value.trim(),
    due: document.getElementById("reminderDue").value,
    done: false,
  });

  saveKeys("reminders");
  showForm(false);
  renderReminders();
}

// ── PAGE CONTEXT CAPTURE (Structured Browser Context) ──

/**
 * Request a full structured browser context capture via the service worker.
 * Returns a BrowserContext payload (see extension/lib/context/types.js).
 */
async function captureContext() {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Context capture timed out")), 5000);
    chrome.runtime.sendMessage({ type: "HELIXIS_REQUEST_FULL_CONTEXT" }, (response) => {
      clearTimeout(timer);
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (response?.error) {
        reject(new Error(response.error));
      } else {
        resolve(response);
      }
    });
  });
}

async function handleReadContext() {
  const card = document.getElementById("actionReadCtx");
  card.style.pointerEvents = "none";
  card.style.opacity = "0.55";

  try {
    const ctx = await captureContext();
    state.context = ctx;
    saveKeys("context");
    switchTab("chat");

    // Build a useful capture summary for the chat
    const parts = [`Captured context from ${ctx.raw.hostname}`];
    if (ctx.classification.pageType !== "unknown") {
      parts.push(`Page type: ${ctx.classification.pageType} (${Math.round(ctx.classification.confidence * 100)}%)`);
    }
    if (ctx.classification.software) {
      parts.push(`Software: ${ctx.classification.software}`);
    }
    const entityCount =
      ctx.entities.properties.length +
      ctx.entities.units.length +
      ctx.entities.tenants.length;
    if (entityCount > 0) {
      parts.push(`Found ${entityCount} entity clue(s)`);
    }
    if (ctx.selectedText) {
      parts.push(`Selected text: "${ctx.selectedText.slice(0, 80)}${ctx.selectedText.length > 80 ? "..." : ""}"`);
    }
    pushMessage("assistant", parts.join("\n"));
  } catch (err) {
    switchTab("chat");
    pushMessage("assistant", `Could not capture page: ${err.message || err}`);
  } finally {
    card.style.pointerEvents = "";
    card.style.opacity = "";
  }
}

function renderContext() {
  const ctx = state.context;

  // -- Page Info section --
  document.getElementById("ctxHostname").textContent = ctx?.raw?.hostname || "—";
  document.getElementById("ctxTitle").textContent = ctx?.raw?.pageTitle || "—";
  document.getElementById("ctxTimestamp").textContent = ctx?.timestamp ? fmtTs(ctx.timestamp) : "—";

  // -- Classification section --
  const typeEl = document.getElementById("ctxPageType");
  const softwareEl = document.getElementById("ctxSoftware");
  const confidenceEl = document.getElementById("ctxConfidence");
  const signalsEl = document.getElementById("ctxSignals");

  if (typeEl) typeEl.textContent = ctx?.classification?.pageType || "—";
  if (softwareEl) softwareEl.textContent = ctx?.classification?.software || "none";
  if (confidenceEl) confidenceEl.textContent = ctx?.classification?.confidence
    ? `${Math.round(ctx.classification.confidence * 100)}%`
    : "—";
  if (signalsEl) signalsEl.textContent = ctx?.classification?.signals?.join(", ") || "—";

  // -- Entities section --
  renderEntityList("ctxProperties", ctx?.entities?.properties);
  renderEntityList("ctxUnits", ctx?.entities?.units);
  renderEntityList("ctxTenants", ctx?.entities?.tenants);

  // -- Identifiers section --
  renderIdentifiers(ctx?.identifiers);

  // -- Selected text --
  const selEl = document.getElementById("ctxSelectedText");
  if (selEl) selEl.textContent = ctx?.selectedText || "(none)";

  // -- Visible text summary --
  const summaryEl = document.getElementById("ctxSummary");
  if (summaryEl) summaryEl.value = ctx?.visibleTextSummary || "";

  // -- Capture timing --
  const timingEl = document.getElementById("ctxTiming");
  if (timingEl) timingEl.textContent = ctx?.captureMs ? `${ctx.captureMs}ms` : "—";
}

function renderEntityList(containerId, entities) {
  const el = document.getElementById(containerId);
  if (!el) return;

  if (!entities || entities.length === 0) {
    el.innerHTML = '<span class="ctx-empty">none detected</span>';
    return;
  }

  el.innerHTML = entities.map((e) =>
    `<div class="ctx-entity">` +
    `<span class="ctx-entity-value">${esc(e.value)}</span>` +
    `<span class="ctx-entity-meta">${esc(e.field)} via ${esc(e.source)} (${Math.round(e.confidence * 100)}%)</span>` +
    `</div>`
  ).join("");
}

function renderIdentifiers(identifiers) {
  const el = document.getElementById("ctxIdentifiers");
  if (!el) return;

  if (!identifiers) {
    el.innerHTML = '<span class="ctx-empty">none found</span>';
    return;
  }

  const groups = [
    { label: "Emails", items: identifiers.emails },
    { label: "Phones", items: identifiers.phones },
    { label: "Addresses", items: identifiers.addresses },
    { label: "Amounts", items: identifiers.amounts },
    { label: "Dates", items: identifiers.dates },
    { label: "Reference IDs", items: identifiers.referenceIds },
    { label: "Names", items: identifiers.names },
    { label: "Unit Numbers", items: identifiers.unitNumbers },
  ].filter((g) => g.items && g.items.length > 0);

  if (groups.length === 0) {
    el.innerHTML = '<span class="ctx-empty">none found</span>';
    return;
  }

  el.innerHTML = groups.map((g) =>
    `<div class="ctx-id-group">` +
    `<span class="ctx-id-label">${esc(g.label)}</span>` +
    g.items.map((i) =>
      `<span class="ctx-id-value">${esc(i.normalized)}</span>`
    ).join("") +
    `</div>`
  ).join("");
}

async function handleRefreshContext() {
  const btn = document.getElementById("refreshCtxBtn");
  btn.disabled = true;
  btn.textContent = "Capturing...";

  try {
    const ctx = await captureContext();
    state.context = ctx;
    saveKeys("context");
    renderContext();
    pushMessage("assistant", `Context refreshed from ${ctx.raw.hostname}. Type: ${ctx.classification.pageType}`);
  } catch (err) {
    pushMessage("assistant", `Refresh failed: ${err.message || err}`);
  } finally {
    btn.disabled = false;
    btn.innerHTML = `
      <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
        <path d="M11 6.5A4.5 4.5 0 1 1 6.5 2a4.5 4.5 0 0 1 3.18 1.32M11 2v3H8"
              stroke="currentColor" stroke-width="1.3"
              stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      Refresh Context`;
  }
}

// ── AI CONTEXT FORMATTING ─────────────────────────────

/**
 * Format the structured browser context into a text representation
 * suitable for sending to the AI as page context.
 */
function formatContextForAI(ctx) {
  if (!ctx) return "";
  const parts = [];

  parts.push(`Current page: ${ctx.raw?.url || "unknown"}`);
  parts.push(`Page title: ${ctx.raw?.pageTitle || "unknown"}`);

  if (ctx.classification?.pageType !== "unknown") {
    parts.push(`Page type: ${ctx.classification.pageType}`);
  }
  if (ctx.classification?.software) {
    parts.push(`Software: ${ctx.classification.software}`);
  }

  // Entity clues
  if (ctx.entities?.properties?.length) {
    parts.push("Property clues: " + ctx.entities.properties.map(e => `${e.field}="${e.value}"`).join(", "));
  }
  if (ctx.entities?.units?.length) {
    parts.push("Unit clues: " + ctx.entities.units.map(e => `${e.field}="${e.value}"`).join(", "));
  }
  if (ctx.entities?.tenants?.length) {
    parts.push("Tenant clues: " + ctx.entities.tenants.map(e => `${e.field}="${e.value}"`).join(", "));
  }

  // Key identifiers
  const ids = ctx.identifiers;
  if (ids) {
    if (ids.emails?.length) parts.push("Emails on page: " + ids.emails.map(i => i.normalized).join(", "));
    if (ids.phones?.length) parts.push("Phones on page: " + ids.phones.map(i => i.normalized).join(", "));
    if (ids.amounts?.length) parts.push("Dollar amounts: " + ids.amounts.map(i => i.normalized).join(", "));
    if (ids.referenceIds?.length) parts.push("Reference IDs: " + ids.referenceIds.map(i => i.normalized).join(", "));
  }

  // Selected text
  if (ctx.selectedText) {
    parts.push(`User-selected text: "${ctx.selectedText}"`);
  }

  // Visible text summary (truncated for AI)
  if (ctx.visibleTextSummary) {
    parts.push("Page content summary:\n" + ctx.visibleTextSummary.slice(0, 2000));
  }

  return parts.join("\n");
}

// ── UTILS ─────────────────────────────────────────────

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtDue(due) {
  try {
    return new Date(due).toLocaleString([], {
      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    });
  } catch { return due; }
}

function fmtTs(ts) {
  try {
    return new Date(ts).toLocaleString([], {
      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    });
  } catch { return ts; }
}

// ── INIT ──────────────────────────────────────────────

async function init() {
  await loadState();

  // Auth: check if already logged in
  const authed = await isAuthenticated();

  if (authed && state.businessId) {
    // Already logged in with a selected business — load context
    await loadBusinessAndShowApp();
  } else if (authed) {
    // Logged in but no business selected — resolve
    await resolveBusinessAndLoad();
  } else {
    // Not logged in — show login
    showScreen("loginScreen");
  }

  // ── Event Listeners ──

  // Login
  document.getElementById("loginBtn").addEventListener("click", handleLogin);
  document.getElementById("loginPassword").addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleLogin();
  });

  // Logout
  document.getElementById("logoutBtn").addEventListener("click", handleLogout);

  // Tab bar
  document.querySelectorAll(".tab").forEach((tab) =>
    tab.addEventListener("click", () => switchTab(tab.dataset.tab))
  );

  // Chat
  renderMessages();
  document.getElementById("sendBtn").addEventListener("click", handleSend);
  document.getElementById("chatInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  });

  // Reminders
  renderReminders();
  document.getElementById("addReminderBtn").addEventListener("click", () => showForm(true));
  document.getElementById("reminderSave").addEventListener("click", saveReminder);
  document.getElementById("reminderCancel").addEventListener("click", () => showForm(false));

  // Actions
  const readCtxCard = document.getElementById("actionReadCtx");
  readCtxCard.addEventListener("click", handleReadContext);
  readCtxCard.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleReadContext(); }
  });

  // Context
  document.getElementById("refreshCtxBtn").addEventListener("click", handleRefreshContext);
}

init();
