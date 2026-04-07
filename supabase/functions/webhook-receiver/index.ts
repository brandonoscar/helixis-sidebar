/**
 * Webhook Receiver Edge Function
 *
 * Receives webhook callbacks from property management providers:
 *
 * Buildium:
 * - POST with JSON body
 * - Headers: buildium-webhook-timestamp, buildium-webhook-signature
 * - Signature: base64(HMAC-SHA256(timestamp + body, secret))
 * - Payloads are partial signals — contain IDs, not full entities
 * - Events may be duplicated and out of order
 * - Must respond within 10 seconds
 * - 20 consecutive failures = subscription suspended
 * - Source: https://developer.buildium.com/
 *
 * AppFolio (Max plan only):
 * - POST with JSON body
 * - Header: X-JWS-Signature (detached JWS with PS256)
 * - Payload contains entity_id reference — must call REST API for full data
 * - Verify against AppFolio JWKS: https://api.appfolio.com/.well-known/jwks.json
 * - Source: https://developer.appfolio.com
 */

import { getServiceClient } from "../_shared/supabase-client.ts";
import { BuildiumClient } from "../_shared/buildium-client.ts";
import { AppFolioClient } from "../_shared/appfolio-client.ts";

// ─── Buildium Constants ─────────────────────────────────────────────

