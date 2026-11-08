import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createRequestRuntime, platformClientIp, runPlatformRequest,
} from '../src/platforms/shared.mjs';
import { createEdgeOneHandler } from '../src/platforms/edgeone.mjs';
import { createEsaHandler } from '../src/platforms/esa.mjs';

const tick = () => new Promise(resolve => setImmediate(resolve));
const request = (options = {}) => new Request('https://gateway.example/v1/chat/completions', options);
const env = {
  ADMIN_PASSWORD: 'fixture-password', MODELBRIDGE_STATE_URL: 'https://state.example',
  MODELBRIDGE_STATE_TOKEN: 'fixture-state-token',
};
function clock() {
  const jobs = new Set();
  return {
    setTimeout(fn, ms) { const job = { fn, ms }; jobs.add(job); return job; },
    clearTimeout(job) { jobs.delete(job); },
    fire(ms) {
      const job = [...jobs].find(candidate => candidate.ms === ms);
      assert.ok(job, `active timer ${ms}`);
      jobs.delete(job);
      job.fn();
    },
    get active() { return jobs.size; },
  };
}
function runtime(platform = 'esa', options = {}) {
  return createRequestRuntime({ platform, request: request(), ...options });
}

test('ESA shares a synchronous four-fetch budget across state, refresh and candidates', async () => {
  const calls = [];
  const rt = runtime('esa', { fetch: async (url, init) => {
    calls.push({ url, init });
    return new Response('OK');
  } });
  try {
    const results = await Promise.allSettled([
      rt.fetch('https://state.example/config'), rt.fetch('https://oauth.example/token'),
      rt.fetch('https://upstream.example/one'), rt.fetch('https://upstream.example/two'),
      rt.fetch('https://upstream.example/three'),
    ]);
    assert.deepEqual(results.map(result => result.status), ['fulfilled', 'fulfilled', 'fulfilled', 'fulfilled', 'rejected']);
    assert.equal(results[4].reason.code, 'platform_subrequest_limit');
    assert.equal(calls.length, 4);
    assert.equal(rt.subrequestsUsed, 4);
    assert.ok(calls.every(call => call.init.redirect === 'manual'));
  } finally { rt.dispose(); }
});

test('failed fetches consume ESA budget and redirects are never followed automatically', async () => {
  let calls = 0;
  const rt = runtime('esa', { fetch: async (_url, init) => {
    calls++;
    assert.equal(init.redirect, 'manual');
    if (calls === 1) throw new Error('uncertain network outcome');
    return new Response(null, { status: 302, headers: { location: 'https://other.example' } });
  } });
  try {
    await assert.rejects(rt.fetch('https://upstream.example'), /uncertain/);
    for (let i = 0; i < 3; i++) assert.equal((await rt.fetch('https://upstream.example', { redirect: 'follow' })).status, 302);
    await assert.rejects(rt.fetch('https://upstream.example'), error => error.code === 'platform_subrequest_limit');
    assert.equal(calls, 4);
  } finally { rt.dispose(); }
});

test('ESA refuses unsupported targets before any network call without exposing the URL', async () => {
  let calls = 0;
  const rt = runtime('esa', { fetch: async () => { calls++; return new Response(); } });
  try {
    for (const url of [
      'https://127.0.0.1', 'http://2130706433', 'https://[::1]', 'https://upstream.example:8443',
      'http://upstream.example:8000', 'ftp://upstream.example', 'https://private:secret@upstream.example',
      'https://upstream.example/' + 'x'.repeat(4096),
    ]) {
      await assert.rejects(rt.fetch(url), error => error.code === 'platform_fetch_target_invalid' && !error.message.includes(url));
    }
    assert.equal(calls, 0);
    assert.equal(rt.subrequestsUsed, 0);
    await rt.fetch('https://upstream.example:443');
    await rt.fetch(new Request('http://upstream.example:80'));
    assert.equal(calls, 2);
  } finally { rt.dispose(); }
});

