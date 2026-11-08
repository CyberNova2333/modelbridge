import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { link, mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { createSqliteStateStore } from '../src/state/sqlite.mjs';

const config = () => ({
  accounts: [{ id: 'one', name: 'Fixture', provider: 'openai', accountId: '', apiToken: 'fixture-upstream', models: [], status: 'active' }],
  apiKeys: [{ id: 'revoked', name: 'Fixture', key: 'fixture-client' }],
  customModelMap: { alias: 'openai:chat' },
});
const hash = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), byte => byte.toString(16).padStart(2, '0')).join('');
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const call = (store, path = '/', body, options = {}) => store.fetch(new Request('https://config.internal' + path, {
  method: body === undefined ? 'GET' : 'POST',
  ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), ...options,
}));
const key = index => ({ type: 'key.add', key: { id: `key-${index}`, name: 'Added', key: `fixture-added-${index}`, createdAt: new Date().toISOString() } });

async function fixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'modelbridge-sqlite-'));
  const path = join(directory, 'state.sqlite');
  const stores = [];
  t.after(async () => { await Promise.allSettled(stores.map(store => store.close())); await rm(directory, { recursive: true, force: true }); });
  const open = extra => { const store = createSqliteStateStore({ path, ...options, ...extra }); stores.push(store); return store; };
  return { path, directory, open };
}

test('SQLite readiness initializes only its schema; first configuration is persistent and empty mappings stay empty', async t => {
  const h = await fixture(t), store = h.open();
  await store.ready;
  const inspection = new DatabaseSync(h.path, { readOnly: true });
  try {
    assert.equal(inspection.prepare('PRAGMA user_version').get().user_version, 1);
    assert.equal(inspection.prepare('PRAGMA journal_mode').get().journal_mode, 'wal');
    assert.equal(inspection.prepare('SELECT COUNT(*) AS total FROM state_records').get().total, 0);
  } finally { inspection.close(); }
  const initial = await (await call(store)).json();
  assert.deepEqual(initial.accounts, []);
  assert.deepEqual(initial.apiKeys, []);
  assert.ok(Object.keys(initial.customModelMap).length > 0);
  assert.equal((await call(store, '/', key('persisted'))).status, 200);
  assert.equal((await call(store, '/', { type: 'models.replace', map: {} })).status, 200);
  await store.close();
  const reopened = h.open();
  const saved = await (await call(reopened)).json();
  assert.equal(saved.apiKeys[0].id, 'key-persisted');
  assert.deepEqual(saved.customModelMap, {});
  if (process.platform !== 'win32') assert.equal((await stat(h.path)).mode & 0o777, 0o600);
});

test('offline import validates structure and size and atomically accepts exactly one empty-database import', async t => {
  const h = await fixture(t), first = h.open(), second = h.open();
  await Promise.all([first.ready, second.ready]);
  await assert.rejects(first.importConfig({ accounts: [] }), error => error.code === 'STATE_IMPORT_INVALID');
  await assert.rejects(first.importConfig({ ...config(), customModelMap: { huge: 'x'.repeat(16 * 1024 * 1024) } }), error => error.code === 'STATE_TOO_LARGE');
  const alternative = { ...config(), customModelMap: {} };
  const outcomes = await Promise.allSettled([first.importConfig(config()), second.importConfig(alternative)]);
  assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(outcomes.find(result => result.status === 'rejected').reason.code, 'STATE_IMPORT_NOT_EMPTY');
  const saved = await (await call(first)).json();
  assert.deepEqual(saved, outcomes[0].status === 'fulfilled' ? config() : alternative);
  await first.close(); await second.close();
  const reopened = h.open();
  await assert.rejects(reopened.importConfig(config()), error => error.code === 'STATE_IMPORT_NOT_EMPTY');
});

test('configuration import refuses a database containing only authentication state', async t => {
  const h = await fixture(t), store = h.open();
  const login = { type: 'login', scope: await hash('origin'), fingerprint: await hash('password'), ipKey: 'client', passwordMatched: true };
  assert.equal((await call(store, '/auth', login)).status, 200);
  await assert.rejects(store.importConfig(config()), error => error.code === 'STATE_IMPORT_NOT_EMPTY');
});

