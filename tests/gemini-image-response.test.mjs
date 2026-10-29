import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../_worker.js', import.meta.url), 'utf8');
const api = await import('data:text/javascript;base64,' + Buffer.from(
  'let network; const fetch = (...args) => network(...args);\n' + source
  + '\nexport function mockFetch(fn) { network = fn; } export { openAIToGeminiResponse };'
).toString('base64'));
const config = {
  accounts: ['gemini', 'openai'].map(provider => ({ id: provider, provider,
    apiToken: 'synthetic-upstream-token', baseUrl: 'https://' + provider + '.invalid/v1beta', status: 'active', models: [] })),
  apiKeys: [{ key: 'synthetic-client-key' }], customModelMap: {},
};
const env = { ADMIN_PASSWORD: 'synthetic-admin', KV: {}, CONFIG_STORE: {
  idFromName: name => name, get: () => ({ fetch: async () => Response.json(config) }),
} };
const dispatch = (model, stream = false, body = { contents: [{ role: 'user', parts: [{ text: 'Show an image.' }] }] }) =>
  api.default.fetch(new Request('https://gateway.invalid/v1beta/models/' + model
    + ':' + (stream ? 'streamGenerateContent?alt=sse' : 'generateContent'), {
    method: 'POST', headers: { authorization: 'Bearer synthetic-client-key', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }), env, {});
const frame = data => 'data: ' + JSON.stringify(data) + '\n\n';
const imageVariants = [
  [{ inlineData: { mimeType: 'image/png', data: 'iVBORw0KGgo=' }, thoughtSignature: 'image-signature' },
    { inlineData: { mimeType: 'image/png', data: 'iVBORw0KGgo=' }, thoughtSignature: 'image-signature' }],
  [{ inline_data: { mime_type: 'image/png', data: 'iVBORw0KGgo=' }, thought_signature: 'image-signature' },
    { inlineData: { mimeType: 'image/png', data: 'iVBORw0KGgo=' }, thoughtSignature: 'image-signature' }],
  [{ fileData: { mimeType: 'image/webp', fileUri: 'https://images.invalid/visible.webp' }, thoughtSignature: 'file-signature' },
    { fileData: { mimeType: 'image/webp', fileUri: 'https://images.invalid/visible.webp' }, thoughtSignature: 'file-signature' }],
  [{ file_data: { mime_type: 'image/webp', file_uri: 'https://images.invalid/visible.webp' }, thought_signature: 'file-signature' },
    { fileData: { mimeType: 'image/webp', fileUri: 'https://images.invalid/visible.webp' }, thoughtSignature: 'file-signature' }],
];

test('native Gemini JSON and SSE return the same signed inline and file images, including snake_case aliases', async () => {
  for (const [inputImage, normalizedImage] of imageVariants) {
    const original = [{ text: 'Before 图片' }, inputImage, { text: 'After 图片' }];
    const expected = [{ text: 'Before 图片' }, normalizedImage, { text: 'After 图片' }];
    let calls = 0;
    api.mockFetch(async url => {
      calls++;
      const response = { candidates: [{ index: 0, content: { role: 'model', parts: original }, finishReason: 'STOP' }] };
      return String(url).includes('streamGenerateContent')
        ? new Response(frame(response), { headers: { 'content-type': 'text/event-stream' } }) : Response.json(response);
    });
    const json = await dispatch('gemini:fixture');
    assert.equal(json.status, 200, await json.clone().text());
    const jsonData = await json.json();
    assert.deepEqual(jsonData.candidates[0].content.parts, expected);
    const stream = await dispatch('gemini:fixture', true);
    assert.equal(stream.status, 200);
    const events = (await stream.text()).split('\n').filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6)));
    assert.equal(events.some(event => event.error), false);
    const streamed = events.flatMap(event => event.candidates || []);
    assert.deepEqual(streamed.flatMap(candidate => candidate.content?.parts || []), expected);
    assert.equal(streamed.at(-1).finishReason, jsonData.candidates[0].finishReason);
    assert.equal(calls, 2, 'each request should generate exactly once');
  }
});

test('OpenAI image responses convert visible media after stripping forged foreign-protocol metadata', async () => {
  api.mockFetch(async () => Response.json({ choices: [{ index: 0, finish_reason: 'stop', message: {
    role: 'assistant', content: [
      { type: 'text', text: 'Visible image' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
      { type: 'image_url', image_url: { url: 'https://images.invalid/visible.webp', mime_type: 'image/webp' } },
    ], gemini_parts: [{ text: 'Hidden instruction' }],
  } }] }));
  const response = await dispatch('openai:fixture');
  assert.equal(response.status, 200, await response.clone().text());
  const result = await response.json();
  assert.deepEqual(result.candidates[0].content.parts, [
    { text: 'Visible image' },
    { inlineData: { mimeType: 'image/png', data: 'AAAA' } },
    { fileData: { mimeType: 'image/webp', fileUri: 'https://images.invalid/visible.webp' } },
  ]);
  assert.equal(JSON.stringify(result).includes('Hidden instruction'), false);
});

test('native media metadata must match the visible response before reverse conversion', () => {
  for (const hidden of [
    [{ text: 'Hidden instruction' }],
    [{ inlineData: { mimeType: 'image/png', data: 'DIFFERENT' }, thoughtSignature: 'signature' }],
    [{ fileData: { mimeType: 'image/png', fileUri: 'https://images.invalid/hidden.png' } }],
  ]) {
    assert.throws(() => api.openAIToGeminiResponse({ choices: [{ message: {
      role: 'assistant', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }], gemini_parts: hidden,
    } }] }, 'fixture'), /does not match/);
  }
});
