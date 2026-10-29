import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../_worker.js', import.meta.url), 'utf8');
let moduleSequence = 0;
const pause = () => new Promise(resolve => setImmediate(resolve));
const account = index => ({
  id: `account-${index}`, name: `Account ${index}`, accountId: `mock-account-${index}`,
  apiToken: 'mock-upstream-token', status: 'active',
});
const keys = [
  { id: 'key-1', name: 'Revoked key', key: 'mock-revoked-key' },
  { id: 'key-2', name: 'Retained key', key: 'mock-retained-key' },
];

async function loadWorker(mockFetch) {
  const testingSource = `
    const testNetwork = { fetch: null };
    const fetch = (...args) => testNetwork.fetch(...args);
  ` + source + `
    export function setFetchForTest(mockFetch) { testNetwork.fetch = mockFetch; }
    // Independent worker module ${moduleSequence++}
  `;
  const module = await import('data:text/javascript;base64,' + Buffer.from(testingSource).toString('base64'));
  module.setFetchForTest(mockFetch);
  return module;
}

async function createHarness(initialConfig, options = {}) {
  const observations = { kvGets: [], kvPuts: [], kvDeletes: [], upstream: [] };
  const legacyValues = new Map();
  if (Object.hasOwn(options, 'rawLegacy')) legacyValues.set('config', options.rawLegacy);
  else if (initialConfig !== undefined) legacyValues.set('config', JSON.stringify(initialConfig));
  const values = new Map();
  // Storage clones values and yields to expose races if the configuration queue is removed.
  const storage = {
    async get(key) { await pause(); return structuredClone(values.get(key)); },
    async put(key, value) { await pause(); values.set(key, structuredClone(value)); },
  };
  let queue = Promise.resolve();
  const state = {
    storage,
    blockConcurrencyWhile(operation) {
      const pending = queue.then(operation);
      queue = pending.catch(() => {});
      return pending;
    },
  };
  const mockFetch = async (url, init) => {
    assert.equal(String(url), 'https://api.cloudflare.com/client/v4/graphql');
    observations.upstream.push({ url, body: JSON.parse(init.body) });
    return Response.json({ data: { viewer: { accounts: [{ aiInferenceAdaptiveGroups: [] }] } } });
  };
  const modules = await Promise.all([loadWorker(mockFetch), loadWorker(mockFetch)]);
  const env = {
    ADMIN_PASSWORD: 'mock-admin-password',
    KV: {
      async get(key) { observations.kvGets.push(key); return legacyValues.get(key) ?? null; },
      async put(key, value) { observations.kvPuts.push(key); legacyValues.set(key, value); },
      async delete(key) { observations.kvDeletes.push(key); legacyValues.delete(key); },
    },
  };
  let store = new modules[0].AppConfigStore(state, env);
  env.CONFIG_STORE = {
    idFromName(name) { assert.equal(name, 'app-config-v1'); return name; },
    get(id) {
      assert.equal(id, 'app-config-v1');
      return { fetch: (input, init) => store.fetch(new Request(input, init)) };
    },
  };
  let adminCookie;
  const dispatch = async (instance, path, { method = 'GET', admin = false, key, body, withoutStore = false } = {}) => {
    const headers = new Headers();
    if (admin) {
      if (!adminCookie) {
        const response = await modules[0].default.fetch(new Request('https://worker.test/api/auth/login', {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: env.ADMIN_PASSWORD }),
        }), env, {});
        assert.equal(response.status, 200);
        adminCookie = response.headers.get('set-cookie').split(';')[0];
      }
      headers.set('cookie', adminCookie);
    }
    if (key) headers.set('authorization', 'Bearer ' + key);
    if (body !== undefined) headers.set('content-type', 'application/json');
    const requestEnv = withoutStore ? { ...env, CONFIG_STORE: undefined } : env;
    return modules[instance].default.fetch(new Request('https://worker.test' + path, {
      method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }), requestEnv, {});
  };
  return {
    modules, env, dispatch, values, legacyValues, observations,
    restartStore() { store = new modules[0].AppConfigStore(state, env); },
  };
}

