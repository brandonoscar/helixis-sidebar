/**
 * sms.js — Fake SMS data layer for demo.
 *
 * REPLACE LATER: Swap with real Twilio, MessageBird, or other SMS provider.
 * All functions are synchronous/fake — no real messages are sent.
 */

// ─── Fake SMS threads ────────────────────────────────────────────────────────

export const smsThreads = [
  {
    id: "sms-t1", contactName: "James Rivera", contactType: "tenant", phone: "(512) 555-0142",
    messages: [
      { id: "s1", dir: "out", text: "Hi James, just confirming the plumber is scheduled for tomorrow at 10am for your kitchen faucet.", time: "Mar 14, 2:15 PM", status: "delivered" },
      { id: "s2", dir: "in",  text: "Thanks! I'll make sure someone is home. Is it the same plumber as last time?", time: "Mar 14, 2:22 PM", status: "delivered" },
      { id: "s3", dir: "out", text: "Yes, ABC Plumbing. They should be done within an hour.", time: "Mar 14, 2:25 PM", status: "delivered" },
    ],
  },
  {
    id: "sms-t2", contactName: "Carlos Mendez", contactType: "tenant", phone: "(512) 555-0423",
    messages: [
      { id: "s4", dir: "out", text: "Hi Carlos, this is a reminder that your March rent of $1,550 is past due. Please submit payment at your earliest convenience.", time: "Mar 10, 9:00 AM", status: "delivered" },
      { id: "s5", dir: "in",  text: "I'm sorry, I had some issues with my bank. I'll pay by Friday.", time: "Mar 10, 11:30 AM", status: "delivered" },
      { id: "s6", dir: "out", text: "Thank you for letting us know. Please make the payment through the online portal.", time: "Mar 10, 11:45 AM", status: "delivered" },
    ],
  },
  {
    id: "sms-t3", contactName: "Emily Zhang", contactType: "tenant", phone: "(512) 555-0311",
    messages: [
      { id: "s7", dir: "out", text: "Hi Emily, your lease at 7 Pine Rd expires on April 30. Would you like to discuss renewal options?", time: "Mar 12, 10:00 AM", status: "delivered" },
      { id: "s8", dir: "in",  text: "Hi, I actually gave notice already. My last day will be April 30.", time: "Mar 12, 12:15 PM", status: "delivered" },
    ],
  },
  {
    id: "sms-t4", contactName: "ABC Plumbing", contactType: "vendor", phone: "(512) 555-0700",
    messages: [
      { id: "s9",  dir: "out", text: "New job: Kitchen faucet leak at 123 Spruce St, Unit 4B. Tenant is James Rivera. Please call to schedule.", time: "Mar 12, 3:00 PM", status: "delivered" },
      { id: "s10", dir: "in",  text: "Got it. We can come out tomorrow at 10am. Est. $280.", time: "Mar 12, 3:45 PM", status: "delivered" },
      { id: "s11", dir: "out", text: "Confirmed. Tenant has been notified.", time: "Mar 12, 4:00 PM", status: "delivered" },
    ],
  },
  {
    id: "sms-t5", contactName: "Margaret Chen", contactType: "owner", phone: "(512) 555-1001",
    messages: [
      { id: "s12", dir: "out", text: "Hi Margaret, your February owner statement is ready. Net income: $5,530. Would you like me to email the full report?", time: "Mar 5, 9:00 AM", status: "delivered" },
      { id: "s13", dir: "in",  text: "Yes please. Also, can you explain the plumbing expense?", time: "Mar 5, 10:30 AM", status: "delivered" },
    ],
  },
];

// ─── SMS templates by context ────────────────────────────────────────────────

export const smsTemplates = {
  paymentReminder: (tenant, amount) =>
    `Hi ${tenant.name}, this is a friendly reminder that your payment of $${amount.toLocaleString()} is due. Please submit through the online portal or contact us with questions.`,

  latePayment: (tenant, amount, days) =>
    `Hi ${tenant.name}, your payment of $${amount.toLocaleString()} is ${days} days past due. Please make your payment as soon as possible to avoid additional fees.`,

  leaseRenewal: (tenant, unit, endDate) =>
    `Hi ${tenant.name}, your lease for ${unit} expires on ${endDate}. We'd love to have you stay! Please let us know if you'd like to discuss renewal terms.`,

  maintenanceUpdate: (tenant, issue, status) =>
    `Hi ${tenant.name}, update on your maintenance request "${issue}": Status is now "${status}". We'll keep you posted on any changes.`,

  vendorDispatch: (vendor, property, unit, issue) =>
    `New job request: ${issue} at ${property}, ${unit}. Please call to schedule. Reply with availability.`,

  followUp: (name) =>
    `Hi ${name}, just following up on our last conversation. Please let us know if you have any questions.`,
};

// ─── Fake send ───────────────────────────────────────────────────────────────

/**
 * Simulate sending an SMS. Returns a fake result after a short delay.
 * REPLACE LATER: Call real SMS API (Twilio, etc.)
 *
 * @param {string} threadId - existing thread or null
 * @param {string} to - recipient phone
 * @param {string} text - message body
 * @returns {Promise<{ success: boolean, messageId: string, status: string }>}
 */
export async function fakeSendSms(threadId, to, text) {
  await new Promise(r => setTimeout(r, 800 + Math.random() * 400));
  return {
    success: true,
    messageId: "msg-" + Date.now().toString(36),
    status: "delivered",
    timestamp: new Date().toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }),
  };
}

/** Get thread by contact name (loose match). */
export function getThreadByContact(name) {
  return smsThreads.find(t => t.contactName.toLowerCase().includes(name.toLowerCase())) ?? null;
}
