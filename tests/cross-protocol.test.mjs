import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../_worker.js', import.meta.url), 'utf8');
const encoder = new TextEncoder();
const clientKey = 'gateway-secret-not-an-upstream-key';
let sequence = 0;
const providers = ['openai', 'anthropic', 'gemini'];
const args = [{ q: '北京' }, { q: '上海' }];
const ids = ['new-a', 'new-b'];
const schema = { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] };

function fragmentedSSE(events, anthropic = false) {
  const text = events
    .map((event) =>
      typeof event === 'string'
        ? event
        : (anthropic ? 'event: ' + event.type + '\r\n' : '') + 'data: ' + JSON.stringify(event) + '\r\n\r\n'
    )
    .join('');
  const bytes = encoder.encode(text);
  let cursor = 0;
  return new ReadableStream({
    pull(controller) {
      if (cursor === bytes.length) return controller.close();
      controller.enqueue(bytes.slice(cursor, ++cursor));
    }
  });
}
function nativeReply(provider, stream) {
  if (!stream) {
    if (provider === 'openai')
      return Response.json({
        id: 'native-openai',
        object: 'chat.completion',
        model: 'actual-model',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: '你好',
              reasoning_content: '思考',
              tool_calls: args.map((arg, i) => ({
                id: ids[i],
                type: 'function',
                function: { name: 'lookup', arguments: JSON.stringify(arg) }
              }))
            },
            finish_reason: 'tool_calls'
          }
        ],
        usage: { prompt_tokens: 10, completion_tokens: 6, total_tokens: 16 }
      });
    if (provider === 'anthropic')
      return Response.json({
        id: 'native-anthropic',
        type: 'message',
        role: 'assistant',
        model: 'actual-model',
        content: [
          { type: 'thinking', thinking: '思考', signature: 'anthropic-response-signature' },
          { type: 'text', text: '你好' },
          ...args.map((arg, i) => ({ type: 'tool_use', id: ids[i], name: 'lookup', input: arg }))
        ],
        stop_reason: 'tool_use',
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 6 }
      });
    return Response.json({
      responseId: 'native-gemini',
      modelVersion: 'actual-model',
      candidates: [
        {
          index: 0,
          content: {
            role: 'model',
            parts: [
              { text: '思考', thought: true, thoughtSignature: 'gemini-response-thought-signature' },
              { text: '你好' },
              ...args.map((arg, i) => ({
                functionCall: { id: ids[i], name: 'lookup', args: arg },
                thoughtSignature: 'gemini-response-function-signature-' + i
              }))
            ]
          },
          finishReason: 'STOP'
        }
      ],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 4, thoughtsTokenCount: 2, totalTokenCount: 16 }
    });
  }
  let events;
  if (provider === 'openai')
    events = [
      {
        id: 'native-openai',
        choices: [{ index: 0, delta: { role: 'assistant', reasoning_content: '思考' }, finish_reason: null }]
      },
      { id: 'native-openai', choices: [{ index: 0, delta: { content: '你好' }, finish_reason: null }] },
      {
        id: 'native-openai',
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: ids.map((id, index) => ({
                index,
                id,
                type: 'function',
                function: { name: 'lookup', arguments: '{"q":' }
              }))
            },
            finish_reason: null
          }
        ]
      },
      {
        id: 'native-openai',
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: args.map((arg, index) => ({ index, function: { arguments: JSON.stringify(arg.q) + '}' } }))
            },
            finish_reason: null
          }
        ]
      },
      { id: 'native-openai', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
      { id: 'native-openai', choices: [], usage: { prompt_tokens: 10, completion_tokens: 6, total_tokens: 16 } },
      'data: [DONE]\n\n'
    ];
  else if (provider === 'anthropic')
    events = [
      {
        type: 'message_start',
        message: {
          id: 'native-anthropic',
          type: 'message',
          role: 'assistant',
          model: 'actual-model',
          content: [],
          usage: { input_tokens: 10, output_tokens: 0 }
        }
      },
      { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '思考' } },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'signature_delta', signature: 'anthropic-response-signature' }
      },
      { type: 'content_block_stop', index: 0 },
      { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: '你好' } },
      { type: 'content_block_stop', index: 1 },
      ...args.flatMap((arg, i) => [
        {
          type: 'content_block_start',
          index: i + 2,
          content_block: { type: 'tool_use', id: ids[i], name: 'lookup', input: {} }
        },
        { type: 'content_block_delta', index: i + 2, delta: { type: 'input_json_delta', partial_json: '{"q":' } },
        {
          type: 'content_block_delta',
          index: i + 2,
          delta: { type: 'input_json_delta', partial_json: JSON.stringify(arg.q) + '}' }
        },
        { type: 'content_block_stop', index: i + 2 }
      ]),
      { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 6 } },
      { type: 'message_stop' }
    ];
  else
    events = [
      {
        responseId: 'native-gemini',
        candidates: [
          {
            index: 0,
            content: {
              role: 'model',
              parts: [{ text: '思考', thought: true, thoughtSignature: 'gemini-response-thought-signature' }]
            }
          }
        ]
      },
      {
        responseId: 'native-gemini',
        candidates: [{ index: 0, content: { role: 'model', parts: [{ text: '你好' }] } }]
      },
      {
        responseId: 'native-gemini',
        candidates: [
          {
            index: 0,
            content: {
              role: 'model',
              parts: args.map((arg, i) => ({
                functionCall: { id: ids[i], name: 'lookup', args: arg },
                thoughtSignature: 'gemini-response-function-signature-' + i
              }))
            },
            finishReason: 'STOP'
          }
        ]
      },
      {
        responseId: 'native-gemini',
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 4, thoughtsTokenCount: 2, totalTokenCount: 16 }
      }
    ];
  return new Response(fragmentedSSE(events, provider === 'anthropic'), {
    headers: { 'content-type': 'text/event-stream' }
  });
}

