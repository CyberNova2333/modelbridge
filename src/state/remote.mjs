// This is a trusted server-to-server channel. The service token grants the same
// access as the CONFIG_STORE binding; it is never a browser/API-client token.
export const STATE_SERVICE_PATH = '/_modelbridge/state';
export const STATE_REQUEST_LIMIT = 2 * 1024 * 1024;
export const STATE_RESPONSE_LIMIT = 16 * 1024 * 1024;
const encoder = new TextEncoder();

export function validStateToken(token) {
  return typeof token === 'string' && /^[\x21-\x7e]{32,512}$/.test(token);
}

export function exactStateOrigin(origin) {
  if (typeof origin !== 'string' || origin.length > 2048) return false;
  try {
    const parsed = new URL(origin);
    return parsed.protocol === 'https:' && parsed.origin === origin && !parsed.username && !parsed.password;
  } catch { return false; }
}

export function validStateRoute(path, method) {
  if (typeof path !== 'string' || (method !== 'GET' && method !== 'POST')) return false;
  if (path === '/') return true;
  if (path === '/auth') return method === 'POST';
  return /^\/usage(?:\?limit=(?:[1-9]|1[0-9]|20))?$/.test(path);
}

export function stateError(status) {
  return Response.json({ error: 'State service request failed.' }, {
    status,
    headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });
}

export class StatePayloadError extends Error {
  constructor(status = 400) { super('Invalid state service payload.'); this.status = status; }
}

// Count actual streamed bytes; Content-Length is only an optional early bound.
export async function readStateJson(message, limit, signal) {
  const declared = message.headers.get('content-length');
  if (declared !== null && /^\d+$/.test(declared) && Number(declared) > limit) {
    void message.body?.cancel().catch(() => {});
    throw new StatePayloadError(413);
  }
  if (!message.body) throw new StatePayloadError();
  const reader = message.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let size = 0, text = '';
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    if (signal?.aborted) throw new StatePayloadError(499);
    while (true) {
      const { done, value } = await reader.read();
      if (signal?.aborted) throw new StatePayloadError(499);
      if (done) break;
      if (!(value instanceof Uint8Array)) throw new StatePayloadError();
      size += value.byteLength;
      if (size > limit) throw new StatePayloadError(413);
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text);
  } catch (error) {
    cancel();
    if (error instanceof StatePayloadError) throw error;
    throw new StatePayloadError();
  } finally {
    signal?.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
}

// The deadline covers response headers AND consumption of the response body.
// A timed-out mutation may have committed. Neither side retries that mutation.
export async function boundedStateResponse(run, { timeoutMs = 15000, maxResponseBytes = STATE_RESPONSE_LIMIT, signal, parentSignal } = {}) {
  const controller = new AbortController();
  let timer, interrupted = false, rejectInterrupted;
  const interruption = new Promise((_, reject) => { rejectInterrupted = reject; });
  interruption.catch(() => {});
  const interrupt = status => {
    if (interrupted) return;
    interrupted = true;
    rejectInterrupted(new StatePayloadError(status));
    controller.abort();
  };
  const onAbort = () => interrupt(499);
  const signals = [...new Set([signal, parentSignal].filter(Boolean))];
  for (const source of signals) source.addEventListener('abort', onAbort, { once: true });
  timer = setTimeout(() => interrupt(504), timeoutMs);
  try {
    if (signals.some(source => source.aborted)) onAbort();
    if (interrupted) return stateError(499);
    const work = (async () => {
      const response = await run(controller.signal);
      if (interrupted) { void response.body?.cancel().catch(() => {}); throw new StatePayloadError(504); }
      if (!response.ok) {
        void response.body?.cancel().catch(() => {});
        // Preserve conflict and other HTTP failures, but never proxy diagnostics,
        // Location, cookies or credentials from an unsuccessful service response.
        return stateError(response.status >= 400 && response.status <= 599 ? response.status : 502);
      }
      if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') || '')) {
        void response.body?.cancel().catch(() => {});
        return stateError(502);
      }
      let body;
      try { body = await readStateJson(response, maxResponseBytes, controller.signal); }
      catch { throw new StatePayloadError(interrupted ? 504 : 502); }
      return Response.json(body, { status: response.status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
    })();
    return await Promise.race([work, interruption]);
  } catch (error) {
    controller.abort();
    return stateError(error instanceof StatePayloadError ? error.status : 502);
  } finally {
    clearTimeout(timer);
    for (const source of signals) source.removeEventListener('abort', onAbort);
  }
}

export function createRemoteState({ url, token, fetch: transport = globalThis.fetch, origin, signal: requestSignal, timeoutMs = 15000, maxResponseBytes = STATE_RESPONSE_LIMIT } = {}) {
  let endpoint;
  try { endpoint = new URL(url); } catch { throw new TypeError('Invalid state service configuration.'); }
  if (endpoint.protocol !== 'https:' || endpoint.pathname !== STATE_SERVICE_PATH || endpoint.search || endpoint.hash || endpoint.username || endpoint.password
      || !validStateToken(token) || !exactStateOrigin(origin) || typeof transport !== 'function'
      || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000
      || !Number.isInteger(maxResponseBytes) || maxResponseBytes < 1 || maxResponseBytes > STATE_RESPONSE_LIMIT) {
    throw new TypeError('Invalid state service configuration.');
  }
  return {
    async request(path, init = {}) {
      const method = init.method || 'GET';
      if (!validStateRoute(path, method)) return stateError(400);
      let body = null;
      if (init.body !== undefined && init.body !== null) {
        if (typeof init.body !== 'string') return stateError(400);
        if (encoder.encode(init.body).byteLength > STATE_REQUEST_LIMIT) return stateError(413);
        try { body = JSON.parse(init.body); } catch { return stateError(400); }
      }
      if (method === 'GET' && body !== null) return stateError(400);
      const envelope = JSON.stringify({ path, method, body, origin });
      if (encoder.encode(envelope).byteLength > STATE_REQUEST_LIMIT) return stateError(413);
      return boundedStateResponse(signal => transport(endpoint.href, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: envelope, redirect: 'manual', signal,
      }), { timeoutMs, maxResponseBytes, signal: init.signal, parentSignal: requestSignal });
    },
  };
}
