import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../_worker.js', import.meta.url), 'utf8');

async function loadWorker(mockFetch) {
  const testingSource = `
    const testNetwork = { fetch: null };
    const fetch = (...args) => testNetwork.fetch(...args);
  ` + source + `
    export function setFetchForTest(mockFetch) { testNetwork.fetch = mockFetch; }
    export {
      resolveModelName,
      hasAntigravityConfigured,
      getAntigravityAccounts,
      getAntigravityModelList,
      sanitizeToolSchema,
      buildAntigravityCloudCodeRequest,
      convertOpenAIReqToAnthropic,
      parseGoogleResponseToAnthropic,
      antigravityToAnthropicStream,
      antigravityToOpenAIStream,
      handleAntigravityMessages,
      handleAntigravityCompletions,
      handleV1Proxy
    };
  `;
  const module = await import('data:text/javascript;base64,' + Buffer.from(testingSource).toString('base64'));
  module.setFetchForTest(mockFetch);
  return module;
}

test('Antigravity model name resolution and prefix handling', async () => {
  const worker = await loadWorker(async () => { throw new Error('Network not expected'); });
  const baseEnv = {
    ADMIN_PASSWORD: 'admin',
    KV: {},
    CONFIG_STORE: {
      idFromName: () => 'app-config-v1',
      get: () => ({ fetch: async () => Response.json({ customModelMap: {}, accounts: [], apiKeys: [] }) })
    }
  };

  // 1. Without Antigravity configured and without mapping, un-prefixed models return null
  assert.equal(await worker.resolveModelName('claude-sonnet-4-5-thinking', baseEnv), null);
  assert.equal(await worker.resolveModelName('gemini-3-flash', baseEnv), null);

  // 2. Explicit prefix antigravity: or @antigravity/ resolves directly
  assert.equal(
    await worker.resolveModelName('antigravity:claude-sonnet-4-5-thinking', baseEnv),
    'antigravity:claude-sonnet-4-5-thinking'
  );
  assert.equal(
    await worker.resolveModelName('@antigravity/gemini-3-flash', baseEnv),
    '@antigravity/gemini-3-flash'
  );

  // 3. With ANTIGRAVITY_REFRESH_TOKEN configured, standard Claude and Gemini models resolve
  const agEnv = {
    ...baseEnv,
    ANTIGRAVITY_REFRESH_TOKEN: 'mock-refresh-token'
  };
  assert.equal(await worker.hasAntigravityConfigured(agEnv), true);
  assert.equal(
    await worker.resolveModelName('claude-sonnet-4-5-thinking', agEnv),
    'antigravity:claude-sonnet-4-5-thinking'
  );
  assert.equal(
    await worker.resolveModelName('gemini-3-flash', agEnv),
    'antigravity:gemini-3-flash'
  );

  // 4. Model listings include Antigravity models when configured
  const models = await worker.getAntigravityModelList(agEnv, {});
  assert(models.some(m => m.id === 'claude-sonnet-4-5-thinking'));
  assert(models.some(m => m.id === 'gemini-3-flash'));
});

test('Tool schema sanitizer preserves supported constraints and rejects unsupported ones', async () => {
  const worker = await loadWorker(async () => {});

  const complexSchema = {
    $schema: 'http://json-schema.org/draft-07/schema#',
    title: 'TestTool',
    type: 'object',
    properties: {
      name: { type: 'string', description: 'User name' },
      mode: { const: 'fast' },
      metadata: {
        type: 'object',
        properties: {
          tag: { type: 'string' }
        }
      }
    },
    required: ['name']
  };

  const sanitized = worker.sanitizeToolSchema(complexSchema);
  assert.equal(sanitized.$schema, undefined);
  assert.equal(sanitized.type, 'object');
  assert.equal(sanitized.properties.name.type, 'string');
  assert.deepEqual(sanitized.properties.mode.enum, ['fast']);
  assert.equal(sanitized.properties.metadata.unsupportedKeyword, undefined);
  assert.equal(sanitized.properties.metadata.properties.tag.type, 'string');
  assert.throws(() => worker.sanitizeToolSchema({ anyOf: [{ type: 'string' }, { type: 'number' }] }), { status: 400 });
});

