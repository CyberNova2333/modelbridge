import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../_worker.js', import.meta.url), 'utf8');
const api = await import('data:text/javascript;base64,' + Buffer.from(
  'let network; const fetch = (...args) => network(...args);\n' + source
  + '\nexport function mockFetch(fn) { network = fn; }'
).toString('base64'));
const secret = 'synthetic-上游/token+value=?';
const encoded = encodeURIComponent(secret);
const config = {
  accounts: [{ id: 'anthropic', provider: 'anthropic', apiToken: secret,
    baseUrl: 'https://anthropic.invalid/v1', status: 'active', models: [] }],
  apiKeys: [{ key: 'synthetic-client-key' }], customModelMap: {},
};
const env = { ADMIN_PASSWORD: 'synthetic-admin', KV: {}, CONFIG_STORE: {
  idFromName: name => name, get: () => ({ fetch: async () => Response.json(config) }),
} };
const dispatch = () => api.default.fetch(new Request('https://gateway.invalid/v1/messages', {
  method: 'POST', headers: { authorization: 'Bearer synthetic-client-key', 'content-type': 'application/json' },
  body: JSON.stringify({ model: 'anthropic:fixture', max_tokens: 20, stream: true, messages: [{ role: 'user', content: 'hello' }] }),
}), env, {});
const frame = (value, newline = '\n', eventName = value?.type) =>
  (eventName ? 'event: ' + eventName + newline : '') + 'data: ' + JSON.stringify(value) + newline + newline;
const start = { type: 'message_start', message: { id: 'msg-native', type: 'message', role: 'assistant', model: 'fixture',
  content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 2, output_tokens: 0 } } };
function upstream(wire, keepOpen = false) {
  const bytes = new TextEncoder().encode(wire); let offset = 0, cancelled = false;
  api.mockFetch(async () => new Response(new ReadableStream({
    pull(controller) {
      if (offset < bytes.length) controller.enqueue(bytes.subarray(offset, ++offset));
      else if (!keepOpen) controller.close();
    },
    cancel() { cancelled = true; },
  }), { headers: { 'content-type': 'text/event-stream' } }));
  return () => cancelled;
}
function parseEvents(wire) {
  return wire.split('\n').filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6)));
}

test('native Anthropic rejects JSON diagnostics and extra fields on known events without leaking or ending successfully', async () => {
  const diagnostics = [
    'Rejected Authorization: Bearer ' + secret,
    ['Rejected ' + secret, encoded],
    { diagnostic: secret + encoded },
    { type: 'diagnostic', message: secret },
    { type: 'ping', diagnostic: secret },
    { type: 'message_stop', diagnostic: encoded },
  ];
  for (const value of diagnostics) for (const atEOF of [false, true]) {
    const first = frame(value, '\r\n');
    const cancelled = upstream(atEOF ? first.trimEnd() : first + frame({ type: 'message_stop' }), !atEOF);
    const response = await dispatch();
    assert.equal(response.status, 200);
    const wire = await response.text(), events = parseEvents(wire);
    assert.equal(events.length, 1); assert.equal(events[0].type, 'error');
    for (const unsafe of [secret, encoded, 'message_stop', 'Rejected', 'diagnostic']) assert.equal(wire.includes(unsafe), false, wire);
    if (!atEOF) assert.equal(cancelled(), true);
  }
});

test('native Anthropic validates the event payload shape and matching SSE event name', async () => {
  const bad = [
    null, 7, { type: 'message_start', message: {} }, { type: 'message_start', message: { ...start.message, usage: [] } },
    { type: 'content_block_start', index: -1, content_block: { type: 'text', text: secret } },
    { type: 'content_block_start', index: 0, content_block: [] },
    { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: { diagnostic: secret } } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text', text: secret } },
    { type: 'content_block_stop', index: '0' },
    { type: 'message_delta', delta: { stop_reason: [] }, usage: { output_tokens: 1 } },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: 'diagnostic ' + secret },
  ];
  for (const value of bad) {
    upstream(frame(value) + frame({ type: 'message_stop' }));
    const wire = await (await dispatch()).text();
    assert.deepEqual(parseEvents(wire).map(event => event.type), ['error']);
    assert.equal(wire.includes(secret), false);
  }
  upstream(frame({ type: 'ping' }, '\n', 'message_stop') + frame({ type: 'message_stop' }));
  assert.deepEqual(parseEvents(await (await dispatch()).text()).map(event => event.type), ['error']);
});

test('native Anthropic retains valid message events, provider content, generated text and signatures byte-for-byte', async () => {
  const events = [start,
    { type: 'ping' },
    { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '思考 ' + secret } },
    { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: encoded } },
    { type: 'content_block_stop', index: 0 },
    { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Answer ' + secret } },
    { type: 'content_block_delta', index: 1, delta: { type: 'citations_delta', citation: { type: 'web_search_result_location', title: 'Source', url: 'https://source.invalid/' } } },
    { type: 'content_block_stop', index: 1 },
    { type: 'content_block_start', index: 2, content_block: { type: 'server_tool_use', id: 'srvtoolu-one', name: 'web_search', input: {} } },
    { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '{"query":"sample"}' } },
    { type: 'content_block_stop', index: 2 },
    { type: 'content_block_start', index: 3, content_block: { type: 'web_search_tool_result', tool_use_id: 'srvtoolu-one', content: [{ type: 'web_search_result', title: 'Source', url: 'https://source.invalid/' }] } },
    { type: 'content_block_stop', index: 3 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 10 } },
    { type: 'message_stop' },
  ];
  for (const newline of ['\n', '\r\n', '\r']) {
    const wire = ': heartbeat' + newline + newline + events.map(event => frame(event, newline)).join('');
    upstream(wire.trimEnd());
    const response = await dispatch();
    assert.equal(response.status, 200);
    const output = await response.text();
    assert.equal(output, wire.replace(/\r\n|\r/g, '\n'));
    assert.deepEqual(parseEvents(output), events);
  }
});

test('recognized native error remains terminal and redacted; premature EOF retains partial text then errors', async () => {
  upstream(frame({ type: 'error', error: { type: 'api_error', message: secret } }) + frame({ type: 'message_stop' }));
  let wire = await (await dispatch()).text();
  assert.deepEqual(parseEvents(wire).map(event => event.type), ['error']);
  assert.equal(wire.includes(secret), false); assert.match(wire, /\[redacted\]/);
  upstream(frame(start) + frame({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
    + frame({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'partial' } }).trimEnd());
  wire = await (await dispatch()).text();
  assert.match(wire, /partial/); assert.equal(parseEvents(wire).at(-1).type, 'error'); assert.doesNotMatch(wire, /message_stop/);
});