function clientRequest(protocol, stream, key = clientKey, provider) {
  let path,
    body,
    headers = { 'content-type': 'application/json' };
  if (protocol === 'openai') {
    path = '/v1/chat/completions';
    if (key) headers.authorization = 'Bearer ' + key;
    body = {
      model: 'shared-alias',
      messages: [
        { role: 'system', content: 'System instruction' },
        { role: 'user', content: 'Earlier' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [{ id: 'old-call', type: 'function', function: { name: 'lookup', arguments: '{"q":"旧请求"}' } }]
        },
        { role: 'tool', tool_call_id: 'old-call', name: 'lookup', content: '{"result":"旧结果"}' },
        { role: 'user', content: 'Continue' }
      ],
      tools: [{ type: 'function', function: { name: 'lookup', parameters: schema } }],
      max_tokens: 64,
      stream
    };
  } else if (protocol === 'anthropic') {
    path = '/v1/messages';
    if (key) headers['x-api-key'] = key;
    headers['anthropic-version'] = '2023-06-01';
    body = {
      model: 'shared-alias',
      system: 'System instruction',
      max_tokens: 2048,
      ...(provider === 'anthropic' ? { thinking: { type: 'enabled', budget_tokens: 1024 } } : {}),
      stream,
      messages: [
        { role: 'user', content: 'Earlier' },
        {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'Old thinking', signature: 'anthropic-input-signature' },
            { type: 'tool_use', id: 'old-call', name: 'lookup', input: { q: '旧请求' } }
          ]
        },
        {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'old-call', content: '{"result":"旧结果"}' },
            { type: 'text', text: 'Continue' }
          ]
        }
      ],
      tools: [{ name: 'lookup', input_schema: schema }]
    };
  } else {
    path = '/v1beta/models/shared-alias:' + (stream ? 'streamGenerateContent?alt=sse' : 'generateContent');
    if (key) headers['x-goog-api-key'] = key;
    body = {
      systemInstruction: { parts: [{ text: 'System instruction' }] },
      generationConfig: { maxOutputTokens: 64, ...(provider === 'gemini' ? { thinkingConfig: { includeThoughts: true, thinkingBudget: 32 } } : {}) },
      contents: [
        { role: 'user', parts: [{ text: 'Earlier' }] },
        {
          role: 'model',
          parts: [
            { text: 'Old thinking', thought: true, thoughtSignature: 'gemini-input-thought-signature' },
            {
              functionCall: { id: 'old-call', name: 'lookup', args: { q: '旧请求' } },
              thoughtSignature: 'gemini-input-tool-signature'
            }
          ]
        },
        {
          role: 'user',
          parts: [
            { functionResponse: { id: 'old-call', name: 'lookup', response: { result: '旧结果' } } },
            { text: 'Continue' }
          ]
        }
      ],
      tools: [{ functionDeclarations: [{ name: 'lookup', parametersJsonSchema: schema }] }]
    };
  }
  return new Request('https://gateway.test' + path, { method: 'POST', headers, body: JSON.stringify(body) });
}
async function harness(provider, client, streaming) {
  const calls = [];
  const account = {
    id: 'selected-channel',
    provider,
    accountId: '',
    apiToken: provider + '-upstream-secret',
    status: 'active',
    models: ['actual-model'],
    baseUrl: 'https://mock-' + provider + '.test/proxy' + (provider === 'gemini' ? '/v1beta' : '/v1')
  };
  const config = {
    accounts: [account, { ...account, id: 'wrong-channel', models: ['different-model'], apiToken: 'must-not-be-used' }],
    apiKeys: [{ key: clientKey }],
    customModelMap: { 'shared-alias': 'upstream:selected-channel:actual-model' }
  };
  const testSource =
    'const network={fetch:null};const fetch=(...args)=>network.fetch(...args);\n' +
    source +
    `\nexport function setMockFetch(fn){network.fetch=fn;} // ${sequence++}`;
  const module = await import('data:text/javascript;base64,' + Buffer.from(testSource).toString('base64'));
  module.setMockFetch(async (url, options) => {
    const headers = new Headers(options.headers),
      body = JSON.parse(options.body);
    calls.push({ url: String(url), headers, body, options });
    assert.equal(options.method, 'POST');
    assert.equal(options.redirect, 'manual');
    assert.equal(headers.get('authorization'), provider === 'openai' ? 'Bearer openai-upstream-secret' : null);
    assert.equal(headers.get('x-api-key'), provider === 'anthropic' ? 'anthropic-upstream-secret' : null);
    assert.equal(headers.get('x-goog-api-key'), provider === 'gemini' ? 'gemini-upstream-secret' : null);
    assert.equal(JSON.stringify({ body, headers: [...headers] }).includes(clientKey), false);
    const endpoint =
      provider === 'openai'
        ? 'chat/completions'
        : provider === 'anthropic'
          ? 'messages'
          : 'models/actual-model:' + (streaming ? 'streamGenerateContent?alt=sse' : 'generateContent');
    assert.equal(String(url), account.baseUrl + '/' + endpoint);
    if (provider === 'anthropic') assert.equal(headers.get('anthropic-version'), '2023-06-01');
    if (provider !== 'gemini') {
      assert.equal(body.model, 'actual-model');
      assert.equal(body.stream, streaming);
    }
    if (client === provider && client === 'anthropic') {
      assert.deepEqual(body.thinking, { type: 'enabled', budget_tokens: 1024 });
      assert.equal(body.messages[1].content[0].signature, 'anthropic-input-signature');
    }
    if (client === provider && client === 'gemini') {
      assert.equal(body.generationConfig.thinkingConfig.thinkingBudget, 32);
      assert.equal(body.contents[1].parts[0].thoughtSignature, 'gemini-input-thought-signature');
      assert.equal(body.contents[1].parts[1].thoughtSignature, 'gemini-input-tool-signature');
    }
    if (provider === 'openai') {
      const result = body.messages.find((m) => m.role === 'tool');
      assert.equal(result.tool_call_id, 'old-call');
      assert.equal(body.messages[0].role, 'system');
      assert.equal(body.tools[0].function.name, 'lookup');
    }
    if (provider === 'anthropic') {
      assert.equal(JSON.stringify(body).includes('old-call'), true);
      assert.equal(body.tools[0].name, 'lookup');
      assert.ok(body.system);
    }
    if (provider === 'gemini') {
      const result = body.contents.flatMap((c) => c.parts).find((p) => p.functionResponse);
      assert.equal(result.functionResponse.name, 'lookup');
      assert.equal(body.tools[0].functionDeclarations[0].name, 'lookup');
      assert.ok(body.systemInstruction);
    }
    return nativeReply(provider, streaming);
  });
  const env = {
    ADMIN_PASSWORD: 'local-admin-password',
    KV: {},
    CONFIG_STORE: { idFromName: () => 'singleton', get: () => ({ fetch: async () => Response.json(config) }) }
  };
  return { call: (key) => module.default.fetch(clientRequest(client, streaming, key, provider), env, {}), calls };
}
function parseSSE(text) {
  return text
    .split('\n')
    .filter((line) => line.startsWith('data: ') && line !== 'data: [DONE]')
    .map((line) => JSON.parse(line.slice(6)));
}
function inspectJSON(protocol, data) {
  if (protocol === 'openai')
    return {
      text: data.choices[0].message.content,
      tools: data.choices[0].message.tool_calls.map((t) => ({
        id: t.id,
        name: t.function.name,
        args: JSON.parse(t.function.arguments)
      })),
      prompt: data.usage.prompt_tokens,
      completion: data.usage.completion_tokens,
      finish: data.choices[0].finish_reason,
      thoughts: data.choices[0].message.reasoning_content
    };
  if (protocol === 'anthropic')
    return {
      text: data.content
        .filter((p) => p.type === 'text')
        .map((p) => p.text)
        .join(''),
      tools: data.content.filter((p) => p.type === 'tool_use').map((t) => ({ id: t.id, name: t.name, args: t.input })),
      prompt: data.usage.input_tokens,
      completion: data.usage.output_tokens,
      finish: data.stop_reason,
      thoughts: data.content
        .filter((p) => p.type === 'thinking')
        .map((p) => p.thinking)
        .join(''),
      signature: data.content.find((p) => p.type === 'thinking')?.signature
    };
  const parts = data.candidates[0].content.parts;
  return {
    text: parts
      .filter((p) => p.text && !p.thought)
      .map((p) => p.text)
      .join(''),
    tools: parts
      .filter((p) => p.functionCall)
      .map((p) => ({ id: p.functionCall.id, name: p.functionCall.name, args: p.functionCall.args })),
    prompt: data.usageMetadata.promptTokenCount,
    completion: data.usageMetadata.candidatesTokenCount + (data.usageMetadata.thoughtsTokenCount || 0),
    finish: data.candidates[0].finishReason,
    thoughts: parts
      .filter((p) => p.thought)
      .map((p) => p.text)
      .join(''),
    signature: parts.find((p) => p.thought)?.thoughtSignature
  };
}
function inspectStream(protocol, frames) {
  let text = '',
    thoughts = '',
    prompt,
    completion,
    finish,
    signature;
  const tools = new Map();
  if (protocol === 'openai')
    for (const frame of frames) {
      if (frame.usage) {
        prompt = frame.usage.prompt_tokens;
        completion = frame.usage.completion_tokens;
      }
      for (const c of frame.choices || []) {
        text += c.delta?.content || '';
        thoughts += c.delta?.reasoning_content || '';
        if (c.finish_reason) finish = c.finish_reason;
        for (const t of c.delta?.tool_calls || []) {
          const tool = tools.get(t.index) || { id: '', name: '', args: '' };
          if (t.id) tool.id = t.id;
          if (t.function?.name) tool.name += t.function.name;
          tool.args += t.function?.arguments || '';
          tools.set(t.index, tool);
        }
      }
    }
  else if (protocol === 'anthropic')
    for (const f of frames) {
      if (f.type === 'message_start') {
        prompt = f.message.usage.input_tokens;
        completion = f.message.usage.output_tokens;
      }
      if (f.type === 'content_block_start') {
        if (f.content_block.type === 'tool_use')
          tools.set(f.index, {
            id: f.content_block.id,
            name: f.content_block.name,
            args: Object.keys(f.content_block.input || {}).length ? JSON.stringify(f.content_block.input) : ''
          });
        text += f.content_block.type === 'text' ? f.content_block.text || '' : '';
        thoughts += f.content_block.type === 'thinking' ? f.content_block.thinking || '' : '';
      }
      if (f.type === 'content_block_delta') {
        if (f.delta.type === 'text_delta') text += f.delta.text;
        if (f.delta.type === 'thinking_delta') thoughts += f.delta.thinking;
        if (f.delta.type === 'signature_delta') signature = f.delta.signature;
        if (f.delta.type === 'input_json_delta') tools.get(f.index).args += f.delta.partial_json;
      }
      if (f.type === 'message_delta') {
        if (f.usage?.input_tokens !== undefined) prompt = f.usage.input_tokens;
        if (f.usage?.output_tokens !== undefined) completion = f.usage.output_tokens;
        finish = f.delta.stop_reason;
      }
    }
  else
    for (const f of frames) {
      if (f.usageMetadata) {
        prompt = f.usageMetadata.promptTokenCount;
        completion = f.usageMetadata.candidatesTokenCount + (f.usageMetadata.thoughtsTokenCount || 0);
      }
      for (const c of f.candidates || []) {
        if (c.finishReason) finish = c.finishReason;
        for (const p of c.content?.parts || []) {
          if (p.text) {
            if (p.thought) thoughts += p.text;
            else text += p.text;
          }
          if (p.thought && p.thoughtSignature) signature = p.thoughtSignature;
          if (p.functionCall)
            tools.set(p.functionCall.id, {
              id: p.functionCall.id,
              name: p.functionCall.name,
              args: JSON.stringify(p.functionCall.args)
            });
        }
      }
    }
  return {
    text,
    thoughts,
    prompt,
    completion,
    finish,
    signature,
    tools: [...tools.values()].map((t) => ({ ...t, args: JSON.parse(t.args) }))
  };
}

