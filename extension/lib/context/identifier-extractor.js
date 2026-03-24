/**
 * Helixis Browser Context — Identifier Extractor
 *
 * Extracts structured identifiers from visible page text using regex heuristics.
 * Returns deduplicated, normalized results grouped by type.
 *
 * Design decisions:
 *   - Regex-first, no NLP dependencies (keeps extension lightweight)
 *   - Each extractor is a pure function: text → IdentifierMatch[]
 *   - Deduplication by normalized value (avoids repeats)
 *   - Confidence scoring reflects how reliable each pattern is
 *   - All extraction runs against a truncated text (max 15k chars)
 *     to avoid performance issues on huge pages
 */

/** @typedef {import('./types.js').IdentifierMatch} IdentifierMatch */
/** @typedef {import('./types.js').IdentifierSet} IdentifierSet */

const MAX_TEXT_LENGTH = 15_000;
const MAX_MATCHES_PER_TYPE = 15;

/**
 * Extract all identifier types from visible text.
 * @param {string} text - Visible page text
 * @returns {IdentifierSet}
 */
export function extractIdentifiers(text) {
  const t = text.slice(0, MAX_TEXT_LENGTH);

  return {
    emails: extractEmails(t),
    phones: extractPhones(t),
    addresses: extractAddresses(t),
    amounts: extractAmounts(t),
    dates: extractDates(t),
    referenceIds: extractReferenceIds(t),
    names: extractNames(t),
    unitNumbers: extractUnitNumbers(t),
  };
}

// ── Emails ────────────────────────────────────────────

/**
 * @param {string} text
 * @returns {IdentifierMatch[]}
 */
function extractEmails(text) {
  const regex = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
  return dedup(matchAll(text, regex, "email", 0.95));
}

// ── Phone Numbers ─────────────────────────────────────

/**
 * @param {string} text
 * @returns {IdentifierMatch[]}
 */
function extractPhones(text) {
  // US phone formats: (555) 123-4567, 555-123-4567, 555.123.4567, +1 555 123 4567
  const regex = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4}/g;
  const matches = matchAll(text, regex, "phone-us", 0.85);

  // Normalize to (XXX) XXX-XXXX
  return dedup(
    matches.map((m) => {
      const digits = m.raw.replace(/\D/g, "");
      const core = digits.length === 11 ? digits.slice(1) : digits;
      if (core.length === 10) {
        m.normalized = `(${core.slice(0, 3)}) ${core.slice(3, 6)}-${core.slice(6)}`;
      }
      return m;
    })
  );
}

// ── Addresses ─────────────────────────────────────────

/**
 * Extracts US street addresses. This is heuristic — captures common formats.
 * @param {string} text
 * @returns {IdentifierMatch[]}
 */
function extractAddresses(text) {
  // Pattern: number + street name + (optional suffix) + optional city/state/zip
  const streetRegex =
    /\d{1,5}\s+(?:[NSEW]\.?\s+)?(?:[A-Z][a-zA-Z]+\s+){1,3}(?:St(?:reet)?|Ave(?:nue)?|Blvd|Dr(?:ive)?|Ln|Lane|Rd|Road|Ct|Court|Pl(?:ace)?|Way|Pkwy|Cir(?:cle)?|Ter(?:race)?)\.?(?:\s*,?\s*(?:Apt|Suite|Ste|Unit|#)\s*[A-Za-z0-9\-]+)?/gi;

  const matches = matchAll(text, streetRegex, "street-address", 0.7);

  // Also try to find city/state/zip near addresses
  const cityStateZip =
    /(?:[A-Z][a-z]+(?:\s[A-Z][a-z]+)*),?\s+[A-Z]{2}\s+\d{5}(?:-\d{4})?/g;
  const cszMatches = matchAll(text, cityStateZip, "city-state-zip", 0.75);

  return dedup([...matches, ...cszMatches]);
}

// ── Dollar Amounts ────────────────────────────────────

/**
 * @param {string} text
 * @returns {IdentifierMatch[]}
 */
function extractAmounts(text) {
  // $1,234.56 or $1234 or $1,234
  const regex = /\$\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})?/g;
  const matches = matchAll(text, regex, "dollar", 0.9);

  return dedup(
    matches.map((m) => {
      // Normalize: remove spaces, keep $ and digits
      m.normalized = m.raw.replace(/\s/g, "");
      return m;
    })
  );
}

// ── Dates ─────────────────────────────────────────────

/**
 * @param {string} text
 * @returns {IdentifierMatch[]}
 */
