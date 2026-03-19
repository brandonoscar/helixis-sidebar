/**
 * pageContext.js — Detects page context from URL/title and returns contextual actions.
 *
 * REPLACE LATER: Swap URL pattern matching with real Buildium page detection,
 * or use content script DOM signals for deeper context.
 */

// ─── Page context types ──────────────────────────────────────────────────────

export const PAGE_TYPES = {
  LEASE_OVERVIEW:       "lease_overview",
  LEASE_RENEWAL:        "lease_renewal",
  TENANT_LEDGER:        "tenant_ledger",
  PAYMENT_ENTRY:        "payment_entry",
  MAINTENANCE_REQUEST:  "maintenance_request",
  WORK_ORDER:           "work_order",
  OWNER_STATEMENT:      "owner_statement",
  REPORTING:            "reporting",
  INBOX:                "inbox",
  DASHBOARD:            "dashboard",
  UNKNOWN:              "unknown",
};

// ─── URL pattern → page type mapping ─────────────────────────────────────────

const URL_PATTERNS = [
  { pattern: /\/leases?\/(renew|expir)/i,           type: PAGE_TYPES.LEASE_RENEWAL },
  { pattern: /\/leases?/i,                           type: PAGE_TYPES.LEASE_OVERVIEW },
  { pattern: /\/ledger|\/tenant.*balance/i,          type: PAGE_TYPES.TENANT_LEDGER },
  { pattern: /\/payment|\/receipt|\/charge/i,        type: PAGE_TYPES.PAYMENT_ENTRY },
  { pattern: /\/maintenance.*request|\/service/i,    type: PAGE_TYPES.MAINTENANCE_REQUEST },
  { pattern: /\/work.?order|\/maintenance(?!.*req)/i,type: PAGE_TYPES.WORK_ORDER },
  { pattern: /\/owner.*statement|\/statement/i,      type: PAGE_TYPES.OWNER_STATEMENT },
  { pattern: /\/report|\/analytics|\/financials/i,   type: PAGE_TYPES.REPORTING },
  { pattern: /\/inbox|\/messages|\/communication/i,  type: PAGE_TYPES.INBOX },
  { pattern: /mail\.google\.com/i,                   type: PAGE_TYPES.INBOX },
  { pattern: /\/dashboard|\/home|\/overview$/i,      type: PAGE_TYPES.DASHBOARD },
];

// ─── Title-based fallback patterns ───────────────────────────────────────────

const TITLE_PATTERNS = [
  { pattern: /lease\s*renew/i,      type: PAGE_TYPES.LEASE_RENEWAL },
  { pattern: /lease/i,              type: PAGE_TYPES.LEASE_OVERVIEW },
  { pattern: /ledger|balance/i,     type: PAGE_TYPES.TENANT_LEDGER },
  { pattern: /payment|receipt/i,    type: PAGE_TYPES.PAYMENT_ENTRY },
  { pattern: /maintenance|repair/i, type: PAGE_TYPES.MAINTENANCE_REQUEST },
  { pattern: /work\s*order/i,       type: PAGE_TYPES.WORK_ORDER },
  { pattern: /owner.*statement/i,   type: PAGE_TYPES.OWNER_STATEMENT },
  { pattern: /report|financ/i,      type: PAGE_TYPES.REPORTING },
  { pattern: /inbox|message/i,      type: PAGE_TYPES.INBOX },
  { pattern: /dashboard/i,          type: PAGE_TYPES.DASHBOARD },
];

/**
 * Detect the page context type from URL and title.
 * REPLACE LATER: Add content script DOM signal support.
 *
 * @param {string} url - Current tab URL
 * @param {string} title - Current tab title
 * @returns {{ type: string, domain: string, detail: string, icon: string, live: boolean }}
 */
export function detectPageContext(url = "", title = "") {
  let type = PAGE_TYPES.UNKNOWN;

  // Try URL patterns first (most reliable)
  for (const { pattern, type: t } of URL_PATTERNS) {
    if (pattern.test(url)) { type = t; break; }
  }

  // Fall back to title patterns
  if (type === PAGE_TYPES.UNKNOWN) {
    for (const { pattern, type: t } of TITLE_PATTERNS) {
      if (pattern.test(title)) { type = t; break; }
    }
  }

  let domain = "";
  try { domain = new URL(url).hostname; } catch { domain = "app.buildium.com"; }

  const meta = PAGE_META[type] ?? PAGE_META[PAGE_TYPES.UNKNOWN];

  return {
    type,
    domain,
    detail: meta.detail,
    icon: meta.icon,
    live: type !== PAGE_TYPES.UNKNOWN,
  };
}

