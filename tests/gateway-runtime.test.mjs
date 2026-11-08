import assert from 'node:assert/strict';
import test from 'node:test';
import { createGateway } from '../_worker.js';

const account = name => ({ id: name, provider: 'openai', apiToken: name + '-upstream', status: 'active', accountId: '', models: ['model'] });
const config = name => ({ accounts: [account(name)], apiKeys: [{ key: name + '-client' }], customModelMap: { chat: 'openai:model' } });
const request = (name, text = 'hello') => new Request('https://gateway.example/v1/chat/completions', {
  method: 'POST', headers: { authorization: 'Bearer ' + name + '-client' },
  body: JSON.stringify({ model: 'chat', messages: [{ role: 'user', content: text }] }),
});
const completion = text => Response.json({ model: 'model', choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }] });

test('concurrent gateways isolate state and outbound credentials even with one environment object', async () => {
  let arrivals = 0, release;
  const barrier = new Promise(resolve => { release = resolve; });
  const reads = { first: 0, second: 0 };
  const gateway = name => createGateway({
    state: { async request(path) {
      assert.equal(path, '/'); reads[name]++;
      if (++arrivals === 2) release();
      await barrier;
      return Response.json(config(name));
    } },
    async fetch(url, init) {
      assert.equal(String(url), 'https://api.openai.com/v1/chat/completions');
      assert.equal(init.headers.Authorization, 'Bearer ' + name + '-upstream');
      assert.equal(init.redirect, 'manual');
      return completion(name);
    },
  });
  const env = { ADMIN_PASSWORD: 'fixture-admin' };
  const results = await Promise.all(['first', 'second'].map(async name => {
    const response = await gateway(name).fetch(request(name), env);
    assert.equal(response.status, 200);
    return (await response.json()).choices[0].message.content;
  }));
  assert.deepEqual(results, ['first', 'second']);
  assert.deepEqual(reads, { first: 1, second: 1 });
  assert.deepEqual(Object.keys(env), ['ADMIN_PASSWORD']);
});

test('external state is authoritative and never falls back to a stale native binding', async () => {
  let staleReads = 0, upstream = 0;
  const current = config('first');
  const gateway = createGateway({
    state: { async request() { return Response.json(current); } },
    async fetch() { upstream++; return completion('ok'); },
  });
  const env = { ADMIN_PASSWORD: 'fixture-admin', KV: { get() { throw new Error('old KV'); } },
    CONFIG_STORE: { get() { staleReads++; throw new Error('old binding'); } } };
  assert.equal((await gateway.fetch(request('first'), env)).status, 200);
  current.apiKeys = [];
  assert.equal((await gateway.fetch(request('first'), env)).status, 401);
  assert.equal(upstream, 1);
  assert.equal(staleReads, 0);
});

test('runtime body budget counts UTF-8 bytes without trusting Content-Length', async () => {
  let upstream = 0;
  const gateway = createGateway({ maxRequestBytes: 100,
    state: { async request() { return Response.json(config('first')); } },
    async fetch() { upstream++; return completion('unexpected'); },
  });
  const incoming = request('first', '你'.repeat(30));
  incoming.headers.set('content-length', '1');
  assert.equal((await gateway.fetch(incoming, { ADMIN_PASSWORD: 'fixture-admin' })).status, 413);
  assert.equal(upstream, 0);
});

test('adapter client identity overrides spoofed Cloudflare headers in login rate limiting', async () => {
  const attempts = [];
  const gateway = createGateway({ clientIp: 'platform-shared-bucket', state: {
    async request(path, init) { assert.equal(path, '/auth'); attempts.push(JSON.parse(init.body)); return Response.json({ success: false }); },
  } });
  for (const ip of ['192.0.2.1', '192.0.2.2']) {
    const response = await gateway.fetch(new Request('https://gateway.example/api/auth/login', {
      method: 'POST', headers: { 'CF-Connecting-IP': ip }, body: JSON.stringify({ password: 'wrong' }),
    }), { ADMIN_PASSWORD: 'fixture-admin' });
    assert.equal(response.status, 401);
  }
  assert.equal(attempts[0].ipKey, attempts[1].ipKey);
  assert.equal(attempts[0].passwordMatched, false);
});

