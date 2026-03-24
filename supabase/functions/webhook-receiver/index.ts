/**
 * Webhook Receiver Edge Function
 *
 * Receives Buildium webhook callbacks, validates HMAC-SHA256 signature,
 * deduplicates, and queues for processing.
 *
 * Buildium webhook docs (confirmed):
 * - POST with JSON body
 * - Headers: buildium-webhook-timestamp, buildium-webhook-signature
 * - Signature: base64(HMAC-SHA256(timestamp + body, secret))
 * - Payloads are partial signals — contain IDs, not full entities
 * - Events may be duplicated and out of order
 * - Must respond within 10 seconds
 * - 20 consecutive failures = subscription suspended
 *
 * Source: https://developer.buildium.com/
 */

import { getServiceClient } from "../_shared/supabase-client.ts";
import { BuildiumClient } from "../_shared/buildium-client.ts";

// Map webhook event entity types to the ID field in the payload
const ENTITY_ID_FIELDS: Record<string, string> = {
  Rental: "PropertyId",
  Lease: "LeaseId",
  Tenant: "TenantId",
  Association: "AssociationId",
  Vendor: "VendorId",
  WorkOrder: "WorkOrderId",
  Task: "TaskId",
  Applicant: "ApplicantId",
  RentalOwner: "RentalOwnerId",
};

// Map event entity names to our normalized entity types
const ENTITY_TYPE_MAP: Record<string, string> = {
  Rental: "rental",
  Lease: "lease",
  Tenant: "tenant",
  Association: "association",
  Vendor: "vendor",
  WorkOrder: "workorder",
  Task: "task",
  Applicant: "applicant",
  RentalOwner: "rentalowner",
};

async function verifySignature(
  body: string,
  timestamp: string,
  signature: string,
  secret: string
): Promise<boolean> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signed = await crypto.subtle.sign("HMAC", key, encoder.encode(timestamp + body));
  const computed = btoa(String.fromCharCode(...new Uint8Array(signed)));
  return computed === signature;
}

