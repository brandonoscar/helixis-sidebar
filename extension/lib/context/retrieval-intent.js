/**
 * Helixis Browser Context — Retrieval Intent Model
 *
 * Determines what backend data to fetch based on the browser context.
 * The intent is sent to the retrieval-orchestrator Edge Function,
 * which assembles the right combination of:
 *   - entity snapshots (tenant, property, unit, lease, etc.)
 *   - related tasks
 *   - business policies
 *   - AI context blocks
 *
 * The intent model is the bridge between "what page is the user on"
 * and "what data does the copilot need."
 */

import { CONFIDENCE, filterByConfidence } from "./confidence.js";

/**
 * @typedef {Object} RetrievalIntent
 * @property {string} pageType            - Classified page type
 * @property {string|null} software       - Detected software
 * @property {EntityHint[]} entityHints   - High-confidence entity clues for matching
 * @property {string[]} fetchTypes        - What entity types to fetch from backend
 * @property {boolean} fetchTasks         - Whether to include related tasks
 * @property {boolean} fetchPolicies      - Whether to include relevant policies
 * @property {string[]} policyCategories  - Which policy categories are relevant
 * @property {string} priority            - 'full'|'partial'|'minimal'
 */

/**
 * @typedef {Object} EntityHint
 * @property {string} type      - 'tenant'|'property'|'unit'|'lease'|etc.
 * @property {Object} fields    - Key-value fields for matching { name, email, id, address, number }
 */

/**
 * Page type → retrieval configuration.
 * Defines what to fetch for each page type.
 */
const RETRIEVAL_MAP = {
  tenant: {
    fetchTypes: ["tenant", "lease", "unit", "property"],
    fetchTasks: true,
    fetchPolicies: true,
    policyCategories: ["support", "legal"],
    priority: "full",
  },
  property: {
    fetchTypes: ["property", "unit", "tenant"],
    fetchTasks: true,
    fetchPolicies: true,
    policyCategories: ["operations"],
    priority: "full",
  },
  unit: {
    fetchTypes: ["unit", "property", "tenant", "lease"],
    fetchTasks: true,
    fetchPolicies: false,
    policyCategories: [],
    priority: "full",
  },
  lease: {
    fetchTypes: ["lease", "tenant", "unit", "property"],
    fetchTasks: true,
    fetchPolicies: true,
    policyCategories: ["legal"],
    priority: "full",
  },
  maintenance: {
    fetchTypes: ["maintenance_issue", "property", "unit", "tenant"],
    fetchTasks: true,
    fetchPolicies: true,
    policyCategories: ["operations", "support"],
    priority: "full",
  },
  accounting: {
    fetchTypes: ["payment", "tenant", "lease"],
    fetchTasks: true,
    fetchPolicies: true,
    policyCategories: ["legal"],
    priority: "full",
  },
  messages: {
    fetchTypes: ["tenant", "owner"],
    fetchTasks: false,
    fetchPolicies: true,
    policyCategories: ["support"],
    priority: "partial",
  },
  dashboard: {
    fetchTypes: [],
    fetchTasks: true,
    fetchPolicies: false,
    policyCategories: [],
    priority: "partial",
  },
  document: {
    fetchTypes: [],
    fetchTasks: false,
    fetchPolicies: false,
    policyCategories: [],
    priority: "minimal",
  },
  settings: {
    fetchTypes: [],
    fetchTasks: false,
    fetchPolicies: false,
    policyCategories: [],
    priority: "minimal",
  },
  report: {
    fetchTypes: [],
    fetchTasks: false,
    fetchPolicies: false,
    policyCategories: [],
    priority: "minimal",
  },
  contact: {
    fetchTypes: ["tenant", "owner"],
    fetchTasks: false,
    fetchPolicies: true,
    policyCategories: ["support"],
    priority: "partial",
  },
  search: {
    fetchTypes: [],
    fetchTasks: false,
    fetchPolicies: false,
    policyCategories: [],
    priority: "minimal",
  },
  login: {
    fetchTypes: [],
    fetchTasks: false,
    fetchPolicies: false,
    policyCategories: [],
    priority: "minimal",
  },
  unknown: {
    fetchTypes: [],
    fetchTasks: false,
    fetchPolicies: false,
    policyCategories: [],
    priority: "minimal",
  },
};

/**
 * Build a retrieval intent from a BrowserContext.
 * Filters entity clues by confidence threshold and maps page type
 * to the appropriate retrieval configuration.
 *
 * @param {import('./types.js').BrowserContext} ctx
 * @returns {RetrievalIntent}
 */
export function buildRetrievalIntent(ctx) {
  const pageType = ctx.classification?.pageType || "unknown";
  const config = RETRIEVAL_MAP[pageType] || RETRIEVAL_MAP.unknown;

  // Build entity hints from high-confidence entity clues
  const entityHints = [];

  // Property hints
  const properties = filterByConfidence(ctx.entities?.properties, CONFIDENCE.MEDIUM);
  if (properties.length > 0) {
    const fields = {};
    for (const clue of properties) {
      fields[clue.field] = clue.value;
    }
    entityHints.push({ type: "property", fields });
  }

  // Unit hints
  const units = filterByConfidence(ctx.entities?.units, CONFIDENCE.MEDIUM);
  if (units.length > 0) {
    const fields = {};
    for (const clue of units) {
      fields[clue.field] = clue.value;
    }
    entityHints.push({ type: "unit", fields });
  }

  // Tenant hints
  const tenants = filterByConfidence(ctx.entities?.tenants, CONFIDENCE.MEDIUM);
  if (tenants.length > 0) {
    const fields = {};
    for (const clue of tenants) {
      fields[clue.field] = clue.value;
    }
    entityHints.push({ type: "tenant", fields });
  }

  // Add identifier-based hints if no entity clues found
  if (entityHints.length === 0 && ctx.identifiers) {
    const ids = ctx.identifiers;
    if (ids.emails?.length > 0) {
      entityHints.push({
        type: "contact",
        fields: { email: ids.emails[0].normalized },
      });
    }
    if (ids.referenceIds?.length > 0) {
      entityHints.push({
        type: "reference",
        fields: { id: ids.referenceIds[0].normalized },
      });
    }
  }

  return {
    pageType,
    software: ctx.classification?.software || null,
    entityHints,
    fetchTypes: config.fetchTypes,
    fetchTasks: config.fetchTasks,
    fetchPolicies: config.fetchPolicies,
    policyCategories: config.policyCategories,
    priority: config.priority,
  };
}