test('only EdgeOne runtime IP metadata is trusted, never client-supplied proxy headers', () => {
  const req = request({ headers: {
    'cf-connecting-ip': '192.0.2.1', 'x-forwarded-for': '192.0.2.2',
    'ali-real-client-ip': '192.0.2.3', 'eo-connecting-ip': '192.0.2.4',
  } });
  assert.equal(platformClientIp('esa', req), 'esa-unverified');
  assert.equal(platformClientIp('edgeone', req), 'edgeone-unverified');
  Object.defineProperty(req, 'eo', { value: { clientIp: '2001:db8::42' } });
  assert.equal(platformClientIp('edgeone', req), '2001:db8::42');
  assert.equal(platformClientIp('esa', req), 'esa-unverified');
});

test('missing native request cancellation support fails closed before creating state or fetching', async () => {
  let reached = false;
  const response = await runPlatformRequest({
    platform: 'edgeone', request: { url: 'https://gateway.example', headers: new Headers() }, env,
    gatewayFactory() { reached = true; }, stateFactory() { reached = true; },
  });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, 'platform_abort_unavailable');
  assert.equal(reached, false);
});

test('adapter passes one budgeted fetch to state and gateway and preserves request context', async () => {
  const req = request();
  const ctx = { waitUntil() {} };
  let sharedFetch, calls = 0;
  const state = {};
  const response = await runPlatformRequest({
    platform: 'edgeone', request: req, env, context: ctx,
    fetchImpl: async () => { calls++; return new Response('state'); },
    stateFactory(options) {
      assert.equal(options.url, env.MODELBRIDGE_STATE_URL);
      assert.equal(options.token, env.MODELBRIDGE_STATE_TOKEN);
      assert.equal(options.origin, 'https://gateway.example');
      assert.equal(options.signal.aborted, false);
      sharedFetch = options.fetch;
      return state;
    },
    gatewayFactory(options) {
      assert.equal(options.state, state);
      assert.equal(options.fetch, sharedFetch);
      assert.equal(options.maxRequestBytes, 1024 * 1024);
      assert.equal(options.clientIp, 'edgeone-unverified');
      return { async fetch(actualRequest, actualEnv, actualContext) {
        assert.notEqual(actualRequest, req);
        assert.equal(actualRequest.url, req.url);
        assert.equal(actualRequest.signal.aborted, false);
        assert.equal(actualEnv, env);
        assert.equal(actualContext, ctx);
        await options.fetch('https://state.example');
        return new Response('gateway');
      } };
    },
  });
  assert.equal(await response.text(), 'gateway');
  assert.equal(calls, 1);
});

test('missing deployment configuration and unexpected errors do not expose secrets', async () => {
  for (const field of ['ADMIN_PASSWORD', 'MODELBRIDGE_STATE_URL', 'MODELBRIDGE_STATE_TOKEN']) {
    let reached = false;
    const response = await runPlatformRequest({
      platform: 'edgeone', request: request(), env: { ...env, [field]: '' },
      gatewayFactory() { reached = true; }, stateFactory() { reached = true; },
    });
    assert.equal(response.status, 503);
    assert.equal(reached, false);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  const response = await runPlatformRequest({
    platform: 'edgeone', request: request(), env,
    stateFactory() { throw new Error(env.MODELBRIDGE_STATE_TOKEN); },
  });
  assert.equal(response.status, 503);
  assert.ok(!(await response.text()).includes(env.MODELBRIDGE_STATE_TOKEN));
});

test('Makers rejects an oversized content-length before state access', async () => {
  let reached = false, cancelled = false;
  const response = await runPlatformRequest({
    platform: 'edgeone', request: request({
      method: 'POST', headers: { 'content-length': String(1024 * 1024 + 1) },
      body: new ReadableStream({ cancel() { cancelled = true; } }), duplex: 'half',
    }), env,
    gatewayFactory() { reached = true; }, stateFactory() { reached = true; },
  });
  assert.equal(response.status, 413);
  assert.equal(reached, false);
  assert.equal(cancelled, true);
});

test('ESA deadline starts before state access and bounds a fetch that ignores abort', async () => {
  const timers = clock();
  let signal, finish;
  const rt = runtime('esa', { timers, fetch: async (_url, init) => {
    signal = init.signal;
    return new Promise(resolve => { finish = resolve; });
  } });
  const pending = rt.run(async () => rt.fetch('https://state.example'));
  await tick();
  timers.fire(9000);
  const response = await pending;
  assert.equal(response.status, 504);
  assert.equal((await response.json()).error.code, 'platform_first_byte_timeout');
  assert.equal(signal.aborted, true);
  assert.equal(timers.active, 0);
  let cancelled = false;
  finish(new Response(new ReadableStream({ cancel() { cancelled = true; } })));
  await tick();
  assert.equal(cancelled, true);
  assert.equal(rt.subrequestsUsed, 1);
});

test('headers and empty stream chunks cannot bypass ESA first-byte deadline', async () => {
  const timers = clock();
  let cancelled = false;
  const rt = runtime('esa', { timers });
  const pending = rt.run(() => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array()); },
    cancel() { cancelled = true; },
  }), { headers: { 'content-type': 'text/event-stream' } }));
  await tick();
  timers.fire(9000);
  const response = await pending;
  assert.equal(response.status, 504);
  assert.equal(cancelled, true);
  assert.equal(timers.active, 0);
});

