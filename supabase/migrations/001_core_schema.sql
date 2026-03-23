-- ============================================================================
-- Helixis MVP — Core Schema
-- Migration 001: All tables, indexes, and triggers
-- ============================================================================

-- Enable required extensions
create extension if not exists "pgcrypto";
create extension if not exists "pgsodium";

-- ============================================================================
-- 1. BUSINESSES
-- ============================================================================
create table public.businesses (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  slug            text unique,
  industry        text,
  website_url     text,
  onboarding_completed boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index idx_businesses_slug on public.businesses (slug);

-- ============================================================================
-- 2. BUSINESS_MEMBERS
-- ============================================================================
create table public.business_members (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  role            text not null default 'member'
                  check (role in ('owner', 'admin', 'member', 'viewer')),
  invited_by      uuid references auth.users(id),
  created_at      timestamptz not null default now(),

  unique (business_id, user_id)
);

create index idx_business_members_user on public.business_members (user_id);
create index idx_business_members_business on public.business_members (business_id);

-- ============================================================================
-- 3. ONBOARDING_PROFILES
-- ============================================================================
create table public.onboarding_profiles (
  id                    uuid primary key default gen_random_uuid(),
  business_id           uuid not null unique references public.businesses(id) on delete cascade,
  business_description  text,
  target_audience       text,
  tone_of_voice         text,
  products_services     jsonb default '[]'::jsonb,
  team_size             text,
  primary_tools         jsonb default '[]'::jsonb,
  goals                 text,
  custom_fields         jsonb default '{}'::jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- ============================================================================
-- 4. BUSINESS_POLICIES
-- ============================================================================
create table public.business_policies (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses(id) on delete cascade,
  title           text not null,
  category        text default 'custom'
                  check (category in ('support', 'sales', 'hr', 'operations', 'legal', 'custom')),
  content         text not null,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index idx_business_policies_business on public.business_policies (business_id);

-- ============================================================================
-- 5. INTEGRATIONS
-- ============================================================================
create table public.integrations (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses(id) on delete cascade,
  provider        text not null,
  status          text not null default 'pending'
                  check (status in ('active', 'inactive', 'pending', 'error')),
  config          jsonb default '{}'::jsonb,
  scopes          text[] default '{}',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  unique (business_id, provider)
);

create index idx_integrations_business on public.integrations (business_id);

-- ============================================================================
-- 6. INTEGRATION_SECRETS
-- Encrypted storage — only accessible via service_role (Edge Functions).
-- NO RLS policies for client access. Only Edge Functions read this.
-- ============================================================================
create table public.integration_secrets (
  id              uuid primary key default gen_random_uuid(),
  integration_id  uuid not null unique references public.integrations(id) on delete cascade,
  encrypted_key   text not null,
  key_hint        text,
  expires_at      timestamptz,
  created_at      timestamptz not null default now(),
  rotated_at      timestamptz
);

-- ============================================================================
-- 7. UPLOADED_DOCUMENTS
-- ============================================================================
create table public.uploaded_documents (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses(id) on delete cascade,
  file_name       text not null,
  storage_path    text not null,
  mime_type       text,
  file_size_bytes integer,
  extracted_text  text,
  status          text not null default 'processing'
                  check (status in ('processing', 'ready', 'failed')),
  uploaded_by     uuid references auth.users(id),
  created_at      timestamptz not null default now()
);

create index idx_uploaded_documents_business on public.uploaded_documents (business_id);

-- ============================================================================
-- 8. AI_CONTEXT_BLOCKS
-- ============================================================================
create table public.ai_context_blocks (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses(id) on delete cascade,
  source_type     text not null
                  check (source_type in ('onboarding', 'policy', 'document', 'pdf_intake', 'manual')),
  source_id       uuid,
  title           text,
  content         text not null,
  priority        integer not null default 10,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index idx_ai_context_blocks_business on public.ai_context_blocks (business_id);
create index idx_ai_context_blocks_source on public.ai_context_blocks (source_type, source_id);

-- ============================================================================
-- 9. AUDIT_LOGS
-- ============================================================================
create table public.audit_logs (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid,
  user_id         uuid,
  action          text not null,
  resource_type   text,
  resource_id     uuid,
  metadata        jsonb default '{}'::jsonb,
  ip_address      inet,
  created_at      timestamptz not null default now()
);

create index idx_audit_logs_business on public.audit_logs (business_id, created_at desc);
create index idx_audit_logs_action on public.audit_logs (action);

-- ============================================================================
-- 10. EXTENSION_SESSIONS
-- ============================================================================
create table public.extension_sessions (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  started_at      timestamptz not null default now(),
  last_active_at  timestamptz not null default now(),
  user_agent      text,
  is_active       boolean not null default true
);

create index idx_extension_sessions_user on public.extension_sessions (user_id, is_active);

-- ============================================================================
-- AUTO-UPDATE TRIGGER for updated_at columns
-- ============================================================================
create or replace function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger set_updated_at before update on public.businesses
  for each row execute function public.handle_updated_at();

create trigger set_updated_at before update on public.onboarding_profiles
  for each row execute function public.handle_updated_at();

create trigger set_updated_at before update on public.business_policies
  for each row execute function public.handle_updated_at();

create trigger set_updated_at before update on public.integrations
  for each row execute function public.handle_updated_at();

create trigger set_updated_at before update on public.ai_context_blocks
  for each row execute function public.handle_updated_at();
