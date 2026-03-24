/**
 * Helixis Browser Context — Page Classifier
 *
 * Classifies the current page into a property-management page type.
 * Uses a layered approach:
 *   1. Software detection (hostname → known software)
 *   2. URL pattern matching (path segments → page type)
 *   3. Title pattern matching
 *   4. DOM clue detection (headings, breadcrumbs, nav)
 *   5. Keyword frequency in visible text
 *
 * Architecture: The classifier is a pipeline of scoring functions.
 * Each returns { pageType, confidence, signals }. The highest-confidence
 * result wins. Software-specific classifiers can be added by registering
 * new entries in SOFTWARE_RULES.
 *
 * This runs inside the content script (has DOM access).
 */

// ── Software Detection ────────────────────────────────

/**
 * Known property-management and adjacent software by domain pattern.
 * Extend this as we add integrations.
 */
const SOFTWARE_RULES = [
  { pattern: "buildium",   software: "buildium" },
  { pattern: "appfolio",   software: "appfolio" },
  { pattern: "rentmanager", software: "rentmanager" },
  { pattern: "yardi",      software: "yardi" },
  { pattern: "propertyware", software: "propertyware" },
  { pattern: "tenantcloud", software: "tenantcloud" },
  { pattern: "rentec",     software: "rentecdirect" },
  { pattern: "mail.google", software: "gmail" },
  { pattern: "outlook",    software: "outlook" },
  { pattern: "zendesk",    software: "zendesk" },
  { pattern: "freshdesk",  software: "freshdesk" },
  { pattern: "hubspot",    software: "hubspot" },
];

/**
 * @param {string} hostname
 * @returns {string|null}
 */
function detectSoftware(hostname) {
  const h = hostname.toLowerCase();
  for (const rule of SOFTWARE_RULES) {
    if (h.includes(rule.pattern)) return rule.software;
  }
  return null;
}

// ── Page Type Rules ───────────────────────────────────

/**
 * URL path patterns → page type.
 * Ordered by specificity. First match wins within URL classification.
 */
const URL_PATTERNS = [
  // Property management pages
  { regex: /\/(maintenance|work[-_]?order|service[-_]?request)/i, type: "maintenance" },
  { regex: /\/lease/i,        type: "lease" },
  { regex: /\/tenant|\/resident|\/renter/i, type: "tenant" },
  { regex: /\/unit/i,         type: "unit" },
  { regex: /\/propert(y|ies)/i, type: "property" },
  { regex: /\/accounting|\/financials?|\/ledger|\/invoic/i, type: "accounting" },
  { regex: /\/report/i,       type: "report" },
  { regex: /\/message|\/inbox|\/conversation|\/communi/i, type: "messages" },
  { regex: /\/document|\/file|\/attachment/i, type: "document" },
  { regex: /\/contact/i,      type: "contact" },
  { regex: /\/search|\/find/i, type: "search" },
  { regex: /\/setting|\/config|\/preference|\/admin/i, type: "settings" },
  { regex: /\/login|\/signin|\/auth/i, type: "login" },
  { regex: /\/dashboard|\/home|\/overview/i, type: "dashboard" },
];

/**
 * Title patterns → page type.
 */
const TITLE_PATTERNS = [
  { regex: /maintenance|work\s*order|service\s*request/i, type: "maintenance" },
  { regex: /lease\b/i,          type: "lease" },
  { regex: /tenant|resident/i,  type: "tenant" },
  { regex: /\bunit\b/i,         type: "unit" },
  { regex: /propert(y|ies)/i,   type: "property" },
  { regex: /accounting|ledger|invoice|payment/i, type: "accounting" },
  { regex: /report/i,           type: "report" },
  { regex: /message|inbox/i,    type: "messages" },
  { regex: /document|file/i,    type: "document" },
  { regex: /setting|preference/i, type: "settings" },
  { regex: /dashboard|overview/i, type: "dashboard" },
];

/**
 * DOM keyword groups for keyword-frequency classification.
 * Scored by how many keywords appear in the visible text.
 */
const KEYWORD_GROUPS = {
  dashboard:   ["dashboard", "overview", "summary", "at a glance", "quick stats", "recent activity"],
  property:    ["property", "building", "complex", "community", "address", "portfolio"],
  unit:        ["unit", "apartment", "suite", "floor plan", "bed", "bath", "sqft", "sq ft"],
  tenant:      ["tenant", "resident", "lessee", "occupant", "move-in", "move-out", "renter"],
  lease:       ["lease", "lease term", "start date", "end date", "monthly rent", "security deposit", "renewal"],
  maintenance: ["maintenance", "work order", "service request", "repair", "priority", "assigned to", "vendor"],
  messages:    ["message", "inbox", "sent", "compose", "reply", "conversation", "notification"],
  accounting:  ["payment", "invoice", "balance", "ledger", "charge", "credit", "debit", "amount due"],
  document:    ["document", "file", "upload", "attachment", "download"],
  settings:    ["settings", "preferences", "configuration", "profile", "account", "permission"],
  report:      ["report", "analytics", "export", "date range", "filter"],
};

// ── Classifier Pipeline ───────────────────────────────

/**
 * Classify a page. Runs in the content script context.
 *
 * @param {string} url
 * @param {string} title
 * @param {string} visibleText - Lightweight visible text (not full page dump)
 * @returns {import('./types.js').PageClassification}
 */
