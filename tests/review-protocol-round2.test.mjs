import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../_worker.js', import.meta.url), 'utf8');
let sequence = 0;
const frame = value => 'data: ' + JSON.stringify(value) + '\n\n';
const events = wire => wire.split(/\r?\n/).filter(line => line.startsWith('data: ') && line !== 'data: [DONE]').map(line => JSON.parse(line.slice(6)));
const schema = { type: 'object', properties: { value: { type: 'number' } }, required: ['value'], additionalProperties: false };
const textResponse = () => Response.json({ choices: [{ index: 0, message: { role: 'assistant', content: 'answer' }, finish_reason: 'stop' }] });
const geminiInput = config => ({ contents: [{ role: 'user', parts: [{ text: 'hello' }] }], ...(config ? { generation_config: config } : {}) });
function anthropicResponse(reason = 'end_turn') { return { id: 'msg-fixture', type: 'message', role: 'assistant', model: 'actual', content: [{ type: 'text', text: 'partial answer' }], stop_reason: reason, usage: { input_tokens: 2, output_tokens: 1 } }; }
function anthropicStream(reason) {
  const data = [
    { type: 'message_start', message: { ...anthropicResponse(null), content: [] } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'partial answer' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: reason }, usage: { output_tokens: 1 } },
    { type: 'message_stop' },
  ];
  return new Response(data.map(frame).join(''), { headers: { 'content-type': 'text/event-stream' } });
}
async function harness(provider, network = textResponse, accountOverrides = {}) {
  const api = await import('data:text/javascript;base64,' + Buffer.from('let network; const fetch = (...args) => network(...args);\n' + source + '\nexport const mockNetwork = value => network = value;\n// round two ' + sequence++).toString('base64'));
  const calls = [];
  api.mockNetwork(async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return network(url, init); });
  const target = provider === 'cloudflare' ? '@cf/meta/fixture' : provider === 'antigravity' ? 'antigravity:gemini-2.5-flash' : provider + ':actual';
  const config = {
    accounts: [{ id: 'fixture', provider, status: 'active', accountId: 'fixture@example.invalid', apiToken: provider === 'antigravity' ? 'ya29.fixture' : 'fixture-upstream', projectId: 'fixture-project', projectSource: 'manual', baseUrl: 'https://upstream.invalid/v1', models: [], ...accountOverrides }],
    apiKeys: [{ key: 'fixture-client' }], customModelMap: { alias: target },
  };
  const env = { KV: { get: async () => null }, ADMIN_PASSWORD: 'fixture-admin', CONFIG_STORE: { idFromName: value => value, get: () => ({ fetch: async () => Response.json(config) }) } };
  return { calls, call: (path, body) => api.default.fetch(new Request('https://gateway.invalid' + path, { method: 'POST', headers: { authorization: 'Bearer fixture-client' }, body: JSON.stringify(body) }), env, {}) };
}
function openAIInput(strict = true) { return { model: 'alias', messages: [{ role: 'user', content: 'hello' }], tools: [{ type: 'function', function: { name: 'record', parameters: schema, strict } }] }; }
function anthropicInput(strict = true) { return { model: 'alias', max_tokens: 100, messages: [{ role: 'user', content: 'hello' }], tools: [{ name: 'record', input_schema: schema, strict }] }; }

test('Gemini snake_case generation constraints become the same OpenAI request as canonical fields', async () => {
  const h = await harness('openai');
  const response = await h.call('/v1beta/models/alias:generateContent', geminiInput({ response_mime_type: 'application/json', response_schema: { type: 'OBJECT', properties: { value: { type: 'NUMBER' } } }, max_output_tokens: 1, top_p: 0.2, stop_sequences: ['done'] }));
  assert.equal(response.status, 200, await response.clone().text());
  const sent = h.calls[0].body;
  assert.equal(sent.max_tokens, 1);
  assert.equal(sent.top_p, 0.2);
  assert.deepEqual(sent.stop, ['done']);
  assert.equal(sent.response_format.type, 'json_schema');
  assert.equal(sent.response_format.json_schema.schema.properties.value.type, 'number');
  assert.equal(h.calls.length, 1);
});