test('hard-linked database paths are refused before opening SQLite or changing WAL state', async t => {
  const h = await fixture(t), original = h.open();
  await original.importConfig(config());
  const checkpoint = new DatabaseSync(h.path);
  try { checkpoint.exec('PRAGMA wal_checkpoint(TRUNCATE)'); }
  finally { checkpoint.close(); }
  const alias = join(h.directory, 'alias.sqlite');
  await link(h.path, alias);
  await call(original, '/', { type: 'key.delete', id: 'revoked' });
  const snapshot = async () => Object.fromEntries(await Promise.all((await readdir(h.directory)).sort().map(async name => [name, await readFile(join(h.directory, name))])));
  const before = await snapshot();
  for (const path of [h.path, alias]) {
    assert.throws(() => h.open({ path }), error => error.code === 'STATE_UNAVAILABLE');
    assert.deepEqual(await snapshot(), before);
  }
  assert.deepEqual((await (await call(original)).json()).apiKeys, []);
});

test('schema mismatches fail closed without changing an unrelated SQLite database', async t => {
  const h = await fixture(t);
  const other = new DatabaseSync(h.path);
  other.exec('CREATE TABLE unrelated (value TEXT); INSERT INTO unrelated VALUES (\'preserved\'); PRAGMA user_version = 99');
  other.close();
  const store = h.open();
  await assert.rejects(store.ready, error => error.code === 'STATE_SCHEMA');
  await assert.rejects(call(store), error => error.code === 'STATE_SCHEMA');
  await store.close();
  const inspection = new DatabaseSync(h.path, { readOnly: true });
  try {
    assert.equal(inspection.prepare('PRAGMA user_version').get().user_version, 99);
    assert.equal(inspection.prepare('SELECT value FROM unrelated').get().value, 'preserved');
    assert.equal(inspection.prepare("SELECT COUNT(*) AS total FROM sqlite_schema WHERE name = 'state_records'").get().total, 0);
  } finally { inspection.close(); }
});

test('an unversioned database containing only a view is not treated as an empty state database', async t => {
  const h = await fixture(t);
  const other = new DatabaseSync(h.path);
  other.exec("CREATE VIEW unrelated AS SELECT 'preserved' AS value");
  other.close();
  const store = h.open();
  await assert.rejects(store.ready, error => error.code === 'STATE_SCHEMA');
  await store.close();
  const inspection = new DatabaseSync(h.path, { readOnly: true });
  try {
    assert.equal(inspection.prepare('PRAGMA user_version').get().user_version, 0);
    assert.equal(inspection.prepare('PRAGMA application_id').get().application_id, 0);
    assert.equal(inspection.prepare('SELECT value FROM unrelated').get().value, 'preserved');
    assert.equal(inspection.prepare("SELECT COUNT(*) AS total FROM sqlite_schema WHERE name = 'state_records'").get().total, 0);
  } finally { inspection.close(); }
});

test('an exception after initialization rolls back the entire transaction and leaves import available', async t => {
  const h = await fixture(t), store = h.open();
  await assert.rejects(store.fetch(new Request('https://config.internal/', { method: 'POST', body: '{broken' })));
  await store.importConfig(config());
  assert.deepEqual(await (await call(store)).json(), config());
});

test('SQLite write failures roll back without poisoning later valid transactions', async t => {
  const h = await fixture(t), store = h.open();
  await store.importConfig(config());
  const control = new DatabaseSync(h.path, { timeout: 0 });
  try {
    control.exec("CREATE TRIGGER reject_config BEFORE UPDATE ON state_records WHEN NEW.key = 'config' BEGIN SELECT RAISE(ABORT, 'fixture rejection'); END");
    await assert.rejects(call(store, '/', { type: 'models.replace', map: {} }));
    assert.deepEqual(await (await call(store)).json(), config());
    control.exec('DROP TRIGGER reject_config');
    assert.equal((await call(store, '/', { type: 'models.replace', map: {} })).status, 200);
    assert.deepEqual((await (await call(store)).json()).customModelMap, {});
  } finally { control.close(); }
});

