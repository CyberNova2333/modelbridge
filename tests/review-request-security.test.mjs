import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../_worker.js', import.meta.url), 'utf8');
let sequence = 0;
async function harness({ storageFailure = false } = {}) {
  const observations = { logs: [], network: 0 };
  const name = '__requestSecurity' + sequence++;
  globalThis[name] = observations;
  const prefix = `const console = { error: (...args) => globalThis.${name}.logs.push(args.join(' ')) }; const fetch = () => { globalThis.${name}.network++; throw new Error('Unexpected external request'); };\n`;
  const module = await import('data:text/javascript;base64,' + Buffer.from(prefix + source).toString('base64'));
  const config = { accounts: [], apiKeys: [{ id: 'client', key: 'fixture-client-key' }], customModelMap: {} };
  const values = new Map([['config', structuredClone(config)]]);
  let queue = Promise.resolve();
  const state = { storage: {
    async get(key) { if (storageFailure && key === 'config') throw new Error('Authorization: fixture-sensitive-error'); return structuredClone(values.get(key)); },
    async put(key, value) { values.set(key, structuredClone(value)); },
  }, blockConcurrencyWhile(fn) { const next = queue.then(fn); queue = next.catch(() => {}); return next; } };
  const env = { ADMIN_PASSWORD: 'fixture-admin-password', KV: { async get() { return null; } } };
  const store = new module.AppConfigStore(state, env);
  env.CONFIG_STORE = { idFromName: name => name, get: () => ({ fetch: (url, init) => store.fetch(new Request(url, init)) }) };
  const call = (path, init = {}) => module.default.fetch(new Request('https://gateway.test' + path, init), env, {});
  const login = () => call('/api/auth/login', { method: 'POST', body: JSON.stringify({ password: env.ADMIN_PASSWORD }) });
  return { observations, values, config, call, login, close() { delete globalThis[name]; } };
}

function oversizedStream() {
  let bytes = 0, cancelled = false;
  return {
    body: new ReadableStream({
      pull(controller) { bytes += 4096; controller.enqueue(new Uint8Array(4096).fill(32)); },
      cancel() { cancelled = true; },
    }, { highWaterMark: 0 }),
    get bytes() { return bytes; }, get cancelled() { return cancelled; },
  };
}

test('anonymous chunked login stops reading at its byte budget, including a false Content-Length', async () => {
  const h = await harness();
  try {
    for (const headers of [{}, { 'content-length': '1' }]) {
      const stream = oversizedStream();
      const response = await h.call('/api/auth/login', { method: 'POST', headers, body: stream.body, duplex: 'half' });
      assert.equal(response.status, 413);
      assert.ok(stream.bytes <= 20 * 1024, 'the oversized source must not be drained');
      assert.equal(stream.cancelled, true);
      assert.equal(h.values.has('admin-auth-v2'), false);
    }
    assert.deepEqual(h.observations.logs, []);
  } finally { h.close(); }
});

test('declared oversize login cancels without reading and its exact byte boundary still accepts valid JSON', async () => {
  const h = await harness();
  try {
    const stream = oversizedStream();
    const response = await h.call('/api/auth/login', { method: 'POST', headers: { 'content-length': '99999999' }, body: stream.body, duplex: 'half' });
    assert.equal(response.status, 413);
    assert.equal(stream.bytes, 0);
    assert.equal(stream.cancelled, true);
    const prefix = '{"password":"wrong","padding":"', suffix = '"}';
    const body = prefix + 'x'.repeat(16 * 1024 - prefix.length - suffix.length) + suffix;
    assert.equal((await h.call('/api/auth/login', { method: 'POST', body })).status, 401);
    assert.equal((await h.call('/api/auth/login', { method: 'POST', body: body + ' ' })).status, 413);
    assert.equal((await h.login()).status, 200);
    const unicode = new TextEncoder().encode(JSON.stringify({ password: 'fixture-admin-password', description: '模桥' }));
    let position = 0;
    const splitUtf8 = new ReadableStream({ pull(controller) {
      if (position === unicode.length) controller.close();
      else controller.enqueue(unicode.subarray(position, ++position));
    } });
    assert.equal((await h.call('/api/auth/login', { method: 'POST', body: splitUtf8, duplex: 'half' })).status, 200);
  } finally { h.close(); }
});

