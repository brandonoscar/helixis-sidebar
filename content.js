/**
 * Helixis Copilot — Content Script
 *
 * Runs on every page. Responds to context capture requests from the
 * side panel via chrome.runtime message passing.
 *
 * Architecture note: Content scripts in MV3 cannot use ES module imports,
 * so the context engine modules (types, classifier, identifier extractor,
 * entity extractor, text capture) are bundled inline here. The canonical
 * source modules live in extension/lib/context/ for reference and for
 * future build-step adoption.
 *
 * Message types handled:
 *   HELIXIS_GET_CONTEXT       — Full structured context capture
 *   HELIXIS_GET_LIGHT_CONTEXT — Quick page type + URL only
 *   HELIXIS_GET_SELECTION     — Just the selected text
 */

// ============================================================================
// TYPES & FACTORY
// ============================================================================

const PAGE_TYPES = [
  "dashboard", "property", "unit", "tenant", "lease", "maintenance",
  "messages", "document", "settings", "accounting", "contact",
  "report", "search", "login", "unknown",
];

function createEmptyContext(tabId, url) {
  let hostname = "";
  let pathname = "";
  let domain = "";
  try {
    const u = new URL(url);
    hostname = u.hostname;
    pathname = u.pathname;
    const parts = hostname.split(".");
    domain = parts.length >= 2 ? parts.slice(-2).join(".") : hostname;
  } catch { /* bad URL */ }

  return {
    captureId: crypto.randomUUID(),
    tabId,
    raw: { url, hostname, pathname, pageTitle: "", domain },
    classification: {
      pageType: "unknown", confidence: 0, method: "fallback",
      software: null, signals: [],
    },
    selectedText: "",
    visibleTextSummary: "",
    identifiers: {
      emails: [], phones: [], addresses: [], amounts: [],
      dates: [], referenceIds: [], names: [], unitNumbers: [],
    },
    entities: { properties: [], units: [], tenants: [] },
    timestamp: Date.now(),
    captureMs: 0,
  };
}

// ============================================================================
// PAGE CLASSIFIER
// ============================================================================

const SOFTWARE_RULES = [
  { pattern: "buildium",    software: "buildium" },
  { pattern: "appfolio",    software: "appfolio" },
  { pattern: "rentmanager", software: "rentmanager" },
  { pattern: "yardi",       software: "yardi" },
  { pattern: "propertyware", software: "propertyware" },
  { pattern: "tenantcloud", software: "tenantcloud" },
  { pattern: "rentec",      software: "rentecdirect" },
  { pattern: "mail.google", software: "gmail" },
  { pattern: "outlook",     software: "outlook" },
  { pattern: "zendesk",     software: "zendesk" },
  { pattern: "freshdesk",   software: "freshdesk" },
  { pattern: "hubspot",     software: "hubspot" },
];