for (const provider of providers)
  for (const client of providers)
    for (const streaming of [false, true])
      test(`${client} client -> ${provider} upstream: ${streaming ? 'byte-fragmented SSE' : 'JSON'} retains tools, usage and authentication`, async () => {
        const fixture = await harness(provider, client, streaming);
        const response = await fixture.call();
        assert.equal(response.status, 200, await response.clone().text());
        assert.equal(response.headers.get('access-control-allow-origin'), '*');
        assert.equal(fixture.calls.length, 1);
        let frames, result;
        if (streaming) {
          assert.match(response.headers.get('content-type'), /event-stream/);
          frames = parseSSE(await response.text());
          result = inspectStream(client, frames);
          if (client === 'anthropic') assert.equal(frames.at(-1).type, 'message_stop');
        } else {
          const data = await response.json();
          result = inspectJSON(client, data);
          if (client !== 'gemini') assert.equal(data.model, 'shared-alias');
        }
        assert.equal(result.text, '你好');
        assert.deepEqual(
          result.tools,
          args.map((arg, i) => ({ id: ids[i], name: 'lookup', args: arg }))
        );
        assert.equal(result.prompt, 10);
        assert.equal(result.completion, 6);
        assert.equal(result.finish, client === 'openai' ? 'tool_calls' : client === 'anthropic' ? 'tool_use' : 'STOP');
        if (provider === client) {
          assert.equal(result.thoughts, '思考');
          if (provider === 'anthropic') assert.equal(result.signature, 'anthropic-response-signature');
          if (provider === 'gemini') assert.equal(result.signature, 'gemini-response-thought-signature');
        }
      });

