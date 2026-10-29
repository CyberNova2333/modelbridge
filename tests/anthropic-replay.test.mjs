import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../_worker.js', import.meta.url), 'utf8');
let serial = 0;
const frame = data => 'event: ' + data.type + '\ndata: ' + JSON.stringify(data) + '\n\n';
const stop = index => ({ type: 'content_block_stop', index });
const delta = (index, type, value) => ({ type: 'content_block_delta', index, delta: { type, ...value } });
const start = (index, content_block) => ({ type: 'content_block_start', index, content_block });
const events = [
  { type: 'message_start', message: { id: 'msg-replay', usage: { input_tokens: 1 } } },
  start(0, { type: 'thinking', thinking: 'Initial ' }),
  delta(0, 'thinking_delta', { thinking: 'reason ' }), delta(0, 'thinking_delta', { thinking: '完整' }),
  delta(0, 'signature_delta', { signature: 'signature-' }), delta(0, 'signature_delta', { signature: 'complete' }), stop(0),
  start(1, { type: 'text', text: 'Before ' }), delta(1, 'text_delta', { text: 'tools.' }), stop(1),
  start(2, { type: 'tool_use', id: 'a', name: 'lookup', input: {}, thoughtSignature: 'tool-a-signature' }),
  start(3, { type: 'tool_use', id: 'b', name: 'lookup', input: {} }),
  delta(3, 'input_json_delta', { partial_json: '{"path":' }), delta(2, 'input_json_delta', { partial_json: '{"path":' }),
  delta(3, 'input_json_delta', { partial_json: '"second"}' }), stop(3),
  delta(2, 'input_json_delta', { partial_json: '"first"}' }), stop(2),
  start(4, { type: 'text', text: 'After tools.' }), stop(4),
  { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 5 } }, { type: 'message_stop' },
];
const initial = [{ role: 'user', content: 'Look up two paths.' }];
const expectedParts = [
  { text: 'Initial reason 完整', thought: true, thoughtSignature: 'signature-complete' },
  { text: 'Before ' }, { text: 'tools.' },
  { functionCall: { id: 'a', name: 'lookup', args: { path: 'first' } }, thoughtSignature: 'tool-a-signature' },
  { functionCall: { id: 'b', name: 'lookup', args: { path: 'second' } } }, { text: 'After tools.' },
];

async function harness() {
  const name = '__anthropicReplay' + serial++;
  const state = { network: null, calls: [] }; globalThis[name] = state;
  const api = await import('data:text/javascript;base64,' + Buffer.from(`const state=globalThis.${name};const fetch=async(...args)=>{state.calls.push(JSON.parse(args[1].body));return state.network(...args);};\n` + source).toString('base64'));
  const config = { accounts: ['anthropic', 'gemini'].map(provider => ({ id: provider, provider, apiToken: 'synthetic-upstream', status: 'active', models: [] })), apiKeys: [{ key: 'synthetic-client' }], customModelMap: {} };
  const env = { ADMIN_PASSWORD: 'synthetic-admin', KV: {}, CONFIG_STORE: { idFromName: x => x, get: () => ({ fetch: async () => Response.json(config) }) } };
  const request = (body, path = '/v1/chat/completions') => api.default.fetch(new Request('https://gateway.invalid' + path, { method: 'POST', headers: { authorization: 'Bearer synthetic-client', 'content-type': 'application/json' }, body: JSON.stringify(body) }), env, {});
  return { state, request, close: () => delete globalThis[name] };
}
function aggregate(wire) {
  const chunks = wire.split('\n').filter(line => line.startsWith('data: ') && line !== 'data: [DONE]').map(line => JSON.parse(line.slice(6)));
  assert.ok(chunks.every(chunk => !chunk.error), wire);
  const message = { role: 'assistant', content: '', reasoning_content: '', tool_calls: [], gemini_parts: [] };
  for (const chunk of chunks) for (const { delta } of chunk.choices || []) {
    message.content += delta.content || ''; message.reasoning_content += delta.reasoning_content || '';
    message.gemini_parts.push(...delta.gemini_parts || []);
    for (const tool of delta.tool_calls || []) {
      const saved = message.tool_calls[tool.index] ||= { id: tool.id, type: 'function', function: { name: tool.function.name, arguments: '' } };
      saved.function.arguments += tool.function.arguments || '';
      if (tool.gemini_thought_signature) saved.gemini_thought_signature = tool.gemini_thought_signature;
    }
  }
  return message;
}
const streaming = () => new Response(events.map(frame).join(''), { headers: { 'content-type': 'text/event-stream' } });
const completed = provider => provider === 'gemini' ? Response.json({ candidates: [{ content: { role: 'model', parts: [{ text: 'OK' }] }, finishReason: 'STOP' }] })
  : Response.json({ type: 'message', role: 'assistant', content: [{ type: 'text', text: 'OK' }], stop_reason: 'end_turn' });

