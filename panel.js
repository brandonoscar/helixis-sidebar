/**
 * Helixis Copilot — Panel JS
 *
 * Handles:
 * - Tab navigation
 * - Auto-loading context on panel open / tab switch / route change
 * - Rendering entities, tasks, AI insights
 * - Chat with AI backend
 * - Task status updates
 *
 * Config is loaded from chrome.storage.local (set during onboarding):
 *   { supabaseUrl, supabaseAnonKey, workspaceId }
 */

// ─── Config ──────────────────────────────────────────────────────────

let CONFIG = { supabaseUrl: null, supabaseAnonKey: null, workspaceId: null, accessToken: null };
let currentContext = null;
let currentSessionId = null;
let chatHistory = [];

async function loadConfig() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["helixisConfig"], (result) => {
      if (result.helixisConfig) {
        CONFIG = { ...CONFIG, ...result.helixisConfig };
      }
      resolve();
    });
  });
}

function isConfigured() {
  return CONFIG.supabaseUrl && CONFIG.supabaseAnonKey && CONFIG.workspaceId;
}

// ─── API Client ──────────────────────────────────────────────────────

async function apiCall(functionName, body) {
  if (!isConfigured()) return null;

  const url = `${CONFIG.supabaseUrl}/functions/v1/${functionName}`;
  const headers = {
    "Content-Type": "application/json",
    "apikey": CONFIG.supabaseAnonKey,
  };
  if (CONFIG.accessToken) {
    headers["Authorization"] = `Bearer ${CONFIG.accessToken}`;
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.warn(`API ${functionName} failed:`, res.status);
      return null;
    }
    return await res.json();
  } catch (err) {
    console.warn(`API ${functionName} error:`, err);
    return null;
  }
}

// ─── Tab Navigation ──────────────────────────────────────────────────

const tabs = document.querySelectorAll(".tab");
const panels = document.querySelectorAll(".tab-panel");

tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    tabs.forEach((t) => t.classList.remove("active"));
    panels.forEach((p) => p.classList.remove("active"));
    tab.classList.add("active");
    document.getElementById(`tab-${tab.dataset.tab}`).classList.add("active");

    // Load tasks when switching to tasks tab
    if (tab.dataset.tab === "tasks") loadAllTasks();
  });
});

// ─── Context Handling ────────────────────────────────────────────────

function updateContextDisplay(ctx) {
  if (!ctx) return;

  currentContext = ctx;

  // Update context strip
  const display = document.getElementById("contextDisplay");
  const meta = document.getElementById("contextMeta");

  if (ctx.hostname) {
    display.textContent = ctx.hostname;
    display.classList.remove("is-empty");
  } else {
    display.textContent = "No active context";
    display.classList.add("is-empty");
  }

  // Show meta info if provider detected
  const metaParts = [];
  if (ctx.provider) metaParts.push(capitalize(ctx.provider));
  if (ctx.pageType && ctx.pageType !== "unknown") metaParts.push(formatPageType(ctx.pageType));
  if (ctx.entities?.length) metaParts.push(`${ctx.entities.length} entity${ctx.entities.length > 1 ? "s" : ""}`);

  meta.textContent = metaParts.join(" · ");
  meta.style.display = metaParts.length ? "" : "none";

  // Update status
  if (ctx.provider) {
    setStatus("connected", `${capitalize(ctx.provider)} detected`);
  } else {
    setStatus("ready", "Ready");
  }
}

function setStatus(state, text) {
  const pill = document.getElementById("statusPill");
  const statusText = document.getElementById("statusText");
  const dot = pill.querySelector(".status-dot");

  statusText.textContent = text;
  pill.className = `status-pill status-${state}`;
}

async function onContextUpdate(ctx) {
  updateContextDisplay(ctx);

  if (!isConfigured()) {
    // Show entities locally even without backend
    renderLocalEntities(ctx);
    return;
  }

  // Send to retrieval orchestrator
  setStatus("loading", "Loading...");

  const result = await apiCall("retrieve-context", {
    workspaceId: CONFIG.workspaceId,
    url: ctx.url,
    hostname: ctx.hostname,
    pageType: ctx.pageType,
    detectedProvider: ctx.provider,
    detectedEntities: ctx.entities,
    pageText: ctx.text,
  });

  if (result) {
    currentSessionId = result.sessionId;
    renderOverview(ctx, result);
    setStatus("connected", ctx.provider ? capitalize(ctx.provider) : "Connected");
  } else {
    renderLocalEntities(ctx);
    setStatus("ready", "Ready");
  }
}