test('Cloudflare AI remains an HTTP upstream when native storage bindings are absent', async () => {
  const current = config('first');
  current.accounts = [{ ...account('first'), provider: 'cloudflare', accountId: 'cf-account', models: [] }];
  current.customModelMap.chat = '@cf/example/model';
  let calls = 0;
  const gateway = createGateway({ state: { async request() { return Response.json(current); } },
    async fetch(url, init) {
      calls++;
      assert.equal(String(url), 'https://api.cloudflare.com/client/v4/accounts/cf-account/ai/v1/chat/completions');
      assert.equal(init.headers.Authorization, 'Bearer first-upstream');
      return completion('ok');
    },
  });
  assert.equal((await gateway.fetch(request('first'), { ADMIN_PASSWORD: 'fixture-admin' })).status, 200);
  assert.equal(calls, 1);
});

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const diagnosticRequest = signal => new Request('https://gateway.example/api/accounts/test', {
  method: 'POST', signal, headers: { cookie: 'admin_token=as2_' + 'a'.repeat(64) }, body: JSON.stringify({ id: 'first' }),
});
const diagnosticState = { async request(path) { return Response.json(path === '/auth' ? { valid: true } : config('first')); } };

test('generic model-list diagnostics forward client cancellation and do not retry a pending request', { timeout: 10000 }, async () => {
  const started = deferred(), release = deferred(), client = new AbortController();
  let calls = 0, signal;
  const gateway = createGateway({ state: diagnosticState, async fetch(url, init) {
    calls++; signal = init.signal;
    assert.equal(String(url), 'https://api.openai.com/v1/models?limit=1');
    assert.equal(init.method || 'GET', 'GET');
    assert.equal(init.headers.Authorization, 'Bearer first-upstream');
    started.resolve();
    await release.promise;
    return new Response(null);
  } });
  const pending = gateway.fetch(diagnosticRequest(client.signal), { ADMIN_PASSWORD: 'fixture-admin' });
  try {
    await started.promise;
    client.abort(new Error('private-client-reason'));
    assert.equal(signal.aborted, true);
    const response = await pending;
    const body = await response.json();
    assert.equal(body.success, false);
    assert.ok(!JSON.stringify(body).includes('private-client-reason'));
    assert.equal(calls, 1);
  } finally { release.resolve(); await pending; }
});

test('generic model-list diagnostics settle even when the discarded body never finishes cancellation', { timeout: 10000 }, async () => {
  let cancelled = false, calls = 0;
  const gateway = createGateway({ state: diagnosticState, async fetch() {
    calls++;
    return new Response(new ReadableStream({ cancel() { cancelled = true; return new Promise(() => {}); } }));
  } });
  const response = await gateway.fetch(diagnosticRequest(), { ADMIN_PASSWORD: 'fixture-admin' });
  assert.equal((await response.json()).success, true);
  assert.equal(cancelled, true);
  assert.equal(calls, 1);
});

test('generic diagnostic HTTP failures remain one model-list GET with provider-specific credentials', async () => {
  for (const provider of ['openai', 'anthropic', 'gemini']) for (const status of [401, 429, 503]) {
    const current = config('first'); current.accounts[0].provider = provider;
    let calls = 0;
    const gateway = createGateway({
      state: { async request(path) { return Response.json(path === '/auth' ? { valid: true } : current); } },
      async fetch(url, init) {
        calls++;
        const target = new URL(url);
        assert.ok(target.pathname.endsWith('/models'));
        assert.equal(target.searchParams.get(provider === 'gemini' ? 'pageSize' : 'limit'), '1');
        assert.equal(init.method, 'GET');
        assert.equal(init.body, undefined);
        assert.equal(init.redirect, 'manual');
        assert.deepEqual(init.headers, provider === 'gemini' ? { 'x-goog-api-key': 'first-upstream' }
          : provider === 'anthropic' ? { 'x-api-key': 'first-upstream', 'anthropic-version': '2023-06-01' }
            : { Authorization: 'Bearer first-upstream' });
        return new Response('private-provider-diagnostic', { status });
      },
    });
    const response = await gateway.fetch(diagnosticRequest(), { ADMIN_PASSWORD: 'fixture-admin' });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.success, false);
    assert.equal(body.status, status);
    assert.ok(!JSON.stringify(body).includes('private-provider-diagnostic'));
    assert.equal(calls, 1);
  }
});

