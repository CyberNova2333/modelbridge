import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../_worker.js', import.meta.url), 'utf8');
let sequence = 0;
const cf = index => ({ id: 'cf-' + index, name: 'Cloudflare ' + index, accountId: 'account-' + index, provider: 'cloudflare', apiToken: 'cf-token-' + index, status: 'active' });
const ag = { id: 'ag', name: 'Antigravity', accountId: 'old@example.com', provider: 'antigravity', apiToken: '1//old-refresh', projectId: 'old-project', projectSource: 'auto', projectIdentity: 'old-identity', status: 'active' };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const today = () => new Date().toISOString().slice(0, 10);
const analytics = () => Response.json({ data: { viewer: { accounts: [{ aiInferenceAdaptiveGroups: [{ dimensions: { date: today(), modelId: '@cf/model' }, sum: { totalNeurons: 100 } }] }] } } });

async function harness(accounts, network = async () => analytics()) {
  const networkName = '__quotaProjectNetwork' + sequence++;
  globalThis[networkName] = network;
  const module = await import('data:text/javascript;base64,' + Buffer.from(`const fetch = (...args) => globalThis.${networkName}(...args);\n` + source).toString('base64'));
  const values = new Map([['config', { accounts: structuredClone(accounts), apiKeys: [{ id: 'proxy', key: 'proxy-key' }], customModelMap: {} }]]);
  const observations = { kvWrites: 0, usageWrites: 0, failCacheWrites: false, failCacheReads: false };
  let queue = Promise.resolve();
  const state = {
    storage: {
      async get(key) { if (key === 'usage-cache-v2' && observations.failCacheReads) throw new Error('Temporary cache read failure'); return structuredClone(values.get(key)); },
      async put(key, value) {
        if (key === 'usage-cache-v2') { observations.usageWrites++; if (observations.failCacheWrites) throw new Error('Temporary cache write failure'); }
        values.set(key, structuredClone(value));
      },
    },
    blockConcurrencyWhile(operation) { const pending = queue.then(operation); queue = pending.catch(() => {}); return pending; },
  };
  const env = { ADMIN_PASSWORD: 'test-password', KV: { async get() { return null; }, async put() { observations.kvWrites++; throw new Error('KV write budget exceeded'); }, async delete() { observations.kvWrites++; } } };
  const store = new module.AppConfigStore(state, env);
  env.CONFIG_STORE = { idFromName: name => name, get: () => ({ fetch: (url, init) => store.fetch(new Request(url, init)) }) };
  const login = await module.default.fetch(new Request('https://worker.test/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: env.ADMIN_PASSWORD }) }), env, {});
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const dispatch = (path, method = 'GET', body, admin = true) => module.default.fetch(new Request('https://worker.test' + path, {
    method, headers: { ...(admin ? { cookie } : {}), 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }), env, {});
  return { dispatch, env, values, observations, close() { delete globalThis[networkName]; } };
}

test('concurrent cold public summaries never refresh analytics or write KV/cache', async () => {
  let queries = 0;
  const h = await harness([cf(1)], async () => { queries++; return analytics(); });
  try {
    for (const response of await Promise.all(Array.from({ length: 8 }, () => h.dispatch('/api/usage/summary', 'GET', undefined, false)))) {
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { totalNeuronsToday: 0, totalAccounts: 1, totalLimit: 10000, usagePercentage: 0, modelsToday: [], needUpdate: true });
    }
    h.observations.failCacheReads = true;
    assert.equal((await h.dispatch('/api/usage/summary', 'GET', undefined, false)).status, 200);
    assert.equal(queries, 0);
    assert.equal(h.observations.kvWrites, 0);
    assert.equal(h.observations.usageWrites, 0);
  } finally { h.close(); }
});

test('usage refreshes share one query per real account, reuse five-minute cache, and deduplicate tokens', async () => {
  const requests = [];
  const h = await harness([cf(1), { ...cf(1), id: 'cf-1-duplicate', accountId: 'ACCOUNT-1', apiToken: 'second-token' }, cf(2), cf(3)], async (url, init) => {
    assert.equal(String(url), 'https://api.cloudflare.com/client/v4/graphql');
    assert.equal(init.redirect, 'manual');
    requests.push(JSON.parse(init.body));
    await new Promise(resolve => setImmediate(resolve));
    return analytics();
  });
  try {
    const responses = await Promise.all(Array.from({ length: 4 }, () => h.dispatch('/api/accounts/usage')));
    for (const response of responses) {
      assert.equal(response.status, 200);
      const accounts = await response.json();
      assert.equal(accounts.filter(account => account.usageSupported).length, 3);
      assert.equal(accounts.find(account => account.id === 'cf-1-duplicate').duplicateOf, 'cf-1');
      assert.equal(accounts.reduce((sum, account) => sum + account.usageToday, 0), 300);
    }
    assert.equal(requests.length, 3);
    assert.ok(requests.every(request => request.variables.start.startsWith(new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10))));
    const summary = await (await h.dispatch('/api/usage/summary', 'POST')).json();
    assert.equal(summary.totalAccounts, 3);
    assert.equal(summary.totalLimit, 30000);
    assert.equal(summary.totalNeuronsToday, 300);
    assert.equal(requests.length, 3);
    assert.equal(h.observations.usageWrites, 1);
    assert.equal(h.observations.kvWrites, 0);
    const cache = h.values.get('usage-cache-v2');
    for (const entry of Object.values(cache)) entry.timestamp -= 5 * 60 * 1000 + 1;
    await h.dispatch('/api/accounts/usage');
    assert.equal(requests.length, 6);
  } finally { h.close(); }
});

test('UTC day rollover zeros yesterday daily totals and marks them for refresh', async () => {
  const h = await harness([cf(1)]);
  try {
    await h.dispatch('/api/accounts/usage');
    h.values.get('usage-cache-v2')['account-1'].timestamp = Date.now() - 86400000;
    const summary = await (await h.dispatch('/api/usage/summary', 'GET', undefined, false)).json();
    assert.equal(summary.totalNeuronsToday, 0);
    assert.deepEqual(summary.modelsToday, []);
    assert.equal(summary.needUpdate, true);
  } finally { h.close(); }
});

test('account edits remain available during analytics I/O and invalidate obsolete credential results', { timeout: 3000 }, async () => {
  const started = deferred(), release = deferred();
  const h = await harness([cf(1)], async () => { started.resolve(); await release.promise; return analytics(); });
  try {
    const refresh = h.dispatch('/api/accounts/usage');
    await started.promise;
    const edit = await h.dispatch('/api/accounts', 'POST', { id: 'cf-1', apiToken: 'changed-token' });
    assert.equal(edit.status, 200);
    release.resolve();
    assert.equal((await refresh).status, 200);
    const summary = await (await h.dispatch('/api/usage/summary', 'GET', undefined, false)).json();
    assert.equal(summary.needUpdate, true);
    assert.equal(summary.totalNeuronsToday, 0);
    assert.deepEqual(h.values.get('usage-cache-v2'), {});
  } finally { release.resolve(); h.close(); }
});

test('noncritical usage-cache write failures do not fail successful analytics responses', async () => {
  const h = await harness([cf(1)]);
  try {
    h.observations.failCacheWrites = true;
    const response = await h.dispatch('/api/accounts/usage');
    assert.equal(response.status, 200);
    assert.equal((await response.json())[0].usageToday, 100);
    assert.equal((await h.dispatch('/api/usage/summary', 'GET', undefined, false)).status, 200);
  } finally { h.close(); }
});

test('Antigravity replacement credentials override legacy refreshToken and rediscover automatic projects', async () => {
  const tokens = [], clients = []; let discoveries = 0;
  const h = await harness([{ ...ag, refreshToken: '1//legacy-refresh' }], async (url, init) => {
    if (String(url).includes('oauth2.googleapis.com')) {
      tokens.push(init.body.get('refresh_token')); clients.push(init.body.get('client_id'));
      return Response.json({ access_token: 'access-' + tokens.length, expires_in: 3600 });
    }
    assert.ok(String(url).endsWith(':loadCodeAssist'));
    return Response.json({ cloudaicompanionProject: { id: 'discovered-' + ++discoveries } });
  });
  try {
    assert.equal((await h.dispatch('/api/accounts', 'POST', { id: 'ag', apiToken: '1//replacement', accountId: 'new@example.com', projectId: 'old-project' })).status, 200);
    let saved = h.values.get('config').accounts[0];
    assert.equal(saved.refreshToken, undefined);
    assert.equal(saved.projectId, 'discovered-1');
    assert.equal(saved.projectSource, 'auto');
    assert.match(saved.projectIdentity, /^[a-f0-9]{64}$/);
    assert.deepEqual(tokens, ['1//replacement']);
    assert.equal((await h.dispatch('/api/accounts', 'POST', { id: 'ag', name: 'Renamed', apiToken: '********', projectId: saved.projectId })).status, 200);
    assert.equal(discoveries, 1);
    assert.equal((await h.dispatch('/api/accounts', 'POST', { id: 'ag', accountId: 'another@example.com' })).status, 200);
    assert.equal(discoveries, 2);
    assert.equal((await h.dispatch('/api/accounts', 'POST', { id: 'ag', oauthClientId: 'custom-client', oauthClientSecret: 'custom-secret' })).status, 200);
    assert.equal(discoveries, 3);
    assert.equal(clients.at(-1), 'custom-client');
    const listing = JSON.stringify(await (await h.dispatch('/api/accounts')).json());
    assert.ok(!listing.includes('projectIdentity') && !listing.includes('custom-secret') && !listing.includes('replacement'));
    assert.equal((await h.dispatch('/api/accounts', 'POST', { id: 'ag', status: 'disabled', apiToken: '1//disabled-replacement' })).status, 200);
    saved = h.values.get('config').accounts[0];
    assert.equal(saved.projectId, '');
    assert.equal(saved.projectIdentity, undefined);
    assert.equal(discoveries, 3);
  } finally { h.close(); }
});

test('explicit manual projects survive credential changes and clearing one restores discovery', async () => {
  let discoveries = 0;
  const h = await harness([{ ...ag, projectSource: 'manual' }], async url => {
    if (String(url).includes('oauth2.googleapis.com')) return Response.json({ access_token: 'access', expires_in: 3600 });
    discoveries++; return Response.json({ cloudaicompanionProject: 'auto-project' });
  });
  try {
    assert.equal((await h.dispatch('/api/accounts', 'POST', { id: 'ag', apiToken: '1//replacement', accountId: 'new@example.com' })).status, 200);
    assert.equal(h.values.get('config').accounts[0].projectId, 'old-project');
    assert.equal(discoveries, 0);
    assert.equal((await h.dispatch('/api/accounts', 'POST', { id: 'ag', projectId: '' })).status, 200);
    assert.equal(h.values.get('config').accounts[0].projectSource, 'auto');
    assert.equal(h.values.get('config').accounts[0].projectId, 'auto-project');
    assert.equal(discoveries, 1);
  } finally { h.close(); }
});

test('new automatic project metadata survives persistence and environment OAuth changes rediscover it', async () => {
  const clients = []; let discoveries = 0;
  const h = await harness([], async (url, init) => {
    if (String(url).includes('oauth2.googleapis.com')) {
      clients.push(init.body.get('client_id'));
      return Response.json({ access_token: 'access-' + clients.length, expires_in: 3600 });
    }
    discoveries++; return Response.json({ cloudaicompanionProject: 'project-' + discoveries });
  });
  try {
    assert.equal((await h.dispatch('/api/accounts', 'POST', { provider: 'antigravity', accountId: 'new@example.com', apiToken: '1//new-token' })).status, 200);
    const saved = h.values.get('config').accounts[0];
    assert.equal(saved.projectSource, 'auto');
    assert.equal(saved.projectId, 'project-1');
    const unchanged = await (await h.dispatch('/api/accounts/test', 'POST', { id: saved.id, apiToken: '********' })).json();
    assert.equal(unchanged.success, true);
    assert.equal(discoveries, 1);
    h.env.OAUTH_CLIENT_ID = 'changed-environment-client';
    h.env.OAUTH_CLIENT_SECRET = 'changed-environment-secret';
    const changed = await (await h.dispatch('/api/accounts/test', 'POST', { id: saved.id, apiToken: '********' })).json();
    assert.equal(changed.success, true);
    assert.equal(changed.projectId, 'project-2');
    assert.equal(clients.at(-1), h.env.OAUTH_CLIENT_ID);
    assert.equal(discoveries, 2);
  } finally { h.close(); }
});

test('Antigravity validation cannot overwrite a newer account edit', { timeout: 3000 }, async () => {
  const started = deferred(), release = deferred();
  const h = await harness([{ ...ag, projectSource: 'manual' }], async url => {
    assert.ok(String(url).includes('oauth2.googleapis.com'));
    started.resolve(); await release.promise;
    return Response.json({ access_token: 'access', expires_in: 3600 });
  });
  try {
    const pending = h.dispatch('/api/accounts', 'POST', { id: 'ag', apiToken: '1//slow-replacement' });
    await started.promise;
    assert.equal((await h.dispatch('/api/accounts', 'POST', { id: 'ag', name: 'Newer edit', status: 'disabled' })).status, 200);
    release.resolve();
    assert.equal((await pending).status, 409);
    const saved = h.values.get('config').accounts[0];
    assert.equal(saved.status, 'disabled');
    assert.equal(saved.name, 'Newer edit');
    assert.equal(saved.apiToken, ag.apiToken);
  } finally { release.resolve(); h.close(); }
});
