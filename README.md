# Occupella Copilot — Chrome side panel

The agentic copilot surface: a Manifest V3 side panel wired to the
AgenticHelixis backend. Every chat turn auto-attaches the active tab's
page context, streams the orchestrator's reply and tool activity live,
and renders approve/deny confirmation cards for gated actions.

No build step — vanilla ES modules.

## Install (unpacked)

1. `chrome://extensions` → enable **Developer mode**
2. **Load unpacked** → select this folder
3. Click the Occupella icon → the side panel opens
4. Sign in with your Occupella email (6-digit code — same account as
   the web app and onboarding)

## Architecture

```
config.js          backend + Supabase endpoints (anon key baked in)
auth.js            GoTrue REST auth: OTP sign-in, refresh, storage
agent.js           /api/v1/agent/run SSE client + /agent/confirm + bootstrap
panel.js           UI: chat / reminders / actions / context tabs
platform.js        host seam: storage, network, active-page capture, badge
context-policy.js  pages the copilot never reads (PMS screens)
content.js         page-context capture (responds to panel requests)
service_worker.js  opens the panel on action click
```

### One panel, two hosts

The Occupella desktop browser (`helixiselectron`) ships these same panel
files as its built-in copilot. Only `platform.js` differs: the desktop copy
talks to the Electron main process instead of `chrome.*`. So:

- Never call `chrome.*` or `fetch` from `panel.js`, `auth.js` or `agent.js`.
  Add what you need to `platform.js` here AND to the desktop copy
  (`helixiselectron/resources/copilot/platform.js`), with the same exports.
- After changing panel files, re-sync the desktop copy:
  `node scripts/sync-copilot.mjs ../helixis-sidebar` from `helixiselectron`.

### PMS screens are never read

`context-policy.js` lists the property-management systems whose screens the
copilot never reads (Buildium, Rentvine, Rent Manager, Propertyware). Their
terms allow the documented API only, so PMS data reaches Occupella through the
backend's API connection. The check runs before any script touches the page,
and the content script is excluded from those hosts in `manifest.json`.

## Tests

```bash
node --test tests/*.test.mjs
```

Auth note: `SUPABASE_URL` must be the same project the backend
verifies JWTs against (see ADR 0003 in the AgenticHelixis repo) —
tokens minted by any other project are rejected with 401.

Page context rides on `AgentRequest.context`
(`current_page_url/title/text`), which the orchestrator injects into
the prompt — no dedicated backend endpoint.

## Slash commands

- `/new` — start a fresh thread
- `/signout`
