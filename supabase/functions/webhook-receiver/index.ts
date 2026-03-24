/**
 * Helixis Edge Function — Webhook Receiver
 *
 * Receives webhook events from integrations (Buildium, etc.),
 * validates them, stores the raw event, then normalises and
 * runs the task engine pipeline.
 *
 * Auth: HMAC signature verification (no JWT — webhooks come from
 * the provider, not the user's browser).
 *
 * Pipeline: receive → validate → store → normalise → enrich → evaluate rules → create tasks
 */

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import {
  resolveEntityType,
  normaliseBuildiumEntity,
  extractRelatedEntityIds,
} from "../_shared/buildium-normalizer.ts";

// ── Helpers ──────────────────────────────────────────────────

function createServiceClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
}

/**
 * Verify Buildium webhook HMAC signature.
 * Buildium sends a X-Buildium-Signature header with HMAC-SHA256.
 */
async function verifyBuildiumSignature(
  body: string,
  signature: string | null,
  secret: string
): Promise<boolean> {
  if (!signature) return false;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  const expected = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  // Constant-time comparison
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Resolve business_id from a provider-specific identifier.
 * For Buildium, the webhook URL includes the business slug or
 * we look up by integration provider match.
 */
async function resolveBusinessFromWebhook(
  db: ReturnType<typeof createClient>,
  provider: string,
  urlPath: string
): Promise<{ businessId: string; integrationId: string } | null> {
  // URL format: /webhook-receiver?provider=buildium&business=<slug>
  const url = new URL(urlPath, "https://placeholder.com");
  const businessSlug = url.searchParams.get("business");

  if (!businessSlug) return null;

  const { data: business } = await db
    .from("businesses")
    .select("id")
    .eq("slug", businessSlug)
    .single();

  if (!business) return null;

  const { data: integration } = await db
    .from("integrations")
    .select("id")
    .eq("business_id", business.id)
    .eq("provider", provider)
    .eq("status", "active")
    .single();

  if (!integration) return null;

  return { businessId: business.id, integrationId: integration.id };
}

// ── Task Rule Engine ─────────────────────────────────────────

interface TaskRule {
  id: string;
  name: string;
  conditions: Record<string, unknown>;
  task_template: {
    title?: string;
    description?: string;
    priority?: string;
  };
}

/**
 * Evaluate a rule's conditions against a webhook payload.
 * Conditions is a flat object of { "field.path": expected_value }.
 * Supports simple equality and array-contains.
 */
function evaluateConditions(
  conditions: Record<string, unknown>,
  payload: Record<string, unknown>
): boolean {
  for (const [path, expected] of Object.entries(conditions)) {
    const actual = getNestedValue(payload, path);
    if (Array.isArray(expected)) {
      if (!expected.includes(actual)) return false;
    } else if (actual !== expected) {
      return false;
    }
  }
  return true;
}

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object" && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

/**
 * Interpolate template strings with payload values.
 * Supports {{Field.Path}} placeholders.
 */
function interpolateTemplate(template: string, payload: Record<string, unknown>): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (_match, path: string) => {
    const val = getNestedValue(payload, path.trim());
    return val != null ? String(val) : "";
  });
}

