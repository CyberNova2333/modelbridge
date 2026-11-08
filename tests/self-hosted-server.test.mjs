import assert from 'node:assert/strict';
import test from 'node:test';
import { request as httpRequest } from 'node:http';
import { connect } from 'node:net';
import { mkdtemp, writeFile, readFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createStateServer, stateServerOptionsFromEnv } from '../src/self-hosted/server.mjs';
import { STATE_REQUEST_LIMIT } from '../src/state/remote.mjs';

const token = 'fixture-state-service-token-not-a-user-credential-0123456789';
const origin = 'https://gateway.example';
const publicOrigin = 'https://state.example';
const route = '/_modelbridge/state';
const envelope = (changes = {}) => ({ path: '/', method: 'GET', body: null, origin, ...changes });
const hash = async text => Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))).toString('hex');

async function listen(t, options = {}) {
  const host = createStateServer({
    store: { fetch: async () => Response.json({ fixture: true }) },
    token, origins: origin, publicOrigin, port: 0, ...options,
  });
  t.after(() => host.close());
  const address = await host.listen();
  return { ...host, address, base: `http://127.0.0.1:${address.port}` };
}

function call(base, body = envelope(), options = {}) {
  return fetch(base + route, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...options.headers },
    body: typeof body === 'string' ? body : JSON.stringify(body), ...options,
  });
}

function rawRequest(base, { path = route, method = 'POST', headers = {}, body = JSON.stringify(envelope()), send = true } = {}) {
  let request;
  const result = new Promise((resolveResult, reject) => {
    request = httpRequest(base, { path, method, agent: false,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...headers },
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('error', reject);
      response.on('end', () => resolveResult({ status: response.statusCode, headers: response.headers, text: Buffer.concat(chunks).toString('utf8') }));
    });
    request.on('error', reject);
    if (send) request.end(body);
    else request.flushHeaders();
  });
  // The caller may intentionally disconnect before awaiting the result.
  result.catch(() => {});
  return { request, result };
}

test('HTTP host uses fixed public origin and exposes only the authenticated state RPC', async t => {
  const seen = [];
  const host = await listen(t, { store: { fetch: async request => {
    seen.push(request.url);
    return Response.json({ ready: true });
  } } });
  assert.equal(host.address.address, '127.0.0.1');
  const response = await rawRequest(host.base, { headers: {
    host: 'attacker.example', 'x-forwarded-proto': 'http', 'x-forwarded-host': 'other.example',
  } }).result;
  assert.equal(response.status, 200);
  assert.deepEqual(seen, ['https://config.internal/']);
  assert.equal(response.headers['access-control-allow-origin'], undefined);
  assert.equal(response.headers['cache-control'], 'no-store');
  for (const path of ['/', '/auth', route + '?x=1', '/_modelbridge/%73tate', '/x/../_modelbridge/state', 'https://attacker.example' + route]) {
    assert.equal((await rawRequest(host.base, { path }).result).status, 404);
  }
  assert.equal((await rawRequest(host.base, { method: 'GET', body: '' }).result).status, 405);
  assert.equal((await rawRequest(host.base, { method: 'OPTIONS', body: '' }).result).status, 405);
  assert.equal(seen.length, 1);
});

test('HTTP authentication, origin and payload failures never reach storage or reflect secrets', async t => {
  let calls = 0;
  const host = await listen(t, { store: { fetch: async () => { calls++; return Response.json({}); } } });
  for (const supplied of ['', 'Bearer not-the-service-token', `Bearer ${token}, Bearer ${token}`]) {
    const response = await rawRequest(host.base, { headers: { authorization: supplied } }).result;
    assert.equal(response.status, 401);
    assert.ok(!response.text.includes(token));
  }
  assert.equal((await call(host.base, envelope({ origin: 'https://unregistered.example' }))).status, 400);
  assert.equal((await call(host.base, envelope({ path: 'https://arbitrary.example/' }))).status, 400);
  assert.equal((await call(host.base, '{broken-json')).status, 400);
  assert.equal((await rawRequest(host.base, { headers: { 'content-type': 'text/plain' } }).result).status, 415);
  assert.equal(calls, 0);
});