const URL_PATTERNS = [
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

function classifyPage(url, title, visibleText) {
  const candidates = [];
  let software = null;

  try {
    const hostname = new URL(url).hostname.toLowerCase();
    for (const rule of SOFTWARE_RULES) {
      if (hostname.includes(rule.pattern)) { software = rule.software; break; }
    }
  } catch { /* */ }

  try {
    const pathname = new URL(url).pathname;
    for (const rule of URL_PATTERNS) {
      if (rule.regex.test(pathname)) {
        candidates.push({ pageType: rule.type, confidence: 0.8, method: "url", signals: [`URL path matches /${rule.type}`] });
        break;
      }
    }
  } catch { /* */ }

  for (const rule of TITLE_PATTERNS) {
    if (rule.regex.test(title)) {
      candidates.push({ pageType: rule.type, confidence: 0.65, method: "title", signals: [`Title contains "${rule.type}"`] });
      break;
    }
  }

  const domResult = classifyFromDOM();
  if (domResult) candidates.push(domResult);

  const kwResult = classifyFromKeywords(visibleText);
  if (kwResult) candidates.push(kwResult);

  candidates.sort((a, b) => b.confidence - a.confidence);
  const best = candidates[0];

  if (best) {
    const allSignals = candidates.filter(c => c.pageType === best.pageType).flatMap(c => c.signals);
    const methodsAgree = new Set(candidates.filter(c => c.pageType === best.pageType).map(c => c.method)).size;
    const boosted = Math.min(1.0, best.confidence + (methodsAgree - 1) * 0.1);
    return {
      pageType: best.pageType,
      confidence: Math.round(boosted * 100) / 100,
      method: best.method,
      software,
      signals: [...new Set(allSignals)],
    };
  }

  return { pageType: "unknown", confidence: 0, method: "fallback", software, signals: ["No classification signals"] };
}

function classifyFromDOM() {
  const clueTexts = [];
  const h1 = document.querySelector("h1");
  if (h1) clueTexts.push({ text: h1.textContent.trim(), weight: 1.0, source: "h1" });

  const breadcrumb = document.querySelector('[class*="breadcrumb"], [aria-label="breadcrumb"], nav[class*="bread"]');
  if (breadcrumb) clueTexts.push({ text: breadcrumb.textContent.trim(), weight: 0.8, source: "breadcrumb" });

  const activeNav = document.querySelector('nav a.active, nav [aria-current="page"], .nav-item.active, .sidebar a.active');
  if (activeNav) clueTexts.push({ text: activeNav.textContent.trim(), weight: 0.7, source: "nav" });

  for (const clue of clueTexts) {
    const lower = clue.text.toLowerCase();
    for (const [type, keywords] of Object.entries(KEYWORD_GROUPS)) {
      for (const kw of keywords) {
        if (lower.includes(kw)) {
          return {
            pageType: type,
            confidence: Math.round(clue.weight * 0.75 * 100) / 100,
            method: "dom",
            signals: [`${clue.source} contains "${kw}"`],
          };
        }
      }
    }
  }
  return null;
}

function classifyFromKeywords(text) {
  if (!text || text.length < 50) return null;
  const lower = text.toLowerCase();
  let bestType = null, bestCount = 0, bestKws = [];

  for (const [type, keywords] of Object.entries(KEYWORD_GROUPS)) {
    const hits = keywords.filter(kw => lower.includes(kw));
    if (hits.length > bestCount) {
      bestCount = hits.length;
      bestType = type;
      bestKws = hits;
    }
  }

  if (bestCount < 2 || !bestType) return null;
  const coverage = bestCount / KEYWORD_GROUPS[bestType].length;
  return {
    pageType: bestType,
    confidence: Math.round(Math.min(0.6, 0.3 + coverage * 0.3) * 100) / 100,
    method: "keyword",
    signals: [`${bestCount} keyword hits: ${bestKws.slice(0, 4).join(", ")}`],
  };
}

// ============================================================================
// IDENTIFIER EXTRACTOR
// ============================================================================

const MAX_TEXT = 15000;
const MAX_PER_TYPE = 15;

function extractIdentifiers(text) {
  const t = text.slice(0, MAX_TEXT);
  return {
    emails:       extractEmails(t),
    phones:       extractPhones(t),
    addresses:    extractAddresses(t),
    amounts:      extractAmounts(t),
    dates:        extractDates(t),
    referenceIds: extractReferenceIds(t),
    names:        extractNames(t),
    unitNumbers:  extractUnitNumbers(t),
  };
}

function extractEmails(t) {
  return dedupMatches(regexMatchAll(t, /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g, "email", 0.95));
}

function extractPhones(t) {
  const matches = regexMatchAll(t, /(?:\+?1[\s.\-]?)?\(?\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4}/g, "phone-us", 0.85);
  return dedupMatches(matches.map(m => {
    const digits = m.raw.replace(/\D/g, "");
    const core = digits.length === 11 ? digits.slice(1) : digits;
    if (core.length === 10) m.normalized = `(${core.slice(0,3)}) ${core.slice(3,6)}-${core.slice(6)}`;
    return m;
  }));
}

function extractAddresses(t) {
  const street = regexMatchAll(t,
    /\d{1,5}\s+(?:[NSEW]\.?\s+)?(?:[A-Z][a-zA-Z]+\s+){1,3}(?:St(?:reet)?|Ave(?:nue)?|Blvd|Dr(?:ive)?|Ln|Lane|Rd|Road|Ct|Court|Pl(?:ace)?|Way|Pkwy|Cir(?:cle)?|Ter(?:race)?)\.?(?:\s*,?\s*(?:Apt|Suite|Ste|Unit|#)\s*[A-Za-z0-9\-]+)?/gi,
    "street-address", 0.7);
  const csz = regexMatchAll(t,
    /(?:[A-Z][a-z]+(?:\s[A-Z][a-z]+)*),?\s+[A-Z]{2}\s+\d{5}(?:-\d{4})?/g,
    "city-state-zip", 0.75);
  return dedupMatches([...street, ...csz]);
}

function extractAmounts(t) {
  return dedupMatches(regexMatchAll(t, /\$\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})?/g, "dollar", 0.9)
    .map(m => { m.normalized = m.raw.replace(/\s/g, ""); return m; }));
}

function extractDates(t) {
  const a = regexMatchAll(t, /\b(?:0?[1-9]|1[0-2])[\/\-](?:0?[1-9]|[12]\d|3[01])[\/\-](?:19|20)\d{2}\b/g, "date-mdy", 0.85);
  const b = regexMatchAll(t, /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},?\s+\d{4}\b/gi, "date-long", 0.9);
  return dedupMatches([...a, ...b]);
}

