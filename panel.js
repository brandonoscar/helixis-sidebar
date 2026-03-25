/**
 * Helixis Copilot — Panel JS (v0.3.0)
 *
 * Features:
 * - Auth: login/logout with Supabase email+password
 * - Onboarding: generate business AI profile from answers
 * - Context: detect page, entities, tasks, activity
 * - AI Insights: proactive per-page insights on Overview tab
 * - Chat: structured AI responses, chat history loading, task creation from chat
 * - Tasks: list, status updates, polling for live updates
 * - Settings: AI memory management, business profile status, logout
 * - Error handling: connection banner, retry
 */

// ─── Config & State ─────────────────────────────────────────────────

let CONFIG = { supabaseUrl: null, supabaseAnonKey: null, workspaceId: null, accessToken: null };
let currentContext = null;
let currentSessionId = null;
let chatHistory = [];
let chatHistoryLoaded = false;
let connectionOk = true;

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

async function saveConfig() {
  return new Promise((resolve) => {
    chrome.storage.local.set({ helixisConfig: CONFIG }, resolve);
  });
}

function isConfigured() {
  return CONFIG.supabaseUrl && CONFIG.supabaseAnonKey && CONFIG.workspaceId;
}

function isLoggedIn() {
  return isConfigured() && CONFIG.accessToken;
}

// ─── API Client ─────────────────────────────────────────────────────

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
      if (res.status === 401) handleAuthExpired();
      console.warn(`API ${functionName} failed:`, res.status);
      return null;
    }
    showConnectionOk();
    return await res.json();
  } catch (err) {
    console.warn(`API ${functionName} error:`, err);
    showConnectionError();
    return null;
  }
}