for (const client of providers)
  test(`${client} client authentication rejects missing and invalid credentials before touching upstream`, async () => {
    const fixture = await harness('openai', client, false);
    for (const key of [null, 'incorrect-gateway-key']) {
      const response = await fixture.call(key);
      assert.equal(response.status, 401);
      const data = await response.json();
      assert.ok(data.error);
    }
    assert.equal(fixture.calls.length, 0);
  });

test('Gemini topK is rejected explicitly by the official OpenAI API but retained for third-party compatible APIs', async () => {
  for (const official of [true, false]) {
    const calls = [];
    const config = {
      accounts: [{ id: 'channel', provider: 'openai', accountId: '', apiToken: 'upstream-test-secret', baseUrl: official ? 'https://api.openai.com/v1' : 'https://openai-compatible.test/v1', models: ['actual-model'], status: 'active' }],
      apiKeys: [{ key: clientKey }], customModelMap: { 'shared-alias': 'openai:actual-model' }
    };
    const module = await import('data:text/javascript;base64,' + Buffer.from('const network={fetch:null};const fetch=(...args)=>network.fetch(...args);\n' + source + '\nexport function setMockFetch(fn){network.fetch=fn;} // top-k ' + sequence++).toString('base64'));
    module.setMockFetch(async (_url, init) => { calls.push(JSON.parse(init.body)); return nativeReply('openai', false); });
    const env = { KV: {}, ADMIN_PASSWORD: 'test-only-admin', CONFIG_STORE: { idFromName: () => 'config', get: () => ({ fetch: async () => Response.json(config) }) } };
    const request = clientRequest('gemini', false);
    const body = await request.json();
    body.generationConfig.topK = 22;
    const response = await module.default.fetch(new Request(request.url, { method: 'POST', headers: request.headers, body: JSON.stringify(body) }), env, {});
    if (official) {
      assert.equal(response.status, 400);
      assert.match((await response.json()).error.message, /does not support top_k/);
      assert.equal(calls.length, 0);
    } else {
      assert.equal(response.status, 200);
      assert.equal(calls[0].top_k, 22);
    }
  }
});
