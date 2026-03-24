/**
 * Retrieve Context Edge Function
 *
 * Called by the extension when the user navigates to a page.
 * Receives browser context (URL, page text, detected entities),
 * stores the session, and returns enriched data from entity snapshots + tasks.
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

  // Verify user
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return new Response("Unauthorized", { status: 401, headers: corsHeaders });
  }

  const body = await req.json();
  const { workspaceId, url, hostname, pageType, detectedProvider, detectedEntities, pageText } = body;

  if (!workspaceId || !url) {
    return new Response(JSON.stringify({ error: "Missing workspaceId or url" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Store context session
  const { data: session } = await supabase
    .from("context_sessions")
    .insert({
      workspace_id: workspaceId,
      user_id: user.id,
      url,
      hostname,
      page_type: pageType,
      detected_provider: detectedProvider,
      detected_entities: detectedEntities ?? [],
      page_text: pageText ? pageText.slice(0, 8000) : null,
    })
    .select("id")
    .single();

  // Fetch enrichment data for detected entities
  const entities: Array<{ type: string; id: string; snapshot: unknown }> = [];
  const relatedTasks: unknown[] = [];

  if (detectedEntities?.length > 0 && detectedProvider) {
    for (const ent of detectedEntities) {
      // Get entity snapshot
      const { data: snapshot } = await supabase
        .from("entity_snapshots")
        .select("data, fetched_at")
        .eq("workspace_id", workspaceId)
        .eq("provider", detectedProvider)
        .eq("entity_type", ent.type)
        .eq("external_id", String(ent.id))
        .single();

      entities.push({
        type: ent.type,
        id: ent.id,
        snapshot: snapshot?.data ?? null,
      });

      // Get related tasks
      const { data: tasks } = await supabase
        .from("tasks")
        .select("id, title, task_type, priority, status, due_date, created_at")
        .eq("workspace_id", workspaceId)
        .eq("entity_type", ent.type)
        .eq("entity_id", String(ent.id))
        .in("status", ["open", "in_progress", "waiting"])
        .order("created_at", { ascending: false })
        .limit(10);

      if (tasks) relatedTasks.push(...tasks);
    }
  }

  // Get recent tasks for the workspace regardless of entity
  const { data: recentTasks } = await supabase
    .from("tasks")
    .select("id, title, task_type, priority, status, entity_type, entity_id, due_date, created_at")
    .eq("workspace_id", workspaceId)
    .in("status", ["open", "in_progress", "waiting"])
    .order("created_at", { ascending: false })
    .limit(5);

  // Get recent webhook events for awareness
  const { data: recentEvents } = await supabase
    .from("webhook_events")
    .select("event_name, entity_type, entity_id, event_datetime")
    .eq("workspace_id", workspaceId)
    .order("event_datetime", { ascending: false })
    .limit(10);

  return new Response(JSON.stringify({
    sessionId: session?.id,
    entities,
    relatedTasks,
    recentTasks: recentTasks ?? [],
    recentEvents: recentEvents ?? [],
    pageType,
    detectedProvider,
  }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