// Map webhook event entity types to the ID field in the payload
const BUILDIUM_ENTITY_ID_FIELDS: Record<string, string> = {
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
const BUILDIUM_ENTITY_TYPE_MAP: Record<string, string> = {
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

// ─── AppFolio Constants ─────────────────────────────────────────────

const APPFOLIO_JWKS_URL = "https://api.appfolio.com/.well-known/jwks.json";

// Map AppFolio webhook topics to our normalized entity types
const APPFOLIO_TOPIC_TO_ENTITY: Record<string, string> = {
  leads: "lead",
  work_order_updates: "workorder",
};

// Cache for JWKS keys
let cachedJwks: { keys: JsonWebKey[]; fetchedAt: number } | null = null;
const JWKS_CACHE_TTL_MS = 3600_000; // 1 hour

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

// ─── AppFolio JWS PS256 Verification ────────────────────────────────

async function fetchAppFolioJwks(): Promise<JsonWebKey[]> {
  if (cachedJwks && Date.now() - cachedJwks.fetchedAt < JWKS_CACHE_TTL_MS) {
    return cachedJwks.keys;
  }
  const res = await fetch(APPFOLIO_JWKS_URL);
  if (!res.ok) throw new Error(`Failed to fetch AppFolio JWKS: ${res.status}`);
  const json = await res.json();
  cachedJwks = { keys: json.keys, fetchedAt: Date.now() };
  return json.keys;
}

function base64urlDecode(str: string): Uint8Array {
  // Add padding if needed
  let padded = str.replace(/-/g, "+").replace(/_/g, "/");
  while (padded.length % 4 !== 0) padded += "=";
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function base64urlEncode(buffer: Uint8Array | ArrayBuffer): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function verifyAppFolioWebhook(rawBody: string, jwsSignatureHeader: string): Promise<Record<string, unknown>> {
  if (!jwsSignatureHeader) throw new Error("Missing X-JWS-Signature header");

  const parts = jwsSignatureHeader.split(".");
  if (parts.length !== 3) throw new Error("Invalid JWS format — expected 3 parts");

  const [encodedHeader, , encodedSignature] = parts;

  // Decode the JWS header to find the kid
  const headerJson = JSON.parse(new TextDecoder().decode(base64urlDecode(encodedHeader)));
  const kid = headerJson.kid;

  // Fetch JWKS and find matching key
  let jwksKeys = await fetchAppFolioJwks();
  let jwk = jwksKeys.find((k: any) => k.kid === kid);

  // If kid not found, force refresh cache
  if (!jwk) {
    cachedJwks = null;
    jwksKeys = await fetchAppFolioJwks();
    jwk = jwksKeys.find((k: any) => k.kid === kid);
  }

  if (!jwk) throw new Error(`No matching key found for kid: ${kid}`);

  // Import the public key for PS256 verification
  const publicKey = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSA-PSS", hash: "SHA-256" },
    false,
    ["verify"]
  );

  // Reconstruct full JWS with the payload included
  const encodedPayload = base64urlEncode(new TextEncoder().encode(rawBody));
  const signingInput = new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`);
  const signatureBytes = base64urlDecode(encodedSignature);

  const valid = await crypto.subtle.verify(
    { name: "RSA-PSS", saltLength: 32 },
    publicKey,
    signatureBytes,
    signingInput
  );

  if (!valid) throw new Error("AppFolio webhook signature verification failed");

  return JSON.parse(rawBody);
}

function buildIdempotencyKey(provider: string, eventName: string, entityId: string, eventDatetime: string): string {
  return `${provider}:${eventName}:${entityId}:${eventDatetime}`;
}

// Detect provider from URL path: /webhook-receiver/:workspaceId/:provider
// Falls back to checking request headers for provider detection
function detectWebhookProvider(pathParts: string[], req: Request): string {
  // Check if provider is explicitly in the URL path
  const lastPart = pathParts[pathParts.length - 1];
  const secondToLast = pathParts.length >= 2 ? pathParts[pathParts.length - 2] : null;

  // URL pattern: /webhook-receiver/:workspaceId/:provider
  if (lastPart === "buildium" || lastPart === "appfolio") return lastPart;

  // Detect via headers
  if (req.headers.get("x-jws-signature")) return "appfolio";
  if (req.headers.get("buildium-webhook-signature") || req.headers.get("buildium-webhook-timestamp")) return "buildium";

  return "buildium"; // Default for backwards compatibility
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  // Extract workspace (and optional provider) from URL path:
  // /webhook-receiver/:workspaceId or /webhook-receiver/:workspaceId/:provider
  const url = new URL(req.url);
  const pathParts = url.pathname.split("/").filter(Boolean);

  const provider = detectWebhookProvider(pathParts, req);
  // workspaceId is either the last part (if no provider in path) or second-to-last
  const workspaceId = (pathParts[pathParts.length - 1] === provider && pathParts.length >= 2)
    ? pathParts[pathParts.length - 2]
    : pathParts[pathParts.length - 1];

  if (!workspaceId) {
    return new Response("Missing workspace ID", { status: 400 });
  }

  const rawBody = await req.text();
  const supabase = getServiceClient();

  // ─── Provider-specific signature verification ─────────────────────

  let payload: Record<string, unknown>;

  if (provider === "appfolio") {
    // AppFolio: JWS PS256 detached signature verification
    const jwsSignature = req.headers.get("x-jws-signature") ?? "";
    try {
      payload = await verifyAppFolioWebhook(rawBody, jwsSignature);
    } catch (err) {
      console.error("AppFolio signature verification failed:", err instanceof Error ? err.message : err);
      return new Response("Invalid signature", { status: 401 });
    }
  } else {
    // Buildium: HMAC-SHA256 verification
    const timestamp = req.headers.get("buildium-webhook-timestamp") ?? "";
    const signature = req.headers.get("buildium-webhook-signature") ?? "";

    const { data: webhook } = await supabase
      .from("webhooks")
      .select("id, workspace_id, vault_signing_secret_id")
      .eq("workspace_id", workspaceId)
      .eq("provider", "buildium")
      .single();

    if (!webhook) {
      return new Response("Webhook not configured", { status: 404 });
    }

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

    try {
      payload = JSON.parse(rawBody);
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }
  }

  // ─── Provider-specific event parsing ──────────────────────────────

  let eventName: string;
  let eventDatetime: string;
  let normalizedType: string;
  let entityId: string | null;
  let accountId: string | null;

  if (provider === "appfolio") {
    // AppFolio webhook payload shape:
    // { client_id, id, topic, entity_id, update_timestamp, message_sent_at }
    const topic = payload.topic as string;
    eventName = topic ?? "unknown";
    eventDatetime = (payload.update_timestamp ?? payload.message_sent_at ?? new Date().toISOString()) as string;
    normalizedType = APPFOLIO_TOPIC_TO_ENTITY[topic] ?? topic?.replace(/_/g, "") ?? "unknown";
    entityId = payload.entity_id ? String(payload.entity_id) : null;
    accountId = payload.client_id ? String(payload.client_id) : null;
  } else {
    // Buildium webhook payload shape:
    // { EventName, EventDateTime, AccountId, ...entity IDs }
    eventName = payload.EventName as string;
    eventDatetime = payload.EventDateTime as string;
    accountId = payload.AccountId ? String(payload.AccountId) : null;

    if (!eventName || !eventDatetime) {
      return new Response("Missing EventName or EventDateTime", { status: 400 });
    }

    const [entityTypeName, _operation] = eventName.split(".");
    normalizedType = BUILDIUM_ENTITY_TYPE_MAP[entityTypeName] ?? entityTypeName.toLowerCase();
    const idField = BUILDIUM_ENTITY_ID_FIELDS[entityTypeName];
    entityId = idField && payload[idField] ? String(payload[idField]) : null;
  }

  const idempotencyKey = buildIdempotencyKey(provider, eventName, entityId ?? "", eventDatetime);

  // ─── Insert webhook event (dedup via unique idempotency_key) ──────

  const { error: insertError } = await supabase
    .from("webhook_events")
    .insert({
      workspace_id: workspaceId,
      provider,
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
  const { data: webhookRow } = await supabase
    .from("webhooks")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("provider", provider)
    .single();

  if (webhookRow) {
    await supabase
      .from("webhooks")
      .update({
        last_received_at: new Date().toISOString(),
        last_event_type: eventName,
        health_status: "healthy",
      })
      .eq("id", webhookRow.id);
  }

  // ─── Hydrate entity from provider API ─────────────────────────────

  if (entityId) {
    try {
      const { data: integration } = await supabase
        .from("integrations")
        .select("id, environment, metadata")
        .eq("workspace_id", workspaceId)
        .eq("provider", provider)
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
            let entityData: unknown;

            if (provider === "appfolio") {
              // AppFolio needs subdomain for API calls
              const subdomain = (integration.metadata as any)?.subdomain ?? "";
              const client = new AppFolioClient({ clientId, clientSecret, subdomain });
              const result = await client.getEntity(normalizedType, entityId);
              entityData = result.data;
            } else {
              const client = new BuildiumClient({
                clientId,
                clientSecret,
                environment: integration.environment as "production" | "sandbox",
              });
              const result = await client.getEntity(normalizedType, entityId);
              entityData = result.data;
            }

            // Upsert entity snapshot
            const dataStr = JSON.stringify(entityData);
            const hashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(dataStr));
            const dataHash = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");

            await supabase
              .from("entity_snapshots")
              .upsert({
                workspace_id: workspaceId,
                provider,
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

  // ─── Auto-create tasks for certain event types ────────────────────

  if (provider === "appfolio") {
    // AppFolio topics that should generate tasks
    const topic = payload.topic as string;
    if (topic === "leads") {
      await supabase.from("tasks").insert({
        workspace_id: workspaceId,
        title: "New lead received — follow up",
        task_type: "lead",
        priority: "high",
        entity_type: normalizedType,
        entity_id: entityId,
        provider: "appfolio",
      });
    } else if (topic === "work_order_updates") {
      await supabase.from("tasks").insert({
        workspace_id: workspaceId,
        title: "Work order updated — review status",
        task_type: "maintenance",
        priority: "high",
        entity_type: normalizedType,
        entity_id: entityId,
        provider: "appfolio",
      });
    }
  } else {
    // Buildium auto-task creation
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
        source_event_id: null,
        entity_type: normalizedType,
        entity_id: entityId,
        provider: "buildium",
      });
    }
  }

  return new Response(JSON.stringify({ status: "processed" }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
