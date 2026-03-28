/*
 * Helixis Copilot — supabase.js
 * Lightweight Supabase RPC client using fetch (no SDK, no auth required).
 */

const SUPABASE_URL  = 'https://bvmobfhsbvjqnopigfds.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ2bW9iZmhzYnZqcW5vcGlnZmRzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI0OTIyNjIsImV4cCI6MjA4ODA2ODI2Mn0.lsfkoTyfHmvnTPdd3o5qjLAGzoc4mNSUkCYmsjYpY9g';

const HEADERS = {
  'Content-Type': 'application/json',
  'apikey': SUPABASE_ANON,
  'Authorization': `Bearer ${SUPABASE_ANON}`
};

// Call a Supabase RPC function
async function supabaseRpc(fnName, params = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fnName}`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(params)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `RPC ${fnName} failed: ${res.status}`);
  }
  return res.json();
}

// Fetch all workspaces (for picker)
async function fetchWorkspaces() {
  return supabaseRpc('list_workspaces');
}

// Fetch a single workspace with integrations + members
async function fetchWorkspaceBySlug(slug) {
  return supabaseRpc('get_workspace_by_slug', { workspace_slug: slug });
}