test('a configuration update crossing the record byte limit rolls back and leaves revocation available', async t => {
  const h = await fixture(t), store = h.open();
  const initial = config();
  const targetBytes = 16 * 1024 * 1024 - 1024;
  initial.customModelMap.alias += 'x'.repeat(targetBytes - Buffer.byteLength(JSON.stringify(initial)));
  await store.importConfig(initial);
  const control = new DatabaseSync(h.path, { readOnly: true });
  try {
    const stored = () => control.prepare("SELECT value FROM state_records WHERE key = 'config'").get().value;
    const before = stored();
    assert.equal(Buffer.byteLength(before), targetBytes);
    await assert.rejects(call(store, '/', { ...key('too-large'), key: { ...key('too-large').key, name: 'x'.repeat(2048) } }), error => error.code === 'STATE_TOO_LARGE');
    assert.equal(stored(), before);
    assert.equal((await call(store, '/', { type: 'key.delete', id: 'revoked' })).status, 200);
    assert.deepEqual(JSON.parse(stored()).apiKeys, []);
  } finally { control.close(); }
});

test('multiple connections preserve concurrent mutations, key revocation and conditional account revisions', { timeout: 10000 }, async t => {
  const h = await fixture(t), first = h.open(), second = h.open();
  await Promise.all([first.ready, second.ready]);
  await first.importConfig(config());
  const initial = await (await call(first)).json();
  const revision = await hash(JSON.stringify(initial.accounts[0]));
  const edits = await Promise.all([first, second].map((store, index) => call(store, '/', {
    type: 'account.upsert', account: { id: 'one', name: `Edit ${index}` }, expectedAccountRevision: revision,
  })));
  assert.deepEqual(edits.map(response => response.status).sort(), [200, 409]);
  const writes = Array.from({ length: 40 }, (_, index) => call(index % 2 ? first : second, '/', key(index)));
  writes.push(call(first, '/', { type: 'key.delete', id: 'revoked' }));
  writes.push(...Array.from({ length: 12 }, (_, index) => call(second, '/', { type: 'models.replace', map: { alias: `openai:model-${index}` } })));
  assert.ok((await Promise.all(writes)).every(response => response.status === 200));
  const current = await (await call(second)).json();
  assert.equal(current.apiKeys.length, 40);
  assert.equal(new Set(current.apiKeys.map(item => item.id)).size, 40);
  assert.ok(!current.apiKeys.some(item => item.id === 'revoked'));
});

test('sessions, logout, password rotation and login limits persist across SQLite restarts and connections', async t => {
  const h = await fixture(t), first = h.open(), second = h.open();
  const base = { scope: await hash('origin'), fingerprint: await hash('old-password') };
  const signedIn = await (await call(first, '/auth', { ...base, type: 'login', ipKey: 'client', passwordMatched: true })).json();
  assert.equal(signedIn.success, true);
  const verify = { ...base, type: 'verify', token: signedIn.token };
  assert.equal((await (await call(second, '/auth', verify)).json()).valid, true);
  await first.close();
  const reopened = h.open();
  assert.equal((await (await call(reopened, '/auth', verify)).json()).valid, true);
  assert.equal((await call(second, '/auth', { ...verify, type: 'logout' })).status, 200);
  assert.equal((await (await call(reopened, '/auth', verify)).json()).valid, false);
  const again = await (await call(second, '/auth', { ...base, type: 'login', ipKey: 'client', passwordMatched: true })).json();
  assert.equal((await (await call(reopened, '/auth', { ...verify, token: again.token, fingerprint: await hash('new-password') })).json()).valid, false);
  const failed = await Promise.all(Array.from({ length: 16 }, (_, index) => call(index % 2 ? second : reopened, '/auth', {
    ...base, fingerprint: 'a'.repeat(64), type: 'login', ipKey: 'limited-client', passwordMatched: false,
  }).then(response => response.json())));
  assert.equal(failed.filter(result => result.limited).length, 6);
  await second.close(); await reopened.close();
  assert.equal((await (await call(h.open(), '/auth', { ...base, fingerprint: 'a'.repeat(64), type: 'login', ipKey: 'limited-client', passwordMatched: false })).json()).limited, true);
});

