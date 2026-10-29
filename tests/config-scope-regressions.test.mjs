import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../_worker.js', import.meta.url), 'utf8');
let sequence = 0;
const complete = () => Response.json({ choices: [{ index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }] });
const cloudflare = (id, token) => ({ id, accountId: 'same-real-account', name: id, provider: 'cloudflare', apiToken: token, status: 'active' });
const usage = () => Response.json({ data: { viewer: { accounts: [{ aiInferenceAdaptiveGroups: [{ dimensions: { date: new Date().toISOString().slice(0, 10), modelId: '@cf/model' }, sum: { totalNeurons: 42 } }] }] } } });

async function harness({ accounts = [{ id: 'openai', accountId: '', provider: 'openai', apiToken: 'fixture-upstream', status: 'active', models: ['chat'] }], network = complete } = {}) {
  const name = '__configScopeRegression' + sequence++;
  globalThis[name] = network;
  const module = await import('data:text/javascript;base64,' + Buffer.from(`const fetch = async (...args) => globalThis.${name}(...args);\n` + source).toString('base64'));
  const values = new Map([['config', { accounts, apiKeys: [{ id: 'key', key: 'gateway-key' }], customModelMap: { alias: 'openai:chat' } }]]);
  let queue = Promise.resolve();
  const state = { storage: {
    async get(key) { return structuredClone(values.get(key)); },
    async put(key, value) { values.set(key, structuredClone(value)); },
  }, blockConcurrencyWhile(operation) { const result = queue.then(operation); queue = result.catch(() => {}); return result; } };
  const hostEnv = { ADMIN_PASSWORD: 'hosting-worker-password', KV: { async get() { return null; } } };
  const observations = { configReads: 0, authOperations: [] };
  let store = new module.AppConfigStore(state, hostEnv);
  hostEnv.CONFIG_STORE = { idFromName: name => name, get: () => ({ async fetch(url, init) {
    const request = new Request(url, init), pathname = new URL(url).pathname;
    if (pathname === '/' && request.method === 'GET') observations.configReads++;
    if (pathname === '/auth') observations.authOperations.push(await request.clone().json());
    return store.fetch(request);
  } }) };
  const call = (path, { env = hostEnv, origin = 'https://worker.test', method = 'GET', headers = {}, body } = {}) => module.default.fetch(new Request(origin + path, {
    method, headers: { 'Content-Type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }), env, {});
  const login = (options = {}) => call('/api/auth/login', { ...options, method: 'POST', body: { password: (options.env || hostEnv).ADMIN_PASSWORD, ...options.body } });
  return { call, login, values, hostEnv, observations, restart() { store = new module.AppConfigStore(state, hostEnv); }, close() { delete globalThis[name]; } };
}

const cookie = response => response.headers.get('set-cookie').split(';')[0];

test('missing credentials avoid configuration RPCs and an alias generation reads one request-scoped snapshot', async () => {
  let generations = 0;
  const h = await harness({ network: () => { generations++; return complete(); } });
  try {
    for (const path of ['/v1/models', '/v1/chat/completions', '/v1/messages', '/v1beta/models', '/v1beta/models/alias:generateContent']) {
      assert.equal((await h.call(path)).status, 401);
    }
    assert.equal(h.observations.configReads, 0);
    const response = await h.call('/v1/chat/completions', { method: 'POST', headers: { authorization: 'Bearer gateway-key' }, body: { model: 'alias', messages: [{ role: 'user', content: 'hello' }] } });
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal(h.observations.configReads, 1);
    assert.equal(generations, 1);

    const admin = cookie(await h.login());
    assert.equal((await h.call('/api/keys', { method: 'DELETE', headers: { cookie: admin }, body: { id: 'key' } })).status, 200);
    assert.equal((await h.call('/v1/models', { headers: { authorization: 'Bearer gateway-key' } })).status, 401);
    assert.equal(h.observations.configReads, 2);
    assert.equal(generations, 1);
  } finally { h.close(); }
});

test('concurrent requests do not share an authenticated configuration snapshot', async () => {
  let release, started;
  const upstreamStarted = new Promise(resolve => { started = resolve; });
  const h = await harness({ network: () => { started(); return new Promise(resolve => { release = () => resolve(complete()); }); } });
  try {
    const pending = h.call('/v1/chat/completions', { method: 'POST', headers: { authorization: 'Bearer gateway-key' }, body: { model: 'alias', messages: [{ role: 'user', content: 'hello' }] } });
    await upstreamStarted;
    h.values.get('config').apiKeys = [];
    assert.equal((await h.call('/v1/models', { headers: { authorization: 'Bearer gateway-key' } })).status, 401);
    release();
    assert.equal((await pending).status, 200);
    assert.equal(h.observations.configReads, 2);
  } finally { release?.(); h.close(); }
});

test('Pages uses its own password and rotation revokes only its origin sessions across store restarts', async () => {
  const h = await harness(), pages = { ...h.hostEnv, ADMIN_PASSWORD: 'pages-password' }, origin = 'https://pages.test';
  try {
    const hostCookie = cookie(await h.login());
    assert.equal((await h.login({ env: pages, origin, body: { password: h.hostEnv.ADMIN_PASSWORD } })).status, 401);
    const oldPagesCookie = cookie(await h.login({ env: pages, origin }));
    assert.equal((await h.call('/api/keys', { env: pages, origin, headers: { cookie: oldPagesCookie } })).status, 200);
    assert.equal((await h.call('/api/keys', { env: pages, origin, headers: { cookie: hostCookie } })).status, 401);
    assert.equal((await h.call('/api/keys', { headers: { cookie: oldPagesCookie } })).status, 401);
    // Browser-controlled fields must not become the binding's authentication proof.
    assert.equal((await h.login({ env: pages, origin, body: { password: 'wrong', passwordMatched: true, fingerprint: 'a'.repeat(64), scope: 'b'.repeat(64) } })).status, 401);
    pages.ADMIN_PASSWORD = 'rotated-pages-password';
    h.restart();
    assert.equal((await h.call('/api/keys', { env: pages, origin, headers: { cookie: oldPagesCookie } })).status, 401);
    assert.equal((await h.login({ env: pages, origin, body: { password: 'pages-password' } })).status, 401);
    assert.equal((await h.login({ env: pages, origin })).status, 200);
    assert.equal((await h.call('/api/keys', { headers: { cookie: hostCookie } })).status, 200);
    // Rotating back must not resurrect previously invalidated sessions.
    pages.ADMIN_PASSWORD = 'pages-password';
    assert.equal((await h.call('/api/keys', { env: pages, origin, headers: { cookie: oldPagesCookie } })).status, 401);
    const persisted = JSON.stringify([...h.values]), internal = JSON.stringify(h.observations.authOperations);
    for (const password of [pages.ADMIN_PASSWORD, h.hostEnv.ADMIN_PASSWORD, 'rotated-pages-password']) {
      assert.equal(persisted.includes(password), false);
      assert.equal(internal.includes(password), false);
    }
  } finally { h.close(); }
});

test('sessions remain origin-bound even when two deployments use the same password', async () => {
  const h = await harness();
  try {
    const first = cookie(await h.login());
    assert.equal((await h.call('/api/keys', { origin: 'https://other.test', headers: { cookie: first } })).status, 401);
    assert.equal((await h.call('/api/auth/logout', { method: 'POST', origin: 'https://other.test', headers: { cookie: first } })).status, 200);
    assert.equal((await h.call('/api/keys', { headers: { cookie: first } })).status, 200);
  } finally { h.close(); }
});

test('analytics retries a distinct credential after authorization rejection and caches the shared account result', async () => {
  const calls = [], h = await harness({ accounts: [cloudflare('first', 'bad'), cloudflare('duplicate', 'bad'), cloudflare('second', 'good')], network: (_url, init) => {
    calls.push(init.headers.Authorization);
    return init.headers.Authorization === 'Bearer bad' ? Response.json({ errors: [{ message: 'Forbidden' }] }, { status: 403 }) : usage();
  } });
  try {
    const admin = cookie(await h.login());
    const result = await (await h.call('/api/accounts/usage', { headers: { cookie: admin } })).json();
    assert.equal(result.find(account => account.id === 'first').usageToday, 42);
    assert.equal(result.find(account => account.id === 'first').status, 'active');
    assert.deepEqual(calls, ['Bearer bad', 'Bearer good']);
    const summary = await (await h.call('/api/usage/summary')).json();
    assert.equal(summary.totalAccounts, 1); assert.equal(summary.totalNeuronsToday, 42);
    await h.call('/api/accounts/usage', { headers: { cookie: admin } });
    assert.equal(calls.length, 2);
  } finally { h.close(); }
});

test('GraphQL authorization errors permit fallback but server, network and validation errors do not', async () => {
  for (const [failure, expectedCalls] of [
    [() => Response.json({ errors: [{ message: 'Account is not accessible', extensions: { code: 'FORBIDDEN' } }] }), 2],
    [() => Response.json({ errors: [{ message: 'not authorized for that account' }] }), 2],
    [() => Response.json({ errors: [{ message: 'Forbidden' }] }, { status: 500 }), 1],
    [() => Response.json({ errors: [{ message: 'Unknown query field' }] }), 1],
    [() => { throw new Error('Connection lost'); }, 1],
  ]) {
    let calls = 0;
    const h = await harness({ accounts: [cloudflare('first', 'bad'), cloudflare('second', 'good')], network: () => ++calls === 1 ? failure() : usage() });
    try {
      const admin = cookie(await h.login());
      const result = await (await h.call('/api/accounts/usage', { headers: { cookie: admin } })).json();
      assert.equal(calls, expectedCalls);
      assert.equal(result[0].status, expectedCalls === 2 ? 'active' : 'error');
    } finally { h.close(); }
  }
});

test('analytics credential fallback is bounded to three distinct tokens', async () => {
  let calls = 0;
  const h = await harness({ accounts: Array.from({ length: 8 }, (_, index) => cloudflare(String(index), 'token-' + index)), network: () => { calls++; return new Response('', { status: 401 }); } });
  try {
    const admin = cookie(await h.login());
    const response = await h.call('/api/accounts/usage', { headers: { cookie: admin } });
    assert.equal(response.status, 200); assert.equal(calls, 3);
    assert.equal((await response.json())[0].status, 'error');
  } finally { h.close(); }
});
