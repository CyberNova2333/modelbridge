import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../_worker.js', import.meta.url), 'utf8');
let sequence = 0;
const frame = value => 'data: ' + JSON.stringify(value) + '\n\n';
const events = wire => wire.split(/\r?\n/)
  .filter(line => line.startsWith('data: ') && line !== 'data: [DONE]')
  .map(line => JSON.parse(line.slice(6)));

async function harness(provider, respond, apiBodyLimit) {
  let workerSource = source;
  if (apiBodyLimit !== undefined) {
    workerSource = source.replace('const API_JSON_LIMIT = 16 * 1024 * 1024;', `const API_JSON_LIMIT = ${apiBodyLimit};`);
    assert.notEqual(workerSource, source, 'the test must lower the real external request budget');
  }
  const api = await import('data:text/javascript;base64,' + Buffer.from(
    'const network = { run: null }; const fetch = (...args) => network.run(...args);\n' + workerSource
    + '\nexport function mockFetch(fn) { network.run = fn; }\n// review protocol ' + sequence++
  ).toString('base64'));
  const calls = [];
  api.mockFetch(async (...args) => { calls.push(args); return respond(...args); });
  const target = provider === 'cloudflare' ? '@cf/meta/fixture'
    : provider === 'antigravity' ? 'antigravity:gemini-2.5-flash' : provider + ':fixture';
  const config = {
    accounts: [{ id: 'fixture', provider, status: 'active', accountId: 'fixture@example.invalid',
      apiToken: provider === 'antigravity' ? 'ya29.fixture-access' : 'fixture-upstream-token',
      baseUrl: 'https://upstream.invalid/v1', models: [], projectId: 'fixture-project', projectSource: 'manual' }],
    apiKeys: [{ key: 'fixture-client-key' }], customModelMap: { alias: target },
  };
  const env = { ADMIN_PASSWORD: 'fixture-admin', KV: { async get() { return null; } }, CONFIG_STORE: {
    idFromName: name => name, get: () => ({ fetch: async () => Response.json(config) }),
  } };
  return {
    calls,
    request(path, body) {
      return api.default.fetch(new Request('https://gateway.invalid' + path, { method: 'POST',
        headers: { authorization: 'Bearer fixture-client-key', 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }), env, {});
    },
  };
}

function generation(client, stream) {
  if (client === 'gemini') return ['/v1beta/models/alias:' + (stream ? 'streamGenerateContent?alt=sse' : 'generateContent'),
    { contents: [{ role: 'user', parts: [{ text: 'Hello' }] }] }];
  return [client === 'anthropic' ? '/v1/messages' : '/v1/chat/completions',
    { model: 'alias', messages: [{ role: 'user', content: 'Hello' }], stream,
      ...(client === 'anthropic' ? { max_tokens: 20 } : {}) }];
}

test('Gemini failed or unknown terminal states become detectable errors in every client protocol without retry', async () => {
  for (const reason of ['MALFORMED_FUNCTION_CALL', 'OTHER', 'UNEXPECTED_TOOL_CALL', 'unknown-fixture-reason']) {
    for (const stream of [false, true]) for (const client of ['openai', 'anthropic', 'gemini']) {
      const data = { candidates: [{ index: 0, finishReason: reason }] };
      const h = await harness('gemini', () => stream
        ? new Response(frame(data), { headers: { 'content-type': 'text/event-stream' } }) : Response.json(data));
      const response = await h.request(...generation(client, stream));
      const wire = await response.text();
      assert.equal(response.status, stream ? 200 : 502, client + ': ' + wire);
      const result = stream ? events(wire) : [JSON.parse(wire)];
      assert.ok(result.some(value => value.error), wire);
      assert.doesNotMatch(wire, /"finishReason":"STOP"|"finish_reason":"stop"|"stop_reason":"end_turn"|message_stop|\[DONE\]/);
      assert.equal(wire.includes(reason), false, 'do not reflect an arbitrary upstream reason');
      assert.equal(h.calls.length, 1, 'a failed successful response must never trigger another generation');
    }
  }
});

test('normal, truncated and filtered Gemini terminal states retain their meaning', async () => {
  const expected = { STOP: 'stop', MAX_TOKENS: 'length', SAFETY: 'content_filter' };
  for (const [reason, finish] of Object.entries(expected)) for (const stream of [false, true]) {
    const data = { candidates: [{ index: 0, content: { role: 'model', parts: [{ text: 'Answer' }] }, finishReason: reason }] };
    const h = await harness('gemini', () => stream
      ? new Response(frame(data), { headers: { 'content-type': 'text/event-stream' } }) : Response.json(data));
    const response = await h.request(...generation('openai', stream));
    assert.equal(response.status, 200);
    const wire = await response.text();
    const result = stream ? events(wire)[0] : JSON.parse(wire);
    assert.equal(result.choices[0].finish_reason, finish);
    assert.equal(stream ? result.choices[0].delta.content : result.choices[0].message.content, 'Answer');
    assert.equal(h.calls.length, 1);
  }
});

test('a failed Gemini finish after partial text ends with a protocol error and cancels later content', async () => {
  for (const client of ['openai', 'anthropic', 'gemini']) {
    let cancelled = false;
    const chunks = [
      { candidates: [{ index: 0, content: { role: 'model', parts: [{ text: 'Partial answer' }] } }] },
      { candidates: [{ index: 0, finishReason: 'MALFORMED_FUNCTION_CALL' }] },
      { candidates: [{ index: 0, content: { role: 'model', parts: [{ text: 'MUST_NOT_PASS' }] }, finishReason: 'STOP' }] },
    ];
    const h = await harness('gemini', () => new Response(new ReadableStream({
      pull(controller) {
        if (chunks.length) controller.enqueue(new TextEncoder().encode(frame(chunks.shift())));
      },
      cancel() { cancelled = true; },
    }), { headers: { 'content-type': 'text/event-stream' } }));
    const response = await h.request(...generation(client, true));
    const wire = await response.text();
    assert.equal(response.status, 200);
    assert.match(wire, /Partial answer/);
    assert.ok(events(wire).some(value => value.error), wire);
    assert.doesNotMatch(wire, /MUST_NOT_PASS|"finishReason":"STOP"|"finish_reason":"stop"|message_stop|\[DONE\]/);
    assert.equal(cancelled, true);
    assert.equal(h.calls.length, 1);
  }
});

test('Anthropic JSON and SSE preserve OpenAI refusal text and stop_reason', async () => {
  for (const finishReason of ['content_filter', 'stop']) for (const stream of [false, true]) {
    const h = await harness('openai', () => stream
      ? new Response(frame({ choices: [{ index: 0, delta: { refusal: 'Declined ' }, finish_reason: null }] })
        + frame({ choices: [{ index: 0, delta: { refusal: 'for this request.' }, finish_reason: finishReason }] })
        + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } })
      : Response.json({ choices: [{ index: 0, message: { role: 'assistant', content: null,
        refusal: 'Declined for this request.' }, finish_reason: finishReason }] }));
    const response = await h.request(...generation('anthropic', stream));
    assert.equal(response.status, 200);
    const wire = await response.text();
    if (stream) {
      const result = events(wire);
      assert.equal(result.filter(value => value.delta?.type === 'text_delta').map(value => value.delta.text).join(''), 'Declined for this request.');
      assert.equal(result.find(value => value.type === 'message_delta').delta.stop_reason, 'refusal');
      assert.equal(result.at(-1).type, 'message_stop');
    } else {
      const result = JSON.parse(wire);
      assert.equal(result.stop_reason, 'refusal');
      assert.deepEqual(result.content, [{ type: 'text', text: 'Declined for this request.' }]);
    }
    assert.equal(h.calls.length, 1);
  }
});

