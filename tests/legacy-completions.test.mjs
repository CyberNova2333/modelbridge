import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../_worker.js', import.meta.url), 'utf8');
const { readRequestJson, requestJsonErrorResponse } = await import('data:text/javascript;base64,' + Buffer.from(
  source + '\nexport { readRequestJson, requestJsonErrorResponse };',
).toString('base64'));
const helperStart = source.indexOf('function toLegacyCompletion(');
const helperEnd = source.indexOf('// 透传 CF /ai/v1/chat/completions', helperStart);
assert(helperStart > 0 && helperEnd > helperStart);
const { toLegacyCompletion, legacyCompletionStream } = new Function(
  source.slice(source.indexOf('function openAIStreamCompletion('), source.indexOf('function validatedNativeAnthropicStream(')) +
  source.slice(helperStart, helperEnd) + '\nreturn { toLegacyCompletion, legacyCompletionStream };',
)();
const handlerStart = source.indexOf('async function handleCompletions(');
const handlerEnd = source.indexOf('function convertAnthropicToOpenAI(', handlerStart);
const handlerFactory = new Function(
  'resolveModelName', 'callOpenAICompatibleAPI', 'passthroughStream', 'toLegacyCompletion', 'legacyCompletionStream',
  'readRequestJson', 'requestJsonErrorResponse',
  source.slice(handlerStart, handlerEnd) + '\nreturn handleCompletions;',
);
function harness(upstream, resolveModel = async model => '@cf/' + model) {
  const calls = [];
  const handle = handlerFactory(resolveModel, async payload => {
    calls.push(payload);
    return upstream;
  }, () => { throw new Error('Chat stream transformer used for a legacy request'); }, toLegacyCompletion, legacyCompletionStream, readRequestJson, requestJsonErrorResponse);
  return { calls, handle: (body, path = '/v1/completions') => handle(new Request('https://test.invalid' + path, {
    method: 'POST', body: JSON.stringify(body),
  }), {}, path) };
}
const choice = (index, content, finish_reason = null) => ({ index, message: { role: 'assistant', content }, finish_reason });

test('legacy response uses text_completion and text while retaining metadata and all choices', async () => {
  const upstream = {
    id: 'chatcmpl-test', created: 42, model: '@cf/test', object: 'chat.completion',
    usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
    choices: [choice(0, 'hello', 'stop'), choice(1, 'world', 'length')],
  };
  const { calls, handle } = harness({ success: true, data: upstream });
  const response = await handle({ model: 'test', prompt: 'hello', n: 2, logprobs: 2 });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.object, 'text_completion');
  assert.equal(result.id, 'chatcmpl-test');
  assert.equal(result.created, 42);
  assert.equal(result.model, 'test');
  assert.deepEqual(result.usage, upstream.usage);
  assert.deepEqual(result.choices, [
    { index: 0, text: 'hello', logprobs: null, finish_reason: 'stop' },
    { index: 1, text: 'world', logprobs: null, finish_reason: 'length' },
  ]);
  assert.deepEqual(calls[0].messages, [{ role: 'user', content: 'hello' }]);
  assert.equal(calls[0].logprobs, true);
  assert.equal(calls[0].top_logprobs, 2);
});

test('legacy logprobs use token arrays and per-choice offsets across chunks', () => {
  const offsets = new Map();
  const chunk = text => ({ choices: [{ index: 0, delta: { content: text }, logprobs: { content: [
    { token: text, logprob: -0.2, top_logprobs: [{ token: text, logprob: -0.2 }] },
  ] } }] });
  const first = toLegacyCompletion(chunk('Hello'), 'test', true, offsets);
  const second = toLegacyCompletion(chunk('!'), 'test', true, offsets);
  assert.deepEqual(first.choices[0].logprobs, {
    tokens: ['Hello'], token_logprobs: [-0.2], top_logprobs: [{ Hello: -0.2 }], text_offset: [0],
  });
  assert.deepEqual(second.choices[0].logprobs.text_offset, [5]);
});

test('legacy SSE handles split UTF-8, CRLF, metadata, usage and a single DONE event', async () => {
  const encoder = new TextEncoder();
  const input = [
    ': keepalive\r\n\r\n',
    'data: ' + JSON.stringify({ id: 'c', created: 3, object: 'chat.completion.chunk', model: '@cf/test', choices: [{ index: 0, delta: { content: '你好' }, finish_reason: null }] }) + '\r\n\r\n',
    'data: ' + JSON.stringify({ id: 'c', created: 3, object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }) + '\n\n',
    'data: ' + JSON.stringify({ id: 'c', created: 3, choices: [], usage: { total_tokens: 8 } }) + '\n\n',
    'data: [DONE]\n\n',
  ].join('');
  const bytes = encoder.encode(input);
  let cursor = 0;
  const upstream = new ReadableStream({
    pull(controller) {
      if (cursor === bytes.length) return controller.close();
      controller.enqueue(bytes.slice(cursor, cursor + 3));
      cursor = Math.min(cursor + 3, bytes.length);
    },
  });
  const { handle, calls } = harness({ success: true, stream: upstream });
  const response = await handle({ model: 'test', prompt: 'hello', stream: true, stream_options: { include_usage: true } });
  assert.deepEqual(calls[0].stream_options, { include_usage: true });
  assert.equal(response.headers.get('content-type'), 'text/event-stream');
  const output = await response.text();
  assert(output.startsWith(': keepalive\n\n'));
  assert.equal(output.match(/data: \[DONE\]/g).length, 1);
  const chunks = output.split('\n').filter(line => line.startsWith('data: {')).map(line => JSON.parse(line.slice(6)));
  assert(chunks.every(chunk => chunk.object === 'text_completion' && chunk.model === 'test'));
  assert.deepEqual(chunks[0].choices[0], { index: 0, text: '你好', logprobs: null, finish_reason: null });
  assert.equal(chunks[1].choices[0].finish_reason, 'stop');
  assert.deepEqual(chunks[2].usage, { total_tokens: 8 });
});

test('legacy SSE flushes a final frame without a delimiter and propagates cancellation', async () => {
  const upstream = new Response('data: ' + JSON.stringify({ choices: [{ index: 0, delta: { content: 'last' }, finish_reason: 'stop' }] })).body;
  const output = await new Response(legacyCompletionStream(upstream, 'test')).text();
  assert.match(output, /"text":"last"/);
  assert(output.endsWith('data: [DONE]\n\n'));
  let cancelled;
  const reader = legacyCompletionStream(new ReadableStream({ cancel(reason) { cancelled = reason; } }), 'test').getReader();
  await reader.cancel('client disconnected');
  assert.equal(cancelled, 'client disconnected');
});

test('invalid bodies fail with 400 before calling upstream; empty legacy prompt is valid', async () => {
  const { handle, calls } = harness({ success: true, data: { choices: [] } });
  for (const body of [null, [], { prompt: 'hello' }, { model: 1, prompt: 'hello' }, { model: 'test', prompt: null }]) {
    assert.equal((await handle(body)).status, 400);
  }
  assert.equal((await handle({ model: 'test', messages: {} }, '/v1/chat/completions')).status, 400);
  assert.equal(calls.length, 0);
  assert.equal((await handle({ model: 'test', prompt: '' })).status, 200);
  assert.equal(calls.length, 1);
});

test('deleted or unknown model aliases are rejected before upstream access', async () => {
  const { handle, calls } = harness({ success: true, data: {} }, async () => null);
  const response = await handle({ model: 'deleted', prompt: 'hello' });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, 'model_not_found');
  assert.equal(calls.length, 0);
});
