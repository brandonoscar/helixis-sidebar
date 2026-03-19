/**
 * gmail.js — Fake Gmail connection, scopes, and email data for demo.
 *
 * REPLACE LATER: Swap with real Google OAuth + Gmail API.
 * Nothing here touches real Google services.
 */

// ─── Fake Gmail scopes ───────────────────────────────────────────────────────

export const GMAIL_SCOPES = [
  { id: "read_email",       label: "Read email",          desc: "View email messages and metadata", granted: true },
  { id: "draft_email",      label: "Draft email",         desc: "Create and edit email drafts",     granted: true },
  { id: "send_email",       label: "Send email",          desc: "Send email on your behalf",        granted: true },
  { id: "read_threads",     label: "Read threads",        desc: "Access full email threads",        granted: true },
  { id: "summarize_inbox",  label: "Summarize inbox",     desc: "AI-powered inbox context",         granted: false },
];

// ─── Fake connection states ──────────────────────────────────────────────────

export const GMAIL_STATES = {
  NOT_CONNECTED: "not_connected",
  CONNECTED:     "connected",
  RECONNECT:     "reconnect_required",
};

export function getInitialGmailState() {
  return {
    status: GMAIL_STATES.CONNECTED,
    email: "manager@helixis-demo.com",
    lastSync: "2 minutes ago",
    scopes: GMAIL_SCOPES.map(s => ({ ...s })),
  };
}

// ─── Fake email threads ──────────────────────────────────────────────────────

export const emailThreads = [
  {
    id: "em-t1", subject: "Re: Lease Renewal — 45 Oak Ave, Unit 2",
    participants: ["Marcus Johnson <marcus.j@email.com>", "You <manager@helixis-demo.com>"],
    messages: [
      { from: "You", text: "Hi Marcus, your lease for Unit 2 at Oak Avenue expires on June 30, 2026. I'd like to offer a renewal at $1,850/month (a $50 increase). Let me know your thoughts.", time: "Mar 10, 9:00 AM" },
      { from: "Marcus Johnson", text: "Thanks for reaching out. The increase seems reasonable. Can I get a 2-year term instead of 1 year?", time: "Mar 10, 2:30 PM" },
      { from: "You", text: "I can do a 2-year term at $1,850. I'll have the renewal documents ready by next week.", time: "Mar 11, 8:15 AM" },
    ],
  },
  {
    id: "em-t2", subject: "Vendor Invoice — ABC Plumbing",
    participants: ["ABC Plumbing <dispatch@abcplumbing.com>", "You <manager@helixis-demo.com>"],
    messages: [
      { from: "ABC Plumbing", text: "Invoice #4521 attached for kitchen faucet repair at 123 Spruce St, Unit 4B. Total: $280. Net 30 terms.", time: "Mar 15, 11:00 AM" },
    ],
  },
  {
    id: "em-t3", subject: "February Owner Statement — Margaret Chen",
    participants: ["Margaret Chen <margaret.chen@email.com>", "You <manager@helixis-demo.com>"],
    messages: [
      { from: "You", text: "Hi Margaret, attached is your February 2026 owner statement. Net income: $5,530. The main variance from January is the plumbing repair at Unit 4B ($280). Happy to discuss.", time: "Mar 5, 9:30 AM" },
      { from: "Margaret Chen", text: "Thank you. The plumbing expense makes sense. Can you also send me an update on the HVAC issue at Unit 7A?", time: "Mar 5, 4:00 PM" },
    ],
  },
];

// ─── Email templates ─────────────────────────────────────────────────────────

export const emailTemplates = {
  leaseRenewal: (tenant, unit, newRent) => ({
    to: tenant.email,
    subject: `Lease Renewal — ${unit}`,
    body: `Dear ${tenant.name},\n\nYour lease for ${unit} is approaching its expiration date. We'd like to offer a renewal at $${newRent.toLocaleString()}/month.\n\nPlease review the attached renewal terms and let us know if you'd like to proceed.\n\nBest regards,\nHelixis Property Management`,
  }),

  paymentReceipt: (tenant, amount, date) => ({
    to: tenant.email,
    subject: `Payment Receipt — $${amount.toLocaleString()}`,
    body: `Dear ${tenant.name},\n\nThis confirms your payment of $${amount.toLocaleString()} received on ${date}.\n\nThank you for your prompt payment.\n\nBest regards,\nHelixis Property Management`,
  }),

  ownerUpdate: (owner, period, netIncome) => ({
    to: owner.email,
    subject: `Owner Statement — ${period}`,
    body: `Dear ${owner.name},\n\nYour ${period} owner statement is ready. Net income: $${netIncome.toLocaleString()}.\n\nPlease find the detailed statement attached. Let me know if you have any questions.\n\nBest regards,\nHelixis Property Management`,
  }),

  maintenanceNotice: (tenant, issue, status) => ({
    to: tenant.email,
    subject: `Maintenance Update — ${issue}`,
    body: `Dear ${tenant.name},\n\nThis is an update on your maintenance request: "${issue}"\n\nCurrent status: ${status}\n\nWe'll continue to keep you informed. Please don't hesitate to reach out with questions.\n\nBest regards,\nHelixis Property Management`,
  }),

  vendorDispatch: (vendor, property, unit, issue) => ({
    to: vendor.email,
    subject: `Work Order — ${property}, ${unit}`,
    body: `Hi ${vendor.name},\n\nWe have a new maintenance request:\n\nProperty: ${property}\nUnit: ${unit}\nIssue: ${issue}\n\nPlease contact us to schedule the repair.\n\nThank you,\nHelixis Property Management`,
  }),
};

// ─── Fake Gmail actions ──────────────────────────────────────────────────────

/**
 * Simulate sending an email. Returns fake result.
 * REPLACE LATER: Use Gmail API send.
 */
export async function fakeSendEmail(to, subject, body) {
  await new Promise(r => setTimeout(r, 600 + Math.random() * 400));
  return {
    success: true,
    messageId: "em-" + Date.now().toString(36),
    timestamp: new Date().toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }),
  };
}

/**
 * Simulate connecting Gmail.
 * REPLACE LATER: Real Google OAuth flow.
 */
export async function fakeConnectGmail() {
  await new Promise(r => setTimeout(r, 1200));
  return getInitialGmailState();
}

/**
 * Simulate disconnecting Gmail.
 */
export async function fakeDisconnectGmail() {
  await new Promise(r => setTimeout(r, 400));
  return { status: GMAIL_STATES.NOT_CONNECTED, email: null, lastSync: null, scopes: [] };
}
