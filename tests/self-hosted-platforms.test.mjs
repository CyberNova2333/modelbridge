import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { createCloudflareHandler } from '../src/platforms/cloudflare.mjs';
import { createEdgeOneHandler } from '../src/platforms/edgeone.mjs';
import { createEsaHandler } from '../src/platforms/esa.mjs';
import { createSqliteStateStore } from '../src/state/sqlite.mjs';
import { createStateServer } from '../src/self-hosted/server.mjs';

const serviceOrigin = 'https://state.example';
const origins = ['https://cloudflare.example', 'https://edgeone.example', 'https://esa.example'];
const token = 'fixture-shared-state-token-000000000000000000';
const adminPassword = 'fixture-admin-password';

test('three real gateway entries share a self-hosted SQLite authority across restart and key revocation without Cloudflare bindings', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'modelbridge-self-hosted-platforms-'));
  let host, localOrigin, generations = 0, stateCalls = 0;
  t.after(async () => {
    await host?.close();
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith('modelbridge-self-hosted-platforms-'));
    await rm(directory, { recursive: true, force: true });
  });
  const path = join(directory, 'state.sqlite');
  const start = async initial => {
    const store = createSqliteStateStore({ path });
    if (initial) await store.importConfig({
      accounts: [{ id: 'account', name: 'Fixture', provider: 'openai', accountId: '', apiToken: 'fixture-upstream-token', status: 'active', models: ['chat'] }],
      apiKeys: [{ id: 'key', key: 'fixture-client-key', name: 'Fixture', createdAt: '2026-01-01T00:00:00.000Z' }],
      customModelMap: { alias: 'openai:chat' },
    });
    host = createStateServer({ store, token, origins: origins.join(','), publicOrigin: serviceOrigin, port: 0 });
    localOrigin = 'http://127.0.0.1:' + (await host.listen()).port;
  };
  await start(true);
  const transport = async (url, init) => {
    if (String(url) === serviceOrigin + '/_modelbridge/state') {
      stateCalls++;
      // Only the local test transport substitutes a loopback HTTP destination.
      // Production adapters still enforce a fixed HTTPS endpoint.
      return fetch(localOrigin + '/_modelbridge/state', init);
    }
    assert.equal(String(url), 'https://api.openai.com/v1/chat/completions');
    assert.equal(new Headers(init.headers).get('authorization'), 'Bearer fixture-upstream-token');
    generations++;
    if (JSON.parse(init.body).stream) return new Response('data: {"id":"fixture","choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":null}]}\n\ndata: {"id":"fixture","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
    return Response.json({ id: 'fixture', model: 'chat', choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }] });
  };
  const handlers = [createCloudflareHandler({ fetchImpl: transport }), createEdgeOneHandler({ fetchImpl: transport }), createEsaHandler({ fetchImpl: transport })];
  const env = Object.freeze({ ADMIN_PASSWORD: adminPassword, MODELBRIDGE_STATE_URL: serviceOrigin + '/_modelbridge/state', MODELBRIDGE_STATE_TOKEN: token });
  const call = (index, path, { method = 'GET', body, headers = {} } = {}) => {
    const request = new Request(origins[index] + path, { method, headers: { 'Content-Type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const context = { waitUntil() {} };
    return index === 0 ? handlers[0].fetch(request, env, context)
      : index === 1 ? handlers[1]({ ...context, request, env }) : handlers[2].fetch(request, context, env);
  };
  const chat = (index, stream = false) => call(index, '/v1/chat/completions', { method: 'POST', headers: { Authorization: 'Bearer fixture-client-key' }, body: { model: 'alias', messages: [{ role: 'user', content: 'hello' }], stream } });
  const statusOf = async pending => {
    const response = await pending;
    await response.arrayBuffer();
    return response.status;
  };
  for (let index = 0; index < origins.length; index++) {
    assert.equal(await statusOf(chat(index)), 200);
    const streaming = await chat(index, true);
    assert.equal(streaming.status, 200);
    assert.match(await streaming.text(), /\[DONE\]/);
  }
  const login = await call(0, '/api/auth/login', { method: 'POST', body: { password: adminPassword } });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  await login.arrayBuffer();
  assert.equal(await statusOf(call(1, '/api/keys', { headers: { Cookie: cookie } })), 401);
  await host.close();
  await start(false);
  assert.equal(await statusOf(call(0, '/api/keys', { headers: { Cookie: cookie } })), 200, 'own-origin session survives a real database restart');
  assert.equal(await statusOf(call(0, '/api/keys', { method: 'DELETE', body: { id: 'key' }, headers: { Cookie: cookie, Origin: origins[0] } })), 200);
  const generated = generations;
  for (let index = 0; index < origins.length; index++) assert.equal(await statusOf(chat(index)), 401);
  assert.equal(generations, generated, 'revoked key never reaches a model provider on any entry');
  assert.ok(stateCalls > 12);
});
