import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../_worker.js', import.meta.url), 'utf8');
let sequence = 0;
const cf = { id: 'fixture', provider: 'cloudflare', accountId: 'fixture-account', apiToken: 'fixture-cf-credential', name: 'Fixture', status: 'active' };
const content = { parts: [{ text: 'Example document' }] };
async function harness(provider = 'cloudflare', initialAccount, respond) {
  const calls = [], key = '__accountEmbeddingRound2' + sequence++;
  globalThis[key] = async (url, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : undefined;
    calls.push({ url: String(url), options, body });
    if (respond) return respond(String(url), body, options);
    if (!body) return Response.json({ data: [] });
    if (provider === 'gemini') return Response.json({ embeddings: body.requests.map(item => ({ values: Array(item.embedContentConfig?.outputDimensionality ?? 3).fill(0.5) })) });
    const input = provider === 'cloudflare' ? body.text : body.input;
    const count = typeof input === 'string' || input.every(Number.isInteger) ? 1 : input.length;
    const vectors = Array.from({ length: count }, () => Array(body.dimensions ?? 3).fill(0.5));
    return Response.json(provider === 'cloudflare' ? { success: true, result: { data: vectors } } : { data: vectors.map((embedding, index) => ({ index, embedding })) });
  };
  const module = await import('data:text/javascript;base64,' + Buffer.from(`const fetch=(...args)=>globalThis.${key}(...args);\n` + source + '\nexport {handleAdminPage};').toString('base64'));
  const account = initialAccount || { ...cf, provider, baseUrl: 'https://upstream.invalid/v1beta', models: [] };
  const target = provider === 'cloudflare' ? '@cf/test/embedding' : provider + ':embedding';
  const config = { accounts: [structuredClone(account)], apiKeys: [{ key: 'fixture-client' }], customModelMap: { alias: target } };
  const values = new Map([['config', structuredClone(config)]]);
  let queue = Promise.resolve();
  const env = { ADMIN_PASSWORD: 'fixture-admin', KV: { async get() { return null; } } };
  const store = new module.AppConfigStore({ storage: {
    async get(key) { return structuredClone(values.get(key)); },
    async put(key, value) { values.set(key, structuredClone(value)); },
  }, blockConcurrencyWhile(fn) { const pending = queue.then(fn); queue = pending.catch(() => {}); return pending; } }, env);
  env.CONFIG_STORE = { idFromName: value => value, get: () => ({ fetch: (url, init) => store.fetch(new Request(url, init)) }) };
  const login = await module.default.fetch(new Request('https://gateway.invalid/api/auth/login', { method: 'POST', body: JSON.stringify({ password: env.ADMIN_PASSWORD }) }), env, {});
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  return { module, env, config, values, calls, close() { delete globalThis[key]; },
    call(path, body) { return module.default.fetch(new Request('https://gateway.invalid' + path, { method: 'POST', headers: { cookie, authorization: 'Bearer fixture-client', 'content-type': 'application/json' }, body: JSON.stringify(body) }), env, {}); },
  };
}

test('provider switches require an explicit unmasked credential for both test and save, including implicit legacy types', async () => {
  for (const original of [cf, { ...cf, provider: undefined }, { ...cf, provider: undefined, apiToken: '1//fixture-refresh' }]) {
    const h = await harness('cloudflare', original);
    try {
      for (const apiToken of [undefined, null, '', '   ', '********', ' ******** ', 'part...mask']) for (const path of ['/api/accounts/test', '/api/accounts']) {
        const response = await h.call(path, { id: cf.id, provider: 'openai', apiToken, baseUrl: '' });
        assert.equal(response.status, 400, path);
        assert.match((await response.json()).error, /Changing provider requires/);
      }
      assert.equal(h.calls.length, 0);
      assert.deepEqual(h.values.get('config').accounts, [original]);
    } finally { h.close(); }
  }
});

test('same-provider masked edits retain credentials but a provider switch resets inherited credential metadata and URLs', async () => {
  const original = { ...cf, provider: 'antigravity', accountId: 'fixture@example.invalid', apiToken: '1//fixture-current',
    refreshToken: '1//fixture-legacy', apiKey: 'ya29.fixture-legacy', source: 'antigravity', projectId: 'old-project',
    projectSource: 'manual', projectIdentity: 'old-identity', oauthClientId: 'old-client', oauthClientSecret: 'old-secret',
    baseUrl: 'https://old.invalid/v1', models: ['old-model'], status: 'disabled' };
  const h = await harness('antigravity', original);
  try {
    assert.equal((await h.call('/api/accounts', { id: cf.id, provider: 'antigravity', apiToken: '' })).status, 200);
    let stored = h.values.get('config').accounts[0];
    assert.equal(stored.apiToken, original.apiToken);
    assert.equal(stored.oauthClientSecret, original.oauthClientSecret);
    assert.equal((await h.call('/api/accounts', { id: cf.id, provider: 'openai', apiToken: 'fixture-new-key' })).status, 200);
    stored = h.values.get('config').accounts[0];
    assert.equal(stored.apiToken, 'fixture-new-key');
    assert.equal(stored.baseUrl, 'https://api.openai.com/v1');
    assert.equal(stored.accountId, '');
    assert.deepEqual(stored.models, []);
    assert.equal(stored.projectId, '');
    assert.equal(stored.oauthClientId, '');
    assert.equal(stored.oauthClientSecret, '');
    for (const field of ['refreshToken', 'apiKey', 'source', 'projectIdentity', 'projectSource']) assert.equal(Object.hasOwn(stored, field), false, field);
    assert.equal(h.calls.length, 0);
  } finally { h.close(); }
});

