/**
 * Helixis Edge Function — Task Engine
 *
 * Standalone endpoint for task management operations:
 *   - List tasks (with entity context)
 *   - Update task status
 *   - Manually create tasks
 *   - Re-evaluate rules against recent events (backfill)
 *
 * Auth: JWT (user-facing, unlike webhook-receiver)
 */

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { authenticateRequest, createServiceClient, AuthError } from "../_shared/auth.ts";
import { writeAuditLog } from "../_shared/audit.ts";

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const { auth, supabaseClient } = await authenticateRequest(req);
    const url = new URL(req.url);
    const action = url.searchParams.get("action") ?? "list";

    switch (action) {
      // ── List tasks with optional filters ───────────────
      case "list": {
        let query = supabaseClient
          .from("tasks")
          .select(`
            *,
            task_entities (
              role,
              entity:entity_snapshots (
                id, entity_type, external_id, display_name, data
              )
            )
          `)
          .eq("business_id", auth.businessId)
          .order("created_at", { ascending: false })
          .limit(50);

        // Optional filters from query params
        const status = url.searchParams.get("status");
        if (status) query = query.eq("status", status);

        const priority = url.searchParams.get("priority");
        if (priority) query = query.eq("priority", priority);

        const { data: tasks, error } = await query;
        if (error) throw error;

        return new Response(JSON.stringify({ tasks }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // ── Update a task's status ─────────────────────────
      case "update": {
        if (req.method !== "POST") {
          return new Response(JSON.stringify({ error: "POST required" }), {
            status: 405,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const body = await req.json();
        const { task_id, status, assigned_to } = body;

        if (!task_id) {
          return new Response(JSON.stringify({ error: "task_id required" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const updates: Record<string, unknown> = {};
        if (status) {
          updates.status = status;
          if (status === "done") updates.completed_at = new Date().toISOString();
        }
        if (assigned_to !== undefined) updates.assigned_to = assigned_to;

        const { data: task, error } = await supabaseClient
          .from("tasks")
          .update(updates)
          .eq("id", task_id)
          .eq("business_id", auth.businessId)
          .select()
          .single();

        if (error) throw error;

        await writeAuditLog({
          businessId: auth.businessId,
          userId: auth.userId,
          action: "task.updated",
          resourceType: "task",
          resourceId: task_id,
          metadata: updates,
        });

        return new Response(JSON.stringify({ task }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // ── Manually create a task ─────────────────────────
      case "create": {
        if (req.method !== "POST") {
          return new Response(JSON.stringify({ error: "POST required" }), {
            status: 405,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const body = await req.json();
        const { title, description, priority, entity_ids } = body;

        if (!title) {
          return new Response(JSON.stringify({ error: "title required" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const serviceClient = createServiceClient();

        const { data: task, error } = await serviceClient
          .from("tasks")
          .insert({
            business_id: auth.businessId,
            title,
            description: description ?? null,
            priority: priority ?? "medium",
            source: "manual",
            assigned_to: auth.userId,
          })
          .select()
          .single();

        if (error) throw error;

        // Link entities if provided
        if (Array.isArray(entity_ids) && entity_ids.length > 0) {
          const links = entity_ids.map((eid: string, i: number) => ({
            task_id: task.id,
            entity_id: eid,
            role: i === 0 ? "primary" : "related",
          }));
          await serviceClient.from("task_entities").insert(links);
        }

        await writeAuditLog({
          businessId: auth.businessId,
          userId: auth.userId,
          action: "task.created",
          resourceType: "task",
          resourceId: task.id,
          metadata: { title, source: "manual" },
        });

        return new Response(JSON.stringify({ task }), {
          status: 201,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // ── Get a single task with full context ────────────
      case "get": {
        const taskId = url.searchParams.get("task_id");
        if (!taskId) {
          return new Response(JSON.stringify({ error: "task_id required" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const { data: task, error } = await supabaseClient
          .from("tasks")
          .select(`
            *,
            source_event:webhook_events (
              id, event_type, provider, payload, received_at
            ),
            rule:task_rules (
              id, name, description
            ),
            task_entities (
              role,
              entity:entity_snapshots (
                id, entity_type, external_id, display_name, data, provider
              )
            )
          `)
          .eq("id", taskId)
          .eq("business_id", auth.businessId)
          .single();

        if (error) throw error;

        return new Response(JSON.stringify({ task }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      default:
        return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }
  } catch (err) {
    if (err instanceof AuthError) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: err.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    console.error("Task engine error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