// ─── Rendering: Overview ─────────────────────────────────────────────

function renderOverview(ctx, data) {
  const emptyEl = document.getElementById("overviewEmpty");
  const entSection = document.getElementById("entitiesSection");
  const taskSection = document.getElementById("relatedTasksSection");
  const activitySection = document.getElementById("activitySection");

  let hasContent = false;

  // Entities
  if (data.entities?.length > 0 || ctx.entities?.length > 0) {
    hasContent = true;
    entSection.style.display = "";
    renderEntities(data.entities?.length > 0 ? data.entities : ctx.entities.map(e => ({ ...e, snapshot: null })));
  } else {
    entSection.style.display = "none";
  }

  // Related tasks
  if (data.relatedTasks?.length > 0) {
    hasContent = true;
    taskSection.style.display = "";
    document.getElementById("relatedTaskCount").textContent = data.relatedTasks.length;
    renderTaskList("relatedTaskList", data.relatedTasks);
  } else if (data.recentTasks?.length > 0) {
    hasContent = true;
    taskSection.style.display = "";
    const header = taskSection.querySelector(".section-title");
    header.textContent = "Recent Tasks";
    document.getElementById("relatedTaskCount").textContent = data.recentTasks.length;
    renderTaskList("relatedTaskList", data.recentTasks);
  } else {
    taskSection.style.display = "none";
  }

  // Recent activity
  if (data.recentEvents?.length > 0) {
    hasContent = true;
    activitySection.style.display = "";
    renderActivity(data.recentEvents);
  } else {
    activitySection.style.display = "none";
  }

  emptyEl.style.display = hasContent ? "none" : "";
}

function renderLocalEntities(ctx) {
  const emptyEl = document.getElementById("overviewEmpty");
  const entSection = document.getElementById("entitiesSection");

  if (ctx.entities?.length > 0) {
    entSection.style.display = "";
    renderEntities(ctx.entities.map(e => ({ ...e, snapshot: null })));
    emptyEl.style.display = "none";
  } else {
    entSection.style.display = "none";
    emptyEl.style.display = "";
  }

  document.getElementById("relatedTasksSection").style.display = "none";
  document.getElementById("activitySection").style.display = "none";
}

function renderEntities(entities) {
  const list = document.getElementById("entityList");
  document.getElementById("entityCount").textContent = entities.length;

  list.innerHTML = entities.map((ent) => {
    const icon = entityIcon(ent.type);
    const label = capitalize(ent.type);
    const id = ent.id;
    const confidence = ent.confidence ? `${Math.round(ent.confidence * 100)}%` : "";
    const source = ent.source ? ent.source : "";

    let details = "";
    if (ent.snapshot) {
      const s = ent.snapshot;
      // Try to extract useful display fields from snapshot
      const name = s.Name || s.name || s.PropertyName || s.UnitNumber || "";
      const addr = s.Address?.AddressLine1 || s.address || "";
      if (name) details += `<div class="entity-detail">${escapeHtml(name)}</div>`;
      if (addr) details += `<div class="entity-detail sub">${escapeHtml(addr)}</div>`;
    }

    return `
      <div class="entity-card">
        <div class="entity-icon">${icon}</div>
        <div class="entity-info">
          <div class="entity-type">${label} #${escapeHtml(String(id))}</div>
          ${details}
        </div>
        <div class="entity-meta">
          ${confidence ? `<span class="confidence-badge">${confidence}</span>` : ""}
          ${source ? `<span class="source-badge">${source}</span>` : ""}
        </div>
      </div>
    `;
  }).join("");
}

function renderTaskList(containerId, tasks) {
  const list = document.getElementById(containerId);
  list.innerHTML = tasks.map((t) => `
    <div class="task-card" data-task-id="${t.id}">
      <div class="task-priority priority-${t.priority}"></div>
      <div class="task-info">
        <div class="task-title">${escapeHtml(t.title)}</div>
        <div class="task-meta">
          <span class="task-type">${escapeHtml(t.task_type)}</span>
          ${t.due_date ? `<span class="task-due">${formatDate(t.due_date)}</span>` : ""}
        </div>
      </div>
      <div class="task-status-group">
        <select class="task-status-select" data-task-id="${t.id}">
          <option value="open" ${t.status === "open" ? "selected" : ""}>Open</option>
          <option value="in_progress" ${t.status === "in_progress" ? "selected" : ""}>In Progress</option>
          <option value="waiting" ${t.status === "waiting" ? "selected" : ""}>Waiting</option>
          <option value="completed" ${t.status === "completed" ? "selected" : ""}>Completed</option>
        </select>
      </div>
    </div>
  `).join("");

  // Wire up status change handlers
  list.querySelectorAll(".task-status-select").forEach((select) => {
    select.addEventListener("change", async (e) => {
      const taskId = e.target.dataset.taskId;
      const newStatus = e.target.value;
      await apiCall("task-engine?action=update", { taskId, status: newStatus });
    });
  });
}

