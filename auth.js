// Helixis Copilot — Supabase GoTrue auth over plain REST.
//
// No supabase-js dependency: the panel only needs OTP sign-in, token
// storage, and refresh. Mirrors the email + 6-digit-code flow the
// onboarding wizard uses, against the same Supabase project, so one
// account works across every Helixis surface.

import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const STORAGE_KEY = 'helixisSession';

/** session = { access_token, refresh_token, expires_at (epoch s), email } */
let cached = null;

async function loadSession() {
  if (cached) return cached;
  const data = await chrome.storage.local.get(STORAGE_KEY);
  cached = data[STORAGE_KEY] ?? null;
  return cached;
}

async function saveSession(session) {
  cached = session;
  if (session) await chrome.storage.local.set({ [STORAGE_KEY]: session });
  else await chrome.storage.local.remove(STORAGE_KEY);
}

function gotrueHeaders() {
  return {
    'Content-Type': 'application/json',
    apikey: SUPABASE_ANON_KEY,
  };
}

function toSession(payload, email) {
  return {
    access_token: payload.access_token,
    refresh_token: payload.refresh_token,
    // expires_at is seconds-epoch; fall back to now + expires_in.
    expires_at:
      payload.expires_at ?? Math.floor(Date.now() / 1000) + (payload.expires_in ?? 3600),
    email: email ?? payload.user?.email ?? '',
  };
}

/** Request a 6-digit email code. */
export async function sendOtp(email) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/otp`, {
    method: 'POST',
    headers: gotrueHeaders(),
    body: JSON.stringify({ email, create_user: true }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.msg || body.error_description || `Sign-in failed (${res.status})`);
  }
}

/** Exchange the emailed code for a session. */
export async function verifyOtp(email, code) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/verify`, {
    method: 'POST',
    headers: gotrueHeaders(),
    body: JSON.stringify({ type: 'email', email, token: code }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    throw new Error(body.msg || body.error_description || 'Invalid or expired code');
  }
  const session = toSession(body, email);
  await saveSession(session);
  return session;
}

async function refresh(session) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: gotrueHeaders(),
    body: JSON.stringify({ refresh_token: session.refresh_token }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    // Refresh token rejected — the session is gone for good.
    await saveSession(null);
    return null;
  }
  const next = toSession(body, session.email);
  await saveSession(next);
  return next;
}

/** Current valid access token, refreshing if within 60s of expiry.
 *  Returns null when signed out. */
export async function getAccessToken() {
  let session = await loadSession();
  if (!session) return null;
  if (session.expires_at - Math.floor(Date.now() / 1000) < 60) {
    session = await refresh(session);
    if (!session) return null;
  }
  return session.access_token;
}

export async function getSessionInfo() {
  const session = await loadSession();
  return session ? { email: session.email } : null;
}

export async function signOut() {
  await saveSession(null);
}
