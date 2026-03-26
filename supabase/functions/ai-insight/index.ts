/**
 * AI Insight Edge Function — Gemini
 *
 * Generates a 1-2 sentence proactive insight about the current page context.
 * Called automatically on every page navigation (not user-initiated).
 * Kept lightweight: minimal context, low maxOutputTokens, fast response.
 */

import { getUserClient } from "../_shared/supabase-client.ts";
import { corsHeaders, corsResponse } from "../_shared/cors.ts";

const GEMINI_MODEL = "gemini-2.0-flash";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    insight: {
      type: "string",
      description: "A brief 1-2 sentence proactive insight about the current page",
    },
    urgency: {
      type: "string",
      enum: ["high", "medium", "low", "info"],
      description: "Urgency level of the insight",
    },
    action_hint: {
      type: "string",
      description: "A short suggested next action, or empty string if none",
    },
  },
  required: ["insight", "urgency", "action_hint"],
};

const SYSTEM_INSTRUCTION = `You are a proactive assistant for property managers.
Generate a brief, actionable insight about what's on this page.
Focus on: overdue items, upcoming deadlines, status changes, potential issues.
If nothing notable, say something helpful about the page context.
Keep it to 1-2 sentences max.
Be specific with numbers and dates from the data.`;

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

  const { workspaceId, contextSessionId } = await req.json();

  if (!workspaceId || !contextSessionId) {
    return new Response(JSON.stringify({ error: "Missing workspaceId or contextSessionId" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // ── Fetch context session + business profile + tasks in parallel ──

  const [contextResult, profileResult, tasksResult] = await Promise.all([
    supabase
      .from("context_sessions")
      .select("url, page_type, detected_provider, detected_entities, page_text")
      .eq("id", contextSessionId)
      .single(),

    supabase
      .from("business_ai_profiles")
      .select("business_name, operating_summary")
      .eq("workspace_id", workspaceId)
      .single(),

    supabase
      .from("tasks")
      .select("title, task_type, priority, status, due_date")
      .eq("workspace_id", workspaceId)
      .in("status", ["open", "in_progress", "waiting"])
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  const ctx = contextResult.data;
  if (!ctx) {
    return new Response(JSON.stringify({ error: "Context session not found" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // ── Fetch entity snapshots if detected entities exist ─────────────

  let entitySummaries = "";
  if (ctx.detected_entities?.length > 0) {
    for (const ent of ctx.detected_entities) {
      const { data: snapshot } = await supabase
        .from("entity_snapshots")
        .select("data")
        .eq("workspace_id", workspaceId)
        .eq("entity_type", ent.type)
        .eq("external_id", String(ent.id))
        .single();

      if (snapshot?.data) {
        const fields = Object.entries(snapshot.data as Record<string, unknown>)
          .slice(0, 8)
          .filter(([_, v]) => v !== null && v !== undefined && v !== "")
          .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`)
          .join(", ");
        entitySummaries += `\n${ent.type} #${ent.id}: ${fields}`;
      }
    }
  }

  // ── Build user prompt (minimal for speed) ─────────────────────────

  const promptParts: string[] = [];

  promptParts.push(`Page: ${ctx.url}`);
  if (ctx.page_type) promptParts.push(`Type: ${ctx.page_type}`);
  if (ctx.detected_provider) promptParts.push(`Software: ${ctx.detected_provider}`);

  const profile = profileResult.data;
  if (profile?.business_name) promptParts.push(`Business: ${profile.business_name}`);
  if (profile?.operating_summary) promptParts.push(`Operations: ${profile.operating_summary}`);

  if (entitySummaries) promptParts.push(`\nEntities:${entitySummaries}`);

  const tasks = tasksResult.data ?? [];
  if (tasks.length > 0) {
    promptParts.push("\nTasks:");
    for (const t of tasks) {
      promptParts.push(`- [${t.priority}] ${t.title} (${t.status})${t.due_date ? ` due ${t.due_date}` : ""}`);
    }
  }

  if (ctx.page_text) {
    promptParts.push(`\nPage excerpt:\n${ctx.page_text.slice(0, 1000)}`);
  }

  // ── Call Gemini API ───────────────────────────────────────────────

  const geminiKey = Deno.env.get("GEMINI_API_KEY");
  if (!geminiKey) {
    return new Response(JSON.stringify({ error: "AI service not configured" }), {
      status: 503,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let aiRes: Response;
  try {
    aiRes = await fetch(GEMINI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": geminiKey,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
        contents: [{ role: "user", parts: [{ text: promptParts.join("\n") }] }],
        generationConfig: {
          temperature: 0.5,
          maxOutputTokens: 256,
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA,
        },
      }),
    });
  } catch (fetchErr) {
    console.error("Gemini fetch error:", fetchErr);
    return new Response(JSON.stringify({ error: "AI service unreachable" }), {
      status: 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!aiRes.ok) {
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

  let result: Record<string, unknown>;
  try {
    result = JSON.parse(rawText);
  } catch {
    result = { insight: rawText, urgency: "info", action_hint: "" };
  }

  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
