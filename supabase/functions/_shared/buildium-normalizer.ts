/**
 * Buildium Normalization Layer
 *
 * Maps Buildium webhook payloads and API entities into the Helixis
 * normalised entity_snapshots format. Buildium-first, but the
 * NormalisedEntity interface is provider-agnostic.
 */

// ── Helixis normalised entity shape ──────────────────────────

export interface NormalisedEntity {
  entityType: EntityType;
  externalId: string;
  provider: "buildium";
  displayName: string;
  data: Record<string, unknown>;
  rawData: Record<string, unknown>;
}

export type EntityType =
  | "property"
  | "unit"
  | "tenant"
  | "lease"
  | "maintenance_request"
  | "vendor"
  | "owner";

// ── Buildium event type → Helixis entity type mapping ────────

const EVENT_ENTITY_MAP: Record<string, EntityType> = {
  "Rental.Created": "property",
  "Rental.Updated": "property",
  "RentalUnit.Created": "unit",
  "RentalUnit.Updated": "unit",
  "Tenant.Created": "tenant",
  "Tenant.Updated": "tenant",
  "Tenant.MoveIn": "tenant",
  "Tenant.MoveOut": "tenant",
  "Lease.Created": "lease",
  "Lease.Updated": "lease",
  "Lease.Renewed": "lease",
  "WorkOrder.Created": "maintenance_request",
  "WorkOrder.Updated": "maintenance_request",
  "WorkOrder.Completed": "maintenance_request",
  "Vendor.Created": "vendor",
  "Vendor.Updated": "vendor",
  "RentalOwner.Created": "owner",
  "RentalOwner.Updated": "owner",
};

// ── Entity normalisers ───────────────────────────────────────

function normaliseProperty(raw: Record<string, unknown>): Omit<NormalisedEntity, "rawData"> {
  return {
    entityType: "property",
    externalId: String(raw.Id ?? raw.PropertyId ?? ""),
    provider: "buildium",
    displayName: String(raw.Name ?? raw.PropertyName ?? "Unknown Property"),
    data: {
      name: raw.Name ?? raw.PropertyName,
      address: raw.Address ?? null,
      type: raw.PropertyType ?? raw.Type ?? null,
      units: raw.NumberOfUnits ?? null,
      isActive: raw.IsActive ?? true,
    },
  };
}

function normaliseUnit(raw: Record<string, unknown>): Omit<NormalisedEntity, "rawData"> {
  return {
    entityType: "unit",
    externalId: String(raw.Id ?? raw.UnitId ?? ""),
    provider: "buildium",
    displayName: String(raw.UnitNumber ?? raw.Name ?? "Unknown Unit"),
    data: {
      unitNumber: raw.UnitNumber ?? raw.Name,
      propertyId: raw.PropertyId ? String(raw.PropertyId) : null,
      bedrooms: raw.Bedrooms ?? null,
      bathrooms: raw.Bathrooms ?? null,
      sqft: raw.SquareFeet ?? null,
      marketRent: raw.MarketRent ?? null,
      isOccupied: raw.IsOccupied ?? null,
    },
  };
}

function normaliseTenant(raw: Record<string, unknown>): Omit<NormalisedEntity, "rawData"> {
  const firstName = String(raw.FirstName ?? "");
  const lastName = String(raw.LastName ?? "");
  return {
    entityType: "tenant",
    externalId: String(raw.Id ?? raw.TenantId ?? ""),
    provider: "buildium",
    displayName: `${firstName} ${lastName}`.trim() || "Unknown Tenant",
    data: {
      firstName,
      lastName,
      email: raw.Email ?? null,
      phone: raw.PhoneNumbers?.[0]?.PhoneNumber ?? raw.Phone ?? null,
      leaseId: raw.LeaseId ? String(raw.LeaseId) : null,
      status: raw.Status ?? raw.TenantStatus ?? null,
    },
  };
}

function normaliseLease(raw: Record<string, unknown>): Omit<NormalisedEntity, "rawData"> {
  return {
    entityType: "lease",
    externalId: String(raw.Id ?? raw.LeaseId ?? ""),
    provider: "buildium",
    displayName: `Lease #${raw.Id ?? raw.LeaseId ?? "?"}`,
    data: {
      propertyId: raw.PropertyId ? String(raw.PropertyId) : null,
      unitId: raw.UnitId ? String(raw.UnitId) : null,
      tenantIds: Array.isArray(raw.TenantIds) ? raw.TenantIds.map(String) : [],
      startDate: raw.LeaseFromDate ?? raw.StartDate ?? null,
      endDate: raw.LeaseToDate ?? raw.EndDate ?? null,
      rent: raw.Rent ?? raw.MonthlyRent ?? null,
      status: raw.LeaseStatus ?? raw.Status ?? null,
      type: raw.LeaseType ?? raw.Type ?? null,
    },
  };
}