test('HTTP rejects unauthorized headers before waiting for or buffering the declared upload', async t => {
  let calls = 0;
  const host = await listen(t, { requestTimeoutMs: 100, store: { fetch: async () => { calls++; return Response.json({}); } } });
  for (const authorization of ['', 'Bearer fixture-incorrect-service-token-0123456789', `Bearer ${token}, Bearer ${token}`]) {
    const pending = rawRequest(host.base, { headers: { authorization, 'content-length': '100' }, send: false });
    assert.equal((await pending.result).status, 401);
  }
  assert.equal(calls, 0);
});

test('HTTP host enforces actual body and header bounds before storage', async t => {
  let calls = 0;
  const host = await listen(t, { store: { fetch: async () => { calls++; return Response.json({}); } } });
  const checked = (label, pending) => pending.catch(error => { throw new Error(label, { cause: error }); });
  const declared = rawRequest(host.base, { headers: { 'content-length': String(STATE_REQUEST_LIMIT + 1) }, send: false });
  assert.equal((await checked('declared limit', declared.result)).status, 413);
  const chunked = await checked('chunked limit', rawRequest(host.base, {
    headers: { 'transfer-encoding': 'chunked' }, body: 'x'.repeat(STATE_REQUEST_LIMIT + 1),
  }).result);
  assert.equal(chunked.status, 413);
  const headers = Object.fromEntries(Array.from({ length: 70 }, (_, i) => [`x-fixture-${i}`, 'value']));
  assert.equal((await checked('header count', rawRequest(host.base, { headers }).result)).status, 431);
  assert.equal((await checked('header bytes', rawRequest(host.base, { headers: { 'x-too-large': 'x'.repeat(9000) } }).result)).status, 431);
  assert.equal(calls, 0);
});

test('HTTP input deadline closes a stalled upload without entering storage', async t => {
  let calls = 0;
  const host = await listen(t, { requestTimeoutMs: 100, store: { fetch: async () => { calls++; return Response.json({}); } } });
  const pending = rawRequest(host.base, { headers: { 'content-length': '100' }, send: false });
  const response = await pending.result;
  assert.equal(response.status, 504);
  assert.equal(calls, 0);
});

test('HTTP header timeout closes connections before a complete request is accepted', async t => {
  let calls = 0;
  const host = await listen(t, { headersTimeoutMs: 100, store: { fetch: async () => { calls++; return Response.json({}); } } });
  const raw = await new Promise((resolveResponse, reject) => {
    const socket = connect(host.address.port, '127.0.0.1');
    let text = '';
    socket.on('error', reject);
    socket.on('data', data => { text += data; });
    socket.on('end', () => resolveResponse(text));
    socket.on('connect', () => socket.write(`POST ${route} HTTP/1.1\r\nHost: state.example\r\n`));
  });
  assert.match(raw, /^HTTP\/1\.1 408 /);
  assert.equal(calls, 0);
});

test('rejected CONNECT, Upgrade, parser errors and Expect uploads release half-open TCP connections', { timeout: 5000 }, async t => {
  const host = await listen(t, { requestTimeoutMs: 120000, headersTimeoutMs: 5000 });
  for (const [raw, status] of [
    ['CONNECT example.com:443 HTTP/1.1\r\nHost: example.com\r\n\r\n', 405],
    ['GET / HTTP/1.1\r\nHost: example.com\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n', 405],
    ['INVALID REQUEST\r\n\r\n', 400],
    ['POST /_modelbridge/state HTTP/1.1\r\nHost: state.example\r\nContent-Length: 100\r\nExpect: 100-continue\r\n\r\n', 417],
  ]) {
    let remote;
    const serverClosed = new Promise(resolveClosed => host.server.once('connection', socket => {
      remote = socket;
      socket.once('close', () => resolveClosed(true));
    }));
    const client = connect({ port: host.address.port, host: '127.0.0.1', allowHalfOpen: true });
    t.after(() => client.destroy());
    let response = '';
    await new Promise((resolveEnd, reject) => {
      client.on('error', reject);
      client.on('data', chunk => { response += chunk; });
      client.once('end', resolveEnd);
      client.once('connect', () => client.write(raw));
    });
    assert.match(response, new RegExp(`^HTTP/1\\.1 ${status} `));
    let deadline;
    try {
      assert.equal(await Promise.race([serverClosed, new Promise(resolveDeadline => {
        deadline = setTimeout(() => resolveDeadline(false), 500);
      })]), true, 'the server must not rely on an untrusted peer closing its write side');
      assert.equal(remote.destroyed, true);
    } finally { clearTimeout(deadline); client.destroy(); }
  }
});

