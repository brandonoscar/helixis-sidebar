/**
 * Helixis — AI Context Builder
 *
 * Converts onboarding data into structured AI context blocks.
 * Called when onboarding is completed or updated, to generate/refresh
 * the ai_context_blocks that the copilot uses as its system prompt.
 *
 * This is the bridge between "business fills out onboarding" and
 * "AI knows about the business."
 */

import { createServiceClient } from "./auth.ts";

interface OnboardingProfile {
  id: string;
  business_id: string;
  business_description: string | null;
  target_audience: string | null;
  tone_of_voice: string | null;
  products_services: string[];
  team_size: string | null;
  primary_tools: string[];
  goals: string | null;
  custom_fields: Record<string, unknown>;
}

interface BusinessPolicy {
  id: string;
  business_id: string;
  title: string;
  category: string;
  content: string;
}

/**
 * Regenerate all AI context blocks for a business from its current
 * onboarding profile and policies.
 *
 * This is idempotent — it deletes old auto-generated blocks and
 * creates fresh ones.
 */
export async function rebuildContextBlocks(businessId: string): Promise<{
  blocksCreated: number;
}> {
  const serviceClient = createServiceClient();

  // 1. Fetch current onboarding profile
  const { data: profile } = await serviceClient
    .from("onboarding_profiles")
    .select("*")
    .eq("business_id", businessId)
    .maybeSingle();

  // 2. Fetch active policies
  const { data: policies } = await serviceClient
    .from("business_policies")
    .select("*")
    .eq("business_id", businessId)
    .eq("is_active", true);

  // 3. Delete existing auto-generated blocks (onboarding + policy source types)
  //    Keep manual and document blocks intact.
  await serviceClient
    .from("ai_context_blocks")
    .delete()
    .eq("business_id", businessId)
    .in("source_type", ["onboarding", "policy"]);

  // 4. Build new context blocks
  const blocks: Array<{
    business_id: string;
    source_type: string;
    source_id: string | null;
    title: string;
    content: string;
    priority: number;
    is_active: boolean;
  }> = [];

  // ── From Onboarding Profile ──
  if (profile) {
    // Business overview block
    const overviewLines: string[] = [];

    if (profile.business_description) {
      overviewLines.push(`What we do: ${profile.business_description}`);
    }
    if (profile.target_audience) {
      overviewLines.push(`Target audience: ${profile.target_audience}`);
    }
    if (profile.team_size) {
      overviewLines.push(`Team size: ${profile.team_size}`);
    }
    if (profile.goals) {
      overviewLines.push(`Goals: ${profile.goals}`);
    }

    if (overviewLines.length > 0) {
      blocks.push({
        business_id: businessId,
        source_type: "onboarding",
        source_id: profile.id,
        title: "Business Overview",
        content: overviewLines.join("\n"),
        priority: 1,
        is_active: true,
      });
    }

    // Tone of voice block
    if (profile.tone_of_voice) {
      blocks.push({
        business_id: businessId,
        source_type: "onboarding",
        source_id: profile.id,
        title: "Communication Style",
        content:
          `When communicating on behalf of this business, use the following tone and style:\n${profile.tone_of_voice}`,
        priority: 2,
        is_active: true,
      });
    }

    // Products/services block
    if (profile.products_services && profile.products_services.length > 0) {
      const productsList = profile.products_services
        .map((p: string) => `- ${p}`)
        .join("\n");
      blocks.push({
        business_id: businessId,
        source_type: "onboarding",
        source_id: profile.id,
        title: "Products & Services",
        content: `This business offers:\n${productsList}`,
        priority: 3,
        is_active: true,
      });
    }

    // Tools/software block
    if (profile.primary_tools && profile.primary_tools.length > 0) {
      const toolsList = profile.primary_tools
        .map((t: string) => `- ${t}`)
        .join("\n");
      blocks.push({
        business_id: businessId,
        source_type: "onboarding",
        source_id: profile.id,
        title: "Software & Tools",
        content: `The business uses these tools:\n${toolsList}`,
        priority: 8,
        is_active: true,
      });
    }
  }

  // ── From Policies ──
  if (policies && policies.length > 0) {
    for (const policy of policies) {
      blocks.push({
        business_id: businessId,
        source_type: "policy",
        source_id: policy.id,
        title: policy.title,
        content: policy.content,
        priority: 5,
        is_active: true,
      });
    }
  }

  // 5. Insert all blocks
  if (blocks.length > 0) {
    const { error } = await serviceClient
      .from("ai_context_blocks")
      .insert(blocks);

    if (error) {
      throw new Error(`Failed to insert context blocks: ${error.message}`);
    }
  }

  return { blocksCreated: blocks.length };
}

/**
 * Convenience: call this after onboarding is completed to generate
 * initial context blocks and mark the business as onboarded.
 */
export async function finalizeOnboarding(businessId: string): Promise<void> {
  const serviceClient = createServiceClient();

  // Build context blocks
  await rebuildContextBlocks(businessId);

  // Mark business as onboarded
  await serviceClient
    .from("businesses")
    .update({ onboarding_completed: true })
    .eq("id", businessId);
}
