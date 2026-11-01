import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
const source = await readFile(new URL('../_worker.js', import.meta.url), 'utf8');
let sequence = 0;
async function harness(accounts, mockFetch, map = {}) {
 const code = 'const network = { fetch: null }; const fetch = (...args) => network.fetch(...args);\n' + source + '\nexport { getAccountProvider, parseUpstreamTarget, getMatchingUpstreamAccounts, normalizeUpstreamBaseUrl, upstreamEndpoint, resolveModelName, callOpenAICompatibleAPI, handleEmbeddings, openAIToAnthropicUpstreamRequest, anthropicToOpenAIUpstreamResponse, anthropicToOpenAIUpstreamStream, sanitizeUpstreamErrorStream }; export function setNetwork(fn){network.fetch=fn;} // ' + sequence++;
 const module = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
 const config = { accounts, apiKeys: [{ key: 'mock-gateway-key' }], customModelMap: map };
 const env = { ADMIN_PASSWORD: 'test-password', KV: {}, CONFIG_STORE: { idFromName: () => 'config', get: () => ({ fetch: async () => Response.json(config) }) } };
 const requests = [];
 module.setNetwork(async (url, options) => { requests.push({ url: String(url), options, body: JSON.parse(options.body) }); return mockFetch(url, options); });
 return { module, env, requests, config };
}
const account = (provider, extra = {}) => ({ id: provider + '-account', provider, accountId: provider === 'cloudflare' ? 'cf-account' : '', apiToken: provider + '-secret', status: 'active', models: [], ...extra });
const request = { model: 'openai:test-model', messages: [{ role: 'user', content: 'hello' }] };
const completion = model => Response.json({ id: 'cmpl-test', model, object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content: 'hello' }, finish_reason: 'stop' }] });
class GatewayRequest extends Request { constructor(url, init = {}) { const headers = new Headers(init.headers); headers.set('authorization', 'Bearer mock-gateway-key'); super(url, { ...init, headers }); } }
const embeddingRequest = body => new GatewayRequest('https://gateway.test/v1/embeddings', { method: 'POST', body: JSON.stringify(body) });
const sse = events => new ReadableStream({ start(controller) { const encoder = new TextEncoder(); for (const event of events) controller.enqueue(encoder.encode('data: ' + JSON.stringify(event) + '\n\n')); controller.close(); } });

test('provider classification excludes legacy OAuth credentials from Cloudflare and resolves declared generic models before Antigravity', async () => {
 const { module, env } = await harness([account('anthropic', { models: ['claude-custom'] }), account('gemini', { models: ['gemini-custom'] }), { id: 'old-ag', apiToken: '1//legacy-refresh', status: 'active' }], () => { throw new Error('No network expected'); });
 assert.equal(module.getAccountProvider({ apiToken: '1//refresh' }), 'antigravity');
 assert.equal(module.getAccountProvider({ apiToken: 'ya29.access' }), 'antigravity');
 assert.equal(module.getAccountProvider({ provider: 'openai', apiToken: '1//unusual-key' }), 'openai');
 assert.equal(await module.resolveModelName('claude-custom', env), 'anthropic:claude-custom');
 assert.equal(await module.resolveModelName('gemini-custom', env), 'gemini:gemini-custom');
 assert.equal(await module.resolveModelName('claude-legacy', env), 'antigravity:claude-legacy');
 assert.equal(await module.resolveModelName('deleted-model', env), null);
 assert.equal(await module.resolveModelName('openai:private-model', env), 'openai:private-model');
});

