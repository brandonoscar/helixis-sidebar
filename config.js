// Helixis Copilot — deployment configuration.
//
// SUPABASE_URL must be the SAME project the AgenticHelixis backend
// verifies JWTs against (helixis-test) — a token minted by any other
// project is rejected with 401. The anon key is public by design
// (RLS enforces access); paste it from Supabase → Settings → API.

export const API_URL = 'https://agentichelixis.onrender.com';
export const SUPABASE_URL = 'https://shwwcxkeewpotnigwvqp.supabase.co';
export const SUPABASE_ANON_KEY = ''; // ← paste the helixis-test anon key

export const configured = () => Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
