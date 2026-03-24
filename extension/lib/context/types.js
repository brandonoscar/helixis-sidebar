/**
 * Helixis Browser Context — Data Model & Type Definitions
 *
 * Architecture decision: Plain JS with JSDoc types rather than TypeScript,
 * since the extension has no build step. This keeps deployment simple
 * (just load files) while still providing IDE intellisense.
 *
 * The payload is structured into four layers:
 *   1. Raw page data    — URL, title, visible text (what the browser sees)
 *   2. Classification   — page type with confidence (what kind of page is this)
 *   3. Identifiers      — extracted structured data (emails, phones, IDs, amounts)
 *   4. Entity clues     — property-management inferences (tenant, property, unit)
 *
 * This separation means the backend/AI can use each layer independently:
 *   - Raw data for general page context
 *   - Classification for routing/retrieval decisions
 *   - Identifiers for data matching
 *   - Entity clues for property-management-specific reasoning
 */

/**
 * @typedef {Object} BrowserContext
 * @property {string} captureId          - Unique ID for this capture
 * @property {number} tabId              - Chrome tab ID
 * @property {RawPageData} raw           - Unprocessed page data
 * @property {PageClassification} classification - Page type + confidence
 * @property {string} selectedText       - User-highlighted text (empty string if none)
 * @property {string} visibleTextSummary - Prioritized visible text (truncated)
 * @property {IdentifierSet} identifiers - Extracted structured identifiers
 * @property {EntityClues} entities      - Property-management entity inferences
 * @property {number} timestamp          - Unix ms when captured
 * @property {number} captureMs          - How long the capture took
 */

/**
 * @typedef {Object} RawPageData
 * @property {string} url
 * @property {string} hostname
 * @property {string} pathname
 * @property {string} pageTitle
 * @property {string} domain           - Top-level domain for software detection
 */

/**
 * @typedef {Object} PageClassification
 * @property {string} pageType         - One of PAGE_TYPES
 * @property {number} confidence       - 0.0–1.0
 * @property {string} method           - How it was classified: 'url'|'title'|'dom'|'keyword'|'fallback'
 * @property {string|null} software    - Detected software: 'buildium'|'appfolio'|'gmail'|etc.|null
 * @property {string[]} signals        - Human-readable reasons for classification
 */

/**
 * @typedef {Object} IdentifierSet
 * @property {IdentifierMatch[]} emails
 * @property {IdentifierMatch[]} phones
 * @property {IdentifierMatch[]} addresses
 * @property {IdentifierMatch[]} amounts       - Dollar amounts
 * @property {IdentifierMatch[]} dates
 * @property {IdentifierMatch[]} referenceIds  - Lease IDs, ticket #s, work order #s, account IDs
 * @property {IdentifierMatch[]} names         - Likely person names
 * @property {IdentifierMatch[]} unitNumbers   - Unit/apt/suite numbers
 */

/**
 * @typedef {Object} IdentifierMatch
 * @property {string} raw              - Exact text as found on page
 * @property {string} normalized       - Cleaned/formatted version
 * @property {string} type             - Subcategory (e.g., 'email', 'phone-us', 'dollar', 'lease-id')
 * @property {number} confidence       - 0.0–1.0
 */

/**
 * @typedef {Object} EntityClues
 * @property {EntityClue[]} properties
 * @property {EntityClue[]} units
 * @property {EntityClue[]} tenants
 */

/**
 * @typedef {Object} EntityClue
 * @property {string} value            - The detected value
 * @property {string} field            - What field this likely is: 'name'|'address'|'email'|'phone'|'id'|'number'
 * @property {number} confidence       - 0.0–1.0
 * @property {string} source           - Where it came from: 'heading'|'label'|'breadcrumb'|'url'|'title'|'text'
 */

// ── Page Types ────────────────────────────────────────

export const PAGE_TYPES = [
  "dashboard",
  "property",
  "unit",
  "tenant",
  "lease",
  "maintenance",
  "messages",
  "document",
  "settings",
  "accounting",
  "contact",
  "report",
  "search",
  "login",
  "unknown",
];

// ── Factory ───────────────────────────────────────────

/**
 * Creates an empty BrowserContext with defaults.
 * Each module fills in its section.
 * @param {number} tabId
 * @param {string} url
 * @returns {BrowserContext}
 */
export function createEmptyContext(tabId, url) {
  let hostname = "";
  let pathname = "";
  let domain = "";
  try {
    const u = new URL(url);
    hostname = u.hostname;
    pathname = u.pathname;
    // Extract domain: "app.buildium.com" → "buildium.com"
    const parts = hostname.split(".");
    domain = parts.length >= 2 ? parts.slice(-2).join(".") : hostname;
  } catch {
    // Invalid URL — leave empty
  }

  return {
    captureId: crypto.randomUUID(),
    tabId,
    raw: {
      url,
      hostname,
      pathname,
      pageTitle: "",
      domain,
    },
    classification: {
      pageType: "unknown",
      confidence: 0,
      method: "fallback",
      software: null,
      signals: [],
    },
    selectedText: "",
    visibleTextSummary: "",
    identifiers: {
      emails: [],
      phones: [],
      addresses: [],
      amounts: [],
      dates: [],
      referenceIds: [],
      names: [],
      unitNumbers: [],
    },
    entities: {
      properties: [],
      units: [],
      tenants: [],
    },
    timestamp: Date.now(),
    captureMs: 0,
  };
}