test('a content-filtered OpenAI response without refusal text remains an Anthropic refusal', async () => {
  for (const stream of [false, true]) {
    const h = await harness('openai', () => stream
      ? new Response(frame({ choices: [{ index: 0, delta: {}, finish_reason: 'content_filter' }] }) + 'data: [DONE]\n\n',
        { headers: { 'content-type': 'text/event-stream' } })
      : Response.json({ choices: [{ index: 0, message: { role: 'assistant', content: null }, finish_reason: 'content_filter' }] }));
    const response = await h.request(...generation('anthropic', stream));
    const wire = await response.text();
    assert.equal(response.status, 200);
    assert.equal(stream ? events(wire).find(value => value.type === 'message_delta').delta.stop_reason : JSON.parse(wire).stop_reason, 'refusal');
  }
});

test('Gemini enum output rejects incompatible upstreams before generation or OAuth', async () => {
  for (const provider of ['openai', 'anthropic', 'cloudflare', 'antigravity']) {
    for (const stream of [false, true]) for (const key of ['generationConfig', 'generation_config']) {
      const h = await harness(provider, () => { throw new Error('No upstream work is allowed for an unenforceable constraint'); });
      const [path, body] = generation('gemini', stream);
      body[key] = { responseMimeType: 'text/x.enum', responseSchema: { type: 'STRING', enum: ['yes', 'no'] } };
      const response = await h.request(path, body);
      assert.equal(response.status, 400, await response.clone().text());
      assert.match((await response.json()).error.message, /responseMimeType/);
      assert.equal(h.calls.length, 0, provider);
    }
  }
});