test('malformed management JSON never logs or reflects credential fragments and cannot mutate config', async () => {
  const h = await harness();
  try {
    const cookie = (await h.login()).headers.get('set-cookie').split(';')[0];
    for (const [path, method] of [['/api/accounts', 'POST'], ['/api/accounts', 'DELETE'], ['/api/accounts/test', 'POST'], ['/api/keys', 'POST'], ['/api/keys', 'DELETE'], ['/api/settings', 'POST']]) {
      const response = await h.call(path, { method, headers: { cookie }, body: '{"key":fixture-sensitive-fragment}' });
      assert.equal(response.status, 400, path);
      assert.equal((await response.text()).includes('fixture-sensitive-fragment'), false);
    }
    for (const body of ['null', '[]', '"fixture-sensitive-fragment"']) {
      assert.equal((await h.call('/api/keys', { method: 'POST', headers: { cookie }, body })).status, 400);
    }
    assert.deepEqual(h.values.get('config'), h.config);
    assert.deepEqual(h.observations.logs, []);
    assert.equal(h.observations.network, 0);
  } finally { h.close(); }
});

test('management mutations have a smaller byte budget and cancellation interrupts a pending login body', async () => {
  const h = await harness();
  try {
    const cookie = (await h.login()).headers.get('set-cookie').split(';')[0];
    const response = await h.call('/api/settings', { method: 'POST', headers: { cookie, 'content-length': String(1024 * 1024 + 1) }, body: '{}' });
    assert.equal(response.status, 413);
    let cancelled = false;
    const controller = new AbortController();
    const body = new ReadableStream({ cancel() { cancelled = true; } }, { highWaterMark: 0 });
    const pending = h.call('/api/auth/login', { method: 'POST', body, duplex: 'half', signal: controller.signal });
    controller.abort();
    assert.equal((await pending).status, 499);
    assert.equal(cancelled, true);
  } finally { h.close(); }
});

test('all client JSON protocols return 413 before generation and preserve their error envelope', async () => {
  const h = await harness();
  try {
    const headers = { authorization: 'Bearer fixture-client-key', 'content-length': String(16 * 1024 * 1024 + 1) };
    for (const path of ['/v1/chat/completions', '/v1/messages', '/v1/embeddings', '/v1beta/models/alias:generateContent']) {
      const response = await h.call(path, { method: 'POST', headers, body: '{}' });
      assert.equal(response.status, 413, path);
      const error = await response.json();
      assert.equal(typeof error.error.message, 'string');
      if (path === '/v1/messages') assert.equal(error.type, 'error');
      if (path.startsWith('/v1beta/')) { assert.equal(error.error.code, 413); assert.equal(error.error.status, 'RESOURCE_EXHAUSTED'); }
    }
    const stream = oversizedStream();
    const denied = await h.call('/v1/chat/completions', { method: 'POST', body: stream.body, duplex: 'half' });
    assert.equal(denied.status, 401);
    assert.equal(stream.bytes, 0, 'authentication must happen before reading input');
    await stream.body.cancel();
    assert.equal(h.observations.network, 0);
  } finally { h.close(); }
});

test('unexpected internal failures log a fixed category without the original diagnostic', async () => {
  const h = await harness({ storageFailure: true });
  try {
    const response = await h.call('/v1/models', { headers: { authorization: 'Bearer fixture-client-key' } });
    assert.equal(response.status, 503);
    assert.equal((await response.text()).includes('fixture-sensitive-error'), false);
    assert.deepEqual(h.observations.logs, ['Request failed: internal_error']);
  } finally { h.close(); }
});
