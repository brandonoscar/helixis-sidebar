/**
 * Helixis Browser Context — Base Software Adapter
 *
 * Defines the interface that software-specific adapters implement.
 * The context engine checks registered adapters against the current
 * hostname. If one matches, its methods run first with higher
 * confidence than the generic extractors.
 *
 * To add a new software adapter:
 *   1. Create a new file in this directory (e.g., appfolio-adapter.js)
 *   2. Export an object conforming to the SoftwareAdapter shape
 *   3. Register it in the adapter registry (adapter-registry.js)
 */

/**
 * @typedef {Object} SoftwareAdapter
 * @property {string} id              - Unique adapter identifier
 * @property {string} name            - Display name
 * @property {string[]} hostPatterns  - Hostname substrings to match
 * @property {(url: string, title: string) => import('../types.js').PageClassification | null} classify
 *   Software-specific page classification. Return null to fall through to generic.
 * @property {(pageType: string) => import('../types.js').EntityClues | null} extractEntities
 *   Software-specific entity extraction. Return null to fall through to generic.
 * @property {(url: string) => { type: string, id: string } | null} urlToEntityId
 *   Parse a software URL into an entity type and external ID.
 *   e.g., "/Rentals/Properties/Detail/12345" → { type: "property", id: "12345" }
 */

/**
 * No-op adapter. All methods return null (fall through to generic).
 * Extend or replace individual methods to customize.
 * @type {SoftwareAdapter}
 */
export const BASE_ADAPTER = {
  id: "base",
  name: "Generic",
  hostPatterns: [],

  classify(_url, _title) {
    return null;
  },

  extractEntities(_pageType) {
    return null;
  },

  urlToEntityId(_url) {
    return null;
  },
};
