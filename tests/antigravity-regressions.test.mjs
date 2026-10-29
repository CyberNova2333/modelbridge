import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../_worker.js', import.meta.url), 'utf8');
let serial = 0;
async function harness(network = async () => { throw new Error('Unexpected network'); }, accounts = []) {
  const key = '__agMock' + serial++;
  globalThis[key] = network;
  const module = await import('data:text/javascript;base64,' + Buffer.from(`const fetch = (...args) => globalThis.${key}(...args);\n` + source + `
export { getAntigravityAccounts, getAntigravityToken, antigravityTokenCacheKey, discoverAntigravityProject,
  buildAntigravityCloudCodeRequest, convertOpenAIReqToAnthropic, sanitizeToolSchema, parseThinkingSSEResponse,
  parseGoogleResponseToAnthropic, antigravityToAnthropicStream, antigravityToOpenAIStream,
  handleAntigravityMessages, handleAntigravityCompletions, callAntigravityUpstream, handleAdminPage };
// ${key}`).toString('base64'));
  const config = { accounts: structuredClone(accounts), apiKeys: [{ key: 'proxy-key' }], customModelMap: {} };
  const values = new Map([['config', config]]);
  const env = { ADMIN_PASSWORD: 'test-password', KV: { async get() { return null; }, async put() {}, async delete() {} } };
  let queue = Promise.resolve();
  const state = { storage: {
    async get(key) { return structuredClone(values.get(key)); },
    async put(key, value) { values.set(key, structuredClone(value)); }
  }, blockConcurrencyWhile(fn) { const result = queue.then(fn); queue = result.catch(() => {}); return result; } };
  const store = new module.AppConfigStore(state, env);
  env.CONFIG_STORE = { idFromName: x => x, get: () => ({ fetch: (url, init) => store.fetch(new Request(url, init)) }) };
  const login = await module.default.fetch(new Request('https://worker.test/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: env.ADMIN_PASSWORD }) }), env, {});
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const adminRequest = (path, method = 'GET', body) => module.default.fetch(new Request('https://worker.test' + path, {
    method, headers: { cookie, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  }), env, {});
  return { module, env, values, adminRequest, close() { delete globalThis[key]; } };
}
const user = [{ role: 'user', content: 'hello' }];
const ag = { id: 'ag', name: 'AG', provider: 'antigravity', accountId: 'test@example.com', apiToken: 'ya29.mock-access', projectId: 'authorized-project', projectSource: 'manual', status: 'active' };
const google = (parts = [{ text: 'answer' }], finishReason = 'STOP') => ({ candidates: [{ content: { parts }, finishReason }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 4 } });
const frame = data => 'data: ' + JSON.stringify(data) + '\n\n';
function upstream(text, stride = 7, onCancel = () => {}) {
  const bytes = new TextEncoder().encode(text); let pos = 0;
  return new ReadableStream({ pull(c) { if (pos < bytes.length) { c.enqueue(bytes.slice(pos, pos += stride)); } else c.close(); }, cancel: onCancel });
}
const events = text => text.split(/\r?\n\r?\n/).flatMap(item => {
  const line = item.split(/\r?\n/).find(value => value.startsWith('data: '));
  return line && line !== 'data: [DONE]' ? [JSON.parse(line.slice(6))] : [];
});

test('mapped aliases reach AG upstream; wrapped nonstream responses convert to both client protocols and legacy text', async () => {
  const sent = [];
  const h = await harness(async (url, init) => {
    sent.push({ url, body: JSON.parse(init.body) });
    return Response.json({ response: google() });
  }, [ag]);
  try {
    const target = 'antigravity:gemini-2.5-flash';
    const anthropic = await h.module.handleAntigravityMessages({ model: 'my-alias', messages: user, max_tokens: 20 }, h.env, target);
    assert.equal(anthropic.status, 200);
    assert.equal((await anthropic.json()).content[0].text, 'answer');
    const openai = await h.module.handleAntigravityCompletions({ model: 'my-alias', messages: user }, h.env, target, false);
    const result = await openai.json();
    assert.equal(result.model, 'my-alias');
    assert.equal(result.choices[0].message.content, 'answer');
    const legacy = await h.module.handleAntigravityCompletions({ model: 'my-alias', prompt: 'hello' }, h.env, target, true);
    assert.equal((await legacy.json()).choices[0].text, 'answer');
    assert.ok(sent.every(item => item.body.model === 'gemini-2.5-flash' && item.body.project === ag.projectId));
    assert.equal(sent[2].body.request.contents[0].parts[0].text, 'hello');
  } finally { h.close(); }
});

test('tool IDs resolve back to function names and named/required/none choices retain their semantics', async () => {
  const h = await harness();
  try {
    const request = { model: 'gemini-3-flash', messages: [
      { role: 'assistant', content: [{ type: 'tool_use', id: 'call-id', name: 'weather', input: { city: 'Tokyo' }, thoughtSignature: 'original-signature' }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call-id', content: 'sunny' }] }
    ], tools: [{ name: 'weather', input_schema: { type: 'object', properties: { city: { type: 'string' } } } }] };
    const { payload } = await h.module.buildAntigravityCloudCodeRequest({ ...request, tool_choice: { type: 'tool', name: 'weather' } }, 'project');
    assert.equal(payload.request.contents[1].parts[0].functionResponse.name, 'weather');
    assert.equal(payload.request.contents[0].parts[0].thoughtSignature, 'original-signature');
    assert.deepEqual(payload.request.toolConfig.functionCallingConfig, { mode: 'ANY', allowedFunctionNames: ['weather'] });
    for (const [choice, mode] of [['any', 'ANY'], ['none', 'NONE'], ['auto', 'AUTO']]) {
      assert.equal((await h.module.buildAntigravityCloudCodeRequest({ ...request, tool_choice: { type: choice } }, 'project')).payload.request.toolConfig.functionCallingConfig.mode, mode);
    }
    await assert.rejects(() => h.module.buildAntigravityCloudCodeRequest({ ...request, messages: [request.messages[1]] }, 'project'), { status: 400 });
  } finally { h.close(); }
});

test('tool schemas expand safe local refs and reject unsupported alternatives instead of changing contracts', async () => {
  const h = await harness();
  try {
    const schema = { type: 'object', $defs: { City: { type: 'string', enum: ['Tokyo', 'Osaka'] } }, properties: { city: { $ref: '#/$defs/City' } }, required: ['city'] };
    assert.deepEqual(h.module.sanitizeToolSchema(schema).properties.city, { type: 'string', enum: ['Tokyo', 'Osaka'] });
    for (const schema of [ { anyOf: [{ type: 'string' }, { type: 'number' }] }, { type: 'object', additionalProperties: false }, { $ref: 'https://example/schema' }, { $defs: { x: { $ref: '#/$defs/x' } }, $ref: '#/$defs/x' } ]) {
      assert.throws(() => h.module.sanitizeToolSchema(schema), { status: 400 });
    }
  } finally { h.close(); }
});

test('refresh cache is credential and OAuth client sensitive; per-account clients override defaults', async () => {
  const bodies = [];
  const h = await harness(async (url, init) => {
    assert.equal(url, 'https://oauth2.googleapis.com/token'); bodies.push(init.body);
    return Response.json({ access_token: 'access-' + bodies.length, expires_in: 3600 });
  });
  try {
    const account = { id: 'same-id', refreshToken: 'refresh-one' };
    assert.equal(await h.module.getAntigravityToken(account, h.env), 'access-1');
    assert.equal(await h.module.getAntigravityToken(account, h.env), 'access-1');
    assert.equal(await h.module.getAntigravityToken({ ...account, refreshToken: 'refresh-two' }, h.env), 'access-2');
    const custom = { ...account, oauthClientId: 'own-client', oauthClientSecret: 'own-secret' };
    assert.equal(await h.module.getAntigravityToken(custom, { ...h.env, OAUTH_CLIENT_ID: 'env-client', OAUTH_CLIENT_SECRET: 'env-secret' }), 'access-3');
    assert.equal(bodies[2].get('client_id'), 'own-client');
    assert.equal(bodies[2].get('client_secret'), 'own-secret');
    assert.ok(bodies[0].get('client_id').endsWith('.apps.googleusercontent.com'));
    assert.ok(!(await h.module.antigravityTokenCacheKey(custom, h.env)).includes('own-secret'));
  } finally { h.close(); }
});

test('AG retries the same generation once after 401 and obtains a fresh token during that request', async () => {
  let refreshed = 0, generated = 0;
  const headers = [];
  const h = await harness(async (url, init) => {
    if (url.includes('oauth2.googleapis.com')) return Response.json({ access_token: 'access-' + ++refreshed, expires_in: 3600 });
    headers.push(init.headers.Authorization);
    generated++;
    return generated === 1 ? Response.json({ error: { message: 'expired' } }, { status: 401 }) : Response.json({ response: google() });
  }, [{ ...ag, apiToken: '1//refresh' }]);
  try {
    const result = await h.module.callAntigravityUpstream({ model: 'gemini-2.5-flash', messages: user }, h.env, false);
    assert.equal(result.success, true);
    assert.equal(refreshed, 2); assert.equal(generated, 2);
    assert.deepEqual(headers, ['Bearer access-1', 'Bearer access-2']);
  } finally { h.close(); }
  let tokens = 0, calls = 0;
  const failing = await harness(async url => url.includes('oauth2.googleapis.com') ? (tokens++, Response.json({ access_token: 'a-' + tokens, expires_in: 3600 })) : (calls++, Response.json({}, { status: 401 })), [{ ...ag, apiToken: '1//refresh' }]);
  try {
    assert.equal((await failing.module.callAntigravityUpstream({ model: 'gemini-2.5-flash', messages: user }, failing.env, false)).success, false);
    assert.equal(tokens, 2); assert.equal(calls, 2);
  } finally { failing.close(); }
});

test('disabled env accounts stay disabled; explicit provider and per-account project/client settings are preserved', async () => {
  const h = await harness(undefined, [ { ...ag, oauthClientId: 'client', oauthClientSecret: 'secret' }, { ...ag, id: 'generic', provider: 'openai', apiToken: '1//generic-api-key' } ]);
  try {
    h.env.ANTIGRAVITY_PROJECT_ID = 'global-project';
    h.env.ANTIGRAVITY_ACCOUNTS = JSON.stringify([{ id: 'disabled', refreshToken: 'nope', status: 'disabled' }, { id: 'enabled', apiKey: 'ya29.x', projectId: 'env-project' }]);
    const accounts = await h.module.getAntigravityAccounts(h.env);
    assert.deepEqual(accounts.map(a => a.id).sort(), ['ag', 'enabled']);
    assert.equal(accounts.find(a => a.id === 'ag').projectId, 'authorized-project');
    assert.equal(accounts.find(a => a.id === 'ag').oauthClientSecret, 'secret');
    assert.equal(await h.module.discoverAntigravityProject(accounts[1], h.env), 'authorized-project');
  } finally { h.close(); }
});

test('email plus refresh token login discovers a real project shape and persists only after success; disabled saves make no requests', async () => {
  const calls = [];
  const h = await harness(async (url, init) => {
    calls.push(String(url));
    if (String(url).includes('oauth2.googleapis.com')) return Response.json({ access_token: 'ya29.mock', expires_in: 3600 });
    assert.ok(String(url).endsWith(':loadCodeAssist'));
    assert.deepEqual(JSON.parse(init.body), { metadata: { ideType: 'ANTIGRAVITY' } });
    return Response.json({ cloudaicompanionProject: { id: 'discovered-project' } });
  });
  try {
    const response = await h.adminRequest('/api/accounts', 'POST', { provider: 'antigravity', accountId: 'login@example.com', apiToken: '1//mock-refresh', name: 'Login' });
    assert.equal(response.status, 200); assert.equal(calls.length, 2);
    const saved = h.values.get('config').accounts[0];
    assert.equal(saved.projectId, 'discovered-project');
    const before = calls.length;
    assert.equal((await h.adminRequest('/api/accounts', 'POST', { id: saved.id, apiToken: '', status: 'disabled' })).status, 200);
    assert.equal(calls.length, before);
    assert.equal((await h.adminRequest('/api/accounts', 'POST', { provider: 'antigravity', accountId: 'other@example.com', apiToken: '1//disabled', status: 'disabled', oauthClientId: 'client', oauthClientSecret: 'private-client-secret' })).status, 200);
    const listing = await (await h.adminRequest('/api/accounts')).json();
    assert.ok(!JSON.stringify(listing).includes('private-client-secret'));
    assert.ok(!JSON.stringify(listing).includes('mock-refresh'));
    assert.ok(listing.every(a => a.oauthClientId === undefined && a.oauthClientSecret === undefined && a.refreshToken === undefined));
  } finally { h.close(); }
});

test('project discovery supports server-provided onboarding tier and rejects empty discovery without a fabricated fallback', async () => {
  let onboarded = 0;
  const h = await harness(async (url, init) => {
    if (url.endsWith(':loadCodeAssist')) return Response.json({ allowedTiers: [{ id: 'server-selected-tier', isDefault: true }] });
    assert.ok(url.endsWith(':onboardUser'));
    assert.equal(JSON.parse(init.body).tier_id, 'server-selected-tier'); onboarded++;
    return Response.json({ done: true, response: { cloudaicompanionProject: 'onboarded-project' } });
  });
  try {
    assert.equal(await h.module.discoverAntigravityProject({ id: 'a', apiKey: 'ya29.test' }, h.env), 'onboarded-project');
    assert.equal(onboarded, 1);
    assert.equal(await h.module.discoverAntigravityProject({ id: 'a', apiKey: 'ya29.test' }, h.env), 'onboarded-project');
    assert.equal(onboarded, 1);
  } finally { h.close(); }
  const empty = await harness(async () => Response.json({}));
  try {
    await assert.rejects(() => empty.module.discoverAntigravityProject({ id: 'b', apiKey: 'ya29.test' }, empty.env), { status: 400 });
    await assert.rejects(() => empty.module.buildAntigravityCloudCodeRequest({ model: 'gemini-2.5-flash', messages: user }), { status: 400 });
  } finally { empty.close(); }
});

test('all AG SSE readers flush the final frame at EOF with fragmented UTF-8 and retain tool stop reason and final usage', async () => {
  const h = await harness();
  try {
    const text = frame({ response: google([{ text: '你好' }]) }).replaceAll('\n', '\r\n')
      + frame({ response: google([{ functionCall: { id: 'call-a', name: 'weather', args: {} }, thoughtSignature: 'signature' }]) })
      + 'data: ' + JSON.stringify({ response: { candidates: [{ finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 7, thoughtsTokenCount: 3, cachedContentTokenCount: 5 } } });
    const aggregated = await h.module.parseThinkingSSEResponse(new Response(upstream(text, 1)));
    assert.equal(aggregated.candidates[0].content.parts[0].text, '你好');
    assert.equal(aggregated.usageMetadata.candidatesTokenCount, 7);
    const a = events(await new Response(h.module.antigravityToAnthropicStream(upstream(text, 3), 'alias')).text());
    const end = a.find(event => event.type === 'message_delta');
    assert.equal(end.delta.stop_reason, 'tool_use');
    assert.equal(end.usage.input_tokens, 15); assert.equal(end.usage.output_tokens, 10);
    const o = events(await new Response(h.module.antigravityToOpenAIStream(upstream(text, 2), 'alias')).text());
    assert.equal(o.find(event => event.choices[0]?.finish_reason)?.choices[0].finish_reason, 'tool_calls');
    assert.equal(o.find(event => event.usage)?.usage.completion_tokens, 10);
    assert.ok(o.some(event => event.choices[0]?.delta.content === '你好'));
  } finally { h.close(); }
});

test('SSE errors are explicit and never echo credentials or finish as successful empty completions', async () => {
  const h = await harness();
  try {
    const text = frame({ error: { message: 'ya29.private-access 1//private-refresh private-client-secret' } });
    await assert.rejects(() => h.module.parseThinkingSSEResponse(new Response(upstream(text))), /upstream stream error/);
    for (const convert of [h.module.antigravityToAnthropicStream, h.module.antigravityToOpenAIStream]) {
      const result = await new Response(convert(upstream(text), 'alias')).text();
      assert.ok(result.includes('error'));
      assert.ok(!result.includes('private-'));
      assert.ok(!result.includes('message_stop'));
      assert.ok(!result.includes('"finish_reason":"stop"'));
    }
    assert.throws(() => h.module.parseGoogleResponseToAnthropic({ response: { error: { message: 'private-client-secret' } } }, 'alias'), /upstream error/);
  } finally { h.close(); }
});

test('thought signatures round-trip across fresh isolates through explicit OpenAI metadata and Anthropic content', async () => {
  const signature = 'signed-history-from-server';
  const h = await harness(async () => Response.json({ response: google([{ functionCall: { id: 'call-x', name: 'weather', args: { city: 'Tokyo' } }, thoughtSignature: signature }]) }), [ag]);
  let message;
  try {
    const result = await h.module.handleAntigravityCompletions({ model: 'alias', messages: user }, h.env, 'antigravity:gemini-2.5-flash', false);
    message = (await result.json()).choices[0].message;
    assert.equal(message.tool_calls[0].gemini_thought_signature, signature);
  } finally { h.close(); }
  const cold = await harness();
  try {
    for (const history of [message, { role: 'assistant', content: null, tool_calls: message.tool_calls }, { role: 'assistant', content: null, tool_calls: [{ ...message.tool_calls[0], gemini_thought_signature: undefined }] }]) {
      const request = cold.module.convertOpenAIReqToAnthropic({ model: 'gemini-3-flash', messages: [history, { role: 'tool', tool_call_id: 'call-x', content: 'sunny' }] });
      const { payload } = await cold.module.buildAntigravityCloudCodeRequest(request, 'project');
      assert.equal(payload.request.contents[0].parts[0].thoughtSignature, signature);
      assert.equal(payload.request.contents[1].parts[0].functionResponse.name, 'weather');
    }
    await assert.rejects(() => cold.module.buildAntigravityCloudCodeRequest({ model: 'gemini-3-flash', messages: [{ role: 'assistant', content: [{ type: 'tool_use', id: 'missing', name: 'weather', input: {} }] }] }, 'project'), { status: 400 });
  } finally { cold.close(); }
});

test('stream cancellation reaches upstream; MAX_TOKENS survives tool calls in both output protocols', async () => {
  const h = await harness();
  try {
    const text = frame({ response: google([{ functionCall: { id: 'id', name: 'tool', args: {} } }], 'MAX_TOKENS') });
    const a = events(await new Response(h.module.antigravityToAnthropicStream(upstream(text), 'alias')).text());
    assert.equal(a.find(event => event.type === 'message_delta').delta.stop_reason, 'max_tokens');
    const o = events(await new Response(h.module.antigravityToOpenAIStream(upstream(text), 'alias')).text());
    assert.equal(o.find(event => event.choices[0]?.finish_reason).choices[0].finish_reason, 'length');
    for (const convert of [h.module.antigravityToAnthropicStream, h.module.antigravityToOpenAIStream]) {
      let cancelled = false;
      const body = new ReadableStream({ cancel() { cancelled = true; } });
      const reader = convert(body, 'alias').getReader();
      await reader.cancel(); assert.equal(cancelled, true);
    }
  } finally { h.close(); }
});