// Supabase Auth REST call (not edge function)
async function supabaseAuth(endpoint, body) {
  if (!CONFIG.supabaseUrl || !CONFIG.supabaseAnonKey) return null;
  try {
    const res = await fetch(`${CONFIG.supabaseUrl}/auth/v1/${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": CONFIG.supabaseAnonKey,
      },
      body: JSON.stringify(body),
    });
    return await res.json();
  } catch (err) {
    console.warn("Auth error:", err);
    return null;
  }
}

// ─── Screen Navigation ──────────────────────────────────────────────

function showScreen(screenId) {
  document.querySelectorAll(".screen").forEach((s) => (s.style.display = "none"));
  const el = document.getElementById(screenId);
  if (el) el.style.display = "";
}

// ─── Auth: Login ────────────────────────────────────────────────────

const loginForm = document.getElementById("loginForm");
const loginError = document.getElementById("loginError");

if (loginForm) {
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    loginError.textContent = "";
    const btn = document.getElementById("loginSubmitBtn");
    btn.disabled = true;
    btn.textContent = "Signing in...";

    const email = document.getElementById("loginEmail").value.trim();
    const password = document.getElementById("loginPassword").value;

    const result = await supabaseAuth("token?grant_type=password", { email, password });

    if (result?.access_token) {
      CONFIG.accessToken = result.access_token;
      await saveConfig();
      await initApp();
    } else {
      loginError.textContent = result?.error_description || result?.msg || "Sign in failed. Check your credentials.";
    }
    btn.disabled = false;
    btn.textContent = "Sign In";
  });
}

function handleAuthExpired() {
  CONFIG.accessToken = null;
  saveConfig();
  showScreen("loginScreen");
}

// ─── Auth: Logout ───────────────────────────────────────────────────

const logoutBtn = document.getElementById("logoutBtn");
if (logoutBtn) {
  logoutBtn.addEventListener("click", async () => {
    CONFIG.accessToken = null;
    await saveConfig();
    chatHistory = [];
    chatHistoryLoaded = false;
    showScreen("loginScreen");
  });
}

// ─── Onboarding: AI Profile Generation ──────────────────────────────

const onboardingForm = document.getElementById("onboardingForm");
const onboardingError = document.getElementById("onboardingError");
const skipOnboardingBtn = document.getElementById("skipOnboardingBtn");

if (onboardingForm) {
  onboardingForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    onboardingError.textContent = "";
    const btn = document.getElementById("onboardingSubmitBtn");
    btn.disabled = true;
    btn.textContent = "Generating...";

    const result = await apiCall("generate-ai-profile", {
      workspaceId: CONFIG.workspaceId,
      businessName: document.getElementById("obBusinessName").value.trim(),
      onboardingAnswers: {
        portfolioSize: document.getElementById("obPortfolio").value.trim(),
        maintenanceProcess: document.getElementById("obMaintenance").value.trim(),
        leasingProcess: document.getElementById("obLeasing").value.trim(),
        paymentPolicy: document.getElementById("obPayment").value.trim(),
        ownerRelationship: document.getElementById("obOwnerApproval").value.trim(),
        communicationPreferences: document.getElementById("obCommunication").value.trim(),
        thingsToAvoid: document.getElementById("obDoNotDo").value.trim(),
        specialRules: document.getElementById("obCustom").value.trim(),
      },
    });

    if (result?.profile) {
      showScreen("appScreen");
      initContext();
    } else {
      onboardingError.textContent = "Failed to generate profile. You can skip and set it up later.";
    }
    btn.disabled = false;
    btn.textContent = "Generate AI Profile";
  });
}

if (skipOnboardingBtn) {
  skipOnboardingBtn.addEventListener("click", () => {
    showScreen("appScreen");
    initContext();
  });
}

// ─── Connection Error Handling (#10) ────────────────────────────────

function showConnectionError() {
  if (connectionOk) {
    connectionOk = false;
    const banner = document.getElementById("connectionBanner");
    if (banner) banner.style.display = "";
  }
}

function showConnectionOk() {
  if (!connectionOk) {
    connectionOk = true;
    const banner = document.getElementById("connectionBanner");
    if (banner) banner.style.display = "none";
  }
}

const retryBtn = document.getElementById("retryConnectionBtn");
if (retryBtn) {
  retryBtn.addEventListener("click", () => {
    showConnectionOk();
    initContext();
  });
}

// ─── Tab Navigation ─────────────────────────────────────────────────

const tabs = document.querySelectorAll(".tab");
const panels = document.querySelectorAll(".tab-panel");

tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    tabs.forEach((t) => t.classList.remove("active"));
    panels.forEach((p) => p.classList.remove("active"));
    tab.classList.add("active");
    document.getElementById(`tab-${tab.dataset.tab}`).classList.add("active");

    if (tab.dataset.tab === "tasks") loadAllTasks();
    if (tab.dataset.tab === "chat" && !chatHistoryLoaded) loadChatHistory();
  });
});

// ─── Settings Drawer (#7) ───────────────────────────────────────────

const settingsToggle = document.getElementById("settingsToggle");
const settingsClose = document.getElementById("settingsClose");
const settingsDrawer = document.getElementById("settingsDrawer");

if (settingsToggle) {
  settingsToggle.addEventListener("click", () => {
    settingsDrawer.style.display = settingsDrawer.style.display === "none" ? "" : "none";
    if (settingsDrawer.style.display !== "none") loadMemories();
  });
}
if (settingsClose) {
  settingsClose.addEventListener("click", () => {
    settingsDrawer.style.display = "none";
  });
}

const editProfileBtn = document.getElementById("editProfileBtn");
if (editProfileBtn) {
  editProfileBtn.addEventListener("click", () => {
    settingsDrawer.style.display = "none";
    showScreen("onboardingScreen");
  });
}

// ─── AI Memories (#7) ───────────────────────────────────────────────

async function loadMemories() {
  if (!isConfigured()) return;

  // Direct Supabase REST query for memories
  const url = `${CONFIG.supabaseUrl}/rest/v1/ai_memories?workspace_id=eq.${CONFIG.workspaceId}&active=eq.true&order=created_at.desc&limit=30`;
  const headers = {
    "apikey": CONFIG.supabaseAnonKey,
    "Authorization": `Bearer ${CONFIG.accessToken}`,
  };

  try {
    const res = await fetch(url, { headers });
    if (!res.ok) return;
    const memories = await res.json();
    renderMemories(memories);
  } catch {
    // Silently fail
  }
}

function renderMemories(memories) {
  const list = document.getElementById("memoryList");
  if (!list) return;

  if (!memories?.length) {
    list.innerHTML = '<div class="memory-empty">No memories yet. Chat with the AI and it will start learning.</div>';
    return;
  }

  list.innerHTML = memories.map((m) => `
    <div class="memory-item" data-memory-id="${m.id}">
      <div class="memory-content">
        <span class="memory-category">${escapeHtml(m.category)}</span>
        <span>${escapeHtml(m.content)}</span>
      </div>
      <button class="memory-delete" data-memory-id="${m.id}" title="Delete">x</button>
    </div>
  `).join("");

  list.querySelectorAll(".memory-delete").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.memoryId;
      // Soft delete via REST
      await fetch(`${CONFIG.supabaseUrl}/rest/v1/ai_memories?id=eq.${id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "apikey": CONFIG.supabaseAnonKey,
          "Authorization": `Bearer ${CONFIG.accessToken}`,
        },
        body: JSON.stringify({ active: false }),
      });
      btn.closest(".memory-item").remove();
    });
  });
}

// ─── Context Handling ───────────────────────────────────────────────

