// Run: node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contextAllowed, NO_CONTEXT_DOMAINS } from '../context-policy.js';

test('PMS screens are never readable, on any subdomain', () => {
  for (const url of [
    'https://acme.managebuilding.com/manager/app/tenants/123',
    'https://signin.managebuilding.com/',
    'https://managebuilding.com/',
    'https://ACME.RentVine.com/leases',
    'https://app.propertyware.com/pw/home',
    'https://x.api.rentmanager.com/',
  ]) {
    assert.equal(contextAllowed(url), false, url);
  }
});

test('ordinary pages and lookalike hosts stay readable', () => {
  for (const url of [
    'https://www.zillow.com/homedetails/1',
    'https://notmanagebuilding.com/',
    'https://managebuilding.com.example.org/',
    'https://app.occupella.com/',
  ]) {
    assert.equal(contextAllowed(url), true, url);
  }
});

test('unparseable URLs fail closed', () => {
  assert.equal(contextAllowed(''), false);
  assert.equal(contextAllowed('not a url'), false);
});

test('the content script skips every no-context domain', async () => {
  const { readFile } = await import('node:fs/promises');
  const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'));
  const excluded = manifest.content_scripts[0].exclude_matches ?? [];
  for (const d of NO_CONTEXT_DOMAINS) {
    assert.ok(excluded.includes(`*://*.${d}/*`), `manifest exclude_matches is missing ${d}`);
  }
});