test('HTTP operation deadline aborts storage and does not retry uncertain results', async t => {
  let signal, calls = 0;
  const host = await listen(t, { requestTimeoutMs: 100, store: { fetch: async request => {
    calls++; signal = request.signal;
    return new Promise(() => {});
  } } });
  const response = await call(host.base);
  assert.equal(response.status, 504);
  assert.equal(signal.aborted, true);
  assert.equal(calls, 1);
  assert.ok(!(await response.text()).includes(token));
});

test('HTTP client disconnect propagates cancellation after storage receives the request', async t => {
  let entered, aborted;
  const started = new Promise(resolve => { entered = resolve; });
  const stopped = new Promise(resolve => { aborted = resolve; });
  const host = await listen(t, { store: { fetch: async request => {
    entered();
    request.signal.addEventListener('abort', aborted, { once: true });
    return new Promise(() => {});
  } } });
  const pending = rawRequest(host.base);
  await started;
  pending.request.destroy();
  await stopped;
  await assert.rejects(pending.result);
});

test('shutdown bounds active requests, aborts work, and awaits store close exactly once', async t => {
  let entered, signal, closeCalls = 0;
  const started = new Promise(resolve => { entered = resolve; });
  const host = await listen(t, { shutdownTimeoutMs: 30, store: {
    async fetch(request) { signal = request.signal; entered(); return new Promise(() => {}); },
    async close() { assert.equal(signal.aborted, true); closeCalls++; },
  } });
  const pending = rawRequest(host.base);
  await started;
  const first = host.close();
  assert.equal(host.close(), first);
  await first;
  await assert.rejects(pending.result);
  assert.equal(closeCalls, 1);
  assert.equal(host.server.listening, false);
});

test('storage failures and invalid response metadata are sanitized at the HTTP boundary', async t => {
  const host = await listen(t, { store: { fetch: async () => { throw new Error('private diagnostic ' + token); } } });
  const response = await call(host.base);
  assert.equal(response.status, 502);
  assert.ok(!(await response.text()).includes(token));
});

test('environment and token-file validation fail closed without leaking values', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'modelbridge-host-options-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const base = { DB_PATH: join(directory, 'state.sqlite'), MODELBRIDGE_STATE_PUBLIC_ORIGIN: publicOrigin,
    MODELBRIDGE_STATE_ORIGINS: origin, MODELBRIDGE_STATE_TOKEN: token };
  const parsed = await stateServerOptionsFromEnv(base);
  assert.equal(parsed.host, '127.0.0.1');
  assert.equal(parsed.port, 8788);
  for (const changed of [
    { MODELBRIDGE_STATE_TOKEN: '' }, { MODELBRIDGE_STATE_TOKEN: 'short' },
    { MODELBRIDGE_STATE_PUBLIC_ORIGIN: 'http://state.example' }, { MODELBRIDGE_STATE_PUBLIC_ORIGIN: publicOrigin + '/' },
    { MODELBRIDGE_STATE_ORIGINS: '*' }, { PORT: '0' }, { PORT: '123x' }, { DB_PATH: '' },
    { MODELBRIDGE_STATE_TOKEN_FILE: join(directory, 'missing-token') },
  ]) await assert.rejects(stateServerOptionsFromEnv({ ...base, ...changed }), error => error.message === 'Invalid state server configuration.');
  const file = join(directory, 'secret');
  await writeFile(file, token + '\r\n');
  const { MODELBRIDGE_STATE_TOKEN: _unused, ...withoutToken } = base;
  assert.equal((await stateServerOptionsFromEnv({ ...withoutToken, MODELBRIDGE_STATE_TOKEN_FILE: file })).token, token);
  await writeFile(file, 'x'.repeat(515));
  await assert.rejects(stateServerOptionsFromEnv({ ...withoutToken, MODELBRIDGE_STATE_TOKEN_FILE: file }), /Invalid state server configuration/);
  await assert.rejects(stateServerOptionsFromEnv({ ...withoutToken, MODELBRIDGE_STATE_TOKEN_FILE: directory }), /Invalid state server configuration/);
});