test('a provider switch connection test sends only the newly supplied credential to its chosen destination', async () => {
  const h = await harness('cloudflare', cf);
  try {
    const response = await h.call('/api/accounts/test', { id: cf.id, provider: 'openai', apiToken: 'fixture-new-key' });
    assert.equal(response.status, 200);
    assert.equal(h.calls.length, 1);
    assert.equal(h.calls[0].url, 'https://api.openai.com/v1/models?limit=1');
    assert.equal(h.calls[0].options.headers.Authorization, 'Bearer fixture-new-key');
    assert.equal(JSON.stringify(h.calls).includes(cf.apiToken), false);
    assert.deepEqual(h.values.get('config').accounts, [cf], 'connection testing does not save the changed provider');
  } finally { h.close(); }
});

test('switching into Cloudflare or OAuth cannot reuse a prior account identity', async () => {
  const h = await harness('openai', { ...cf, provider: 'openai', accountId: 'old-account', status: 'disabled' });
  try {
    for (const provider of ['cloudflare', 'antigravity']) {
      const response = await h.call('/api/accounts', { id: cf.id, provider, apiToken: 'fixture-new-credential' });
      assert.equal(response.status, 400, provider);
    }
    assert.equal((await h.call('/api/accounts', { id: cf.id, provider: 'antigravity', accountId: 'new@example.invalid', apiToken: '1//new-fixture', projectId: 'new-project', oauthClientId: 'new-client', oauthClientSecret: 'new-secret', status: 'disabled' })).status, 200);
    const stored = h.values.get('config').accounts[0];
    assert.equal(stored.projectId, 'new-project');
    assert.equal(stored.projectSource, 'manual');
    assert.equal(stored.oauthClientSecret, 'new-secret');
    assert.equal(h.calls.length, 0);
  } finally { h.close(); }
});

test('provider editor clears old destination and project fields and requires re-entry of a credential after switching', async () => {
  const h = await harness();
  try {
    const html = await h.module.handleAdminPage(new Request('https://gateway.invalid/admin'), h.env, {}).text();
    const script = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(match => match[1]).find(value => value.includes('function editAccount('));
    const nodes = new Map();
    const element = id => { if (!nodes.has(id)) nodes.set(id, { value: '', style: {}, classList: { toggle() {} } }); return nodes.get(id); };
    const context = vm.createContext({ document: { getElementById: element }, openAdminModal() {}, closeAdminModal() {} });
    vm.runInContext(script.slice(script.indexOf('let accountCredentialReusable'), script.indexOf('function updatePermissionStatus(')), context);
    vm.runInContext('editAccount("fixture", "Fixture", "old-account", "********", {provider:"openai",baseUrl:"https://old.invalid/v1",projectId:"old-project",models:["old-model"]})', context);
    assert.equal(element('btn-save-account').disabled, false);
    element('account-provider').value = 'anthropic';
    vm.runInContext('onProviderChange()', context);
    for (const id of ['account-token', 'account-id', 'account-base-url', 'account-models', 'account-project-id', 'account-oauth-client-id', 'account-oauth-client-secret']) assert.equal(element(id).value, '', id);
    assert.equal(element('btn-save-account').disabled, true);
    assert.match(element('account-token').placeholder, /更换类型后必须重新填写/);
    element('account-token').value = 'fixture-new-key';
    vm.runInContext('onAccountInfoChange()', context);
    assert.equal(element('btn-save-account').disabled, false);
  } finally { h.close(); }
});