test('native Gemini enum settings remain intact on the upstream wire', async () => {
  for (const stream of [false, true]) {
    let received;
    const h = await harness('gemini', (_url, init) => {
      received = JSON.parse(init.body);
      const data = { candidates: [{ index: 0, content: { role: 'model', parts: [{ text: 'yes' }] }, finishReason: 'STOP' }] };
      return stream ? new Response(frame(data), { headers: { 'content-type': 'text/event-stream' } }) : Response.json(data);
    });
    const [path, body] = generation('gemini', stream);
    body.generationConfig = { responseMimeType: 'text/x.enum', responseSchema: { type: 'STRING', enum: ['yes', 'no'] } };
    const response = await h.request(path, body);
    assert.equal(response.status, 200, await response.clone().text());
    assert.deepEqual(received.generationConfig, body.generationConfig);
    assert.match(await response.text(), /yes/);
    assert.equal(h.calls.length, 1);
  }
});

test('Gemini JSON schema constraints still convert to OpenAI structured output', async () => {
  let received;
  const h = await harness('openai', (_url, init) => {
    received = JSON.parse(init.body);
    return Response.json({ choices: [{ index: 0, message: { role: 'assistant', content: '"yes"' }, finish_reason: 'stop' }] });
  });
  const [path, body] = generation('gemini', false);
  body.generationConfig = { responseMimeType: 'application/json', responseSchema: { type: 'STRING', enum: ['yes', 'no'] } };
  const response = await h.request(path, body);
  assert.equal(response.status, 200);
  assert.deepEqual(received.response_format, { type: 'json_schema', json_schema: { name: 'response', schema: { type: 'string', enum: ['yes', 'no'] } } });
});

test('Gemini payloads within the external body budget survive expanded internal replay metadata', async () => {
  const apiBodyLimit = 64 * 1024;
  for (const stream of [false, true]) {
    let received;
    const h = await harness('openai', (_url, init) => {
      received = JSON.parse(init.body);
      return stream
        ? new Response(frame({ choices: [{ index: 0, delta: { content: 'Accepted' }, finish_reason: 'stop' }] })
          + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } })
        : Response.json({ choices: [{ index: 0, message: { role: 'assistant', content: 'Accepted' }, finish_reason: 'stop' }] });
    }, apiBodyLimit);
    const [path, body] = generation('gemini', stream);
    const text = 'x'.repeat(40 * 1024);
    body.contents[0].parts[0].text = text;
    assert.ok(new TextEncoder().encode(JSON.stringify(body)).byteLength < apiBodyLimit);
    const response = await h.request(path, body);
    const wire = await response.text();
    assert.equal(response.status, 200, wire);
    assert.match(wire, /Accepted/);
    assert.equal(received.messages[0].content, text);
    assert.equal(h.calls.length, 1);
  }
});

test('the external Gemini body budget still rejects oversized payloads before conversion or generation', async () => {
  const apiBodyLimit = 64 * 1024;
  for (const stream of [false, true]) {
    const h = await harness('openai', () => { throw new Error('Oversized external input must never reach upstream'); }, apiBodyLimit);
    const [path, body] = generation('gemini', stream);
    body.contents[0].parts[0].text = 'x'.repeat(apiBodyLimit);
    const response = await h.request(path, body);
    assert.equal(response.status, 413);
    assert.equal((await response.json()).error.status, 'RESOURCE_EXHAUSTED');
    assert.equal(h.calls.length, 0);
  }
});
