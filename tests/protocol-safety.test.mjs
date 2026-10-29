import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../_worker.js', import.meta.url), 'utf8');
const names = ['convertAnthropicToOpenAI', 'convertOpenAIToAnthropic', 'openAIToAnthropicUpstreamRequest',
  'anthropicToOpenAIUpstreamResponse', 'anthropicToOpenAIUpstreamStream', 'anthropicStreamTransform',
  'passthroughStream', 'legacyCompletionStream', 'validatedNativeAnthropicStream', 'geminiToOpenAIStream',
  'openAIToGeminiStream', 'geminiToOpenAIRequest', 'openAIToGeminiRequest', 'geminiToOpenAIResponse',
  'openAIToGeminiResponse', 'buildAntigravityCloudCodeRequest', 'antigravityToAnthropicStream',
  'antigravityToOpenAIStream', 'parseThinkingSSEResponse'];
const api = await import('data:text/javascript;base64,' + Buffer.from(
  'const network={run:null};const fetch=(...args)=>network.run(...args);\n' + source +
  '\nexport function mockFetch(fn){network.run=fn;}\nexport {' + names.join(',') + '};'
).toString('base64'));
const accounts = ['openai', 'gemini', 'anthropic'].map(provider => ({ id: provider, provider, status: 'active',
  apiToken: 'synthetic-' + provider, baseUrl: 'https://' + provider + '.invalid/v1', models: [] }));
const config = { accounts, apiKeys: [{ key: 'synthetic-client' }], customModelMap: {} };
const env = { ADMIN_PASSWORD: 'synthetic-admin', KV: {}, CONFIG_STORE: { idFromName: x => x,
  get: () => ({ fetch: async () => Response.json(config) }) } };
const request = (path, body) => api.default.fetch(new Request('https://gateway.invalid' + path, {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': 'synthetic-client' }, body: JSON.stringify(body)
}), env, {});
const base = { model: 'openai:mock', max_tokens: 32, messages: [{ role: 'user', content: 'hello' }],
  tools: [{ name: 'lookup', input_schema: { type: 'object', properties: { path: { type: 'string' } } } }] };
const frame = data => 'data: ' + (typeof data === 'string' ? data : JSON.stringify(data)) + '\n\n';
const body = chunks => new Response(chunks.map(frame).join('')).body;
const sse = chunks => new Response(body(chunks), { headers: { 'content-type': 'text/event-stream' } });
const choice = (delta, finish_reason = null, index = 0) => ({ choices: [{ index, delta, finish_reason }] });
const decode = text => text.split('\n').filter(x => x.startsWith('data: ') && x !== 'data: [DONE]').map(x => JSON.parse(x.slice(6)));
const text = stream => new Response(stream).text();
const google = (parts, finishReason) => ({ candidates: [{ content: { role: 'model', parts }, ...(finishReason ? { finishReason } : {}) }] });

test('Anthropic tool prohibition and parallel restriction reach the actual OpenAI upstream', async () => {
  for (const [tool_choice, expected] of [[{ type: 'none' }, 'none'], [{ type: 'auto', disable_parallel_tool_use: true }, 'auto']]) {
    let wire;
    api.mockFetch(async (_url, init) => { wire = JSON.parse(init.body); return Response.json({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] }); });
    const response = await request('/v1/messages', { ...base, tool_choice });
    assert.equal(response.status, 200);
    assert.equal(wire.tool_choice, expected);
    if (tool_choice.disable_parallel_tool_use) assert.equal(wire.parallel_tool_calls, false);
  }
  assert.throws(() => api.openAIToGeminiRequest(api.convertAnthropicToOpenAI({ ...base,
    tool_choice: { type: 'auto', disable_parallel_tool_use: true } })), /parallel-call restriction/);
});

test('malformed tool JSON is a 502 response, never an executable empty input', async () => {
  for (const argumentsValue of ['{"path":', 'null', '[]', 'false']) {
    api.mockFetch(async () => Response.json({ choices: [{ message: { content: null,
      tool_calls: [{ id: 'call', function: { name: 'lookup', arguments: argumentsValue } }] }, finish_reason: 'tool_calls' }] }));
    const response = await request('/v1/messages', base);
    assert.equal(response.status, 502);
    assert.equal((await response.json()).type, 'error');
  }
});

