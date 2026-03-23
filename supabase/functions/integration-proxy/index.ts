import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import {
  authenticateRequest,
  createServiceClient,
  AuthError,
} from "../_shared/auth.ts";
import { writeAuditLog } from "../_shared/audit.ts";

/**
 * POST /functions/v1/integration-proxy
 *
 * Proxies requests to third-party APIs using server-stored encrypted secrets.
 * The extension never sees the raw API key.
 *
 * Request body:
 *   {
 *     "business_id": "uuid",
 *     "provider": "zendesk",
 *     "action": "list_tickets",
 *     "params": { ... }
 *   }
 */
serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const { auth } = await authenticateRequest(req);
    const body = await req.json();
    const { provider, action, params } = body;

    if (!provider || !action) {
      return new Response(
        JSON.stringify({ error: "provider and action are required" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    // Use service client to read encrypted secrets (bypasses RLS)
    const serviceClient = createServiceClient();

    // Find the integration
    const { data: integration, error: intError } = await serviceClient
      .from("integrations")
      .select("id, status, config")
      .eq("business_id", auth.businessId)
      .eq("provider", provider)
      .single();

    if (intError || !integration) {
      return new Response(
        JSON.stringify({ error: `Integration '${provider}' not found` }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 404 }
      );
    }

    if (integration.status !== "active") {
      return new Response(
        JSON.stringify({ error: `Integration '${provider}' is not active` }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    // Retrieve and decrypt the secret
    const { data: secret } = await serviceClient
      .from("integration_secrets")
      .select("encrypted_key")
      .eq("integration_id", integration.id)
      .single();

    if (!secret) {
      return new Response(
        JSON.stringify({ error: "No API key configured for this integration" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    const decryptedKey = decryptSecret(secret.encrypted_key);

    // Audit the access (never log the key itself)
    await writeAuditLog({
      businessId: auth.businessId,
      userId: auth.userId,
      action: "secret.accessed",
      resourceType: "integrations",
      resourceId: integration.id,
      metadata: { provider, action },
    });

    // Route to the appropriate provider handler
    const result = await routeProviderAction(provider, action, params, decryptedKey, integration.config);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    const status = error instanceof AuthError ? error.status : 500;
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status,
      }
    );
  }
});

// ── Secret Encryption/Decryption ────────────────────────────────

function decryptSecret(encryptedKey: string): string {
  // In production, use AES-256-GCM with the HELIXIS_ENCRYPTION_KEY env var.
  // For the MVP, we use a simple base64 encoding as a placeholder.
  // TODO: Replace with proper AES-256-GCM encryption using Web Crypto API.
  const encryptionKey = Deno.env.get("HELIXIS_ENCRYPTION_KEY");
  if (!encryptionKey) {
    throw new Error("Encryption key not configured");
  }

  // Placeholder: base64 decode. Replace with real decryption.
  try {
    return atob(encryptedKey);
  } catch {
    throw new Error("Failed to decrypt integration secret");
  }
}

// ── Provider Routing ────────────────────────────────────────────

async function routeProviderAction(
  provider: string,
  action: string,
  params: Record<string, unknown>,
  apiKey: string,
  config: Record<string, unknown>
): Promise<unknown> {
  // Add provider-specific handlers here as integrations are built.
  // Each handler uses the decrypted apiKey to call the third-party API.

  switch (provider) {
    case "zendesk":
      return handleZendesk(action, params, apiKey, config);
    default:
      throw new Error(`Provider '${provider}' is not yet supported`);
  }
}

async function handleZendesk(
  action: string,
  params: Record<string, unknown>,
  apiKey: string,
  config: Record<string, unknown>
): Promise<unknown> {
  const subdomain = config.subdomain as string;
  if (!subdomain) throw new Error("Zendesk subdomain not configured");

  const baseUrl = `https://${subdomain}.zendesk.com/api/v2`;

  switch (action) {
    case "list_tickets": {
      const res = await fetch(`${baseUrl}/tickets.json?per_page=25`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!res.ok) throw new Error(`Zendesk API error: ${res.status}`);
      return await res.json();
    }
    default:
      throw new Error(`Action '${action}' not supported for Zendesk`);
  }
}
