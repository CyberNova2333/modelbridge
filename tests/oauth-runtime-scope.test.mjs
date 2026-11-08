import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createRequestRuntime } from '../src/platforms/shared.mjs';

const source = await readFile(new URL('../_worker.js', import.meta.url), 'utf8');
let sequence = 0;
const account = { id: 'fixture', accountId: 'fixture@example.test', refreshToken: 'fixture-refresh' };
const reply = () => Response.json({ access_token: 'fixture-access-token', expires_in: 3600 });
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const load = ({ controlledTimeout = false } = {}) => import('data:text/javascript;base64,' + Buffer.from(
  'let nativeNetwork; const fetch = (...args) => nativeNetwork(...args);\n'
  + (controlledTimeout ? 'export const controlDeadlines = []; const AbortSignal = { timeout(milliseconds) { const controller = new AbortController(); controlDeadlines.push({ milliseconds, controller }); return controller.signal; } };\n' : '') + source
  + '\nexport { getAntigravityToken, discoverAntigravityProject, GATEWAY_RUNTIME, antigravityTokenRefreshes, antigravityRuntimeTokenRefreshes }; export const mockNativeFetch = fn => { nativeNetwork = fn; };\n// OAuth runtime ' + sequence++,
).toString('base64'));
const environment = (api, fetch) => ({ [api.GATEWAY_RUNTIME]: { fetch } });
function observeRefreshJoins(refreshes, expected) {
  const joined = deferred(), has = refreshes.has.bind(refreshes);
  let count = 0;
  refreshes.has = key => {
    const present = has(key);
    if (present && ++count === expected) joined.resolve();
    return present;
  };
  return joined.promise;
}

test('cancelling one platform OAuth refresh does not cancel another request using the same credential', { timeout: 2000 }, async () => {
  const api = await load();
  const client = new AbortController(), firstStarted = deferred(), secondStarted = deferred();
  let firstCalls = 0, secondCalls = 0;
  const first = createRequestRuntime({
    platform: 'edgeone', request: new Request('https://gateway.example', { signal: client.signal }),
    fetch: async () => { firstCalls++; firstStarted.resolve(); return new Promise(() => {}); },
  });
  const second = createRequestRuntime({
    platform: 'edgeone', request: new Request('https://gateway.example'),
    fetch: async () => { secondCalls++; secondStarted.resolve(); return reply(); },
  });
  try {
    const a = api.getAntigravityToken(account, environment(api, first.fetch));
    await firstStarted.promise;
    const b = api.getAntigravityToken(account, environment(api, second.fetch));
    const settled = Promise.allSettled([a, b]);
    await secondStarted.promise;
    client.abort();
    const [one, two] = await settled;
    assert.equal(one.status, 'rejected');
    assert.equal(one.reason.code, 'request_cancelled');
    assert.equal(two.status, 'fulfilled');
    assert.equal(two.value, 'fixture-access-token');
    assert.equal(firstCalls, 1);
    assert.equal(secondCalls, 1);
    assert.equal(first.subrequestsUsed, 1);
    assert.equal(second.subrequestsUsed, 1);
    assert.equal(second.signal.aborted, false);
  } finally { client.abort(); first.dispose(); second.dispose(); }
});

test('one injected transport still coalesces concurrent forced refreshes', { timeout: 2000 }, async () => {
  const api = await load(), started = deferred(), release = deferred();
  let calls = 0;
  const env = environment(api, async () => { calls++; started.resolve(); await release.promise; return reply(); });
  const first = api.getAntigravityToken(account, env, { forceRefresh: true });
  await started.promise;
  const joined = observeRefreshJoins(api.antigravityRuntimeTokenRefreshes.get(env[api.GATEWAY_RUNTIME].fetch), 8);
  const others = Array.from({ length: 8 }, () => api.getAntigravityToken(account, env, { forceRefresh: true }));
  // Observe every join before releasing I/O; do not depend on wall-clock sleeps
  // or let a completed token cache hide duplicate refreshes.
  await joined;
  release.resolve();
  assert.deepEqual(await Promise.all([first, ...others]), Array(9).fill('fixture-access-token'));
  assert.equal(calls, 1);
});

