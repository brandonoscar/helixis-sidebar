/**
 * Helixis Browser Context — Context Engine (Orchestrator)
 *
 * This is the main entry point for browser context capture.
 * It coordinates all extraction modules and returns a single
 * structured BrowserContext payload.
 *
 * Architecture:
 *   1. This module runs INSIDE the content script (has DOM access)
 *   2. It imports and calls each extraction module
 *   3. It returns a serializable JSON payload
 *   4. The panel/service worker requests context via chrome.tabs.sendMessage
 *
 * The capture is designed to be fast (<100ms on typical pages) by:
 *   - Limiting text extraction to reasonable sizes
 *   - Using simple regex patterns instead of heavy parsing
 *   - Running extractors sequentially (DOM access is synchronous anyway)
 *
 * This file is designed to be imported by the content script.
 */

import { createEmptyContext } from "./types.js";
import { classifyPage } from "./page-classifier.js";
import { extractIdentifiers } from "./identifier-extractor.js";
import { extractEntities } from "./entity-extractor.js";
import { captureSelectedText, captureVisibleTextSummary } from "./text-capture.js";

/**
 * Capture the full browser context from the current page.
 * Returns a structured, serializable BrowserContext payload.
 *
 * @param {number} tabId - Chrome tab ID (passed from the message sender)
 * @returns {import('./types.js').BrowserContext}
 */
export function captureFullContext(tabId) {
  const startTime = performance.now();

  // 1. Initialize the context shell
  const ctx = createEmptyContext(tabId, location.href);
  ctx.raw.pageTitle = document.title || "";

  // 2. Capture text layers
  ctx.selectedText = captureSelectedText();
  ctx.visibleTextSummary = captureVisibleTextSummary();

  // 3. Classify the page type
  ctx.classification = classifyPage(
    ctx.raw.url,
    ctx.raw.pageTitle,
    ctx.visibleTextSummary
  );

  // 4. Extract structured identifiers from visible text
  ctx.identifiers = extractIdentifiers(ctx.visibleTextSummary);

  // 5. Infer property-management entities
  ctx.entities = extractEntities(
    ctx.classification.pageType,
    ctx.identifiers
  );

  // 6. Record timing
  ctx.captureMs = Math.round(performance.now() - startTime);

  return ctx;
}

/**
 * Capture a lightweight context snapshot — just page location + type.
 * Useful for passive tracking without full extraction overhead.
 *
 * @param {number} tabId
 * @returns {{ tabId: number, url: string, hostname: string, pageTitle: string, pageType: string, software: string|null, timestamp: number }}
 */
export function captureLightContext(tabId) {
  const url = location.href;
  let hostname = "";
  try { hostname = new URL(url).hostname; } catch { /* */ }

  const title = document.title || "";
  const summary = captureVisibleTextSummary();
  const classification = classifyPage(url, title, summary);

  return {
    tabId,
    url,
    hostname,
    pageTitle: title,
    pageType: classification.pageType,
    software: classification.software,
    timestamp: Date.now(),
  };
}
