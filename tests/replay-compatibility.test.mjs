import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../_worker.js', import.meta.url), 'utf8');
const api = await import('data:text/javascript;base64,' + Buffer.from(
  'const network = { run: null }; const fetch = async (...args) => network.run(...args);\n' + source +
  '\nexport function mockFetch(fn) { network.run = fn; }'
).toString('base64'));
const config = {
  accounts: [{ id: 'gemini', provider: 'gemini', apiToken: 'synthetic-upstream-token',
    baseUrl: 'https://gemini.invalid/v1beta', status: 'active', models: ['fixture'] }],
  apiKeys: [{ key: 'synthetic-client-key' }], customModelMap: { alias: 'gemini:fixture' },
};
const env = { ADMIN_PASSWORD: 'synthetic-admin', KV: {}, CONFIG_STORE: {
  idFromName: name => name, get: () => ({ fetch: async () => Response.json(config) }),
} };
const request = (path, body) => api.default.fetch(new Request('https://gateway.invalid' + path, {
  method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer synthetic-client-key' },
  body: JSON.stringify(body),
}), env, {});
const nativeResponse = parts => ({ candidates: [{ index: 0, content: { role: 'model', parts }, finishReason: 'STOP' }] });
const initial = { model: 'alias', messages: [{ role: 'user', content: 'Show the image.' }] };
const imageParts = [
  { text: 'Before 图片' },
  { inlineData: { mimeType: 'image/png', data: 'iVBORw0KGgo=' }, thoughtSignature: 'opaque-image-signature' },
  { text: 'After 图片' },
];
const visibleImage = [
  { type: 'text', text: 'Before 图片' },
  { type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw0KGgo=' } },
  { type: 'text', text: 'After 图片' },
];

test('signed snake_case Gemini tool history reaches the native upstream with its calls and results intact', async () => {
  let wire;
  api.mockFetch(async (_url, init) => {
    wire = JSON.parse(init.body);
    return Response.json(nativeResponse([{ text: 'OK' }]));
  });
  const response = await request('/v1beta/models/alias:generateContent', { contents: [
    { role: 'user', parts: [{ text: 'Look up both paths.' }] },
    { role: 'model', parts: [
      { text: 'Check both.', thought: true, thoughtSignature: 'opaque-thought-signature' },
      { function_call: { id: 'a', name: 'lookup', args: { path: 'a' } }, thoughtSignature: 'opaque-call-signature' },
      { function_call: { id: 'b', name: 'lookup', args: { path: 'b' } } },
    ] },
    { role: 'user', parts: [
      { function_response: { id: 'a', name: 'lookup', response: { result: 'first' } } },
      { function_response: { id: 'b', name: 'lookup', response: { result: 'second' } } },
    ] },
  ] });
  assert.equal(response.status, 200, await response.clone().text());
  const history = wire.contents.find(content => content.role === 'model').parts;
  assert.deepEqual(history[0], { text: 'Check both.', thought: true, thoughtSignature: 'opaque-thought-signature' });
  assert.deepEqual(history.slice(1).map(part => part.functionCall || part.function_call), [
    { id: 'a', name: 'lookup', args: { path: 'a' } }, { id: 'b', name: 'lookup', args: { path: 'b' } },
  ]);
  assert.equal(history[1].thoughtSignature, 'opaque-call-signature');
  assert.equal(history[2].thoughtSignature, undefined);
  const results = wire.contents.flatMap(content => content.parts)
    .map(part => part.functionResponse || part.function_response).filter(Boolean);
  assert.deepEqual(results, [
    { id: 'a', name: 'lookup', response: { result: 'first' } },
    { id: 'b', name: 'lookup', response: { result: 'second' } },
  ]);
});

test('Gemini image JSON output is visible and can be replayed without losing its signed media', async () => {
  const sent = [];
  api.mockFetch(async (_url, init) => {
    sent.push(JSON.parse(init.body));
    return Response.json(nativeResponse(imageParts));
  });
  const response = await request('/v1/chat/completions', initial);
  assert.equal(response.status, 200, await response.clone().text());
  const message = (await response.json()).choices[0].message;
  assert.deepEqual(message.content, visibleImage);
  assert.deepEqual(message.gemini_parts, imageParts);
  const replay = await request('/v1/chat/completions', { ...initial, messages: [...initial.messages, message] });
  assert.equal(replay.status, 200, await replay.clone().text());
  assert.deepEqual(sent[1].contents.find(content => content.role === 'model').parts, imageParts);

  const forged = structuredClone(message);
  forged.content[1].image_url.url = 'data:image/png;base64,different';
  const rejected = await request('/v1/chat/completions', { ...initial, messages: [...initial.messages, forged] });
  assert.equal(rejected.status, 400);
  assert.equal(sent.length, 2, 'mismatched hidden media must not reach the upstream');
});

test('Gemini image SSE exposes the same visible media and signed history as JSON output', async () => {
  api.mockFetch(async () => new Response('data: ' + JSON.stringify(nativeResponse(imageParts)) + '\n\n', {
    headers: { 'content-type': 'text/event-stream' },
  }));
  const response = await request('/v1/chat/completions', { ...initial, stream: true });
  assert.equal(response.status, 200);
  const frames = (await response.text()).split('\n')
    .filter(line => line.startsWith('data: ') && line !== 'data: [DONE]').map(line => JSON.parse(line.slice(6)));
  const deltas = frames.flatMap(frame => frame.choices || []).map(choice => choice.delta).filter(Boolean);
  assert.equal(frames.some(frame => frame.error), false);
  const content = deltas.flatMap(delta => delta.content || []);
  const parts = deltas.flatMap(delta => delta.gemini_parts || []);
  assert.deepEqual(content, visibleImage);
  assert.deepEqual(parts, imageParts);

  let wire;
  api.mockFetch(async (_url, init) => {
    wire = JSON.parse(init.body);
    return Response.json(nativeResponse([{ text: 'OK' }]));
  });
  const replay = await request('/v1/chat/completions', { ...initial, messages: [...initial.messages,
    { role: 'assistant', content, gemini_parts: parts },
  ] });
  assert.equal(replay.status, 200, await replay.clone().text());
  assert.deepEqual(wire.contents.find(item => item.role === 'model').parts, imageParts);
});