test('snake_case zero thinking budget is preserved by Gemini and Antigravity and rejected elsewhere', async () => {
  for (const provider of ['gemini', 'antigravity', 'openai', 'anthropic', 'cloudflare']) {
    const h = await harness(provider, () => Response.json(provider === 'antigravity' ? { response: { candidates: [{ content: { parts: [{ text: 'answer' }] }, finishReason: 'STOP' }] } } : { candidates: [{ content: { parts: [{ text: 'answer' }] }, finishReason: 'STOP' }] }));
    const response = await h.call('/v1beta/models/alias:generateContent', geminiInput({ thinking_config: { thinking_budget: 0, include_thoughts: false }, max_output_tokens: 15 }));
    assert.equal(response.status, ['gemini', 'antigravity'].includes(provider) ? 200 : 400, await response.clone().text());
    if (!['gemini', 'antigravity'].includes(provider)) assert.equal(h.calls.length, 0);
    else {
      const sent = provider === 'antigravity' ? h.calls[0].body.request : h.calls[0].body;
      assert.deepEqual(sent.generationConfig.thinkingConfig, { thinkingBudget: 0, includeThoughts: false });
      assert.equal(sent.generationConfig.maxOutputTokens, 15);
    }
  }
});

test('conflicting Gemini aliases fail before contacting any provider', async () => {
  const cases = [
    { generationConfig: { maxOutputTokens: 1 }, generation_config: { max_output_tokens: 2 } },
    { generationConfig: { maxOutputTokens: 1, max_output_tokens: 2 } },
    { generation_config: { thinkingConfig: { thinkingBudget: 0 }, thinking_config: { thinking_budget: 1 } } },
    { generation_config: { thinking_config: { thinkingBudget: 0, thinking_budget: 1 } } },
    { generationConfig: { responseMimeType: 'application/json', response_mime_type: 'text/plain' } },
    { toolConfig: { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: ['a'], allowed_function_names: ['b'] } } },
    { toolConfig: { functionCallingConfig: { mode: 'NONE' }, function_calling_config: { mode: 'ANY' } } },
    { tools: [{ functionDeclarations: [{ name: 'a', parametersJsonSchema: schema }], function_declarations: [{ name: 'b', parameters_json_schema: schema }] }] },
  ];
  for (const provider of ['gemini', 'openai']) for (const extra of cases) {
    const h = await harness(provider, () => { throw new Error('No network work allowed'); });
    const response = await h.call('/v1beta/models/alias:generateContent', { ...geminiInput(), ...extra });
    assert.equal(response.status, 400, await response.clone().text());
    assert.equal(h.calls.length, 0);
  }
});

test('equivalent mixed aliases are normalized and JSON Schema literals remain byte-for-byte meaningful', async () => {
  const literalSchema = { type: 'object', properties: { type: { type: 'string', default: 'UPPER' } }, default: { type: 'UPPER', response_schema: { max_output_tokens: 2 } }, examples: [{ type: 'EXAMPLE' }], const: { type: 'CONSTANT' } };
  for (const provider of ['openai', 'gemini']) {
    const h = await harness(provider, () => provider === 'openai' ? textResponse() : Response.json({ candidates: [{ content: { parts: [{ text: 'answer' }] }, finishReason: 'STOP' }] }));
    const response = await h.call('/v1beta/models/alias:generateContent', {
      ...geminiInput(), generationConfig: { maxOutputTokens: 4, responseMimeType: 'application/json', responseJsonSchema: literalSchema },
      generation_config: { max_output_tokens: 4, response_mime_type: 'application/json', response_json_schema: literalSchema },
      tools: [{ function_declarations: [{ name: 'record', parameters_json_schema: literalSchema }] }],
      tool_config: { function_calling_config: { mode: 'any', allowed_function_names: ['record'] } },
    });
    assert.equal(response.status, 200, await response.clone().text());
    const sent = h.calls[0].body;
    assert.deepEqual(provider === 'openai' ? sent.response_format.json_schema.schema : sent.generationConfig.responseJsonSchema, literalSchema);
    assert.deepEqual(provider === 'openai' ? sent.tools[0].function.parameters : sent.tools[0].functionDeclarations[0].parametersJsonSchema, literalSchema);
    if (provider === 'openai') assert.equal(sent.tool_choice.function.name, 'record');
    else assert.deepEqual(sent.toolConfig.functionCallingConfig, { mode: 'ANY', allowedFunctionNames: ['record'] });
  }
});

test('Gemini Schema normalizes schema node types without rewriting default, enum or example literals', async () => {
  const h = await harness('openai');
  const response = await h.call('/v1beta/models/alias:generateContent', geminiInput({ response_mime_type: 'application/json', response_schema: { type: 'OBJECT', properties: { type: { type: 'STRING' } }, default: { type: 'UPPER' }, enum: [{ type: 'ENUM_LITERAL' }], example: { type: 'EXAMPLE' } } }));
  assert.equal(response.status, 200);
  const sent = h.calls[0].body.response_format.json_schema.schema;
  assert.equal(sent.type, 'object'); assert.equal(sent.properties.type.type, 'string');
  assert.deepEqual(sent.default, { type: 'UPPER' }); assert.deepEqual(sent.enum, [{ type: 'ENUM_LITERAL' }]); assert.deepEqual(sent.example, { type: 'EXAMPLE' });
});

