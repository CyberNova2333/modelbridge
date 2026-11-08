import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../_worker.js', import.meta.url), 'utf8');
let moduleSequence = 0;

async function createHarness() {
  const testingExports = `
    export { DEFAULT_MODEL_MAP, handleDashboardApi, handleV1Proxy, handleAdminPage, resolveModelName };
    export function setTestConfig(initialConfig) {
      const config = structuredClone(initialConfig);
      getCustomModelMap = async () => structuredClone(config.customModelMap);
      saveCustomModelMap = async (_env, map) => { config.customModelMap = structuredClone(map); };
      getAccounts = async () => structuredClone(config.accounts);
      getApiKeys = async () => structuredClone(config.apiKeys);
    }
    // Test module ${moduleSequence++}
  `;
  const module = await import('data:text/javascript;base64,' + Buffer.from(source + testingExports).toString('base64'));
  module.setTestConfig({
    accounts: [{ id: 'account-1', accountId: 'mock-account', apiToken: 'mock-token', status: 'active' }],
    apiKeys: [{ key: 'mock-gateway-key' }], customModelMap: module.DEFAULT_MODEL_MAP,
  });
  const env = { ADMIN_PASSWORD: 'mock-admin-password', KV: {} };
  const authValues = new Map();
  const store = new module.AppConfigStore({ storage: { async get(key) { return authValues.get(key); }, async put(key, value) { authValues.set(key, value); } }, blockConcurrencyWhile(fn) { return fn(); } }, env);
  env.CONFIG_STORE = { idFromName: name => name, get: () => ({ fetch: (url, init) => store.fetch(new Request(url, init)) }) };
  const login = await module.handleDashboardApi(new Request('https://worker.test/api/auth/login', { method: 'POST', body: JSON.stringify({ password: env.ADMIN_PASSWORD }) }), env, {});
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const admin = (path, method = 'GET', body) => module.handleDashboardApi(new Request('https://worker.test' + path, {
    method,
    headers: { cookie, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }), env, {});
  const proxy = (path, body) => module.handleV1Proxy(new Request('https://worker.test' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer mock-gateway-key' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }), env, {});
  return { module, env, admin, proxy };
}


test('free-quota presets match the exported mapping and exclude paid-access models', async () => {
  const { module } = await createHarness();
  const exported = JSON.parse(await readFile(new URL('../cloudflare-model-map.json', import.meta.url), 'utf8'));
  assert.deepEqual(module.DEFAULT_MODEL_MAP, exported);
  const excluded = [
    '@cf/moonshotai/kimi-k2.6', '@cf/moonshotai/kimi-k2.7-code',
    '@cf/zai-org/glm-5.2', '@cf/zai-org/glm-5.3', '@cf/zai-org/glm-5.3-flash',
    '@cf/deepseek-ai/deepseek-v4-flash-0731', '@cf/deepseek-ai/deepseek-v4.1-flash-1017',
    '@cf/deepseek-ai/deepseek-v4-pro-0813',
  ];
  for (const id of excluded) assert.equal(Object.values(exported).includes(id), false, id);
  for (const [alias, id] of Object.entries({
    'glm-4.7-flash': '@cf/zai-org/glm-4.7-flash',
    'gpt-oss-20b': '@cf/openai/gpt-oss-20b',
    'gpt-oss-120b': '@cf/openai/gpt-oss-120b',
    'bge-m3': '@cf/baai/bge-m3',
    'flux-2-klein-4b': '@cf/black-forest-labs/flux-2-klein-4b',
  })) assert.equal(exported[alias], id);
});

test('deleting preset mappings removes them from model listings and proxy resolution', async () => {
  const { module, env, admin, proxy } = await createHarness();
  const settings = await (await admin('/api/settings')).json();
  delete settings.customModelMap['gpt-oss-120b'];
  delete settings.customModelMap['bge-m3'];
  assert.equal((await admin('/api/settings', 'POST', settings)).status, 200);
  const saved = await (await admin('/api/settings')).json();
  assert.equal(Object.hasOwn(saved.customModelMap, 'gpt-oss-120b'), false);
  const models = await (await proxy('/v1/models')).json();
  assert.equal(models.data.some(model => model.id === 'gpt-oss-120b' || model.id === 'bge-m3'), false);
  assert.equal(await module.resolveModelName('gpt-oss-120b', env), null);
  assert.equal(await module.resolveModelName('bge-m3', env), null);
  assert.equal(await module.resolveModelName('constructor', env), null);
  assert.equal(await module.resolveModelName(undefined, env), null);
  assert.equal(await module.resolveModelName('gpt-oss-20b', env), '@cf/openai/gpt-oss-20b');
  assert.equal(await module.resolveModelName('@cf/custom/model', env), '@cf/custom/model');

  const originalFetch = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = async () => { fetches++; throw new Error('Deleted models must not reach upstream'); };
  try {
    const chat = await proxy('/v1/chat/completions', { model: 'gpt-oss-120b', messages: [{ role: 'user', content: 'hello' }] });
    assert.equal(chat.status, 400);
    assert.equal((await chat.json()).error.code, 'model_not_found');
    const messages = await proxy('/v1/messages', { model: 'gpt-oss-120b', max_tokens: 32, messages: [{ role: 'user', content: 'hello' }] });
    assert.equal(messages.status, 400);
    assert.equal((await messages.json()).error.type, 'invalid_request_error');
    const embeddings = await proxy('/v1/embeddings', { model: 'bge-m3', input: 'hello' });
    assert.equal(embeddings.status, 400);
    assert.equal((await embeddings.json()).error.code, 'model_not_found');
    assert.equal(fetches, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('custom mapping overrides and an intentionally empty mapping table are respected', async () => {
  const { module, env, admin, proxy } = await createHarness();
  assert.equal((await admin('/api/settings', 'POST', { customModelMap: { 'gpt-oss-120b': '@cf/custom/replacement' } })).status, 200);
  assert.equal(await module.resolveModelName('gpt-oss-120b', env), '@cf/custom/replacement');
  assert.deepEqual((await (await proxy('/v1/models')).json()).data.map(model => model.id), ['gpt-oss-120b']);
  assert.equal((await admin('/api/settings', 'POST', { customModelMap: {} })).status, 200);
  assert.deepEqual((await (await proxy('/v1/models')).json()).data, []);
});

test('model catalog deduplicates large overlapping declarations while preserving order and first-owner metadata', async () => {
  const { module, proxy } = await createHarness();
  const models = Array.from({ length: 5000 }, (_, index) => 'model-' + index);
  module.setTestConfig({
    accounts: [
      { id: 'one', provider: 'openai', accountId: '', apiToken: 'fixture-one', status: 'active', models },
      { id: 'two', provider: 'anthropic', accountId: '', apiToken: 'fixture-two', status: 'active', models: ['model-0', 'shared'] },
      { id: 'three', provider: 'openai', accountId: '', apiToken: 'fixture-three', status: 'active', models: ['shared', 'model-0'] },
      { id: 'disabled', provider: 'gemini', accountId: '', apiToken: 'fixture-disabled', status: 'disabled', models: ['hidden'] },
    ],
    apiKeys: [{ key: 'mock-gateway-key' }],
    customModelMap: { 'model-0': 'openai:model-0', 'openai:model-1': 'openai:model-1' },
  });
  const response = await proxy('/v1/models');
  assert.equal(response.status, 200);
  const { data } = await response.json();
  assert.equal(data.length, 10004);
  assert.equal(new Set(data.map(model => model.id)).size, data.length);
  assert.deepEqual(data.slice(0, 4).map(model => [model.id, model.owned_by]), [
    ['model-0', 'meta'], ['openai:model-1', 'meta'], ['openai:model-0', 'openai'], ['model-1', 'openai'],
  ]);
  assert.deepEqual(data.slice(-4).map(model => [model.id, model.owned_by]), [
    ['anthropic:model-0', 'anthropic'], ['shared', 'anthropic'], ['anthropic:shared', 'anthropic'], ['openai:shared', 'openai'],
  ]);
  assert.equal(data.some(model => model.id.includes('hidden')), false);
});

test('account rows render names as text and preserve edit/delete arguments through listeners', async () => {
  const { module, env } = await createHarness();
  const page = module.handleAdminPage(new Request('https://worker.test/admin'), env, {});
  const html = await page.text();
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(match => match[1]).filter(Boolean);
  for (const script of scripts) new vm.Script(script);
  const adminScript = scripts.find(script => script.includes('async function loadAccounts()'));
  assert.ok(adminScript);
  const start = adminScript.indexOf('async function loadAccounts()');
  const end = adminScript.indexOf('function openAddAccountModal()', start);
  assert.ok(end > start);

  const account = {
    id: "account'1", name: `O'Brien <img src=x onerror=alert(1)>`,
    accountId: `account"'id`, apiToken: `token"'with-special-characters`,
  };
  const rows = [];
  const calls = [];
  const tbody = { innerHTML: '', appendChild: row => rows.push(row) };
  const context = vm.createContext({
    apiFetch: async () => Response.json([account]),
    editAccount: (...args) => calls.push(['edit', ...args]),
    deleteAccount: (...args) => calls.push(['delete', ...args]),
    document: {
      getElementById: id => { assert.equal(id, 'accounts-table-body'); return tbody; },
      createElement: tag => {
        assert.equal(tag, 'tr');
        const name = { textContent: '' };
        const codes = [{ textContent: '' }, { textContent: '' }];
        const buttons = Array.from({ length: 2 }, () => ({
          listeners: {}, addEventListener(type, listener) { this.listeners[type] = listener; },
        }));
        return {
          innerHTML: '', name, codes, buttons,
          querySelector: selector => { assert.equal(selector, 'strong'); return name; },
          querySelectorAll: selector => {
            assert.ok(selector === 'code' || selector === 'button');
            return selector === 'code' ? codes : buttons;
          },
        };
      },
    },
    console,
  });
  vm.runInContext(adminScript.slice(start, end), context);
  await vm.runInContext('loadAccounts()', context);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name.textContent, account.name);
  assert.equal(rows[0].codes[0].textContent, account.accountId);
  assert.equal(rows[0].innerHTML.includes('onclick='), false);
  assert.equal(rows[0].innerHTML.includes(account.name), false);
  assert.equal(rows[0].innerHTML.includes(account.apiToken), false);
  rows[0].buttons[0].listeners.click();
  rows[0].buttons[1].listeners.click();
  assert.deepEqual(calls, [
    ['edit', account.id, account.name, account.accountId, account.apiToken, account],
    ['delete', account.id],
  ]);
});
