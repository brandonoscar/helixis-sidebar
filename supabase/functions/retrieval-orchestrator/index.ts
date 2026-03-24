/**
 * Helixis Edge Function — Retrieval Orchestrator
 *
 * The bridge between browser context and backend data. Accepts a
 * BrowserContext payload (from the extension) and returns enriched
 * data: matching entities, open tasks, relevant policies, and
 * assembled AI context.
 *
 * This is the function the extension calls when the user opens the
 * panel or asks a question — it combines:
 *   1. Browser context (page type, entities, identifiers)
 *   2. Entity snapshots (from webhooks / syncs)
 *   3. Open tasks related to those entities
 *   4. Business policies matching the page context
 *   5. AI context blocks
 *
 * Auth: JWT (user-facing)
 */

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { authenticateRequest, AuthError } from "../_shared/auth.ts";

// ── Types ────────────────────────────────────────────────────

interface RetrievalRequest {
  business_id?: string;
  browser_context: {
    classification?: {
      pageType?: string;
      software?: string;
      confidence?: number;
    };
    entities?: {
      properties?: Array<{ name?: string; address?: string; confidence?: number }>;
      units?: Array<{ number?: string; confidence?: number }>;
      tenants?: Array<{ name?: string; email?: string; confidence?: number }>;
    };
    identifiers?: {
      emails?: string[];
      phones?: string[];
      addresses?: string[];
      dollarAmounts?: string[];
      referenceIds?: string[];
    };
    retrievalIntent?: {
      fetchTypes?: string[];
      fetchTasks?: boolean;
      fetchPolicies?: boolean;
      policyCategories?: string[];
      priority?: string;
    };
    visibleTextSummary?: string;
    selectedText?: string;
  };
}

