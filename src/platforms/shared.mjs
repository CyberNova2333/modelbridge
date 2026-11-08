// These are application budgets below the published ESA 10s/120s limits.
// They do not certify the provider's cancellation or streaming implementation.
export const PLATFORM_LIMITS = Object.freeze({
  cloudflare: Object.freeze({ maxRequestBytes: 16 * 1024 * 1024, maxSubrequests: Infinity, firstByteMs: 0, durationMs: 0 }),
  edgeone: Object.freeze({ maxRequestBytes: 1024 * 1024, maxSubrequests: Infinity, firstByteMs: 0, durationMs: 0 }),
  esa: Object.freeze({ maxRequestBytes: 16 * 1024 * 1024, maxSubrequests: 4, firstByteMs: 9000, durationMs: 115000 }),
});

export class PlatformRuntimeError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'PlatformRuntimeError';
    this.status = status;
    this.code = code;
  }
}

const cancelled = () => new PlatformRuntimeError(499, 'request_cancelled', 'Request cancelled.');
const unavailable = () => new PlatformRuntimeError(503, 'platform_unavailable', 'Platform runtime or state service is unavailable.');

export function platformErrorResponse(error, request) {
  const safe = error instanceof PlatformRuntimeError ? error : unavailable();
  const response = Response.json({ error: { type: 'platform_error', code: safe.code, message: safe.message } }, {
    status: safe.status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, DELETE',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key, x-goog-api-key, anthropic-version, anthropic-beta',
    },
  });
  if (request?.method !== 'HEAD') return response;
  cancelBody(response);
  return new Response(null, response);
}

function supportsSignal(signal) {
  return signal && typeof signal.aborted === 'boolean'
    && typeof signal.addEventListener === 'function' && typeof signal.removeEventListener === 'function';
}

function cancelBody(value) {
  try { Promise.resolve(value?.body?.cancel()).catch(() => {}); } catch { /* Already consumed. */ }
}

// Settle even when a platform fetch/reader does not settle after abort. The real
// signal is still forwarded; local settlement is not proof of upstream shutdown.
function waitWithSignal(pending, signal, onLateValue = () => {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const onAbort = () => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      reject(signal.reason instanceof PlatformRuntimeError ? signal.reason : cancelled());
    };
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
    Promise.resolve(pending).then(value => {
      if (settled) { onLateValue(value); return; }
      settled = true;
      signal.removeEventListener('abort', onAbort);
      resolve(value);
    }, error => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      reject(error);
    });
  });
}

function validateEsaTarget(input) {
  let url;
  try { url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url); }
  catch { throw new PlatformRuntimeError(502, 'platform_fetch_target_invalid', 'The upstream address is unsupported by this platform.'); }
  // ESA accepts domain names on HTTP 80 / HTTPS 443, not literal IP addresses.
  // URL canonicalization catches alternate numeric IPv4 spellings as well.
  if (!['http:', 'https:'].includes(url.protocol) || url.port || url.username || url.password
      || url.hostname.startsWith('[') || /^\d+(?:\.\d+){3}$/.test(url.hostname)
      || new TextEncoder().encode(url.href).byteLength > 4096) {
    throw new PlatformRuntimeError(502, 'platform_fetch_target_invalid', 'The upstream address is unsupported by this platform.');
  }
}

export function platformClientIp(platform, request) {
  // request.eo is runtime metadata. Never accept a caller-supplied forwarding
  // header as the login limiter identity on these adapters.
  // Only the Cloudflare adapter accepts its edge-injected header, and only on a
  // request carrying Cloudflare runtime metadata. Synthetic/local requests use
  // a shared conservative bucket rather than trusting forwarding headers.
  const ip = platform === 'edgeone' ? request.eo?.clientIp
    : platform === 'cloudflare' && request.cf && typeof request.cf === 'object' ? request.headers.get('CF-Connecting-IP')
    : undefined;
  return typeof ip === 'string' && ip.length > 0 && ip.length <= 64 && /^[0-9a-fA-F:.]+$/.test(ip)
    ? ip : `${platform}-unverified`;
}