test('Anthropic request wraps correctly into Google Cloud Code agent format', async () => {
  const worker = await loadWorker(async () => {});

  const anthropicReq = {
    model: 'claude-sonnet-4-5-thinking',
    system: 'You are a test assistant.',
    messages: [
      { role: 'user', content: 'What is 2+2?' },
      { role: 'assistant', content: [{ type: 'text', text: '4' }] }
    ],
    max_tokens: 1024,
    temperature: 0.7
  };

  const { payload, actualModel } = await worker.buildAntigravityCloudCodeRequest(anthropicReq, 'test-project');
  assert.equal(actualModel, 'claude-sonnet-4-5-thinking');
  assert.equal(payload.project, 'test-project');
  assert.equal(payload.userAgent, 'antigravity');
  assert.equal(payload.requestType, 'agent');
  assert(payload.request.systemInstruction.parts.some(p => p.text.includes('You are a test assistant.')));
  assert.equal(payload.request.contents.length, 2);
  assert.equal(payload.request.contents[0].role, 'user');
  assert.equal(payload.request.contents[0].parts[0].text, 'What is 2+2?');
  assert.equal(payload.request.contents[1].role, 'model');
  assert.equal(payload.request.contents[1].parts[0].text, '4');
  assert.equal(payload.request.generationConfig.maxOutputTokens, 1024);
  assert.equal(payload.request.generationConfig.temperature, 0.7);
});

test('OpenAI chat completions request converts accurately to Anthropic request', async () => {
  const worker = await loadWorker(async () => {});

  const openaiReq = {
    model: 'claude-sonnet-4-5-thinking',
    messages: [
      { role: 'system', content: 'System instruction' },
      { role: 'user', content: 'Search weather' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: 'call_123',
          type: 'function',
          function: { name: 'get_weather', arguments: '{"city":"Tokyo"}' }
        }]
      },
      { role: 'tool', tool_call_id: 'call_123', content: 'Sunny 22C' }
    ],
    max_tokens: 2048,
    tools: [{
      type: 'function',
      function: {
        name: 'get_weather',
        description: 'Get weather by city',
        parameters: { type: 'object', properties: { city: { type: 'string' } } }
      }
    }]
  };

  const anthropic = worker.convertOpenAIReqToAnthropic(openaiReq);
  assert.equal(anthropic.model, 'claude-sonnet-4-5-thinking');
  assert.deepEqual(anthropic.system, [{ type: 'text', text: 'System instruction' }]);
  assert.equal(anthropic.max_tokens, 2048);
  assert.equal(anthropic.tools.length, 1);
  assert.equal(anthropic.tools[0].name, 'get_weather');

  // Verify tool call and tool result conversion
  const assistantMsg = anthropic.messages[1];
  assert.equal(assistantMsg.role, 'assistant');
  assert.equal(assistantMsg.content[0].type, 'tool_use');
  assert.equal(assistantMsg.content[0].id, 'call_123');
  assert.deepEqual(assistantMsg.content[0].input, { city: 'Tokyo' });

  const toolResultMsg = anthropic.messages[2];
  assert.equal(toolResultMsg.role, 'user');
  assert.equal(toolResultMsg.content[0].type, 'tool_result');
  assert.equal(toolResultMsg.content[0].tool_use_id, 'call_123');
  assert.deepEqual(toolResultMsg.content[0].content, [{ type: 'text', text: 'Sunny 22C' }]);
});

test('Google response converts to Anthropic JSON with thinking blocks and tool use', async () => {
  const worker = await loadWorker(async () => {});

  const googleData = {
    candidates: [{
      content: {
        parts: [
          { text: 'Thinking about the weather...', thought: true, thoughtSignature: 'sig12345678901234567890' },
          { text: 'Checking city temperature.' },
          { functionCall: { id: 'call_abc', name: 'check_temp', args: { city: 'London' } }, thoughtSignature: 'tool_sig12345' }
        ]
      },
      finishReason: 'STOP'
    }],
    usageMetadata: {
      promptTokenCount: 50,
      candidatesTokenCount: 30,
      cachedContentTokenCount: 10
    }
  };

  const anthropic = worker.parseGoogleResponseToAnthropic(googleData, 'claude-sonnet-4-5-thinking');
  assert.equal(anthropic.type, 'message');
  assert.equal(anthropic.role, 'assistant');
  assert.equal(anthropic.model, 'claude-sonnet-4-5-thinking');
  assert.equal(anthropic.content.length, 3);
  assert.equal(anthropic.content[0].type, 'thinking');
  assert.equal(anthropic.content[0].thinking, 'Thinking about the weather...');
  assert.equal(anthropic.content[1].type, 'text');
  assert.equal(anthropic.content[1].text, 'Checking city temperature.');
  assert.equal(anthropic.content[2].type, 'tool_use');
  assert.equal(anthropic.content[2].id, 'call_abc');
  assert.equal(anthropic.stop_reason, 'tool_use');
  assert.equal(anthropic.usage.input_tokens, 40);
  assert.equal(anthropic.usage.output_tokens, 30);
  assert.equal(anthropic.usage.cache_read_input_tokens, 10);
});