test('ESA streaming retains its total deadline and never appends a successful terminator', async () => {
  const timers = clock();
  let cancelled = false;
  const rt = runtime('esa', { timers });
  const response = await rt.run(() => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode('data: first\n\n')); },
    cancel() { cancelled = true; },
  }), { headers: { 'content-type': 'text/event-stream' } }));
  assert.equal(timers.active, 1);
  const reader = response.body.getReader();
  assert.equal(new TextDecoder().decode((await reader.read()).value), 'data: first\n\n');
  const next = reader.read();
  timers.fire(115000);
  await assert.rejects(next, error => error.code === 'platform_duration_timeout');
  assert.equal(cancelled, true);
  assert.equal(rt.signal.aborted, true);
  assert.equal(timers.active, 0);
});

test('native request abort reaches upstream without another attempt and clears timers', async () => {
  const client = new AbortController();
  const timers = clock();
  let signal;
  const rt = runtime('esa', {
    request: request({ signal: client.signal }), timers,
    fetch: async (_url, init) => { signal = init.signal; return new Promise(() => {}); },
  });
  const pending = rt.run(() => rt.fetch('https://upstream.example'));
  await tick();
  client.abort(new Error('untrusted cancellation reason'));
  const response = await pending;
  assert.equal(response.status, 499);
  assert.ok(!(await response.text()).includes('untrusted'));
  assert.equal(signal.aborted, true);
  assert.equal(rt.subrequestsUsed, 1);
  assert.equal(timers.active, 0);
});

test('a fetch-specific abort is forwarded without aborting unrelated work', async () => {
  const operation = new AbortController();
  let signal;
  const rt = runtime('edgeone', { fetch: async (_url, init) => {
    signal = init.signal;
    return new Promise(() => {});
  } });
  try {
    const pending = rt.fetch('https://upstream.example', { signal: operation.signal });
    operation.abort();
    await assert.rejects(pending, error => error.code === 'request_cancelled');
    assert.equal(signal.aborted, true);
    assert.equal(rt.signal.aborted, false);
  } finally { rt.dispose(); }
});

test('downstream stream cancellation reaches reader and upstream and releases timers', async () => {
  for (const platform of ['edgeone', 'esa']) {
    const timers = clock();
    let cancelled = false, signal;
    const rt = runtime(platform, { timers, fetch: async (_url, init) => {
      signal = init.signal;
      return new Response(new ReadableStream({
        start(controller) { controller.enqueue(new TextEncoder().encode('first')); },
        cancel() { cancelled = true; },
      }));
    } });
    const response = await rt.run(() => rt.fetch('https://upstream.example'));
    await response.body.cancel();
    assert.equal(cancelled, true);
    assert.equal(signal.aborted, true);
    assert.equal(timers.active, 0);
  }
});

test('successful responses, empty bodies and HEAD release all deadline resources', async () => {
  for (const result of [() => new Response('OK'), () => new Response(''), () => new Response(null, { status: 204 })]) {
    const timers = clock();
    const rt = runtime('esa', { timers });
    const response = await rt.run(result);
    await response.text();
    assert.equal(timers.active, 0);
    assert.equal(rt.signal.aborted, false);
  }
  const timers = clock();
  let cancelled = false;
  const rt = runtime('esa', { request: request({ method: 'HEAD' }), timers });
  const response = await rt.run(() => new Response(new ReadableStream({ cancel() { cancelled = true; } })));
  assert.equal(response.body, null);
  assert.equal(cancelled, true);
  assert.equal(timers.active, 0);
});

