/**
 * actions.js — Contextual action handlers for demo.
 *
 * Each handler returns a result object describing what to show in the UI.
 * Result types: "result_card", "sms_composer", "email_composer", "data_card"
 *
 * REPLACE LATER: Wire these to real Buildium APIs, real SMS, real email.
 */

import * as D from "./data.js";
import { aiAction } from "./llm.js";
import { smsTemplates, getThreadByContact } from "./sms.js";
import { emailTemplates } from "./gmail.js";

/**
 * Run a contextual action by handler name.
 * @param {string} handlerName
 * @param {string} pageType
 * @returns {Promise<{ type: string, title: string, ... }>}
 */
export async function runAction(handlerName, pageType) {
  const handler = HANDLERS[handlerName];
  if (!handler) {
    return { type: "result_card", title: "Action", content: `Handler "${handlerName}" not implemented yet.`, status: "info" };
  }
  return handler(pageType);
}

// ─── Handler implementations ─────────────────────────────────────────────────

const HANDLERS = {

  // ── AI-assisted ──────────────────────────────────────────────────────────

  async draftRenewal(pageType) {
    const text = await aiAction(
      "Draft a lease renewal notice for the tenant whose lease is expiring soonest. Include current rent, proposed new rent (3% increase), and renewal terms.",
      pageType
    );
    return { type: "result_card", title: "Lease Renewal Draft", content: text, status: "ai", icon: "📝" };
  },

  async compareRent(pageType) {
    const text = await aiAction(
      "Compare the current rent for expiring leases against estimated market rates. Suggest whether to increase, hold, or decrease rent for each.",
      pageType
    );
    return { type: "result_card", title: "Rent Market Comparison", content: text, status: "ai", icon: "📈" };
  },

  async explainBalance(pageType) {
    const text = await aiAction(
      "Explain the current balance situation for all tenants. Highlight any overdue payments and break down recent charges.",
      pageType
    );
    return { type: "result_card", title: "Balance Explanation", content: text, status: "ai", icon: "✦" };
  },

  async summarizeIssue(pageType) {
    const text = await aiAction(
      "Summarize all open maintenance requests. For each, include the issue, unit, tenant, priority, status, and assigned vendor if any.",
      pageType
    );
    return { type: "result_card", title: "Maintenance Summary", content: text, status: "ai", icon: "✦" };
  },

  async summarizeStatement(pageType) {
    const text = await aiAction(
      "Summarize the latest owner statements. Include income, expenses, net income, and notable line items for each owner.",
      pageType
    );
    return { type: "result_card", title: "Statement Summary", content: text, status: "ai", icon: "✦" };
  },

  async explainVariance(pageType) {
    const text = await aiAction(
      "Analyze the owner statements and explain any notable variances or unusual expenses compared to typical months.",
      pageType
    );
    return { type: "result_card", title: "Variance Analysis", content: text, status: "ai", icon: "📊" };
  },

  async draftOwnerUpdate(pageType) {
    const owner = D.getOwnerById("own-1");
    const stmt = D.getStatementForOwner("own-1");
    const text = await aiAction(
      `Draft a professional email update to ${owner.name} about their ${stmt.period} statement. Net income: $${stmt.netIncome}. Mention key line items.`,
      pageType
    );
    return { type: "result_card", title: "Owner Update Draft", content: text, status: "ai", icon: "📝" };
  },

  async summarizeReport(pageType) {
    const text = await aiAction(
      "Provide a brief executive summary of the portfolio performance based on available data. Include occupancy, payment status, and maintenance overview.",
      pageType
    );
    return { type: "result_card", title: "Report Summary", content: text, status: "ai", icon: "✦" };
  },

  async draftReply(pageType) {
    const text = await aiAction(
      "Draft a professional reply to the most recent property-related email thread. Be helpful and concise.",
      pageType
    );
    return { type: "result_card", title: "Draft Reply", content: text, status: "ai", icon: "↩" };
  },

  async summarizeThread(pageType) {
    const text = await aiAction(
      "Summarize the recent property-related email conversations. List key points and any pending action items.",
      pageType
    );
    return { type: "result_card", title: "Thread Summary", content: text, status: "ai", icon: "✦" };
  },

  async extractActions(pageType) {
    const text = await aiAction(
      "Extract action items from recent communications. List each action with who is responsible and any deadlines.",
      pageType
    );
    return { type: "result_card", title: "Action Items", content: text, status: "ai", icon: "📌" };
  },

  async portfolioSummary(pageType) {
    const text = await aiAction(
      "Give a complete portfolio summary: properties, occupancy, payment status, upcoming lease expirations, open maintenance, and any items needing attention.",
      pageType
    );
    return { type: "result_card", title: "Portfolio Summary", content: text, status: "ai", icon: "✦" };
  },

  async approveRenewal() {
    await new Promise(r => setTimeout(r, 500));
    return { type: "result_card", title: "Renewal Approved", content: "Lease renewal terms approved. Renewal documents will be generated and sent to the tenant for signature.", status: "done", icon: "✓" };
  },

  // ── Data/workflow actions ────────────────────────────────────────────────

  async viewExpiring() {
    const expiring = D.leases.filter(l => l.daysUntilExpiry <= 60);
    const items = expiring.map(l => {
      const t = D.getTenantById(l.tenantId);
      const p = D.getPropertyById(l.propertyId);
      return `${t?.name} — ${p?.name}, ${l.unit} · $${l.rent}/mo · Expires in ${l.daysUntilExpiry} days`;
    });
    return { type: "data_card", title: "Expiring Leases", items, status: "info", icon: "📋" };
  },

  async overduePayments() {
    const overdue = D.payments.filter(p => p.status === "Overdue");
    const items = overdue.map(p => {
      const t = D.getTenantById(p.tenantId);
      return `${t?.name} — $${p.balanceDue} overdue · ${p.daysPastDue} days past due`;
    });
    return { type: "data_card", title: "Overdue Payments", items: items.length ? items : ["No overdue payments"], status: items.length ? "warning" : "done", icon: "💸" };
  },

  async openMaintenance() {
    const open = D.maintenance.filter(m => m.status !== "Completed");
    const items = open.map(m => {
      const t = D.getTenantById(m.tenantId);
      return `${m.issue} — ${m.unit} (${t?.name}) · ${m.status} · ${m.priority} priority`;
    });
    return { type: "data_card", title: "Open Maintenance", items, status: "info", icon: "🔧" };
  },

  async postPayment() {
    await new Promise(r => setTimeout(r, 600));
    return { type: "result_card", title: "Payment Posted", content: "Payment of $1,550.00 recorded for Carlos Mendez (Unit 12A). The tenant ledger has been updated.", status: "done", icon: "💸" };
  },

  async flagDiscrepancy() {
    await new Promise(r => setTimeout(r, 400));
    return { type: "result_card", title: "Discrepancy Flagged", content: "A balance discrepancy has been flagged for review on Carlos Mendez's account (Unit 12A). The accounting team will be notified.", status: "warning", icon: "⚠" };
  },

  async createWorkOrder() {
    await new Promise(r => setTimeout(r, 700));
    return { type: "result_card", title: "Work Order Created", content: "Work order #WO-2026-089 created for garage door opener repair at Oak Avenue Townhomes, Unit 2. Pending vendor assignment.", status: "done", icon: "🛠" };
  },

  async repairHistory() {
    const completed = D.maintenance.filter(m => m.status === "Completed");
    const items = completed.map(m => {
      const t = D.getTenantById(m.tenantId);
      return `${m.issue} — ${m.unit} (${t?.name}) · Completed · ${m.vendor} · $${m.estimatedCost}`;
    });
    if (!items.length) items.push("No completed repairs in current data.");
    return { type: "data_card", title: "Repair History", items, status: "info", icon: "📋" };
  },

  async reviewInvoices() {
    const items = [
      "ABC Plumbing — Invoice #4521 · $280 · Due: Apr 14, 2026",
      "CoolAir Services — Invoice #7830 · $450 · Due: Apr 13, 2026",
    ];
    return { type: "data_card", title: "Unpaid Vendor Invoices", items, status: "warning", icon: "🧾" };
  },

  async exportData() {
    await new Promise(r => setTimeout(r, 500));
    return { type: "result_card", title: "Export Ready", content: "Financial report exported to spreadsheet. Download link: report_feb_2026.xlsx (demo — no real file created).", status: "done", icon: "📥" };
  },

  // ── SMS actions ──────────────────────────────────────────────────────────

  async smsTenant(pageType) {
    const tenant = D.getDemoTenant(pageType) ?? D.tenants[0];
    const thread = getThreadByContact(tenant.name);
    return {
      type: "sms_composer",
      title: "Text Tenant",
      to: tenant.name,
      phone: tenant.phone,
      draft: smsTemplates.followUp(tenant.name),
      threadId: thread?.id ?? null,
      existingMessages: thread?.messages ?? [],
    };
  },

  async smsRenewal(pageType) {
    const tenant = D.getDemoTenant(pageType) ?? D.tenants[3]; // Emily Zhang
    const lease = D.getLeaseByTenantId(tenant.id);
    return {
      type: "sms_composer",
      title: "Text Renewal Reminder",
      to: tenant.name,
      phone: tenant.phone,
      draft: smsTemplates.leaseRenewal(tenant, lease?.unit ?? "your unit", lease?.end ?? "soon"),
      threadId: getThreadByContact(tenant.name)?.id ?? null,
      existingMessages: getThreadByContact(tenant.name)?.messages ?? [],
    };
  },

  async smsPaymentReminder(pageType) {
    const tenant = D.getTenantById("ten-5"); // Carlos — overdue
    const payment = D.getPaymentsForTenant("ten-5").find(p => p.status === "Overdue");
    return {
      type: "sms_composer",
      title: "Text Payment Reminder",
      to: tenant.name,
      phone: tenant.phone,
      draft: smsTemplates.latePayment(tenant, payment?.balanceDue ?? 1550, payment?.daysPastDue ?? 17),
      threadId: getThreadByContact(tenant.name)?.id ?? null,
      existingMessages: getThreadByContact(tenant.name)?.messages ?? [],
    };
  },

  async smsMaintUpdate(pageType) {
    const maint = D.maintenance[0]; // Kitchen faucet
    const tenant = D.getTenantById(maint.tenantId);
    return {
      type: "sms_composer",
      title: "Text Maintenance Update",
      to: tenant.name,
      phone: tenant.phone,
      draft: smsTemplates.maintenanceUpdate(tenant, maint.issue, maint.status),
      threadId: getThreadByContact(tenant.name)?.id ?? null,
      existingMessages: getThreadByContact(tenant.name)?.messages ?? [],
    };
  },

  async smsVendorDispatch() {
    const maint = D.maintenance[2]; // Garage door
    const prop = D.getPropertyById(maint.propertyId);
    const vendor = D.vendors[2]; // Handy Repairs
    return {
      type: "sms_composer",
      title: "Text Vendor Dispatch",
      to: vendor.name,
      phone: vendor.phone,
      draft: smsTemplates.vendorDispatch(vendor.name, prop.name, maint.unit, maint.issue),
      threadId: getThreadByContact(vendor.name)?.id ?? null,
      existingMessages: getThreadByContact(vendor.name)?.messages ?? [],
    };
  },

  async smsFollowUp(pageType) {
    const tenant = D.getDemoTenant(pageType) ?? D.tenants[2];
    return {
      type: "sms_composer",
      title: "SMS Follow-up",
      to: tenant.name,
      phone: tenant.phone,
      draft: smsTemplates.followUp(tenant.name),
      threadId: getThreadByContact(tenant.name)?.id ?? null,
      existingMessages: getThreadByContact(tenant.name)?.messages ?? [],
    };
  },

  // ── Email actions ────────────────────────────────────────────────────────

  async emailTenant(pageType) {
    const tenant = D.getDemoTenant(pageType) ?? D.tenants[0];
    const lease = D.getLeaseByTenantId(tenant.id);
    const tpl = emailTemplates.leaseRenewal(tenant, lease?.unit ?? tenant.unit, Math.round((lease?.rent ?? 1500) * 1.03));
    return { type: "email_composer", title: "Email Tenant", ...tpl };
  },

  async emailReceipt(pageType) {
    const tenant = D.getTenantById("ten-1");
    const payment = D.payments[0];
    const tpl = emailTemplates.paymentReceipt(tenant, payment.amount, payment.date);
    return { type: "email_composer", title: "Send Receipt", ...tpl };
  },

  async emailVendor() {
    const vendor = D.vendors[0];
    const maint = D.maintenance[0];
    const prop = D.getPropertyById(maint.propertyId);
    const tpl = emailTemplates.vendorDispatch(vendor, prop.name, maint.unit, maint.issue);
    return { type: "email_composer", title: "Email Vendor", ...tpl };
  },

  async emailOwner() {
    const owner = D.getOwnerById("own-1");
    const stmt = D.getStatementForOwner("own-1");
    const tpl = emailTemplates.ownerUpdate(owner, stmt.period, stmt.netIncome);
    return { type: "email_composer", title: "Email Owner", ...tpl };
  },
};
