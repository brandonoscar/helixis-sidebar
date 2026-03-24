/**
 * Helixis Browser Context — Text Capture
 *
 * Two modules in one file:
 *   1. Selected Text Capture — safely gets user-highlighted text
 *   2. Visible Text Summary  — collects high-signal visible text
 *
 * Design principles:
 *   - Prioritize headings, labels, key-value pairs, table headers, cards
 *   - Avoid dumping raw innerText (noisy, huge, includes hidden text)
 *   - Truncate sensibly (max ~3000 chars for summary)
 *   - Privacy-aware: don't collect more than needed
 *
 * Runs inside the content script (has DOM access).
 */

const MAX_SUMMARY_LENGTH = 3000;

// ── Selected Text ─────────────────────────────────────

/**
 * Capture the user's current text selection, if any.
 * Trims and normalizes whitespace. Returns empty string if nothing selected.
 *
 * @returns {string}
 */
export function captureSelectedText() {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return "";

  const text = selection.toString().trim();

  // Normalize internal whitespace (collapse runs of spaces/newlines)
  const normalized = text.replace(/\s+/g, " ");

  // Don't overcapture — limit to 1000 chars
  if (normalized.length > 1000) {
    return normalized.slice(0, 1000) + "...";
  }

  return normalized;
}

// ── Visible Text Summary ──────────────────────────────

/**
 * Collect meaningful visible text from the page without dumping the entire DOM.
 *
 * Priority order:
 *   1. Document title
 *   2. H1, H2, H3 headings
 *   3. Breadcrumb text
 *   4. Label-value pairs (dt/dd, label/span, th/td)
 *   5. Card titles and descriptions
 *   6. Table headers
 *   7. Main content area text (truncated)
 *
 * @returns {string}
 */
export function captureVisibleTextSummary() {
  const sections = [];

  // 1. Title
  if (document.title) {
    sections.push(`[Title] ${document.title.trim()}`);
  }

  // 2. Headings (H1–H3)
  const headings = collectHeadings();
  if (headings.length > 0) {
    sections.push(`[Headings] ${headings.join(" | ")}`);
  }

  // 3. Breadcrumbs
  const breadcrumb = collectBreadcrumbs();
  if (breadcrumb) {
    sections.push(`[Breadcrumb] ${breadcrumb}`);
  }

  // 4. Label-value pairs
  const pairs = collectLabelValuePairs();
  if (pairs.length > 0) {
    sections.push(`[Fields] ${pairs.join(" | ")}`);
  }

  // 5. Table headers
  const tableHeaders = collectTableHeaders();
  if (tableHeaders.length > 0) {
    sections.push(`[Table Columns] ${tableHeaders.join(" | ")}`);
  }

  // 6. Card content
  const cards = collectCardContent();
  if (cards.length > 0) {
    sections.push(`[Cards] ${cards.join(" | ")}`);
  }

  // 7. Main content area text (fallback for pages without structured elements)
  const mainText = collectMainContentText();
  if (mainText && sections.length < 3) {
    // Only include raw content if we didn't get enough structured data
    sections.push(`[Content] ${mainText}`);
  }

  // Join and truncate
  let summary = sections.join("\n");
  if (summary.length > MAX_SUMMARY_LENGTH) {
    summary = summary.slice(0, MAX_SUMMARY_LENGTH) + "...";
  }

  return summary;
}

// ── Collectors ────────────────────────────────────────

/**
 * Collect text from H1–H3 elements.
 * @returns {string[]}
 */
function collectHeadings() {
  const results = [];
  const headings = document.querySelectorAll("h1, h2, h3");
  for (const h of headings) {
    if (!isVisible(h)) continue;
    const text = h.textContent.trim();
    if (text.length > 0 && text.length < 120) {
      results.push(text);
    }
    if (results.length >= 8) break;
  }
  return results;
}

/**
 * Collect breadcrumb text.
 * @returns {string|null}
 */