test('CLI invalid configuration exits before creating the database and prints no values', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'modelbridge-host-cli-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const database = join(directory, 'never-created.sqlite');
  const processEnv = { ...process.env, DB_PATH: database, MODELBRIDGE_STATE_TOKEN: 'fixture-short-secret',
    MODELBRIDGE_STATE_ORIGINS: origin, MODELBRIDGE_STATE_PUBLIC_ORIGIN: publicOrigin };
  delete processEnv.MODELBRIDGE_STATE_TOKEN_FILE;
  await assert.rejects(promisify(execFile)(process.execPath, ['src/self-hosted/server.mjs'], { env: processEnv }), error => {
    assert.equal(error.code, 1);
    assert.equal(error.stdout, '');
    assert.equal(error.stderr.trim(), 'State server startup failed.');
    assert.ok(!error.stderr.includes(processEnv.MODELBRIDGE_STATE_TOKEN));
    return true;
  });
  await assert.rejects(access(database), error => error.code === 'ENOENT');
});

test('CLI awaits SQLite readiness and rejects a corrupt existing database before listening', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'modelbridge-host-corrupt-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const database = join(directory, 'corrupt.sqlite');
  const bytes = 'fixture database that must remain untouched';
  await writeFile(database, bytes);
  const processEnv = { ...process.env, DB_PATH: database, MODELBRIDGE_STATE_TOKEN: token,
    MODELBRIDGE_STATE_ORIGINS: origin, MODELBRIDGE_STATE_PUBLIC_ORIGIN: publicOrigin };
  delete processEnv.MODELBRIDGE_STATE_TOKEN_FILE;
  await assert.rejects(promisify(execFile)(process.execPath, ['src/self-hosted/server.mjs'], { env: processEnv }), error => {
    assert.equal(error.code, 1);
    assert.equal(error.stdout, '');
    assert.equal(error.stderr.trim(), 'State server startup failed.');
    return true;
  });
  assert.equal(await readFile(database, 'utf8'), bytes);
});

test('real HTTP and SQLite retain authenticated sessions and configuration after restart', async t => {
  const { createSqliteStateStore } = await import('../src/state/sqlite.mjs');
  const directory = await mkdtemp(join(tmpdir(), 'modelbridge-host-sqlite-'));
  const path = join(directory, 'state.sqlite');
  let host;
  t.after(async () => { await host?.close(); await rm(directory, { recursive: true, force: true }); });
  async function start() {
    const store = createSqliteStateStore({ path });
    await store.ready;
    host = createStateServer({ store, token, origins: origin, publicOrigin, port: 0 });
    const address = await host.listen();
    return `http://127.0.0.1:${address.port}`;
  }
  let base = await start();
  const context = { scope: await hash('admin-origin-v3:' + origin), fingerprint: await hash('fixture-admin-fingerprint') };
  const login = await call(base, envelope({ path: '/auth', method: 'POST', body: {
    type: 'login', ...context, ipKey: await hash('fixture-ip'), passwordMatched: true,
  } }));
  assert.equal(login.status, 200);
  const session = (await login.json()).token;
  assert.match(session, /^as2_[a-f0-9]{64}$/);
  const saved = await call(base, envelope({ method: 'POST', body: { type: 'models.replace', map: { chat: 'openai:model' } } }));
  assert.equal(saved.status, 200);
  await host.close();
  base = await start();
  const verify = await call(base, envelope({ path: '/auth', method: 'POST', body: { type: 'verify', ...context, token: session, passwordMatched: false } }));
  assert.equal(verify.status, 200);
  assert.equal((await verify.json()).valid, true);
  const config = await (await call(base)).json();
  assert.deepEqual(config.customModelMap, { chat: 'openai:model' });
});