// ── Main Handler ─────────────────────────────────────────────

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const db = createServiceClient();

  try {
    const url = new URL(req.url);
    const provider = url.searchParams.get("provider") ?? "unknown";
    const rawBody = await req.text();
    let payload: Record<string, unknown>;

    try {
      payload = JSON.parse(rawBody);
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── 1. Validate signature ──────────────────────────────
    if (provider === "buildium") {
      const webhookSecret = Deno.env.get("BUILDIUM_WEBHOOK_SECRET");
      if (webhookSecret) {
        const sig = req.headers.get("x-buildium-signature");
        const valid = await verifyBuildiumSignature(rawBody, sig, webhookSecret);
        if (!valid) {
          return new Response(JSON.stringify({ error: "Invalid signature" }), {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
    }

    // ── 2. Resolve business ────────────────────────────────
    const resolved = await resolveBusinessFromWebhook(db, provider, req.url);
    if (!resolved) {
      return new Response(JSON.stringify({ error: "Unknown business or inactive integration" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { businessId, integrationId } = resolved;
    const eventType = String(payload.EventType ?? payload.event_type ?? payload.type ?? "unknown");
    const idempotencyKey = payload.EventId ? String(payload.EventId) : null;

    // ── 3. Store raw event ─────────────────────────────────
    const { data: event, error: insertError } = await db
      .from("webhook_events")
      .insert({
        business_id: businessId,
        integration_id: integrationId,
        provider,
        event_type: eventType,
        payload,
        status: "received",
        idempotency_key: idempotencyKey,
      })
      .select("id")
      .single();

    if (insertError) {
      // Duplicate idempotency key → already processed
      if (insertError.code === "23505") {
        return new Response(JSON.stringify({ status: "duplicate", event_type: eventType }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw insertError;
    }

    const eventId = event.id;

    // ── 4. Normalise entity ────────────────────────────────
    const entityType = resolveEntityType(eventType);
    let primaryEntityId: string | null = null;

    if (entityType) {
      const entityData = (payload.Data ?? payload.data ?? payload) as Record<string, unknown>;
      const normalised = normaliseBuildiumEntity(entityType, entityData);

      if (normalised) {
        const { data: snapshot } = await db
          .from("entity_snapshots")
          .upsert(
            {
              business_id: businessId,
              entity_type: normalised.entityType,
              external_id: normalised.externalId,
              provider: normalised.provider,
              display_name: normalised.displayName,
              data: normalised.data,
              raw_data: normalised.rawData,
              last_synced_at: new Date().toISOString(),
            },
            { onConflict: "business_id,provider,entity_type,external_id" }
          )
          .select("id")
          .single();

        if (snapshot) primaryEntityId = snapshot.id;
      }

      // Also upsert related entities (shallow — just IDs, no full data)
      const related = extractRelatedEntityIds(
        (payload.Data ?? payload.data ?? payload) as Record<string, unknown>
      );
      for (const rel of related) {
        await db.from("entity_snapshots").upsert(
          {
            business_id: businessId,
            entity_type: rel.entityType,
            external_id: rel.externalId,
            provider,
            display_name: null,
            data: {},
            raw_data: {},
            last_synced_at: new Date().toISOString(),
          },
          { onConflict: "business_id,provider,entity_type,external_id", ignoreDuplicates: true }
        );
      }
    }

    // ── 5. Evaluate task rules ─────────────────────────────
    const { data: rules } = await db
      .from("task_rules")
      .select("id, name, conditions, task_template")
      .eq("business_id", businessId)
      .eq("provider", provider)
      .eq("event_type", eventType)
      .eq("is_active", true);

    const tasksCreated: string[] = [];

    if (rules && rules.length > 0) {
      const entityData = (payload.Data ?? payload.data ?? payload) as Record<string, unknown>;

      for (const rule of rules as TaskRule[]) {
        if (!evaluateConditions(rule.conditions, entityData)) continue;

        const tmpl = rule.task_template;
        const title = tmpl.title
          ? interpolateTemplate(tmpl.title, entityData)
          : `[${eventType}] ${rule.name}`;
        const description = tmpl.description
          ? interpolateTemplate(tmpl.description, entityData)
          : null;

        const { data: task } = await db
          .from("tasks")
          .insert({
            business_id: businessId,
            title,
            description,
            priority: tmpl.priority ?? "medium",
            source: "rule",
            source_event_id: eventId,
            rule_id: rule.id,
          })
          .select("id")
          .single();

        if (task) {
          tasksCreated.push(task.id);

          // Link primary entity to the task
          if (primaryEntityId) {
            await db.from("task_entities").insert({
              task_id: task.id,
              entity_id: primaryEntityId,
              role: "primary",
            });
          }
        }
      }
    }

    // ── 6. Mark event as processed ─────────────────────────
    await db
      .from("webhook_events")
      .update({
        status: "normalized",
        processed_at: new Date().toISOString(),
      })
      .eq("id", eventId);

    return new Response(
      JSON.stringify({
        status: "ok",
        event_id: eventId,
        event_type: eventType,
        entity_type: entityType,
        tasks_created: tasksCreated.length,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("Webhook processing error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