// ── Main Handler ─────────────────────────────────────────────

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST required" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const { auth, supabaseClient } = await authenticateRequest(req);
    const body: RetrievalRequest = await req.json();
    const ctx = body.browser_context;

    if (!ctx) {
      return new Response(JSON.stringify({ error: "browser_context required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const intent = ctx.retrievalIntent ?? {};
    const fetchTypes = intent.fetchTypes ?? [];
    const fetchTasks = intent.fetchTasks ?? true;
    const fetchPolicies = intent.fetchPolicies ?? false;
    const policyCategories = intent.policyCategories ?? [];

    // ── 1. Find matching entity snapshots ──────────────────
    const matchedEntities: Record<string, unknown[]> = {};

    // Match by entity type from retrieval intent
    if (fetchTypes.length > 0) {
      const { data: entities } = await supabaseClient
        .from("entity_snapshots")
        .select("id, entity_type, external_id, display_name, data, provider, last_synced_at")
        .eq("business_id", auth.businessId)
        .in("entity_type", fetchTypes)
        .order("last_synced_at", { ascending: false })
        .limit(50);

      if (entities) {
        // Try to narrow down by matching browser-detected entities
        const narrowed = narrowEntityMatches(entities, ctx.entities, ctx.identifiers);
        for (const e of narrowed) {
          const type = e.entity_type as string;
          if (!matchedEntities[type]) matchedEntities[type] = [];
          matchedEntities[type].push(e);
        }
      }
    }

    // ── 2. Fetch related tasks ─────────────────────────────
    let tasks: unknown[] = [];

    if (fetchTasks) {
      const entityIds = Object.values(matchedEntities)
        .flat()
        .map((e: any) => e.id)
        .filter(Boolean);

      if (entityIds.length > 0) {
        // Tasks linked to matched entities
        const { data: linkedTasks } = await supabaseClient
          .from("task_entities")
          .select(`
            role,
            task:tasks (
              id, title, description, status, priority, source, created_at, due_at
            )
          `)
          .in("entity_id", entityIds);

        if (linkedTasks) {
          const seen = new Set<string>();
          for (const link of linkedTasks) {
            const t = link.task as any;
            if (t && !seen.has(t.id)) {
              seen.add(t.id);
              tasks.push(t);
            }
          }
        }
      }

      // Also fetch recent open tasks for this business if none linked
      if (tasks.length === 0) {
        const { data: recentTasks } = await supabaseClient
          .from("tasks")
          .select("id, title, description, status, priority, source, created_at, due_at")
          .eq("business_id", auth.businessId)
          .in("status", ["open", "in_progress"])
          .order("created_at", { ascending: false })
          .limit(10);

        if (recentTasks) tasks = recentTasks;
      }
    }

    // ── 3. Fetch relevant policies ─────────────────────────
    let policies: unknown[] = [];

    if (fetchPolicies) {
      let policyQuery = supabaseClient
        .from("business_policies")
        .select("id, title, category, content")
        .eq("business_id", auth.businessId)
        .eq("is_active", true);

      if (policyCategories.length > 0) {
        policyQuery = policyQuery.in("category", policyCategories);
      }

      const { data: policyData } = await policyQuery.limit(20);
      if (policyData) policies = policyData;
    }

    // ── 4. Fetch AI context blocks ─────────────────────────
    const { data: contextBlocks } = await supabaseClient
      .from("ai_context_blocks")
      .select("id, source_type, title, content, priority")
      .eq("business_id", auth.businessId)
      .eq("is_active", true)
      .order("priority", { ascending: true })
      .limit(30);

    // ── 5. Assemble response ───────────────────────────────
    const response = {
      pageContext: {
        pageType: ctx.classification?.pageType ?? "unknown",
        software: ctx.classification?.software ?? null,
        confidence: ctx.classification?.confidence ?? 0,
      },
      entities: matchedEntities,
      tasks,
      policies,
      contextBlocks: contextBlocks ?? [],
      retrievalMeta: {
        fetchTypes,
        entitiesMatched: Object.values(matchedEntities).flat().length,
        tasksFound: tasks.length,
        policiesFound: policies.length,
        timestamp: new Date().toISOString(),
      },
    };

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: err.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    console.error("Retrieval orchestrator error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// ── Entity matching helpers ──────────────────────────────────

/**
 * Narrow down entity snapshots by matching against browser-detected
 * entities and identifiers. Uses fuzzy name matching and email/ID lookups.
 */
function narrowEntityMatches(
  dbEntities: any[],
  browserEntities?: RetrievalRequest["browser_context"]["entities"],
  identifiers?: RetrievalRequest["browser_context"]["identifiers"]
): any[] {
  if (!browserEntities && !identifiers) return dbEntities;

  // Collect search terms from browser context
  const nameTerms = new Set<string>();
  const emailTerms = new Set<string>();
  const idTerms = new Set<string>();

  if (browserEntities?.properties) {
    for (const p of browserEntities.properties) {
      if (p.name) nameTerms.add(normalise(p.name));
      if (p.address) nameTerms.add(normalise(p.address));
    }
  }
  if (browserEntities?.units) {
    for (const u of browserEntities.units) {
      if (u.number) nameTerms.add(normalise(u.number));
    }
  }
  if (browserEntities?.tenants) {
    for (const t of browserEntities.tenants) {
      if (t.name) nameTerms.add(normalise(t.name));
      if (t.email) emailTerms.add(normalise(t.email));
    }
  }
  if (identifiers?.emails) {
    for (const e of identifiers.emails) emailTerms.add(normalise(e));
  }
  if (identifiers?.referenceIds) {
    for (const r of identifiers.referenceIds) idTerms.add(normalise(r));
  }

  // If no search terms, return all
  if (nameTerms.size === 0 && emailTerms.size === 0 && idTerms.size === 0) {
    return dbEntities;
  }

  // Score each entity
  const scored = dbEntities.map((entity) => {
    let score = 0;
    const displayNorm = normalise(entity.display_name ?? "");
    const externalNorm = normalise(entity.external_id ?? "");
    const dataEmail = normalise(entity.data?.email ?? "");

    for (const term of nameTerms) {
      if (displayNorm.includes(term) || term.includes(displayNorm)) score += 3;
    }
    for (const term of emailTerms) {
      if (dataEmail === term) score += 5;
    }
    for (const term of idTerms) {
      if (externalNorm === term) score += 5;
    }

    return { entity, score };
  });

  // Return entities with score > 0 first, then the rest (capped)
  const matched = scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score);
  const unmatched = scored.filter((s) => s.score === 0);

  const results = matched.map((s) => s.entity);
  // Include a few unmatched for context, up to a total of 20
  const remaining = 20 - results.length;
  if (remaining > 0) {
    results.push(...unmatched.slice(0, remaining).map((s) => s.entity));
  }

  return results;
}

function normalise(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, " ");
}
