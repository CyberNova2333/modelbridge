import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../_worker.js', import.meta.url), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
let sequence = 0;
const cf = { id: 'cf', name: 'Fixture', provider: 'cloudflare', accountId: 'fixture/account?other#part', apiToken: 'fixture/secret+token', status: 'active', models: [] };
const oa = { id: 'oa', name: 'Fixture', provider: 'openai', accountId: '', apiToken: 'fixture-openai', status: 'active', models: ['vector'] };

async function harness(network, accounts = [cf], fakeTimers = false) {
  const name = '__upstreamReviewFix' + sequence++;
  const shared = { network, calls: [], timers: [] };
  globalThis[name] = shared;
  const prefix = `const fixture=globalThis.${name}; const fetch=async(...args)=>{fixture.calls.push(args);return fixture.network(...args);};\n` + (fakeTimers
    ? 'const setTimeout=(fn,ms)=>{const timer={fn,ms,active:true};fixture.timers.push(timer);return timer;};const clearTimeout=timer=>{if(timer)timer.active=false;};\n'
    : '');
  const module = await import('data:text/javascript;base64,' + Buffer.from(prefix + source + '\nexport {getAntigravityToken};').toString('base64'));
  const values = new Map([['config', { accounts: structuredClone(accounts), apiKeys: [{ id: 'key', key: 'fixture-client' }], customModelMap: { vector: 'openai:vector' } }]]);
  let queue = Promise.resolve();
  const env = { ADMIN_PASSWORD: 'fixture-admin', KV: { async get() { return null; } } };
  const store = new module.AppConfigStore({ storage: {
    async get(key) { return structuredClone(values.get(key)); },
    async put(key, value) { values.set(key, structuredClone(value)); }
  }, blockConcurrencyWhile(fn) { const pending = queue.then(fn); queue = pending.catch(() => {}); return pending; } }, env);
  env.CONFIG_STORE = { idFromName: value => value, get: () => ({ fetch: (url, options) => store.fetch(new Request(url, options)) }) };
  const login = await module.default.fetch(new Request('https://fixture.test/api/auth/login', { method: 'POST', body: JSON.stringify({ password: env.ADMIN_PASSWORD }) }), env, {});
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const dispatch = (path, body, signal) => module.default.fetch(new Request('https://fixture.test' + path, {
    method: 'POST', signal, headers: { cookie, authorization: 'Bearer fixture-client', 'content-type': 'application/json' }, body: JSON.stringify(body)
  }), env, {});
  return { module, env, dispatch, ...shared, close() { delete globalThis[name]; } };
}

test('Cloudflare connection diagnostics redact stored credentials and confine account IDs to a path segment', async () => {
  const h = await harness(async (url) => {
    if (url.endsWith('/graphql')) throw new Error('Failed: ' + cf.apiToken);
    return Response.json({ success: false, errors: [{ message: cf.apiToken + ' ' + encodeURIComponent(cf.apiToken) + 'x'.repeat(1000) }] }, { status: 403 });
  }, [cf], true);
  try {
    const response = await h.dispatch('/api/accounts/test', { id: cf.id, apiToken: '********' });
    assert.equal(response.status, 200);
    const data = await response.json(), serialized = JSON.stringify(data);
    assert.equal(data.success, false);
    assert.ok(!serialized.includes(cf.apiToken));
    assert.ok(!serialized.includes(encodeURIComponent(cf.apiToken)));
    assert.ok(Object.values(data.permissions).every(result => result.error.length <= 600));
    assert.equal(h.calls.length, 3);
    for (const [url, options] of h.calls) {
      assert.equal(options.redirect, 'manual');
      assert.ok(options.signal);
      if (!url.endsWith('/graphql')) assert.ok(url.includes('/accounts/' + encodeURIComponent(cf.accountId) + '/ai/'));
      else assert.equal(JSON.parse(options.body).variables.accountId, cf.accountId);
    }
    assert.equal(h.calls[0][1].method, 'GET');
    assert.ok(h.timers.every(timer => !timer.active));
  } finally { h.close(); }
});

