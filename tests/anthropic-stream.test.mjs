import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../_worker.js', import.meta.url), 'utf8');
const { anthropicStreamTransform } = await import('data:text/javascript;base64,' +
  Buffer.from(source + '\nexport { anthropicStreamTransform };').toString('base64'));
const encoder = new TextEncoder();
const choice = (delta, finish_reason = null) => ({ choices: [{ delta, finish_reason }] });
const frame = value => 'data: ' + (typeof value === 'string' ? value : JSON.stringify(value)) + '\n\n';

async function eventsFromBytes(bytes) {
  let index = 0;
  const upstream = new ReadableStream({
    pull(controller) {
      if (index === bytes.length) controller.close();
      else controller.enqueue(bytes[index++]);
    },
  });
  const text = await new Response(anthropicStreamTransform(upstream, 'client-model', [])).text();
  return text.split('\n').filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6)));
}

const convert = chunks => eventsFromBytes(chunks.map(chunk => encoder.encode(frame(chunk))));

function assertBlockLifecycle(events) {
  let open = null;
  const started = new Set();
  for (const event of events) {
    if (event.type === 'content_block_start') {
      assert.equal(open, null, 'previous block must end before another starts');
      assert.equal(started.has(event.index), false, 'block indices must be unique');
      started.add(event.index);
      open = event.index;
    } else if (event.type === 'content_block_delta') {
      assert.equal(event.index, open, 'delta must belong to the open block');
    } else if (event.type === 'content_block_stop') {
      assert.equal(event.index, open, 'only the open block may end');
      open = null;
    }
  }
  assert.equal(open, null);
  assert.equal(events[0].type, 'message_start');
  assert.equal(events.at(-1).type, 'message_stop');
  assert.equal(events.filter(event => event.type === 'message_start').length, 1);
  assert.equal(events.filter(event => event.type === 'message_stop').length, 1);
}

test('long token-by-token streams finish without recursive enqueue wrappers', { timeout: 15000 }, async () => {
  const total = 30000;
  let sent = 0;
  const upstream = new ReadableStream({
    pull(controller) {
      if (sent++ < total) controller.enqueue(encoder.encode(frame(choice({ content: 'x' }))));
      else { controller.enqueue(encoder.encode(frame(choice({}, 'stop')) + frame('[DONE]'))); controller.close(); }
    },
  });
  const text = await new Response(anthropicStreamTransform(upstream, 'client-model', [])).text();
  const events = text.split('\n').filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6)));
  assert.equal(events.filter(event => event.delta?.type === 'text_delta').length, total);
  assertBlockLifecycle(events);
});

test('interleaved parallel tool inputs remain associated with their own IDs', async () => {
  const events = await convert([
    choice({ tool_calls: [
      { index: 0, id: 'weather-id', function: { name: 'weather', arguments: '' } },
      { index: 1, id: 'search-id', function: { name: 'search', arguments: '' } },
    ] }),
    choice({ tool_calls: [
      { index: 1, function: { arguments: '{"query":' } },
      { index: 0, function: { arguments: '{"city":' } },
    ] }),
    choice({ tool_calls: [
      { index: 0, function: { arguments: '"Paris"}' } },
      { index: 1, function: { arguments: '"news"}' } },
    ] }),
    choice({}, 'tool_calls'), '[DONE]',
  ]);
  assertBlockLifecycle(events);
  const inputs = new Map();
  for (const event of events) {
    if (event.content_block?.type === 'tool_use') inputs.set(event.index, { id: event.content_block.id, json: '' });
    if (event.delta?.type === 'input_json_delta') inputs.get(event.index).json += event.delta.partial_json;
  }
  assert.deepEqual([...inputs.values()].map(input => [input.id, JSON.parse(input.json)]), [
    ['weather-id', { city: 'Paris' }], ['search-id', { query: 'news' }],
  ]);
  assert.equal(events.find(event => event.type === 'message_delta').delta.stop_reason, 'tool_use');
});

test('single-tool arguments are delivered before the upstream finishes', async () => {
  let controller;
  const upstream = new ReadableStream({ start(value) { controller = value; } });
  const reader = anthropicStreamTransform(upstream, 'client-model', []).getReader();
  controller.enqueue(encoder.encode(frame(choice({ tool_calls: [
    { index: 0, id: 'call-id', function: { name: 'search', arguments: '{"query":' } },
  ] }))));
  let receivedArguments = false;
  for (let index = 0; index < 3; index++) {
    const { value, done } = await reader.read();
    assert.equal(done, false);
    if (new TextDecoder().decode(value).includes('input_json_delta')) receivedArguments = true;
  }
  assert.equal(receivedArguments, true);
  await reader.cancel();
});

test('text, tool, then trailing text have balanced sequential content blocks', async () => {
  const events = await convert([
    choice({ content: 'Checking. ' }),
    choice({ tool_calls: [{ index: 0, id: 'call-id', function: { name: 'search', arguments: '{}' } }] }),
    choice({ content: 'Done.' }), choice({}, 'tool_calls'), '[DONE]',
  ]);
  assertBlockLifecycle(events);
  assert.deepEqual(events.filter(event => event.type === 'content_block_start').map(event => event.content_block.type),
    ['text', 'tool_use', 'text']);
});

test('length finish reasons remain max_tokens for both text and incomplete tool input', async () => {
  for (const delta of [{ content: 'cut off' }, {
    tool_calls: [{ index: 0, id: 'call-id', function: { name: 'search', arguments: '{"query":' } }],
  }]) {
    const events = await convert([choice(delta), choice({}, 'length'), '[DONE]']);
    assertBlockLifecycle(events);
    assert.equal(events.find(event => event.type === 'message_delta').delta.stop_reason, 'max_tokens');
  }
});

test('usage-only terminal chunks preserve token counts and DONE emits one ending', async () => {
  const events = await convert([
    choice({ content: 'hello' }), choice({}, 'stop'),
    { choices: [], usage: { prompt_tokens: 17, completion_tokens: 6 } }, '[DONE]', '[DONE]',
  ]);
  assertBlockLifecycle(events);
  assert.deepEqual(events.find(event => event.type === 'message_delta').usage, { input_tokens: 17, output_tokens: 6 });
});

test('fragmented UTF-8 and CRLF frames survive byte boundaries and an unterminated final frame', async () => {
  const data = encoder.encode((frame(choice({ content: '你好🦊' })) + frame(choice({}, 'stop')) + 'data: [DONE]').replaceAll('\n', '\r\n'));
  const events = await eventsFromBytes(Array.from(data, byte => new Uint8Array([byte])));
  assertBlockLifecycle(events);
  assert.equal(events.filter(event => event.delta?.type === 'text_delta').map(event => event.delta.text).join(''), '你好🦊');
});

test('downstream cancellation cancels the upstream reader', async () => {
  let cancelled = false;
  const upstream = new ReadableStream({ cancel() { cancelled = true; } });
  const reader = anthropicStreamTransform(upstream, 'client-model', []).getReader();
  await reader.cancel('client disconnected');
  assert.equal(cancelled, true);
});
