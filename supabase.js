/*
 * Helixis Copilot — supabase.js
 * Lightweight Supabase client using fetch (no SDK dependency).
 */

const SUPABASE_URL  = 'https://bvmobfhsbvjqnopigfds.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ2bW9iZmhzYnZqcW5vcGlnZmRzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI0OTIyNjIsImV4cCI6MjA4ODA2ODI2Mn0.lsfkoTyfHmvnTPdd3o5qjLAGzoc4mNSUkCYmsjYpY9g';

// ── AUTH ──────────────────────────────────────────────

async function supabaseSignIn(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON
    },
    body: JSON.stringify({ email, password })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error_description || err.msg || 'Sign-in failed');
  }
  return res.json(); // { access_token, refresh_token, user, ... }
}

async function supabaseRefreshToken(refreshToken) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON
    },
    body: JSON.stringify({ refresh_token: refreshToken })
  });
  if (!res.ok) throw new Error('Session expired');
  return res.json();
}

async function supabaseGetUser(accessToken) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'apikey': SUPABASE_ANON
    }
  });
  if (!res.ok) throw new Error('Could not fetch user');
  return res.json();
}

// ── QUERIES ──────────────────────────────────────────

async function supabaseQuery(accessToken, table, { select = '*', filters = '', order = '' } = {}) {
  let url = `${SUPABASE_URL}/rest/v1/${table}?select=${encodeURIComponent(select)}`;
  if (filters) url += `&${filters}`;
  if (order)   url += `&order=${encodeURIComponent(order)}`;

  const res = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'apikey': SUPABASE_ANON,
      'Accept': 'application/json'
    }
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `Query failed: ${res.status}`);
  }
  return res.json();
}

// ── SESSION PERSISTENCE ──────────────────────────────

async function saveSession(session) {
  await chrome.storage.local.set({ supabase_session: session });
}

async function loadSession() {
  const { supabase_session } = await chrome.storage.local.get('supabase_session');
  return supabase_session || null;
}

async function clearSession() {
  await chrome.storage.local.remove('supabase_session');
}

// Try to get a valid access token, refreshing if needed
async function getValidToken() {
  const session = await loadSession();
  if (!session) return null;

  // Check if token is still valid (with 60s buffer)
  const expiresAt = session.expires_at || 0;
  const now = Math.floor(Date.now() / 1000);

  if (now < expiresAt - 60) {
    return session.access_token;
  }

  // Try refresh
  try {
    const refreshed = await supabaseRefreshToken(session.refresh_token);
    await saveSession(refreshed);
    return refreshed.access_token;
  } catch {
    await clearSession();
    return null;
  }
}