function normaliseMaintenanceRequest(raw: Record<string, unknown>): Omit<NormalisedEntity, "rawData"> {
  return {
    entityType: "maintenance_request",
    externalId: String(raw.Id ?? raw.WorkOrderId ?? ""),
    provider: "buildium",
    displayName: String(raw.Title ?? raw.Subject ?? `Work Order #${raw.Id ?? "?"}`),
    data: {
      title: raw.Title ?? raw.Subject ?? null,
      description: raw.Description ?? null,
      propertyId: raw.PropertyId ? String(raw.PropertyId) : null,
      unitId: raw.UnitId ? String(raw.UnitId) : null,
      tenantId: raw.TenantId ? String(raw.TenantId) : null,
      priority: raw.Priority ?? null,
      status: raw.Status ?? raw.TaskStatus ?? null,
      category: raw.Category ?? null,
      assignedTo: raw.AssignedTo ?? null,
      requestedDate: raw.RequestedDate ?? raw.CreatedDate ?? null,
      completedDate: raw.CompletedDate ?? null,
    },
  };
}

function normaliseVendor(raw: Record<string, unknown>): Omit<NormalisedEntity, "rawData"> {
  return {
    entityType: "vendor",
    externalId: String(raw.Id ?? raw.VendorId ?? ""),
    provider: "buildium",
    displayName: String(raw.CompanyName ?? raw.Name ?? "Unknown Vendor"),
    data: {
      companyName: raw.CompanyName ?? raw.Name ?? null,
      email: raw.Email ?? null,
      phone: raw.Phone ?? null,
      category: raw.Category ?? null,
      isActive: raw.IsActive ?? true,
    },
  };
}

function normaliseOwner(raw: Record<string, unknown>): Omit<NormalisedEntity, "rawData"> {
  const firstName = String(raw.FirstName ?? "");
  const lastName = String(raw.LastName ?? "");
  return {
    entityType: "owner",
    externalId: String(raw.Id ?? raw.RentalOwnerId ?? ""),
    provider: "buildium",
    displayName: `${firstName} ${lastName}`.trim() || "Unknown Owner",
    data: {
      firstName,
      lastName,
      email: raw.Email ?? null,
      phone: raw.Phone ?? null,
    },
  };
}

const NORMALISERS: Record<EntityType, (raw: Record<string, unknown>) => Omit<NormalisedEntity, "rawData">> = {
  property: normaliseProperty,
  unit: normaliseUnit,
  tenant: normaliseTenant,
  lease: normaliseLease,
  maintenance_request: normaliseMaintenanceRequest,
  vendor: normaliseVendor,
  owner: normaliseOwner,
};

// ── Public API ───────────────────────────────────────────────

/**
 * Given a Buildium event type, return the Helixis entity type it maps to,
 * or null if unrecognised.
 */
export function resolveEntityType(eventType: string): EntityType | null {
  return EVENT_ENTITY_MAP[eventType] ?? null;
}

/**
 * Normalise a raw Buildium entity payload into the Helixis format.
 * Returns null if the entity type has no normaliser.
 */
export function normaliseBuildiumEntity(
  entityType: EntityType,
  rawPayload: Record<string, unknown>
): NormalisedEntity | null {
  const normaliser = NORMALISERS[entityType];
  if (!normaliser) return null;

  const entity = normaliser(rawPayload);
  if (!entity.externalId) return null;

  return { ...entity, rawData: rawPayload };
}

/**
 * Extract related entity references from a Buildium payload.
 * E.g. a work order payload contains PropertyId, UnitId, TenantId →
 * we return them so the task engine can link related entities.
 */
export function extractRelatedEntityIds(
  payload: Record<string, unknown>
): Array<{ entityType: EntityType; externalId: string }> {
  const related: Array<{ entityType: EntityType; externalId: string }> = [];

  const mappings: Array<{ key: string; type: EntityType }> = [
    { key: "PropertyId", type: "property" },
    { key: "UnitId", type: "unit" },
    { key: "TenantId", type: "tenant" },
    { key: "LeaseId", type: "lease" },
    { key: "VendorId", type: "vendor" },
    { key: "RentalOwnerId", type: "owner" },
  ];

  for (const { key, type } of mappings) {
    const val = payload[key];
    if (val != null && val !== "" && val !== 0) {
      related.push({ entityType: type, externalId: String(val) });
    }
  }

  // TenantIds array (common on lease payloads)
  if (Array.isArray(payload.TenantIds)) {
    for (const tid of payload.TenantIds) {
      if (tid != null) {
        related.push({ entityType: "tenant", externalId: String(tid) });
      }
    }
  }

  return related;
}