function collectBreadcrumbs() {
  const bc = document.querySelector(
    '[class*="breadcrumb"], [aria-label="breadcrumb"], nav[class*="bread"]'
  );
  if (!bc) return null;
  const text = bc.textContent.trim().replace(/\s+/g, " ");
  return text.length > 0 && text.length < 200 ? text : null;
}

/**
 * Collect label-value pairs from common patterns.
 * @returns {string[]}
 */
function collectLabelValuePairs() {
  const pairs = [];

  // dt/dd pairs
  const dts = document.querySelectorAll("dt");
  for (const dt of dts) {
    const dd = dt.nextElementSibling;
    if (dd?.tagName === "DD") {
      const label = dt.textContent.trim();
      const value = dd.textContent.trim();
      if (label && value && label.length < 50 && value.length < 200) {
        pairs.push(`${label}: ${value}`);
      }
    }
    if (pairs.length >= 12) break;
  }

  // If no dt/dd pairs, try label elements
  if (pairs.length === 0) {
    const labels = document.querySelectorAll("label");
    for (const label of labels) {
      const text = label.textContent.trim();
      // Try to find associated input or sibling with value
      const forId = label.getAttribute("for");
      let value = "";
      if (forId) {
        const input = document.getElementById(forId);
        if (input) value = input.value || input.textContent?.trim() || "";
      }
      if (!value) {
        const sibling = label.nextElementSibling;
        if (sibling && !["LABEL", "BR"].includes(sibling.tagName)) {
          value = sibling.textContent?.trim() || "";
        }
      }
      if (text && value && text.length < 50 && value.length < 200) {
        pairs.push(`${text}: ${value}`);
      }
      if (pairs.length >= 12) break;
    }
  }

  return pairs;
}

/**
 * Collect table headers (TH elements).
 * @returns {string[]}
 */
function collectTableHeaders() {
  const headers = [];
  // Only from the first visible table
  const table = document.querySelector("table");
  if (!table || !isVisible(table)) return headers;

  const ths = table.querySelectorAll("th");
  for (const th of ths) {
    const text = th.textContent.trim();
    if (text.length > 0 && text.length < 60) {
      headers.push(text);
    }
    if (headers.length >= 10) break;
  }
  return headers;
}

/**
 * Collect key text from card-like elements.
 * @returns {string[]}
 */
function collectCardContent() {
  const results = [];
  const cards = document.querySelectorAll(
    '[class*="card"], [class*="tile"], [class*="item"], [class*="panel"]'
  );

  for (const card of cards) {
    if (!isVisible(card)) continue;

    // Get the card's "title" — first heading, bold, or strong element
    const titleEl = card.querySelector("h1, h2, h3, h4, strong, b, [class*='title']");
    if (titleEl) {
      const text = titleEl.textContent.trim();
      if (text.length > 0 && text.length < 80) {
        results.push(text);
      }
    }
    if (results.length >= 6) break;
  }

  return results;
}

/**
 * Collect truncated text from the main content area.
 * Tries to find <main>, [role=main], or falls back to body.
 * @returns {string|null}
 */
function collectMainContentText() {
  const main =
    document.querySelector("main") ||
    document.querySelector('[role="main"]') ||
    document.querySelector('[class*="main-content"], [class*="content-area"]');

  const target = main || document.body;
  if (!target) return null;

  // Get innerText but truncate aggressively
  const text = target.innerText || "";
  const cleaned = text
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1500);

  return cleaned.length > 50 ? cleaned : null;
}

// ── Visibility Check ──────────────────────────────────

/**
 * Quick check if an element is likely visible (not hidden, not zero-size).
 * @param {Element} el
 * @returns {boolean}
 */
function isVisible(el) {
  if (!el) return false;
  // offsetParent is null for hidden elements (except body/fixed)
  if (el.offsetParent === null && el !== document.body) return false;
  const style = getComputedStyle(el);
  return style.display !== "none" && style.visibility !== "hidden";
}
