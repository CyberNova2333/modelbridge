import assert from 'node:assert/strict';
import test from 'node:test';
import { createGateway } from '../_worker.js';
import service, { AppConfigStore } from '../src/state/service.mjs';
import { createRemoteState, STATE_REQUEST_LIMIT } from '../src/state/remote.mjs';

const token = 'fixture-state-service-token-not-a-user-credential-0123456789';
const serviceUrl = 'https://state.example/_modelbridge/state';
const firstOrigin = 'https://edgeone.example';
const secondOrigin = 'https://esa.example';
const hash = async text => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), byte => byte.toString(16).padStart(2, '0')).join('');
const configuration = () => ({
  accounts: [{ id: 'one', name: 'Fixture', provider: 'openai', accountId: '', apiToken: 'fixture-upstream-token', status: 'active', models: ['chat'] }],
  apiKeys: [{ id: 'key-one', name: 'Fixture', key: 'fixture-client-key' }],
  customModelMap: { alias: 'openai:chat' },
});

function harness(initial = configuration()) {
  const values = new Map([['config', structuredClone(initial)]]);
  const observations = { operations: [], envelopes: [], networkCalls: 0, generations: 0 };
  let queue = Promise.resolve();
  const state = {
    storage: {
      async get(key) { await Promise.resolve(); return structuredClone(values.get(key)); },
      async put(key, value) { await Promise.resolve(); values.set(key, structuredClone(value)); },
    },
    blockConcurrencyWhile(operation) { const pending = queue.then(operation); queue = pending.catch(() => {}); return pending; },
  };
  const hostEnv = { KV: { async get() { return null; } } };
  let store = new AppConfigStore(state, hostEnv);
  const env = {
    MODELBRIDGE_STATE_TOKEN: token,
    MODELBRIDGE_STATE_ORIGINS: `${firstOrigin}, ${secondOrigin}`,
    CONFIG_STORE: {
      idFromName(name) { assert.equal(name, 'app-config-v1'); return name; },
      get(id) {
        assert.equal(id, 'app-config-v1');
        return { async fetch(request) {
          observations.operations.push({ url: request.url, method: request.method });
          return store.fetch(request);
        } };
      },
    },
  };
  const transport = async (url, init) => {
    assert.equal(url, serviceUrl);
    assert.equal(init.method, 'POST');
    assert.equal(init.redirect, 'manual');
    assert.equal(new Headers(init.headers).get('authorization'), `Bearer ${token}`);
    observations.networkCalls++;
    observations.envelopes.push(JSON.parse(init.body));
    return service.fetch(new Request(url, init), env);
  };
  const remote = origin => createRemoteState({ url: serviceUrl, token, origin, fetch: transport });
  const gateway = origin => createGateway({
    state: remote(origin), clientIp: 'trusted-platform-client',
    async fetch(url, init) {
      assert.equal(url, 'https://api.openai.com/v1/chat/completions');
      assert.equal(init.headers.Authorization, 'Bearer fixture-upstream-token');
      observations.generations++;
      return Response.json({ id: 'fixture', model: 'chat', choices: [{ index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }] });
    },
  });
  const gateways = new Map([[firstOrigin, gateway(firstOrigin)], [secondOrigin, gateway(secondOrigin)]]);
  const call = (path, { origin = firstOrigin, method = 'GET', body, headers = {} } = {}) => gateways.get(origin).fetch(new Request(origin + path, {
    method, headers: { 'Content-Type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }), { ADMIN_PASSWORD: 'fixture-admin-password' }, {});
  const login = async (origin = firstOrigin) => {
    const response = await call('/api/auth/login', { origin, method: 'POST', body: { password: 'fixture-admin-password' } });
    assert.equal(response.status, 200);
    return response.headers.get('set-cookie').split(';')[0];
  };
  const direct = (envelope, options = {}) => service.fetch(new Request(serviceUrl, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...options.headers },
    body: JSON.stringify(envelope),
  }), options.env || env);
  return { values, observations, env, remote, call, login, direct, restart() { store = new AppConfigStore(state, hostEnv); } };
}

test('remote state serves public gateway generation and shared revocation through the real state service', async () => {
  const h = harness();
  const cookie = await h.login();
  const generated = await h.call('/v1/chat/completions', {
    origin: secondOrigin, method: 'POST', headers: { Authorization: 'Bearer fixture-client-key' },
    body: { model: 'alias', messages: [{ role: 'user', content: 'Hello' }] },
  });
  assert.equal(generated.status, 200);
  assert.equal((await generated.json()).choices[0].message.content, 'OK');
  assert.equal(h.observations.generations, 1);
  const removed = await h.call('/api/keys', { method: 'DELETE', headers: { Cookie: cookie }, body: { id: 'key-one' } });
  assert.equal(removed.status, 200);
  const saved = await h.call('/api/settings', { method: 'POST', headers: { Cookie: cookie }, body: { customModelMap: { newer: 'openai:chat' } } });
  assert.equal(saved.status, 200);
  h.restart();
  for (const origin of [firstOrigin, secondOrigin]) {
    const denied = await h.call('/v1/chat/completions', {
      origin, method: 'POST', headers: { Authorization: 'Bearer fixture-client-key' },
      body: { model: 'newer', messages: [{ role: 'user', content: 'Hello again' }] },
    });
    assert.equal(denied.status, 401);
  }
  assert.equal(h.observations.generations, 1);
  assert.deepEqual(h.values.get('config').apiKeys, []);
  assert.ok(h.observations.envelopes.some(item => item.path === '/auth'));
  assert.ok(h.observations.envelopes.every(item => !JSON.stringify(item).includes('fixture-admin-password')));
});

test('origin-bound sessions cannot authorize another registered gateway origin', async () => {
  const h = harness();
  const cookie = await h.login();
  assert.equal((await h.call('/api/keys', { headers: { Cookie: cookie } })).status, 200);
  assert.equal((await h.call('/api/keys', { origin: secondOrigin, headers: { Cookie: cookie } })).status, 401);
  assert.equal((await h.call('/api/auth/logout', { method: 'POST', headers: { Cookie: cookie } })).status, 200);
  h.restart();
  assert.equal((await h.call('/api/keys', { headers: { Cookie: cookie } })).status, 401);
});

test('unauthenticated service callers and incomplete service configurations fail before DO access', async () => {
  const h = harness();
  const envelope = { path: '/', method: 'GET', body: null, origin: firstOrigin };
  for (const supplied of ['', 'Bearer fixture-client-key', 'Bearer fixture-admin-password', `Bearer ${'x'.repeat(64)}`]) {
    assert.equal((await h.direct(envelope, { headers: { Authorization: supplied } })).status, 401);
  }
  for (const name of ['MODELBRIDGE_STATE_TOKEN', 'MODELBRIDGE_STATE_ORIGINS', 'CONFIG_STORE']) {
    assert.equal((await h.direct(envelope, { env: { ...h.env, [name]: undefined } })).status, 503);
  }
  assert.equal((await h.direct(envelope, { env: { ...h.env, MODELBRIDGE_STATE_ORIGINS: '*' } })).status, 503);
  assert.equal(h.observations.operations.length, 0);
});

test('service rejects forged auth scope, unregistered origins, and caller passwords', async () => {
  const h = harness();
  const body = { type: 'login', scope: await hash('admin-origin-v3:' + firstOrigin), fingerprint: await hash('fixture-fingerprint'), passwordMatched: true, ipKey: await hash('trusted-client') };
  const envelope = { path: '/auth', method: 'POST', body, origin: firstOrigin };
  for (const invalid of [
    { ...envelope, origin: 'https://unregistered.example' },
    { ...envelope, origin: secondOrigin },
    { ...envelope, body: { ...body, scope: '0'.repeat(64) } },
    { ...envelope, body: { ...body, password: 'do-not-send-the-password' } },
    { ...envelope, body: { ...body, passwordMatched: 'true' } },
  ]) assert.equal((await h.direct(invalid)).status, 400);
  assert.equal(h.observations.operations.length, 0);
  assert.equal((await h.direct(envelope)).status, 200);
});

test('only fixed routes, methods and known operations reach the state binding', async () => {
  const h = harness();
  const envelope = { path: '/', method: 'GET', body: null, origin: firstOrigin };
  for (const path of ['https://elsewhere.example/', '//elsewhere.example/', '/auth?scope=x', '/usage?limit=21', '/usage?limit=0', '/usage?limit=01', '/usage?limit=1&limit=2', '/%61uth', '/storage', '/../']) {
    assert.equal((await h.direct({ ...envelope, path })).status, 400);
  }
  for (const changed of [
    { method: 'DELETE' }, { path: '/auth' }, { body: {} }, { storageKey: 'config' },
    { method: 'POST', body: { type: 'config.replace', config: configuration() } },
    { method: 'POST', body: { type: 'key.add', key: {} } },
  ]) assert.equal((await h.direct({ ...envelope, ...changed })).status, 400);
  assert.equal(h.observations.operations.length, 0);
  const unknown = await service.fetch(new Request('https://state.example/auth', { method: 'POST' }), h.env);
  assert.equal(unknown.status, 404);
  assert.equal((await service.fetch(new Request(serviceUrl), h.env)).status, 405);
  assert.equal(unknown.headers.get('Access-Control-Allow-Origin'), null);
});

test('account revision conflicts remain HTTP 409 and never trigger a transport retry', async () => {
  const h = harness();
  const response = await h.remote(firstOrigin).request('/', {
    method: 'POST', body: JSON.stringify({ type: 'account.upsert', account: { id: 'one', name: 'Stale edit' }, expectedAccountRevision: '0'.repeat(64) }),
  });
  assert.equal(response.status, 409);
  assert.equal(h.observations.networkCalls, 1);
  assert.equal(h.values.get('config').accounts[0].name, 'Fixture');
});

test('concurrent remote config mutations preserve every operation and empty maps', async () => {
  const h = harness();
  const operations = Array.from({ length: 8 }, (_, index) => ({ type: 'key.add', key: { id: `new-${index}`, name: 'Added', key: `fixture-added-${index}`, createdAt: new Date().toISOString() } }));
  const responses = await Promise.all(operations.map((operation, index) => h.remote(index % 2 ? firstOrigin : secondOrigin).request('/', { method: 'POST', body: JSON.stringify(operation) })));
  assert.ok(responses.every(response => response.status === 200));
  assert.equal(h.values.get('config').apiKeys.length, 9);
  assert.equal((await h.remote(firstOrigin).request('/', { method: 'POST', body: JSON.stringify({ type: 'models.replace', map: {} }) })).status, 200);
  h.restart();
  assert.deepEqual((await (await h.remote(firstOrigin).request('/')).json()).customModelMap, {});
  assert.equal((await h.remote(firstOrigin).request('/usage?limit=20')).status, 200);
});

test('transport failure after a committed mutation is not retried and contains no diagnostics', async () => {
  const h = harness();
  let calls = 0;
  const client = createRemoteState({ url: serviceUrl, token, origin: firstOrigin, async fetch(url, init) {
    calls++;
    const response = await service.fetch(new Request(url, init), h.env);
    assert.equal(response.status, 200);
    throw new Error(`lost response: ${token}`);
  } });
  const response = await client.request('/', { method: 'POST', body: JSON.stringify({ type: 'key.delete', id: 'key-one' }) });
  assert.equal(response.status, 502);
  assert.equal(calls, 1);
  assert.deepEqual(h.values.get('config').apiKeys, []);
  assert.ok(!(await response.text()).includes(token));
});

test('transport ignores reflected errors and redirect locations while preserving failures', async () => {
  for (const status of [302, 401, 409, 500]) {
    let calls = 0, cancelled = false;
    const client = createRemoteState({ url: serviceUrl, token, origin: firstOrigin, fetch() {
      calls++;
      return Promise.resolve(new Response(new ReadableStream({ cancel() { cancelled = true; } }), {
        status, headers: { Location: 'https://elsewhere.example/' + token, 'Set-Cookie': token, 'Content-Type': 'text/html' },
      }));
    } });
    const response = await client.request('/');
    assert.equal(response.status, status < 400 ? 502 : status);
    assert.equal(calls, 1);
    assert.equal(cancelled, true);
    assert.equal(response.headers.get('Location'), null);
    assert.equal(response.headers.get('Set-Cookie'), null);
    assert.ok(!(await response.text()).includes(token));
  }
});

test('response header and body deadlines settle even if the transport ignores abort', async () => {
  for (const hangAt of ['headers', 'body']) {
    let calls = 0, signal, cancelled = false;
    const client = createRemoteState({ url: serviceUrl, token, origin: firstOrigin, timeoutMs: 20, fetch(_url, init) {
      calls++; signal = init.signal;
      return hangAt === 'headers' ? new Promise(() => {}) : Promise.resolve(new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { 'Content-Type': 'application/json' } }));
    } });
    assert.equal((await client.request('/')).status, 504);
    assert.equal(calls, 1);
    assert.equal(signal.aborted, true);
    if (hangAt === 'body') assert.equal(cancelled, true);
  }
});

