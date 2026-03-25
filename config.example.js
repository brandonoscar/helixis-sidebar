/**
 * Helixis Copilot — Configuration Example
 *
 * To configure the extension, set these values in chrome.storage.local
 * via the browser console (on the extension's page) or during onboarding:
 *
 *   chrome.storage.local.set({ helixisConfig: {
 *     supabaseUrl: "https://bvmobfhsbvjqnopigfds.supabase.co",
 *     supabaseAnonKey: "<your-anon-key>",
 *     workspaceId: "<your-workspace-uuid>",
 *     accessToken: "<user-jwt-from-supabase-auth>"
 *   }});
 *
 * The extension reads this config on panel open.
 * All third-party secrets (Buildium API keys, Gemini key) stay server-side.
 *
 * Required Supabase Edge Function secrets (set via Supabase dashboard):
 *   - GEMINI_API_KEY: For AI chat responses (Google Gemini)
 *
 * Required Supabase Vault secrets (per workspace):
 *   - Buildium API client ID
 *   - Buildium API client secret
 *   - Webhook signing secret
 */
