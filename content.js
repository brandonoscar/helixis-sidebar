/**
 * Helixis Copilot — Content Script
 *
 * Injected into web pages to:
 * 1. Detect if user is on a property management platform (Buildium first)
 * 2. Classify the page type (property detail, tenant list, lease, etc.)
 * 3. Extract entity IDs from URL patterns and page content
 * 4. Track SPA route changes
 * 5. Respond to context capture requests from the side panel
 *
 * Buildium URL patterns (partially confirmed):
 * - Base: {subdomain}.managebuilding.com/manager/app/...
 * - Exact path structure is not publicly documented.
 *
 * Source: https://developer.buildium.com/
 */

// ─── Provider Detection ─────────────────────────────────────────────

const PROVIDERS = [
  {
    name: "buildium",
    hostPatterns: [/\.managebuilding\.com$/i, /\.buildium\.com$/i],
    pagePatterns: [
      { pattern: /\/rentals?\/(properties|rental)\/?$/i, type: "property_list" },
      { pattern: /\/rentals?\/(properties|rental)\/(\d+)/i, type: "property_detail", idGroup: 2 },
      { pattern: /\/rentals?\/units?\/?$/i, type: "unit_list" },
      { pattern: /\/rentals?\/units?\/(\d+)/i, type: "unit_detail", idGroup: 1 },
      { pattern: /\/leases?\/?$/i, type: "lease_list" },
      { pattern: /\/leases?\/(\d+)/i, type: "lease_detail", idGroup: 1 },
      { pattern: /\/tenants?\/?$/i, type: "tenant_list" },
      { pattern: /\/tenants?\/(\d+)/i, type: "tenant_detail", idGroup: 1 },
      { pattern: /\/maintenance\/?$/i, type: "maintenance_list" },
      { pattern: /\/maintenance\/(\d+)/i, type: "maintenance_detail", idGroup: 1 },
      { pattern: /\/workorders?\/?$/i, type: "workorder_list" },
      { pattern: /\/workorders?\/(\d+)/i, type: "workorder_detail", idGroup: 1 },
      { pattern: /\/vendors?\/?$/i, type: "vendor_list" },
      { pattern: /\/vendors?\/(\d+)/i, type: "vendor_detail", idGroup: 1 },
      { pattern: /\/associations?\/?$/i, type: "association_list" },
      { pattern: /\/associations?\/(\d+)/i, type: "association_detail", idGroup: 1 },
      { pattern: /\/tasks?\/?$/i, type: "task_list" },
      { pattern: /\/tasks?\/(\d+)/i, type: "task_detail", idGroup: 1 },
      { pattern: /\/applicants?\/?$/i, type: "applicant_list" },
      { pattern: /\/applicants?\/(\d+)/i, type: "applicant_detail", idGroup: 1 },
      { pattern: /\/dashboard/i, type: "dashboard" },
      { pattern: /\/accounting/i, type: "accounting" },
    ],
  },
];

const PAGE_TYPE_TO_ENTITY = {
  property_detail: "rental",
  unit_detail: "unit",
  lease_detail: "lease",
  tenant_detail: "tenant",
  maintenance_detail: "workorder",
  workorder_detail: "workorder",
  vendor_detail: "vendor",
  association_detail: "association",
  task_detail: "task",
  applicant_detail: "applicant",
};

// ─── Core Analysis ──────────────────────────────────────────────────

function detectProvider(hostname) {
  for (const provider of PROVIDERS) {
    for (const pattern of provider.hostPatterns) {
      if (pattern.test(hostname)) return provider;
    }
  }
  return null;
}

function classifyPage(provider, pathname) {
  if (!provider) return { pageType: null, entityId: null };
  for (const pp of provider.pagePatterns) {
    const match = pathname.match(pp.pattern);
    if (match) {
      return { pageType: pp.type, entityId: pp.idGroup ? match[pp.idGroup] : null };
    }
  }
  return { pageType: "unknown", entityId: null };
}

function extractEntities(pageType, entityId) {
  const entities = [];
  const entityType = PAGE_TYPE_TO_ENTITY[pageType];
  if (entityType && entityId) {
    entities.push({ type: entityType, id: entityId, confidence: 0.9, source: "url" });
  }
  return entities;
}

function extractPageClues() {
  const clues = [];
  const text = document.body?.innerText ?? "";
  const patterns = [
    { regex: /Property\s*(?:ID|#|Number)[:\s]*(\d+)/gi, type: "rental" },
    { regex: /Unit\s*(?:ID|#|Number)[:\s]*(\d+)/gi, type: "unit" },
    { regex: /Tenant\s*(?:ID|#|Number)[:\s]*(\d+)/gi, type: "tenant" },
    { regex: /Lease\s*(?:ID|#|Number)[:\s]*(\d+)/gi, type: "lease" },
    { regex: /Work\s*Order\s*(?:ID|#|Number)[:\s]*(\d+)/gi, type: "workorder" },
  ];
  for (const { regex, type } of patterns) {
    let match;
    while ((match = regex.exec(text)) !== null) {
      clues.push({ type, id: match[1], confidence: 0.6, source: "page_content" });
    }
  }
  return clues;
}

function getFullContext() {
  const hostname = location.hostname;
  const provider = detectProvider(hostname);
  const { pageType, entityId } = classifyPage(provider, location.pathname);
  const urlEntities = extractEntities(pageType, entityId);
  const pageClues = extractPageClues();

  const seen = new Set();
  const allEntities = [];
  for (const e of [...urlEntities, ...pageClues]) {
    const key = `${e.type}:${e.id}`;
    if (!seen.has(key)) { seen.add(key); allEntities.push(e); }
  }

  return {
    url: location.href,
    hostname,
    title: document.title,
    provider: provider?.name ?? null,
    pageType,
    entities: allEntities,
    text: (document.body?.innerText ?? "").slice(0, 5000),
    timestamp: new Date().toISOString(),
  };
}

// ─── SPA Route Tracking ─────────────────────────────────────────────

let lastUrl = location.href;

function checkRouteChange() {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    chrome.runtime.sendMessage({ type: "HELIXIS_ROUTE_CHANGE", context: getFullContext() });
  }
}

const observer = new MutationObserver(() => checkRouteChange());
observer.observe(document.documentElement, { childList: true, subtree: true });
setInterval(checkRouteChange, 1000);

const origPushState = history.pushState;
const origReplaceState = history.replaceState;
history.pushState = function (...args) { origPushState.apply(this, args); checkRouteChange(); };
history.replaceState = function (...args) { origReplaceState.apply(this, args); checkRouteChange(); };
window.addEventListener("popstate", checkRouteChange);

// ─── Message Handling ───────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "HELIXIS_GET_CONTEXT") {
    sendResponse(getFullContext());
  }
  return true;
});

// Send initial context on load
setTimeout(() => {
  chrome.runtime.sendMessage({ type: "HELIXIS_CONTEXT_READY", context: getFullContext() });
}, 500);
