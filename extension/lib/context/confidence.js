/**
 * Helixis Browser Context — Confidence Thresholds & Source Attribution
 *
 * Defines named confidence levels and filtering logic used by
 * the context engine, the AI formatter, and the panel display.
 *
 * Three tiers:
 *   HIGH   (≥0.75) — reliable enough for direct use in retrieval/AI
 *   MEDIUM (0.50–0.74) — include but flag as "possible"
 *   LOW    (<0.50) — debug only, excluded from AI context
 */

// ── Confidence Thresholds ─────────────────────────────

export const CONFIDENCE = {
  HIGH: 0.75,
  MEDIUM: 0.50,
  LOW: 0,
};

/**
 * Get the named confidence level for a score.
 * @param {number} score - 0.0 to 1.0
 * @returns {'high'|'medium'|'low'}
 */
export function confidenceLevel(score) {
  if (score >= CONFIDENCE.HIGH) return "high";
  if (score >= CONFIDENCE.MEDIUM) return "medium";
  return "low";
}

/**
 * Filter an array of items with a `.confidence` field by minimum threshold.
 * @template T
 * @param {T[]} items
 * @param {number} minConfidence
 * @returns {T[]}
 */
export function filterByConfidence(items, minConfidence = CONFIDENCE.MEDIUM) {
  if (!items) return [];
  return items.filter((item) => item.confidence >= minConfidence);
}

// ── Source Attribution ─────────────────────────────────

/**
 * All valid source types for extracted context.
 * Every IdentifierMatch and EntityClue should have one of these.
 */
export const SOURCES = [
  "url",         // from URL path or query params
  "title",       // from document.title
  "heading",     // from h1/h2/h3
  "breadcrumb",  // from breadcrumb nav
  "label",       // from label/dt elements
  "table",       // from table headers/cells
  "card",        // from card-like UI elements
  "nav",         // from navigation elements
  "text",        // from general page body text
  "selection",   // from user text selection
  "adapter",     // from a software-specific adapter
];

/**
 * Build a context-sources summary from a full BrowserContext.
 * Returns a flat list of which source types contributed data.
 *
 * @param {import('./types.js').BrowserContext} ctx
 * @returns {{ source: string, count: number }[]}
 */
export function summarizeSources(ctx) {
  const sourceCounts = new Map();

  function count(source) {
    sourceCounts.set(source, (sourceCounts.get(source) || 0) + 1);
  }

  // Classification method → source
  if (ctx.classification?.method) {
    count(ctx.classification.method);
  }

  // Entity clues
  for (const group of [ctx.entities?.properties, ctx.entities?.units, ctx.entities?.tenants]) {
    if (!group) continue;
    for (const clue of group) {
      if (clue.source) count(clue.source);
    }
  }

  // Selected text
  if (ctx.selectedText) count("selection");

  return Array.from(sourceCounts.entries())
    .map(([source, cnt]) => ({ source, count: cnt }))
    .sort((a, b) => b.count - a.count);
}