test('invalid complete streamed tool JSON emits an error without a successful message stop', async () => {
  const output = decode(await text(api.anthropicStreamTransform(body([
    choice({ tool_calls: [{ index: 0, id: 'call', function: { name: 'lookup', arguments: '{"path":' } }] }),
    choice({}, 'tool_calls'), '[DONE]'
  ]), 'm')));
  assert.equal(output.at(-1).type, 'error');
  assert.equal(output.some(event => event.type === 'message_stop'), false);
});

test('Gemini errors never flush buffered calls or fabricate a STOP, for SSE and JSON streaming', async () => {
  for (const useSSE of [true, false]) {
    let cancelled = false;
    const chunks = [choice({ tool_calls: [{ index: 0, id: 'call', function: { name: 'lookup', arguments: '{"path":"x"}' } }] }),
      { error: { message: 'upstream failed' } }, choice({}, 'tool_calls'), '[DONE]'];
    let cursor = 0;
    const upstream = new ReadableStream({ pull(c) { c.enqueue(new TextEncoder().encode(frame(chunks[cursor++]))); }, cancel() { cancelled = true; } });
    const result = await text(api.openAIToGeminiStream(upstream, 'm', { sse: useSSE }));
    const events = useSSE ? decode(result) : JSON.parse(result);
    assert.equal(events.length, 1); assert.ok(events[0].error);
    assert.doesNotMatch(result, /functionCall|finishReason|\[DONE\]/);
    assert.equal(cancelled, true);
  }
});

for (const name of ['passthroughStream', 'legacyCompletionStream', 'openAIToGeminiStream']) {
  test(name + ' rejects unfinished EOF and unfinished DONE including one unfinished candidate', async () => {
    for (const chunks of [[choice({ content: 'partial' })], [choice({ content: 'partial' }), '[DONE]'],
      [choice({ content: 'first' }, 'stop', 0), choice({ content: 'unfinished' }, null, 1), '[DONE]'], []]) {
      const output = await text(api[name](body(chunks), 'm'));
      assert.ok(decode(output).at(-1)?.error, 'failure must be serialized on the wire');
      assert.doesNotMatch(output, /\[DONE\]/);
    }
    const success = await text(api[name](body([choice({ content: 'complete' }, 'stop'), { choices: [], usage: { total_tokens: 4 } }]), 'm'));
    assert.match(success, /complete/); assert.match(success, /4/);
  });
}

test('Anthropic converted and native streams reject premature EOF without message_stop', async () => {
  for (const stream of [api.anthropicStreamTransform(body([choice({ content: 'partial' })]), 'm'),
    api.validatedNativeAnthropicStream(body([{ type: 'message_start', message: { id: 'partial', type: 'message', role: 'assistant', model: 'm', content: [], usage: { input_tokens: 1, output_tokens: 0 } } }, { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'partial' } }]))]) {
    const output = await text(stream);
    assert.match(output, /partial/);
    assert.match(output, /"type":"error"/); assert.doesNotMatch(output, /message_stop|"stop_reason":"end_turn"/);
  }
  const complete = await text(api.validatedNativeAnthropicStream(body([{ type: 'message_stop' }])));
  assert.match(complete, /message_stop/);
});

test('Gemini and Antigravity EOF require a real finish reason', async () => {
  const partial = google([{ text: 'partial' }]);
  const geminiFailure = await text(api.geminiToOpenAIStream(body([partial]), 'm'));
  assert.ok(decode(geminiFailure).at(-1)?.error);
  assert.doesNotMatch(geminiFailure, /\[DONE\]/);
  await assert.rejects(api.parseThinkingSSEResponse(sse([{ response: partial }])), /finish reason/);
  for (const name of ['antigravityToAnthropicStream', 'antigravityToOpenAIStream']) {
    const output = await text(api[name](body([{ response: partial }]), 'm'));
    assert.match(output, /"error"/); assert.doesNotMatch(output, /message_stop|\[DONE\]|"finish_reason":"stop"/);
  }
});

