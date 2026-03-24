/**
 * Helixis Browser Context — Entity Extractor
 *
 * Infers property-management entities (properties, units, tenants) from
 * the page using a combination of:
 *   - DOM structure (headings, labels, breadcrumbs)
 *   - Already-extracted identifiers
 *   - Page classification context
 *   - Keyword proximity heuristics
 *
 * This is a best-effort inference layer. It uses confidence scoring
 * to signal uncertainty — the AI should treat low-confidence clues
 * as "possible" rather than "definite."
 *
 * Runs inside the content script (has DOM access).
 */

/** @typedef {import('./types.js').EntityClue} EntityClue */
/** @typedef {import('./types.js').EntityClues} EntityClues */
/** @typedef {import('./types.js').IdentifierSet} IdentifierSet */

/**
 * Extract property, unit, and tenant entity clues from the page.
 *
 * @param {string} pageType - Classified page type
 * @param {IdentifierSet} identifiers - Already-extracted identifiers
 * @returns {EntityClues}
 */
export function extractEntities(pageType, identifiers) {
  return {
    properties: extractPropertyClues(pageType, identifiers),
    units: extractUnitClues(pageType, identifiers),
    tenants: extractTenantClues(pageType, identifiers),
  };
}

// ── Property Clues ────────────────────────────────────

/**
 * @param {string} pageType
 * @param {IdentifierSet} identifiers
 * @returns {EntityClue[]}
 */
function extractPropertyClues(pageType, identifiers) {
  const clues = [];

  // 1. Check heading for property name on property-type pages
  if (pageType === "property" || pageType === "unit" || pageType === "dashboard") {
    const h1 = document.querySelector("h1");
    if (h1) {
      const text = h1.textContent.trim();
      // If the heading looks like a property name (not a generic label)
      if (text.length > 2 && text.length < 100 && !isGenericHeading(text)) {
        clues.push({
          value: text,
          field: "name",
          confidence: pageType === "property" ? 0.8 : 0.5,
          source: "heading",
        });
      }
    }
  }

  // 2. Breadcrumb property names
  const breadcrumbClues = extractFromBreadcrumbs("property");
  clues.push(...breadcrumbClues);

  // 3. Labeled property names from DOM
  const labeledClues = extractFromLabels([
    "property", "property name", "building", "community", "complex",
  ], "name");
  clues.push(...labeledClues.map((c) => ({ ...c, confidence: c.confidence * 0.9 })));

  // 4. Street addresses from identifiers → property address clues
  for (const addr of identifiers.addresses.slice(0, 3)) {
    clues.push({
      value: addr.normalized,
      field: "address",
      confidence: addr.confidence * 0.7,
      source: "text",
    });
  }

  return dedupClues(clues);
}

// ── Unit Clues ────────────────────────────────────────

/**
 * @param {string} pageType
 * @param {IdentifierSet} identifiers
 * @returns {EntityClue[]}
 */
function extractUnitClues(pageType, identifiers) {
  const clues = [];

  // 1. From already-extracted unit numbers
  for (const unit of identifiers.unitNumbers) {
    clues.push({
      value: unit.normalized,
      field: "number",
      confidence: unit.confidence,
      source: "text",
    });
  }

  // 2. On unit pages, the heading is likely the unit
  if (pageType === "unit") {
    const h1 = document.querySelector("h1");
    if (h1) {
      const text = h1.textContent.trim();
      if (text.length < 30) {
        clues.push({
          value: text,
          field: "number",
          confidence: 0.75,
          source: "heading",
        });
      }
    }
  }

  // 3. Labeled unit values from DOM
  const labeledClues = extractFromLabels([
    "unit", "unit number", "apt", "apartment", "suite",
  ], "number");
  clues.push(...labeledClues);

  // 4. Bed/bath info as supplementary unit data
  const bedBathRegex =
    /(\d+)\s*(?:bed(?:room)?s?|br)\s*[\/,|]\s*(\d+(?:\.\d)?)\s*(?:bath(?:room)?s?|ba)/gi;
  const bodyText = (document.body?.innerText ?? "").slice(0, 5000);
  let match;
  while ((match = bedBathRegex.exec(bodyText)) !== null) {
    clues.push({
      value: `${match[1]}BR/${match[2]}BA`,
      field: "layout",
      confidence: 0.7,
      source: "text",
    });
    break; // Only take the first one
  }

  return dedupClues(clues);
}

// ── Tenant Clues ──────────────────────────────────────

/**
 * @param {string} pageType
 * @param {IdentifierSet} identifiers
 * @returns {EntityClue[]}
 */
function extractTenantClues(pageType, identifiers) {
  const clues = [];

  // 1. Labeled names from identifiers (highest signal — already context-tagged)
  for (const name of identifiers.names) {
    clues.push({
      value: name.normalized,
      field: "name",
      confidence: name.confidence,
      source: "text",
    });
  }

  // 2. On tenant pages, the heading is likely the tenant name
  if (pageType === "tenant") {
    const h1 = document.querySelector("h1");
    if (h1) {
      const text = h1.textContent.trim();
      if (looksLikePersonName(text)) {
        clues.push({
          value: text,
          field: "name",
          confidence: 0.8,
          source: "heading",
        });
      }
    }
  }

  // 3. Labeled tenant values from DOM
  const labeledClues = extractFromLabels([
    "tenant", "resident", "lessee", "occupant", "renter", "contact name",
  ], "name");
  for (const c of labeledClues) {
    if (looksLikePersonName(c.value)) {
      clues.push(c);
    }
  }

  // 4. Email addresses near tenant context → tenant email
  //    (Only on tenant/lease/maintenance pages where email likely belongs to a tenant)
  if (["tenant", "lease", "maintenance"].includes(pageType)) {
    for (const email of identifiers.emails.slice(0, 2)) {
      clues.push({
        value: email.normalized,
        field: "email",
        confidence: 0.6,
        source: "text",
      });
    }

    for (const phone of identifiers.phones.slice(0, 2)) {
      clues.push({
        value: phone.normalized,
        field: "phone",
        confidence: 0.55,
        source: "text",
      });
    }
  }

  return dedupClues(clues);
}

