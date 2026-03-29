/*
 * Helixis Copilot (P Workspace Test) — supabase.js
 * Fetches P Property Management workspace data via RPC (no auth needed).
 * Chat is proxied through a Supabase edge function (API key stored in vault).
 */

const SUPABASE_URL  = 'https://bvmobfhsbvjqnopigfds.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ2bW9iZmhzYnZqcW5vcGlnZmRzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI0OTIyNjIsImV4cCI6MjA4ODA2ODI2Mn0.lsfkoTyfHmvnTPdd3o5qjLAGzoc4mNSUkCYmsjYpY9g';

const WORKSPACE_SLUG = 'p-property-management';

// All Buildium data categories to fetch
const BUILDIUM_ENDPOINTS = [
  'rentals', 'rentals/units', 'leases', 'tenants',
  'associations', 'associations/units',
  'workorders', 'tasks', 'vendors',
  'bankaccounts', 'bills', 'outstandingbalances',
  'users',
];

// ── RETRY & THROTTLE ────────────────────────────────

const MIN_REQUEST_GAP_MS = 100;
let _lastRequestTime = 0;

function _classifyError(status) {
  if (status === 429) return 'rate_limit';
  if (status === 401 || status === 403) return 'auth';
  if (status >= 500) return 'server';
  if (status === 0 || status === undefined) return 'network';
  return 'client';
}

async function fetchWithRetry(url, options = {}, { maxRetries = 3, baseDelay = 1000 } = {}) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const now = Date.now();
    const gap = MIN_REQUEST_GAP_MS - (now - _lastRequestTime);
    if (gap > 0) await new Promise(r => setTimeout(r, gap));
    _lastRequestTime = Date.now();

    try {
      const res = await fetch(url, options);
      if (res.ok) return res;
      const errorType = _classifyError(res.status);
      if (errorType === 'auth' || errorType === 'client') return res;
      if (attempt < maxRetries && (errorType === 'rate_limit' || errorType === 'server')) {
        const retryAfter = res.headers.get('Retry-After');
        const delay = retryAfter
          ? parseInt(retryAfter, 10) * 1000
          : baseDelay * Math.pow(2, attempt) + Math.random() * 500;
        console.warn(`Helixis: ${res.status} on ${url.split('?')[0]}, retrying in ${Math.round(delay)}ms (attempt ${attempt + 1}/${maxRetries})`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      return res;
    } catch (err) {
      if (attempt < maxRetries) {
        const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 500;
        console.warn(`Helixis: network error on ${url.split('?')[0]}, retrying in ${Math.round(delay)}ms (attempt ${attempt + 1}/${maxRetries})`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
}

// Fetch all Buildium data in one batch call
async function fetchAllBuildiumData(workspaceId) {
  const res = await fetchWithRetry(`${SUPABASE_URL}/functions/v1/fetch-buildium-data`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON,
      'Authorization': `Bearer ${SUPABASE_ANON}`
    },
    body: JSON.stringify({ workspace_id: workspaceId, endpoints: BUILDIUM_ENDPOINTS })
  }, { maxRetries: 2, baseDelay: 2000 });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const errorType = _classifyError(res.status);
    if (errorType === 'auth') throw new Error('Buildium API authentication failed — check integration credentials');
    if (errorType === 'rate_limit') throw new Error('Buildium API rate limit reached — data will load on next refresh');
    throw new Error(err.error || `Buildium fetch failed: ${res.status}`);
  }
  return res.json();
}

async function fetchWorkspaceData() {
  const res = await fetchWithRetry(`${SUPABASE_URL}/rest/v1/rpc/get_workspace_by_slug`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON,
      'Authorization': `Bearer ${SUPABASE_ANON}`
    },
    body: JSON.stringify({ workspace_slug: WORKSPACE_SLUG })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `Failed: ${res.status}`);
  }
  return res.json();
}

// Fetch Buildium webhook events for this workspace
async function fetchWebhookEvents(limit = 50) {
  const res = await fetchWithRetry(`${SUPABASE_URL}/rest/v1/rpc/get_workspace_events`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON,
      'Authorization': `Bearer ${SUPABASE_ANON}`
    },
    body: JSON.stringify({ workspace_slug: WORKSPACE_SLUG, event_limit: limit })
  }, { maxRetries: 1 });
  if (!res.ok) return [];
  return res.json();
}

