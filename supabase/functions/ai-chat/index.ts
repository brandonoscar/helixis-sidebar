/**
 * AI Chat Edge Function
 *
 * Handles chat messages from the sidebar panel.
 * Uses context (current page, entities, tasks) to generate relevant responses.
 * Proxies to Anthropic Claude API — keeps API key server-side.
 */

import { getUserClient } from "../_shared/supabase-client.ts";
import { corsHeaders, corsResponse } from "../_shared/cors.ts";

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

  // Get context from the current session if available
  let contextData = null;
  if (contextSessionId) {
    const { data: session } = await supabase
      .from("context_sessions")
      .select("url, page_type, detected_provider, detected_entities, page_text")
      .eq("id", contextSessionId)
      .single();
    contextData = session;
  }

  // Get entity snapshots for context
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
        entityContext += `\n${ent.type} #${ent.id}: ${JSON.stringify(snapshot.data, null, 2)}\n`;
      }
    }
  }

  // Get related tasks
  const { data: activeTasks } = await supabase
    .from("tasks")
    .select("title, task_type, priority, status, entity_type, entity_id, due_date")
    .eq("workspace_id", workspaceId)
    .in("status", ["open", "in_progress", "waiting"])
    .order("created_at", { ascending: false })
    .limit(10);

  // Build system prompt
  const systemPrompt = `You are Helixis Copilot, an AI assistant for property managers.
You help with property management tasks, answer questions about tenants, leases, properties, and maintenance.
Be concise and actionable. Reference specific data when available.

${contextData ? `Current page: ${contextData.url}
Page type: ${contextData.page_type ?? "unknown"}
Provider: ${contextData.detected_provider ?? "unknown"}` : ""}

${entityContext ? `Entity data:\n${entityContext}` : ""}

${activeTasks?.length ? `Active tasks:\n${activeTasks.map(t => `- [${t.priority}] ${t.title} (${t.status})`).join("\n")}` : ""}

${contextData?.page_text ? `Page content (excerpt):\n${contextData.page_text.slice(0, 3000)}` : ""}`;

  // Build messages for Claude
  const messages = [
    ...(conversationHistory ?? []).slice(-10).map((m: { role: string; content: string }) => ({
      role: m.role,
      content: m.content,
    })),
    { role: "user", content: message },
  ];

  // Call Anthropic API
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!anthropicKey) {
    return new Response(JSON.stringify({ error: "AI service not configured" }), {
      status: 503,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": anthropicKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      system: systemPrompt,
      messages,
    }),
  });

  if (!aiRes.ok) {
    const err = await aiRes.text();
    console.error("Anthropic API error:", err);
    return new Response(JSON.stringify({ error: "AI service error" }), {
      status: 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const aiData = await aiRes.json();
  const reply = aiData.content?.[0]?.text ?? "I couldn't generate a response.";

  // Store messages
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
      content: reply,
    },
  ]);

  return new Response(JSON.stringify({ reply }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