test('caller cancellation aborts state transport and an already cancelled call sends nothing', async () => {
  const abort = new AbortController();
  let calls = 0, signal;
  const client = createRemoteState({ url: serviceUrl, token, origin: firstOrigin, fetch(_url, init) { calls++; signal = init.signal; return new Promise(() => {}); } });
  const pending = client.request('/', { signal: abort.signal });
  abort.abort();
  assert.equal((await pending).status, 499);
  assert.equal(signal.aborted, true);
  assert.equal((await client.request('/', { signal: abort.signal })).status, 499);
  assert.equal(calls, 1);
});

test('platform deadline cancels a returned state response body even when native fetch ignores abort', async () => {
  const platform = new AbortController();
  let started, cancelled = false, transportSignal;
  const reading = new Promise(resolve => { started = resolve; });
  const client = createRemoteState({
    url: serviceUrl, token, origin: firstOrigin, signal: platform.signal,
    fetch(_url, init) {
      transportSignal = init.signal;
      return Promise.resolve(new Response(new ReadableStream({
        pull() { started(); }, cancel() { cancelled = true; },
      }), { headers: { 'Content-Type': 'application/json' } }));
    },
  });
  const pending = client.request('/');
  await reading;
  platform.abort();
  assert.equal((await pending).status, 499);
  assert.equal(cancelled, true);
  assert.equal(transportSignal.aborted, true);
});

