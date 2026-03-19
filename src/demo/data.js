/**
 * data.js — Fake Buildium-style data for demo purposes.
 *
 * REPLACE LATER: Swap these exports with real API calls to Buildium,
 * your own backend, or any property management platform.
 */

// ─── Properties ──────────────────────────────────────────────────────────────

export const properties = [
  { id: "prop-1", name: "Spruce Street Apartments", address: "123 Spruce St, Austin, TX 78701", units: 12, type: "Residential", owner: "Margaret Chen", ownerId: "own-1" },
  { id: "prop-2", name: "Oak Avenue Townhomes", address: "45 Oak Ave, Austin, TX 78702", units: 6, type: "Residential", owner: "David Park", ownerId: "own-2" },
  { id: "prop-3", name: "Pine Road Duplex", address: "7 Pine Rd, Austin, TX 78703", units: 2, type: "Residential", owner: "Margaret Chen", ownerId: "own-1" },
  { id: "prop-4", name: "Cedar Commercial Plaza", address: "900 Cedar Blvd, Austin, TX 78704", units: 4, type: "Commercial", owner: "Realty Holdings LLC", ownerId: "own-3" },
];

// ─── Tenants ─────────────────────────────────────────────────────────────────

export const tenants = [
  { id: "ten-1", name: "James Rivera", email: "james.rivera@email.com", phone: "(512) 555-0142", unit: "Unit 4B", propertyId: "prop-1", status: "Current", moveIn: "2023-06-01" },
  { id: "ten-2", name: "Sarah Kim", email: "sarah.kim@email.com", phone: "(512) 555-0198", unit: "Unit 7A", propertyId: "prop-1", status: "Current", moveIn: "2022-09-15" },
  { id: "ten-3", name: "Marcus Johnson", email: "marcus.j@email.com", phone: "(512) 555-0267", unit: "Unit 2", propertyId: "prop-2", status: "Current", moveIn: "2024-01-01" },
  { id: "ten-4", name: "Emily Zhang", email: "emily.z@email.com", phone: "(512) 555-0311", unit: "Unit 1A", propertyId: "prop-3", status: "Notice Given", moveIn: "2021-03-01" },
  { id: "ten-5", name: "Carlos Mendez", email: "carlos.m@email.com", phone: "(512) 555-0423", unit: "Unit 12A", propertyId: "prop-1", status: "Current", moveIn: "2023-11-01" },
  { id: "ten-6", name: "Aisha Patel", email: "aisha.p@email.com", phone: "(512) 555-0589", unit: "Suite 101", propertyId: "prop-4", status: "Current", moveIn: "2024-06-01" },
];

// ─── Leases ──────────────────────────────────────────────────────────────────

export const leases = [
  { id: "lea-1", tenantId: "ten-1", propertyId: "prop-1", unit: "Unit 4B", start: "2023-06-01", end: "2026-05-31", rent: 1450, status: "Active", daysUntilExpiry: 440 },
  { id: "lea-2", tenantId: "ten-2", propertyId: "prop-1", unit: "Unit 7A", start: "2024-09-15", end: "2026-04-14", rent: 1625, status: "Active", daysUntilExpiry: 28 },
  { id: "lea-3", tenantId: "ten-3", propertyId: "prop-2", unit: "Unit 2", start: "2024-01-01", end: "2026-06-30", rent: 1800, status: "Active", daysUntilExpiry: 105 },
  { id: "lea-4", tenantId: "ten-4", propertyId: "prop-3", unit: "Unit 1A", start: "2023-03-01", end: "2026-04-30", rent: 1200, status: "Expiring Soon", daysUntilExpiry: 44 },
  { id: "lea-5", tenantId: "ten-5", propertyId: "prop-1", unit: "Unit 12A", start: "2023-11-01", end: "2026-10-31", rent: 1550, status: "Active", daysUntilExpiry: 228 },
  { id: "lea-6", tenantId: "ten-6", propertyId: "prop-4", unit: "Suite 101", start: "2024-06-01", end: "2027-05-31", rent: 2800, status: "Active", daysUntilExpiry: 440 },
];

// ─── Payments ────────────────────────────────────────────────────────────────

export const payments = [
  { id: "pay-1", tenantId: "ten-1", amount: 1450, date: "2026-03-01", method: "ACH", status: "Cleared", type: "Rent" },
  { id: "pay-2", tenantId: "ten-2", amount: 1625, date: "2026-03-01", method: "Check #4412", status: "Cleared", type: "Rent" },
  { id: "pay-3", tenantId: "ten-3", amount: 1800, date: "2026-03-03", method: "ACH", status: "Pending", type: "Rent" },
  { id: "pay-4", tenantId: "ten-4", amount: 1200, date: "2026-02-28", method: "Online Portal", status: "Cleared", type: "Rent" },
  { id: "pay-5", tenantId: "ten-5", amount: 0, date: null, method: null, status: "Overdue", type: "Rent", balanceDue: 1550, daysPastDue: 17 },
  { id: "pay-6", tenantId: "ten-1", amount: 250, date: "2026-02-15", method: "ACH", status: "Cleared", type: "Late Fee" },
  { id: "pay-7", tenantId: "ten-6", amount: 2800, date: "2026-03-01", method: "Wire", status: "Cleared", type: "Rent" },
];

// ─── Maintenance Requests ────────────────────────────────────────────────────