test('OpenAI upstream joins versioned base URLs once, strips private native payload and never follows redirects', async () => {
 const { module, env, requests } = await harness([account('openai', { baseUrl: 'https://vendor.test/proxy/v1/' }), account('gemini')], () => completion('test-model'));
 const result = await module.callOpenAICompatibleAPI({ ...request, _anthropicRequest: { secretNative: true }, _outputProtocol: 'gemini', gemini_extra: { safetySettings: [] }, messages: [{ role: 'assistant', content: 'Previous', gemini_parts: [{ text: 'Previous' }], anthropic_content: [{ type: 'text', text: 'Previous' }], tool_calls: [{ id: 'call-one', type: 'function', function: { name: 'tool', arguments: '{}' }, gemini_thought_signature: 'private-signature' }] }, ...request.messages] }, env, false);
 assert.equal(result.success, true); assert.equal(requests.length, 1);
 assert.equal(requests[0].url, 'https://vendor.test/proxy/v1/chat/completions');
 assert.equal(requests[0].options.headers.Authorization, 'Bearer openai-secret');
 assert.equal(requests[0].options.redirect, 'manual');
 assert.equal(requests[0].body.model, 'test-model'); assert.equal(requests[0].body._anthropicRequest, undefined);
 assert.equal(requests[0].body._outputProtocol, undefined); assert.equal(requests[0].body.gemini_extra, undefined); assert.equal(requests[0].body.thinking_config, undefined);
 assert.equal(requests[0].body.messages[0].gemini_parts, undefined); assert.equal(requests[0].body.messages[0].anthropic_content, undefined); assert.equal(requests[0].body.messages[0].tool_calls[0].gemini_thought_signature, undefined);
 const constrained = await module.callOpenAICompatibleAPI({ ...request, thinking_config: { thinkingBudget: 4 } }, env, false);
 assert.equal(constrained.status, 400); assert.equal(requests.length, 1, 'an unsupported thinking budget must be rejected before generation');
 assert.equal(module.upstreamEndpoint(account('anthropic', { baseUrl: 'https://vendor.test/proxy' }), 'anthropic', 'messages'), 'https://vendor.test/proxy/v1/messages');
 assert.equal(module.upstreamEndpoint(account('openai', { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/' }), 'openai', 'chat/completions'), 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');
 assert.equal(module.upstreamEndpoint(account('openai', { baseUrl: 'https://vendor.test/v1/chat/completions' }), 'openai', 'embeddings'), 'https://vendor.test/v1/embeddings');
 assert.equal(module.upstreamEndpoint(account('openai', { baseUrl: 'https://vendor.test/custom/models' }), 'openai', 'chat/completions'), 'https://vendor.test/custom/chat/completions');
 assert.equal(module.upstreamEndpoint(account('anthropic', { baseUrl: 'https://vendor.test/v1/messages' }), 'anthropic', 'messages'), 'https://vendor.test/v1/messages');
 assert.equal(module.upstreamEndpoint(account('gemini', { baseUrl: 'https://vendor.test/v1beta/models' }), 'gemini', 'models/test:generateContent'), 'https://vendor.test/v1beta/models/test:generateContent');
 assert.throws(() => module.upstreamEndpoint(account('gemini', { baseUrl: 'https://vendor.test/v1beta/models/fixed:generateContent' }), 'gemini', 'models/test:generateContent'), /particular model/);
 assert.throws(() => module.normalizeUpstreamBaseUrl(account('openai', { baseUrl: 'http://vendor.test/v1' })), /HTTPS/);
 assert.throws(() => module.normalizeUpstreamBaseUrl(account('openai', { baseUrl: 'https://user:password@vendor.test/v1' })), /HTTPS/);
 assert.equal(module.normalizeUpstreamBaseUrl(account('openai', { baseUrl: 'http://127.0.0.1:8787/v1/' })), 'http://127.0.0.1:8787/v1');
});

test('model allowlists and selected upstream IDs constrain credential routing; Cloudflare is isolated', async () => {
 const accounts = [account('openai', { id: 'allowed', models: ['target'] }), account('openai', { id: 'other', models: ['other'] }), account('cloudflare'), { id: 'ag', apiToken: '1//refresh', status: 'active' }];
 const { module, env, requests } = await harness(accounts, () => completion('target'));
 assert.equal((await module.callOpenAICompatibleAPI({ ...request, model: 'upstream:allowed:target' }, env, false)).success, true);
 assert.equal(requests.length, 1);
 assert.equal((await module.callOpenAICompatibleAPI({ ...request, model: 'upstream:other:target' }, env, false)).status, 503);
 assert.equal(requests.length, 1);
 assert.equal((await module.callOpenAICompatibleAPI({ ...request, model: '@cf/test/model' }, env, false)).success, true);
 assert.equal(requests[1].url, 'https://api.cloudflare.com/client/v4/accounts/cf-account/ai/v1/chat/completions');
 assert.equal(requests[1].options.headers.Authorization, 'Bearer cloudflare-secret');
});

test('bad upstream requests do not fan out, rate limits fail over and reflected API keys are redacted', async () => {
 const accounts = [account('openai', { id: 'one' }), account('openai', { id: 'two' })];
 const bad = await harness(accounts, () => Response.json({ error: { message: 'Invalid openai-secret payload' } }, { status: 400 }));
 const result = await bad.module.callOpenAICompatibleAPI(request, bad.env, false);
 assert.equal(result.status, 400); assert.equal(bad.requests.length, 1); assert.equal(result.error.includes('openai-secret'), false);
 let attempts = 0;
 const retry = await harness(accounts, () => ++attempts === 1 ? Response.json({ error: { message: 'Try later' } }, { status: 429 }) : completion('test-model'));
 assert.equal((await retry.module.callOpenAICompatibleAPI(request, retry.env, false)).success, true); assert.equal(attempts, 2);
});

test('Anthropic upstream conversion preserves systems, images, parallel tool context, choices and usage', async () => {
 const { module, env, requests } = await harness([account('anthropic')], () => Response.json({ id: 'msg-test', stop_reason: 'tool_use', usage: { input_tokens: 4, output_tokens: 8, cache_read_input_tokens: 2 }, content: [{ type: 'text', text: 'Searching' }, { type: 'tool_use', id: 'tool-id', name: 'find', input: { q: 'test' } }] }));
 const payload = { model: 'anthropic:claude-test', messages: [{ role: 'system', content: 'Be concise' }, { role: 'user', content: [{ type: 'text', text: 'Look' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,eA==' } }] }, { role: 'assistant', content: null, tool_calls: [{ id: 'old-call', type: 'function', function: { name: 'find', arguments: '{"q":"previous"}' } }] }, { role: 'tool', tool_call_id: 'old-call', content: 'previous result' }], tools: [{ type: 'function', function: { name: 'find', parameters: { type: 'object' } } }], tool_choice: 'required', parallel_tool_calls: false, max_tokens: 128 };
 const result = await module.callOpenAICompatibleAPI(payload, env, false);
 assert.equal(result.success, true); assert.equal(requests[0].url, 'https://api.anthropic.com/v1/messages');
 assert.equal(requests[0].options.headers['x-api-key'], 'anthropic-secret'); assert.equal(requests[0].options.headers['anthropic-version'], '2023-06-01');
 assert.equal(requests[0].body.system[0].text, 'Be concise'); assert.equal(requests[0].body.messages[0].content[1].source.type, 'base64');
 assert.deepEqual(requests[0].body.messages[1].content[0].input, { q: 'previous' }); assert.equal(requests[0].body.messages[2].content[0].tool_use_id, 'old-call');
 assert.deepEqual(requests[0].body.tool_choice, { type: 'any', disable_parallel_tool_use: true });
 assert.equal(result.data.choices[0].finish_reason, 'tool_calls'); assert.equal(result.data.choices[0].message.tool_calls[0].function.arguments, '{"q":"test"}'); assert.equal(result.data.usage.total_tokens, 14);
});

test('native Anthropic input stays native when routed to Anthropic', async () => {
 const { module, env, requests } = await harness([account('anthropic')], () => Response.json({ content: [], usage: {}, stop_reason: 'end_turn' }));
 const native = { model: 'alias', max_tokens: 42, messages: [{ role: 'user', content: [{ type: 'text', text: 'hi', cache_control: { type: 'ephemeral' } }] }], thinking: { type: 'enabled', budget_tokens: 1024 } };
 await module.callOpenAICompatibleAPI({ ...request, model: 'anthropic:claude-test', _anthropicRequest: native }, env, false);
 assert.deepEqual(requests[0].body.messages, native.messages); assert.deepEqual(requests[0].body.thinking, native.thinking); assert.equal(requests[0].body.model, 'claude-test');
});

test('native Anthropic output retains signed thinking blocks and original incremental stream', async () => {
 const upstream = { id: 'msg-native', model: 'claude-test', type: 'message', role: 'assistant', content: [{ type: 'thinking', thinking: 'Reasoning', signature: 'signed-reasoning' }, { type: 'redacted_thinking', data: 'opaque' }, { type: 'text', text: 'Answer' }], stop_reason: 'end_turn', usage: { input_tokens: 4, output_tokens: 8 } };
 const h = await harness([account('anthropic')], () => Response.json(upstream));
 const result = await h.module.callOpenAICompatibleAPI({ ...request, model: 'anthropic:claude-test', _outputProtocol: 'anthropic' }, h.env, false);
 assert.equal(result.nativeAnthropic, true); assert.deepEqual(result.data, upstream);
 const events = [{ type: 'message_start', message: { id: 'msg-native', usage: {} } }, { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'signed-reasoning' } }, { type: 'message_stop' }];
 const stream = await harness([account('anthropic')], () => new Response(sse(events)));
 const streamed = await stream.module.callOpenAICompatibleAPI({ ...request, model: 'anthropic:claude-test', _outputProtocol: 'anthropic' }, stream.env, true);
 assert.equal(streamed.nativeAnthropic, true); const text = await new Response(streamed.stream).text(); assert.ok(text.includes('signature_delta')); assert.ok(text.includes('signed-reasoning')); assert.equal(text.includes('chat.completion.chunk'), false);
});

test('Gemini upstream uses its native endpoint, API-key header and SSE protocol while returning OpenAI data', async () => {
 const json = await harness([account('gemini', { baseUrl: 'https://gemini.vendor/v1beta/' })], () => Response.json({ responseId: 'gemini-id', candidates: [{ index: 0, content: { role: 'model', parts: [{ text: 'Hello' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 1, totalTokenCount: 3 } }));
 const response = await json.module.callOpenAICompatibleAPI({ ...request, model: 'gemini:gemini-test', max_tokens: 32 }, json.env, false);
 assert.equal(response.success, true); assert.equal(response.data.choices[0].message.content, 'Hello'); assert.equal(response.data.usage.total_tokens, 3);
 assert.equal(json.requests[0].url, 'https://gemini.vendor/v1beta/models/gemini-test:generateContent'); assert.equal(json.requests[0].options.headers['x-goog-api-key'], 'gemini-secret'); assert.equal(json.requests[0].body.generationConfig.maxOutputTokens, 32);
 assert.deepEqual(json.requests[0].body.contents[0], { role: 'user', parts: [{ text: 'hello' }] });
 const streaming = await harness([account('gemini')], () => new Response(sse([{ candidates: [{ index: 0, content: { role: 'model', parts: [{ text: 'Hello' }] } }] }, { candidates: [{ index: 0, content: { role: 'model', parts: [] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 1, totalTokenCount: 3 } }]), { headers: { 'content-type': 'text/event-stream' } }));
 const streamed = await streaming.module.callOpenAICompatibleAPI({ ...request, model: 'gemini:gemini-test' }, streaming.env, true);
 assert.equal(streamed.success, true); const text = await new Response(streamed.stream).text(); assert.ok(text.includes('Hello')); assert.ok(text.includes('[DONE]'));
 assert.equal(streaming.requests[0].url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-test:streamGenerateContent?alt=sse');
 const invalid = await json.module.callOpenAICompatibleAPI({ ...request, model: 'gemini:gemini-test', messages: [{ role: 'tool', tool_call_id: 'unknown', content: 'result' }] }, json.env, false);
 assert.equal(invalid.status, 400); assert.equal(json.requests.length, 1);
});

test('Anthropic SSE translates text, parallel tool indexes, thinking, usage and completion without buffering full message', async () => {
 const { module } = await harness([], () => { throw new Error('No network'); });
 const events = [
  { type: 'message_start', message: { id: 'msg-stream', usage: { input_tokens: 5 } } },
  { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'reason' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'signature' } },
  { type: 'content_block_stop', index: 0 },
  { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'a', name: 'first', input: {} } },
  { type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 'b', name: 'second', input: {} } },
  { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '{"b":2}' } },
  { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"a":1}' } },
  { type: 'content_block_stop', index: 2 }, { type: 'content_block_stop', index: 1 },
  { type: 'message_delta', delta: { stop_reason: 'max_tokens' }, usage: { output_tokens: 7 } }, { type: 'message_stop' }
 ];
 const bytes = await new Response(module.anthropicToOpenAIUpstreamStream(sse(events), 'claude-test')).text();
 const output = bytes.split('\n').filter(line => line.startsWith('data: ') && !line.includes('[DONE]')).map(line => JSON.parse(line.slice(6)));
 assert.equal(output[1].choices[0].delta.reasoning_content, 'reason'); assert.equal(output[1].choices[0].delta.anthropic_signature, 'signature');
 const toolDeltas = output.filter(x => x.choices[0]?.delta.tool_calls?.[0]?.function?.arguments);
 assert.deepEqual(toolDeltas.map(x => x.choices[0].delta.tool_calls[0].index), [0, 1]);
 assert.equal(output.at(-2).choices[0].finish_reason, 'length'); assert.equal(output.at(-1).usage.total_tokens, 12); assert.equal(bytes.split('data: [DONE]').length, 2);
 let cancelled = false; const controlled = new ReadableStream({ pull(c) { c.enqueue(new TextEncoder().encode('data: '+JSON.stringify(events[0])+'\n\n')); }, cancel() { cancelled = true; } });
 const reader = module.anthropicToOpenAIUpstreamStream(controlled, 'test').getReader(); await reader.read(); await reader.cancel(); assert.equal(cancelled, true);
});

test('OpenAI and Gemini embedding upstreams preserve model routing and emit OpenAI embedding schema', async () => {
 const openai = await harness([account('openai', { models: ['embedding-test'] })], () => Response.json({ object: 'list', data: [{ object: 'embedding', index: 0, embedding: [0.25, -0.5] }], usage: { prompt_tokens: 2, total_tokens: 2 } }), { vector: 'openai:embedding-test' });
 const r = await openai.module.handleEmbeddings(embeddingRequest({ model: 'vector', input: 'hello', encoding_format: 'base64', dimensions: 2 }), openai.env);
 assert.equal(r.status, 200); const result = await r.json(); assert.equal(result.model, 'vector'); assert.equal(Buffer.from(result.data[0].embedding, 'base64').readFloatLE(0), 0.25); assert.equal(openai.requests[0].url, 'https://api.openai.com/v1/embeddings');
 const gemini = await harness([account('gemini', { baseUrl: 'https://gemini.vendor/v1beta' })], () => Response.json({ embeddings: [{ values: [1,2] }, { values: [3,4] }], usageMetadata: { totalTokenCount: 3 } }), { vector: 'gemini:gemini-embedding-test' });
 const g = await gemini.module.handleEmbeddings(embeddingRequest({ model: 'vector', input: ['a','b'], dimensions: 2 }), gemini.env);
 assert.equal(g.status, 200); const data = await g.json(); assert.deepEqual(data.data.map(x=>x.embedding), [[1,2],[3,4]]); assert.equal(data.usage.total_tokens, 3);
 assert.equal(gemini.requests[0].url, 'https://gemini.vendor/v1beta/models/gemini-embedding-test:batchEmbedContents'); assert.equal(gemini.requests[0].options.headers['x-goog-api-key'], 'gemini-secret'); assert.equal(gemini.requests[0].body.requests[0].embedContentConfig.outputDimensionality, 2);
 const anth = await harness([account('anthropic')], () => { throw new Error('Must not call network'); }, { vector: 'anthropic:embedding' });
 assert.equal((await anth.module.handleEmbeddings(embeddingRequest({ model: 'vector', input: 'hello' }), anth.env)).status, 400);
});

test('OpenAI HTTP streaming output survives byte fragments, CRLF, metadata and an unterminated final usage frame', async () => {
 const frames = ': heartbeat\r\n\r\n' + 'id: event-1\r\ndata: ' + JSON.stringify({ id: 'cmpl-stream', object: 'chat.completion.chunk', model: 'upstream-model', choices: [{ index: 0, delta: { content: '你好' }, finish_reason: null }] }) + '\r\n\r\n' + 'data: ' + JSON.stringify({ id: 'cmpl-stream', model: 'upstream-model', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }) + '\r\n\r\n' + 'data: ' + JSON.stringify({ id: 'cmpl-stream', model: 'upstream-model', choices: [], usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 } });
 const bytes = new TextEncoder().encode(frames); let index = 0;
 const h = await harness([account('openai')], () => new Response(new ReadableStream({ pull(controller) { if (index === bytes.length) controller.close(); else controller.enqueue(bytes.subarray(index, ++index)); } }), { headers: { 'content-type': 'text/event-stream' } }), { alias: 'openai:upstream-model' });
 const response = await h.module.default.fetch(new GatewayRequest('https://gateway.test/v1/chat/completions', { method: 'POST', body: JSON.stringify({ model: 'alias', messages: request.messages, stream: true }) }), h.env, {});
 assert.equal(response.status, 200); assert.equal(response.headers.get('content-type'), 'text/event-stream');
 const text = await response.text(); assert.ok(text.includes(': heartbeat\n\n')); assert.ok(text.includes('id: event-1\n'));
 const payloads = text.split('\n').filter(line => line.startsWith('data: ') && !line.includes('[DONE]')).map(line => JSON.parse(line.slice(6)));
 assert.equal(payloads[0].choices[0].delta.content, '你好'); assert.equal(payloads[1].choices[0].finish_reason, 'stop'); assert.equal(payloads[2].usage.total_tokens, 3); assert.ok(payloads.every(chunk => chunk.model === 'alias'));
 assert.equal(text.split('data: [DONE]').length, 2);
});

test('OpenAI HTTP streaming forwards errors and downstream cancellation to the upstream reader', async () => {
 let cancelled = false;
 const encoder = new TextEncoder();
 const h = await harness([account('openai')], () => new Response(new ReadableStream({ pull(controller) { controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"chunk"}}]}\n\n')); }, cancel() { cancelled = true; } })));
 const response = await h.module.default.fetch(new GatewayRequest('https://gateway.test/v1/chat/completions', { method: 'POST', body: JSON.stringify({ ...request, stream: true }) }), h.env, {});
 const reader = response.body.getReader(); await reader.read(); await reader.cancel(); assert.equal(cancelled, true);
 const broken = await harness([account('openai')], () => new Response(new ReadableStream({ start(controller) { controller.error(new Error('upstream disconnected')); } })));
 const failed = await broken.module.default.fetch(new GatewayRequest('https://gateway.test/v1/chat/completions', { method: 'POST', body: JSON.stringify({ ...request, stream: true }) }), broken.env, {});
 const failure = await failed.text(); assert.match(failure, /"type":"upstream_error"/); assert.equal(failure.includes('[DONE]'), false);
});

test('streaming requests reject upstream JSON responses instead of returning malformed SSE', async () => {
 const h = await harness([account('openai')], () => completion('test-model'));
 const response = await h.module.default.fetch(new GatewayRequest('https://gateway.test/v1/chat/completions', { method: 'POST', body: JSON.stringify({ ...request, stream: true }) }), h.env, {});
 assert.equal(response.status, 502); assert.match((await response.json()).error.message, /non-SSE/);
 const result = await h.module.callOpenAICompatibleAPI(request, h.env, false);
 assert.equal(result.success, true); assert.equal(result.data.choices[0].message.content, 'hello');
});

test('HTTP 200 SSE provider errors cannot reflect credentials through any generic upstream or native Anthropic passthrough', async t => {
 for (const [provider, client] of [['openai','openai'],['gemini','openai'],['anthropic','openai'],['anthropic','anthropic'],['cloudflare','openai']]) {
  await t.test(`${provider} error → ${client} client`, async () => {
   const token = 'upstream-token-特殊-+/=?';
   const error = { ...(provider === 'anthropic' ? { type: 'error' } : {}), error: { type: 'api_error', message: 'Reflected ' + token, details: [{ url: 'https://example.test/?key=' + encodeURIComponent(token) }] } };
   const bytes = new TextEncoder().encode('event: error\r\ndata: ' + JSON.stringify(error) + '\r\n\r\n');
   let position = 0;
   const h = await harness([account(provider,{apiToken:token})], () => new Response(new ReadableStream({ pull(controller){ if(position===bytes.length)controller.close();else controller.enqueue(bytes.subarray(position,++position)); } }),{headers:{'content-type':'text/event-stream'}}), { alias: provider === 'cloudflare' ? '@cf/test/model' : `${provider}:model` });
   const path = client === 'anthropic' ? '/v1/messages' : '/v1/chat/completions';
   const response = await h.module.default.fetch(new GatewayRequest('https://gateway.test'+path,{method:'POST',body:JSON.stringify({model:'alias',messages:request.messages,max_tokens:32,stream:true})}),h.env,{});
   assert.equal(response.status,200);const text=await response.text();
   assert.equal(text.includes(token),false);assert.equal(text.includes(encodeURIComponent(token)),false);assert.ok(text.includes('[redacted]'));
   if(client==='anthropic') { const data=JSON.parse(text.split('\n').find(line=>line.startsWith('data: ')).slice(6));assert.equal(data.type,'error');assert.equal(data.error.type,'api_error'); }
  });
 }
});

test('SSE error sanitizer handles multiline data and EOF without altering ordinary model text or signed data', async () => {
 const h=await harness([],()=>{throw new Error('No network');});const token='keep-this-string-in-normal-text';const provider=account('anthropic',{apiToken:token});
 const normal='event: content_block_delta\r\ndata: '+JSON.stringify({type:'content_block_delta',delta:{type:'signature_delta',signature:token}})+'\r\n\r\n';
 const modelText='data: '+JSON.stringify({choices:[{delta:{content:token}}]})+'\n\n';
 const last='event: error\ndata: {"type":"error",\ndata: "error":{"message":"'+token+'","details":["'+token+'"]}}';
 const bytes=new TextEncoder().encode(normal+modelText+last);let position=0;
 const upstream=new ReadableStream({pull(controller){if(position===bytes.length)controller.close();else controller.enqueue(bytes.subarray(position,++position));}});
 const output=await new Response(h.module.sanitizeUpstreamErrorStream(upstream,provider)).text();
 assert.ok(output.startsWith(normal+modelText));const tail=output.slice(normal.length+modelText.length);assert.equal(tail.includes(token),false);assert.ok(tail.includes('[redacted]'));
 const parsed=JSON.parse(tail.split('\n').find(line=>line.startsWith('data: ')).slice(6));assert.equal(parsed.error.message,'[redacted]');assert.deepEqual(parsed.error.details,['[redacted]']);
});

test('SSE sanitizer redacts transport errors and propagates cancellation to its upstream', async () => {
 const h=await harness([],()=>{throw new Error('No network');});const provider=account('openai',{apiToken:'transport-secret'});
 const broken=new ReadableStream({start(controller){controller.error(new Error('Failed with transport-secret'));}});
 await assert.rejects(()=>new Response(h.module.sanitizeUpstreamErrorStream(broken,provider)).text(),error=>error.message.includes('[redacted]')&&!error.message.includes('transport-secret'));
 let cancelled=false;const source=new ReadableStream({pull(controller){controller.enqueue(new TextEncoder().encode('data: {"choices":[]}\n\n'));},cancel(){cancelled=true;}});
 const reader=h.module.sanitizeUpstreamErrorStream(source,provider).getReader();await reader.read();await reader.cancel();assert.equal(cancelled,true);
});

test('all three client protocols cross all three generic upstream protocols in JSON and streaming modes', async t => {
 for (const provider of ['openai', 'anthropic', 'gemini']) {
  for (const client of ['openai', 'anthropic', 'gemini']) {
   for (const stream of [false, true]) await t.test(`${client} client → ${provider} upstream (${stream ? 'SSE' : 'JSON'})`, async () => {
    const h = await harness([account(provider)], () => {
     if (provider === 'openai') return stream ? new Response(sse([{ id: 'cmpl', model: 'test', choices: [{ index: 0, delta: { content: 'Hello' }, finish_reason: null }] }, { id: 'cmpl', model: 'test', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }]), { headers: { 'content-type': 'text/event-stream' } }) : completion('test');
     if (provider === 'anthropic') {
      const response = { id: 'msg', type: 'message', role: 'assistant', model: 'test', content: [{ type: 'text', text: 'Hello' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } };
      return stream ? new Response(sse([{ type: 'message_start', message: { ...response, content: [], stop_reason: null } }, { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }, { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello' } }, { type: 'content_block_stop', index: 0 }, { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } }, { type: 'message_stop' }]), { headers: { 'content-type': 'text/event-stream' } }) : Response.json(response);
     }
     const response = { responseId: 'gemini-response', candidates: [{ index: 0, content: { role: 'model', parts: [{ text: 'Hello' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 } };
     return stream ? new Response(sse([response]), { headers: { 'content-type': 'text/event-stream' } }) : Response.json(response);
    }, { alias: `${provider}:test` });
    const path = client === 'openai' ? '/v1/chat/completions' : client === 'anthropic' ? '/v1/messages' : `/v1beta/models/alias:${stream ? 'streamGenerateContent?alt=sse' : 'generateContent'}`;
    const body = client === 'gemini' ? { contents: [{ role: 'user', parts: [{ text: 'Hello' }] }], generationConfig: { maxOutputTokens: 32 } } : { model: 'alias', messages: [{ role: 'user', content: 'Hello' }], max_tokens: 32, stream };
    const response = await h.module.default.fetch(new GatewayRequest('https://gateway.test' + path, { method: 'POST', body: JSON.stringify(body) }), h.env, {});
    assert.equal(response.status, 200);
    if (!stream) {
     const data = await response.json(); const text = client === 'openai' ? data.choices[0].message.content : client === 'anthropic' ? data.content[0].text : data.candidates[0].content.parts[0].text;
     assert.equal(text.toLowerCase(), 'hello');
    } else {
     const frames = (await response.text()).split('\n').filter(line => line.startsWith('data: ') && !line.includes('[DONE]')).map(line => JSON.parse(line.slice(6)));
     const text = frames.map(data => client === 'openai' ? data.choices?.[0]?.delta?.content || '' : client === 'anthropic' ? data.delta?.text || '' : data.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('') || '').join('');
     assert.equal(text.toLowerCase(), 'hello');
    }
    assert.equal(h.requests.length, 1);
   });
  }
 }
});