test('Gemini signatures survive actual Anthropic JSON round trips including parallel calls and signed thoughts', async () => {
  const parts = [{ text: 'reason', thought: true, thoughtSignature: 'thought-signature' },
    { functionCall: { id: 'a', name: 'lookup', args: { path: 'a' } }, thoughtSignature: 'first-call-signature' },
    { functionCall: { id: 'b', name: 'lookup', args: { path: 'b' } } }];
  const sent = [];
  api.mockFetch(async (_url, init) => { sent.push(JSON.parse(init.body)); return Response.json(google(parts, 'STOP')); });
  const first = await (await request('/v1/messages', { ...base, model: 'gemini:mock' })).json();
  assert.equal(first.content[0].signature, 'thought-signature');
  assert.equal(first.content[1].thoughtSignature, 'first-call-signature');
  assert.equal(first.content[2].thoughtSignature, undefined);
  const second = await request('/v1/messages', { ...base, model: 'gemini:mock', messages: [...base.messages,
    { role: 'assistant', content: first.content }, { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'a', content: 'done' }, { type: 'tool_result', tool_use_id: 'b', content: 'done' }] }] });
  assert.equal(second.status, 200);
  assert.deepEqual(sent[1].contents.find(c => c.role === 'model').parts, parts);
});

test('Gemini streamed thought signatures stay attached to their complete Anthropic thinking block', async () => {
  const native = [google([{ text: 'first ', thought: true }]), google([{ text: 'second', thought: true, thoughtSignature: 'thinking-sig' }]),
    google([{ functionCall: { id: 'a', name: 'lookup', args: {} }, thoughtSignature: 'call-sig' }, { functionCall: { id: 'b', name: 'lookup', args: {} } }], 'STOP')];
  const events = decode(await text(api.anthropicStreamTransform(api.geminiToOpenAIStream(body(native), 'm'), 'm')));
  const starts = events.filter(e => e.type === 'content_block_start');
  assert.deepEqual(starts.map(e => e.content_block.type), ['thinking', 'tool_use', 'tool_use']);
  const thinkingIndex = starts[0].index;
  assert.equal(events.filter(e => e.index === thinkingIndex && e.delta?.thinking).map(e => e.delta.thinking).join(''), 'first second');
  assert.equal(events.find(e => e.delta?.signature).index, thinkingIndex);
  assert.equal(events.find(e => e.delta?.signature).delta.signature, 'thinking-sig');
  assert.equal(starts[1].content_block.thoughtSignature, 'call-sig');
  assert.equal(starts[2].content_block.thoughtSignature, undefined);
  assert.equal(events.at(-1).type, 'message_stop');
});

