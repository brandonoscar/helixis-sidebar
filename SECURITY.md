# Helixis — Security & SOC 2 Notes

## Secret Handling Rules

### Platform API Keys (OpenAI, Anthropic, etc.)
- Stored as **Supabase Edge Function environment variables**
- Set via `supabase secrets set OPENAI_API_KEY=sk-...`
- Never in source code, never in the database, never sent to clients
- Edge Functions read them via `Deno.env.get("OPENAI_API_KEY")`

### Per-Business Integration Secrets (client's own API keys)
- Encrypted with **AES-256-GCM** before storage
- Encryption key (`HELIXIS_ENCRYPTION_KEY`) is an Edge Function env var
- Stored in `integration_secrets` table (encrypted blob only)
- **RLS blocks all client access** — no RLS policies exist for this table
- Only Edge Functions using `service_role` key can read/decrypt
- Key hints (last 4 chars) stored separately for UI display

### What the Extension Can Access
- Its own JWT (stored in `chrome.storage.session`, cleared on browser close)
- Business data gated by RLS (only their own business)
- AI responses (from proxied backend calls)
- Integration results (from proxied backend calls)

### What the Extension CANNOT Access
- Raw third-party API keys
- Other businesses' data
- `integration_secrets` table (RLS blocks all client access)
- `audit_logs` insert (only service_role can write)
- Edge Function environment variables

## SOC 2 Controls Mapping

| Control | Implementation |
|---------|---------------|
| **Access Control** | RLS policies enforce per-business isolation; role-based access (owner/admin/member/viewer) |
| **Least Privilege** | Extension gets scoped JWT; sees only its business data; never sees secrets |
| **Encryption at Rest** | Integration secrets encrypted with AES-256-GCM; Supabase encrypts DB at rest |
| **Encryption in Transit** | All API calls over HTTPS/TLS; Supabase enforces TLS |
| **Audit Logging** | `audit_logs` table records all sensitive operations; immutable (no client delete) |
| **Session Management** | JWTs expire in 1hr; refresh tokens rotate; extension uses session storage |
| **Change Management** | Database migrations versioned in git; Edge Functions deployed from code |
| **Incident Response** | Audit logs enable investigation; per-business isolation limits blast radius |

## Anti-Patterns to Avoid

1. **Never** put API keys in `manifest.json`, extension JS files, or `chrome.storage.local`
2. **Never** return raw API keys in API responses to the extension
3. **Never** log secrets in audit logs, console, or error messages
4. **Never** use `service_role` key in client-side code
5. **Never** disable RLS on any table
6. **Never** store JWTs in `chrome.storage.local` (use `chrome.storage.session`)
7. **Never** trust client-side input without server-side validation
8. **Never** share a single API key across all businesses without scoping

## Key Rotation Procedure

### Platform API Keys
1. Generate new key in provider dashboard
2. `supabase secrets set OPENAI_API_KEY=sk-new-key`
3. Redeploy Edge Functions
4. Revoke old key in provider dashboard

### Per-Business Integration Secrets
1. Business provides new key via onboarding app
2. Backend encrypts with current `HELIXIS_ENCRYPTION_KEY`
3. Old encrypted record is replaced
4. `rotated_at` timestamp updated
5. Audit log entry created

### Encryption Key Rotation
1. This is a more complex operation — requires re-encrypting all secrets
2. Deploy new Edge Function version that can read both old and new keys
3. Run migration to re-encrypt all secrets with new key
4. Remove old key from environment
