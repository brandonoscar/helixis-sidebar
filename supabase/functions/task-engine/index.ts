/**
 * Task Engine Edge Function
 *
 * CRUD for tasks + status updates from the sidebar panel.
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

  const url = new URL(req.url);
  const action = url.searchParams.get("action");
  const body = req.method !== "GET" ? await req.json() : {};

  switch (action) {
    case "list": {
      const { workspaceId, status, entityType, entityId, limit: lim } = body;
      let query = supabase
        .from("tasks")
        .select("*")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false })
        .limit(lim ?? 20);

      if (status) query = query.eq("status", status);
      if (entityType) query = query.eq("entity_type", entityType);
      if (entityId) query = query.eq("entity_id", entityId);

      const { data: tasks, error } = await query;
      if (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ tasks }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    case "create": {
      const { workspaceId, title, description, taskType, priority, entityType, entityId, provider, dueDate } = body;

      const { data: task, error } = await supabase
        .from("tasks")
        .insert({
          workspace_id: workspaceId,
          title,
          description,
          task_type: taskType ?? "general",
          priority: priority ?? "medium",
          entity_type: entityType,
          entity_id: entityId,
          provider,
          due_date: dueDate,
        })
        .select()
        .single();

      if (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ task }), {
        status: 201,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    case "update": {
      const { taskId, status: newStatus, priority: newPriority, assignedTo, dueDate: newDue } = body;

      const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (newStatus) {
        updates.status = newStatus;
        if (newStatus === "completed") updates.completed_at = new Date().toISOString();
      }
      if (newPriority) updates.priority = newPriority;
      if (assignedTo !== undefined) updates.assigned_to = assignedTo;
      if (newDue !== undefined) updates.due_date = newDue;

      const { data: task, error } = await supabase
        .from("tasks")
        .update(updates)
        .eq("id", taskId)
        .select()
        .single();

      if (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ task }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    default:
      return new Response(JSON.stringify({ error: "Unknown action" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
  }
});