test('native Cloudflare keeps isolate-wide single-flight refreshes across env objects', { timeout: 2000 }, async () => {
  const api = await load(), started = deferred(), release = deferred();
  let calls = 0;
  api.mockNativeFetch(async () => { calls++; started.resolve(); await release.promise; return reply(); });
  const first = api.getAntigravityToken(account, {}, { forceRefresh: true });
  await started.promise;
  const joined = observeRefreshJoins(api.antigravityTokenRefreshes, 1);
  const second = api.getAntigravityToken(account, {}, { forceRefresh: true });
  await joined;
  release.resolve();
  assert.deepEqual(await Promise.all([first, second]), ['fixture-access-token', 'fixture-access-token']);
  assert.equal(calls, 1);
});

test('completed token cache is shared by credential fingerprint across injected transports', async () => {
  const api = await load();
  let firstCalls = 0, secondCalls = 0;
  const first = environment(api, async () => { firstCalls++; return reply(); });
  const second = environment(api, async () => { secondCalls++; return reply(); });
  assert.equal(await api.getAntigravityToken(account, first), 'fixture-access-token');
  assert.equal(await api.getAntigravityToken(account, second), 'fixture-access-token');
  assert.equal(firstCalls, 1);
  assert.equal(secondCalls, 0);
  assert.equal(await api.getAntigravityToken(account, second, { forceRefresh: true }), 'fixture-access-token');
  assert.equal(secondCalls, 1);
});

test('OAuth refresh cancels a stalled body after headers when its platform request ends', { timeout: 2000 }, async () => {
  const api = await load(), started = deferred(), client = new AbortController();
  let cancelled = false, settled = false;
  const rt = createRequestRuntime({ platform: 'edgeone', request: new Request('https://gateway.example', { signal: client.signal }),
    fetch: async () => new Response(new ReadableStream({ pull() { started.resolve(); }, cancel() { cancelled = true; } })),
  });
  const env = { [api.GATEWAY_RUNTIME]: { fetch: rt.fetch, signal: rt.signal } };
  const token = api.getAntigravityToken(account, env);
  token.then(() => { settled = true; }, () => { settled = true; });
  try {
    const request = rt.run(async () => new Response(await token));
    await started.promise;
    client.abort(new Error('untrusted-client-reason'));
    assert.equal((await request).status, 499);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(cancelled, true, 'the OAuth reader must be cancelled, not only the outer response');
    assert.equal(settled, true, 'the refresh single-flight must settle and release its entry');
  } finally { client.abort(); rt.dispose(); }
});

test('OAuth refresh and project discovery reject oversized control JSON without caching it', async () => {
  for (const stage of ['refresh', 'discovery']) {
    const api = await load();
    let calls = 0;
    const env = environment(api, async () => {
      calls++;
      return Response.json(stage === 'refresh'
        ? { access_token: 'x'.repeat(1024 * 1024 + 1), expires_in: 3600 }
        : { cloudaicompanionProject: 'x'.repeat(1024 * 1024 + 1) });
    });
    const operation = () => stage === 'refresh' ? api.getAntigravityToken(account, env)
      : api.discoverAntigravityProject({ ...account, apiKey: 'fixture-access' }, env, 'fixture-access');
    await assert.rejects(operation(), /JSON|limit|large/i);
    await assert.rejects(operation(), /JSON|limit|large/i);
    assert.equal(calls, 2, 'rejected oversized data must never populate a shared cache');
  }
});

