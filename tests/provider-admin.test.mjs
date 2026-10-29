import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../_worker.js', import.meta.url), 'utf8');
let sequence = 0;
async function harness(initialAccounts = [], network = async () => { throw new Error('Unexpected network request'); }) {
  const testingSource = `const fetch = (...args) => globalThis.__providerNetwork${sequence}(...args);\n` + source + `\nexport { handleAdminPage, normalizeProviderAccountInput, validateProviderBaseUrl };\n// ${sequence}`;
  const networkName = '__providerNetwork' + sequence++;
  globalThis[networkName] = network;
  const module = await import('data:text/javascript;base64,' + Buffer.from(testingSource).toString('base64'));
  const values = new Map([['config', structuredClone({ accounts: initialAccounts, apiKeys: [{ id: 'proxy', key: 'proxy-key' }], customModelMap: {} })]]);
  let queue = Promise.resolve();
  const state = {
    storage: {
      async get(key) { return structuredClone(values.get(key)); },
      async put(key, value) { values.set(key, structuredClone(value)); },
    },
    blockConcurrencyWhile(operation) { const next = queue.then(operation); queue = next.catch(() => {}); return next; },
  };
  const env = { ADMIN_PASSWORD: 'test-password', KV: { async get() { return null; }, async put() {}, async delete() {} } };
  const store = new module.AppConfigStore(state, env);
  env.CONFIG_STORE = { idFromName: name => name, get: () => ({ fetch: (url, options) => store.fetch(new Request(url, options)) }) };
  const login = await module.default.fetch(new Request('https://worker.test/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: env.ADMIN_PASSWORD }) }), env, {});
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const dispatch = (path, method = 'GET', body) => module.default.fetch(new Request('https://worker.test' + path, {
    method, headers: { cookie, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }), env, {});
  return { module, env, dispatch, values, close() { delete globalThis[networkName]; } };
}

const cfAccount = { id: 'cf-account', name: 'Cloudflare', accountId: 'mock-cloudflare-account', apiToken: 'cf-secret', status: 'active' };

test('generic account providers save default URLs, model declarations and status without a Cloudflare ID', async () => {
  const h = await harness();
  try {
    for (const [provider, baseUrl] of Object.entries({ openai: 'https://api.openai.com/v1', anthropic: 'https://api.anthropic.com/v1', gemini: 'https://generativelanguage.googleapis.com/v1beta' })) {
      const response = await h.dispatch('/api/accounts', 'POST', { provider, name: provider, apiToken: provider + '-secret', models: 'model-one,model-two\nmodel-one', status: 'disabled' });
      assert.equal(response.status, 200, provider);
      const saved = h.values.get('config').accounts.find(a => a.provider === provider);
      assert.equal(saved.accountId, '');
      assert.equal(saved.baseUrl, baseUrl);
      assert.deepEqual(saved.models, ['model-one', 'model-two']);
      assert.equal(saved.status, 'disabled');
    }
    const listing = await (await h.dispatch('/api/accounts')).json();
    assert.equal(listing.length, 3);
    assert.ok(listing.every(account => account.apiToken === '********'));
    assert.ok(!JSON.stringify(listing).includes('-secret'));
  } finally { h.close(); }
});

test('editing masked credentials preserves the stored token and independent account metadata', async () => {
  const account = { id: 'openai-1', name: 'Original', provider: 'openai', accountId: '', apiToken: 'unchanged-secret', baseUrl: 'https://compatible.example/v1', models: ['model-a'], status: 'active', refreshToken: 'legacy-refresh-secret' };
  const h = await harness([account]);
  try {
    const listed = await (await h.dispatch('/api/accounts')).json();
    assert.equal(listed[0].apiToken, '********');
    assert.equal(listed[0].refreshToken, undefined);
    assert.equal((await h.dispatch('/api/accounts', 'POST', { id: account.id, name: "O'Brien", apiToken: '********', status: 'disabled' })).status, 200);
    let saved = h.values.get('config').accounts[0];
    assert.equal(saved.apiToken, account.apiToken);
    assert.equal(saved.baseUrl, account.baseUrl);
    assert.deepEqual(saved.models, ['model-a']);
    assert.equal(saved.status, 'disabled');
    assert.equal((await h.dispatch('/api/accounts', 'POST', { id: account.id, apiToken: '', models: ['replacement'] })).status, 200);
    saved = h.values.get('config').accounts[0];
    assert.equal(saved.apiToken, account.apiToken);
    assert.deepEqual(saved.models, ['replacement']);
  } finally { h.close(); }
});

test('legacy implicit Antigravity accounts remain identifiable and are never tested against Cloudflare', async () => {
  let calls = 0;
  const h = await harness([{ ...cfAccount, id: 'ag', apiToken: '1//refresh-secret' }], async (url, options) => {
    calls++;
    assert.ok(!String(url).includes('api.cloudflare.com'));
    if (String(url).includes('oauth2.googleapis.com')) {
      assert.equal(options.body.get('refresh_token'), '1//refresh-secret');
      return Response.json({ access_token: 'mock-access', expires_in: 3600 });
    }
    assert.ok(String(url).endsWith(':loadCodeAssist'));
    return Response.json({ cloudaicompanionProject: { id: 'mock-project' } });
  });
  try {
    const listing = await (await h.dispatch('/api/accounts')).json();
    assert.equal(listing[0].provider, 'antigravity');
    const response = await h.dispatch('/api/accounts/test', 'POST', { id: 'ag', apiToken: '********' });
    const result = await response.json();
    assert.equal(result.success, true);
    assert.equal(result.projectId, 'mock-project');
    assert.equal(calls, 2);
  } finally { h.close(); }
});

test('invalid provider URLs and account fields are rejected before modifying configuration', async () => {
  const h = await harness([cfAccount]);
  try {
    for (const baseUrl of ['http://api.example/v1', 'https://user:password@api.example/v1', 'https://api.example/v1?key=leak', 'https://api.example/v1#key', 'https://10.1.2.3/v1', 'https://169.254.169.254/', 'https://service.internal/v1']) {
      const response = await h.dispatch('/api/accounts', 'POST', { provider: 'openai', apiToken: 'test-secret', baseUrl });
      assert.equal(response.status, 400, baseUrl);
    }
    for (const payload of [{ provider: 'unsupported', apiToken: 'test-secret' }, { provider: 'cloudflare', accountId: '', apiToken: 'token' }, { provider: 'gemini', apiToken: '' }, { provider: 'gemini', apiToken: 'secret', models: [123] }, { provider: 'openai', apiToken: 'secret', status: 'invalid' }]) {
      assert.equal((await h.dispatch('/api/accounts', 'POST', payload)).status, 400);
    }
    assert.deepEqual(h.values.get('config').accounts, [cfAccount]);
    assert.equal(h.module.validateProviderBaseUrl('http://127.0.0.1:9000/v1/'), 'http://127.0.0.1:9000/v1');
  } finally { h.close(); }
});

test('generic connection checks list models with provider credentials and never generate output', async () => {
  const requests = [];
  const h = await harness([{ id: 'generic', provider: 'anthropic', name: 'Claude', accountId: '', apiToken: 'stored-secret', baseUrl: 'https://proxy.example/v1', models: [], status: 'active' }], async (url, options) => {
    requests.push({ url: String(url), options });
    return Response.json({ data: [] });
  });
  try {
    assert.equal((await (await h.dispatch('/api/accounts/test', 'POST', { id: 'generic', apiToken: '********' })).json()).success, true);
    assert.equal(requests[0].url, 'https://proxy.example/v1/models?limit=1');
    assert.equal(requests[0].options.headers['x-api-key'], 'stored-secret');
    assert.equal(requests[0].options.headers['anthropic-version'], '2023-06-01');
    assert.equal(requests[0].options.redirect, 'manual');
    for (const provider of ['openai', 'gemini']) {
      assert.equal((await (await h.dispatch('/api/accounts/test', 'POST', { provider, apiToken: provider + '-secret' })).json()).success, true);
    }
    assert.equal(requests[1].options.headers.Authorization, 'Bearer openai-secret');
    assert.equal(requests[2].options.headers['x-goog-api-key'], 'gemini-secret');
    assert.ok(requests.every(request => request.url.includes('/models?') && !request.options.body));
    assert.ok(requests.every(request => !request.url.includes('cloudflare.com') && !request.url.includes('-secret')));
  } finally { h.close(); }
});

test('only active Cloudflare accounts contribute queries, daily limits and usage aggregation', async () => {
  const queries = [];
  const h = await harness([
    cfAccount,
    { ...cfAccount, id: 'disabled-cf', status: 'disabled' },
    { ...cfAccount, id: 'implicit-ag', apiToken: 'ya29.ag-secret' },
    ...['openai', 'anthropic', 'gemini'].map(provider => ({ id: provider, name: provider, provider, accountId: '', apiToken: provider + '-secret', status: 'active', models: [] })),
  ], async (url, options) => {
    assert.equal(String(url), 'https://api.cloudflare.com/client/v4/graphql');
    assert.equal(options.headers.Authorization, 'Bearer cf-secret');
    queries.push(url);
    return Response.json({ data: { viewer: { accounts: [{ aiInferenceAdaptiveGroups: [] }] } } });
  });
  try {
    const summary = await (await h.dispatch('/api/usage/summary', 'POST')).json();
    assert.equal(summary.totalAccounts, 1);
    assert.equal(summary.totalLimit, 10000);
    assert.equal(queries.length, 1);
    const accounts = await (await h.dispatch('/api/accounts/usage')).json();
    assert.equal(accounts.length, 6);
    assert.equal(accounts.filter(account => account.usageSupported).length, 1);
    assert.ok(accounts.filter(account => !account.usageSupported).every(account => account.usageToday === 0 && account.modelsToday.length === 0));
    assert.equal(queries.length, 1);
  } finally { h.close(); }
});

test('provider editor renders valid scripts, password credential field and provider model inputs', async () => {
  const h = await harness();
  try {
    const html = await h.module.handleAdminPage(new Request('https://worker.test/admin'), h.env, {}).text();
    assert.match(html, /id="account-provider"/);
    assert.match(html, /id="account-base-url"/);
    assert.match(html, /id="account-models"/);
    assert.match(html, /type="password" id="account-token"/);
    for (const script of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) new vm.Script(script[1]);
  } finally { h.close(); }
});