test('Anthropic streamed thinking signatures, text and parallel tools replay intact to Anthropic and Gemini', async () => {
  const h = await harness();
  try {
    h.state.network = streaming;
    const response = await h.request({ model: 'anthropic:fixture', messages: initial, stream: true });
    assert.equal(response.status, 200);
    const message = aggregate(await response.text());
    assert.deepEqual(message.gemini_parts, expectedParts);
    assert.equal(message.content, 'Before tools.After tools.'); assert.equal(message.reasoning_content, 'Initial reason 完整');
    assert.deepEqual(message.tool_calls.map(call => [call.id, JSON.parse(call.function.arguments)]), [['a', { path: 'first' }], ['b', { path: 'second' }]]);
    for (const provider of ['anthropic', 'gemini']) {
      h.state.network = () => completed(provider);
      const replay = await h.request({ model: provider + ':fixture', messages: [...initial, message,
        { role: 'tool', tool_call_id: 'a', content: 'first result' }, { role: 'tool', tool_call_id: 'b', content: 'second result' }] });
      assert.equal(replay.status, 200, await replay.text());
      const sent = h.state.calls.at(-1);
      if (provider === 'gemini') assert.deepEqual(sent.contents.find(item => item.role === 'model').parts, expectedParts);
      else {
        const blocks = sent.messages.find(item => item.role === 'assistant').content;
        assert.deepEqual(blocks, [
          { type: 'thinking', thinking: 'Initial reason 完整', signature: 'signature-complete' },
          { type: 'text', text: 'Before ' }, { type: 'text', text: 'tools.' },
          { type: 'tool_use', id: 'a', name: 'lookup', input: { path: 'first' }, thoughtSignature: 'tool-a-signature' },
          { type: 'tool_use', id: 'b', name: 'lookup', input: { path: 'second' } }, { type: 'text', text: 'After tools.' },
        ]);
      }
    }
    const calls = h.state.calls.length;
    for (const provider of ['anthropic', 'gemini']) for (const change of [m => { m.content += 'forged'; }, m => { m.reasoning_content += 'forged'; }, m => { m.tool_calls[0].function.arguments = '{"path":"forged"}'; }]) {
      const forged = structuredClone(message); change(forged);
      assert.equal((await h.request({ model: provider + ':fixture', messages: [...initial, forged] })).status, 400);
    }
    assert.equal(h.state.calls.length, calls);
  } finally { h.close(); }
});

test('Anthropic streaming through the Gemini endpoint emits each visible block and signed thought once', async () => {
  const h = await harness();
  try {
    h.state.network = streaming;
    const response = await h.request({ contents: [{ role: 'user', parts: [{ text: 'Look up two paths.' }] }] }, '/v1beta/models/anthropic:fixture:streamGenerateContent?alt=sse');
    assert.equal(response.status, 200);
    const chunks = (await response.text()).split('\n').filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6)));
    assert.ok(chunks.every(chunk => !chunk.error));
    assert.deepEqual(chunks.flatMap(chunk => chunk.candidates?.[0]?.content?.parts || []), expectedParts);
  } finally { h.close(); }
});

test('ordinary Anthropic text is delivered before its content block or message finishes', async () => {
  const h = await harness(); let controller;
  try {
    h.state.network = () => new Response(new ReadableStream({ start(c) { controller = c; } }), { headers: { 'content-type': 'text/event-stream' } });
    const response = await h.request({ model: 'anthropic:fixture', messages: initial, stream: true });
    const reader = response.body.getReader();
    controller.enqueue(new TextEncoder().encode(frame(start(0, { type: 'text', text: 'Immediate' }))));
    const first = await reader.read(), chunk = JSON.parse(new TextDecoder().decode(first.value).split('\n').find(line => line.startsWith('data: ')).slice(6));
    assert.equal(chunk.choices[0].delta.content, 'Immediate');
    assert.deepEqual(chunk.choices[0].delta.gemini_parts, [{ text: 'Immediate' }]);
    await reader.cancel();
  } finally { h.close(); }
});

test('unfinished or malformed Anthropic tools never become replayable complete calls', async () => {
  const h = await harness();
  try {
    for (const ending of [[], [stop(0), { type: 'message_delta', delta: { stop_reason: 'tool_use' } }, { type: 'message_stop' }]]) {
      h.state.network = () => new Response([start(0, { type: 'tool_use', id: 'a', name: 'lookup', input: {} }), delta(0, 'input_json_delta', { partial_json: '{"path":' }), ...ending].map(frame).join(''), { headers: { 'content-type': 'text/event-stream' } });
      const response = await h.request({ model: 'anthropic:fixture', messages: initial, stream: true }), wire = await response.text();
      assert.match(wire, /"error"/); assert.doesNotMatch(wire, /tool_calls|functionCall|\[DONE\]/);
    }
  } finally { h.close(); }
});
