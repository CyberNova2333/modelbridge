import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../_worker.js', import.meta.url), 'utf8');
let serial = 0;
const model = 'antigravity:gemini-2.5-flash';
const messages = [{ role: 'user', content: 'hello' }];
const google = (parts = [{ text: 'answer' }], finishReason = 'STOP') => ({
  candidates: [{ content: { parts }, ...(finishReason ? { finishReason } : {}) }],
  usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 3 },
});
const sse = data => 'data: ' + JSON.stringify({ response: data }) + '\n\n';
const parseEvents = wire => wire.split(/\r?\n\r?\n/).flatMap(frame => {
  const line = frame.split(/\r?\n/).find(value => value.startsWith('data: '));
  return line && line !== 'data: [DONE]' ? [JSON.parse(line.slice(6))] : [];
});

async function harness(network = () => Response.json({ response: google() }), refreshToken = false) {
  const key = '__agConstraintNetwork' + serial++;
  const calls = [];
  globalThis[key] = async (...args) => { calls.push(args); return network(...args); };
  const module = await import('data:text/javascript;base64,' + Buffer.from(`const fetch = (...args) => globalThis.${key}(...args);\n` + source).toString('base64'));
  const values = new Map([['config', {
    accounts: [{ id: 'ag', provider: 'antigravity', accountId: 'mock@example.com', apiToken: refreshToken ? '1//mock-refresh' : 'ya29.mock-access', projectId: 'mock-project', projectSource: 'manual', status: 'active' }],
    apiKeys: [{ id: 'key', key: 'gateway-key' }], customModelMap: {},
  }]]);
  let queue = Promise.resolve();
  const state = {
    storage: {
      async get(key) { return structuredClone(values.get(key)); },
      async put(key, value) { values.set(key, structuredClone(value)); },
    },
    blockConcurrencyWhile(fn) { const result = queue.then(fn); queue = result.catch(() => {}); return result; },
  };
  const env = { ADMIN_PASSWORD: 'fixture-password', KV: { async get() { return null; } } };
  const store = new module.AppConfigStore(state, env);
  env.CONFIG_STORE = { idFromName: name => name, get: () => ({ fetch: (url, init) => store.fetch(new Request(url, init)) }) };
  return {
    calls,
    dispatch(path, body) { return module.default.fetch(new Request('https://worker.test' + path, {
      method: 'POST', headers: { Authorization: 'Bearer gateway-key', 'content-type': 'application/json' }, body: JSON.stringify(body),
    }), env, {}); },
    close() { delete globalThis[key]; },
  };
}

test('Antigravity rejects unsupported media and JSON output constraints before OAuth or generation', async () => {
  const h = await harness(() => { throw new Error('No upstream work is allowed'); }, true);
  try {
    const cases = [
      ['/v1/chat/completions', { model, messages: [{ role: 'user', content: [{ type: 'text', text: 'Describe the image' }, { type: 'image_url', image_url: { url: 'https://images.example.test/photo.png' } }] }] }],
      ['/v1/messages', { model, max_tokens: 20, messages: [{ role: 'user', content: [{ type: 'text', text: 'Read the PDF' }, { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'JVBERi0=' } }] }] }],
      ['/v1/messages', { model, max_tokens: 20, messages: [
        { role: 'assistant', content: [{ type: 'tool_use', id: 'screenshot', name: 'browser', input: {} }] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'screenshot', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } }] }] },
      ] }],
      ...['json_object', 'json_schema'].map(type => ['/v1/chat/completions', { model, messages, response_format: { type, json_schema: { name: 'result', schema: { type: 'object', properties: { answer: { type: 'string' } } }, strict: true } } }]),
      ['/v1/messages', { model, messages, max_tokens: 20, output_config: { format: { type: 'json_schema', schema: { type: 'object' } } } }],
      ['/v1/messages', { model, messages, max_tokens: 20, thinking: { type: 'adaptive' } }],
    ];
    for (const [path, body] of cases) {
      const response = await h.dispatch(path, body);
      assert.equal(response.status, 400, JSON.stringify(body));
      assert.ok((await response.json()).error);
    }
    assert.equal(h.calls.length, 0);
  } finally { h.close(); }
});

test('Antigravity preserves inline images and explicit zero or positive thinking budgets on the wire', async () => {
  const h = await harness();
  try {
    for (const budget of [0, 2048]) {
      const response = await h.dispatch('/v1beta/models/' + model + ':generateContent', {
        contents: [{ role: 'user', parts: [{ text: 'Inspect this' }, { inlineData: { mimeType: 'image/png', data: 'AAAA' } }] }],
        generationConfig: { thinkingConfig: { thinkingBudget: budget, includeThoughts: false } },
      });
      assert.equal(response.status, 200, await response.text());
      const wire = JSON.parse(h.calls.at(-1)[1].body).request;
      assert.deepEqual(wire.generationConfig.thinkingConfig, { thinkingBudget: budget, includeThoughts: false });
      assert.deepEqual(wire.contents[0].parts[1], { inlineData: { mimeType: 'image/png', data: 'AAAA' } });
    }
    for (const [thinking, expected] of [[{ type: 'disabled' }, 0], [{ type: 'enabled', budget_tokens: 1024 }, 1024]]) {
      const response = await h.dispatch('/v1/messages', { model, messages, max_tokens: 4096, thinking });
      assert.equal(response.status, 200, await response.text());
      assert.deepEqual(JSON.parse(h.calls.at(-1)[1].body).request.generationConfig.thinkingConfig, { thinkingBudget: expected });
    }
  } finally { h.close(); }
});