test('unrepresentable generation and tool constraints reject cross-protocol work but stay native for Gemini', async () => {
  for (const constraint of [
    { generationConfig: { responseFormat: { mimeType: 'application/json' } } },
    { generation_config: { image_config: { aspectRatio: '1:1' } } },
    { generation_config: { futureConstraint: true } },
    { tool_config: { function_calling_config: { mode: 'VALIDATED' } } },
    { tool_config: { function_calling_config: { stream_function_call_arguments: true } } },
  ]) for (const provider of ['openai', 'anthropic', 'cloudflare', 'antigravity', 'gemini']) {
    const h = await harness(provider, () => Response.json({ candidates: [{ content: { parts: [{ text: 'answer' }] }, finishReason: 'STOP' }] }));
    const response = await h.call('/v1beta/models/alias:generateContent', { ...geminiInput(), ...constraint });
    assert.equal(response.status, provider === 'gemini' ? 200 : 400, await response.clone().text());
    assert.equal(h.calls.length, provider === 'gemini' ? 1 : 0);
    if (provider === 'gemini') assert.ok(h.calls[0].body.generationConfig || h.calls[0].body.toolConfig);
  }
});

test('strict true and false survive both OpenAI and Anthropic tool translations', async () => {
  for (const strict of [true, false]) for (const provider of ['openai', 'anthropic']) {
    const h = await harness(provider, () => provider === 'openai' ? textResponse() : Response.json(anthropicResponse()));
    const response = await h.call(provider === 'openai' ? '/v1/messages' : '/v1/chat/completions', provider === 'openai' ? anthropicInput(strict) : openAIInput(strict));
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal(provider === 'openai' ? h.calls[0].body.tools[0].function.strict : h.calls[0].body.tools[0].strict, strict);
    assert.equal(h.calls.length, 1);
  }
});

test('strict tool guarantees reject unsupported providers before OAuth or generation in either client protocol', async () => {
  for (const provider of ['gemini', 'cloudflare', 'antigravity']) for (const client of ['openai', 'anthropic']) for (const stream of [false, true]) {
    const h = await harness(provider, () => { throw new Error('No network work allowed'); });
    const response = await h.call(client === 'openai' ? '/v1/chat/completions' : '/v1/messages', { ...(client === 'openai' ? openAIInput() : anthropicInput()), stream });
    assert.equal(response.status, 400, await response.clone().text());
    assert.match((await response.json()).error.message, /strict/);
    assert.equal(h.calls.length, 0);
  }
});

test('invalid strict option types fail for native and translated OpenAI and Anthropic requests', async () => {
  for (const strict of ['true', 'false', 1, null]) for (const provider of ['openai', 'anthropic']) for (const client of ['openai', 'anthropic']) {
    const h = await harness(provider, () => { throw new Error('No network work allowed'); });
    const response = await h.call(client === 'openai' ? '/v1/chat/completions' : '/v1/messages', client === 'openai' ? openAIInput(strict) : anthropicInput(strict));
    assert.equal(response.status, 400, await response.clone().text());
    assert.equal(h.calls.length, 0);
  }
});

test('Anthropic context-window truncation is length or MAX_TOKENS for JSON and streaming clients', async () => {
  for (const stream of [false, true]) for (const client of ['openai', 'gemini']) {
    const h = await harness('anthropic', () => stream ? anthropicStream('model_context_window_exceeded') : Response.json(anthropicResponse('model_context_window_exceeded')));
    const response = await h.call(client === 'openai' ? '/v1/chat/completions' : '/v1beta/models/alias:' + (stream ? 'streamGenerateContent?alt=sse' : 'generateContent'), client === 'openai' ? { model: 'alias', messages: [{ role: 'user', content: 'hello' }], stream } : geminiInput());
    assert.equal(response.status, 200);
    const wire = await response.text();
    assert.match(wire, /partial answer/);
    assert.match(wire, client === 'openai' ? /"finish_reason":"length"/ : /"finishReason":"MAX_TOKENS"/);
    assert.equal(h.calls.length, 1);
  }
});