test('Cloudflare connection test cancellation aborts all three pending upstream requests without retrying', async () => {
  const h = await harness(() => new Promise(() => {}), [cf], true);
  try {
    const client = new AbortController();
    const pending = h.dispatch('/api/accounts/test', { id: cf.id, apiToken: '********' }, client.signal);
    for (let index = 0; index < 20 && h.calls.length < 3; index++) await tick();
    assert.equal(h.calls.length, 3);
    client.abort();
    assert.equal((await (await pending).json()).success, false);
    assert.ok(h.calls.every(([, options]) => options.signal.aborted));
    assert.ok(h.timers.every(timer => !timer.active));
    assert.equal(h.calls.filter(([url]) => url.includes('/ai/run/')).length, 1);
  } finally { h.close(); }
});

test('Cloudflare connection tests bound response headers, stalled bodies and diagnostic size', async () => {
  for (const phase of ['headers', 'body', 'size']) {
    let cancelled = 0;
    const h = await harness(() => phase === 'headers' ? new Promise(() => {})
      : phase === 'body' ? new Response(new ReadableStream({ cancel() { cancelled++; } }))
        : new Response('x'.repeat(1024 * 1024 + 1)), [cf], true);
    try {
      const pending = h.dispatch('/api/accounts/test', { id: cf.id, apiToken: '********' });
      for (let index = 0; index < 20 && (h.calls.length < 3 || (phase === 'body' && h.timers.filter(timer => timer.active).length !== 3)); index++) await tick();
      await tick();
      if (phase !== 'size') {
        const timers = h.timers.filter(timer => timer.active);
        assert.equal(timers.length, 3);
        assert.ok(timers.every(timer => timer.ms === 15000));
        timers.forEach(timer => timer.fn());
      }
      const data = await (await pending).json();
      assert.equal(data.success, false, phase);
      assert.ok(Object.values(data.permissions).every(result => /timed out|size limit/.test(result.error)), phase);
      if (phase === 'body') assert.equal(cancelled, 3);
      assert.equal(h.calls.length, 3);
      assert.ok(h.calls.every(([, options]) => options.signal.aborted));
      assert.ok(h.timers.every(timer => !timer.active));
    } finally { h.close(); }
  }
});

test('invalid embedding counts, indices, values and dimensions fail once without another generation', async () => {
  const item = (index, embedding) => ({ object: 'embedding', index, embedding });
  const badResults = [[], [item(0, [1, 2])], [item(0, [1, 2]), item(0, [3, 4])],
    [item(-1, [1, 2]), item(1, [3, 4])], [item(0, [1, 2]), item(7, [3, 4])],
    [item(0, []), item(1, [])], [item(0, [null]), item(1, [2])],
    [item(0, [1e40]), item(1, [2])], [item(0, ['1']), item(1, [2])],
    [item(0, [1, 2]), item(1, [3])], [item(0, 'arbitrary-string'), item(1, 'arbitrary-string')]];
  for (const data of badResults) {
    const h = await harness(() => Response.json({ data }), [oa, { ...oa, id: 'oa-two' }]);
    try {
      const response = await h.dispatch('/v1/embeddings', { model: 'vector', input: ['first', 'second'] });
      assert.equal(response.status, 502);
      assert.equal(h.calls.length, 1);
    } finally { h.close(); }
  }
});

test('valid embeddings retain encoding and token input cardinality, and indexed batches are ordered for Gemini', async () => {
  const binary = Buffer.alloc(8); binary.writeFloatLE(0.25, 0); binary.writeFloatLE(-0.5, 4);
  const encoded = binary.toString('base64');
  for (const input of ['text', [123, 456]]) {
    const h = await harness(() => Response.json({ data: [{ index: 0, embedding: encoded }] }), [oa]);
    try {
      const response = await h.dispatch('/v1/embeddings', { model: 'vector', input, encoding_format: 'base64', dimensions: 2 });
      assert.equal(response.status, 200);
      assert.equal((await response.json()).data[0].embedding, encoded);
      assert.equal(h.calls.length, 1);
    } finally { h.close(); }
  }
  const h = await harness(() => Response.json({ data: [{ index: 1, embedding: [3, 4] }, { index: 0, embedding: [1, 2] }] }), [oa]);
  try {
    const response = await h.dispatch('/v1beta/models/vector:batchEmbedContents', { requests: ['first', 'second'].map(text => ({ content: { parts: [{ text }] } })) });
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).embeddings, [{ values: [1, 2] }, { values: [3, 4] }]);
  } finally { h.close(); }
});