function extractReferenceIds(t) {
  const prefixed = regexMatchAll(t, /\b(?:WO|TKT|INV|LS|PMT|REF|ACT|ID|PO|SO|RMA)[-#]?\d{3,10}\b/gi, "prefixed-id", 0.9);
  const labeled = [];
  const re = /\b(?:ticket|work\s*order|lease|invoice|order|request|case|account|reference|confirmation)\s*#?\s*(\d{3,10})\b/gi;
  let m;
  while ((m = re.exec(t)) !== null) {
    labeled.push({ raw: m[0].trim(), normalized: m[1], type: "labeled-id", confidence: 0.85 });
  }
  const hash = regexMatchAll(t, /(?<=\s|^)#\d{4,10}\b/g, "hash-id", 0.6);
  return dedupMatches([...prefixed, ...labeled, ...hash]);
}

function extractNames(t) {
  const results = [];
  const re = /(?:tenant|resident|owner|contact|assigned\s*to|reported\s*by|manager|lessee|occupant)\s*:?\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})/g;
  let m;
  while ((m = re.exec(t)) !== null) {
    results.push({ raw: m[1].trim(), normalized: m[1].trim(), type: "labeled-name", confidence: 0.75 });
  }
  return dedupMatches(results).slice(0, MAX_PER_TYPE);
}

function extractUnitNumbers(t) {
  const results = [];
  const re = /\b(?:unit|apt\.?|apartment|suite|ste\.?|room|rm\.?)\s*#?\s*([A-Za-z0-9\-]{1,8})\b/gi;
  let m;
  while ((m = re.exec(t)) !== null) {
    results.push({ raw: m[0].trim(), normalized: m[1].toUpperCase(), type: "unit-number", confidence: 0.85 });
  }
  return dedupMatches(results);
}

function regexMatchAll(text, regex, type, confidence) {
  const results = [];
  let m, count = 0;
  while ((m = regex.exec(text)) !== null && count < MAX_PER_TYPE) {
    const raw = m[0].trim();
    if (raw) { results.push({ raw, normalized: raw, type, confidence }); count++; }
  }
  return results;
}

function dedupMatches(matches) {
  const seen = new Map();
  for (const m of matches) {
    const key = m.normalized.toLowerCase();
    if (!seen.has(key) || m.confidence > seen.get(key).confidence) seen.set(key, m);
  }
  return [...seen.values()].slice(0, MAX_PER_TYPE);
}

// ============================================================================
// ENTITY EXTRACTOR
// ============================================================================

function extractEntities(pageType, identifiers) {
  return {
    properties: extractPropertyClues(pageType, identifiers),
    units:      extractUnitClues(pageType, identifiers),
    tenants:    extractTenantClues(pageType, identifiers),
  };
}

function extractPropertyClues(pageType, ids) {
  const clues = [];

  if (["property", "unit", "dashboard"].includes(pageType)) {
    const h1 = document.querySelector("h1");
    if (h1) {
      const text = h1.textContent.trim();
      if (text.length > 2 && text.length < 100 && !isGenericHeading(text)) {
        clues.push({ value: text, field: "name", confidence: pageType === "property" ? 0.8 : 0.5, source: "heading" });
      }
    }
  }

  clues.push(...extractFromBreadcrumbs("property"));

  const labeled = extractFromLabels(["property", "property name", "building", "community", "complex"], "name");
  clues.push(...labeled.map(c => ({ ...c, confidence: c.confidence * 0.9 })));

  for (const addr of ids.addresses.slice(0, 3)) {
    clues.push({ value: addr.normalized, field: "address", confidence: addr.confidence * 0.7, source: "text" });
  }

  return dedupClues(clues);
}

function extractUnitClues(pageType, ids) {
  const clues = [];

  for (const u of ids.unitNumbers) {
    clues.push({ value: u.normalized, field: "number", confidence: u.confidence, source: "text" });
  }

  if (pageType === "unit") {
    const h1 = document.querySelector("h1");
    if (h1) {
      const text = h1.textContent.trim();
      if (text.length < 30) clues.push({ value: text, field: "number", confidence: 0.75, source: "heading" });
    }
  }

  clues.push(...extractFromLabels(["unit", "unit number", "apt", "apartment", "suite"], "number"));

  const bodyText = (document.body?.innerText ?? "").slice(0, 5000);
  const bbRe = /(\d+)\s*(?:bed(?:room)?s?|br)\s*[\/,|]\s*(\d+(?:\.\d)?)\s*(?:bath(?:room)?s?|ba)/gi;
  let m;
  while ((m = bbRe.exec(bodyText)) !== null) {
    clues.push({ value: `${m[1]}BR/${m[2]}BA`, field: "layout", confidence: 0.7, source: "text" });
    break;
  }

  return dedupClues(clues);
}

function extractTenantClues(pageType, ids) {
  const clues = [];

  for (const n of ids.names) {
    clues.push({ value: n.normalized, field: "name", confidence: n.confidence, source: "text" });
  }

  if (pageType === "tenant") {
    const h1 = document.querySelector("h1");
    if (h1) {
      const text = h1.textContent.trim();
      if (looksLikePersonName(text)) {
        clues.push({ value: text, field: "name", confidence: 0.8, source: "heading" });
      }
    }
  }

  const labeled = extractFromLabels(["tenant", "resident", "lessee", "occupant", "renter", "contact name"], "name");
  for (const c of labeled) { if (looksLikePersonName(c.value)) clues.push(c); }

  if (["tenant", "lease", "maintenance"].includes(pageType)) {
    for (const e of ids.emails.slice(0, 2))  clues.push({ value: e.normalized, field: "email", confidence: 0.6, source: "text" });
    for (const p of ids.phones.slice(0, 2))  clues.push({ value: p.normalized, field: "phone", confidence: 0.55, source: "text" });
  }

  return dedupClues(clues);
}

// ── Entity helpers ────────────────────────────────────

function extractFromLabels(labelKeywords, field) {
  const clues = [];
  const labels = document.querySelectorAll("label, dt, th, [class*='label']");

  for (const label of labels) {
    const lt = label.textContent.trim().toLowerCase();
    if (!labelKeywords.some(kw => lt.includes(kw))) continue;

    const valueEl = label.nextElementSibling || (label.tagName === "DT" ? label.nextElementSibling : null);
    if (valueEl) {
      const v = valueEl.textContent.trim();
      if (v.length > 0 && v.length < 200) {
        clues.push({ value: v, field, confidence: 0.7, source: "label" });
      }
    }

    const parent = label.parentElement;
    if (parent) {
      const vc = parent.querySelector("[class*='value'], [class*='data'], span, dd, td");
      if (vc && vc !== label) {
        const v = vc.textContent.trim();
        if (v.length > 0 && v.length < 200) {
          clues.push({ value: v, field, confidence: 0.65, source: "label" });
        }
      }
    }

    if (clues.length >= 3) break;
  }
  return clues;
}

function extractFromBreadcrumbs(entityType) {
  const clues = [];
  const bc = document.querySelector('[class*="breadcrumb"], [aria-label="breadcrumb"], nav[class*="bread"]');
  if (!bc) return clues;

  const items = Array.from(bc.querySelectorAll("a, span, li")).map(el => el.textContent.trim()).filter(t => t.length > 1 && t.length < 80);
  const keywords = { property: ["properties", "buildings", "communities"], unit: ["units", "apartments"], tenant: ["tenants", "residents"] };
  const kws = keywords[entityType] || [];

  for (let i = 0; i < items.length - 1; i++) {
    if (kws.some(kw => items[i].toLowerCase().includes(kw))) {
      const next = items[i + 1];
      if (next && !isGenericHeading(next)) {
        clues.push({ value: next, field: "name", confidence: 0.75, source: "breadcrumb" });
      }
    }
  }
  return clues;
}

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

function looksLikePersonName(text) {
  if (!text || text.length < 3 || text.length > 60) return false;
  if (/\d/.test(text)) return false;
  const words = text.split(/\s+/);
  if (words.length < 2 || words.length > 4) return false;
  return words.every(w => /^[A-Z][a-z]+$/.test(w) || /^[A-Z]\.?$/.test(w));
}

function dedupClues(clues) {
  const seen = new Map();
  for (const c of clues) {
    const key = `${c.field}:${c.value.toLowerCase()}`;
    if (!seen.has(key) || c.confidence > seen.get(key).confidence) seen.set(key, c);
  }
  return [...seen.values()].slice(0, 10);
}

// ============================================================================
// TEXT CAPTURE
// ============================================================================

function captureSelectedText() {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return "";
  const text = sel.toString().trim().replace(/\s+/g, " ");
  return text.length > 1000 ? text.slice(0, 1000) + "..." : text;
}

function captureVisibleTextSummary() {
  const sections = [];

  if (document.title) sections.push(`[Title] ${document.title.trim()}`);

  // Headings
  const headings = [];
  for (const h of document.querySelectorAll("h1, h2, h3")) {
    if (!elVisible(h)) continue;
    const t = h.textContent.trim();
    if (t.length > 0 && t.length < 120) headings.push(t);
    if (headings.length >= 8) break;
  }
  if (headings.length) sections.push(`[Headings] ${headings.join(" | ")}`);

  // Breadcrumbs
  const bc = document.querySelector('[class*="breadcrumb"], [aria-label="breadcrumb"], nav[class*="bread"]');
  if (bc) {
    const t = bc.textContent.trim().replace(/\s+/g, " ");
    if (t.length > 0 && t.length < 200) sections.push(`[Breadcrumb] ${t}`);
  }

  // Label-value pairs
  const pairs = [];
  for (const dt of document.querySelectorAll("dt")) {
    const dd = dt.nextElementSibling;
    if (dd?.tagName === "DD") {
      const l = dt.textContent.trim(), v = dd.textContent.trim();
      if (l && v && l.length < 50 && v.length < 200) pairs.push(`${l}: ${v}`);
    }
    if (pairs.length >= 12) break;
  }
  if (pairs.length === 0) {
    for (const label of document.querySelectorAll("label")) {
      const t = label.textContent.trim();
      let val = "";
      const forId = label.getAttribute("for");
      if (forId) { const inp = document.getElementById(forId); if (inp) val = inp.value || inp.textContent?.trim() || ""; }
      if (!val) { const sib = label.nextElementSibling; if (sib && !["LABEL","BR"].includes(sib.tagName)) val = sib.textContent?.trim() || ""; }
      if (t && val && t.length < 50 && val.length < 200) pairs.push(`${t}: ${val}`);
      if (pairs.length >= 12) break;
    }
  }
  if (pairs.length) sections.push(`[Fields] ${pairs.join(" | ")}`);

  // Table headers
  const ths = [];
  const table = document.querySelector("table");
  if (table && elVisible(table)) {
    for (const th of table.querySelectorAll("th")) {
      const t = th.textContent.trim();
      if (t.length > 0 && t.length < 60) ths.push(t);
      if (ths.length >= 10) break;
    }
  }
  if (ths.length) sections.push(`[Table Columns] ${ths.join(" | ")}`);

  // Card titles
  const cards = [];
  for (const card of document.querySelectorAll('[class*="card"], [class*="tile"], [class*="item"], [class*="panel"]')) {
    if (!elVisible(card)) continue;
    const titleEl = card.querySelector("h1, h2, h3, h4, strong, b, [class*='title']");
    if (titleEl) {
      const t = titleEl.textContent.trim();
      if (t.length > 0 && t.length < 80) cards.push(t);
    }
    if (cards.length >= 6) break;
  }
  if (cards.length) sections.push(`[Cards] ${cards.join(" | ")}`);

  // Main content fallback
  if (sections.length < 3) {
    const main = document.querySelector("main") || document.querySelector('[role="main"]') || document.querySelector('[class*="main-content"]') || document.body;
    if (main) {
      const t = (main.innerText || "").replace(/\s+/g, " ").trim().slice(0, 1500);
      if (t.length > 50) sections.push(`[Content] ${t}`);
    }
  }

  let summary = sections.join("\n");
  if (summary.length > 3000) summary = summary.slice(0, 3000) + "...";
  return summary;
}

function elVisible(el) {
  if (!el) return false;
  if (el.offsetParent === null && el !== document.body) return false;
  const s = getComputedStyle(el);
  return s.display !== "none" && s.visibility !== "hidden";
}

// ============================================================================
// CONTEXT ENGINE — ORCHESTRATOR
// ============================================================================

function captureFullContext(tabId) {
  const start = performance.now();
  const ctx = createEmptyContext(tabId, location.href);
  ctx.raw.pageTitle = document.title || "";

  ctx.selectedText = captureSelectedText();
  ctx.visibleTextSummary = captureVisibleTextSummary();
  ctx.classification = classifyPage(ctx.raw.url, ctx.raw.pageTitle, ctx.visibleTextSummary);
  ctx.identifiers = extractIdentifiers(ctx.visibleTextSummary);
  ctx.entities = extractEntities(ctx.classification.pageType, ctx.identifiers);
  ctx.captureMs = Math.round(performance.now() - start);

  return ctx;
}

function captureLightContext(tabId) {
  const url = location.href;
  let hostname = "";
  try { hostname = new URL(url).hostname; } catch { /* */ }
  const title = document.title || "";
  const summary = captureVisibleTextSummary();
  const cls = classifyPage(url, title, summary);

  return {
    tabId, url, hostname, pageTitle: title,
    pageType: cls.pageType, software: cls.software, timestamp: Date.now(),
  };
}

// ============================================================================
// MESSAGE HANDLER
// ============================================================================

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.type) {
    case "HELIXIS_GET_CONTEXT": {
      const ctx = captureFullContext(msg.tabId || 0);
      sendResponse(ctx);
      break;
    }
    case "HELIXIS_GET_LIGHT_CONTEXT": {
      const light = captureLightContext(msg.tabId || 0);
      sendResponse(light);
      break;
    }
    case "HELIXIS_GET_SELECTION": {
      sendResponse({ selectedText: captureSelectedText() });
      break;
    }
    default:
      break;
  }
  return true; // keep channel open for async
});