test('Antigravity rejects conflicting or unsupported thinking controls without network work', async () => {
  const h = await harness(() => { throw new Error('No network expected'); });
  try {
    for (const thinking_config of [{ thinkingBudget: -2 }, { thinkingBudget: 0, thinkingLevel: 'LOW' }, { unknownBudget: 10 }]) {
      assert.equal((await h.dispatch('/v1/chat/completions', { model, messages, thinking_config })).status, 400);
    }
    assert.equal((await h.dispatch('/v1/chat/completions', { model, messages, thinking_config: { thinkingBudget: 0 }, thinking: { type: 'enabled', budget_tokens: 1024 } })).status, 400);
    assert.equal(h.calls.length, 0);
  } finally { h.close(); }
});

test('Antigravity filtered JSON results retain refusal semantics and never expose accompanying tools', async () => {
  for (const reason of ['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII', 'IMAGE_SAFETY']) {
    const h = await harness(() => Response.json({ response: google([{ text: 'blocked' }, { functionCall: { id: 'unsafe', name: 'delete_file', args: {} } }], reason) }));
    try {
      const openai = await h.dispatch('/v1/chat/completions', { model, messages });
      assert.equal(openai.status, 200);
      const result = await openai.json();
      assert.equal(result.choices[0].finish_reason, 'content_filter');
      assert.equal(result.choices[0].message.tool_calls, undefined);
      assert.ok(!JSON.stringify(result).includes('delete_file'));
      const anthropic = await (await h.dispatch('/v1/messages', { model, messages, max_tokens: 20 })).json();
      assert.equal(anthropic.stop_reason, 'refusal');
      assert.deepEqual(anthropic.content, []);
    } finally { h.close(); }
  }
});

test('Antigravity buffers streamed tools until normal completion and drops them on filtering or truncation', async () => {
  for (const reason of ['SAFETY', 'RECITATION', 'MAX_TOKENS', 'STOP']) {
    const upstream = sse(google([{ text: 'checking' }], null))
      + sse(google([{ functionCall: { id: 'call-1', name: 'perform_action', args: {} } }], null))
      + sse(google([], reason));
    const h = await harness(() => new Response(upstream, { headers: { 'content-type': 'text/event-stream' } }));
    try {
      for (const protocol of ['openai', 'anthropic']) {
        const response = await h.dispatch(protocol === 'openai' ? '/v1/chat/completions' : '/v1/messages', { model, messages, max_tokens: 20, stream: true });
        const wire = await response.text(), events = parseEvents(wire);
        const expected = protocol === 'openai'
          ? reason === 'STOP' ? 'tool_calls' : reason === 'MAX_TOKENS' ? 'length' : 'content_filter'
          : reason === 'STOP' ? 'tool_use' : reason === 'MAX_TOKENS' ? 'max_tokens' : 'refusal';
        const actual = protocol === 'openai' ? events.find(event => event.choices?.[0]?.finish_reason)?.choices[0].finish_reason
          : events.find(event => event.type === 'message_delta')?.delta.stop_reason;
        assert.equal(actual, expected, wire);
        assert.equal(wire.includes('perform_action'), reason === 'STOP', wire);
      }
    } finally { h.close(); }
  }
});

test('unknown and malformed Antigravity endings remain errors without exposing buffered tools', async () => {
  for (const reason of ['MALFORMED_FUNCTION_CALL', 'OTHER', 'UNRECOGNIZED_REASON']) {
    const parts = [{ functionCall: { id: 'call-1', name: 'perform_action', args: {} } }];
    const h = await harness((_url, init) => JSON.parse(init.body).request.generationConfig.maxOutputTokens === 21
      ? new Response(sse(google(parts, null)) + sse(google([], reason)), { headers: { 'content-type': 'text/event-stream' } })
      : Response.json({ response: google(parts, reason) }));
    try {
      assert.equal((await h.dispatch('/v1/chat/completions', { model, messages })).status, 502);
      const response = await h.dispatch('/v1/chat/completions', { model, messages, stream: true, max_tokens: 21 });
      const wire = await response.text();
      assert.match(wire, /"error"/);
      assert.doesNotMatch(wire, /perform_action|\[DONE\]/);
    } finally { h.close(); }
  }
});
