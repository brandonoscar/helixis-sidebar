/**
 * Helixis Extension — Supabase Client
 *
 * Lightweight Supabase auth + API wrapper for the browser extension.
 * No secrets stored here — only the public anon key and project URL.
 *
 * SECURITY NOTES:
 * - SUPABASE_URL and SUPABASE_ANON_KEY are public/safe to embed in client code.
 *   They are NOT secrets. The anon key only grants access gated by RLS policies.
 * - The real protection comes from RLS policies on every table.
 * - JWT is stored in chrome.storage.session (cleared on browser close).
 * - Never store refresh tokens in chrome.storage.local (persists, extractable).
 */

// ── Configuration ─────────────────────────────────────────────
// Replace these with your actual Supabase project values.
const SUPABASE_URL = "https://YOUR_PROJECT_REF.supabase.co";
const SUPABASE_ANON_KEY = "YOUR_ANON_KEY";

// ── Session State ─────────────────────────────────────────────

let _session = null; // { access_token, refresh_token, user, expires_at }

/**
 * Load session from chrome.storage.session (encrypted, session-scoped).
 */
async function loadSession() {
  const data = await chrome.storage.session.get("helixis_session");
  _session = data.helixis_session || null;
  return _session;
}

/**
 * Save session to chrome.storage.session.
 */
async function saveSession(session) {
  _session = session;
  if (session) {
    await chrome.storage.session.set({ helixis_session: session });
  } else {
    await chrome.storage.session.remove("helixis_session");
  }
}

// ── Auth Functions ────────────────────────────────────────────

/**
 * Sign in with email and password.
 * Returns { user, session } or throws.
 */
export async function signIn(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ email, password }),
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error_description || err.msg || "Sign in failed");
  }

  const data = await res.json();
  const session = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    user: data.user,
    expires_at: Date.now() + data.expires_in * 1000,
  };

  await saveSession(session);
  return session;
}

/**
 * Sign out — clear local session.
 */
export async function signOut() {
  if (_session?.access_token) {
    // Best-effort server-side logout
    try {
      await fetch(`${SUPABASE_URL}/auth/v1/logout`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${_session.access_token}`,
          apikey: SUPABASE_ANON_KEY,
        },
      });
    } catch {
      // Ignore errors — session will expire anyway
    }
  }
  await saveSession(null);
}

/**
 * Get the current session, refreshing the token if expired.
 * Returns session or null if not authenticated.
 */
export async function getSession() {
  if (!_session) {
    await loadSession();
  }
  if (!_session) return null;

  // Refresh if within 60s of expiry
  if (_session.expires_at - Date.now() < 60_000) {
    try {
      const res = await fetch(
        `${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({ refresh_token: _session.refresh_token }),
        }
      );

      if (!res.ok) {
        await saveSession(null);
        return null;
      }

      const data = await res.json();
      _session = {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        user: data.user,
        expires_at: Date.now() + data.expires_in * 1000,
      };
      await saveSession(_session);
    } catch {
      await saveSession(null);
      return null;
    }
  }

  return _session;
}

/**
 * Check if the user is currently authenticated.
 */
export async function isAuthenticated() {
  const session = await getSession();
  return session !== null;
}

// ── API Helpers ───────────────────────────────────────────────

/**
 * Make an authenticated request to a Supabase Edge Function.
 * Automatically includes the JWT bearer token.
 */
export async function callFunction(functionName, body = {}) {
  const session = await getSession();
  if (!session) {
    throw new Error("Not authenticated");
  }

  const res = await fetch(
    `${SUPABASE_URL}/functions/v1/${functionName}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
        apikey: SUPABASE_ANON_KEY,
      },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error || `Function call failed: ${res.status}`);
  }

  return await res.json();
}

/**
 * Query a Supabase table directly (via PostgREST, gated by RLS).
 */
export async function query(table, params = {}) {
  const session = await getSession();
  if (!session) throw new Error("Not authenticated");

  const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`);
  url.searchParams.set("select", params.select || "*");

  if (params.filters) {
    for (const [key, value] of Object.entries(params.filters)) {
      url.searchParams.set(key, `eq.${value}`);
    }
  }

  if (params.order) {
    url.searchParams.set("order", params.order);
  }

  if (params.limit) {
    url.searchParams.set("limit", String(params.limit));
  }

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      apikey: SUPABASE_ANON_KEY,
    },
  });

  if (!res.ok) {
    throw new Error(`Query failed: ${res.status}`);
  }

  return await res.json();
}
