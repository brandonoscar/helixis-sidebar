# Helixis — Browser Understanding + Webhook Task Architecture

## Overview

Two parallel systems that converge at the retrieval/task layer:

```
BROWSER SIDE                         BACKEND SIDE
─────────────                        ─────────────
                                     Buildium Webhooks
Content Script                            │
  │ SPA detection                         ▼
  │ MutationObserver               ┌─────────────────┐
  │ Context extraction             │ Webhook Receiver │
  ▼                                │ (Edge Function)  │
┌──────────────────┐               └────────┬────────┘
│ Context Engine   │                        │ validate, store
│ (enhanced)       │                        ▼
│ - adapters       │               ┌─────────────────┐
│ - snapshots      │               │ Event Normalizer │
│ - attribution    │               │ (Buildium→Helixis│
│ - intent model   │               └────────┬────────┘
└────────┬─────────┘                        │ map to entities
         │                                  ▼
         │                         ┌─────────────────┐
         │                         │ Enrichment Layer │
         │                         │ (API fetch)      │
         │                         └────────┬────────┘
         │                                  │
         ▼                                  ▼
┌──────────────────────────────────────────────────┐
│              Retrieval Orchestrator               │
│  browser context + business context + tasks       │
│  → decides what data to fetch for the copilot     │
└──────────────────────────────────────────────────┘
         │                                  │
         ▼                                  ▼
   Extension Panel                    Task Engine
   (AI copilot)                    (create/update tasks)
```

---

## A. Browser-Side Improvements

### 1. SPA Route-Change Detection

Problem: Single-page apps (Buildium, AppFolio) change routes without full page
reloads. The content script only runs once at `document_idle`.

Solution:
- Listen to `popstate` and `hashchange` events
- Observe URL via polling (fallback for `history.pushState` interception)
- On route change, re-run light context capture
- Notify service worker with updated page info
- Debounce to avoid spam during rapid navigation

### 2. MutationObserver (Targeted)

Problem: SPAs load content async after route change. DOM may be empty when
we capture.

Solution:
- After a route change, set a brief MutationObserver on `<main>` or `body`
- Wait for meaningful content to appear (headings, tables, cards)
- Re-capture context once DOM stabilizes (debounced, max 2s wait)
- Disconnect observer after capture to avoid performance drain

### 3. Source Attribution

Every piece of extracted context gets tagged with where it came from:
- `url` — from the URL path/params
- `title` — from document.title
- `heading` — from h1/h2/h3
- `breadcrumb` — from breadcrumb nav
- `label` — from label/dt elements
- `table` — from table headers/cells
- `text` — from page body text
- `selection` — from user selection

This is already partially done in EntityClue.source. We extend it to
IdentifierMatch and add a top-level `sources` summary to BrowserContext.

### 4. Confidence Thresholds

Define named thresholds:
- **HIGH** (≥0.75): Use directly in retrieval and AI context
- **MEDIUM** (0.5–0.74): Include but flag as "possible"
- **LOW** (<0.5): Include in debug view only, exclude from AI context

The `formatContextForAI()` function filters by threshold. The panel
shows all levels with visual indicators.

### 5. Context Snapshots/Cache

- Service worker maintains a snapshot cache (Map<tabId, BrowserContext>)
- Each snapshot has a `captureId` + `timestamp`
- Panel can request cached snapshot (instant) or fresh capture
- Cache invalidated on route change or after 60s staleness
- Session-scoped (cleared on browser close via service worker lifecycle)

### 6. Retrieval Intent Model

Based on page type + entities, determine what backend data to fetch:

```
Page Type        → Retrieval Intent
─────────        ─────────────────
tenant page      → fetch: tenant profile, leases, payment history, policies
property page    → fetch: property details, units, tenants, maintenance
unit page        → fetch: unit details, current tenant, lease, maintenance
lease page       → fetch: lease terms, tenant, unit, property, payments
maintenance page → fetch: work order, property, unit, tenant, vendor
dashboard        → fetch: recent tasks, alerts, summary stats
messages page    → fetch: contact info, related property/tenant
unknown          → fetch: business profile only (baseline)
```

The intent model produces a `RetrievalIntent` object that the panel sends
to the backend `retrieval-orchestrator` Edge Function.

### 7. Software-Specific Adapters

Adapter interface:
```
{
  id: "buildium",
  hostPatterns: ["buildium.com", "*.buildium.com"],
  classify(url, title, dom) → PageClassification,
  extractEntities(dom, pageType) → EntityClues,
  urlToEntityId(url) → { type, id } | null
}
```

The context engine checks if an adapter matches the current hostname.
If yes, the adapter runs first and its results get higher confidence.
If no adapter matches, the generic engine runs (current behavior).

---

## B. Buildium Webhook Task Architecture

### Pipeline

```
Buildium → POST /webhook-receiver
    │
    ▼
1. Validate webhook signature/secret
2. Store raw payload in webhook_events
3. Map Buildium event → normalized entity type
4. If enrichment needed, queue API fetch
5. Create/update entity_snapshots
6. Evaluate task_rules against the event
7. Create/update tasks + link entities
8. Log to integration_sync_logs
```

### Buildium Event Types We Handle (MVP)

