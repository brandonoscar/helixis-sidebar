/**
 * llm.js — LLM integration layer for demo assistant.
 *
 * Uses Gemini API with fake data context packs so the assistant
 * answers based on demo workspace data only.
 *
 * REPLACE LATER: Swap Gemini with your own LLM endpoint, or add
 * real Buildium data retrieval to the context pack builder.
 *
 * TO USE: Set VITE_GEMINI_API_KEY in .env.local
 */

import * as D from "./data.js";

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY ?? "";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;

// ─── System prompt ───────────────────────────────────────────────────────────

const BASE_SYSTEM_PROMPT = `You are Helixis Copilot, an AI assistant for property managers using Buildium.
You work inside a Chrome extension sidebar. Be concise, helpful, and professional.

IMPORTANT RULES:
- Only reference data from the CONTEXT PACK below. Never make up properties, tenants, or numbers.
- If asked about something not in the data, say you don't have that information in the current workspace.
- You manage a portfolio of ${D.properties.length} properties with ${D.tenants.length} tenants.
- Format currency with $ and commas. Format dates clearly.
- Keep responses under 3-4 sentences unless the user asks for detail.
- When drafting emails or SMS, write the full draft text.
- When summarizing, use bullet points.`;

// ─── Context pack builder ────────────────────────────────────────────────────

/**
 * Build a context pack string based on the current page type and relevant data.
 * This gets injected into the system prompt so the LLM has workspace context.
 *
 * REPLACE LATER: Pull real data from APIs instead of static imports.
 *
 * @param {string} pageType - Current page context type
 * @param {object} [extra] - Optional extra context (tenant, property, etc.)
 * @returns {string} context block for system prompt
 */
export function buildContextPack(pageType, extra = {}) {
  const sections = [];

  // Always include portfolio summary
  sections.push(`PORTFOLIO: ${D.properties.length} properties, ${D.tenants.length} tenants, ${D.leases.length} active leases.`);

  // Page-specific context
  switch (pageType) {
    case "lease_overview":
    case "lease_renewal": {
      const expiring = D.leases.filter(l => l.daysUntilExpiry <= 60);
      sections.push("EXPIRING LEASES (within 60 days):");
      expiring.forEach(l => {
        const t = D.getTenantById(l.tenantId);
        const p = D.getPropertyById(l.propertyId);
        sections.push(`  - ${t?.name} at ${p?.name}, ${l.unit}: $${l.rent}/mo, expires in ${l.daysUntilExpiry} days (${l.end})`);
      });
      sections.push("ALL LEASES:");
      D.leases.forEach(l => {
        const t = D.getTenantById(l.tenantId);
        sections.push(`  - ${t?.name}, ${l.unit}: $${l.rent}/mo, status: ${l.status}, expires: ${l.end}`);
      });
      break;
    }

    case "tenant_ledger":
    case "payment_entry": {
      sections.push("RECENT PAYMENTS:");
      D.payments.forEach(p => {
        const t = D.getTenantById(p.tenantId);
        if (p.status === "Overdue") {
          sections.push(`  - ${t?.name}: OVERDUE — $${p.balanceDue} due, ${p.daysPastDue} days past due`);
        } else {
          sections.push(`  - ${t?.name}: $${p.amount} on ${p.date} via ${p.method} (${p.status}) — ${p.type}`);
        }
      });
      break;
    }

    case "maintenance_request":
    case "work_order": {
      sections.push("MAINTENANCE REQUESTS:");
      D.maintenance.forEach(m => {
        const t = D.getTenantById(m.tenantId);
        sections.push(`  - ${m.issue} at ${m.unit} (${t?.name}): ${m.status}, Priority: ${m.priority}${m.vendor ? `, Vendor: ${m.vendor}` : ""}${m.estimatedCost ? `, Est: $${m.estimatedCost}` : ""}`);
      });
      sections.push("VENDORS:");
      D.vendors.forEach(v => sections.push(`  - ${v.name}: ${v.specialty}, ${v.phone}`));
      break;
    }

    case "owner_statement":
    case "reporting": {
      sections.push("OWNER STATEMENTS:");
      D.ownerStatements.forEach(s => {
        sections.push(`  ${s.owner} — ${s.period}: Income $${s.income.toLocaleString()}, Expenses $${s.expenses.toLocaleString()}, Net $${s.netIncome.toLocaleString()}`);
        s.items.forEach(i => sections.push(`    ${i.type === "income" ? "+" : "-"} ${i.desc}: $${Math.abs(i.amount).toLocaleString()}`));
      });
      break;
    }

    case "inbox": {
      sections.push("The user is viewing their email inbox. Help with email-related tasks like drafting replies, summarizing threads, or extracting action items.");
      break;
    }

    case "dashboard":
    default: {
      // Include a broad summary
      const expiring = D.leases.filter(l => l.daysUntilExpiry <= 60);
      const overdue = D.payments.filter(p => p.status === "Overdue");
      const openMaint = D.maintenance.filter(m => m.status !== "Completed");
      sections.push(`QUICK STATS: ${expiring.length} leases expiring soon, ${overdue.length} overdue payments, ${openMaint.length} open maintenance requests.`);
      sections.push("PROPERTIES:");
      D.properties.forEach(p => sections.push(`  - ${p.name}: ${p.address} (${p.units} units, Owner: ${p.owner})`));
      break;
    }
  }

  // Add extra context if provided
  if (extra.tenant) {
    sections.push(`\nCURRENT TENANT: ${extra.tenant.name}, ${extra.tenant.unit} at property ${extra.tenant.propertyId}, phone: ${extra.tenant.phone}, email: ${extra.tenant.email}`);
  }

  return sections.join("\n");
}

