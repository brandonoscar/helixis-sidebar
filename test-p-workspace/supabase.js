/*
 * Helixis Copilot (P Workspace Test) — supabase.js
 * Fetches P Property Management workspace data via RPC (no auth needed).
 * Chat is proxied through a Supabase edge function (API key stored in vault).
 */

const SUPABASE_URL  = 'https://bvmobfhsbvjqnopigfds.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ2bW9iZmhzYnZqcW5vcGlnZmRzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI0OTIyNjIsImV4cCI6MjA4ODA2ODI2Mn0.lsfkoTyfHmvnTPdd3o5qjLAGzoc4mNSUkCYmsjYpY9g';

const WORKSPACE_SLUG = 'p-property-management';

// Fetch Buildium data via edge function
async function fetchBuildiumData(workspaceId, endpoint = 'rentals') {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/fetch-buildium-data`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON,
      'Authorization': `Bearer ${SUPABASE_ANON}`
    },
    body: JSON.stringify({ workspace_id: workspaceId, endpoint })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Buildium fetch failed: ${res.status}`);
  }
  return res.json();
}

async function fetchWorkspaceData() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_workspace_by_slug`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON,
      'Authorization': `Bearer ${SUPABASE_ANON}`
    },
    body: JSON.stringify({ workspace_slug: WORKSPACE_SLUG })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `Failed: ${res.status}`);
  }
  return res.json();
}

// Build system prompt with workspace context
function buildSystemPrompt(workspace, integrations, pageContext, buildiumData) {
  let prompt = `You are Helixis Copilot, an AI assistant for property management companies. You are helping the team at "${workspace.name}".

Workspace details:
- Name: ${workspace.name}
- Slug: ${workspace.slug}
- Created: ${workspace.created_at}
- Onboarding: ${workspace.onboarding_completed_at ? 'Complete' : 'In progress'}`;

  if (integrations && integrations.length > 0) {
    prompt += '\n\nConnected integrations:';
    integrations.forEach(intg => {
      prompt += `\n- ${intg.provider} (${intg.status}, ${intg.environment})`;
      if (intg.last_test_result?.message) prompt += ` — ${intg.last_test_result.message}`;
    });
  }

  if (buildiumData) {
    prompt += '\n\nBuildium Property Data (LIVE from API):';
    if (buildiumData.rentals && buildiumData.rentals.length > 0) {
      prompt += `\nRental Properties (${buildiumData.rentals.length} total):`;
      buildiumData.rentals.slice(0, 25).forEach(r => {
        prompt += `\n- ${r.Name || r.name || 'Unnamed'} (ID: ${r.Id || r.id})`;
        if (r.Address) {
          const a = r.Address;
          prompt += ` — ${a.AddressLine1 || ''}${a.City ? ', ' + a.City : ''}${a.State ? ', ' + a.State : ''}`;
        }
        if (r.NumberOfUnits) prompt += ` | ${r.NumberOfUnits} units`;
      });
      if (buildiumData.rentals.length > 25) prompt += `\n... and ${buildiumData.rentals.length - 25} more`;
    }
  }

  if (pageContext) {
    prompt += `\n\nThe user is currently viewing:
- Site: ${pageContext.hostname}
- Title: ${pageContext.title}
- Page text (truncated): ${pageContext.text?.slice(0, 2000) || '(none)'}`;
  }

  prompt += '\n\nBe concise, helpful, and professional. If asked about properties, tenants, maintenance, or leasing, provide relevant advice. If the user asks something you cannot answer from context, say so honestly.';

  return prompt;
}

// Send chat via Supabase edge function (Gemini key is server-side in vault)
async function sendToGemini(messages, systemPrompt) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/chat-gemini`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON,
      'Authorization': `Bearer ${SUPABASE_ANON}`
    },
    body: JSON.stringify({ messages, systemPrompt })
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    console.error('Helixis chat error:', JSON.stringify(err));
    throw new Error(err.error || `Chat failed: ${res.status}`);
  }

  const data = await res.json();
  console.log('Helixis: chat response via model', data.model);
  return data.reply;
}