test('legacy KV configuration migrates once and survives Durable Object eviction', async () => {
  const initial = { accounts: [account(0)], apiKeys: keys, customModelMap: { private: '@cf/mock/original' } };
  const harness = await createHarness(initial);
  assert.equal((await harness.dispatch(0, '/api/keys', { admin: true })).status, 200);
  assert.deepEqual(harness.values.get('config'), initial);
  // A stale legacy KV value must never overwrite the authoritative store after migration.
  harness.legacyValues.set('config', JSON.stringify({ accounts: [], apiKeys: [], customModelMap: {} }));
  harness.restartStore();
  const afterRestart = await harness.dispatch(1, '/api/settings', { admin: true });
  assert.equal(afterRestart.status, 200);
  assert.deepEqual(await afterRestart.json(), { customModelMap: initial.customModelMap });
  assert.equal(harness.observations.kvGets.filter(key => key === 'config').length, 1);
  assert.deepEqual(harness.observations.kvPuts, []);
});

test('a second Worker saving model settings cannot resurrect a revoked API key', async () => {
  const harness = await createHarness({ accounts: [account(0)], apiKeys: keys, customModelMap: {} });
  // Independent Worker modules first read the same pre-revocation configuration.
  assert.equal((await harness.dispatch(0, '/api/keys', { admin: true })).status, 200);
  assert.equal((await harness.dispatch(1, '/api/keys', { admin: true })).status, 200);
  assert.equal((await harness.dispatch(0, '/api/keys', { method: 'DELETE', admin: true, body: { id: 'key-1' } })).status, 200);
  assert.equal((await harness.dispatch(1, '/v1/models', { key: keys[0].key })).status, 401);
  assert.equal((await harness.dispatch(1, '/api/settings', {
    method: 'POST', admin: true, body: { customModelMap: { replacement: '@cf/mock/replacement' } },
  })).status, 200);
  harness.restartStore();
  for (const instance of [0, 1]) {
    assert.equal((await harness.dispatch(instance, '/v1/models', { key: keys[0].key })).status, 401);
    assert.equal((await harness.dispatch(instance, '/v1/models', { key: keys[1].key })).status, 200);
  }
  assert.deepEqual(harness.values.get('config').apiKeys, [keys[1]]);
  assert.deepEqual(harness.values.get('config').customModelMap, { replacement: '@cf/mock/replacement' });
  assert.equal(harness.observations.kvPuts.includes('config'), false);
});

test('concurrent account and API-key additions preserve every operation', async () => {
  const harness = await createHarness({ accounts: [], apiKeys: keys, customModelMap: {} });
  const count = 12;
  const operations = Array.from({ length: count }, (_, index) => [
    harness.dispatch(index % 2, '/api/keys', {
      method: 'POST', admin: true, body: { name: `Added key ${index}`, key: `mock-added-key-${index}` },
    }),
    harness.dispatch((index + 1) % 2, '/api/accounts', {
      method: 'POST', admin: true,
      body: { name: `Added account ${index}`, accountId: `added-account-${index}`, apiToken: `mock-token-${index}` },
    }),
  ]).flat();
  const responses = await Promise.all(operations);
  assert.equal(responses.every(response => response.status === 200), true);
  const config = harness.values.get('config');
  assert.equal(config.apiKeys.length, keys.length + count);
  assert.equal(config.accounts.length, count);
  assert.equal(new Set(config.apiKeys.map(item => item.id)).size, keys.length + count);
  assert.equal(new Set(config.accounts.map(item => item.id)).size, count);
  for (let index = 0; index < count; index++) {
    assert.equal(config.apiKeys.some(item => item.key === `mock-added-key-${index}`), true);
    assert.equal(config.accounts.some(item => item.accountId === `added-account-${index}`), true);
  }
  assert.deepEqual(harness.observations.kvPuts, []);
});

test('anonymous usage refresh is rejected before any configuration read or upstream/KV write', async () => {
  const harness = await createHarness({
    accounts: Array.from({ length: 20 }, (_, index) => account(index)), apiKeys: keys, customModelMap: {},
  });
  for (let index = 0; index < 3; index++) {
    assert.equal((await harness.dispatch(index % 2, '/api/usage/summary', { method: 'POST' })).status, 401);
  }
  assert.deepEqual(harness.observations.upstream, []);
  assert.deepEqual(harness.observations.kvPuts, []);
  assert.deepEqual(harness.observations.kvGets, []);
  assert.equal(harness.values.size, 0);
});