test('ESA deadline cancels a hanging incoming JSON reader through the actual gateway', async () => {
  const timers = clock();
  let cancelled = false, stateCalls = 0;
  const handler = createEsaHandler({ timers, stateFactory: () => ({ request() { stateCalls++; throw new Error('unexpected state access'); } }) });
  const incoming = new Request('https://gateway.example/api/auth/login', {
    method: 'POST', body: new ReadableStream({ cancel() { cancelled = true; } }), duplex: 'half',
  });
  const pending = handler.fetch(incoming, {}, env);
  await tick();
  timers.fire(9000);
  const response = await pending;
  assert.equal(response.status, 504);
  assert.equal(cancelled, true);
  assert.equal(stateCalls, 0);
  assert.equal(timers.active, 0);
});

test('Makers actual UTF-8 request bytes are bounded even with a forged short content-length', async () => {
  let upstreamCalls = 0;
  const handler = createEdgeOneHandler({
    stateFactory: () => ({ request: async () => Response.json({
      accounts: [{ id: 'one', provider: 'openai', apiToken: 'fixture-upstream', status: 'active', models: [] }],
      apiKeys: [{ key: 'fixture-client' }], customModelMap: { chat: 'openai:model' },
    }) }),
    fetchImpl: async () => { upstreamCalls++; throw new Error('unexpected generation'); },
  });
  const incoming = request({
    method: 'POST', headers: { authorization: 'Bearer fixture-client', 'content-length': '1' },
    body: JSON.stringify({ model: 'chat', messages: [{ role: 'user', content: '你'.repeat(360000) }] }),
  });
  const response = await handler({ request: incoming, env });
  assert.equal(response.status, 413);
  assert.equal(upstreamCalls, 0);
});

test('platform entrypoints preserve their native parameter order and ignore spoofed IP headers', async () => {
  const buckets = [];
  const dependencies = { stateFactory: () => ({ request: async (path, init) => {
    assert.equal(path, '/auth');
    buckets.push(JSON.parse(init.body).ipKey);
    return Response.json({ success: false });
  } }) };
  const esa = createEsaHandler(dependencies);
  for (const ip of ['192.0.2.1', '192.0.2.2']) {
    const incoming = new Request('https://gateway.example/api/auth/login', {
      method: 'POST', headers: { 'cf-connecting-ip': ip }, body: JSON.stringify({ password: 'wrong' }),
    });
    const response = await esa.fetch(incoming, { waitUntil() {} }, env);
    assert.equal(response.status, 401);
    await response.text();
  }
  assert.equal(buckets.length, 2);
  assert.equal(buckets[0], buckets[1]);
});

test('ESA deadline cancels a stalled state-service response body after headers arrive', async () => {
  const timers = clock();
  let cancelled = false, networkCalls = 0;
  const handler = createEsaHandler({ timers, fetchImpl: async () => {
    networkCalls++;
    return new Response(new ReadableStream({ cancel() { cancelled = true; } }), {
      headers: { 'content-type': 'application/json' },
    });
  } });
  const pending = handler.fetch(new Request('https://gateway.example/v1/models', {
    headers: { authorization: 'Bearer fixture-client' },
  }), {}, {
    ...env, MODELBRIDGE_STATE_URL: 'https://state.example/_modelbridge/state',
    MODELBRIDGE_STATE_TOKEN: 'fixture-state-token-long-enough-0123456789',
  });
  await tick();
  timers.fire(9000);
  const response = await pending;
  assert.equal(response.status, 504);
  assert.equal(cancelled, true);
  assert.equal(networkCalls, 1);
  assert.equal(timers.active, 0);
});