// ─── Chat function ───────────────────────────────────────────────────────────

/**
 * Send a message to the LLM with full workspace context.
 *
 * @param {string} userMessage
 * @param {Array} history - Previous messages in Gemini format [{role, parts}]
 * @param {string} pageType - Current page context type
 * @param {object} [extra] - Extra context for the pack
 * @returns {Promise<{ reply: string, updatedHistory: Array }>}
 */
export async function askDemoAssistant(userMessage, history = [], pageType = "dashboard", extra = {}) {
  if (!GEMINI_API_KEY) {
    return {
      reply: "Gemini API key not configured. Add VITE_GEMINI_API_KEY to your .env.local file to enable AI responses.",
      updatedHistory: history,
    };
  }

  const contextPack = buildContextPack(pageType, extra);
  const systemPrompt = `${BASE_SYSTEM_PROMPT}\n\nCURRENT PAGE: ${pageType}\n\n--- CONTEXT PACK ---\n${contextPack}\n--- END CONTEXT ---`;

  const updatedHistory = [...history, { role: "user", parts: [{ text: userMessage }] }];

  const res = await fetch(GEMINI_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: updatedHistory,
    }),
  });

  if (!res.ok) throw new Error(`Gemini API error: HTTP ${res.status}`);

  const data = await res.json();
  const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text || "(No response from model)";

  return {
    reply,
    updatedHistory: [...updatedHistory, { role: "model", parts: [{ text: reply }] }],
  };
}

// ─── One-shot AI actions (for button handlers) ───────────────────────────────

/**
 * Run a one-shot AI prompt with workspace context. Used by action buttons.
 *
 * @param {string} prompt - The specific instruction
 * @param {string} pageType
 * @returns {Promise<string>} the AI response text
 */
export async function aiAction(prompt, pageType = "dashboard") {
  if (!GEMINI_API_KEY) {
    return "[Demo mode — AI key not configured] " + prompt;
  }

  const contextPack = buildContextPack(pageType);
  const systemPrompt = `${BASE_SYSTEM_PROMPT}\n\nCURRENT PAGE: ${pageType}\n\n--- CONTEXT PACK ---\n${contextPack}\n--- END CONTEXT ---\n\nRespond directly to this action request. Be specific and use the data provided.`;

  const res = await fetch(GEMINI_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    }),
  });

  if (!res.ok) throw new Error(`Gemini API error: HTTP ${res.status}`);

  const data = await res.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text || "(No response)";
}