// ─── Page metadata ───────────────────────────────────────────────────────────

const PAGE_META = {
  [PAGE_TYPES.LEASE_OVERVIEW]:      { icon: "📋", detail: "Lease Overview · 12 active leases" },
  [PAGE_TYPES.LEASE_RENEWAL]:       { icon: "🔄", detail: "Lease Renewal · 3 expiring soon" },
  [PAGE_TYPES.TENANT_LEDGER]:       { icon: "💰", detail: "Tenant Ledger · Balance details" },
  [PAGE_TYPES.PAYMENT_ENTRY]:       { icon: "💸", detail: "Payments · Record & manage" },
  [PAGE_TYPES.MAINTENANCE_REQUEST]: { icon: "🔧", detail: "Maintenance · 3 open requests" },
  [PAGE_TYPES.WORK_ORDER]:          { icon: "🛠", detail: "Work Orders · Active jobs" },
  [PAGE_TYPES.OWNER_STATEMENT]:     { icon: "📊", detail: "Owner Statement · February 2026" },
  [PAGE_TYPES.REPORTING]:           { icon: "📈", detail: "Reports & Analytics" },
  [PAGE_TYPES.INBOX]:               { icon: "📧", detail: "Inbox · 3 property-related messages" },
  [PAGE_TYPES.DASHBOARD]:           { icon: "🏠", detail: "Dashboard · Portfolio overview" },
  [PAGE_TYPES.UNKNOWN]:             { icon: "🔍", detail: "Page not recognized" },
};

// ─── Contextual actions per page type ────────────────────────────────────────
// type: "ai" | "auto" | "comm" | "approval"
//   ai       → AI-assisted action (purple)
//   auto     → Automated workflow (blue)
//   comm     → Communication (green/amber)
//   approval → Needs review (amber)