test('usage network I/O does not hold a SQLite transaction or deadlock reentrant configuration reads', { timeout: 5000 }, async t => {
  const h = await fixture(t), first = h.open(), second = h.open();
  await first.importConfig({ ...config(), accounts: [{ id: 'one', name: 'CF', provider: 'cloudflare', accountId: 'fixture-account', apiToken: 'fixture-token', status: 'active' }] });
  const started = deferred(), release = deferred();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    started.resolve(); await release.promise;
    return Response.json({ data: { viewer: { accounts: [{ aiInferenceAdaptiveGroups: [] }] } } });
  };
  t.after(() => { globalThis.fetch = originalFetch; release.resolve(); });
  const pending = call(first, '/usage?limit=20', null);
  await started.promise;
  assert.equal((await call(first, '/', { type: 'models.replace', map: {} })).status, 200);
  assert.equal((await call(second, '/', { type: 'account.delete', id: 'one' })).status, 200);
  release.resolve();
  assert.equal((await pending).status, 200);
  assert.deepEqual(await (await call(first, '/usage?limit=20')).json(), {});
  globalThis.fetch = originalFetch;
});

test('SQLite bounded analytics transport preserves explicit authorization fallback and never retries uncertain failures', { timeout: 5000 }, async t => {
  const successful = () => Response.json({ data: { viewer: { accounts: [{ aiInferenceAdaptiveGroups: [
    { count: 1, sum: { totalNeurons: 7 }, dimensions: { date: new Date().toISOString().slice(0, 10), modelId: 'fixture-model' } },
  ] }] } } });
  const cases = [
    ['HTTP 401', () => new Response('private diagnostic', { status: 401 }), 2],
    ['HTTP 403', () => new Response('private diagnostic', { status: 403 }), 2],
    ['HTTP 200 authorization code', () => Response.json({ errors: [{ message: 'private diagnostic', extensions: { code: 'FORBIDDEN' } }] }), 2],
    ['HTTP 200 permission message', () => Response.json({ errors: [{ message: 'permission denied' }] }), 2],
    ['HTTP 200 mixed errors', () => Response.json({ errors: [{ extensions: { code: 'FORBIDDEN' } }, { message: 'query validation failed' }] }), 1],
    ['HTTP 200 query error', () => Response.json({ errors: [{ message: 'query validation failed' }] }), 1],
    ['HTTP 429', () => Response.json({ errors: [{ extensions: { code: 'FORBIDDEN' } }] }, { status: 429 }), 1],
    ['HTTP 503', () => new Response('private diagnostic', { status: 503 }), 1],
    ['redirect', () => new Response(null, { status: 302, headers: { location: 'https://untrusted.invalid' } }), 1],
    ['network failure', () => { throw new Error('private diagnostic'); }, 1],
    ['malformed JSON', () => new Response('{', { headers: { 'content-type': 'application/json' } }), 1],
    ['stalled body', () => new Response(new ReadableStream(), { headers: { 'content-type': 'application/json' } }), 1],
  ];
  const originalFetch = globalThis.fetch;
  try {
    for (const [name, firstResponse, expectedCalls] of cases) {
      const h = await fixture(t, { usageTimeoutMs: 30 }), store = h.open();
      await store.importConfig({ ...config(), accounts: [0, 1].map(index => ({
        id: `account-${index}`, name: 'CF', provider: 'cloudflare', accountId: 'fixture-account', apiToken: `fixture-token-${index}`, status: 'active',
      })) });
      const calls = [];
      globalThis.fetch = async (url, options) => {
        assert.equal(url, 'https://api.cloudflare.com/client/v4/graphql');
        assert.equal(options.redirect, 'manual');
        calls.push(options.headers.Authorization);
        return calls.length === 1 ? firstResponse() : successful();
      };
      const result = await (await call(store, '/usage?limit=20', null)).json();
      assert.equal(calls.length, expectedCalls, name);
      assert.deepEqual(calls, Array.from({ length: expectedCalls }, (_, index) => `Bearer fixture-token-${index}`), name);
      assert.equal(result['account-0'].status, expectedCalls === 2 ? 'active' : 'error', name);
      assert.equal(result['account-0'].usageToday, expectedCalls === 2 ? 7 : 0, name);
      assert.ok(!JSON.stringify(result).includes('private diagnostic'), name);
      await store.close();
    }
  } finally { globalThis.fetch = originalFetch; }
});