test('embedding encodings and requested dimensions are validated before returning success', async () => {
  const inf = Buffer.alloc(4); inf.writeFloatLE(Infinity);
  for (const [embedding, options] of [['AAAA', { encoding_format: 'base64' }], ['invalid base64', { encoding_format: 'base64' }],
    [inf.toString('base64'), { encoding_format: 'base64' }], [[1, 2], { dimensions: 3 }], ['AACAPw==', { encoding_format: 'float' }]]) {
    const h = await harness(() => Response.json({ data: [{ index: 0, embedding }] }), [oa]);
    try {
      assert.equal((await h.dispatch('/v1/embeddings', { model: 'vector', input: 'text', ...options })).status, 502);
      assert.equal(h.calls.length, 1);
    } finally { h.close(); }
  }
});

test('Gemini embedding endpoint rejects malformed OpenAI vectors instead of emitting invalid values', async () => {
  const h = await harness(() => Response.json({ data: [{ index: 7, embedding: 'arbitrary-string' }] }), [oa]);
  try {
    const response = await h.dispatch('/v1beta/models/vector:embedContent', { content: { parts: [{ text: 'hello' }] } });
    assert.equal(response.status, 502);
    assert.ok((await response.json()).error);
    assert.equal(h.calls.length, 1);
  } finally { h.close(); }
});

test('OAuth refresh joins concurrent requests, bypasses completed cache on force, and isolates changed credentials', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const h = await harness(async (_url, options) => { await gate; return Response.json({ access_token: 'access-' + options.body.get('refresh_token'), expires_in: 3600 }); }, []);
  try {
    const account = { id: 'ag', accountId: 'fixture@example.invalid', refreshToken: 'refresh-one' };
    const pending = Array.from({ length: 12 }, () => h.module.getAntigravityToken(account, h.env));
    for (let index = 0; index < 20; index++) await tick();
    assert.equal(h.calls.length, 1);
    release();
    assert.deepEqual(await Promise.all(pending), Array(12).fill('access-refresh-one'));
    assert.equal(await h.module.getAntigravityToken(account, h.env), 'access-refresh-one');
    assert.equal(h.calls.length, 1);
    await h.module.getAntigravityToken(account, h.env, { forceRefresh: true });
    assert.equal(h.calls.length, 2);
    await h.module.getAntigravityToken({ ...account, refreshToken: 'refresh-two' }, h.env);
    await h.module.getAntigravityToken({ ...account, oauthClientId: 'other-client', oauthClientSecret: 'other-secret' }, h.env);
    assert.equal(h.calls.length, 4);
  } finally { release(); h.close(); }
});

test('OAuth failed refresh is shared and removed, and forced refresh joins existing work', async () => {
  let release, fail = true;
  let gate = new Promise(resolve => { release = resolve; });
  const h = await harness(async () => { await gate; return fail ? Response.json({}, { status: 400 }) : Response.json({ access_token: 'fresh-access', expires_in: 3600 }); }, []);
  try {
    const account = { id: 'ag', accountId: 'fixture@example.invalid', refreshToken: 'refresh-one' };
    const pending = Array.from({ length: 6 }, (_, index) => h.module.getAntigravityToken(account, h.env, { forceRefresh: !!(index % 2) }));
    const results = Promise.allSettled(pending);
    for (let index = 0; index < 20; index++) await tick();
    assert.equal(h.calls.length, 1);
    release();
    assert.ok((await results).every(result => result.status === 'rejected'));
    fail = false;
    gate = new Promise(resolve => { release = resolve; });
    const retry = h.module.getAntigravityToken(account, h.env);
    const forced = h.module.getAntigravityToken(account, h.env, { forceRefresh: true });
    for (let index = 0; index < 20; index++) await tick();
    assert.equal(h.calls.length, 2);
    release();
    assert.deepEqual(await Promise.all([retry, forced]), ['fresh-access', 'fresh-access']);
    assert.equal(h.calls.length, 2);
  } finally { release(); h.close(); }
});
