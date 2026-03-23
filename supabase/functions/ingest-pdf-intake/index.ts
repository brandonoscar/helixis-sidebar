import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { authenticateRequest, createServiceClient, AuthError } from "../_shared/auth.ts";
import { writeAuditLog } from "../_shared/audit.ts";

/**
 * POST /functions/v1/ingest-pdf-intake
 *
 * Ingests a pre-filled PDF intake form and maps its fields into
 * onboarding_profiles, business_policies, and ai_context_blocks.
 *
 * Phase 3 endpoint — designed now, built incrementally.
 *
 * Request body:
 *   {
 *     "business_id": "uuid",
 *     "parsed_fields": {
 *       "business_name": "...",
 *       "business_description": "...",
 *       "target_audience": "...",
 *       "products_services": ["..."],
 *       "tone_of_voice": "...",
 *       "team_size": "...",
 *       "primary_tools": ["..."],
 *       "goals": "...",
 *       "support_policy": "...",
 *       "return_policy": "...",
 *       "sla_commitments": "...",
 *       "brand_guidelines": "...",
 *       "pain_points": "...",
 *       "desired_integrations": ["..."]
 *     },
 *     "document_id": "uuid"   // the uploaded_documents record for the raw PDF
 *   }
 *
 * The parsing itself (PDF → parsed_fields) happens client-side or in a
 * separate extraction step. This endpoint receives already-parsed data
 * and maps it into the correct tables.
 */
serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const { auth } = await authenticateRequest(req, { requireAdmin: true });
    const body = await req.json();
    const { parsed_fields: fields, document_id: documentId } = body;

    if (!fields) {
      return new Response(
        JSON.stringify({ error: "parsed_fields is required" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    const serviceClient = createServiceClient();

    // 1. Upsert onboarding profile from parsed fields
    const { error: profileError } = await serviceClient
      .from("onboarding_profiles")
      .upsert(
        {
          business_id: auth.businessId,
          business_description: fields.business_description,
          target_audience: fields.target_audience,
          tone_of_voice: fields.tone_of_voice,
          products_services: fields.products_services ?? [],
          team_size: fields.team_size,
          primary_tools: fields.primary_tools ?? [],
          goals: fields.goals,
          custom_fields: {
            pain_points: fields.pain_points,
            desired_integrations: fields.desired_integrations,
          },
        },
        { onConflict: "business_id" }
      );

    if (profileError) throw new Error(`Profile upsert failed: ${profileError.message}`);

    // 2. Create policy records from parsed fields
    const policyMappings = [
      { field: "support_policy", title: "Customer Support Policy", category: "support" },
      { field: "return_policy", title: "Return & Refund Policy", category: "sales" },
      { field: "sla_commitments", title: "SLA Commitments", category: "operations" },
      { field: "brand_guidelines", title: "Brand & Tone Guidelines", category: "custom" },
    ] as const;

    const policiesToInsert = policyMappings
      .filter((m) => fields[m.field])
      .map((m) => ({
        business_id: auth.businessId,
        title: m.title,
        category: m.category,
        content: fields[m.field],
        is_active: true,
      }));

    if (policiesToInsert.length > 0) {
      await serviceClient.from("business_policies").insert(policiesToInsert);
    }

    // 3. Generate AI context blocks from the intake data
    const contextBlocks = [];

    // Business profile context block
    if (fields.business_description || fields.target_audience) {
      contextBlocks.push({
        business_id: auth.businessId,
        source_type: "pdf_intake",
        source_id: documentId ?? null,
        title: "Business Overview (from intake form)",
        content: [
          fields.business_name && `Business: ${fields.business_name}`,
          fields.business_description && `Description: ${fields.business_description}`,
          fields.target_audience && `Target Audience: ${fields.target_audience}`,
          fields.tone_of_voice && `Tone of Voice: ${fields.tone_of_voice}`,
          fields.team_size && `Team Size: ${fields.team_size}`,
          fields.goals && `Goals: ${fields.goals}`,
        ]
          .filter(Boolean)
          .join("\n"),
        priority: 1,
        is_active: true,
      });
    }

    // Products/services context block
    if (fields.products_services?.length > 0) {
      contextBlocks.push({
        business_id: auth.businessId,
        source_type: "pdf_intake",
        source_id: documentId ?? null,
        title: "Products & Services (from intake form)",
        content: `Products/Services:\n${fields.products_services.map((p: string) => `- ${p}`).join("\n")}`,
        priority: 2,
        is_active: true,
      });
    }

    // Policy context blocks
    for (const policy of policiesToInsert) {
      contextBlocks.push({
        business_id: auth.businessId,
        source_type: "policy",
        source_id: null,
        title: policy.title,
        content: policy.content,
        priority: 5,
        is_active: true,
      });
    }

    if (contextBlocks.length > 0) {
      await serviceClient.from("ai_context_blocks").insert(contextBlocks);
    }

    // 4. Mark onboarding as completed
    await serviceClient
      .from("businesses")
      .update({ onboarding_completed: true })
      .eq("id", auth.businessId);

    // Audit log
    await writeAuditLog({
      businessId: auth.businessId,
      userId: auth.userId,
      action: "pdf_intake.ingested",
      resourceType: "uploaded_documents",
      resourceId: documentId,
      metadata: {
        fields_count: Object.keys(fields).length,
        policies_created: policiesToInsert.length,
        context_blocks_created: contextBlocks.length,
      },
    });

    return new Response(
      JSON.stringify({
        success: true,
        summary: {
          profile_updated: true,
          policies_created: policiesToInsert.length,
          context_blocks_created: contextBlocks.length,
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
