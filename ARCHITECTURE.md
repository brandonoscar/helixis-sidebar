# Helixis MVP Architecture

## A. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        CLIENT LAYER                                 │
│  ┌──────────────────────┐     ┌──────────────────────────────────┐  │
│  │  Onboarding Web App  │     │   Helixis Browser Extension      │  │
│  │  (Next.js / React)   │     │   (Chrome Side Panel)            │  │
│  │                      │     │                                  │  │
│  │  - Business signup   │     │  - Auth via Supabase JS client   │  │
│  │  - Profile wizard    │     │  - Fetch business context        │  │
│  │  - Policy entry      │     │  - Chat with AI copilot          │  │
│  │  - Doc upload        │     │  - Page capture + actions         │  │
│  │  - Integration setup │     │  - No secrets stored locally     │  │
│  └──────────┬───────────┘     └──────────────┬───────────────────┘  │
│             │                                │                      │
└─────────────┼────────────────────────────────┼──────────────────────┘
              │ Supabase Auth (JWT)            │ Supabase Auth (JWT)
              ▼                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     BACKEND / API LAYER                              │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │              Supabase Edge Functions                          │   │
│  │                                                              │   │
│  │  POST /functions/v1/business-context                         │   │
│  │    → Returns assembled AI context for logged-in business     │   │
│  │                                                              │   │
│  │  POST /functions/v1/ai-chat                                  │   │
│  │    → Proxies AI requests (uses server-side API keys)         │   │
│  │                                                              │   │
│  │  POST /functions/v1/integration-proxy                        │   │
│  │    → Calls third-party APIs using server-stored secrets      │   │
│  │                                                              │   │
│  │  POST /functions/v1/upload-document                          │   │
│  │    → Handles file upload + text extraction                   │   │
│  │                                                              │   │
│  │  POST /functions/v1/ingest-pdf-intake                        │   │
│  │    → Parses templated PDF intake form into structured data   │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                     │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       DATA LAYER (Supabase)                         │
│                                                                     │
│  ┌────────────────────┐  ┌────────────────────────────────────────┐ │
│  │   Supabase Auth    │  │          PostgreSQL Database           │ │
│  │                    │  │                                        │ │
│  │  - Email/password  │  │  businesses                            │ │
│  │  - Magic link      │  │  business_members (role-based)         │ │
│  │  - JWT tokens      │  │  onboarding_profiles                  │ │
│  │  - RLS enforcement │  │  business_policies                    │ │
│  │                    │  │  integrations                          │ │
│  └────────────────────┘  │  integration_secrets (encrypted)       │ │
│                          │  uploaded_documents                    │ │
│  ┌────────────────────┐  │  ai_context_blocks                    │ │
│  │  Supabase Storage  │  │  audit_logs                           │ │
│  │  (File uploads)    │  │  extension_sessions                   │ │
│  └────────────────────┘  └────────────────────────────────────────┘ │
│                                                                     │
│  ┌────────────────────┐  ┌────────────────────────────────────────┐ │
│  │   Vault            │  │  Environment Variables                 │ │
│  │   (Supabase Vault) │  │  (Edge Function secrets)               │ │
│  │                    │  │                                        │ │
│  │  Per-business      │  │  OPENAI_API_KEY                        │ │
│  │  integration keys  │  │  ANTHROPIC_API_KEY                     │ │
│  │  (AES-256-GCM)    │  │  HELIXIS_ENCRYPTION_KEY                │ │
│  └────────────────────┘  └────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

### Auth Flow

1. User signs up/logs in via Supabase Auth (email + password or magic link)
2. Supabase issues a JWT containing `user_id`
3. Extension stores the JWT in `chrome.storage.session` (encrypted, session-scoped)
4. All API calls from extension include `Authorization: Bearer <jwt>`
5. Edge Functions validate the JWT and extract `user_id`
6. RLS policies enforce that users only see their own business data

### Row-Level Security Strategy

Every table has RLS enabled. Policies follow this pattern:
- `business_members` links `auth.uid()` to a `business_id` with a `role`
- All business-scoped tables check: "Does this user have a row in `business_members` for this `business_id`?"
- Write operations check for `role IN ('owner', 'admin')`
- Read operations check for any valid membership

### Secure Secret Storage Strategy

**For Helixis platform API keys** (OpenAI, Anthropic, etc.):
- Stored as Edge Function environment variables
- Never exposed to any client
- Only Edge Functions can access them