function updateContextDisplay(ctx) {
  if (!ctx) return;
  currentContext = ctx;

  const display = document.getElementById("contextDisplay");
  const meta = document.getElementById("contextMeta");

  if (ctx.hostname) {
    display.textContent = ctx.hostname;
    display.classList.remove("is-empty");
  } else {
    display.textContent = "No active context";
    display.classList.add("is-empty");
  }

  const metaParts = [];
  if (ctx.provider) metaParts.push(capitalize(ctx.provider));
  if (ctx.pageType && ctx.pageType !== "unknown") metaParts.push(formatPageType(ctx.pageType));
  if (ctx.entities?.length) metaParts.push(`${ctx.entities.length} entity${ctx.entities.length > 1 ? "s" : ""}`);

  meta.textContent = metaParts.join(" · ");
  meta.style.display = metaParts.length ? "" : "none";

  if (ctx.provider) {
    setStatus("connected", `${capitalize(ctx.provider)} detected`);
  } else {
    setStatus("ready", "Ready");
  }
}

function setStatus(state, text) {
  const pill = document.getElementById("statusPill");
  const statusText = document.getElementById("statusText");
  statusText.textContent = text;
  pill.className = `status-pill status-${state}`;
}

async function onContextUpdate(ctx) {
  updateContextDisplay(ctx);

  if (!isConfigured()) {
    renderLocalEntities(ctx);
    return;
  }

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
    // Fetch proactive AI insight (#2)
    fetchInsight();
  } else {
    renderLocalEntities(ctx);
    setStatus("ready", "Ready");
  }
}

// ─── Proactive AI Insights (#2) ─────────────────────────────────────

async function fetchInsight() {
  if (!currentSessionId || !isConfigured()) return;

  const section = document.getElementById("aiInsightSection");
  const card = document.getElementById("aiInsightCard");
  const urgencyEl = document.getElementById("insightUrgency");
  const actionEl = document.getElementById("insightAction");

  card.textContent = "Analyzing page...";
  section.style.display = "";

  const result = await apiCall("ai-insight", {
    workspaceId: CONFIG.workspaceId,
    contextSessionId: currentSessionId,
  });

  if (result?.insight) {
    card.textContent = result.insight;
    if (urgencyEl && result.urgency) {
      urgencyEl.textContent = result.urgency;
      urgencyEl.className = `insight-urgency urgency-${result.urgency}`;
    }
    if (actionEl && result.action_hint) {
      actionEl.textContent = result.action_hint;
      actionEl.style.display = "";
    } else if (actionEl) {
      actionEl.style.display = "none";
    }
  } else {
    section.style.display = "none";
  }
}

// ─── Rendering: Overview ────────────────────────────────────────────