// Dismiss a webhook event
async function dismissWebhookEvent(eventId) {
  const res = await fetchWithRetry(`${SUPABASE_URL}/rest/v1/rpc/dismiss_workspace_event`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON,
      'Authorization': `Bearer ${SUPABASE_ANON}`
    },
    body: JSON.stringify({ workspace_slug: WORKSPACE_SLUG, p_event_id: eventId })
  }, { maxRetries: 2 });
  return res.ok;
}

// Create a task in Buildium via edge function
async function createBuildiumTask(workspaceId, taskData) {
  const res = await fetchWithRetry(`${SUPABASE_URL}/functions/v1/buildium-action`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON,
      'Authorization': `Bearer ${SUPABASE_ANON}`
    },
    body: JSON.stringify({
      workspace_id: workspaceId,
      action: 'create-task',
      payload: taskData
    })
  }, { maxRetries: 1, baseDelay: 2000 });
  const data = await res.json();
  if (!res.ok) {
    const errorType = _classifyError(res.status);
    if (errorType === 'auth') throw new Error('Buildium API credentials invalid — check integration settings');
    if (errorType === 'rate_limit') throw new Error('Buildium rate limit hit — wait a moment and try again');
    throw new Error(data.error || data.detail?.message || `Create task failed: ${res.status}`);
  }
  return data;
}

// Fetch staff list for task assignment
async function fetchBuildiumStaff(workspaceId) {
  const res = await fetchWithRetry(`${SUPABASE_URL}/functions/v1/buildium-action`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON,
      'Authorization': `Bearer ${SUPABASE_ANON}`
    },
    body: JSON.stringify({
      workspace_id: workspaceId,
      action: 'list-staff'
    })
  }, { maxRetries: 1 });
  const data = await res.json();
  if (!res.ok) return [];
  return data.data || [];
}

// Summarize an array of Buildium records for the system prompt
function summarizeRecords(records, type) {
  if (!records || records.length === 0) return '';
  const lines = [];
  const limit = 20;

  records.slice(0, limit).forEach(r => {
    switch (type) {
      case 'rentals':
        lines.push(`- ${r.Name || 'Unnamed'} (ID: ${r.Id})${r.Address ? ` — ${r.Address.AddressLine1 || ''}${r.Address.City ? ', ' + r.Address.City : ''}${r.Address.State ? ', ' + r.Address.State : ''}` : ''}${r.NumberOfUnits ? ' | ' + r.NumberOfUnits + ' units' : ''}`);
        break;
      case 'rentals/units':
        lines.push(`- Unit ${r.UnitNumber || r.Id}${r.MarketRent ? ' | Rent: $' + r.MarketRent : ''}${r.Address ? ' at ' + (r.Address.AddressLine1 || '') : ''}`);
        break;
      case 'leases':
        lines.push(`- Lease ${r.Id}: ${r.LeaseType || ''} | ${r.LeaseStatus || r.Status || ''} | Start: ${r.LeaseFromDate || '?'} End: ${r.LeaseToDate || '?'}${r.Rent ? ' | $' + r.Rent + '/mo' : ''}`);
        break;
      case 'tenants':
        lines.push(`- ${r.FirstName || ''} ${r.LastName || ''} (ID: ${r.Id})${r.Email ? ' | ' + r.Email : ''}${r.PhoneNumbers?.length ? ' | ' + r.PhoneNumbers[0].Number : ''}`);
        break;
      case 'associations':
        lines.push(`- ${r.Name || 'Unnamed'} (ID: ${r.Id})${r.Address ? ` — ${r.Address.AddressLine1 || ''}` : ''}`);
        break;
      case 'workorders':
        lines.push(`- WO#${r.Id}: ${r.Title || r.Subject || 'No title'} | Status: ${r.Status || '?'}${r.Priority ? ' | Priority: ' + r.Priority : ''}`);
        break;
      case 'tasks':
        lines.push(`- Task#${r.Id}: ${r.Title || 'No title'} | Status: ${r.TaskStatus || r.Status || '?'}${r.DueDate ? ' | Due: ' + r.DueDate : ''}`);
        break;
      case 'vendors':
        lines.push(`- ${r.CompanyName || r.FirstName + ' ' + r.LastName || 'Unnamed'} (ID: ${r.Id})${r.Category ? ' | ' + r.Category : ''}`);
        break;
      case 'bankaccounts':
        lines.push(`- ${r.Name || 'Account'} (ID: ${r.Id})${r.AccountType ? ' | ' + r.AccountType : ''}${r.CurrentBalance != null ? ' | Balance: $' + r.CurrentBalance : ''}`);
        break;
      case 'bills':
        lines.push(`- Bill#${r.Id}: $${r.Amount || '?'} | ${r.PaidStatus || r.Status || '?'}${r.DueDate ? ' | Due: ' + r.DueDate : ''}${r.Vendor?.Name ? ' | Vendor: ' + r.Vendor.Name : ''}`);
        break;
      case 'outstandingbalances':
        lines.push(`- ${r.Name || r.AssociatedUnitId || 'ID:' + r.Id}: $${r.TotalBalance || r.Balance || '?'} outstanding`);
        break;
      default:
        lines.push(`- ${JSON.stringify(r).slice(0, 120)}`);
    }
  });

  if (records.length > limit) lines.push(`... and ${records.length - limit} more`);
  return lines.join('\n');
}