export function classifyPage(url, title, visibleText) {
  const candidates = [];
  let software = null;

  // 1. Software detection
  try {
    const hostname = new URL(url).hostname;
    software = detectSoftware(hostname);
  } catch {
    // bad URL
  }

  // 2. URL pattern matching
  try {
    const pathname = new URL(url).pathname;
    for (const rule of URL_PATTERNS) {
      if (rule.regex.test(pathname)) {
        candidates.push({
          pageType: rule.type,
          confidence: 0.8,
          method: "url",
          signals: [`URL path matches /${rule.type} pattern`],
        });
        break; // First URL match wins
      }
    }
  } catch {
    // bad URL
  }

  // 3. Title pattern matching
  for (const rule of TITLE_PATTERNS) {
    if (rule.regex.test(title)) {
      candidates.push({
        pageType: rule.type,
        confidence: 0.65,
        method: "title",
        signals: [`Page title contains "${rule.type}" keyword`],
      });
      break;
    }
  }

  // 4. DOM clue detection (headings, breadcrumbs)
  const domResult = classifyFromDOM();
  if (domResult) {
    candidates.push(domResult);
  }

  // 5. Keyword frequency in visible text
  const keywordResult = classifyFromKeywords(visibleText);
  if (keywordResult) {
    candidates.push(keywordResult);
  }

  // Pick the highest confidence result
  candidates.sort((a, b) => b.confidence - a.confidence);
  const best = candidates[0];

  if (best) {
    // Collect all signals from all candidates for the same type
    const allSignals = candidates
      .filter((c) => c.pageType === best.pageType)
      .flatMap((c) => c.signals);

    // Boost confidence if multiple methods agree
    const methodsAgree = new Set(
      candidates.filter((c) => c.pageType === best.pageType).map((c) => c.method)
    ).size;
    const boostedConfidence = Math.min(1.0, best.confidence + (methodsAgree - 1) * 0.1);

    return {
      pageType: best.pageType,
      confidence: Math.round(boostedConfidence * 100) / 100,
      method: best.method,
      software,
      signals: [...new Set(allSignals)],
    };
  }

  return {
    pageType: "unknown",
    confidence: 0,
    method: "fallback",
    software,
    signals: ["No classification signals found"],
  };
}

// ── DOM-Based Classification ──────────────────────────

/**
 * Check headings, breadcrumbs, and nav elements for page type clues.
 * @returns {{ pageType: string, confidence: number, method: string, signals: string[] } | null}
 */
function classifyFromDOM() {
  // Gather text from high-signal DOM elements
  const clueTexts = [];

  // H1 is the strongest DOM signal
  const h1 = document.querySelector("h1");
  if (h1) clueTexts.push({ text: h1.textContent.trim(), weight: 1.0, source: "h1" });

  // Breadcrumbs (common in PM software)
  const breadcrumb = document.querySelector(
    '[class*="breadcrumb"], [aria-label="breadcrumb"], nav[class*="bread"]'
  );
  if (breadcrumb) {
    clueTexts.push({ text: breadcrumb.textContent.trim(), weight: 0.8, source: "breadcrumb" });
  }

  // Active nav item
  const activeNav = document.querySelector(
    'nav a.active, nav [aria-current="page"], .nav-item.active, .sidebar a.active'
  );
  if (activeNav) {
    clueTexts.push({ text: activeNav.textContent.trim(), weight: 0.7, source: "nav" });
  }

  if (clueTexts.length === 0) return null;

  // Check each clue against page type keywords
  for (const clue of clueTexts) {
    const lowerText = clue.text.toLowerCase();
    for (const [type, keywords] of Object.entries(KEYWORD_GROUPS)) {
      for (const keyword of keywords) {
        if (lowerText.includes(keyword)) {
          return {
            pageType: type,
            confidence: Math.round(clue.weight * 0.75 * 100) / 100,
            method: "dom",
            signals: [`${clue.source} contains "${keyword}"`],
          };
        }
      }
    }
  }

  return null;
}

// ── Keyword Frequency Classification ──────────────────

/**
 * Count keyword hits in visible text and pick the type with the most matches.
 * Only fires if there are enough hits to be meaningful.
 *
 * @param {string} text
 * @returns {{ pageType: string, confidence: number, method: string, signals: string[] } | null}
 */
function classifyFromKeywords(text) {
  if (!text || text.length < 50) return null;

  const lowerText = text.toLowerCase();
  let bestType = null;
  let bestCount = 0;
  let bestKeywords = [];

  for (const [type, keywords] of Object.entries(KEYWORD_GROUPS)) {
    const hits = [];
    for (const kw of keywords) {
      if (lowerText.includes(kw)) {
        hits.push(kw);
      }
    }
    if (hits.length > bestCount) {
      bestCount = hits.length;
      bestType = type;
      bestKeywords = hits;
    }
  }

  // Require at least 2 keyword hits to classify by keywords alone
  if (bestCount < 2 || !bestType) return null;

  // Confidence scales with how many of that type's keywords appear
  const coverage = bestCount / KEYWORD_GROUPS[bestType].length;
  const confidence = Math.round(Math.min(0.6, 0.3 + coverage * 0.3) * 100) / 100;

  return {
    pageType: bestType,
    confidence,
    method: "keyword",
    signals: [`${bestCount} keyword hits: ${bestKeywords.slice(0, 4).join(", ")}`],
  };
}
