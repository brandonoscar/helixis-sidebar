// Occupella Copilot — which pages the copilot may read as chat context.
//
// Shared by both hosts (this extension and the desktop browser, which
// enforces the same list again in its main process).
//
// Property-management systems are excluded. Occupella's terms rules for every
// PMS it connects to (AgenticHelixis design/rentvine-terms-rules.md rule 5,
// rentmanager-terms.md rule 1, propertyware-terms.md rule 1, and Buildium's
// API license, ToS §18) allow the documented API only: no scraping. Reading
// the customer's PMS screens into the agent's prompt is screen scraping, so
// PMS data reaches Occupella through the API connection and never from here.
export const NO_CONTEXT_DOMAINS = [
  'managebuilding.com', // Buildium
  'rentvine.com',
  'rentmanager.com',
  'propertyware.com',
];

/** True when the copilot may read this page. Fail closed: a URL that does
 *  not parse is not readable. */
export function contextAllowed(url) {
  let hostname;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return !NO_CONTEXT_DOMAINS.some((d) => hostname === d || hostname.endsWith(`.${d}`));
}
