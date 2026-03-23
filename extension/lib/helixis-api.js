/**
 * Helixis Extension — API Layer
 *
 * High-level functions the extension UI calls.
 * Wraps the Supabase client with business-specific logic.
 */

import { callFunction, query, getSession } from "./supabase.js";

// ── Cached State ──────────────────────────────────────────────

let _businessContext = null;

/**
 * Get the current user's business membership.
 * Returns { business_id, role } or null.
 */
export async function getBusinessMembership() {
  const session = await getSession();
  if (!session) return null;

  const members = await query("business_members", {
    select: "business_id, role",
    filters: { user_id: session.user.id },
    limit: 10,
  });

  return members;
}

/**
 * Fetch the full business context from the backend.
 * This is the main call after login — loads everything the copilot needs.
 *
 * Returns:
 *   {
 *     business: { ... },
 *     onboarding: { ... },
 *     policies: [ ... ],
 *     integrations: [ ... ],
 *     documents: [ ... ],
 *     contextBlocks: [ ... ],
 *     member: { role: "..." }
 *   }
 */
export async function fetchBusinessContext(businessId) {
  const body = businessId ? { business_id: businessId } : {};
  _businessContext = await callFunction("business-context", body);
  return _businessContext;
}

/**
 * Get the cached business context (avoids re-fetching).
 */
export function getCachedContext() {
  return _businessContext;
}

/**
 * Clear the cached business context (on logout or business switch).
 */
export function clearCachedContext() {
  _businessContext = null;
}

/**
 * Send a chat message to the AI copilot.
 * The backend handles API keys — we just send the conversation.
 *
 * @param {Array} messages - Conversation history [{ role, content }]
 * @param {string} [pageContext] - Optional captured page text
 * @returns {{ response: string, usage: object }}
 */
export async function sendChatMessage(messages, pageContext) {
  return await callFunction("ai-chat", {
    messages,
    page_context: pageContext || undefined,
  });
}

/**
 * Call a third-party integration through the backend proxy.
 * The extension never sees the integration's API key.
 *
 * @param {string} provider - e.g., "zendesk", "slack"
 * @param {string} action - e.g., "list_tickets"
 * @param {object} params - Action-specific parameters
 */
export async function callIntegration(provider, action, params = {}) {
  return await callFunction("integration-proxy", {
    provider,
    action,
    params,
  });
}

/**
 * Upload a document. Returns the document record.
 */
export async function uploadDocument(file) {
  const session = await getSession();
  if (!session) throw new Error("Not authenticated");

  const formData = new FormData();
  formData.append("file", file);

  // Note: For file uploads we use fetch directly since callFunction sends JSON
  const res = await fetch(
    `${new URL(session.access_token).origin}/functions/v1/upload-document`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
      body: formData,
    }
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error || "Upload failed");
  }

  return await res.json();
}
