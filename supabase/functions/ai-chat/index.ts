import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { authenticateRequest, AuthError } from "../_shared/auth.ts";
import { writeAuditLog } from "../_shared/audit.ts";

/**
 * POST /functions/v1/ai-chat
 *
 * Proxies AI chat requests. The AI API key lives server-side only —
 * the extension never sees it.
 *
 * Request body:
 *   {
 *     "business_id": "uuid",           // optional if single business
 *     "messages": [                     // conversation history
 *       { "role": "user", "content": "..." },
 *       ...
 *     ],
 *     "context_blocks": [ ... ],        // pre-fetched context block contents
 *     "page_context": "..."             // optional captured page text
 *   }
 *
 * The Edge Function:
 *   1. Validates the JWT
 *   2. Assembles system prompt from context blocks
 *   3. Calls the AI API using the server-side key
 *   4. Returns the AI response
 */
serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const { auth, supabaseClient } = await authenticateRequest(req);

    const body = await req.json();
    const { messages, page_context } = body;

    if (!messages || !Array.isArray(messages)) {
      return new Response(
        JSON.stringify({ error: "messages array is required" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    // Fetch active AI context blocks for this business
    const { data: contextBlocks } = await supabaseClient
      .from("ai_context_blocks")
      .select("source_type, title, content, priority")
      .eq("business_id", auth.businessId)
      .eq("is_active", true)
      .order("priority");

    // Assemble the system prompt
    const systemPrompt = assembleSystemPrompt(contextBlocks ?? [], page_context);

    // Build the messages array for the AI API
    const aiMessages = [
      { role: "system", content: systemPrompt },
      ...messages.slice(-20), // Limit conversation history to last 20 messages
    ];

    // Call the AI API — key is in environment variables, never exposed to client
    const aiApiKey = Deno.env.get("OPENAI_API_KEY");
    if (!aiApiKey) {
      throw new Error("AI API key not configured on server");
    }

    const aiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${aiApiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: aiMessages,
        max_tokens: 1024,
        temperature: 0.7,
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error("AI API error:", errorText);
      throw new Error("AI service returned an error");
    }

    const aiData = await aiResponse.json();
    const assistantMessage = aiData.choices?.[0]?.message?.content ?? "No response generated.";

    // Audit log (never log the actual message content for privacy)
    await writeAuditLog({
      businessId: auth.businessId,
      userId: auth.userId,
      action: "ai.chat",
      metadata: { message_count: messages.length },
    });

    return new Response(
      JSON.stringify({
        response: assistantMessage,
        usage: aiData.usage,
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

// ── AI Context Assembly ─────────────────────────────────────────

function assembleSystemPrompt(
  contextBlocks: Array<{ source_type: string; title: string | null; content: string }>,
  pageContext?: string
): string {
  const sections: string[] = [];

  sections.push(
    "You are Helixis Copilot, an AI assistant customized for this specific business. " +
    "Use the context below to give accurate, business-aware answers. " +
    "If something is not covered in the context, say so rather than guessing. " +
    "Always follow the business policies provided."
  );

  // Group context blocks by source type
  const onboarding = contextBlocks.filter((b) => b.source_type === "onboarding");
  const policies = contextBlocks.filter((b) => b.source_type === "policy");
  const documents = contextBlocks.filter((b) => b.source_type === "document");
  const pdfIntake = contextBlocks.filter((b) => b.source_type === "pdf_intake");
  const manual = contextBlocks.filter((b) => b.source_type === "manual");

  if (onboarding.length > 0) {
    sections.push("## Business Profile");
    sections.push(onboarding.map((b) => b.content).join("\n"));
  }

  if (policies.length > 0) {
    sections.push("## Business Policies");
    sections.push(
      policies
        .map((b) => `### ${b.title ?? "Policy"}\n${b.content}`)
        .join("\n\n")
    );
  }

  if (documents.length > 0) {
    sections.push("## Knowledge Base Documents");
    sections.push(
      documents
        .map((b) => `### ${b.title ?? "Document"}\n${b.content}`)
        .join("\n\n")
    );
  }

  if (pdfIntake.length > 0) {
    sections.push("## Client Intake Information");
    sections.push(
      pdfIntake
        .map((b) => `### ${b.title ?? "Intake"}\n${b.content}`)
        .join("\n\n")
    );
  }

  if (manual.length > 0) {
    sections.push("## Additional Instructions");
    sections.push(manual.map((b) => b.content).join("\n"));
  }

  if (pageContext) {
    sections.push("## Current Page Context");
    sections.push(
      "The user is currently viewing a web page. Here is the extracted text:\n" +
      pageContext.slice(0, 4000)
    );
  }

  return sections.join("\n\n");
}
