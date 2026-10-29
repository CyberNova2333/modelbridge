import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../_worker.js', import.meta.url), 'utf8');
const api = await import('data:text/javascript;base64,' + Buffer.from(source + '\nexport { sanitizeUpstreamErrorStream };').toString('base64'));
const credential = 'synthetic-上游/token+value=?';
const account = { apiToken: credential };
const encoded = encodeURIComponent(credential);
const encoder = new TextEncoder();

function fragmented(wire, { keepOpen = false } = {}) {
  const bytes = encoder.encode(wire);
  let offset = 0, cancelled = false;
  return {
    stream: new ReadableStream({
      pull(controller) {
        if (offset < bytes.length) controller.enqueue(bytes.subarray(offset, ++offset));
        else if (!keepOpen) controller.close();
      },
      cancel() { cancelled = true; },
    }),
    get cancelled() { return cancelled; },
  };
}

async function sanitize(wire, options = {}) {
  return new Response(api.sanitizeUpstreamErrorStream(fragmented(wire).stream, account, options)).text();
}

test('SSE comments and transport fields redact raw and encoded credentials through fragmented UTF-8, CRLF and EOF', async () => {
  for (const newline of ['\n', '\r\n', '\r']) for (const ending of ['', newline + newline]) {
    const lines = [': credential ' + credential, 'id: ' + encoded, 'event: diagnostic-' + credential,
      'unknown: key=' + encoded, ': heartbeat'];
    const wire = lines.join(newline) + ending;
    const expected = wire.split(credential).join('[redacted]').split(encoded).join('[redacted]');
    for (const openAI of [false, true]) assert.equal(await sanitize(wire, { openAI }), expected);
  }
});

test('metadata redaction never changes valid generated text, signed content or multiline JSON data', async () => {
  const payloads = [
    { type: 'content_block_delta', delta: { type: 'text_delta', text: credential + encoded } },
    { type: 'content_block_delta', delta: { type: 'signature_delta', signature: credential } },
    { candidates: [{ content: { parts: [{ text: credential, thoughtSignature: encoded }] } }] },
  ];
  for (const payload of payloads) {
    const data = 'data: ' + JSON.stringify(payload, null, 1).split('\n').join('\r\ndata: ');
    const metadata = ': key=' + credential + '\r\nid: ' + encoded;
    const wire = metadata + '\r\n' + data + '\r\n\r\n';
    assert.equal(await sanitize(wire), ': key=[redacted]\r\nid: [redacted]\r\n' + data + '\r\n\r\n');
  }
});

test('OpenAI envelope sanitizing redacts metadata while preserving ordinary completion bytes and DONE markers', async () => {
  const payload = { choices: [{ index: 0, delta: { content: credential + encoded }, finish_reason: 'stop' }] };
  const output = await sanitize(': ' + credential + '\r\nid: ' + encoded + '\r\ndata: ' + JSON.stringify(payload)
    + '\r\n\r\n: ' + encoded + '\r\ndata: [DONE]\r\n\r\n', { openAI: true });
  assert.ok(output.includes(': [redacted]\nid: [redacted]'));
  const data = output.split(/\r?\n/).filter(line => line.startsWith('data: '));
  assert.equal(JSON.parse(data[0].slice(6)).choices[0].delta.content, credential + encoded);
  assert.equal(data[1], 'data: [DONE]');
  assert.equal(output.includes(': ' + credential), false);
});

test('malformed non-JSON SSE data becomes a terminal generic error without reflecting credentials', async () => {
  for (const openAI of [false, true]) for (const ending of ['', '\r\n\r\n']) {
    const raw = ': header ' + credential + '\r\ndata: rejected Authorization Bearer ' + credential + ' ' + encoded;
    const upstream = fragmented(raw + ending + (ending ? 'data: {"message":"MUST_NOT_PASS"}\r\n\r\n' : ''), { keepOpen: !!ending });
    const output = await new Response(api.sanitizeUpstreamErrorStream(upstream.stream, account, { openAI })).text();
    assert.ok(output.startsWith('event: error\ndata: '));
    for (const value of [credential, encoded, 'MUST_NOT_PASS', 'rejected Authorization', '[DONE]']) assert.equal(output.includes(value), false);
    const event = JSON.parse(output.split('\n').find(line => line.startsWith('data: ')).slice(6));
    assert.equal(event.type, 'error');
    if (ending) assert.equal(upstream.cancelled, true);
  }
});

test('recognized error frames redact nested details and stop before following text', async () => {
  const error = { success: false, message: credential, error: { message: credential, details: { [credential]: encoded } } };
  const wire = 'event: error\r\n: ' + credential + '\r\ndata: ' + JSON.stringify(error)
    + '\r\n\r\ndata: {"choices":[{"delta":{"content":"MUST_NOT_PASS"}}]}\r\n\r\n';
  const output = await sanitize(wire);
  assert.ok(output.includes('[redacted]'));
  for (const value of [credential, encoded, 'MUST_NOT_PASS']) assert.equal(output.includes(value), false);
});