function renderActivity(events) {
  const list = document.getElementById("activityList");
  list.innerHTML = events.map((ev) => {
    const [entity, operation] = (ev.event_name || "").split(".");
    return `
      <div class="activity-item">
        <div class="activity-dot activity-${(operation || "").toLowerCase()}"></div>
        <div class="activity-info">
          <span class="activity-event">${escapeHtml(entity || "")} ${escapeHtml(operation || "")}</span>
          <span class="activity-id">#${escapeHtml(ev.entity_id || "")}</span>
        </div>
        <div class="activity-time">${timeAgo(ev.event_datetime)}</div>
      </div>
    `;
  }).join("");
}

// ─── Tasks Tab ───────────────────────────────────────────────────────

async function loadAllTasks() {
  if (!isConfigured()) return;

  const result = await apiCall("task-engine?action=list", {
    workspaceId: CONFIG.workspaceId,
    limit: 50,
  });

  const emptyEl = document.getElementById("tasksEmpty");
  const list = document.getElementById("allTaskList");

  if (result?.tasks?.length > 0) {
    emptyEl.style.display = "none";
    renderTaskList("allTaskList", result.tasks);
  } else {
    emptyEl.style.display = "";
    list.innerHTML = "";
  }
}

document.getElementById("refreshTasksBtn").addEventListener("click", loadAllTasks);

// ─── Chat ────────────────────────────────────────────────────────────

const chatInput = document.getElementById("chatInput");
const chatSend = document.getElementById("chatSend");
const chatMessages = document.getElementById("chatMessages");

async function sendChatMessage() {
  const message = chatInput.value.trim();
  if (!message) return;

  chatInput.value = "";
  chatInput.disabled = true;
  chatSend.disabled = true;
  appendChatBubble("user", message);

  if (!isConfigured()) {
    appendChatBubble("assistant", null, false, {
      summary: "Helixis backend is not configured yet.",
      recommended_action: "Set up your workspace in the onboarding flow to enable AI chat.",
      confidence: "low",
    });
    chatInput.disabled = false;
    chatSend.disabled = false;
    return;
  }

  const typingEl = appendChatBubble("assistant", "Thinking...", true);

  const result = await apiCall("ai-chat", {
    workspaceId: CONFIG.workspaceId,
    message,
    contextSessionId: currentSessionId,
    conversationHistory: chatHistory,
  });

  typingEl.remove();
  chatInput.disabled = false;
  chatSend.disabled = false;
  chatInput.focus();

  if (result?.structured) {
    appendChatBubble("assistant", result.reply, false, result.structured);
    chatHistory.push({ role: "user", content: message });
    chatHistory.push({ role: "assistant", content: result.reply });
    if (chatHistory.length > 20) chatHistory = chatHistory.slice(-20);
  } else if (result?.reply) {
    appendChatBubble("assistant", result.reply);
    chatHistory.push({ role: "user", content: message });
    chatHistory.push({ role: "assistant", content: result.reply });
    if (chatHistory.length > 20) chatHistory = chatHistory.slice(-20);
  } else {
    appendChatBubble("assistant", null, false, {
      summary: "Sorry, I couldn't get a response.",
      recommended_action: "Check your configuration or try again.",
      confidence: "low",
    });
  }
}

function appendChatBubble(role, text, isTyping = false, structured = null) {
  const welcome = chatMessages.querySelector(".chat-welcome");
  if (welcome) welcome.remove();

  const bubble = document.createElement("div");
  bubble.className = `chat-bubble chat-${role}${isTyping ? " typing" : ""}`;

  if (role === "user" || isTyping || !structured) {
    bubble.textContent = text || "";
  } else {
    bubble.innerHTML = renderStructuredResponse(structured);
  }

  chatMessages.appendChild(bubble);
  chatMessages.scrollTop = chatMessages.scrollHeight;

  // Wire follow-up question clicks
  if (structured?.follow_up_questions?.length) {
    bubble.querySelectorAll(".followup-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        chatInput.value = btn.textContent;
        sendChatMessage();
      });
    });
  }

  return bubble;
}

