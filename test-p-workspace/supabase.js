/*
 * Helixis Copilot (P Workspace Test) — supabase.js
 * Fetches P Property Management workspace data via RPC (no auth needed).
 * Also handles Gemini AI chat.
 */

const SUPABASE_URL  = 'https://bvmobfhsbvjqnopigfds.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ2bW9iZmhzYnZqcW5vcGlnZmRzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI0OTIyNjIsImV4cCI6MjA4ODA2ODI2Mn0.lsfkoTyfHmvnTPdd3o5qjLAGzoc4mNSUkCYmsjYpY9g';

const WORKSPACE_SLUG = 'p-property-management';

const GEMINI_KEY = 'AIzaSyCquMthaqE-6mVwBSj3GkKi1sj9MUMcEM4';

// Try models in order until one works
const GEMINI_MODELS = [
  'gemini-2.5-flash-preview-05-20',
  'gemini-2.5-flash',
  'gemini-1.5-flash-latest',
  'gemini-1.5-flash-002',
  'gemini-pro',
];
let activeModel = null; // cache the working model

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
function buildSystemPrompt(workspace, integrations, pageContext) {
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

  if (pageContext) {
    prompt += `\n\nThe user is currently viewing:
- Site: ${pageContext.hostname}
- Title: ${pageContext.title}
- Page text (truncated): ${pageContext.text?.slice(0, 2000) || '(none)'}`;
  }

  prompt += '\n\nBe concise, helpful, and professional. If asked about properties, tenants, maintenance, or leasing, provide relevant advice. If the user asks something you cannot answer from context, say so honestly.';

  return prompt;
}

// Send chat to Gemini with automatic model fallback
async function sendToGemini(messages, systemPrompt) {
  const contents = [
    { role: 'user', parts: [{ text: systemPrompt }] },
    { role: 'model', parts: [{ text: 'Understood. I\'m Helixis Copilot, ready to help with your property management workspace.' }] },
    ...messages.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.text }]
    }))
  ];

  const body = JSON.stringify({ contents });

  // If we already found a working model, use it
  if (activeModel) {
    return callGeminiModel(activeModel, body);
  }

  // Try each model until one works
  for (const model of GEMINI_MODELS) {
    try {
      const result = await callGeminiModel(model, body);
      activeModel = model; // cache it
      console.log('Helixis: using model', model);
      return result;
    } catch (err) {
      console.warn(`Model ${model} failed:`, err.message);
      continue;
    }
  }

  throw new Error('No available Gemini model found. Check your API key and billing.');
}

async function callGeminiModel(model, body) {
  // Try v1beta first (supports more features), fall back to v1
  for (const version of ['v1beta', 'v1']) {
    const url = `https://generativelanguage.googleapis.com/${version}/models/${model}:generateContent?key=${GEMINI_KEY}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body
    });

    if (res.ok) {
      const data = await res.json();
      return data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response generated.';
    }

    const err = await res.json().catch(() => ({}));
    const msg = err.error?.message || '';

    // If model not found, try next version/model
    if (res.status === 404 || msg.includes('not found') || msg.includes('no longer available')) {
      continue;
    }

    // Other errors (auth, quota, etc.) should throw immediately
    throw new Error(msg || `Gemini error: ${res.status}`);
  }

  throw new Error(`Model ${model} not available`);
}