test('ESA rejects an unaffordable Cloudflare connection test before any partial paid probes', async () => {
  const calls = [];
  const handler = createEsaHandler({
    stateFactory: ({ fetch }) => ({ request: path => fetch('https://state.example/' + (path === '/auth' ? 'auth' : 'config')) }),
    fetchImpl: async url => {
      calls.push(String(url));
      if (url === 'https://state.example/auth') return Response.json({ valid: true });
      if (url === 'https://state.example/config') return Response.json({
        accounts: [{ id: 'existing-cf', provider: 'cloudflare', accountId: 'fixture-account', apiToken: 'fixture-upstream', status: 'active' }],
        apiKeys: [], customModelMap: {},
      });
      return Response.json({ success: true, data: { viewer: { accounts: [] } } });
    },
  });
  const response = await handler.fetch(new Request('https://gateway.example/api/accounts/test', {
    method: 'POST', headers: { cookie: 'admin_token=as2_' + 'a'.repeat(64) }, body: JSON.stringify({ id: 'existing-cf' }),
  }), {}, env);
  const body = await response.json();
  assert.equal(response.status, 503);
  assert.equal(body.code, 'platform_subrequest_limit');
  assert.deepEqual(calls, ['https://state.example/auth', 'https://state.example/config']);
});

test('ESA admits a new Cloudflare account diagnostic when auth plus all three probes fit', async () => {
  const calls = [];
  const handler = createEsaHandler({
    stateFactory: ({ fetch }) => ({ request(path) { assert.equal(path, '/auth'); return fetch('https://state.example/auth'); } }),
    fetchImpl: async (url, init) => {
      calls.push(String(url));
      if (url === 'https://state.example/auth') return Response.json({ valid: true });
      assert.equal(init.headers.Authorization, 'Bearer fixture-upstream');
      if (url.endsWith('/graphql')) return Response.json({ data: { viewer: { accounts: [{ aiInferenceAdaptiveGroups: [] }] } } });
      if (url.includes('/ai/run/')) return Response.json({ success: true, result: { data: [[0.1, 0.2]] } });
      assert.ok(url.endsWith('/ai/models/search?limit=1'));
      return Response.json({ success: true, result: [] });
    },
  });
  const response = await handler.fetch(new Request('https://gateway.example/api/accounts/test', {
    method: 'POST', headers: { cookie: 'admin_token=as2_' + 'a'.repeat(64) },
    body: JSON.stringify({ provider: 'cloudflare', accountId: 'fixture-account', apiToken: 'fixture-upstream' }),
  }), {}, env);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.deepEqual(body.permissions, { workersAiRead: { success: true }, workersAiEdit: { success: true }, accountAnalyticsRead: { success: true } });
  assert.equal(calls.length, 4);
  assert.equal(calls[0], 'https://state.example/auth');
  assert.equal(calls.filter(url => url.includes('/ai/run/')).length, 1);
});

test('successful routes cancel unused incoming bodies instead of leaving uploads alive', { timeout: 10000 }, async () => {
  for (const [path, method] of [['/', 'POST'], ['/v1/chat/completions', 'OPTIONS']]) {
    let cancelObserved, stateCalls = 0;
    const cancelled = new Promise(resolve => { cancelObserved = resolve; });
    const handler = createEdgeOneHandler({ stateFactory: () => ({ request() { stateCalls++; throw new Error('unused state'); } }) });
    const response = await handler({ env, request: new Request('https://gateway.example' + path, {
      method, body: new ReadableStream({ cancel() { cancelObserved(); } }), duplex: 'half',
    }) });
    assert.equal(response.status, 200);
    await cancelled;
    assert.equal(stateCalls, 0);
    await response.body?.cancel();
  }
});

test('HEAD suppresses bodies on runtime errors and missing native capabilities', async () => {
  for (const phase of ['configuration', 'state', 'signal']) {
    const incoming = new Request('https://gateway.example/', { method: 'HEAD' });
    const response = await runPlatformRequest({ platform: 'edgeone',
      request: phase === 'signal' ? { url: incoming.url, headers: incoming.headers, method: incoming.method } : incoming,
      env: phase === 'configuration' ? {} : env,
      stateFactory() { throw new Error('private-state-failure'); },
    });
    assert.equal(response.status, 503, phase);
    assert.equal(response.body, null, phase);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('content-type'), 'application/json');
  }
});