for (const mode of ['generic-non-SSE', 'antigravity-non-SSE', 'antigravity-blocked-thinking']) {
  test(`${mode} settles rejection when upstream cancellation remains pending`, { timeout: 10000 }, async () => {
    const current = config('first');
    if (mode !== 'generic-non-SSE') {
      current.accounts = [{ ...account('first'), provider: 'antigravity', accountId: 'fixture@example.test',
        apiToken: 'ya29.fixture-access', projectId: 'fixture-project', projectSource: 'manual', models: [] }];
      current.customModelMap.chat = 'antigravity:' + (mode === 'antigravity-blocked-thinking' ? 'gemini-3-flash' : 'gemini-2.5-flash');
    }
    let calls = 0, cancelled = false, upstreamSignal;
    const gateway = createGateway({
      state: { async request() { return Response.json(current); } },
      async fetch(_url, init) {
        calls++; upstreamSignal = init.signal;
        return new Response(new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(mode === 'antigravity-blocked-thinking'
              ? 'data: {"promptFeedback":{"blockReason":"SAFETY"}}\n\n' : '{"unexpected":"not an event stream"}'));
          },
          // WHATWG cancellation is allowed to remain pending. The gateway must
          // stop consuming locally without relying on transport acknowledgement.
          cancel() { cancelled = true; return new Promise(() => {}); },
        }), { headers: { 'content-type': mode === 'antigravity-blocked-thinking' ? 'text/event-stream' : 'application/json' } });
      },
    });
    const response = await gateway.fetch(new Request('https://gateway.example/v1/chat/completions', {
      method: 'POST', headers: { authorization: 'Bearer first-client' },
      body: JSON.stringify({ model: 'chat', stream: mode !== 'antigravity-blocked-thinking', messages: [{ role: 'user', content: 'hello' }] }),
    }), { ADMIN_PASSWORD: 'fixture-admin' });
    assert.equal(response.status, 502);
    assert.ok((await response.json()).error);
    assert.equal(calls, 1, 'an unusable or filtered response must never repeat generation');
    assert.equal(cancelled, true);
    assert.equal(upstreamSignal.aborted, true);
  });
}

for (const cancellation of ['pending', 'throws', 'rejects', 'reader-throws']) {
test(`cancelling a pending gateway SSE read isolates ${cancellation} transport cleanup`, { timeout: 10000 }, async () => {
  let calls = 0, cancelled = false, upstreamSignal;
  const gateway = createGateway({
    state: { async request() { return Response.json(config('first')); } },
    async fetch(_url, init) {
      calls++; upstreamSignal = init.signal;
      const upstream = new Response(new ReadableStream({
        start(controller) { controller.enqueue(new TextEncoder().encode('data: {"choices":[{"index":0,"delta":{"content":"hello"}}]}\n\n')); },
        cancel() {
          cancelled = true;
          if (cancellation === 'throws') throw new Error('private-cancellation-error');
          if (cancellation === 'rejects') return Promise.reject(new Error('private-cancellation-error'));
          return new Promise(() => {});
        },
      }), { headers: { 'content-type': 'text/event-stream' } });
      if (cancellation === 'reader-throws') {
        // A conforming stream normalizes an underlying cancel throw to a
        // rejected promise (covered above). Also isolate a runtime reader shim
        // that throws synchronously after performing the native cancellation.
        const getReader = upstream.body.getReader.bind(upstream.body);
        upstream.body.getReader = () => {
          const reader = getReader(), cancel = reader.cancel.bind(reader);
          reader.cancel = reason => { void cancel(reason).catch(() => {}); throw new Error('private-reader-error'); };
          return reader;
        };
      }
      return upstream;
    },
  });
  const response = await gateway.fetch(new Request('https://gateway.example/v1/chat/completions', {
    method: 'POST', headers: { authorization: 'Bearer first-client' },
    body: JSON.stringify({ model: 'chat', stream: true, messages: [{ role: 'user', content: 'hello' }] }),
  }), { ADMIN_PASSWORD: 'fixture-admin' });
  assert.equal(response.status, 200);
  const reader = response.body.getReader();
  assert.match(new TextDecoder().decode((await reader.read()).value), /hello/);
  const pending = reader.read();
  await reader.cancel();
  assert.deepEqual(await pending, { value: undefined, done: true });
  assert.equal(cancelled, true);
  assert.equal(upstreamSignal.aborted, true);
  assert.equal(calls, 1);
});
}