function extractDates(text) {
  const results = [];

  // MM/DD/YYYY or MM-DD-YYYY
  const slashDates = /\b(?:0?[1-9]|1[0-2])[\/\-](?:0?[1-9]|[12]\d|3[01])[\/\-](?:19|20)\d{2}\b/g;
  results.push(...matchAll(text, slashDates, "date-mdy", 0.85));

  // Month DD, YYYY (e.g., "January 15, 2025")
  const longDates =
    /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},?\s+\d{4}\b/gi;
  results.push(...matchAll(text, longDates, "date-long", 0.9));

  return dedup(results);
}

// ── Reference IDs ─────────────────────────────────────

/**
 * Extracts structured reference numbers: lease IDs, work orders, tickets, etc.
 * @param {string} text
 * @returns {IdentifierMatch[]}
 */
function extractReferenceIds(text) {
  const results = [];

  // Patterns like "WO-12345", "TKT-001", "INV-2024-001", "LS-12345"
  const prefixedIds = /\b(?:WO|TKT|INV|LS|PMT|REF|ACT|ID|PO|SO|RMA)[-#]?\d{3,10}\b/gi;
  results.push(...matchAll(text, prefixedIds, "prefixed-id", 0.9));

  // "Ticket #12345", "Work Order #123", "Lease #456"
  const labeledIds =
    /\b(?:ticket|work\s*order|lease|invoice|order|request|case|account|reference|confirmation)\s*#?\s*(\d{3,10})\b/gi;
  let match;
  while ((match = labeledIds.exec(text)) !== null) {
    results.push({
      raw: match[0].trim(),
      normalized: match[1],
      type: "labeled-id",
      confidence: 0.85,
    });
  }

  // Standalone # references: "#12345" (common in PM software)
  const hashIds = /(?<=\s|^)#\d{4,10}\b/g;
  results.push(...matchAll(text, hashIds, "hash-id", 0.6));

  return dedup(results);
}

// ── Person Names ──────────────────────────────────────

/**
 * Extracts likely person names. This is the least reliable extractor —
 * we use conservative patterns and lower confidence.
 * @param {string} text
 * @returns {IdentifierMatch[]}
 */
function extractNames(text) {
  const results = [];

  // Look for names near PM-specific labels
  const labeledNameRegex =
    /(?:tenant|resident|owner|contact|assigned\s*to|reported\s*by|manager|lessee|occupant)\s*:?\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})/g;

  let match;
  while ((match = labeledNameRegex.exec(text)) !== null) {
    results.push({
      raw: match[1].trim(),
      normalized: match[1].trim(),
      type: "labeled-name",
      confidence: 0.75,
    });
  }

  return dedup(results).slice(0, MAX_MATCHES_PER_TYPE);
}

// ── Unit Numbers ──────────────────────────────────────

/**
 * @param {string} text
 * @returns {IdentifierMatch[]}
 */
function extractUnitNumbers(text) {
  const results = [];

  // "Unit 4B", "Apt 201", "Suite 100", "#3A"
  const unitRegex =
    /\b(?:unit|apt\.?|apartment|suite|ste\.?|room|rm\.?)\s*#?\s*([A-Za-z0-9\-]{1,8})\b/gi;

  let match;
  while ((match = unitRegex.exec(text)) !== null) {
    results.push({
      raw: match[0].trim(),
      normalized: match[1].toUpperCase(),
      type: "unit-number",
      confidence: 0.85,
    });
  }

  return dedup(results);
}

// ── Helpers ───────────────────────────────────────────

/**
 * Run a regex against text and return IdentifierMatch objects.
 * @param {string} text
 * @param {RegExp} regex
 * @param {string} type
 * @param {number} confidence
 * @returns {IdentifierMatch[]}
 */
function matchAll(text, regex, type, confidence) {
  const results = [];
  let match;
  let count = 0;
  while ((match = regex.exec(text)) !== null && count < MAX_MATCHES_PER_TYPE) {
    const raw = match[0].trim();
    if (raw.length > 0) {
      results.push({
        raw,
        normalized: raw,
        type,
        confidence,
      });
      count++;
    }
  }
  return results;
}

/**
 * Deduplicate matches by normalized value.
 * Keeps the highest-confidence match for each unique value.
 * @param {IdentifierMatch[]} matches
 * @returns {IdentifierMatch[]}
 */
function dedup(matches) {
  const seen = new Map();
  for (const m of matches) {
    const key = m.normalized.toLowerCase();
    const existing = seen.get(key);
    if (!existing || m.confidence > existing.confidence) {
      seen.set(key, m);
    }
  }
  return [...seen.values()].slice(0, MAX_MATCHES_PER_TYPE);
}