// ── ENTITY LINKING ──────────────────────────────────

function buildEntityRelationships(buildiumData) {
  if (!buildiumData) return '';

  const rentals = buildiumData['rentals']?.data || [];
  const units = buildiumData['rentals/units']?.data || [];
  const leases = buildiumData['leases']?.data || [];
  const tenants = buildiumData['tenants']?.data || [];
  const workorders = buildiumData['workorders']?.data || [];
  const tasks = buildiumData['tasks']?.data || [];
  const users = buildiumData['users']?.data || [];

  if (rentals.length === 0 && tenants.length === 0) return '';

  const lines = [];

  const userNames = {};
  users.forEach(u => {
    const name = [u.FirstName, u.LastName].filter(Boolean).join(' ');
    if (name) userNames[u.Id] = name;
  });

  const leasesByTenant = {};
  leases.forEach(l => {
    const tenantIds = l.TenantIds || l.Tenants?.map(t => t.Id) || [];
    tenantIds.forEach(tid => {
      if (!leasesByTenant[tid]) leasesByTenant[tid] = [];
      leasesByTenant[tid].push(l);
    });
  });

  const unitsByProperty = {};
  units.forEach(u => {
    const propId = u.PropertyId || u.RentalId;
    if (propId) {
      if (!unitsByProperty[propId]) unitsByProperty[propId] = [];
      unitsByProperty[propId].push(u);
    }
  });

  const woByProperty = {};
  workorders.forEach(wo => {
    const propId = wo.PropertyId || wo.RentalId;
    if (propId) {
      if (!woByProperty[propId]) woByProperty[propId] = [];
      woByProperty[propId].push(wo);
    }
  });

  rentals.slice(0, 10).forEach(r => {
    const propUnits = unitsByProperty[r.Id] || [];
    const propWOs = woByProperty[r.Id] || [];
    const activeWOs = propWOs.filter(wo => wo.Status !== 'Completed' && wo.Status !== 'Closed');
    const parts = [`Property "${r.Name || r.Id}"`];
    if (propUnits.length > 0) parts.push(`${propUnits.length} unit(s)`);
    if (activeWOs.length > 0) parts.push(`${activeWOs.length} open work order(s)`);
    lines.push(parts.join(' — '));
  });

  tenants.slice(0, 10).forEach(t => {
    const tLeases = leasesByTenant[t.Id] || [];
    const activeLeases = tLeases.filter(l => l.LeaseStatus === 'Active' || l.Status === 'Active');
    if (activeLeases.length > 0) {
      const name = [t.FirstName, t.LastName].filter(Boolean).join(' ') || `Tenant ${t.Id}`;
      lines.push(`${name} — ${activeLeases.length} active lease(s)`);
    }
  });

  const tasksByUser = {};
  tasks.forEach(t => {
    if (t.AssignedToUserId && (t.TaskStatus === 'New' || t.TaskStatus === 'InProgress')) {
      if (!tasksByUser[t.AssignedToUserId]) tasksByUser[t.AssignedToUserId] = 0;
      tasksByUser[t.AssignedToUserId]++;
    }
  });
  Object.entries(tasksByUser).forEach(([uid, count]) => {
    const name = userNames[uid] || `User #${uid}`;
    lines.push(`${name} — ${count} open task(s)`);
  });

  if (lines.length === 0) return '';
  return '\n\n=== ENTITY RELATIONSHIPS ===\n' + lines.join('\n');
}