export function createRequestRuntime({ platform, request, fetch: fetchImpl = globalThis.fetch, timers = globalThis }) {
  const limits = PLATFORM_LIMITS[platform];
  if (!limits || typeof fetchImpl !== 'function' || typeof globalThis.AbortController !== 'function'
      || !supportsSignal(request.signal)) {
    throw new PlatformRuntimeError(503, 'platform_abort_unavailable', 'Native request cancellation support is required.');
  }
  const controller = new AbortController();
  const cleanups = [];
  let firstTimer, durationTimer, disposed = false, used = 0;
  const abort = error => { if (!controller.signal.aborted) controller.abort(error); };
  const onClientAbort = () => abort(cancelled());
  request.signal.addEventListener('abort', onClientAbort, { once: true });
  cleanups.push(() => request.signal.removeEventListener('abort', onClientAbort));
  if (request.signal.aborted) onClientAbort();

  const clearFirstTimer = () => {
    if (firstTimer !== undefined) timers.clearTimeout(firstTimer);
    firstTimer = undefined;
  };
  function dispose() {
    if (disposed) return;
    disposed = true;
    clearFirstTimer();
    if (durationTimer !== undefined) timers.clearTimeout(durationTimer);
    for (const cleanup of cleanups.splice(0)) cleanup();
  }
  function assertActive() {
    if (controller.signal.aborted) throw controller.signal.reason;
    if (disposed) throw unavailable();
  }
  function fetchSignal(source) {
    if (!source || source === controller.signal) return controller.signal;
    if (!supportsSignal(source)) throw unavailable();
    const combined = new AbortController();
    const onRequestAbort = () => combined.abort(controller.signal.reason);
    const onFetchAbort = () => combined.abort(cancelled());
    controller.signal.addEventListener('abort', onRequestAbort, { once: true });
    source.addEventListener('abort', onFetchAbort, { once: true });
    cleanups.push(() => {
      controller.signal.removeEventListener('abort', onRequestAbort);
      source.removeEventListener('abort', onFetchAbort);
    });
    if (controller.signal.aborted) onRequestAbort();
    else if (source.aborted) onFetchAbort();
    return combined.signal;
  }

  async function budgetedFetch(input, init = {}) {
    assertActive();
    if (platform === 'esa') validateEsaTarget(input);
    const signal = fetchSignal(init.signal ?? (typeof input === 'object' ? input.signal : undefined));
    if (signal.aborted) throw signal.reason;
    if (used >= limits.maxSubrequests) {
      throw new PlatformRuntimeError(503, 'platform_subrequest_limit', 'The platform subrequest budget is exhausted.');
    }
    // Reserve synchronously, including failed requests and state-service calls.
    used += 1;
    return waitWithSignal(fetchImpl(input, { ...init, redirect: 'manual', signal }), signal, cancelBody);
  }

  async function run(operation) {
    let reader, response;
    const cancelReader = reason => {
      if (!reader) return;
      try { Promise.resolve(reader.cancel(reason)).catch(() => {}); } catch { /* Reader already closed. */ }
    };
    try {
      assertActive();
      if (limits.firstByteMs) firstTimer = timers.setTimeout(() => abort(new PlatformRuntimeError(
        504, 'platform_first_byte_timeout', 'The platform first-byte deadline was exceeded.')), limits.firstByteMs);
      if (limits.durationMs) durationTimer = timers.setTimeout(() => abort(new PlatformRuntimeError(
        504, 'platform_duration_timeout', 'The platform request duration limit was exceeded.')), limits.durationMs);
      response = await waitWithSignal(Promise.resolve().then(operation), controller.signal, cancelBody);
      assertActive();
      if (!response || typeof response.status !== 'number') throw unavailable();
      if (!response?.body || request.method === 'HEAD') {
        if (request.method === 'HEAD') cancelBody(response);
        dispose();
        return request.method === 'HEAD' ? new Response(null, response) : response;
      }
      reader = response.body.getReader();
      let first;
      if (limits.firstByteMs) {
        // Empty chunks do not satisfy the gateway's first-data deadline.
        do { first = await waitWithSignal(reader.read(), controller.signal); }
        while (!first.done && first.value?.byteLength === 0);
        clearFirstTimer();
        if (first.done) {
          dispose();
          return new Response(null, response);
        }
      }
      let ended = false;
      const stream = new ReadableStream({
        start(output) {
          const onAbort = () => {
            if (ended) return;
            ended = true;
            cancelReader(controller.signal.reason);
            output.error(controller.signal.reason);
            dispose();
          };
          controller.signal.addEventListener('abort', onAbort, { once: true });
          cleanups.push(() => controller.signal.removeEventListener('abort', onAbort));
          if (controller.signal.aborted) onAbort();
        },
        async pull(output) {
          if (ended) return;
          try {
            const item = first ?? await waitWithSignal(reader.read(), controller.signal);
            first = undefined;
            if (ended) return;
            if (item.done) {
              ended = true;
              output.close();
              dispose();
            } else output.enqueue(item.value);
          } catch {
            if (ended) return;
            ended = true;
            const error = controller.signal.aborted ? controller.signal.reason
              : new PlatformRuntimeError(502, 'platform_response_failed', 'The response stream failed.');
            abort(error);
            cancelReader(error);
            output.error(error);
            dispose();
          }
        },
        cancel() {
          ended = true;
          const error = cancelled();
          abort(error);
          cancelReader(error);
          dispose();
        },
      }, { highWaterMark: 0 });
      return new Response(stream, response);
    } catch (error) {
      const safe = controller.signal.aborted ? controller.signal.reason : error;
      abort(safe instanceof PlatformRuntimeError ? safe : unavailable());
      cancelReader(safe);
      if (!reader) cancelBody(response);
      dispose();
      return platformErrorResponse(safe, request);
    }
  }

  return {
    fetch: budgetedFetch, signal: controller.signal, clientIp: platformClientIp(platform, request),
    hasFetchBudget: count => Number.isSafeInteger(count) && count >= 0 && !disposed
      && !controller.signal.aborted && count <= limits.maxSubrequests - used,
    maxRequestBytes: limits.maxRequestBytes, get subrequestsUsed() { return used; }, run, dispose,
  };
}