export const maintenance = [
  { id: "mnt-1", propertyId: "prop-1", unit: "Unit 4B", tenantId: "ten-1", issue: "Kitchen faucet leaking", priority: "High", status: "In Progress", vendor: "ABC Plumbing", vendorId: "ven-1", created: "2026-03-12", estimatedCost: 280 },
  { id: "mnt-2", propertyId: "prop-1", unit: "Unit 7A", tenantId: "ten-2", issue: "HVAC not cooling properly", priority: "Medium", status: "Scheduled", vendor: "CoolAir Services", vendorId: "ven-2", created: "2026-03-14", estimatedCost: 450 },
  { id: "mnt-3", propertyId: "prop-2", unit: "Unit 2", tenantId: "ten-3", issue: "Garage door opener broken", priority: "Low", status: "Open", vendor: null, vendorId: null, created: "2026-03-15", estimatedCost: null },
  { id: "mnt-4", propertyId: "prop-1", unit: "Unit 12A", tenantId: "ten-5", issue: "Bathroom tile cracked", priority: "Low", status: "Completed", vendor: "Handy Repairs Co", vendorId: "ven-3", created: "2026-02-28", estimatedCost: 175 },
  { id: "mnt-5", propertyId: "prop-3", unit: "Unit 1A", tenantId: "ten-4", issue: "Smoke detector beeping", priority: "High", status: "Open", vendor: null, vendorId: null, created: "2026-03-16", estimatedCost: null },
];

// ─── Vendors ─────────────────────────────────────────────────────────────────

export const vendors = [
  { id: "ven-1", name: "ABC Plumbing", phone: "(512) 555-0700", email: "dispatch@abcplumbing.com", specialty: "Plumbing" },
  { id: "ven-2", name: "CoolAir Services", phone: "(512) 555-0800", email: "service@coolair.com", specialty: "HVAC" },
  { id: "ven-3", name: "Handy Repairs Co", phone: "(512) 555-0900", email: "jobs@handyrepairs.com", specialty: "General Maintenance" },
];

// ─── Owners ──────────────────────────────────────────────────────────────────

export const owners = [
  { id: "own-1", name: "Margaret Chen", email: "margaret.chen@email.com", phone: "(512) 555-1001", properties: ["prop-1", "prop-3"] },
  { id: "own-2", name: "David Park", email: "david.park@email.com", phone: "(512) 555-1002", properties: ["prop-2"] },
  { id: "own-3", name: "Realty Holdings LLC", email: "admin@realtyholdings.com", phone: "(512) 555-1003", properties: ["prop-4"] },
];

// ─── Owner Statements ────────────────────────────────────────────────────────

export const ownerStatements = [
  {
    id: "stmt-1", ownerId: "own-1", owner: "Margaret Chen", period: "February 2026",
    income: 8650, expenses: 3120, netIncome: 5530, managementFee: 865,
    items: [
      { desc: "Rent — 123 Spruce St (4 units collected)", amount: 5800, type: "income" },
      { desc: "Rent — 7 Pine Rd (2 units)", amount: 2400, type: "income" },
      { desc: "Late fee — Unit 4B", amount: 250, type: "income" },
      { desc: "Water/Sewer", amount: -890, type: "expense" },
      { desc: "Landscaping", amount: -350, type: "expense" },
      { desc: "Plumbing repair — Unit 4B", amount: -280, type: "expense" },
      { desc: "Insurance", amount: -735, type: "expense" },
      { desc: "Management fee (10%)", amount: -865, type: "expense" },
    ],
  },
  {
    id: "stmt-2", ownerId: "own-2", owner: "David Park", period: "February 2026",
    income: 5400, expenses: 1890, netIncome: 3510, managementFee: 540,
    items: [
      { desc: "Rent — 45 Oak Ave (3 units collected)", amount: 5400, type: "income" },
      { desc: "Property tax installment", amount: -950, type: "expense" },
      { desc: "Pest control", amount: -125, type: "expense" },
      { desc: "General maintenance", amount: -275, type: "expense" },
      { desc: "Management fee (10%)", amount: -540, type: "expense" },
    ],
  },
];

// ─── Lookup helpers ──────────────────────────────────────────────────────────
// REPLACE LATER: These become API calls.

export function getTenantById(id) { return tenants.find(t => t.id === id) ?? null; }
export function getPropertyById(id) { return properties.find(p => p.id === id) ?? null; }
export function getLeaseByTenantId(tid) { return leases.find(l => l.tenantId === tid) ?? null; }
export function getPaymentsForTenant(tid) { return payments.filter(p => p.tenantId === tid); }
export function getMaintenanceForProperty(pid) { return maintenance.filter(m => m.propertyId === pid); }
export function getVendorById(id) { return vendors.find(v => v.id === id) ?? null; }
export function getOwnerById(id) { return owners.find(o => o.id === id) ?? null; }
export function getStatementForOwner(oid) { return ownerStatements.find(s => s.ownerId === oid) ?? null; }

/** Get a "current tenant" relevant to a page context, for demo convenience. */
export function getDemoTenant(pageType) {
  const map = {
    lease_overview: "ten-2",
    lease_renewal: "ten-4",
    tenant_ledger: "ten-5",
    payment_entry: "ten-1",
    maintenance_request: "ten-1",
    work_order: "ten-2",
    owner_statement: null,
    reporting: null,
    inbox: "ten-3",
    dashboard: null,
  };
  return map[pageType] ? getTenantById(map[pageType]) : null;
}