test('unsupported Anthropic terminal reasons become errors without retry or a successful stop', async () => {
  for (const reason of ['pause_turn', 'future_terminal']) for (const stream of [false, true]) {
    const h = await harness('anthropic', () => stream ? anthropicStream(reason) : Response.json(anthropicResponse(reason)));
    const response = await h.call('/v1/chat/completions', { model: 'alias', messages: [{ role: 'user', content: 'hello' }], stream });
    assert.equal(response.status, stream ? 200 : 502);
    const wire = await response.text();
    assert.match(wire, /error/);
    assert.doesNotMatch(wire, /"finish_reason":"stop"/);
    if (stream) assert.ok(events(wire).some(value => value.error));
    assert.equal(h.calls.length, 1);
  }
});

test('unrepresentable sampling and output constraints reject Anthropic and Antigravity before work', async () => {
  for (const provider of ['anthropic', 'antigravity']) {
    for (const config of [{ seed: 1 }, { presence_penalty: 0.5 }, { frequency_penalty: 0 }, { logprobs: true }, { top_logprobs: 2 }, { reasoning_effort: 'low' }]) {
      const h = await harness(provider, () => { throw new Error('No network work allowed'); });
      const response = await h.call('/v1/chat/completions', { model: 'alias', messages: [{ role: 'user', content: 'hello' }], ...config });
      assert.equal(response.status, 400, await response.clone().text());
      assert.equal(h.calls.length, 0);
    }
    for (const config of [{ seed: 1 }, { presence_penalty: 0.5 }, { frequency_penalty: 0 }]) {
      const h = await harness(provider, () => { throw new Error('No network work allowed'); });
      const response = await h.call('/v1beta/models/alias:generateContent', geminiInput(config));
      assert.equal(response.status, 400, await response.clone().text());
      assert.equal(h.calls.length, 0);
    }
  }
});

test('Anthropic provider-defined tools cannot masquerade as functions in another provider, even with a schema', async () => {
  for (const provider of ['openai', 'cloudflare', 'gemini', 'antigravity']) for (const stream of [false, true]) {
    for (const input_schema of [undefined, { type: 'object', properties: { query: { type: 'string' } } }]) for (const type of ['web_search_20250305', 'computer_20250124', 'future_provider_tool']) {
      const h = await harness(provider, () => { throw new Error('No OAuth or generation allowed'); }, provider === 'antigravity' ? { apiToken: '', refreshToken: 'fixture-refresh' } : {});
      const response = await h.call('/v1/messages', { ...anthropicInput(false), stream, tools: [{ type, name: 'web_search', max_uses: 1, allowed_domains: ['example.invalid'], ...(input_schema ? { input_schema } : {}) }] });
      assert.equal(response.status, 400, await response.clone().text());
      assert.match((await response.json()).error.message, /custom|provider-defined/);
      assert.equal(h.calls.length, 0);
    }
  }
});

test('actual Anthropic custom tool definitions still translate for every supported provider', async () => {
  for (const provider of ['openai', 'cloudflare', 'gemini', 'antigravity']) for (const type of [undefined, null, 'custom']) {
    const completion = { candidates: [{ content: { parts: [{ text: 'answer' }] }, finishReason: 'STOP' }] };
    const h = await harness(provider, () => provider === 'antigravity' ? Response.json({ response: completion }) : provider === 'gemini' ? Response.json(completion) : textResponse());
    const response = await h.call('/v1/messages', { ...anthropicInput(false), tools: [{ ...(type !== undefined ? { type } : {}), name: 'record', input_schema: { type: 'object', properties: { value: { type: 'number' } } } }] });
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal(h.calls.length, 1);
    const sent = h.calls[0].body;
    assert.equal(provider === 'antigravity' ? sent.request.tools[0].functionDeclarations[0].name : provider === 'gemini' ? sent.tools[0].functionDeclarations[0].name : sent.tools[0].function.name, 'record');
  }
});