test('the control request deadline still spans a body that keeps making progress', { timeout: 2000 }, async () => {
  for (const stage of ['refresh', 'discovery']) {
    const api = await load({ controlledTimeout: true }), started = deferred();
    let cancelled = false, stream;
    const env = environment(api, async () => new Response(new ReadableStream({
      start(controller) { stream = controller; }, pull() { started.resolve(); }, cancel() { cancelled = true; },
    })));
    const result = stage === 'refresh' ? api.getAntigravityToken(account, env)
      : api.discoverAntigravityProject({ ...account, apiKey: 'fixture-access' }, env, 'fixture-access');
    const rejected = assert.rejects(result, /JSON|limit|timed out/i);
    await started.promise;
    stream.enqueue(new TextEncoder().encode('{"partial":"progress'));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(api.controlDeadlines.length, 1);
    assert.equal(api.controlDeadlines[0].milliseconds, 20000);
    api.controlDeadlines[0].controller.abort(new Error('private-timeout-reason'));
    await rejected;
    assert.equal(cancelled, true);
  }
});

test('OAuth control transport diagnostics never reflect secrets through management or inference routes', async () => {
  for (const stage of ['refresh', 'discovery']) for (const path of ['/api/accounts', '/api/accounts/test', '/v1/chat/completions']) {
    const api = await load();
    const stored = { id: 'ag', provider: 'antigravity', accountId: 'fixture@example.test', status: 'active',
      apiToken: stage === 'refresh' ? 'fixture-refresh-private' : 'ya29.fixture-access-private',
      oauthClientId: 'fixture-client', oauthClientSecret: 'fixture-oauth-secret', projectId: '', models: [],
    };
    let calls = 0;
    const gateway = api.createGateway({
      state: { async request(path) { return Response.json(path === '/auth' ? { valid: true } : {
        accounts: [stored], apiKeys: [{ key: 'fixture-inference' }], customModelMap: { chat: 'antigravity:gemini-2.5-flash' },
      }); } },
      async fetch() { calls++; throw new Error('transport diagnostic ' + stored.apiToken + ' ' + stored.oauthClientSecret); },
    });
    const response = await gateway.fetch(new Request('https://gateway.example' + path, {
      method: 'POST', headers: { cookie: 'admin_token=as2_' + 'a'.repeat(64), authorization: 'Bearer fixture-inference' },
      body: JSON.stringify(path.startsWith('/api/') ? { id: stored.id } : { model: 'chat', messages: [{ role: 'user', content: 'hello' }] }),
    }), { ADMIN_PASSWORD: 'fixture-admin' });
    const body = await response.text();
    assert.equal(response.status, path === '/api/accounts/test' ? 200 : 502);
    assert.equal(calls, 1, `${stage} ${path}`);
    assert.ok(!body.includes(stored.apiToken), `${stage} ${path} exposed an upstream credential`);
    assert.ok(!body.includes(stored.oauthClientSecret), `${stage} ${path} exposed the OAuth client secret`);
    assert.ok(!body.includes('transport diagnostic'), `${stage} ${path} exposed raw transport diagnostics`);
  }
});

test('control HTTP rejection status remains useful without reading or reflecting error bodies', { timeout: 2000 }, async () => {
  for (const stage of ['refresh', 'discovery']) {
    const api = await load();
    let cancelled = false, calls = 0;
    const env = environment(api, async () => {
      calls++;
      return new Response(new ReadableStream({
        start(controller) { controller.enqueue(new TextEncoder().encode('private-control-error-body')); },
        cancel() { cancelled = true; return new Promise(() => {}); },
      }), { status: 403 });
    });
    await assert.rejects(stage === 'refresh' ? api.getAntigravityToken(account, env)
      : api.discoverAntigravityProject({ ...account, apiKey: 'fixture-access' }, env, 'fixture-access'),
    error => /403/.test(error.message) && !error.message.includes('private-control-error-body')
      && (stage === 'refresh' || error.status === 403));
    assert.equal(cancelled, true);
    assert.equal(calls, 1);
  }
});