test('an operation signal cannot replace the platform cancellation scope', async () => {
  for (const cancelParent of [true, false]) {
    const platform = new AbortController(), operation = new AbortController();
    let signal, calls = 0;
    const client = createRemoteState({
      url: serviceUrl, token, origin: firstOrigin, signal: platform.signal,
      fetch(_url, init) { calls++; signal = init.signal; return new Promise(() => {}); },
    });
    const pending = client.request('/', { signal: operation.signal });
    (cancelParent ? platform : operation).abort();
    assert.equal(signal.aborted, true);
    assert.equal((await pending).status, 499);
    assert.equal(calls, 1);
  }
  const platform = new AbortController(); platform.abort();
  let calls = 0;
  const client = createRemoteState({ url: serviceUrl, token, origin: firstOrigin, signal: platform.signal,
    fetch: async () => { calls++; return Response.json({}); } });
  assert.equal((await client.request('/', { signal: new AbortController().signal })).status, 499);
  assert.equal(calls, 0);
});

test('request and response limits count streamed bytes and reject malformed JSON', async () => {
  const h = harness();
  let cancelled = false;
  const oversized = new Request(serviceUrl, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Content-Length': '1' }, duplex: 'half',
    body: new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(STATE_REQUEST_LIMIT + 1)); }, cancel() { cancelled = true; } }),
  });
  assert.equal((await service.fetch(oversized, h.env)).status, 413);
  assert.equal(cancelled, true);
  assert.equal(h.observations.operations.length, 0);
  for (const body of ['{invalid', JSON.stringify({ large: 'x'.repeat(200) })]) {
    const client = createRemoteState({ url: serviceUrl, token, origin: firstOrigin, maxResponseBytes: 128, fetch: async () => new Response(body, { headers: { 'Content-Type': 'application/json' } }) });
    assert.equal((await client.request('/')).status, 502);
  }
});