// ── DOM Helpers ───────────────────────────────────────

/**
 * Extract values from labeled DOM elements.
 * Looks for patterns like:
 *   <label>Property Name</label><span>Sunset Apartments</span>
 *   <dt>Tenant</dt><dd>John Smith</dd>
 *   <div class="label">Unit</div><div class="value">4B</div>
 *
 * @param {string[]} labelKeywords - Keywords to match in labels
 * @param {string} field - Entity field name
 * @returns {EntityClue[]}
 */
function extractFromLabels(labelKeywords, field) {
  const clues = [];

  // Strategy 1: label + next sibling
  const labels = document.querySelectorAll("label, dt, th, [class*='label']");
  for (const label of labels) {
    const labelText = label.textContent.trim().toLowerCase();
    const matches = labelKeywords.some((kw) => labelText.includes(kw));
    if (!matches) continue;

    // Look for value in adjacent element
    const valueEl =
      label.nextElementSibling ||
      (label.tagName === "DT" ? label.nextElementSibling : null);

    if (valueEl) {
      const value = valueEl.textContent.trim();
      if (value.length > 0 && value.length < 200) {
        clues.push({
          value,
          field,
          confidence: 0.7,
          source: "label",
        });
      }
    }

    // Strategy 2: label is inside a container with a value sibling
    const parent = label.parentElement;
    if (parent) {
      const valueChild = parent.querySelector(
        "[class*='value'], [class*='data'], span, dd, td"
      );
      if (valueChild && valueChild !== label) {
        const value = valueChild.textContent.trim();
        if (value.length > 0 && value.length < 200) {
          clues.push({
            value,
            field,
            confidence: 0.65,
            source: "label",
          });
        }
      }
    }

    if (clues.length >= 3) break; // Don't over-extract
  }

  return clues;
}

/**
 * Extract entity names from breadcrumb navigation.
 * Breadcrumbs often contain: Home > Properties > Sunset Apartments > Unit 4B
 *
 * @param {string} entityType - 'property'|'unit'|'tenant'
 * @returns {EntityClue[]}
 */
function extractFromBreadcrumbs(entityType) {
  const clues = [];
  const breadcrumb = document.querySelector(
    '[class*="breadcrumb"], [aria-label="breadcrumb"], nav[class*="bread"]'
  );
  if (!breadcrumb) return clues;

  const items = breadcrumb.querySelectorAll("a, span, li");
  const texts = Array.from(items)
    .map((el) => el.textContent.trim())
    .filter((t) => t.length > 1 && t.length < 80);

  // In property breadcrumbs, the property name typically follows
  // a "Properties" link
  const entityKeywords = {
    property: ["properties", "buildings", "communities"],
    unit: ["units", "apartments"],
    tenant: ["tenants", "residents"],
  };

  const keywords = entityKeywords[entityType] || [];
  for (let i = 0; i < texts.length - 1; i++) {
    if (keywords.some((kw) => texts[i].toLowerCase().includes(kw))) {
      const nextText = texts[i + 1];
      if (nextText && !isGenericHeading(nextText)) {
        clues.push({
          value: nextText,
          field: "name",
          confidence: 0.75,
          source: "breadcrumb",
        });
      }
    }
  }

  return clues;
}

// ── Utility ───────────────────────────────────────────

/**
 * Check if text looks like a generic page heading rather than an entity name.
 */
function isGenericHeading(text) {
  const lower = text.toLowerCase();
  const generics = [
    "dashboard", "overview", "properties", "units", "tenants", "residents",
    "maintenance", "messages", "settings", "reports", "accounting", "home",
    "contacts", "documents", "leases", "search", "all", "list", "new",
    "edit", "create", "add", "view", "details",
  ];
  return generics.includes(lower) || text.length < 2;
}

/**
 * Basic heuristic: does this look like a person name?
 * Must be 2-4 capitalized words, no numbers.
 */
function looksLikePersonName(text) {
  if (!text || text.length < 3 || text.length > 60) return false;
  if (/\d/.test(text)) return false;
  const words = text.split(/\s+/);
  if (words.length < 2 || words.length > 4) return false;
  return words.every((w) => /^[A-Z][a-z]+$/.test(w) || /^[A-Z]\.?$/.test(w));
}

/**
 * Deduplicate entity clues by value, keeping highest confidence.
 * @param {EntityClue[]} clues
 * @returns {EntityClue[]}
 */
function dedupClues(clues) {
  const seen = new Map();
  for (const c of clues) {
    const key = `${c.field}:${c.value.toLowerCase()}`;
    const existing = seen.get(key);
    if (!existing || c.confidence > existing.confidence) {
      seen.set(key, c);
    }
  }
  return [...seen.values()].slice(0, 10);
}
