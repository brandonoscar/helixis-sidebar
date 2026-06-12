// Helixis Copilot — AgenticHelixis backend client.
//
// Speaks the same protocol as the web frontend's services/agent.ts:
//   POST /api/v1/agent/run  → SSE stream of `data: {type,data,timestamp}`
//                             lines, terminated by `data: [DONE]`
//   POST /api/v1/agent/confirm — resolve a pending confirmation card
//   POST /api/v1/auth/bootstrap — idempotent company provisioning
//
// Page context is passed via AgentRequest.context, which the
// orchestrator serializes into the prompt as a `Context:` block —
// no backend changes required.

import { API_URL } from './config.js';
import { getAccessToken } from './auth.js';

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
    this.name = 'ApiError';
  }
}

export async function apiFetch(path, options = {}) {
  const token = await getAccessToken();
  if (!token) throw new ApiError(401, 'Not signed in');

  const headers = { Authorization: `Bearer ${token}`, ...(options.headers ?? {}) };
  if (options.body) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${API_URL}${path}`, { ...options, headers });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (typeof body?.detail === 'string') detail = body.detail;
    } catch {
      /* non-JSON body */
    }
    throw new ApiError(res.status, detail);
  }
  return res;
}

/** Idempotently ensure the user's company exists; returns company_id. */
export async function bootstrapCompany() {
  const res = await apiFetch('/api/v1/auth/bootstrap', { method: 'POST' });
  const body = await res.json();
  return body.company_id;
}

/**
 * Run an agent task, streaming events to the callbacks.
 *
 * @param {object} opts
 * @param {string} opts.task           user message
 * @param {string} opts.companyId
 * @param {string} [opts.sessionId]    thread continuity across turns
 * @param {object} [opts.context]      e.g. {url, title, page_text}
 * @param {(ev: {type:string,data:object}) => void} opts.onEvent
 * @param {(err: Error) => void} opts.onError
 * @param {() => void} opts.onDone
 * @returns {Promise<AbortController>}
 */
export async function runAgent({ task, companyId, sessionId, context, onEvent, onError, onDone }) {
  const controller = new AbortController();

  let response;
  try {
    response = await apiFetch('/api/v1/agent/run', {
      method: 'POST',
      body: JSON.stringify({
        task,
        company_id: companyId,
        session_id: sessionId,
        context: context ?? {},
      }),
      signal: controller.signal,
    });
  } catch (err) {
    onError(err instanceof Error ? err : new Error(String(err)));
    return controller;
  }

  (async () => {
    try {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          onDone();
          return;
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line === 'data: [DONE]') {
            onDone();
            return;
          }
          if (line.startsWith('data: ')) {
            try {
              onEvent(JSON.parse(line.slice(6)));
            } catch {
              /* skip malformed event */
            }
          }
        }
      }
    } catch (err) {
      if (err?.name !== 'AbortError') {
        onError(err instanceof Error ? err : new Error(String(err)));
      }
    }
  })();

  return controller;
}

/** Approve or deny a pending confirmation card. */
export async function confirmAction(confirmId, approved) {
  const res = await apiFetch('/api/v1/agent/confirm', {
    method: 'POST',
    body: JSON.stringify({ confirm_id: confirmId, approved }),
  });
  return res.json();
}