test('cancelling the first usage subscriber does not fail a live subscriber sharing its refresh', { timeout: 5000 }, async t => {
  const h = await fixture(t), store = h.open();
  await store.importConfig({ ...config(), accounts: [{ id: 'one', name: 'CF', provider: 'cloudflare', accountId: 'fixture-account', apiToken: 'fixture-token', status: 'active' }] });
  const started = deferred(), release = deferred();
  const originalFetch = globalThis.fetch;
  let queries = 0;
  globalThis.fetch = async () => {
    queries++; started.resolve(); await release.promise;
    return Response.json({ data: { viewer: { accounts: [{ aiInferenceAdaptiveGroups: [] }] } } });
  };
  t.after(() => { globalThis.fetch = originalFetch; release.resolve(); });
  const first = new AbortController(), second = new AbortController();
  const a = call(store, '/usage?limit=20', null, { signal: first.signal });
  await started.promise;
  const b = call(store, '/usage?limit=20', null, { signal: second.signal });
  const results = Promise.allSettled([a, b]);
  await new Promise(resolve => setImmediate(resolve));
  first.abort(); release.resolve();
  const [cancelled, live] = await results;
  assert.equal(cancelled.status, 'rejected');
  assert.equal(cancelled.reason.code, 'STATE_CANCELLED');
  assert.equal(live.status, 'fulfilled');
  assert.equal(live.value.status, 200);
  assert.equal(second.signal.aborted, false);
  assert.equal(queries, 1);
  assert.equal((await call(store, '/usage?limit=20')).status, 200);
  assert.equal(queries, 1);
  globalThis.fetch = originalFetch;
});

test('single or fully cancelled usage subscriptions finish at their own bounded network deadline', { timeout: 5000 }, async t => {
  for (const count of [1, 2]) {
    const h = await fixture(t, { usageTimeoutMs: 100 }), store = h.open();
    await store.importConfig({ ...config(), accounts: [{ id: 'one', name: 'CF', provider: 'cloudflare', accountId: 'fixture-account', apiToken: 'fixture-token', status: 'active' }] });
    const started = deferred(), originalFetch = globalThis.fetch;
    let queries = 0, networkSignal;
    globalThis.fetch = async (_url, options) => {
      queries++; networkSignal = options.signal; started.resolve(); return new Promise(() => {});
    };
    try {
      const clients = Array.from({ length: count }, () => new AbortController());
      const pending = clients.map(client => call(store, '/usage?limit=20', null, { signal: client.signal }));
      const completed = Promise.allSettled(pending);
      await started.promise;
      for (const client of clients) client.abort();
      for (const result of await completed) {
        assert.equal(result.status, 'rejected');
        assert.equal(result.reason.code, 'STATE_CANCELLED');
      }
      assert.equal(queries, 1);
      assert.equal(networkSignal.aborted, true);
      await store.close();
    } finally { globalThis.fetch = originalFetch; }
  }
});

