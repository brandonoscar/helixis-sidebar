-- ============================================================================
-- Helixis MVP — Row Level Security Policies
-- Migration 002
-- ============================================================================

-- Enable RLS on all tables
alter table public.businesses enable row level security;
alter table public.business_members enable row level security;
alter table public.onboarding_profiles enable row level security;
alter table public.business_policies enable row level security;
alter table public.integrations enable row level security;
alter table public.integration_secrets enable row level security;
alter table public.uploaded_documents enable row level security;
alter table public.ai_context_blocks enable row level security;
alter table public.audit_logs enable row level security;
alter table public.extension_sessions enable row level security;

-- ============================================================================
-- Helper: Check if current user is a member of a business
-- ============================================================================
create or replace function public.is_member_of(biz_id uuid)
returns boolean as $$
  select exists (
    select 1 from public.business_members
    where business_id = biz_id
      and user_id = auth.uid()
  );
$$ language sql security definer stable;

-- ============================================================================
-- Helper: Check if current user is owner/admin of a business
-- ============================================================================
create or replace function public.is_admin_of(biz_id uuid)
returns boolean as $$
  select exists (
    select 1 from public.business_members
    where business_id = biz_id
      and user_id = auth.uid()
      and role in ('owner', 'admin')
  );
$$ language sql security definer stable;

-- ============================================================================
-- BUSINESSES
-- ============================================================================
create policy "Members can view their businesses"
  on public.businesses for select
  using (public.is_member_of(id));

create policy "Admins can update their businesses"
  on public.businesses for update
  using (public.is_admin_of(id));

-- Any authenticated user can create a business (they become owner)
create policy "Authenticated users can create businesses"
  on public.businesses for insert
  with check (auth.uid() is not null);

-- ============================================================================
-- BUSINESS_MEMBERS
-- ============================================================================
create policy "Members can view fellow members"
  on public.business_members for select
  using (public.is_member_of(business_id));

create policy "Admins can invite members"
  on public.business_members for insert
  with check (public.is_admin_of(business_id));

create policy "Admins can update member roles"
  on public.business_members for update
  using (public.is_admin_of(business_id));

create policy "Admins can remove members"
  on public.business_members for delete
  using (public.is_admin_of(business_id));

-- ============================================================================
-- ONBOARDING_PROFILES
-- ============================================================================
create policy "Members can view onboarding profile"
  on public.onboarding_profiles for select
  using (public.is_member_of(business_id));

create policy "Admins can create onboarding profile"
  on public.onboarding_profiles for insert
  with check (public.is_admin_of(business_id));

create policy "Admins can update onboarding profile"
  on public.onboarding_profiles for update
  using (public.is_admin_of(business_id));

-- ============================================================================
-- BUSINESS_POLICIES
-- ============================================================================
create policy "Members can view policies"
  on public.business_policies for select
  using (public.is_member_of(business_id));

create policy "Admins can create policies"
  on public.business_policies for insert
  with check (public.is_admin_of(business_id));

create policy "Admins can update policies"
  on public.business_policies for update
  using (public.is_admin_of(business_id));

create policy "Admins can delete policies"
  on public.business_policies for delete
  using (public.is_admin_of(business_id));

-- ============================================================================
-- INTEGRATIONS
-- ============================================================================
create policy "Members can view integrations"
  on public.integrations for select
  using (public.is_member_of(business_id));

create policy "Admins can manage integrations"
  on public.integrations for insert
  with check (public.is_admin_of(business_id));

create policy "Admins can update integrations"
  on public.integrations for update
  using (public.is_admin_of(business_id));

create policy "Admins can delete integrations"
  on public.integrations for delete
  using (public.is_admin_of(business_id));

-- ============================================================================
-- INTEGRATION_SECRETS
-- NO client-side policies. Only service_role (Edge Functions) can access.
-- This is intentional — secrets must never be readable from the client.
-- ============================================================================
-- (No policies = no client access when RLS is enabled)

-- ============================================================================
-- UPLOADED_DOCUMENTS
-- ============================================================================
create policy "Members can view documents"
  on public.uploaded_documents for select
  using (public.is_member_of(business_id));

create policy "Members can upload documents"
  on public.uploaded_documents for insert
  with check (public.is_member_of(business_id));

create policy "Admins can delete documents"
  on public.uploaded_documents for delete
  using (public.is_admin_of(business_id));

-- ============================================================================
-- AI_CONTEXT_BLOCKS
-- ============================================================================
create policy "Members can view context blocks"
  on public.ai_context_blocks for select
  using (public.is_member_of(business_id));

create policy "Admins can manage context blocks"
  on public.ai_context_blocks for insert
  with check (public.is_admin_of(business_id));

create policy "Admins can update context blocks"
  on public.ai_context_blocks for update
  using (public.is_admin_of(business_id));

create policy "Admins can delete context blocks"
  on public.ai_context_blocks for delete
  using (public.is_admin_of(business_id));

-- ============================================================================
-- AUDIT_LOGS
-- Insert-only via service_role. Admins can read their business logs.
-- ============================================================================
create policy "Admins can view audit logs"
  on public.audit_logs for select
  using (public.is_admin_of(business_id));

-- No insert/update/delete policies for clients.
-- Audit logs are written by Edge Functions using service_role key.

-- ============================================================================
-- EXTENSION_SESSIONS
-- ============================================================================
create policy "Users can view their own sessions"
  on public.extension_sessions for select
  using (user_id = auth.uid());

create policy "Users can create their own sessions"
  on public.extension_sessions for insert
  with check (user_id = auth.uid());

create policy "Users can update their own sessions"
  on public.extension_sessions for update
  using (user_id = auth.uid());
