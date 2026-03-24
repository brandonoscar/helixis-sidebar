-- ============================================================================
-- Helixis MVP — Webhook & Task Schema
-- Migration 003: webhook_events, entity_snapshots, tasks, task_entities,
--                task_rules, integration_sync_logs
-- ============================================================================

-- ============================================================================
-- 1. WEBHOOK_EVENTS
-- Raw webhook payloads from integrations (Buildium, etc.)
-- ============================================================================
create table public.webhook_events (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses(id) on delete cascade,
  integration_id  uuid not null references public.integrations(id) on delete cascade,
  provider        text not null,                -- e.g. 'buildium'
  event_type      text not null,                -- provider's event name
  payload         jsonb not null default '{}'::jsonb,
  status          text not null default 'received'
                  check (status in ('received', 'processing', 'normalized', 'failed', 'skipped')),
  error_message   text,
  idempotency_key text,                         -- provider-supplied dedup key
  received_at     timestamptz not null default now(),
  processed_at    timestamptz
);

create index idx_webhook_events_business on public.webhook_events (business_id, received_at desc);
create index idx_webhook_events_status on public.webhook_events (status);
create unique index idx_webhook_events_idempotency
  on public.webhook_events (business_id, provider, idempotency_key)
  where idempotency_key is not null;

-- ============================================================================
-- 2. ENTITY_SNAPSHOTS
-- Normalised Helixis entities derived from integration data.
-- One row per entity per business; updated on each sync/webhook.
-- ============================================================================
create table public.entity_snapshots (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses(id) on delete cascade,
  entity_type     text not null
                  check (entity_type in ('property', 'unit', 'tenant', 'lease',
                                         'maintenance_request', 'vendor', 'owner')),
  external_id     text not null,                -- ID in the source system
  provider        text not null,                -- e.g. 'buildium'
  display_name    text,
  data            jsonb not null default '{}'::jsonb,   -- normalised fields
  raw_data        jsonb default '{}'::jsonb,            -- original provider data
  last_synced_at  timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  unique (business_id, provider, entity_type, external_id)
);

create index idx_entity_snapshots_business_type
  on public.entity_snapshots (business_id, entity_type);
create index idx_entity_snapshots_lookup
  on public.entity_snapshots (business_id, provider, entity_type, external_id);