**For per-business integration secrets** (client's own API keys for their tools):
- Encrypted at rest using AES-256-GCM with a server-side key
- Stored in `integration_secrets` table with only the encrypted blob
- Decrypted only inside Edge Functions at call time
- Extension never receives raw secrets
- Alternative: Use Supabase Vault for automatic encryption at rest

### What NOT To Do (SOC 2 Anti-Patterns)

- NEVER embed API keys in extension source code or manifest
- NEVER store secrets in `chrome.storage.local` (persists, extractable)
- NEVER pass raw third-party API keys to the client in API responses
- NEVER log secrets in audit logs or error messages
- NEVER use a single shared API key without per-business scoping
- NEVER skip JWT validation in Edge Functions

### SOC 2-Friendly Practices

1. **Least privilege**: Extension gets only scoped JWT + business data it needs
2. **Encryption at rest**: Integration secrets encrypted with AES-256-GCM
3. **Encryption in transit**: All Supabase calls over HTTPS/TLS
4. **Audit logging**: All sensitive operations logged to `audit_logs`
5. **Role-based access**: `business_members.role` controls who can read/write what
6. **Session management**: JWTs expire; extension sessions are time-limited
7. **No client-side secrets**: All third-party API calls proxied through backend

---

## B. Database Design

### Table: `businesses`
**Purpose**: Root entity for each business customer.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | Default `gen_random_uuid()` |
| name | text NOT NULL | Business display name |
| slug | text UNIQUE | URL-safe identifier |
| industry | text | Business vertical |
| onboarding_completed | boolean | Default false |
| created_at | timestamptz | Default `now()` |
| updated_at | timestamptz | Auto-updated |

### Table: `business_members`
**Purpose**: Links users to businesses with roles. One user can belong to multiple businesses.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| business_id | uuid FK → businesses | |
| user_id | uuid FK → auth.users | |
| role | text | `owner`, `admin`, `member`, `viewer` |
| invited_by | uuid | Who invited this member |
| created_at | timestamptz | |

**Unique**: `(business_id, user_id)`

### Table: `onboarding_profiles`
**Purpose**: Structured business info collected during onboarding. Core knowledge base for AI.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| business_id | uuid FK → businesses | UNIQUE |
| business_description | text | What the business does |
| target_audience | text | Who they serve |
| tone_of_voice | text | Brand voice guidelines |
| products_services | jsonb | Array of offerings |
| team_size | text | |
| primary_tools | jsonb | Software they use |
| goals | text | What they want Helixis to help with |
| custom_fields | jsonb | Flexible key-value pairs |
| created_at | timestamptz | |
| updated_at | timestamptz | |

### Table: `business_policies`
**Purpose**: Human-written policy text (support policies, refund rules, SLAs, etc.)

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| business_id | uuid FK → businesses | |
| title | text NOT NULL | e.g., "Return Policy" |
| category | text | `support`, `sales`, `hr`, `operations`, `custom` |
| content | text NOT NULL | The full policy text |
| is_active | boolean | Default true |
| created_at | timestamptz | |
| updated_at | timestamptz | |

### Table: `integrations`
**Purpose**: Tracks which third-party services a business has connected.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| business_id | uuid FK → businesses | |
| provider | text NOT NULL | `slack`, `zendesk`, `hubspot`, etc. |
| status | text | `active`, `inactive`, `pending` |
| config | jsonb | Non-secret configuration |
| scopes | text[] | Granted permission scopes |
| created_at | timestamptz | |
| updated_at | timestamptz | |

**Unique**: `(business_id, provider)`

### Table: `integration_secrets`
**Purpose**: Encrypted storage for per-business API keys and tokens.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| integration_id | uuid FK → integrations | UNIQUE |
| encrypted_key | text NOT NULL | AES-256-GCM encrypted blob |
| key_hint | text | Last 4 chars for display: `••••a1b2` |
| expires_at | timestamptz | For OAuth tokens |
| created_at | timestamptz | |
| rotated_at | timestamptz | Last rotation time |

**RLS**: NO direct client access. Only Edge Functions via `service_role` key.

### Table: `uploaded_documents`
**Purpose**: Files uploaded during onboarding or later (PDFs, docs, images).

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| business_id | uuid FK → businesses | |
| file_name | text NOT NULL | Original filename |
| storage_path | text NOT NULL | Supabase Storage path |
| mime_type | text | |
| file_size_bytes | integer | |
| extracted_text | text | Parsed text content |
| status | text | `processing`, `ready`, `failed` |
| uploaded_by | uuid FK → auth.users | |
| created_at | timestamptz | |

### Table: `ai_context_blocks`
**Purpose**: Normalized, AI-ready knowledge chunks derived from onboarding data, policies, and documents.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| business_id | uuid FK → businesses | |
| source_type | text NOT NULL | `onboarding`, `policy`, `document`, `pdf_intake`, `manual` |
| source_id | uuid | FK to the originating record |
| title | text | Human label |
| content | text NOT NULL | The AI-readable text block |
| priority | integer | Ordering hint (1 = highest) |
| is_active | boolean | Default true |
| created_at | timestamptz | |
| updated_at | timestamptz | |

### Table: `audit_logs`
**Purpose**: Immutable log of sensitive operations for SOC 2 compliance.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| business_id | uuid | |
| user_id | uuid | |
| action | text NOT NULL | `secret.created`, `secret.accessed`, `member.invited`, `context.fetched`, etc. |
| resource_type | text | Table name |
| resource_id | uuid | Row ID |
| metadata | jsonb | Additional context (never secrets) |
| ip_address | inet | |
| created_at | timestamptz | Default `now()` |

**RLS**: Insert-only for service role. Read for owners/admins.

### Table: `extension_sessions`
**Purpose**: Tracks active extension sessions for analytics and security.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| business_id | uuid FK → businesses | |
| user_id | uuid FK → auth.users | |
| started_at | timestamptz | Default `now()` |
| last_active_at | timestamptz | |
| user_agent | text | |
| is_active | boolean | Default true |

---

## C. Secure Secret Handling

### Architecture

```
Extension                    Edge Function                  Database
   │                              │                            │
   │  POST /ai-chat               │                            │
   │  Authorization: Bearer jwt   │                            │
   │ ─────────────────────────►   │                            │
   │                              │  1. Validate JWT           │
   │                              │  2. Read OPENAI_API_KEY    │
   │                              │     from env vars          │
   │                              │  3. Call OpenAI API        │
   │                              │  4. Log to audit_logs      │
   │                              │  5. Return AI response     │
   │  ◄─────────────────────────  │                            │
   │  { response: "..." }         │                            │
```

### For per-business secrets (client's own keys):

```
Extension                    Edge Function                   Database
   │                              │                             │
   │  POST /integration-proxy     │                             │
   │  { provider: "zendesk",      │                             │
   │    action: "list_tickets" }  │                             │
   │ ─────────────────────────►   │                             │
   │                              │  1. Validate JWT            │
   │                              │  2. Look up integration     │
   │                              │     for this business       │
   │                              │  3. Decrypt secret from     │
   │                              │     integration_secrets     │
   │                              │     using ENCRYPTION_KEY    │
   │                              │  4. Call Zendesk API        │
   │                              │  5. Log access to audit_log │
   │                              │  6. Return result           │
   │  ◄─────────────────────────  │                             │
   │  { tickets: [...] }          │                             │
```

### Blast Radius Containment

| Compromise | Impact | Mitigation |
|-----------|--------|------------|
| Extension compromised | Attacker gets JWT (short-lived) | JWT expires in 1hr; refresh tokens rotate |
| Single JWT stolen | Access to one user's data only | RLS enforces per-business isolation |
| Database breached | Encrypted secrets unreadable | AES-256-GCM; encryption key is in env vars, not DB |
| Edge Function env leaked | Platform keys exposed | Rotate immediately; per-business keys still encrypted in DB |

---

## D. Extension Integration Flow

### Step-by-step:

1. **User opens extension** → Panel loads → Checks `chrome.storage.session` for existing JWT
2. **No session** → Shows login screen → User enters email/password
3. **Login** → `supabase.auth.signInWithPassword()` → Gets JWT + refresh token
4. **Store session** → JWT in `chrome.storage.session` (cleared on browser close)
5. **Identify business** → `GET business_members WHERE user_id = auth.uid()` → Gets `business_id`
6. **Multi-business?** → If user belongs to multiple businesses, show picker
7. **Fetch context** → `POST /functions/v1/business-context` with JWT → Returns assembled business profile + policies + AI context
8. **Load copilot** → Business data injected as system prompt context for AI
9. **Chat** → User messages go to `POST /functions/v1/ai-chat` which includes business context + conversation
10. **Integration calls** → Any third-party actions routed through `POST /functions/v1/integration-proxy`

---

## E. AI Knowledge Flow

### How onboarding becomes AI context:

```
Onboarding Input              Processing                AI Context Block
─────────────────            ──────────                ─────────────────
Business profile    ──►  Normalize to structured  ──►  "Business Config"
                         key-value summary              block

Policy text         ──►  Store as-is with         ──►  "Policy: {title}"
                         category tags                  block

Uploaded docs       ──►  Extract text, chunk      ──►  "Document: {name}"
                         if needed                      block

PDF intake form     ──►  Parse fields, map to     ──►  "Intake: {section}"
                         onboarding schema              block
```

### Context Assembly (at query time):

```javascript
// Pseudocode for assembling AI system prompt
function assembleContext(businessId) {
  const blocks = await getActiveContextBlocks(businessId);

  const systemPrompt = `
You are Helixis Copilot, an AI assistant for this business.

## Business Context
${blocks.filter(b => b.source_type === 'onboarding').map(b => b.content).join('\n')}

## Policies
${blocks.filter(b => b.source_type === 'policy').map(b => `### ${b.title}\n${b.content}`).join('\n\n')}

## Knowledge Base
${blocks.filter(b => b.source_type === 'document').map(b => `[${b.title}]: ${b.content}`).join('\n\n')}

Use the above context to answer questions accurately. If something isn't covered,
say so rather than guessing. Always follow the business policies.
`;

  return systemPrompt;
}
```

### Separation of context types:

| Type | Source | Format | Update Frequency |
|------|--------|--------|-----------------|
| Structured business config | Onboarding profile | Key-value JSON → text | On profile edit |
| Human-written policy text | Business policies | Raw text with title | On policy CRUD |
| Uploaded file content | Documents | Extracted text chunks | On upload |
| Generated AI summary | Auto-generated | LLM-summarized text | On source change |

---

## F. PDF Intake Form Plan

### Recommended Field Structure

The templated PDF should have these sections:

**Section 1: Business Basics**
- Business legal name
- DBA / brand name
- Industry / vertical
- Year founded
- Business address
- Website URL

**Section 2: Products & Services**
- Primary offerings (list)
- Target audience
- Average deal size / pricing model
- Competitive differentiators

**Section 3: Team & Operations**
- Team size
- Key departments
- Primary software tools used
- Communication channels

**Section 4: Policies & Guidelines**
- Customer support policy summary
- Return / refund policy
- SLA commitments
- Escalation procedures
- Brand voice / tone guidelines

**Section 5: Goals & Priorities**
- What they want Helixis to help with
- Top 3 operational pain points
- KPIs they track
- Desired integrations

### Extraction Pipeline

```
PDF Upload ──► Text Extraction (pdf-parse) ──► Field Mapping ──► Validation ──► Insert
                                                    │
                                    ┌───────────────┼───────────────┐
                                    ▼               ▼               ▼
                            onboarding_profiles  business_policies  ai_context_blocks
```

### How to avoid relying on raw PDF text:

1. Use a **structured PDF form** (fillable fields) so extraction is field-based, not OCR guesswork
2. After extraction, map each field to the correct database column
3. Store both the raw `extracted_text` (in `uploaded_documents`) AND the parsed structured data (in `onboarding_profiles`)
4. Generate `ai_context_blocks` from the structured data, not the raw text
5. Allow human review/correction of parsed fields before they become AI context

---

## G. Build Plan

### Phase 1: Foundation (Connect onboarding → extension)
1. Create all database tables with RLS
2. Create `business-context` Edge Function
3. Add Supabase auth to extension (login screen, JWT storage)
4. Add business identification flow in extension
5. Fetch and display business context in extension
6. Create audit logging for context access

### Phase 2: AI & Integrations
1. Create `ai-chat` Edge Function (proxies to OpenAI/Anthropic)
2. Build AI context assembly from `ai_context_blocks`
3. Add `integration-proxy` Edge Function
4. Add `integration_secrets` encryption/decryption
5. Add document upload + text extraction
6. Wire chat in extension to real AI backend

### Phase 3: PDF Intake
1. Design fillable PDF template
2. Create `ingest-pdf-intake` Edge Function
3. Build field extraction + mapping logic
4. Add review/correction UI in onboarding app
5. Auto-generate `ai_context_blocks` from parsed PDF data
