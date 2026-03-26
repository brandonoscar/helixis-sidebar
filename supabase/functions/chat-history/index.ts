/**
 * Chat History Edge Function
 *
 * Fetches recent chat messages for a workspace/user pair.
 * Used when the chat tab opens to populate conversation history.
 * Supports cursor-based pagination via `before` timestamp.
 */

import { getUserClient } from "../_shared/supabase-client.ts";
import { corsHeaders, corsResponse } from "../_shared/cors.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return corsResponse();

  try {
    // --- Auth ---
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = getUserClient(authHeader);
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // --- Parse body ---
    const { workspaceId, limit: rawLimit, before } = await req.json();

    if (!workspaceId) {
      return new Response(JSON.stringify({ error: "workspaceId is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const limit = Math.min(Math.max(Number(rawLimit) || 50, 1), 100);

    // --- Query ---
    // Fetch one extra row to determine if there are more messages beyond this page.
    let query = supabase
      .from("chat_messages")
      .select("id, role, content, metadata, created_at")
      .eq("workspace_id", workspaceId)
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(limit + 1);

    if (before) {
      query = query.lt("created_at", before);
    }

    const { data, error } = await query;

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const hasMore = data.length > limit;
    const messages = (hasMore ? data.slice(0, limit) : data).reverse();

    return new Response(JSON.stringify({ messages, hasMore }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message ?? "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