-- ============================================================================
-- 3. TASKS
-- Action items created by the task engine from webhooks, rules, or AI.
-- ============================================================================
create table public.tasks (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses(id) on delete cascade,
  title           text not null,
  description     text,
  status          text not null default 'open'
                  check (status in ('open', 'in_progress', 'done', 'dismissed')),
  priority        text not null default 'medium'
                  check (priority in ('urgent', 'high', 'medium', 'low')),
  source          text not null default 'webhook'
                  check (source in ('webhook', 'rule', 'ai', 'manual')),
  source_event_id uuid references public.webhook_events(id),
  rule_id         uuid,                         -- FK added after task_rules created
  assigned_to     uuid references auth.users(id),
  due_at          timestamptz,
  completed_at    timestamptz,
  metadata        jsonb default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index idx_tasks_business_status on public.tasks (business_id, status);
create index idx_tasks_assigned on public.tasks (assigned_to, status);
create index idx_tasks_source_event on public.tasks (source_event_id);

-- ============================================================================
-- 4. TASK_ENTITIES
-- Many-to-many link between tasks and entity_snapshots.
-- ============================================================================
create table public.task_entities (
  id              uuid primary key default gen_random_uuid(),
  task_id         uuid not null references public.tasks(id) on delete cascade,
  entity_id       uuid not null references public.entity_snapshots(id) on delete cascade,
  role            text not null default 'related'
                  check (role in ('primary', 'related')),
  created_at      timestamptz not null default now(),

  unique (task_id, entity_id)
);

create index idx_task_entities_task on public.task_entities (task_id);
create index idx_task_entities_entity on public.task_entities (entity_id);

-- ============================================================================
-- 5. TASK_RULES
-- Declarative rules: "when event X happens, create task Y"
-- ============================================================================
create table public.task_rules (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses(id) on delete cascade,
  name            text not null,
  description     text,
  provider        text not null,                -- e.g. 'buildium'
  event_type      text not null,                -- matches webhook_events.event_type
  conditions      jsonb not null default '{}'::jsonb,   -- JSON predicates on payload
  task_template   jsonb not null default '{}'::jsonb,   -- title, description, priority templates
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index idx_task_rules_business on public.task_rules (business_id);
create index idx_task_rules_lookup on public.task_rules (provider, event_type, is_active);

-- Now add the FK from tasks.rule_id → task_rules.id
alter table public.tasks
  add constraint fk_tasks_rule
  foreign key (rule_id) references public.task_rules(id);

-- ============================================================================
-- 6. INTEGRATION_SYNC_LOGS
-- Tracks each sync cycle (webhook batch, full sync, etc.)
-- ============================================================================
create table public.integration_sync_logs (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses(id) on delete cascade,
  integration_id  uuid not null references public.integrations(id) on delete cascade,
  sync_type       text not null
                  check (sync_type in ('webhook', 'full_sync', 'incremental')),
  status          text not null default 'running'
                  check (status in ('running', 'completed', 'failed')),
  events_received integer default 0,
  entities_upserted integer default 0,
  tasks_created   integer default 0,
  error_message   text,
  started_at      timestamptz not null default now(),
  completed_at    timestamptz
);

create index idx_integration_sync_logs_business
  on public.integration_sync_logs (business_id, started_at desc);

-- ============================================================================
-- Auto-update triggers for tables with updated_at
-- ============================================================================
create trigger set_updated_at before update on public.entity_snapshots
  for each row execute function public.handle_updated_at();

create trigger set_updated_at before update on public.tasks
  for each row execute function public.handle_updated_at();

create trigger set_updated_at before update on public.task_rules
  for each row execute function public.handle_updated_at();

-- ============================================================================
-- RLS Policies for new tables
-- ============================================================================

alter table public.webhook_events enable row level security;
alter table public.entity_snapshots enable row level security;
alter table public.tasks enable row level security;
alter table public.task_entities enable row level security;
alter table public.task_rules enable row level security;
alter table public.integration_sync_logs enable row level security;

-- WEBHOOK_EVENTS: admins can view, no client insert (Edge Functions use service_role)
create policy "Admins can view webhook events"
  on public.webhook_events for select
  using (public.is_admin_of(business_id));

-- ENTITY_SNAPSHOTS: members can view
create policy "Members can view entity snapshots"
  on public.entity_snapshots for select
  using (public.is_member_of(business_id));

-- TASKS: members can view and update (claim, complete)
create policy "Members can view tasks"
  on public.tasks for select
  using (public.is_member_of(business_id));

create policy "Members can update tasks"
  on public.tasks for update
  using (public.is_member_of(business_id));

-- No client insert on tasks — created by task engine via service_role

-- TASK_ENTITIES: members can view
create policy "Members can view task entities"
  on public.task_entities for select
  using (
    exists (
      select 1 from public.tasks t
      where t.id = task_id
        and public.is_member_of(t.business_id)
    )
  );

-- TASK_RULES: admins can full CRUD
create policy "Admins can view task rules"
  on public.task_rules for select
  using (public.is_admin_of(business_id));

create policy "Admins can create task rules"
  on public.task_rules for insert
  with check (public.is_admin_of(business_id));

create policy "Admins can update task rules"
  on public.task_rules for update
  using (public.is_admin_of(business_id));

create policy "Admins can delete task rules"
  on public.task_rules for delete
  using (public.is_admin_of(business_id));

-- INTEGRATION_SYNC_LOGS: admins can view
create policy "Admins can view sync logs"
  on public.integration_sync_logs for select
  using (public.is_admin_of(business_id));
