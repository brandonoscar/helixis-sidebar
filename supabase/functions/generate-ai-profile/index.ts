/**
 * Generate AI Profile Edge Function — Gemini
 *
 * Takes onboarding answers and uses Gemini 2.0 Flash to generate a structured
 * business AI profile, then upserts it into the `business_ai_profiles` table.
 *
 * The generated profile powers the AI Chat function's system instructions,
 * giving the copilot deep context about how this specific business operates.
 */

import { getUserClient, getServiceClient } from "../_shared/supabase-client.ts";
import { corsHeaders, corsResponse } from "../_shared/cors.ts";

const GEMINI_MODEL = "gemini-2.0-flash";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// Structured output schema for the business AI profile
const PROFILE_SCHEMA = {
  type: "object",
  properties: {
    operating_summary: {
      type: "string",
      description:
        "A concise paragraph summarizing how this property management business operates day-to-day, including portfolio size, property types, and team structure.",
    },
    communication_style: {
      type: "string",
      description:
        "How this business prefers to communicate with tenants, owners, and vendors. Include tone, preferred channels, and response-time expectations.",
    },
    maintenance_rules: {
      type: "string",
      description:
        "Step-by-step rules for handling maintenance requests: triage, approval thresholds, vendor dispatch, emergency procedures, and follow-up.",
    },
    leasing_rules: {
      type: "string",
      description:
        "Rules for the leasing process: screening criteria, application steps, lease terms, renewal procedures, and move-in/move-out policies.",
    },
    payment_rules: {
      type: "string",
      description:
        "Rules for rent collection: due dates, grace periods, late fees, payment methods accepted, and delinquency escalation steps.",
    },
    owner_approval_rules: {
      type: "string",
      description:
        "When and how property owners must be consulted or approve decisions, including dollar thresholds and communication preferences.",
    },
    important_exceptions: {
      type: "string",
      description:
        "Any notable exceptions, special arrangements, or edge cases that differ from the standard rules above.",
    },
    do_not_do: {
      type: "string",
      description:
        "Things the AI assistant should never do, recommend, or say when acting on behalf of this business.",
    },
    custom_instructions: {
      type: "string",
      description:
        "Any additional instructions, preferences, or context that don't fit the categories above.",
    },
  },
  required: [
    "operating_summary",
    "communication_style",
    "maintenance_rules",
    "leasing_rules",
    "payment_rules",
    "owner_approval_rules",
    "important_exceptions",
    "do_not_do",
    "custom_instructions",
  ],
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsResponse();

  // ── Auth ──────────────────────────────────────────────────────────

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response("Unauthorized", { status: 401, headers: corsHeaders });
  }

  const supabase = getUserClient(authHeader);

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return new Response("Unauthorized", { status: 401, headers: corsHeaders });
  }

  // ── Parse body ────────────────────────────────────────────────────

  const body = await req.json();
  const { workspaceId, businessName, onboardingAnswers, onboardingId } = body;

  if (!workspaceId || !onboardingAnswers) {
    return new Response(
      JSON.stringify({ error: "Missing workspaceId or onboardingAnswers" }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  // ── Gemini API key ────────────────────────────────────────────────

  const geminiKey = Deno.env.get("GEMINI_API_KEY");
  if (!geminiKey) {
    return new Response(
      JSON.stringify({ error: "AI service not configured" }),
      {
        status: 503,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  // ── Build prompt ──────────────────────────────────────────────────

  const systemInstruction = `You are an expert property management consultant. Your job is to take raw onboarding answers from a property management company and produce a clean, structured business AI profile.

This profile will be used as the system context for an AI copilot that assists this business daily. Every field you generate should be:
- Specific to THIS business (not generic advice)
- Actionable (the AI copilot will reference these rules when answering questions)
- Written in second person ("you" = the business / property manager)
- Concise but complete — aim for 2-4 sentences per field

If the onboarding answers don't cover a particular area, write a sensible default based on industry best practices and note that it should be reviewed. Never leave a field empty — always provide at least a placeholder the user can refine.`;

  const userPrompt = `Generate a business AI profile from these onboarding answers.

Business name: ${businessName || "Not provided"}

Onboarding answers:
${JSON.stringify(onboardingAnswers, null, 2)}`;

  const geminiBody = {
    systemInstruction: {
      parts: [{ text: systemInstruction }],
    },
    contents: [{ role: "user", parts: [{ text: userPrompt }] }],
    generationConfig: {
      temperature: 0.4,
      topP: 0.9,
      maxOutputTokens: 2048,
      responseMimeType: "application/json",
      responseSchema: PROFILE_SCHEMA,
    },
  };

  // ── Call Gemini ───────────────────────────────────────────────────

  let aiRes: Response;
  try {
    aiRes = await fetch(GEMINI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": geminiKey,
      },
      body: JSON.stringify(geminiBody),
    });
  } catch (fetchErr) {
    console.error("Gemini fetch error:", fetchErr);
    return new Response(
      JSON.stringify({ error: "AI service unreachable" }),
      {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  if (!aiRes.ok) {
    const errText = await aiRes.text();
    console.error(`Gemini API error: ${aiRes.status}`, errText);
    return new Response(
      JSON.stringify({ error: "AI service error" }),
      {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  const aiData = await aiRes.json();
  const rawText = aiData.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!rawText) {
    return new Response(
      JSON.stringify({ error: "Empty AI response" }),
      {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  let profile: Record<string, string>;
  try {
    profile = JSON.parse(rawText);
  } catch {
    console.error("Failed to parse Gemini response as JSON");
    return new Response(
      JSON.stringify({ error: "Invalid AI response format" }),
      {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  // ── Upsert into business_ai_profiles ──────────────────────────────

  const serviceClient = getServiceClient();

  const row = {
    workspace_id: workspaceId,
    business_name: businessName || null,
    operating_summary: profile.operating_summary || "",
    communication_style: profile.communication_style || "",
    maintenance_rules: profile.maintenance_rules || "",
    leasing_rules: profile.leasing_rules || "",
    payment_rules: profile.payment_rules || "",
    owner_approval_rules: profile.owner_approval_rules || "",
    important_exceptions: profile.important_exceptions || "",
    do_not_do: profile.do_not_do || "",
    custom_instructions: profile.custom_instructions || "",
    source_onboarding_id: onboardingId || null,
    generated_at: new Date().toISOString(),
    manually_edited: false,
    updated_at: new Date().toISOString(),
  };

  const { data: upsertedProfile, error: upsertError } = await serviceClient
    .from("business_ai_profiles")
    .upsert(row, { onConflict: "workspace_id" })
    .select()
    .single();

  if (upsertError) {
    console.error("Upsert error:", upsertError);
    return new Response(
      JSON.stringify({ error: "Failed to save profile" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  // ── Return ────────────────────────────────────────────────────────

  return new Response(JSON.stringify({ profile: upsertedProfile }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