export async function runPlatformRequest({ platform, request, env = {}, context, gatewayFactory, stateFactory, fetchImpl, timers }) {
  let runtime, forwardedRequest;
  try {
    runtime = createRequestRuntime({ platform, request, fetch: fetchImpl, timers });
    const response = await runtime.run(() => {
      if (!env.ADMIN_PASSWORD || !env.MODELBRIDGE_STATE_URL || !env.MODELBRIDGE_STATE_TOKEN) throw unavailable();
      const length = request.headers.get('content-length');
      if (length && /^\d+$/.test(length) && Number(length) > runtime.maxRequestBytes) {
        throw new PlatformRuntimeError(413, 'platform_request_too_large', 'Request body exceeds the platform size limit.');
      }
      const state = stateFactory({
        url: env.MODELBRIDGE_STATE_URL, token: env.MODELBRIDGE_STATE_TOKEN,
        fetch: runtime.fetch, origin: new URL(request.url).origin, signal: runtime.signal,
      });
      const gateway = gatewayFactory({
        state, fetch: runtime.fetch, signal: runtime.signal, hasFetchBudget: runtime.hasFetchBudget,
        clientIp: runtime.clientIp, maxRequestBytes: runtime.maxRequestBytes,
      });
      // Also deliver the platform deadline to the core's incoming-body reader.
      // Client identity was captured from the original runtime request above.
      forwardedRequest = new Request(request, { signal: runtime.signal });
      return gateway.fetch(forwardedRequest, env, context);
    });
    // The gateway has either consumed the JSON body or completed a route that
    // does not need it. Release unused uploads on successful routes as well.
    cancelBody(forwardedRequest ?? request);
    return response;
  } catch (error) {
    runtime?.dispose();
    cancelBody(forwardedRequest ?? request);
    return platformErrorResponse(error, request);
  }
}
