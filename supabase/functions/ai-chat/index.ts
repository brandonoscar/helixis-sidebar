/**
 * AI Chat Edge Function — Gemini
 *
 * Handles chat messages from the sidebar panel.
 * Calls Google Gemini API server-side (GEMINI_API_KEY never exposed to client).
 * Assembles business-specific context from:
 *   - Business AI Profile (from onboarding)
 *   - AI Memories (learned facts over time)
 *   - Entity snapshots (current page data)
 *   - Related tasks
 *   - Browser context session
 *   - Conversation history
 *
 * Returns structured response for rich UI rendering.
 *
 * Gemini API Reference:
 *   Endpoint: POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
 *   Auth: API key via x-goog-api-key header (server-side only)
 *   System instructions via top-level systemInstruction field
 *   Structured output via generationConfig.responseMimeType + responseSchema
 *
 * Source: https://ai.google.dev/gemini-api/docs
 */

import { getUserClient, getServiceClient } from "../_shared/supabase-client.ts";
import { corsHeaders, corsResponse } from "../_shared/cors.ts";

const GEMINI_MODEL = "gemini-2.0-flash";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// Structured output schema for Gemini responseSchema
const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    summary: {
      type: "string",
      description: "A concise 1-2 sentence answer to the user's question",
    },
    recommended_action: {
      type: "string",
      description: "The most practical next step the user should take. Empty string if none.",
    },
    why_it_matters: {
      type: "string",
      description: "Brief explanation of why this matters for the business. Empty string if not relevant.",
    },
    relevant_policies: {
      type: "array",
      items: { type: "string" },
      description: "List of specific business policies or rules that apply. Empty array if none known.",
    },
    confidence: {
      type: "string",
      description: "One of: high, medium, low. Based on whether the answer is grounded in provided business data or is a general suggestion.",
    },
    follow_up_questions: {
      type: "array",
      items: { type: "string" },
      description: "1-2 suggested follow-up questions the user might want to ask. Empty array if none.",
    },
    memory_extract: {
      type: "string",
      description: "If the user revealed a business fact, preference, or procedure worth remembering for future conversations, extract it here. Empty string if nothing to remember.",
    },
  },
  required: ["summary", "confidence"],
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsResponse();

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response("Unauthorized", { status: 401, headers: corsHeaders });
  }

  const supabase = getUserClient(authHeader);

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return new Response("Unauthorized", { status: 401, headers: corsHeaders });
  }

  const body = await req.json();
  const { workspaceId, message, contextSessionId, conversationHistory } = body;

  if (!workspaceId || !message) {
    return new Response(JSON.stringify({ error: "Missing workspaceId or message" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // ── Gather all context in parallel ──────────────────────────────

  const [
    businessProfileResult,
    memoriesResult,
    contextSessionResult,
    activeTasksResult,
  ] = await Promise.all([
    // Business AI Profile
    supabase
      .from("business_ai_profiles")
      .select("*")
      .eq("workspace_id", workspaceId)
      .single(),

    // AI Memories (workspace-wide + user-specific)
    supabase
      .from("ai_memories")
      .select("category, content")
      .eq("workspace_id", workspaceId)
      .eq("active", true)
      .or(`user_id.is.null,user_id.eq.${user.id}`)
      .order("created_at", { ascending: false })
      .limit(20),

    // Context session
    contextSessionId
      ? supabase
          .from("context_sessions")
          .select("url, page_type, detected_provider, detected_entities, page_text")
          .eq("id", contextSessionId)
          .single()
      : Promise.resolve({ data: null }),

    // Active tasks
    supabase
      .from("tasks")
      .select("title, task_type, priority, status, entity_type, entity_id, due_date")
      .eq("workspace_id", workspaceId)
      .in("status", ["open", "in_progress", "waiting"])
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  const businessProfile = businessProfileResult.data;
  const memories = memoriesResult.data ?? [];
  const contextData = contextSessionResult.data;
  const activeTasks = activeTasksResult.data ?? [];

  // Fetch entity snapshots if we have detected entities
  let entityContext = "";
  if (contextData?.detected_entities?.length > 0) {
    for (const ent of contextData.detected_entities) {
      const { data: snapshot } = await supabase
        .from("entity_snapshots")
        .select("data")
        .eq("workspace_id", workspaceId)
        .eq("entity_type", ent.type)
        .eq("external_id", String(ent.id))
        .single();

      if (snapshot?.data) {
        // Only include key fields, not the entire snapshot (minimize data sent to model)
        const summary = summarizeEntity(ent.type, snapshot.data);
        entityContext += `\n${ent.type} #${ent.id}: ${summary}\n`;
      }
    }
  }

  // ── Build system instruction ────────────────────────────────────

  const systemParts: string[] = [];

  // Core identity
  systemParts.push(`You are Helixis Copilot, an AI assistant embedded in a property management workflow tool.
You help property managers understand what is happening on their current page and decide what to do next.

CRITICAL RULES:
- Only answer based on the business context, policies, and data provided below.
- If a policy is not provided, say "I don't have a policy on file for this" rather than guessing.
- Clearly distinguish between facts from the data and your general suggestions.
- Be concise and actionable. Property managers are busy.
- Never fabricate tenant names, amounts, dates, or IDs. Only reference what is in the provided data.
- When uncertain, set confidence to "low" and explain what information would help.`);

  // Business profile (highest priority context)
  if (businessProfile) {
    systemParts.push(`\n--- BUSINESS PROFILE ---`);
    if (businessProfile.business_name) systemParts.push(`Business: ${businessProfile.business_name}`);
    if (businessProfile.operating_summary) systemParts.push(`Operations: ${businessProfile.operating_summary}`);
    if (businessProfile.communication_style) systemParts.push(`Communication style: ${businessProfile.communication_style}`);
    if (businessProfile.maintenance_rules) systemParts.push(`Maintenance rules: ${businessProfile.maintenance_rules}`);
    if (businessProfile.leasing_rules) systemParts.push(`Leasing rules: ${businessProfile.leasing_rules}`);
    if (businessProfile.payment_rules) systemParts.push(`Payment/late fee rules: ${businessProfile.payment_rules}`);
    if (businessProfile.owner_approval_rules) systemParts.push(`Owner approval rules: ${businessProfile.owner_approval_rules}`);
    if (businessProfile.important_exceptions) systemParts.push(`Important exceptions: ${businessProfile.important_exceptions}`);
    if (businessProfile.do_not_do) systemParts.push(`DO NOT DO: ${businessProfile.do_not_do}`);
    if (businessProfile.custom_instructions) systemParts.push(`Additional instructions: ${businessProfile.custom_instructions}`);
  } else {
    systemParts.push(`\nNo business profile has been configured yet. Provide general property management guidance but note that answers would be more specific with a configured business profile.`);
  }

  // AI memories
  if (memories.length > 0) {
    systemParts.push(`\n--- LEARNED FACTS ---`);
    for (const m of memories) {
      systemParts.push(`[${m.category}] ${m.content}`);
    }
  }

  // Current page context
  if (contextData) {
    systemParts.push(`\n--- CURRENT PAGE ---`);
    systemParts.push(`URL: ${contextData.url}`);
    if (contextData.page_type) systemParts.push(`Page type: ${contextData.page_type}`);
    if (contextData.detected_provider) systemParts.push(`Software: ${contextData.detected_provider}`);
  }

  // Entity data
  if (entityContext) {
    systemParts.push(`\n--- ENTITY DATA ---${entityContext}`);
  }

  // Active tasks
  if (activeTasks.length > 0) {
    systemParts.push(`\n--- ACTIVE TASKS ---`);
    for (const t of activeTasks) {
      systemParts.push(`- [${t.priority}] ${t.title} (${t.status})${t.due_date ? ` due ${t.due_date}` : ""}`);
    }
  }

  // Page text excerpt (lowest priority, truncated)
  if (contextData?.page_text) {
    systemParts.push(`\n--- PAGE CONTENT (excerpt) ---\n${contextData.page_text.slice(0, 2000)}`);
  }

  const systemInstruction = systemParts.join("\n");

  // ── Build conversation contents ─────────────────────────────────

  // Gemini uses "user" and "model" roles, must alternate, must start with "user"
  const contents: Array<{ role: string; parts: Array<{ text: string }> }> = [];

  const history = (conversationHistory ?? []).slice(-10);
  for (const m of history) {
    const geminiRole = m.role === "assistant" ? "model" : "user";

    // Gemini requires alternating roles — merge consecutive same-role messages
    if (contents.length > 0 && contents[contents.length - 1].role === geminiRole) {
      contents[contents.length - 1].parts.push({ text: m.content });
    } else {
      contents.push({ role: geminiRole, parts: [{ text: m.content }] });
    }
  }

  // Add current message
  if (contents.length > 0 && contents[contents.length - 1].role === "user") {
    contents[contents.length - 1].parts.push({ text: message });
  } else {
    contents.push({ role: "user", parts: [{ text: message }] });
  }

  // Ensure first message is "user" (Gemini requirement)
  if (contents.length > 0 && contents[0].role === "model") {
    contents.unshift({ role: "user", parts: [{ text: "(conversation context)" }] });
  }

  // ── Call Gemini API ─────────────────────────────────────────────

  const geminiKey = Deno.env.get("GEMINI_API_KEY");
  if (!geminiKey) {
    return new Response(JSON.stringify({ error: "AI service not configured" }), {
      status: 503,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const geminiBody = {
    systemInstruction: {
      parts: [{ text: systemInstruction }],
    },
    contents,
    generationConfig: {
      temperature: 0.7,
      topP: 0.9,
      maxOutputTokens: 1024,
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
    },
  };

  let aiRes: Response;
  try {
    aiRes = await fetch(GEMINI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": geminiKey,
      },
      body: JSON.stringify(geminiBody),
    });
  } catch (fetchErr) {
    console.error("Gemini fetch error:", fetchErr);
    return new Response(JSON.stringify({ error: "AI service unreachable" }), {
      status: 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!aiRes.ok) {
    const errText = await aiRes.text();
    // Log status only, not the full error body (may contain echoed prompts)
    console.error(`Gemini API error: ${aiRes.status}`);
    return new Response(JSON.stringify({ error: "AI service error" }), {
      status: 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const aiData = await aiRes.json();
  const rawText = aiData.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!rawText) {
    return new Response(JSON.stringify({ error: "Empty AI response" }), {
      status: 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Parse structured response
  let structured: Record<string, unknown>;
  try {
    structured = JSON.parse(rawText);
  } catch {
    // Fallback: treat as plain text if JSON parsing fails
    structured = {
      summary: rawText,
      confidence: "medium",
      recommended_action: "",
      why_it_matters: "",
      relevant_policies: [],
      follow_up_questions: [],
      memory_extract: "",
    };
  }

  // ── Store memory if AI extracted something worth remembering ─────

  const memoryExtract = structured.memory_extract as string;
  if (memoryExtract && memoryExtract.trim().length > 5) {
    const serviceClient = getServiceClient();
    await serviceClient.from("ai_memories").insert({
      workspace_id: workspaceId,
      user_id: user.id,
      category: "general",
      content: memoryExtract.trim(),
      source: "chat",
      confidence: 0.7,
    });
  }

  // Build display text for backward compatibility
  const displayText = buildDisplayText(structured);

  // ── Store chat messages ─────────────────────────────────────────

  await supabase.from("chat_messages").insert([
    {
      workspace_id: workspaceId,
      user_id: user.id,
      context_session_id: contextSessionId,
      role: "user",
      content: message,
    },
    {
      workspace_id: workspaceId,
      user_id: user.id,
      context_session_id: contextSessionId,
      role: "assistant",
      content: displayText,
      metadata: structured,
    },
  ]);

  // ── Return structured response ──────────────────────────────────

  return new Response(JSON.stringify({
    reply: displayText,
    structured,
  }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});

// ── Helpers ─────────────────────────────────────────────────────────

function summarizeEntity(type: string, data: Record<string, unknown>): string {
  // Extract only the most useful fields to minimize data sent to the model
  const fields: string[] = [];
  const pick = (keys: string[]) => {
    for (const k of keys) {
      const val = data[k];
      if (val !== null && val !== undefined && val !== "") {
        fields.push(`${k}: ${typeof val === "object" ? JSON.stringify(val) : val}`);
      }
    }
  };

  switch (type.toLowerCase()) {
    case "rental":
      pick(["Name", "PropertyName", "Address", "NumberOfUnits", "OperatingBankAccountId", "PropertyManagerId"]);
      break;
    case "unit":
      pick(["UnitNumber", "PropertyId", "MarketRent", "UnitBedrooms", "UnitBathrooms"]);
      break;
    case "tenant":
      pick(["FirstName", "LastName", "Email", "PhoneNumbers", "LeaseId"]);
      break;
    case "lease":
      pick(["LeaseType", "UnitId", "LeaseFromDate", "LeaseToDate", "RentAmount", "LeaseStatus"]);
      break;
    case "workorder":
      pick(["Title", "Description", "Status", "Priority", "RequestedByEntityId", "UnitId", "EntryAllowed"]);
      break;
    default:
      // Include first 10 keys for unknown types
      for (const [k, v] of Object.entries(data).slice(0, 10)) {
        if (v !== null && v !== undefined) fields.push(`${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`);
      }
  }

  return fields.join(", ");
}

function buildDisplayText(s: Record<string, unknown>): string {
  const parts: string[] = [];

  if (s.summary) parts.push(String(s.summary));

  if (s.recommended_action && String(s.recommended_action).length > 0) {
    parts.push(`\nRecommended: ${s.recommended_action}`);
  }

  if (s.why_it_matters && String(s.why_it_matters).length > 0) {
    parts.push(`\nWhy it matters: ${s.why_it_matters}`);
  }

  const policies = s.relevant_policies as string[];
  if (policies?.length > 0) {
    parts.push(`\nPolicies: ${policies.join("; ")}`);
  }

  return parts.join("") || "I couldn't generate a response.";
}