| Buildium Event | Helixis Entity | Task? |
|----------------|----------------|-------|
| Rental.Updated | property | No (data sync) |
| Unit.Updated | unit | No (data sync) |
| Tenant.Created | tenant | Yes: "New tenant onboarded" |
| Tenant.Updated | tenant | Conditional |
| Lease.Created | lease | Yes: "New lease created" |
| Lease.Renewed | lease | Yes: "Lease renewed" |
| Lease.Ended | lease | Yes: "Lease ended" |
| WorkOrder.Created | maintenance_issue | Yes: "New maintenance request" |
| WorkOrder.Updated | maintenance_issue | Conditional |
| WorkOrder.Completed | maintenance_issue | Yes: "Work order completed" |
| Payment.Received | payment | No (data sync) |
| Payment.Late | payment | Yes: "Late payment alert" |

### Task Rules (Configurable Per-Business)

```json
{
  "event_type": "WorkOrder.Created",
  "conditions": { "priority": ["Emergency", "High"] },
  "action": "create_task",
  "task_template": {
    "title": "Urgent: {{entity.subject}}",
    "priority": "high",
    "category": "maintenance",
    "auto_assign": true
  }
}
```

Rules are stored in `task_rules` and evaluated by the task engine.
Default rules ship with the Buildium integration; businesses can customize.

---

## C. Schema (Migration 003)

See `003_webhook_task_schema.sql` for full DDL.

### webhook_events
Immutable log of every inbound webhook payload.
- `id`, `business_id`, `integration_id`
- `provider` (buildium, etc.)
- `event_type` (WorkOrder.Created, etc.)
- `external_id` (Buildium's event ID)
- `payload` (jsonb — raw webhook body)
- `status` (received, processing, processed, failed)
- `processed_at`, `created_at`

### entity_snapshots
Point-in-time snapshots of normalized entities.
When a webhook arrives, we store the current state of the entity.
This lets the copilot answer "what does this tenant look like?" without
hitting the Buildium API every time.
- `id`, `business_id`, `integration_id`
- `entity_type` (property, unit, tenant, lease, etc.)
- `external_id` (Buildium's ID for this entity)
- `data` (jsonb — normalized entity data)
- `raw_data` (jsonb — original API response, for debugging)
- `synced_at`, `created_at`

### tasks
Helixis tasks generated from webhook events or manually.
- `id`, `business_id`
- `title`, `description`
- `status` (open, in_progress, done, dismissed)
- `priority` (low, medium, high, urgent)
- `category` (maintenance, leasing, accounting, communication, other)
- `source_type` (webhook, manual, ai_suggested)
- `source_event_id` (FK → webhook_events)
- `assigned_to` (FK → auth.users)
- `due_at`, `completed_at`, `created_at`, `updated_at`

### task_entities
Links tasks to the entities they concern. Many-to-many.
- `task_id` (FK → tasks)
- `entity_type`, `entity_id` (FK → entity_snapshots)
- `role` (primary, related)

### task_rules
Per-business rules for auto-creating tasks from events.
- `id`, `business_id`
- `event_type` pattern
- `conditions` (jsonb — field/value filters)
- `action` (create_task, update_task, notify)
- `task_template` (jsonb — title template, priority, category, etc.)
- `is_active`, `created_at`

### integration_sync_logs
Tracks API enrichment calls for debugging and rate-limit awareness.
- `id`, `business_id`, `integration_id`
- `action` (fetch_tenant, fetch_property, etc.)
- `external_id`
- `status` (success, error)
- `response_code`, `error_message`
- `duration_ms`, `created_at`

---

## D. Retrieval + Task Connection

### Browser Context → Retrieval Flow

```
User opens extension on a Buildium tenant page
    │
    ▼
Content script captures:
  pageType: "tenant"
  software: "buildium"
  entities.tenants: [{ value: "John Smith", field: "name", confidence: 0.8 }]
  identifiers.emails: [{ normalized: "john@example.com" }]
    │
    ▼
Panel builds RetrievalIntent:
  { pageType: "tenant", software: "buildium",
    entityHints: [{ type: "tenant", name: "John Smith", email: "john@example.com" }] }
    │
    ▼
POST /retrieval-orchestrator:
  1. Match entity_snapshots by name/email → find tenant
  2. Fetch linked entities (lease, unit, property)
  3. Fetch related tasks (open maintenance, late payments)
  4. Fetch business policies (tenant communication, maintenance SLA)
  5. Return assembled context for AI
```

### Webhook → Task → Browser Awareness

```
Buildium fires WorkOrder.Created webhook
    │
    ▼
Webhook receiver:
  1. Store in webhook_events
  2. Normalize to maintenance_issue entity
  3. Enrich: fetch full work order + property + unit from Buildium API
  4. Store entity_snapshots
  5. Evaluate task_rules → create task "New maintenance: Leaking faucet"
  6. Link task to property, unit, tenant entities
    │
    ▼
Later, user opens extension on that property page:
  1. Browser context detects: pageType=property, entities.properties=[...]
  2. Retrieval orchestrator matches property → finds linked task
  3. AI context includes: "There is an open maintenance task:
     Leaking faucet (Unit 4B, reported by John Smith, priority: High)"
```

---

## E. Implementation Plan

### Phase 1 (this commit): Browser + Schema + Core Functions
1. Browser: SPA detection, adapters, snapshots, intent model
2. Schema: migration 003 (webhook/task tables + RLS)
3. Backend: webhook-receiver, buildium-normalizer, task-engine, retrieval-orchestrator

### Phase 2 (next): Wiring + Polish
1. Connect panel to retrieval orchestrator
2. Add Buildium API enrichment calls
3. Add task display in extension
4. Add task rule management UI