test('Google Cloud Code SSE converts to Anthropic SSE event stream', async () => {
  const worker = await loadWorker(async () => {});
  const encoder = new TextEncoder();

  const frames = [
    'data: {"response":{"candidates":[{"content":{"parts":[{"thought":true,"text":"Thinking step 1"}]}}],"usageMetadata":{"promptTokenCount":20,"candidatesTokenCount":5}}}\n\n',
    'data: {"response":{"candidates":[{"content":{"parts":[{"text":"Final answer"}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":20,"candidatesTokenCount":15}}}\n\n'
  ];

  let frameIdx = 0;
  const upstream = new ReadableStream({
    pull(controller) {
      if (frameIdx < frames.length) {
        controller.enqueue(encoder.encode(frames[frameIdx++]));
      } else {
        controller.close();
      }
    }
  });

  const stream = worker.antigravityToAnthropicStream(upstream, 'claude-sonnet-4-5-thinking');
  const text = await new Response(stream).text();
  const events = text.split('\n\n')
    .filter(chunk => chunk.startsWith('event: '))
    .map(chunk => {
      const lines = chunk.split('\n');
      const type = lines[0].slice(7);
      const data = JSON.parse(lines[1].slice(6));
      return { type, data };
    });

  assert.equal(events[0].type, 'message_start');
  assert.equal(events[1].type, 'content_block_start');
  assert.equal(events[1].data.content_block.type, 'thinking');
  assert.equal(events[2].type, 'content_block_delta');
  assert.equal(events[2].data.delta.thinking, 'Thinking step 1');
  assert.equal(events[3].type, 'content_block_stop');
  assert.equal(events[4].type, 'content_block_start');
  assert.equal(events[4].data.content_block.type, 'text');
  assert.equal(events[5].type, 'content_block_delta');
  assert.equal(events[5].data.delta.text, 'Final answer');
  assert.equal(events[6].type, 'content_block_stop');
  assert.equal(events[7].type, 'message_delta');
  assert.equal(events[8].type, 'message_stop');
});

test('Google Cloud Code SSE converts to OpenAI SSE chunk stream', async () => {
  const worker = await loadWorker(async () => {});
  const encoder = new TextEncoder();

  const frames = [
    'data: {"response":{"candidates":[{"content":{"parts":[{"text":"Hello from Antigravity!"}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":10,"candidatesTokenCount":8}}}\n\n'
  ];

  let frameIdx = 0;
  const upstream = new ReadableStream({
    pull(controller) {
      if (frameIdx < frames.length) {
        controller.enqueue(encoder.encode(frames[frameIdx++]));
      } else {
        controller.close();
      }
    }
  });

  const stream = worker.antigravityToOpenAIStream(upstream, 'claude-sonnet-4-5-thinking');
  const text = await new Response(stream).text();
  const chunks = text.split('\n\n')
    .filter(chunk => chunk.startsWith('data: ') && !chunk.includes('[DONE]'))
    .map(chunk => JSON.parse(chunk.slice(6)));

  assert(chunks.length >= 2);
  assert.equal(chunks[0].choices[0].delta.role, 'assistant');
  assert.equal(chunks[1].choices[0].delta.content, 'Hello from Antigravity!');
  assert(text.includes('data: [DONE]'));
});

test('Requests fail with 503 if Antigravity model requested but no accounts configured', async () => {
  const worker = await loadWorker(async () => {});
  const env = {
    ADMIN_PASSWORD: 'admin',
    KV: {},
    CONFIG_STORE: {
      idFromName: () => 'app-config-v1',
      get: () => ({ fetch: async () => Response.json({ customModelMap: {}, accounts: [], apiKeys: [{ key: 'test-key' }] }) })
    }
  };

  // 1. Anthropic endpoint /v1/messages
  const msgReq = new Request('https://worker.test/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': 'test-key'
    },
    body: JSON.stringify({
      model: 'antigravity:claude-sonnet-4-5-thinking',
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 100
    })
  });
  const msgResp = await worker.handleV1Proxy(msgReq, env, {});
  assert.equal(msgResp.status, 503);
  const msgJson = await msgResp.json();
  assert.equal(msgJson.type, 'error');
  assert(msgJson.error.message.includes('No Antigravity accounts configured'));

  // 2. OpenAI endpoint /v1/chat/completions
  const chatReq = new Request('https://worker.test/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'authorization': 'Bearer test-key'
    },
    body: JSON.stringify({
      model: 'antigravity:claude-sonnet-4-5-thinking',
      messages: [{ role: 'user', content: 'hi' }]
    })
  });
  const chatResp = await worker.handleV1Proxy(chatReq, env, {});
  assert.equal(chatResp.status, 503);
  const chatJson = await chatResp.json();
  assert(chatJson.error.message.includes('No Antigravity accounts configured'));
});