test('Anthropic signed thinking survives Gemini JSON and SSE replay to Anthropic', async () => {
  const content = [{ type: 'thinking', thinking: 'reason', signature: 'native-signature' }, { type: 'text', text: 'answer' }];
  const gemini = api.openAIToGeminiResponse(api.anthropicToOpenAIUpstreamResponse({ content, stop_reason: 'end_turn' }, 'm'), 'm');
  const replay = api.openAIToAnthropicUpstreamRequest(api.geminiToOpenAIRequest({ contents: [gemini.candidates[0].content] }, 'm'));
  assert.deepEqual(replay.messages[0].content, content);
  const events = [{ type: 'message_start', message: {} }, { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'reason' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'native-signature' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' } }, { type: 'message_stop' }];
  const chunks = decode(await text(api.openAIToGeminiStream(api.anthropicToOpenAIUpstreamStream(body(events), 'm'), 'm')));
  const parts = chunks.flatMap(chunk => chunk.candidates?.[0]?.content?.parts || []);
  const streamedReplay = api.openAIToAnthropicUpstreamRequest(api.geminiToOpenAIRequest({ contents: [{ role: 'model', parts }] }, 'm'));
  assert.deepEqual(streamedReplay.messages[0].content, [content[0]]);
});

test('Antigravity accepts first-only parallel signatures and sends exactly the caller system', async () => {
  const toolBlocks = [{ type: 'tool_use', id: 'a', name: 'lookup', input: {}, thoughtSignature: 'first-only' },
    { type: 'tool_use', id: 'b', name: 'lookup', input: {} }];
  for (const model of ['antigravity:gemini-3-flash', 'antigravity:claude-sonnet-4-5-thinking']) {
    const sourceRequest = { ...base, model, system: [{ type: 'text', text: 'Only translate. Never act as an agent.' }],
      messages: [...base.messages, { role: 'assistant', content: toolBlocks }] };
    const { payload } = await api.buildAntigravityCloudCodeRequest(sourceRequest, 'test-project');
    assert.deepEqual(payload.request.systemInstruction.parts, [{ text: sourceRequest.system[0].text }]);
    if (model.includes('gemini')) {
      assert.equal(payload.request.contents[1].parts[0].thoughtSignature, 'first-only');
      assert.equal(payload.request.contents[1].parts[1].thoughtSignature, undefined);
    }
  }
  const absent = await api.buildAntigravityCloudCodeRequest({ ...base, model: 'gemini-2.5-flash' }, 'test-project');
  assert.equal(absent.payload.request.systemInstruction, undefined);
});

test('protocol conversion never inserts an invented user turn before assistant history', () => {
  const converted = api.convertAnthropicToOpenAI({ ...base, system: 'Only translate.', messages: [{ role: 'assistant', content: 'Original history' }] });
  assert.deepEqual(converted.messages, [{ role: 'system', content: 'Only translate.' }, { role: 'assistant', content: 'Original history' }]);
});

test('Antigravity streamed malformed tool input remains an error in both protocols', async () => {
  for (const name of ['antigravityToAnthropicStream', 'antigravityToOpenAIStream']) {
    const output = await text(api[name](body([google([{ functionCall: { id: 'a', name: 'lookup', args: '{"path":' } }], 'STOP')]), 'm'));
    assert.match(output, /"error"/); assert.doesNotMatch(output, /tool_use|tool_calls|functionCall|message_stop|\[DONE\]/);
  }
});

test('failures after a delivered partial chunk produce protocol error bytes before ordinary HTTP EOF', async () => {
  const cases = [
    ['passthroughStream', true], ['legacyCompletionStream', true],
    ['openAIToGeminiStream', true], ['openAIToGeminiStream', false], ['geminiToOpenAIStream', true],
    ['anthropicToOpenAIUpstreamStream', true]
  ];
  for (const [name, useSSE] of cases) for (const failure of ['eof', 'transport']) {
    let upstreamController, cancelled = false;
    const upstream = new ReadableStream({ start(c) { upstreamController = c; }, cancel() { cancelled = true; } });
    const reader = api[name](upstream, 'm', { sse: useSSE }).getReader();
    const partial = name === 'geminiToOpenAIStream' ? google([{ text: 'partial' }])
      : name === 'anthropicToOpenAIUpstreamStream' ? { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'partial' } }
      : choice({ content: 'partial' });
    const prefix = name === 'anthropicToOpenAIUpstreamStream' ? frame({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }) : '';
    upstreamController.enqueue(new TextEncoder().encode(prefix + frame(partial)));
    const first = await reader.read();
    assert.equal(first.done, false); assert.match(new TextDecoder().decode(first.value), /partial/);
    if (failure === 'eof') upstreamController.close();
    else upstreamController.error(new Error('synthetic private transport detail'));
    const second = await reader.read();
    assert.equal(second.done, false, name + ' must send an error before closing');
    const wire = new TextDecoder().decode(first.value) + new TextDecoder().decode(second.value);
    const result = useSSE ? decode(wire) : JSON.parse(wire);
    assert.ok(result.at(-1)?.error, name + ' must serialize its failure');
    assert.doesNotMatch(wire, /finishReason|\[DONE\]|synthetic private transport detail/);
    assert.equal((await reader.read()).done, true);
  }
});