test('native Anthropic preserves builtin tool settings, server tool results and citations for JSON and SSE', async () => {
  const tool = { type: 'web_search_20250305', name: 'web_search', max_uses: 1, allowed_domains: ['example.invalid'], user_location: { type: 'approximate', country: 'US' } };
  const content = [
    { type: 'server_tool_use', id: 'srvtoolu_fixture', name: 'web_search', input: { query: 'fixture query' } },
    { type: 'web_search_tool_result', tool_use_id: 'srvtoolu_fixture', content: [{ type: 'web_search_result', title: 'Fixture', url: 'https://example.invalid/result', encrypted_content: 'opaque-result' }] },
    { type: 'text', text: 'Found answer', citations: [{ type: 'web_search_result_location', cited_text: 'Found answer', encrypted_index: 'opaque-index', title: 'Fixture', url: 'https://example.invalid/result' }] },
  ];
  for (const stream of [false, true]) {
    const fixture = { ...anthropicResponse(), content };
    const streamEvents = [
      { type: 'message_start', message: { ...anthropicResponse(null), content: [] } },
      { type: 'content_block_start', index: 0, content_block: { ...content[0], input: {} } },
      { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(content[0].input) } },
      { type: 'content_block_stop', index: 0 },
      { type: 'content_block_start', index: 1, content_block: content[1] },
      { type: 'content_block_stop', index: 1 },
      { type: 'content_block_start', index: 2, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 2, delta: { type: 'text_delta', text: content[2].text } },
      { type: 'content_block_delta', index: 2, delta: { type: 'citations_delta', citation: content[2].citations[0] } },
      { type: 'content_block_stop', index: 2 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1, server_tool_use: { web_search_requests: 1 } } },
      { type: 'message_stop' },
    ];
    const h = await harness('anthropic', () => stream ? new Response(streamEvents.map(frame).join(''), { headers: { 'content-type': 'text/event-stream' } }) : Response.json(fixture));
    const response = await h.call('/v1/messages', { ...anthropicInput(false), stream, tools: [tool] });
    assert.equal(response.status, 200, await response.clone().text());
    assert.deepEqual(h.calls[0].body.tools, [tool]);
    if (stream) assert.deepEqual(events(await response.text()), streamEvents);
    else assert.deepEqual((await response.json()).content, content);
    assert.equal(h.calls.length, 1);
  }
});

test('Gemini cache, continuation, logging and unknown top-level constraints cannot disappear across protocols', async () => {
  const extras = [
    { cachedContent: 'cachedContents/fixture' }, { cached_content: 'cachedContents/fixture' },
    { continuationToken: 'fixture-token' }, { continuation_token: 'fixture-token' },
    { store: false }, { serviceTier: 'PRIORITY' }, { service_tier: 'PRIORITY' },
    { labels: { safety_identifier: 'fixture' } }, { futureContextConstraint: { enabled: true } },
  ];
  for (const provider of ['openai', 'anthropic', 'cloudflare', 'antigravity']) for (const client of ['openai', 'gemini']) for (const extra of extras) {
    const h = await harness(provider, () => { throw new Error('No OAuth or generation allowed'); }, provider === 'antigravity' ? { apiToken: '', refreshToken: 'fixture-refresh' } : {});
    const response = await h.call(client === 'openai' ? '/v1/chat/completions' : '/v1beta/models/alias:generateContent', client === 'openai' ? { model: 'alias', messages: [{ role: 'user', content: 'hello' }], gemini_extra: extra } : { ...geminiInput(), ...extra });
    assert.equal(response.status, 400, await response.clone().text());
    assert.equal(h.calls.length, 0);
  }
  const nativeExtra = { cached_content: 'cachedContents/fixture', continuation_token: 'fixture-token', service_tier: 'PRIORITY', store: false, labels: { safety_identifier: 'fixture' }, futureContextConstraint: { enabled: true } };
  const h = await harness('gemini', () => Response.json({ candidates: [{ content: { parts: [{ text: 'answer' }] }, finishReason: 'STOP' }] }));
  const response = await h.call('/v1beta/models/alias:generateContent', { ...geminiInput(), ...nativeExtra });
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].body.cachedContent, nativeExtra.cached_content);
  assert.equal(h.calls[0].body.continuationToken, nativeExtra.continuation_token);
  assert.equal(h.calls[0].body.serviceTier, nativeExtra.service_tier);
  assert.equal(h.calls[0].body.store, false);
  assert.deepEqual(h.calls[0].body.labels, nativeExtra.labels);
  assert.deepEqual(h.calls[0].body.futureContextConstraint, nativeExtra.futureContextConstraint);
  for (const alias of ['cached_content', 'continuation_token', 'service_tier']) assert.equal(h.calls[0].body[alias], undefined);
});

test('Gemini cache aliases cannot conflict even on a native Gemini route', async () => {
  for (const provider of ['gemini', 'openai']) {
    const h = await harness(provider, () => { throw new Error('No network work allowed'); });
    const response = await h.call('/v1beta/models/alias:generateContent', { ...geminiInput(), cachedContent: 'cachedContents/a', cached_content: 'cachedContents/b' });
    assert.equal(response.status, 400, await response.clone().text());
    assert.equal(h.calls.length, 0);
  }
});
