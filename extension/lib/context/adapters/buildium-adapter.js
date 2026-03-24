/**
 * Helixis Browser Context — Buildium Software Adapter
 *
 * Buildium-specific page classification and entity extraction.
 * Buildium URLs follow predictable patterns:
 *   /Rentals/Properties/Detail/{id}
 *   /Rentals/Units/Detail/{id}
 *   /Rentals/Tenants/Detail/{id}
 *   /Rentals/Leases/Detail/{id}
 *   /Maintenance/WorkOrders/Detail/{id}
 *   /Accounting/...
 *   /Messages/...
 *   etc.
 *
 * This adapter runs before the generic classifier when the hostname
 * matches "buildium.com". Its results get a confidence boost.
 */

/**
 * @type {import('./base-adapter.js').SoftwareAdapter}
 */
export const BuildiumAdapter = {
  id: "buildium",
  name: "Buildium",
  hostPatterns: ["buildium.com"],

  /**
   * Classify a Buildium page from its URL.
   * Buildium has very consistent URL patterns.
   */
  classify(url, title) {
    let pathname = "";
    try { pathname = new URL(url).pathname; } catch { return null; }

    const lower = pathname.toLowerCase();

    for (const rule of BUILDIUM_URL_RULES) {
      if (rule.regex.test(lower)) {
        return {
          pageType: rule.type,
          confidence: 0.95, // High confidence — Buildium URLs are very predictable
          method: "adapter",
          software: "buildium",
          signals: [`Buildium URL: ${rule.label}`],
        };
      }
    }

    return null; // Fall through to generic
  },

  /**
   * Extract entities from the DOM using Buildium-specific selectors.
   * Buildium uses consistent CSS classes and page structure.
   */
  extractEntities(pageType) {
    const clues = { properties: [], units: [], tenants: [] };

    // Buildium detail pages typically show the entity name in a specific header
    const detailHeader =
      document.querySelector(".detail-header h1, .page-header h1, [class*='detail'] h1") ||
      document.querySelector("h1");

    if (detailHeader) {
      const name = detailHeader.textContent.trim();
      if (name.length > 1 && name.length < 100) {
        switch (pageType) {
          case "property":
            clues.properties.push({
              value: name, field: "name", confidence: 0.9, source: "adapter",
            });
            break;
          case "unit":
            clues.units.push({
              value: name, field: "number", confidence: 0.9, source: "adapter",
            });
            break;
          case "tenant":
            clues.tenants.push({
              value: name, field: "name", confidence: 0.9, source: "adapter",
            });
            break;
        }
      }
    }

    // Buildium sidebar/detail panels often have structured info
    const detailRows = document.querySelectorAll(
      ".detail-row, .info-row, [class*='detail-info'] .row, dl dt"
    );
    for (const row of detailRows) {
      const label = (row.textContent || "").trim().toLowerCase();
      const valueEl = row.nextElementSibling;
      if (!valueEl) continue;
      const value = valueEl.textContent.trim();
      if (!value || value.length > 200) continue;

      if (label.includes("property")) {
        clues.properties.push({
          value, field: "name", confidence: 0.85, source: "adapter",
        });
      } else if (label.includes("unit") || label.includes("apartment")) {
        clues.units.push({
          value, field: "number", confidence: 0.85, source: "adapter",
        });
      } else if (label.includes("tenant") || label.includes("resident")) {
        clues.tenants.push({
          value, field: "name", confidence: 0.85, source: "adapter",
        });
      } else if (label.includes("address")) {
        clues.properties.push({
          value, field: "address", confidence: 0.8, source: "adapter",
        });
      } else if (label.includes("email")) {
        clues.tenants.push({
          value, field: "email", confidence: 0.8, source: "adapter",
        });
      } else if (label.includes("phone")) {
        clues.tenants.push({
          value, field: "phone", confidence: 0.75, source: "adapter",
        });
      }

      if (clues.properties.length + clues.units.length + clues.tenants.length >= 10) break;
    }

    // Only return if we found something adapter-specific
    const total = clues.properties.length + clues.units.length + clues.tenants.length;
    return total > 0 ? clues : null;
  },

  /**
   * Parse a Buildium URL into an entity type and Buildium ID.
   * These IDs can be used to match against entity_snapshots.
   */
  urlToEntityId(url) {
    let pathname = "";
    try { pathname = new URL(url).pathname; } catch { return null; }

    for (const rule of BUILDIUM_ENTITY_URL_RULES) {
      const match = pathname.match(rule.regex);
      if (match) {
        return { type: rule.type, id: match[1] };
      }
    }

    return null;
  },
};

// ── Buildium URL Classification Rules ─────────────────

const BUILDIUM_URL_RULES = [
  // Property management
  { regex: /\/rentals\/properties\/detail/i, type: "property", label: "Property detail" },
  { regex: /\/rentals\/properties/i,         type: "property", label: "Properties list" },
  { regex: /\/rentals\/units\/detail/i,      type: "unit",     label: "Unit detail" },
  { regex: /\/rentals\/units/i,              type: "unit",     label: "Units list" },
  { regex: /\/rentals\/tenants\/detail/i,    type: "tenant",   label: "Tenant detail" },
  { regex: /\/rentals\/tenants/i,            type: "tenant",   label: "Tenants list" },
  { regex: /\/rentals\/leases\/detail/i,     type: "lease",    label: "Lease detail" },
  { regex: /\/rentals\/leases/i,             type: "lease",    label: "Leases list" },
  // Maintenance
  { regex: /\/maintenance\/workorders\/detail/i, type: "maintenance", label: "Work order detail" },
  { regex: /\/maintenance\/workorders/i,     type: "maintenance", label: "Work orders list" },
  { regex: /\/maintenance/i,                 type: "maintenance", label: "Maintenance" },
  // Accounting
  { regex: /\/accounting\/payments/i,        type: "accounting", label: "Payments" },
  { regex: /\/accounting\/invoices/i,        type: "accounting", label: "Invoices" },
  { regex: /\/accounting\/ledger/i,          type: "accounting", label: "Ledger" },
  { regex: /\/accounting/i,                  type: "accounting", label: "Accounting" },
  // Communication
  { regex: /\/messages/i,                    type: "messages",   label: "Messages" },
  // Documents
  { regex: /\/documents/i,                   type: "document",   label: "Documents" },
  // Reports
  { regex: /\/reports/i,                     type: "report",     label: "Reports" },
  // Settings
  { regex: /\/settings/i,                    type: "settings",   label: "Settings" },
  // Dashboard
  { regex: /\/dashboard|\/home|\/$|^\/$/i,   type: "dashboard",  label: "Dashboard" },
];

// ── Buildium Entity URL Parsing Rules ─────────────────

const BUILDIUM_ENTITY_URL_RULES = [
  { regex: /\/rentals\/properties\/detail\/(\d+)/i,      type: "property" },
  { regex: /\/rentals\/units\/detail\/(\d+)/i,           type: "unit" },
  { regex: /\/rentals\/tenants\/detail\/(\d+)/i,         type: "tenant" },
  { regex: /\/rentals\/leases\/detail\/(\d+)/i,          type: "lease" },
  { regex: /\/maintenance\/workorders\/detail\/(\d+)/i,  type: "maintenance_issue" },
];
