// Helixis Copilot — deployment configuration.
//
// SUPABASE_URL must be the SAME project the AgenticHelixis backend
// verifies JWTs against (helixis-test) — a token minted by any other
// project is rejected with 401. The anon key is public by design
// (RLS enforces access).

export const API_URL = 'https://agentichelixis.onrender.com';
export const SUPABASE_URL = 'https://shwwcxkeewpotnigwvqp.supabase.co';
export const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNod3djeGtlZXdwb3RuaWd3dnFwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU5NjMwOTMsImV4cCI6MjA5MTUzOTA5M30.2BDeNEljl-EdTlQv1bWm10GHT_I9-t1gR_9uOnoBfo8';

export const configured = () => Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
