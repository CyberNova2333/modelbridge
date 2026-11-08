// Runs only inside the opt-in verifier's isolated Linux container.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import https from 'node:https';
import { checkServerIdentity, connect as connectTls } from 'node:tls';
import { promisify } from 'node:util';
import { createRemoteState } from '/app/src/state/remote.mjs';

const exec = promisify(execFile);
const endpoint = 'https://state.modelbridge.test/_modelbridge/state';
const origin = 'https://gateway.modelbridge.test';
const token = (await readFile('/verification/token', 'utf8')).trim();
const checks = [];
const alpn = {};
let stage = 'TLS trust';
try {
  // Do not allow the caller's environment to disable normal certificate checks.
  assert.notEqual(process.env.NODE_TLS_REJECT_UNAUTHORIZED, '0');
  await exec(process.execPath, ['--input-type=module', '-e', `
    try { await fetch(${JSON.stringify(endpoint)}, { method: 'POST' }); process.exit(1); }
    catch (error) { if (!/CERT|ISSUER|SELF_SIGNED/.test(error.cause?.code || '')) process.exit(2); }
  `], { timeout: 15000, env: { ...process.env, NODE_EXTRA_CA_CERTS: '', NODE_TLS_REJECT_UNAUTHORIZED: '1' } });
  checks.push('untrusted_ca_rejected');

  // The connection and presented chain are real. Deliberately asking the
  // standard verifier for another hostname must fail before any HTTP payload.
  const ca = await readFile('/verification/root.crt');
  await assert.rejects(new Promise((resolve, reject) => {
    const request = https.get(endpoint, {
      ca, checkServerIdentity: (_hostname, cert) => checkServerIdentity('wrong.modelbridge.test', cert),
    }, response => { response.resume(); resolve(); });
    request.setTimeout(10000, () => request.destroy(new Error('TLS test timed out.')));
    request.once('error', reject);
  }), { code: 'ERR_TLS_CERT_ALTNAME_INVALID' });
  checks.push('hostname_mismatch_rejected');

  stage = 'TLS ALPN';
  const negotiate = protocols => new Promise((resolve, reject) => {
    const socket = connectTls({ host: 'state.modelbridge.test', port: 443,
      servername: 'state.modelbridge.test', ca, rejectUnauthorized: true, ALPNProtocols: protocols });
    const timer = setTimeout(() => socket.destroy(new Error('TLS ALPN test timed out.')), 10000);
    socket.once('secureConnect', () => { clearTimeout(timer); resolve(socket.alpnProtocol); socket.destroy(); });
    socket.once('error', error => { clearTimeout(timer); reject(error); });
  });
  alpn.mixedOffer = await negotiate(['h2', 'http/1.1']);
  stage = 'TLS ALPN mixed offer selected ' + (alpn.mixedOffer || 'none');
  assert.equal(alpn.mixedOffer, 'http/1.1');
  checks.push('alpn_mixed_offer_selects_http1');
  stage = 'TLS ALPN HTTP/2-only offer';
  try {
    const selected = await negotiate(['h2']);
    // Some TLS stacks permit a handshake with no ALPN agreement. They must
    // never select HTTP/2; subsequent traffic remains on the HTTP/1 listener.
    assert.equal(selected, false);
    alpn.h2Only = 'none';
  } catch (error) {
    assert.equal(error.code, 'ERR_SSL_TLSV1_ALERT_NO_APPLICATION_PROTOCOL');
    alpn.h2Only = 'rejected';
  }
  checks.push('alpn_http2_only_not_negotiated');

  stage = 'Authenticated HTTPS state operations';
  const remote = createRemoteState({ url: endpoint, token, origin });
  const request = (path, body) => remote.request(path, body === undefined ? {} : {
    method: 'POST', body: JSON.stringify(body),
  });
  const first = await request('/');
  assert.equal(first.status, 200);
  const config = await first.json();
  assert.deepEqual(config.accounts, []);
  assert.deepEqual(config.apiKeys, []);
  checks.push('trusted_https_empty_database');
  const mutation = await request('/', { type: 'key.add', key: {
    id: 'tls-fixture-key', name: 'TLS fixture', key: 'fixture-client-key', createdAt: new Date().toISOString(),
  } });
  assert.equal(mutation.status, 200); await mutation.arrayBuffer();
  const stored = await request('/');
  assert.equal((await stored.json()).apiKeys.length, 1);
  checks.push('authenticated_write_and_read');

  const denied = await createRemoteState({ url: endpoint, token: 'invalid-fixture-service-token-00000000', origin }).request('/');
  assert.equal(denied.status, 401);
  assert.doesNotMatch(await denied.text(), /fixture-client-key|accounts/);
  checks.push('invalid_token_rejected');
  const outside = await createRemoteState({ url: endpoint, token, origin: 'https://unlisted.modelbridge.test' }).request('/');
  assert.equal(outside.status, 400); await outside.arrayBuffer();
  checks.push('unlisted_origin_rejected');
  for (const path of ['/', '/admin', '/_modelbridge/state?unexpected=1']) {
    const response = await fetch(new URL(path, endpoint), { method: 'POST' });
    assert.equal(response.status, 404); await response.arrayBuffer();
  }
  checks.push('proxy_and_service_route_restrictions');
  const removed = await request('/', { type: 'key.delete', id: 'tls-fixture-key' });
  assert.equal(removed.status, 200); await removed.arrayBuffer();
  assert.deepEqual((await (await request('/')).json()).apiKeys, []);
  checks.push('revocation_persisted_over_https');
  console.log(JSON.stringify({ checks, passed: checks.length, alpn }));
} catch {
  console.error('TLS verification failed during ' + stage + '.');
  process.exitCode = 1;
}