test('native Gemini embeddings normalize nested and legacy aliases and enforce the requested dimension', async () => {
  const options = { taskType: 'RETRIEVAL_DOCUMENT', title: 'Example title', outputDimensionality: 2, autoTruncate: false, documentOcr: false, audioTrackExtraction: false };
  const h = await harness('gemini');
  try {
    const shapes = [
      { embedContentConfig: options },
      { embed_content_config: { task_type: 'RETRIEVAL_DOCUMENT', title: 'Example title', output_dimensionality: 2, auto_truncate: false, document_ocr: false, audio_track_extraction: false } },
      options,
      { task_type: 'RETRIEVAL_DOCUMENT', title: 'Example title', output_dimensionality: 2, auto_truncate: false, document_ocr: false, audio_track_extraction: false },
      { ...options, taskType: 2, embedContentConfig: { task_type: 'RETRIEVAL_DOCUMENT' } },
    ];
    for (const shape of shapes) {
      const response = await h.call('/v1beta/models/alias:embedContent', { content, ...shape });
      assert.equal(response.status, 200, await response.clone().text());
      assert.deepEqual((await response.json()).embedding.values, [0.5, 0.5]);
      assert.deepEqual(h.calls.at(-1).body.requests[0].embedContentConfig, options);
    }
    assert.equal(h.calls.length, shapes.length);
  } finally { h.close(); }
});

test('conflicting, mistyped and unsupported embedding configuration fails before any upstream work', async () => {
  const h = await harness('gemini');
  try {
    const cases = [
      { embedContentConfig: null }, { embed_content_config: [] },
      { embedContentConfig: { outputDimensionality: 2 }, outputDimensionality: 3 },
      { embedContentConfig: { outputDimensionality: 2, output_dimensionality: 3 } },
      { embedContentConfig: { autoTruncate: false }, embed_content_config: { auto_truncate: true } },
      { embedContentConfig: { outputDimensionality: 0 } }, { embedContentConfig: { outputDimensionality: '2' } },
      { taskType: 'UNRECOGNIZED' }, { title: 'Title without retrieval-document task' },
      { embedContentConfig: { autoTruncate: 0 } }, { embedContentConfig: { documentOcr: 'false' } },
      { embedContentConfig: { audioTrackExtraction: null } }, { embedContentConfig: { unsupportedConstraint: true } },
    ];
    for (const options of cases) assert.equal((await h.call('/v1beta/models/alias:embedContent', { content, ...options })).status, 400, JSON.stringify(options));
    assert.equal(h.calls.length, 0);
  } finally { h.close(); }
});

test('batch embedding configuration is compared after normalization and rejects heterogeneous options', async () => {
  const h = await harness('gemini');
  try {
    const response = await h.call('/v1beta/models/alias:batchEmbedContents', { requests: [
      { content, outputDimensionality: 2 }, { content, embed_content_config: { output_dimensionality: 2 } },
    ] });
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).embeddings.map(value => value.values.length), [2, 2]);
    assert.ok(h.calls[0].body.requests.every(value => value.embedContentConfig.outputDimensionality === 2));
    for (const body of [
      { requests: [{ content, outputDimensionality: 2 }, { content, outputDimensionality: 3 }] },
      { requests: [{ content }, { content, embedContentConfig: { autoTruncate: false } }] },
      { requests: [{ content }], embedContentConfig: { outputDimensionality: 2 } },
      { requests: [null] },
    ]) assert.equal((await h.call('/v1beta/models/alias:batchEmbedContents', body)).status, 400);
    assert.equal(h.calls.length, 1, 'rejected batches cannot cause partial generation');
  } finally { h.close(); }
});

test('non-Gemini embedding routes reject unrepresentable task and truncation constraints without calling upstream', async () => {
  for (const provider of ['openai', 'cloudflare']) {
    const h = await harness(provider);
    try {
      for (const options of [
        { taskType: 'RETRIEVAL_DOCUMENT', title: 'Example title' },
        { embedContentConfig: { taskType: 'RETRIEVAL_QUERY' } },
        { embed_content_config: { auto_truncate: false } },
        { embedContentConfig: { documentOcr: false } },
        { embedContentConfig: { audioTrackExtraction: true } },
      ]) assert.equal((await h.call('/v1beta/models/alias:embedContent', { content, ...options })).status, 400, provider);
      assert.equal(h.calls.length, 0);
      assert.equal((await h.call('/v1/embeddings', { model: 'alias', input: 'Example document', task_type: 'RETRIEVAL_DOCUMENT', title: 'Example title' })).status, 400);
      assert.equal(h.calls.length, 0);
      const supported = await h.call('/v1beta/models/alias:embedContent', { content, embedContentConfig: { outputDimensionality: 2 } });
      assert.equal(supported.status, 200);
      assert.equal((await supported.json()).embedding.values.length, 2);
      assert.equal(h.calls.length, 1);
    } finally { h.close(); }
  }
});

test('requested nested embedding dimensions still reject malformed successful upstream output without retry', async () => {
  const h = await harness('gemini', undefined, () => Response.json({ embeddings: [{ values: [0.5, 0.5, 0.5] }] }));
  try {
    const response = await h.call('/v1beta/models/alias:embedContent', { content, embedContentConfig: { outputDimensionality: 2 } });
    assert.equal(response.status, 502);
    assert.equal(h.calls.length, 1);
  } finally { h.close(); }
});