function renderStructuredResponse(s) {
  const parts = [];

  // Summary (always shown)
  if (s.summary) {
    parts.push(`<div class="ai-summary">${escapeHtml(s.summary)}</div>`);
  }

  // Recommended action
  if (s.recommended_action) {
    parts.push(`<div class="ai-action">
      <span class="ai-label">Recommended</span>
      <span>${escapeHtml(s.recommended_action)}</span>
    </div>`);
  }

  // Why it matters
  if (s.why_it_matters) {
    parts.push(`<div class="ai-why">
      <span class="ai-label">Why it matters</span>
      <span>${escapeHtml(s.why_it_matters)}</span>
    </div>`);
  }

  // Relevant policies
  if (s.relevant_policies?.length > 0) {
    const pols = s.relevant_policies.map((p) => `<li>${escapeHtml(p)}</li>`).join("");
    parts.push(`<div class="ai-policies">
      <span class="ai-label">Policies</span>
      <ul>${pols}</ul>
    </div>`);
  }

  // Confidence indicator
  if (s.confidence) {
    parts.push(`<div class="ai-confidence confidence-${s.confidence}">
      <span class="confidence-dot"></span>
      ${capitalize(s.confidence)} confidence
    </div>`);
  }

  // Follow-up questions
  if (s.follow_up_questions?.length > 0) {
    const btns = s.follow_up_questions
      .map((q) => `<button class="followup-btn">${escapeHtml(q)}</button>`)
      .join("");
    parts.push(`<div class="ai-followups">${btns}</div>`);
  }

  return parts.join("");
}

chatSend.addEventListener("click", sendChatMessage);
chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendChatMessage();
  }
});

// ─── Context Listeners ───────────────────────────────────────────────

// Listen for context updates from service worker
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "HELIXIS_CONTEXT_UPDATE" && msg.context) {
    onContextUpdate(msg.context);
  }
});

// On panel open, request context from active tab
async function initContext() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      try {
        const ctx = await chrome.tabs.sendMessage(tab.id, { type: "HELIXIS_GET_CONTEXT" });
        if (ctx) {
          onContextUpdate(ctx);
          return;
        }
      } catch {
        // Content script not available, use basic info
      }

      // Fallback: use tab info directly
      updateContextDisplay({
        url: tab.url,
        hostname: tab.url ? new URL(tab.url).hostname : null,
        title: tab.title,
        provider: null,
        pageType: null,
        entities: [],
        text: null,
        timestamp: new Date().toISOString(),
      });
    }
  } catch (err) {
    console.warn("Init context error:", err);
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
}

function formatPageType(pt) {
  return pt.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

function formatDate(d) {
  try {
    return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return d;
  }
}

function timeAgo(dateStr) {
  try {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "now";
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h`;
    const days = Math.floor(hrs / 24);
    return `${days}d`;
  } catch {
    return "";
  }
}

function entityIcon(type) {
  const icons = {
    rental: '<svg viewBox="0 0 16 16" fill="none"><path d="M2 13.5V6.5L8 2.5l6 4v7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/><path d="M6 13.5V9.5h4v4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    unit: '<svg viewBox="0 0 16 16" fill="none"><rect x="3" y="3" width="10" height="10" rx="1.5" stroke="currentColor" stroke-width="1.3"/><path d="M3 8h10" stroke="currentColor" stroke-width="1.3"/></svg>',
    tenant: '<svg viewBox="0 0 16 16" fill="none"><circle cx="8" cy="5.5" r="2.5" stroke="currentColor" stroke-width="1.3"/><path d="M3.5 13.5c0-2.5 2-4 4.5-4s4.5 1.5 4.5 4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
    lease: '<svg viewBox="0 0 16 16" fill="none"><path d="M4.5 2.5h7a1 1 0 011 1v9a1 1 0 01-1 1h-7a1 1 0 01-1-1v-9a1 1 0 011-1z" stroke="currentColor" stroke-width="1.3"/><path d="M6 5.5h4M6 8h4M6 10.5h2.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
    workorder: '<svg viewBox="0 0 16 16" fill="none"><path d="M10 2.5l3.5 3.5M3 13l7.5-7.5 3 3L6 16H3v-3z" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    vendor: '<svg viewBox="0 0 16 16" fill="none"><rect x="2.5" y="4" width="11" height="8.5" rx="1.5" stroke="currentColor" stroke-width="1.3"/><path d="M5.5 4V2.5h5V4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
  };
  return icons[type] || icons.rental;
}

// ─── Init ────────────────────────────────────────────────────────────

(async () => {
  await loadConfig();
  initContext();
})();