function renderOverview(ctx, data) {
  const emptyEl = document.getElementById("overviewEmpty");
  const entSection = document.getElementById("entitiesSection");
  const taskSection = document.getElementById("relatedTasksSection");
  const activitySection = document.getElementById("activitySection");

  let hasContent = false;

  if (data.entities?.length > 0 || ctx.entities?.length > 0) {
    hasContent = true;
    entSection.style.display = "";
    renderEntities(data.entities?.length > 0 ? data.entities : ctx.entities.map(e => ({ ...e, snapshot: null })));
  } else {
    entSection.style.display = "none";
  }

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
      const name = s.Name || s.name || s.PropertyName || s.UnitNumber || "";
      const addr = s.Address?.AddressLine1 || s.address || "";
      if (name) details += `<div class="entity-detail">${escapeHtml(name)}</div>`;
      if (addr) details += `<div class="entity-detail sub">${escapeHtml(addr)}</div>`;
    }

    // Deep link to Buildium (#extension gap: deep linking)
    const buildiumLink = currentContext?.provider === "buildium" && currentContext?.hostname
      ? `https://${currentContext.hostname}/manager/app/${ent.type === "workorder" ? "maintenance" : ent.type + "s"}/${id}`
      : "";

    return `
      <div class="entity-card${buildiumLink ? " entity-clickable" : ""}" ${buildiumLink ? `data-link="${escapeHtml(buildiumLink)}"` : ""}>
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

  // Deep link click handler
  list.querySelectorAll(".entity-clickable").forEach((card) => {
    card.addEventListener("click", () => {
      const link = card.dataset.link;
      if (link) chrome.tabs.create({ url: link });
    });
  });
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

  list.querySelectorAll(".task-status-select").forEach((select) => {
    select.addEventListener("change", async (e) => {
      const taskId = e.target.dataset.taskId;
      const newStatus = e.target.value;
      await apiCall("task-engine?action=update", { taskId, status: newStatus });
      chrome.runtime.sendMessage({ type: "HELIXIS_REFRESH_BADGE" });
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

// ─── Tasks Tab ──────────────────────────────────────────────────────

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

// ─── Chat: History Loading (#3) ─────────────────────────────────────

async function loadChatHistory() {
  if (!isConfigured() || chatHistoryLoaded) return;
  chatHistoryLoaded = true;

  const result = await apiCall("chat-history", {
    workspaceId: CONFIG.workspaceId,
    limit: 30,
  });

  if (result?.messages?.length > 0) {
    const welcome = chatMessages.querySelector(".chat-welcome");
    if (welcome) welcome.remove();

    for (const msg of result.messages) {
      if (msg.role === "assistant" && msg.metadata) {
        appendChatBubble("assistant", msg.content, false, msg.metadata);
      } else {
        appendChatBubble(msg.role, msg.content);
      }
      chatHistory.push({ role: msg.role, content: msg.content });
    }
    if (chatHistory.length > 20) chatHistory = chatHistory.slice(-20);
  }
}

// ─── Chat: Send Message ─────────────────────────────────────────────

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

    // Task creation from chat (#5)
    if (result.structured.create_task) {
      handleTaskCreation(result.structured.create_task);
    }
  } else if (result?.reply) {
    appendChatBubble("assistant", result.reply);
    chatHistory.push({ role: "user", content: message });
    chatHistory.push({ role: "assistant", content: result.reply });
    if (chatHistory.length > 20) chatHistory = chatHistory.slice(-20);
  } else {
    appendChatBubble("assistant", null, false, {
      summary: "Sorry, I couldn't get a response.",
      recommended_action: "Check your connection or try again.",
      confidence: "low",
    });
  }
}

// ─── Chat: Task Creation from AI (#5) ───────────────────────────────

async function handleTaskCreation(taskData) {
  const result = await apiCall("task-engine?action=create", {
    workspaceId: CONFIG.workspaceId,
    title: taskData.title,
    description: taskData.description || "",
    taskType: taskData.task_type || "general",
    priority: taskData.priority || "medium",
    entityType: taskData.entity_type || currentContext?.entities?.[0]?.type,
    entityId: taskData.entity_id || currentContext?.entities?.[0]?.id,
  });

  if (result?.task) {
    appendChatBubble("assistant", null, false, {
      summary: `Task created: "${result.task.title}"`,
      confidence: "high",
    });
    chrome.runtime.sendMessage({ type: "HELIXIS_REFRESH_BADGE" });
  }
}

// ─── Chat: Rendering ────────────────────────────────────────────────

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

  if (s.summary) {
    parts.push(`<div class="ai-summary">${escapeHtml(s.summary)}</div>`);
  }

  if (s.recommended_action) {
    parts.push(`<div class="ai-action">
      <span class="ai-label">Recommended</span>
      <span>${escapeHtml(s.recommended_action)}</span>
    </div>`);
  }

  if (s.why_it_matters) {
    parts.push(`<div class="ai-why">
      <span class="ai-label">Why it matters</span>
      <span>${escapeHtml(s.why_it_matters)}</span>
    </div>`);
  }

  if (s.relevant_policies?.length > 0) {
    const pols = s.relevant_policies.map((p) => `<li>${escapeHtml(p)}</li>`).join("");
    parts.push(`<div class="ai-policies">
      <span class="ai-label">Policies</span>
      <ul>${pols}</ul>
    </div>`);
  }

  if (s.confidence) {
    parts.push(`<div class="ai-confidence confidence-${s.confidence}">
      <span class="confidence-dot"></span>
      ${capitalize(s.confidence)} confidence
    </div>`);
  }

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

// ─── Context Listeners ──────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "HELIXIS_CONTEXT_UPDATE" && msg.context) {
    onContextUpdate(msg.context);
  }
  // Live task updates from polling (#6)
  if (msg.type === "HELIXIS_TASKS_UPDATED" && msg.tasks) {
    const activeTab = document.querySelector('.tab.active');
    if (activeTab?.dataset.tab === "tasks") {
      const emptyEl = document.getElementById("tasksEmpty");
      const list = document.getElementById("allTaskList");
      if (msg.tasks.length > 0) {
        emptyEl.style.display = "none";
        renderTaskList("allTaskList", msg.tasks);
      }
    }
  }
});

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
        // Content script not available
      }

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

// ─── Helpers ────────────────────────────────────────────────────────

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

// ─── App Init ───────────────────────────────────────────────────────

async function initApp() {
  if (isLoggedIn()) {
    showScreen("appScreen");
    initContext();
    chrome.runtime.sendMessage({ type: "HELIXIS_REFRESH_BADGE" });
  } else if (isConfigured()) {
    showScreen("loginScreen");
  } else {
    // Not configured at all — show login with a note
    showScreen("loginScreen");
  }
}

(async () => {
  await loadConfig();
  await initApp();
})();