test('authenticated usage refresh still queries upstream and updates usage cache', async () => {
  const harness = await createHarness({
    accounts: Array.from({ length: 20 }, (_, index) => account(index)), apiKeys: keys, customModelMap: {},
  });
  const response = await harness.dispatch(0, '/api/usage/summary', { method: 'POST', admin: true });
  assert.equal(response.status, 200);
  const summary = await response.json();
  assert.equal(summary.totalAccounts, 20);
  assert.equal(summary.totalLimit, 200000);
  assert.equal(harness.observations.upstream.length, 20);
  assert.deepEqual(harness.observations.kvPuts, []);
  assert.equal(Object.keys(harness.values.get('usage-cache-v2')).length, 20);
});

test('missing CONFIG_STORE binding fails closed', async () => {
  const harness = await createHarness({ accounts: [], apiKeys: keys, customModelMap: {} });
  for (const path of ['/v1/models', '/api/keys', '/']) {
    assert.equal((await harness.dispatch(0, path, { withoutStore: true })).status, 503);
  }
  assert.deepEqual(harness.observations.upstream, []);
  assert.deepEqual(harness.observations.kvPuts, []);
  assert.deepEqual(harness.observations.kvGets, []);
});

test('malformed legacy configuration is never migrated into an unauthenticated service', async t => {
  for (const rawLegacy of [
    '{broken-json', 'null', '[]', '{}', '{"accounts":[],"customModelMap":{}}',
    '{"apiKeys":{}}', '{"accounts":"invalid"}', '{"customModelMap":[]}',
  ]) {
    await t.test(rawLegacy, async () => {
      const harness = await createHarness(undefined, { rawLegacy });
      assert.equal((await harness.dispatch(0, '/v1/models')).status, 401);
      const response = await harness.dispatch(0, '/v1/models', { key: 'unverified-key' });
      assert.equal(response.status, 503);
      assert.equal(harness.values.has('config'), false);
      assert.deepEqual(harness.observations.upstream, []);
      assert.deepEqual(harness.observations.kvPuts, []);
    });
  }
});

test('corrupt authoritative configuration fails closed without restoring stale KV data', async t => {
  for (const corrupt of [null, {}, { accounts: [], apiKeys: [{ name: 'Missing key' }], customModelMap: {} }]) {
    await t.test(JSON.stringify(corrupt), async () => {
      const harness = await createHarness({ accounts: [account(0)], apiKeys: keys, customModelMap: {} });
      harness.values.set('config', structuredClone(corrupt));
      assert.equal((await harness.dispatch(0, '/v1/models')).status, 401);
      assert.equal((await harness.dispatch(0, '/v1/models', { key: 'unverified-key' })).status, 503);
      assert.deepEqual(harness.values.get('config'), corrupt);
      assert.deepEqual(harness.observations.kvGets, []);
      assert.deepEqual(harness.observations.kvPuts, []);
      assert.deepEqual(harness.observations.upstream, []);
    });
  }
});

test('fresh installs seed defaults while explicit empty mappings survive migration and restart', async () => {
  const fresh = await createHarness();
  assert.equal((await fresh.dispatch(0, '/v1/models')).status, 401);
  assert.equal((await fresh.dispatch(0, '/api/keys', { method: 'POST', admin: true, body: { name: 'Test', key: 'test-key' } })).status, 200);
  const models = await fresh.dispatch(0, '/v1/models', { key: 'test-key' });
  assert.equal(models.status, 200);
  assert.ok((await models.json()).data.some(model => model.id === 'glm-4.7-flash'));
  assert.ok(Object.keys(fresh.values.get('config').customModelMap).length > 0);
  assert.equal((await fresh.dispatch(0, '/api/settings', { method: 'POST', admin: true, body: { customModelMap: {} } })).status, 200);
  fresh.restartStore();
  assert.deepEqual((await (await fresh.dispatch(1, '/v1/models', { key: 'test-key' })).json()).data, []);
  assert.deepEqual(fresh.values.get('config').customModelMap, {});

  const empty = await createHarness({ accounts: [], apiKeys: [{ key: 'test-key' }], customModelMap: {} });
  assert.deepEqual((await (await empty.dispatch(0, '/v1/models', { key: 'test-key' })).json()).data, []);
  empty.restartStore();
  assert.deepEqual((await (await empty.dispatch(1, '/v1/models', { key: 'test-key' })).json()).data, []);
  assert.deepEqual(empty.values.get('config').customModelMap, {});
});
