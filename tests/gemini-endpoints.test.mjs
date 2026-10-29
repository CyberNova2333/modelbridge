import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../_worker.js', import.meta.url), 'utf8');
let sequence = 0;
async function harness() {
  const requests = [];
  const config = { accounts: [{ id: 'cf', accountId: 'cf-id', apiToken: 'upstream-only-secret', status: 'active' }], apiKeys: [{ key: 'gateway-key' }], customModelMap: { chat: '@cf/test/chat', embedding: '@cf/test/embedding' } };
  const code = 'const network={fetch:null};const fetch=(...args)=>network.fetch(...args);\n' + source + `\nexport function setFetch(fn){network.fetch=fn;} // ${sequence++}`;
  const module = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
  module.setFetch(async (url, options) => {
    const body = JSON.parse(options.body);
    requests.push({ url: String(url), body, headers: options.headers });
    if (String(url).includes('/ai/run/')) return Response.json({ success: true, result: { data: body.text.map(() => [0.25, 0.5]) } });
    const result = { id: 'chat-test', object: 'chat.completion', model: body.model, choices: [{ index: 0, message: { role: 'assistant', content: '你好' }, finish_reason: 'stop' }], usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 } };
    if (!body.stream) return Response.json(result);
    const frames = [{ choices: [{ index: 0, delta: { content: '你' }, finish_reason: null }] }, { choices: [{ index: 0, delta: { content: '好' }, finish_reason: 'stop' }], usage: result.usage }];
    return new Response(frames.map(chunk => 'data: ' + JSON.stringify(chunk) + '\n\n').join('') + 'data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
  });
  const env = { KV: {}, ADMIN_PASSWORD: 'test-only-password', CONFIG_STORE: { idFromName: () => 'config', get: () => ({ fetch: async () => Response.json(config) }) } };
  const call = (path, { key = 'gateway-key', authHeader = 'x-goog-api-key', queryKey = false, method = 'GET', body } = {}) => module.default.fetch(new Request('https://test.invalid' + path + (queryKey ? (path.includes('?') ? '&' : '?') + 'key=' + key : ''), {
    method, headers: { ...(key && !queryKey ? { [authHeader]: key } : {}), 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }), env, {});
  return { call, requests };
}

test('Gemini key header and query key authenticate model listing, pagination and get', async () => {
  const { call, requests } = await harness();
  const denied = await call('/v1beta/models', { key: null });
  assert.equal(denied.status, 401);
  assert.equal((await denied.json()).error.status, 'UNAUTHENTICATED');
  const list = await call('/v1beta/models?pageSize=1', { queryKey: true });
  assert.equal(list.status, 200);
  const first = await list.json();
  assert.equal(first.models.length, 1);
  assert.equal(first.nextPageToken, '1');
  const second = await (await call('/v1beta/models?pageToken=1')).json();
  assert.equal(second.models[0].name, 'models/embedding');
  assert.deepEqual(second.models[0].supportedGenerationMethods, ['embedContent', 'batchEmbedContents']);
  assert.equal((await call('/v1beta/models/chat')).status, 200);
  assert.equal((await call('/v1beta/models/absent')).status, 404);
  assert.equal(requests.length, 0);
});

test('Gemini generateContent crosses into Cloudflare/OpenAI wire format and returns native schema', async () => {
  const { call, requests } = await harness();
  const response = await call('/v1beta/models/chat:generateContent', { method: 'POST', queryKey: true, body: { systemInstruction: { parts: [{ text: 'Be brief.' }] }, contents: [{ role: 'user', parts: [{ text: 'Hi' }] }], generationConfig: { maxOutputTokens: 20, temperature: 0.2 } } });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.candidates[0].content.parts[0].text, '你好');
  assert.equal(result.candidates[0].finishReason, 'STOP');
  assert.equal(result.usageMetadata.totalTokenCount, 6);
  assert.equal(requests[0].body.model, '@cf/test/chat');
  assert.equal(requests[0].body.max_tokens, 20);
  assert.equal(requests[0].body.messages[0].role, 'system');
  assert.equal(JSON.stringify(requests[0]).includes('gateway-key'), false);
});

test('Gemini streamGenerateContent exposes SSE and JSON array streams with a clean ending', async () => {
  const { call } = await harness();
  const body = { contents: [{ parts: [{ text: 'Hi' }] }] };
  const sseResponse = await call('/v1beta/models/chat:streamGenerateContent?alt=sse', { method: 'POST', body });
  assert.equal(sseResponse.status, 200);
  assert.match(sseResponse.headers.get('content-type'), /event-stream/);
  const frames = (await sseResponse.text()).split('\n').filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6)));
  assert.equal(frames.flatMap(frame => frame.candidates || []).flatMap(candidate => candidate.content?.parts || []).map(part => part.text || '').join(''), '你好');
  assert.ok(frames.some(frame => frame.candidates?.some(candidate => candidate.finishReason === 'STOP')));
  const jsonResponse = await call('/v1/models/chat:streamGenerateContent', { method: 'POST', body });
  assert.match(jsonResponse.headers.get('content-type'), /application\/json/);
  assert.ok(Array.isArray(await jsonResponse.json()));
});

test('Gemini embeddings and invalid requests return native response or structured errors', async () => {
  const { call, requests } = await harness();
  const content = { parts: [{ text: 'hello' }] };
  const one = await call('/v1beta/models/embedding:embedContent', { method: 'POST', body: { content } });
  assert.equal(one.status, 200);
  assert.deepEqual((await one.json()).embedding.values, [0.25, 0.5]);
  const batch = await call('/v1beta/models/embedding:batchEmbedContents', { method: 'POST', body: { requests: [{ content }, { content }] } });
  assert.equal((await batch.json()).embeddings.length, 2);
  const missing = await call('/v1beta/models/unknown:generateContent', { method: 'POST', body: { contents: [{ parts: [{ text: 'hello' }] }] } });
  assert.equal(missing.status, 400);
  assert.equal((await missing.json()).error.status, 'INVALID_ARGUMENT');
  const invalid = await call('/v1beta/models/chat:generateContent', { method: 'POST', body: { contents: [] } });
  assert.equal(invalid.status, 400);
  assert.equal(requests.length, 2);
});

test('browser Gemini and Anthropic preflights allow their native key/version headers', async () => {
  const { call } = await harness();
  const response = await call('/v1beta/models/chat:generateContent', { method: 'OPTIONS', key: null });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('access-control-allow-headers'), /x-goog-api-key/);
  assert.match(response.headers.get('access-control-allow-headers'), /anthropic-version/);
});

test('Anthropic JSON null produces a client error instead of a server failure', async () => {
  const { call, requests } = await harness();
  const response = await call('/v1/messages', { method: 'POST', authHeader: 'x-api-key', body: null });
  assert.equal(response.status, 400);
  assert.equal(requests.length, 0);
});