function buildIdempotencyKey(provider: string, eventName: string, entityId: string, eventDatetime: string): string {
  return `${provider}:${eventName}:${entityId}:${eventDatetime}`;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  // Extract workspace from URL path: /webhook-receiver/:workspaceId
  const url = new URL(req.url);
  const pathParts = url.pathname.split("/").filter(Boolean);
  const workspaceId = pathParts[pathParts.length - 1];

  if (!workspaceId) {
    return new Response("Missing workspace ID", { status: 400 });
  }

  const rawBody = await req.text();
  const timestamp = req.headers.get("buildium-webhook-timestamp") ?? "";
  const signature = req.headers.get("buildium-webhook-signature") ?? "";

  const supabase = getServiceClient();

  // Look up webhook config for this workspace
  const { data: webhook } = await supabase
    .from("webhooks")
    .select("id, workspace_id, vault_signing_secret_id")
    .eq("workspace_id", workspaceId)
    .eq("provider", "buildium")
    .single();

  if (!webhook) {
    return new Response("Webhook not configured", { status: 404 });
  }

  // Retrieve signing secret from vault
  if (webhook.vault_signing_secret_id) {
    const { data: secretRow } = await supabase
      .rpc("vault_read_secret", { secret_id: webhook.vault_signing_secret_id });

    const secret = secretRow?.[0]?.decrypted_secret;
    if (secret && signature) {
      const valid = await verifySignature(rawBody, timestamp, signature, secret);
      if (!valid) {
        return new Response("Invalid signature", { status: 401 });
      }
    }
  }

  // Parse payload
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const eventName = payload.EventName as string;
  const eventDatetime = payload.EventDateTime as string;
  const accountId = payload.AccountId ? String(payload.AccountId) : null;

  if (!eventName || !eventDatetime) {
    return new Response("Missing EventName or EventDateTime", { status: 400 });
  }

  // Parse entity type and ID from event
  const [entityTypeName, _operation] = eventName.split(".");
  const normalizedType = ENTITY_TYPE_MAP[entityTypeName] ?? entityTypeName.toLowerCase();
  const idField = ENTITY_ID_FIELDS[entityTypeName];
  const entityId = idField && payload[idField] ? String(payload[idField]) : null;

  const idempotencyKey = buildIdempotencyKey("buildium", eventName, entityId ?? "", eventDatetime);

  // Insert webhook event (dedup via unique idempotency_key)
  const { error: insertError } = await supabase
    .from("webhook_events")
    .insert({
      workspace_id: workspaceId,
      provider: "buildium",
      event_name: eventName,
      event_datetime: eventDatetime,
      account_id: accountId,
      entity_type: normalizedType,
      entity_id: entityId,
      payload,
      idempotency_key: idempotencyKey,
      processing_status: "pending",
    });

  if (insertError) {
    // Duplicate = idempotency_key conflict, which is fine
    if (insertError.code === "23505") {
      return new Response(JSON.stringify({ status: "duplicate_skipped" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    console.error("Insert error:", insertError);
    return new Response("Internal error", { status: 500 });
  }

  // Update webhook health
  await supabase
    .from("webhooks")
    .update({
      last_received_at: new Date().toISOString(),
      last_event_type: eventName,
      health_status: "healthy",
    })
    .eq("id", webhook.id);

  // Hydrate entity: fetch full data from Buildium API since webhooks are partial signals
  if (entityId) {
    try {
      // Get integration credentials for this workspace
      const { data: integration } = await supabase
        .from("integrations")
        .select("id, environment")
        .eq("workspace_id", workspaceId)
        .eq("provider", "buildium")
        .eq("status", "connected")
        .single();

      if (integration) {
        const { data: secrets } = await supabase
          .from("integration_secrets")
          .select("vault_api_key_id, vault_api_secret_id")
          .eq("integration_id", integration.id)
          .single();

        if (secrets?.vault_api_key_id && secrets?.vault_api_secret_id) {
          const [keyRes, secretRes] = await Promise.all([
            supabase.rpc("vault_read_secret", { secret_id: secrets.vault_api_key_id }),
            supabase.rpc("vault_read_secret", { secret_id: secrets.vault_api_secret_id }),
          ]);

          const clientId = keyRes.data?.[0]?.decrypted_secret;
          const clientSecret = secretRes.data?.[0]?.decrypted_secret;

          if (clientId && clientSecret) {
            const client = new BuildiumClient({
              clientId,
              clientSecret,
              environment: integration.environment as "production" | "sandbox",
            });

            const { data: entityData } = await client.getEntity(normalizedType, entityId);

            // Upsert entity snapshot
            const dataStr = JSON.stringify(entityData);
            const hashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(dataStr));
            const dataHash = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");

            await supabase
              .from("entity_snapshots")
              .upsert({
                workspace_id: workspaceId,
                provider: "buildium",
                entity_type: normalizedType,
                external_id: entityId,
                data: entityData,
                data_hash: dataHash,
                fetched_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              }, {
                onConflict: "workspace_id,provider,entity_type,external_id",
              });
          }
        }
      }

      // Mark event as processed
      await supabase
        .from("webhook_events")
        .update({ processing_status: "completed", processed_at: new Date().toISOString() })
        .eq("idempotency_key", idempotencyKey);

    } catch (err) {
      console.error("Entity hydration error:", err);
      await supabase
        .from("webhook_events")
        .update({
          processing_status: "failed",
          error_message: err instanceof Error ? err.message : String(err),
        })
        .eq("idempotency_key", idempotencyKey);
    }
  }

  // Auto-create tasks for certain event types
  const operation = eventName.split(".")[1];
  if (operation === "Created" && ["workorder", "lease", "tenant"].includes(normalizedType)) {
    const taskTitles: Record<string, string> = {
      workorder: "New maintenance request received",
      lease: "New lease created — review required",
      tenant: "New tenant added — verify onboarding",
    };
    const taskTypes: Record<string, string> = {
      workorder: "maintenance",
      lease: "lease",
      tenant: "tenant",
    };

    await supabase.from("tasks").insert({
      workspace_id: workspaceId,
      title: taskTitles[normalizedType] ?? `New ${normalizedType} event`,
      task_type: taskTypes[normalizedType] ?? "general",
      priority: normalizedType === "workorder" ? "high" : "medium",
      source_event_id: null, // We could query for the event ID but keeping it simple
      entity_type: normalizedType,
      entity_id: entityId,
      provider: "buildium",
    });
  }

  return new Response(JSON.stringify({ status: "processed" }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
