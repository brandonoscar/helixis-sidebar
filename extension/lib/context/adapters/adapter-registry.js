/**
 * Helixis Browser Context — Adapter Registry
 *
 * Central registry for software-specific adapters.
 * The context engine queries this registry to find the right
 * adapter for the current hostname.
 *
 * To add a new adapter:
 *   1. Create the adapter file (e.g., appfolio-adapter.js)
 *   2. Import and register it here
 */

import { BuildiumAdapter } from "./buildium-adapter.js";

/**
 * All registered software adapters.
 * @type {import('./base-adapter.js').SoftwareAdapter[]}
 */
const ADAPTERS = [
  BuildiumAdapter,
  // Future: AppFolioAdapter, YardiAdapter, etc.
];

/**
 * Find the adapter that matches a given hostname.
 * Returns null if no adapter matches (use generic engine).
 *
 * @param {string} hostname
 * @returns {import('./base-adapter.js').SoftwareAdapter | null}
 */
export function findAdapter(hostname) {
  const lower = hostname.toLowerCase();
  for (const adapter of ADAPTERS) {
    for (const pattern of adapter.hostPatterns) {
      if (lower.includes(pattern)) return adapter;
    }
  }
  return null;
}

/**
 * List all registered adapter IDs (for debugging/display).
 * @returns {string[]}
 */
export function listAdapterIds() {
  return ADAPTERS.map((a) => a.id);
}