test('store close cancels shared analytics headers and bodies and never starts later account queries', { timeout: 5000 }, async t => {
  for (const phase of ['headers', 'body']) {
    const h = await fixture(t), store = h.open();
    await store.importConfig({ ...config(), accounts: Array.from({ length: 5 }, (_, index) => ({
      id: `account-${index}`, name: 'CF', provider: 'cloudflare', accountId: `fixture-${index}`, apiToken: 'fixture-token', status: 'active',
    })) });
    const started = deferred(), originalFetch = globalThis.fetch;
    const signals = [];
    let readers = 0, cancelled = 0;
    globalThis.fetch = async (_url, options) => {
      signals.push(options.signal);
      if (phase === 'headers') {
        if (signals.length === 4) started.resolve();
        return new Promise(() => {});
      }
      return new Response(new ReadableStream({
        pull() { if (++readers === 4) started.resolve(); },
        cancel() { cancelled++; },
      }), { headers: { 'Content-Type': 'application/json' } });
    };
    try {
      const pending = call(store, '/usage?limit=20', null);
      await started.promise;
      await store.close();
      assert.equal((await pending).status, 200);
      assert.equal(signals.length, 4);
      assert.ok(signals.every(signal => signal.aborted));
      if (phase === 'body') assert.equal(cancelled, 4);
      await assert.rejects(call(store, '/usage?limit=20', null), error => error.code === 'STATE_CLOSED');
      assert.equal(signals.length, 4);
    } finally { globalThis.fetch = originalFetch; }
  }
});

test('a busy external writer produces a bounded failure and later operations recover', { timeout: 2000 }, async t => {
  const h = await fixture(t, { lockTimeoutMs: 40 }), store = h.open();
  await store.ready;
  const blocker = new DatabaseSync(h.path, { timeout: 0 });
  try {
    blocker.exec('BEGIN IMMEDIATE');
    await assert.rejects(call(store), error => error.code === 'STATE_BUSY');
    blocker.exec('ROLLBACK');
    assert.equal((await call(store)).status, 200);
  } finally { blocker.close(); }
});

test('corrupt authoritative records are never replaced by defaults or an import', async t => {
  const h = await fixture(t), store = h.open();
  await store.importConfig(config());
  const control = new DatabaseSync(h.path);
  control.prepare('UPDATE state_records SET value = ? WHERE key = ?').run('{broken', 'config');
  control.close();
  await assert.rejects(call(store), error => error.code === 'STATE_CORRUPT');
  await assert.rejects(store.importConfig(config()), error => error.code === 'STATE_IMPORT_NOT_EMPTY');
});

test('close drains accepted operations, rejects new operations and can be called repeatedly', async t => {
  const h = await fixture(t), store = h.open();
  await store.importConfig(config());
  const accepted = call(store, '/', key('closing'));
  const closing = store.close();
  await assert.rejects(call(store), error => error.code === 'STATE_CLOSED');
  assert.equal((await accepted).status, 200);
  await Promise.all([closing, store.close()]);
  const reopened = h.open();
  assert.ok((await (await call(reopened)).json()).apiKeys.some(item => item.id === 'key-closing'));
});

test('independent Node processes serialize real SQLite mutations without reviving a revoked key', { timeout: 15000 }, async t => {
  const h = await fixture(t), store = h.open();
  await store.importConfig(config());
  const moduleUrl = new URL('../src/state/sqlite.mjs', import.meta.url).href;
  const script = `
    import { createSqliteStateStore } from ${JSON.stringify(moduleUrl)};
    const store = createSqliteStateStore({ path: process.argv[1] });
    const prefix = process.argv[2];
    const write = async body => {
      const response = await store.fetch(new Request('https://config.internal/', { method: 'POST', body: JSON.stringify(body) }));
      if (response.status !== 200) throw new Error('Child state operation failed');
    };
    try {
      await store.ready;
      if (prefix === 'first') await write({ type: 'key.delete', id: 'revoked' });
      for (let index = 0; index < 20; index++) {
        await write({ type: 'key.add', key: { id: prefix + '-' + index, key: 'fixture-' + prefix + '-' + index } });
        await write({ type: 'models.replace', map: { alias: 'openai:' + prefix + index } });
      }
    } finally { await store.close(); }
  `;
  const launch = prefix => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', script, h.path, prefix], { stdio: ['ignore', 'pipe', 'pipe'], signal: t.signal });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve() : reject(new Error(`Child exited ${code}: ${stderr}`)));
  });
  await Promise.all([launch('first'), launch('second')]);
  const saved = await (await call(store)).json();
  assert.equal(saved.apiKeys.length, 40);
  assert.equal(new Set(saved.apiKeys.map(item => item.id)).size, 40);
  assert.ok(!saved.apiKeys.some(item => item.id === 'revoked'));
});
