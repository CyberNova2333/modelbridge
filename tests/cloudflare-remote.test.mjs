import assert from 'node:assert/strict';
import test from 'node:test';
import { createCloudflareHandler } from '../src/platforms/cloudflare.mjs';

const env = {
  ADMIN_PASSWORD: 'test-administrator-password',
  MODELBRIDGE_STATE_URL: 'https://state.example/_modelbridge/state',
  MODELBRIDGE_STATE_TOKEN: 'state-service-test-token-that-is-long-enough',
};
const config = {
  accounts: [{ id: 'upstream', provider: 'openai', apiToken: 'mock-provider-token', status: 'active', models: ['test-model'] }],
  apiKeys: [{ id: 'key', key: 'mock-client-key', name: 'client' }],
  customModelMap: { alias: 'openai:test-model' },
};
function request(path, options = {}) {
  const result = new Request('https://gateway.example' + path, options);
  Object.defineProperty(result, 'cf', { value: { colo: 'TEST' } });
  return result;
}
function completion(body = 'hello') {
  return Response.json({ id: 'mock-completion', object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content: body }, finish_reason: 'stop' }] });
}
const chat = signal => request('/v1/chat/completions', {
  method: 'POST', signal,
  headers: { Authorization: 'Bearer mock-client-key', 'Content-Type': 'application/json' },
  body: JSON.stringify({ model: 'alias', messages: [{ role: 'user', content: 'hi' }] }),
});

test('Cloudflare remote entry performs authenticated generation without KV or Durable Objects', async () => {
  const calls = [];
  const handler = createCloudflareHandler({ fetchImpl: async (url, init) => {
    calls.push({ url: String(url), init });
    return String(url) === env.MODELBRIDGE_STATE_URL ? Response.json(config) : completion();
  } });
  const response = await handler.fetch(chat(), env, {});
  assert.equal(response.status, 200);
  assert.equal((await response.json()).choices[0].message.content, 'hello');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].init.headers.Authorization, 'Bearer ' + env.MODELBRIDGE_STATE_TOKEN);
  assert.equal(JSON.parse(calls[0].init.body).origin, 'https://gateway.example');
  assert.equal(calls[1].init.headers.Authorization, 'Bearer mock-provider-token');
  assert.ok(!JSON.stringify(calls[1].init).includes(env.MODELBRIDGE_STATE_TOKEN));
});

test('incomplete or malformed remote settings fail closed even with legacy bindings present', async () => {
  let network = 0, legacy = 0;
  const handler = createCloudflareHandler({ fetchImpl: async () => { network++; throw new Error('must not call'); } });
  const bindings = {
    KV: { get() { legacy++; throw new Error('must not read'); } },
    CONFIG_STORE: { get() { legacy++; throw new Error('must not read'); }, idFromName() { legacy++; } },
  };
  const invalid = [
    ...Object.keys(env).map(key => ({ ...env, [key]: '' })),
    { ...env, MODELBRIDGE_STATE_URL: 'http://state.example/_modelbridge/state' },
    { ...env, MODELBRIDGE_STATE_URL: 'https://state.example/wrong' },
    { ...env, MODELBRIDGE_STATE_TOKEN: 'short' },
  ];
  for (const settings of invalid) {
    const response = await handler.fetch(chat(), { ...settings, ...bindings }, {});
    assert.equal(response.status, 503);
    assert.ok(!(await response.text()).includes(settings.MODELBRIDGE_STATE_TOKEN || 'not-present'));
  }
  assert.equal(network, 0);
  assert.equal(legacy, 0);
});

test('remote state failure never falls back to legacy bindings or retries generation', async () => {
  let network = 0;
  const handler = createCloudflareHandler({ fetchImpl: async () => { network++; throw new Error('mock transport detail'); } });
  const response = await handler.fetch(chat(), { ...env, CONFIG_STORE: { get() { throw new Error('legacy should not run'); } }, KV: {} }, {});
  assert.equal(response.status, 503);
  assert.equal(network, 1);
  assert.ok(!(await response.text()).includes('mock transport detail'));
});

test('Cloudflare login identity uses its runtime metadata and ignores forwarded client headers', async () => {
  const identities = [];
  const handler = createCloudflareHandler({
    stateFactory: () => ({ request() {} }),
    gatewayFactory: runtime => ({ fetch: async () => { identities.push(runtime.clientIp); return new Response('ok'); } }),
  });
  const headers = { 'CF-Connecting-IP': '203.0.113.4', 'X-Forwarded-For': '192.0.2.55', 'X-Real-IP': '192.0.2.56' };
  await (await handler.fetch(request('/', { headers }), env, {})).text();
  await (await handler.fetch(new Request('https://gateway.example/', { headers }), env, {})).text();
  await (await handler.fetch(request('/', { headers: { ...headers, 'CF-Connecting-IP': 'bad,203.0.113.4' } }), env, {})).text();
  assert.deepEqual(identities, ['203.0.113.4', 'cloudflare-unverified', 'cloudflare-unverified']);
});

test('incoming cancellation aborts a pending remote state request without generation or retry', async () => {
  const controller = new AbortController();
  let started, upstreamSignal, calls = 0;
  const ready = new Promise(resolve => { started = resolve; });
  const handler = createCloudflareHandler({ fetchImpl: async (_url, init) => {
    calls++; upstreamSignal = init.signal; started();
    return new Promise(() => {});
  } });
  const pending = handler.fetch(chat(controller.signal), env, {});
  await ready;
  controller.abort();
  const response = await pending;
  assert.equal(response.status, 499);
  assert.equal(upstreamSignal.aborted, true);
  assert.equal(calls, 1);
});

test('downstream cancellation reaches a generated stream on the remote Cloudflare entry', async () => {
  let cancelled = false, generationSignal;
  const handler = createCloudflareHandler({ fetchImpl: async (url, init) => {
    if (String(url) === env.MODELBRIDGE_STATE_URL) return Response.json(config);
    generationSignal = init.signal;
    return new Response(new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode('data: {"id":"test","choices":[{"index":0,"delta":{"content":"hello"}}]}\n\n')); },
      cancel() { cancelled = true; },
    }), { headers: { 'Content-Type': 'text/event-stream' } });
  } });
  const incoming = request('/v1/chat/completions', { method: 'POST', headers: { Authorization: 'Bearer mock-client-key' }, body: JSON.stringify({ model: 'alias', stream: true, messages: [{ role: 'user', content: 'hi' }] }) });
  const response = await handler.fetch(incoming, env, {});
  assert.equal(response.status, 200);
  const reader = response.body.getReader();
  await reader.read();
  await reader.cancel();
  assert.equal(generationSignal.aborted, true);
  assert.equal(cancelled, true);
});
