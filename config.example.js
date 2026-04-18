/**
 * Helixis Copilot — Configuration Example
 *
 * The extension reads its config from chrome.storage.local on panel open.
 * Set it via the browser console on the extension page:
 *
 *   chrome.storage.local.set({ helixisConfig: {
 *     supabaseUrl: "https://bvmobfhsbvjqnopigfds.supabase.co",
 *     supabaseAnonKey: "<your-anon-key>",
 *     workspaceId: "<your-workspace-uuid>",
 *     accessToken: "<user-jwt-from-supabase-auth>"
 *   }});
 *
 * All third-party secrets (Buildium API keys, Gemini key) stay server-side.
 *
 * Required Supabase Edge Function secrets (set via Supabase dashboard):
 *   - GEMINI_API_KEY: For AI chat responses (Google Gemini)
 *
 * Required Supabase Vault secrets (per workspace):
 *   - Buildium API client ID
 *   - Buildium API client secret
 *   - Webhook signing secret
 *
 * NOTE: The in-sidebar onboarding / business profile flow has been removed.
 * Workspace provisioning and any business profile setup now happens outside
 * the sidebar (e.g. via agentichelixis or direct Supabase tooling).
 */