// Build system prompt with workspace context + all Buildium data
function buildSystemPrompt(workspace, integrations, pageContext, buildiumData) {
  let prompt = `You are Helixis Copilot, an AI assistant for property management companies. You are helping the team at "${workspace.name}".

Workspace details:
- Name: ${workspace.name}
- Slug: ${workspace.slug}
- Created: ${workspace.created_at}
- Onboarding: ${workspace.onboarding_completed_at ? 'Complete' : 'In progress'}`;

  if (integrations && integrations.length > 0) {
    prompt += '\n\nConnected integrations:';
    integrations.forEach(intg => {
      prompt += `\n- ${intg.provider} (${intg.status}, ${intg.environment})`;
      if (intg.last_test_result?.message) prompt += ` — ${intg.last_test_result.message}`;
    });
  }

  if (buildiumData) {
    prompt += '\n\n=== LIVE BUILDIUM DATA (from API) ===';

    const sections = [
      { key: 'rentals', label: 'Rental Properties' },
      { key: 'rentals/units', label: 'Rental Units' },
      { key: 'leases', label: 'Leases' },
      { key: 'tenants', label: 'Tenants' },
      { key: 'associations', label: 'Associations' },
      { key: 'associations/units', label: 'Association Units' },
      { key: 'workorders', label: 'Work Orders (Maintenance)' },
      { key: 'tasks', label: 'Tasks' },
      { key: 'vendors', label: 'Vendors' },
      { key: 'bankaccounts', label: 'Bank Accounts' },
      { key: 'bills', label: 'Bills' },
      { key: 'outstandingbalances', label: 'Outstanding Balances' },
    ];

    sections.forEach(({ key, label }) => {
      const section = buildiumData[key];
      if (!section || section.error) return;
      const records = section.data || [];
      if (records.length === 0) return;

      prompt += `\n\n${label} (${section.count} total):`;
      prompt += '\n' + summarizeRecords(records, key);
    });
  }

  // Add entity relationship summaries
  const relationships = buildEntityRelationships(buildiumData);
  if (relationships) prompt += relationships;

  if (pageContext) {
    prompt += `\n\nThe user is currently viewing:
- Site: ${pageContext.hostname}
- Title: ${pageContext.title}
- Page text (truncated): ${pageContext.text?.slice(0, 2000) || '(none)'}`;
  }

  const hasBuildium = integrations?.some(i => i.provider === 'buildium' && (i.status === 'connected' || i.status === 'locked'));

  prompt += '\n\nYou have LIVE access to the data above. Use the Entity Relationships section to connect tenants to properties, track open work orders per property, and identify task assignments. Answer questions about properties, tenants, leases, maintenance, accounting, and tasks using this data. Be concise, helpful, and professional.';

  if (hasBuildium) {
    prompt += `\n\n=== TASK CREATION ===
You CAN create tasks in Buildium. When the user asks you to create a task, respond with a JSON block in this exact format:

\`\`\`helixis-create-task
{"Title": "...", "Description": "...", "Priority": "Normal", "TaskStatus": "New", "DueDate": "YYYY-MM-DD"}
\`\`\`

Rules:
- Title is required. Description, Priority, DueDate are optional.
- Priority must be "Low", "Normal", or "High".
- TaskStatus must be "New", "InProgress", "Completed", or "Deferred". Default to "New".
- DueDate format: YYYY-MM-DD. Only include if the user specifies a date.
- After the JSON block, add a brief confirmation message like "I'll create that task for you."
- If the user's request is vague, ask for clarification on the title before creating.`;
  }

  return prompt;
}

// Send chat via Supabase edge function (Gemini key is server-side in vault)
async function sendToGemini(messages, systemPrompt, screenshot) {
  const payload = { messages, systemPrompt };
  if (screenshot) {
    payload.screenshot = screenshot;
  }
  const res = await fetchWithRetry(`${SUPABASE_URL}/functions/v1/chat-gemini`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON,
      'Authorization': `Bearer ${SUPABASE_ANON}`
    },
    body: JSON.stringify(payload)
  }, { maxRetries: 2, baseDelay: 1500 });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    console.error('Helixis chat error:', JSON.stringify(err));
    const errorType = _classifyError(res.status);
    if (errorType === 'rate_limit') throw new Error('AI is temporarily busy — try again in a few seconds');
    throw new Error(err.error || `Chat failed: ${res.status}`);
  }

  const data = await res.json();
  console.log('Helixis: chat response via model', data.model);
  return data.reply;
}