const CONTEXTUAL_ACTIONS = {
  [PAGE_TYPES.LEASE_OVERVIEW]: [
    { id: "draft_renewal",  icon: "📝", label: "Draft renewal notice",     sub: "AI-generated for expiring leases", type: "ai",   color: "purple", handler: "draftRenewal" },
    { id: "view_expiring",  icon: "📊", label: "View expiring leases",     sub: "3 leases expiring within 60 days", type: "auto", color: "blue",   handler: "viewExpiring" },
    { id: "email_tenant",   icon: "📧", label: "Email tenant",             sub: "Compose from page context",        type: "comm", color: "green",  handler: "emailTenant" },
    { id: "text_tenant",    icon: "💬", label: "Text tenant",              sub: "Send SMS about lease",             type: "comm", color: "amber",  handler: "smsTenant" },
    { id: "compare_rent",   icon: "📈", label: "Compare rent to market",   sub: "AI market analysis",               type: "ai",   color: "purple", handler: "compareRent" },
  ],

  [PAGE_TYPES.LEASE_RENEWAL]: [
    { id: "draft_renewal",   icon: "📝", label: "Draft renewal notice",    sub: "AI-generated renewal letter",      type: "ai",       color: "purple", handler: "draftRenewal" },
    { id: "text_renewal",    icon: "💬", label: "Text tenant about renewal",sub: "SMS renewal reminder",            type: "comm",     color: "amber",  handler: "smsRenewal" },
    { id: "compare_rent",    icon: "📈", label: "Compare rent to market",  sub: "AI rent comparison",               type: "ai",       color: "purple", handler: "compareRent" },
    { id: "approve_renewal", icon: "✓",  label: "Approve renewal terms",   sub: "Review and approve",               type: "approval", color: "amber",  handler: "approveRenewal" },
  ],

  [PAGE_TYPES.TENANT_LEDGER]: [
    { id: "post_payment",    icon: "💸", label: "Post payment",            sub: "Record tenant payment",            type: "auto",     color: "blue",   handler: "postPayment" },
    { id: "explain_balance", icon: "✦",  label: "Explain balance",         sub: "AI breakdown of charges",          type: "ai",       color: "purple", handler: "explainBalance" },
    { id: "send_receipt",    icon: "📧", label: "Send receipt",            sub: "Email payment confirmation",       type: "comm",     color: "green",  handler: "emailReceipt" },
    { id: "text_reminder",   icon: "💬", label: "Text payment reminder",   sub: "SMS late payment notice",          type: "comm",     color: "amber",  handler: "smsPaymentReminder" },
    { id: "flag_discrepancy",icon: "⚠",  label: "Flag discrepancy",        sub: "Mark for review",                  type: "approval", color: "amber",  handler: "flagDiscrepancy" },
  ],

  [PAGE_TYPES.PAYMENT_ENTRY]: [
    { id: "post_payment",    icon: "💸", label: "Post payment",            sub: "Record incoming payment",          type: "auto",     color: "blue",   handler: "postPayment" },
    { id: "explain_balance", icon: "✦",  label: "Explain balance",         sub: "AI account summary",               type: "ai",       color: "purple", handler: "explainBalance" },
    { id: "send_receipt",    icon: "📧", label: "Send receipt",            sub: "Email payment receipt",             type: "comm",     color: "green",  handler: "emailReceipt" },
    { id: "text_reminder",   icon: "💬", label: "Text payment reminder",   sub: "SMS to tenant",                    type: "comm",     color: "amber",  handler: "smsPaymentReminder" },
  ],

  [PAGE_TYPES.MAINTENANCE_REQUEST]: [
    { id: "create_wo",       icon: "🛠", label: "Create work order",       sub: "Generate from this request",       type: "auto",     color: "blue",   handler: "createWorkOrder" },
    { id: "summarize_issue", icon: "✦",  label: "Summarize issue",         sub: "AI summary of request",            type: "ai",       color: "purple", handler: "summarizeIssue" },
    { id: "contact_vendor",  icon: "📞", label: "Contact vendor",          sub: "Dispatch to assigned vendor",      type: "comm",     color: "green",  handler: "emailVendor" },
    { id: "text_update",     icon: "💬", label: "Text tenant update",      sub: "SMS status update",                type: "comm",     color: "amber",  handler: "smsMaintUpdate" },
    { id: "repair_history",  icon: "📋", label: "Check repair history",    sub: "View past maintenance",            type: "auto",     color: "blue",   handler: "repairHistory" },
  ],

  [PAGE_TYPES.WORK_ORDER]: [
    { id: "create_wo",       icon: "🛠", label: "Create work order",       sub: "New work order",                   type: "auto",     color: "blue",   handler: "createWorkOrder" },
    { id: "summarize_issue", icon: "✦",  label: "Summarize issue",         sub: "AI issue summary",                 type: "ai",       color: "purple", handler: "summarizeIssue" },
    { id: "text_vendor",     icon: "💬", label: "Text vendor dispatch",    sub: "SMS vendor details",               type: "comm",     color: "amber",  handler: "smsVendorDispatch" },
    { id: "text_update",     icon: "💬", label: "Text tenant update",      sub: "SMS status update",                type: "comm",     color: "green",  handler: "smsMaintUpdate" },
  ],

  [PAGE_TYPES.OWNER_STATEMENT]: [
    { id: "summarize_stmt",  icon: "✦",  label: "Summarize statement",     sub: "AI statement overview",            type: "ai",       color: "purple", handler: "summarizeStatement" },
    { id: "explain_variance",icon: "📊", label: "Explain variance",        sub: "AI month-over-month analysis",     type: "ai",       color: "purple", handler: "explainVariance" },
    { id: "draft_update",    icon: "📝", label: "Draft owner update",      sub: "AI-written owner email",           type: "ai",       color: "purple", handler: "draftOwnerUpdate" },
    { id: "email_owner",     icon: "📧", label: "Email owner",             sub: "Send statement + notes",           type: "comm",     color: "green",  handler: "emailOwner" },
    { id: "review_invoices", icon: "🧾", label: "Review unpaid invoices",  sub: "Outstanding vendor invoices",      type: "approval", color: "amber",  handler: "reviewInvoices" },
  ],

  [PAGE_TYPES.REPORTING]: [
    { id: "summarize_report",icon: "✦",  label: "Summarize report",        sub: "AI insights from data",            type: "ai",       color: "purple", handler: "summarizeReport" },
    { id: "explain_variance",icon: "📊", label: "Explain variance",        sub: "AI variance analysis",             type: "ai",       color: "purple", handler: "explainVariance" },
    { id: "email_owner",     icon: "📧", label: "Email owner report",      sub: "Share report with owner",          type: "comm",     color: "green",  handler: "emailOwner" },
    { id: "export_data",     icon: "📥", label: "Export to spreadsheet",   sub: "Download report data",             type: "auto",     color: "blue",   handler: "exportData" },
  ],

  [PAGE_TYPES.INBOX]: [
    { id: "draft_reply",     icon: "↩",  label: "Draft reply",             sub: "AI-assisted response",             type: "ai",       color: "purple", handler: "draftReply" },
    { id: "summarize_thread",icon: "✦",  label: "Summarize thread",        sub: "AI conversation summary",          type: "ai",       color: "purple", handler: "summarizeThread" },
    { id: "sms_followup",    icon: "💬", label: "Send SMS follow-up",      sub: "Text based on thread",             type: "comm",     color: "amber",  handler: "smsFollowUp" },
    { id: "extract_actions", icon: "📌", label: "Extract action items",    sub: "AI task extraction",               type: "ai",       color: "blue",   handler: "extractActions" },
  ],

  [PAGE_TYPES.DASHBOARD]: [
    { id: "portfolio_summary",icon: "✦", label: "Portfolio summary",       sub: "AI overview of all properties",    type: "ai",       color: "purple", handler: "portfolioSummary" },
    { id: "view_expiring",   icon: "📋", label: "Expiring leases",         sub: "3 leases expiring soon",           type: "auto",     color: "blue",   handler: "viewExpiring" },
    { id: "overdue_payments",icon: "💸", label: "Overdue payments",        sub: "1 payment past due",               type: "approval", color: "amber",  handler: "overduePayments" },
    { id: "open_maintenance",icon: "🔧", label: "Open maintenance",        sub: "3 active requests",                type: "auto",     color: "blue",   handler: "openMaintenance" },
  ],

  [PAGE_TYPES.UNKNOWN]: [
    { id: "portfolio_summary",icon: "✦", label: "Portfolio summary",       sub: "AI overview",                      type: "ai",       color: "purple", handler: "portfolioSummary" },
    { id: "view_expiring",   icon: "📋", label: "Expiring leases",         sub: "Check upcoming expirations",       type: "auto",     color: "blue",   handler: "viewExpiring" },
    { id: "open_maintenance",icon: "🔧", label: "Open requests",           sub: "View maintenance queue",           type: "auto",     color: "blue",   handler: "openMaintenance" },
  ],
};

