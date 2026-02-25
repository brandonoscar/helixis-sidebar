/**
 * core/api.js
 *
 * Authenticated fetch wrapper with:
 *   - Domain allowlist (no calls leave to un-approved hosts)
 *   - Request timeout via AbortController
 *   - Exponential-backoff retries
 *   - Bearer-token auth header injection
 *
 * Used ONLY by service_worker.js — API keys are never passed through panel.js.
 */

// ─── Domain Allowlist ────────────────────────────────────────────────────────

/**
 * Only these hostnames (and their subdomains) may be called.
 * Add entries here as new connectors are onboarded.
 */
const ALLOWED_HOSTNAMES = [
  'localhost',
  '127.0.0.1',
  'api.helixis.io',          // Helixis Cloud (production)
  'api-staging.helixis.io',  // Helixis Cloud (staging)
  // 'api.buildium.com',      // Buildium — uncomment when ready
];

/**
 * Return true when `url` resolves to an allowed hostname.
 * @param {string} url
 */
function isDomainAllowed(url) {
  try {
    const { hostname } = new URL(url);
    return ALLOWED_HOSTNAMES.some(
      (allowed) => hostname === allowed || hostname.endsWith(`.${allowed}`)
    );
  } catch {
    return false;
  }
}

// ─── Fetch Helpers ───────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_RETRIES    = 2;
const RETRY_BASE_MS      = 500;

/**
 * Wrap fetch with an AbortController timeout.
 * @param {string} url
 * @param {RequestInit} options
 * @param {number} timeoutMs
 */
async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Make an authenticated HTTP request.
 *
 * @param {string} url - Must resolve to an allowed domain.
 * @param {object} [opts]
 * @param {'GET'|'POST'|'PUT'|'PATCH'|'DELETE'} [opts.method='GET']
 * @param {unknown}  [opts.body]         - JSON-serialisable request body.
 * @param {Record<string, string>} [opts.headers] - Extra headers.
 * @param {string}   [opts.apiKey]       - Bearer token (read from storage by SW).
 * @param {number}   [opts.timeoutMs]    - Per-attempt timeout.
 * @param {number}   [opts.retries]      - Extra attempts after the first.
 * @returns {Promise<Response>}
 */
export async function apiFetch(url, {
  method    = 'GET',
  body,
  headers   = {},
  apiKey,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  retries   = DEFAULT_RETRIES,
} = {}) {
  if (!isDomainAllowed(url)) {
    const { hostname } = new URL(url);
    throw new Error(`[api] Host "${hostname}" is not in the allowlist.`);
  }

  const reqHeaders = {
    'Content-Type': 'application/json',
    ...headers,
  };
  if (apiKey) {
    reqHeaders['Authorization'] = `Bearer ${apiKey}`;
  }

  const init = {
    method,
    headers: reqHeaders,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  };

  let lastError;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetchWithTimeout(url, init, timeoutMs);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return response;
    } catch (error) {
      lastError = error;

      if (attempt < retries) {
        // Exponential back-off: 500 ms, 1 000 ms, …
        await new Promise((r) => setTimeout(r, RETRY_BASE_MS * (attempt + 1)));
      }
    }
  }

  throw lastError;
}
