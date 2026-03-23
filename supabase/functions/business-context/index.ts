import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { authenticateRequest, AuthError } from "../_shared/auth.ts";
import { writeAuditLog } from "../_shared/audit.ts";

/**
 * POST /functions/v1/business-context
 *
 * Returns the full business context for the authenticated user's business.
 * This is what the extension calls after login to load onboarding-derived
 * knowledge into the copilot.
 *
 * Request body (optional):
 *   { "business_id": "uuid" }   — if user belongs to multiple businesses
 *
 * Response:
 *   {
 *     business: { ... },
 *     onboarding: { ... },
 *     policies: [ ... ],
 *     integrations: [ ... ],
 *     documents: [ ... ],
 *     contextBlocks: [ ... ]
 *   }
 */
serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const { auth, supabaseClient } = await authenticateRequest(req);

    // Fetch all business data in parallel
    const [
      businessResult,
      onboardingResult,
      policiesResult,
      integrationsResult,
      documentsResult,
      contextBlocksResult,
    ] = await Promise.all([
      supabaseClient
        .from("businesses")
        .select("id, name, slug, industry, website_url, onboarding_completed")
        .eq("id", auth.businessId)
        .single(),

      supabaseClient
        .from("onboarding_profiles")
        .select("*")
        .eq("business_id", auth.businessId)
        .maybeSingle(),

      supabaseClient
        .from("business_policies")
        .select("id, title, category, content, is_active")
        .eq("business_id", auth.businessId)
        .eq("is_active", true)
        .order("created_at"),

      supabaseClient
        .from("integrations")
        .select("id, provider, status, config, scopes")
        .eq("business_id", auth.businessId)
        .order("provider"),

      supabaseClient
        .from("uploaded_documents")
        .select("id, file_name, mime_type, status, created_at")
        .eq("business_id", auth.businessId)
        .eq("status", "ready")
        .order("created_at", { ascending: false }),

      supabaseClient
        .from("ai_context_blocks")
        .select("id, source_type, title, content, priority")
        .eq("business_id", auth.businessId)
        .eq("is_active", true)
        .order("priority"),
    ]);

    // Log the context fetch for audit trail
    await writeAuditLog({
      businessId: auth.businessId,
      userId: auth.userId,
      action: "context.fetched",
      resourceType: "businesses",
      resourceId: auth.businessId,
    });

    return new Response(
      JSON.stringify({
        business: businessResult.data,
        onboarding: onboardingResult.data,
        policies: policiesResult.data ?? [],
        integrations: integrationsResult.data ?? [],
        documents: documentsResult.data ?? [],
        contextBlocks: contextBlocksResult.data ?? [],
        member: {
          role: auth.role,
        },
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
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