/**
 * Get contextual actions for a given page type.
 * @param {string} pageType
 * @returns {Array} actions for that page
 */
export function getContextualActions(pageType) {
  return CONTEXTUAL_ACTIONS[pageType] ?? CONTEXTUAL_ACTIONS[PAGE_TYPES.UNKNOWN];
}

// ─── Demo page cycle (for simulate-nav button) ──────────────────────────────

export const DEMO_PAGES = [
  { type: PAGE_TYPES.LEASE_OVERVIEW,      url: "https://app.buildium.com/leases",              title: "Leases" },
  { type: PAGE_TYPES.TENANT_LEDGER,       url: "https://app.buildium.com/ledger/tenant/ten-5",  title: "Tenant Ledger — Carlos Mendez" },
  { type: PAGE_TYPES.MAINTENANCE_REQUEST, url: "https://app.buildium.com/maintenance/requests", title: "Maintenance Requests" },
  { type: PAGE_TYPES.OWNER_STATEMENT,     url: "https://app.buildium.com/owner/statement",      title: "Owner Statement — February 2026" },
  { type: PAGE_TYPES.INBOX,               url: "https://mail.google.com/mail/u/0/#inbox",       title: "Inbox — Gmail" },
  { type: PAGE_TYPES.DASHBOARD,           url: "https://app.buildium.com/dashboard",             title: "Dashboard" },
  { type: PAGE_TYPES.LEASE_RENEWAL,       url: "https://app.buildium.com/leases/renewal",        title: "Lease Renewal" },
  { type: PAGE_TYPES.PAYMENT_ENTRY,       url: "https://app.buildium.com/payments",              title: "Payments" },
  { type: PAGE_TYPES.WORK_ORDER,          url: "https://app.buildium.com/workorders",            title: "Work Orders" },
  { type: PAGE_TYPES.REPORTING,           url: "https://app.buildium.com/reports/financials",     title: "Financial Reports" },
];