test('client configuration cannot redirect service credentials or target arbitrary binding paths', async () => {
  for (const url of ['http://state.example/_modelbridge/state', 'https://state.example/', serviceUrl + '?token=x', serviceUrl + '#fragment', 'https://user:pass@state.example/_modelbridge/state']) {
    assert.throws(() => createRemoteState({ url, token, origin: firstOrigin }), /Invalid state service configuration/);
  }
  assert.throws(() => createRemoteState({ url: serviceUrl, token: 'short', origin: firstOrigin }), /Invalid state service configuration/);
  assert.throws(() => createRemoteState({ url: serviceUrl, token, origin: firstOrigin + '/' }), /Invalid state service configuration/);
  let calls = 0;
  const client = createRemoteState({ url: serviceUrl, token, origin: firstOrigin, fetch: async () => { calls++; return Response.json({}); } });
  assert.equal((await client.request('https://other.example/')).status, 400);
  assert.equal((await client.request('/', { method: 'DELETE' })).status, 400);
  assert.equal((await client.request('/', { method: 'POST', body: 'x'.repeat(STATE_REQUEST_LIMIT + 1) })).status, 413);
  assert.equal(calls, 0);
});

test('state operation hashes reject coercible arrays without modifying configuration or sessions', async () => {
  const h = harness();
  const cookie = await h.login();
  const before = structuredClone(h.values), operationCount = h.observations.operations.length;
  const login = {
    type: 'login', scope: await hash('admin-origin-v3:' + firstOrigin),
    fingerprint: await hash('admin-session-v3:fixture-admin-password'),
    ipKey: await hash('trusted-client'), passwordMatched: true,
  };
  const envelopes = ['scope', 'fingerprint', 'ipKey'].map(field => ({
    path: '/auth', method: 'POST', origin: firstOrigin,
    body: { ...login, [field]: [login[field]] },
  }));
  envelopes.push({
    path: '/', method: 'POST', origin: firstOrigin,
    body: { type: 'account.upsert', account: { id: 'one', name: 'Must not change' },
      expectedAccountRevision: [await hash(JSON.stringify(before.get('config').accounts[0]))] },
  }, {
    path: '/', method: 'POST', origin: firstOrigin,
    body: { type: 'account.upsert', account: {
      provider: 'antigravity', accountId: 'fixture@example.com', apiToken: '1//fixture', status: 'disabled',
    }, antigravityProject: { projectId: 'fixture-project', projectSource: 'auto', projectIdentity: [await hash('identity')] } },
  });
  for (const envelope of envelopes) assert.equal((await h.direct(envelope)).status, 400);
  assert.equal(h.observations.operations.length, operationCount, 'invalid hashes must be rejected before storage');
  assert.deepEqual(h.values, before);
  assert.equal((await h.call('/api/keys', { headers: { Cookie: cookie } })).status, 200);
});
