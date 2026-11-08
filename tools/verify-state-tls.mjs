import { execFile } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { lstat, mkdtemp, readFile, realpath, rmdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';

const exec = promisify(execFile);
const repo = fileURLToPath(new URL('../', import.meta.url));
const labelKey = 'io.modelbridge.verify-tls';

// This verifier uses only its newly created resources. It never installs a CA
// into the host trust store, publishes a port, or requests a public certificate.
export async function verifyStateTls({ stateImage, caddyImage = 'caddy:2' } = {}) {
  if (![stateImage, caddyImage].every(value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_./:@-]*$/.test(value))) {
    throw new Error('Pass a built state image using --state-image <image>.');
  }
  const id = randomUUID(), prefix = 'modelbridge-tls-' + id;
  const directory = await mkdtemp(join(tmpdir(), prefix + '-'));
  const temporaryRoot = await realpath(tmpdir());
  const resources = [], expectedFiles = new Set(['owner', 'token', 'Caddyfile', 'client.mjs', 'root.crt']);
  let stage = 'image inspection', result;
  const docker = async (args, timeout = 120000) => {
    const value = await exec('docker', args, { windowsHide: true, timeout, maxBuffer: 4 * 1024 * 1024 });
    return value.stdout.trim();
  };
  const inspect = async (type, name) => JSON.parse(await docker([type, 'inspect', name]))[0];
  const inspectForCleanup = async (type, name) => {
    try { return await inspect(type, name); }
    catch {
      // A failed create can mean either no resource or a lost acknowledgement.
      // An exact-name inventory distinguishes absence from daemon/inspect failure.
      const names = await docker([type, 'ls', ...(type === 'container' ? ['--all'] : []),
        '--format', type === 'container' ? '{{.Names}}' : '{{.Name}}']);
      if (names.split(/\r?\n/).includes(name)) throw new Error('Cannot inspect owned verification resource.');
      return null;
    }
  };
  const own = async (type, name) => {
    if (!name.startsWith(prefix + '-')) throw new Error('Verification resource name mismatch.');
    const metadata = await inspect(type, name);
    const labels = type === 'container' ? metadata.Config.Labels : metadata.Labels;
    if (labels?.[labelKey] !== id || metadata.Name !== (type === 'container' ? '/' + name : name)) throw new Error('Verification resource ownership mismatch.');
    return metadata;
  };
  const createResource = async (type, name, args) => {
    resources.push({ type, name });
    await docker([type, 'create', '--label', labelKey + '=' + id, ...args, name]);
  };
  const createContainer = async (name, args) => {
    resources.push({ type: 'container', name });
    await docker(['create', '--name', name, '--label', labelKey + '=' + id, ...args]);
  };
  try {
    await writeFile(join(directory, 'owner'), id, { flag: 'wx', mode: 0o600 });
    const stateMetadata = await inspect('image', stateImage);
    let caddyMetadata;
    try { caddyMetadata = await inspect('image', caddyImage); }
    catch { await docker(['pull', caddyImage], 300000); caddyMetadata = await inspect('image', caddyImage); }
    // Pin both containers to the inspected image IDs for this run.
    const stateId = stateMetadata.Id, caddyId = caddyMetadata.Id;
    const source = await readFile(join(repo, 'deploy', 'self-hosted-state', 'Caddyfile'), 'utf8');
    if (!source.includes('admin off') || !source.includes('{$STATE_DOMAIN} {')) throw new Error('Caddy template changed; inspect the verifier.');
    const configuration = source.replace('admin off', 'admin off\n    skip_install_trust')
      .replace('{$STATE_DOMAIN} {', '{$STATE_DOMAIN} {\n    tls internal');
    await writeFile(join(directory, 'Caddyfile'), configuration, { flag: 'wx' });
    await writeFile(join(directory, 'token'), randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 });
    await writeFile(join(directory, 'client.mjs'), await readFile(join(repo, 'tools', 'verification', 'state-tls-client.mjs')), { flag: 'wx' });

    const network = prefix + '-network', stateVolume = prefix + '-state-data', caVolume = prefix + '-ca-data';
    const fixtureVolume = prefix + '-fixtures', seed = prefix + '-seed';
    const state = prefix + '-state', caddy = prefix + '-caddy', client = prefix + '-client';
    stage = 'isolated resource creation';
    await createResource('network', network, ['--internal']);
    await createResource('volume', stateVolume, []);
    await createResource('volume', caVolume, []);
    await createResource('volume', fixtureVolume, []);
    // Synthetic credentials live in a new volume with known Linux ownership.
    // Host UID/Windows bind-mount permissions must not determine test success.
    await createContainer(seed, ['--network', 'none', '--read-only', '--user', '0:0',
      '--cap-drop', 'ALL', '--cap-add', 'CHOWN', '--security-opt', 'no-new-privileges',
      '--mount', `type=volume,source=${fixtureVolume},target=/verification`, '--entrypoint', 'node', stateId, '-e',
      "const fs=require('node:fs');fs.chmodSync('/verification',0o700);for(const name of fs.readdirSync('/verification')){if(!['token','client.mjs','root.crt'].includes(name))throw Error('Unexpected fixture');fs.chmodSync('/verification/'+name,0o600);fs.chownSync('/verification/'+name,1000,1000)}fs.chownSync('/verification',1000,1000);",
    ]);
    for (const name of ['token', 'client.mjs']) await docker(['cp', join(directory, name), seed + ':/verification/' + name]);
    await docker(['start', '--attach', seed]);
    if ((await own('container', seed)).State.ExitCode !== 0) throw new Error('Could not prepare private fixtures.');
    await createContainer(state, [
      '--network', network, '--network-alias', 'state', '--read-only', '--user', '1000:1000',
      '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
      '--mount', `type=volume,source=${stateVolume},target=/data`,
      '--mount', `type=volume,source=${fixtureVolume},target=/verification,readonly`,
      '--env', 'HOST=0.0.0.0', '--env', 'PORT=8788', '--env', 'DB_PATH=/data/modelbridge.sqlite',
      '--env', 'MODELBRIDGE_STATE_PUBLIC_ORIGIN=https://state.modelbridge.test',
      '--env', 'MODELBRIDGE_STATE_ORIGINS=https://gateway.modelbridge.test',
      '--env', 'MODELBRIDGE_STATE_TOKEN_FILE=/verification/token', stateId,
    ]);
    await docker(['start', state]);
    stage = 'state service startup';
    for (let attempt = 0; ; attempt++) {
      try {
        await docker(['exec', state, 'node', '--input-type=module', '-e',
          "const r=await fetch('http://127.0.0.1:8788/_modelbridge/state',{method:'POST'});await r.arrayBuffer();if(r.status!==401)process.exit(1);"], 5000);
        break;
      } catch { if (attempt === 20) throw new Error('State container did not become ready.'); await delay(250); }
    }
    await createContainer(caddy, [
      '--network', network, '--network-alias', 'state.modelbridge.test', '--read-only',
      '--cap-drop', 'ALL', '--cap-add', 'NET_BIND_SERVICE', '--security-opt', 'no-new-privileges',
      '--tmpfs', '/config:rw,nosuid,nodev,mode=700', '--mount', `type=volume,source=${caVolume},target=/data`,
      '--mount', `type=bind,source=${join(directory, 'Caddyfile')},target=/etc/caddy/Caddyfile,readonly`,
      '--env', 'STATE_DOMAIN=state.modelbridge.test', caddyId,
    ]);
    stage = 'Caddy configuration and local certificate';
    await docker(['start', caddy]);
    for (let attempt = 0; ; attempt++) {
      try { await docker(['exec', caddy, 'test', '-r', '/data/caddy/pki/authorities/local/root.crt'], 5000); break; }
      catch { if (attempt === 40) throw new Error('Local CA certificate was not generated.'); await delay(250); }
    }
    await own('container', caddy);
    await docker(['cp', caddy + ':/data/caddy/pki/authorities/local/root.crt', join(directory, 'root.crt')]);
    if (!(await readFile(join(directory, 'root.crt'), 'utf8')).includes('BEGIN CERTIFICATE')) throw new Error('No public CA certificate.');
    await docker(['cp', join(directory, 'root.crt'), seed + ':/verification/root.crt']);
    // The fixture directory belongs to uid 1000. The copied CA certificate is
    // public, but explicitly verify the unprivileged client can read it.
    await docker(['exec', state, 'node', '-e', "require('node:fs').accessSync('/verification/root.crt',4)"]);
    await createContainer(client, [
      '--network', network, '--read-only', '--user', '1000:1000', '--cap-drop', 'ALL',
      '--security-opt', 'no-new-privileges', '--mount', `type=volume,source=${fixtureVolume},target=/verification,readonly`,
      '--env', 'NODE_EXTRA_CA_CERTS=/verification/root.crt', '--env', 'NODE_TLS_REJECT_UNAUTHORIZED=1',
      '--entrypoint', 'node', stateId, '/verification/client.mjs',
    ]);
    stage = 'HTTPS client assertions';
    const output = await docker(['start', '--attach', client], 60000);
    const clientMetadata = await own('container', client);
    if (clientMetadata.State.ExitCode !== 0) throw new Error('TLS client verification failed.');
    const evidence = JSON.parse(output);
    const requiredChecks = ['untrusted_ca_rejected', 'hostname_mismatch_rejected',
      'alpn_mixed_offer_selects_http1', 'alpn_http2_only_not_negotiated',
      'trusted_https_empty_database', 'authenticated_write_and_read', 'invalid_token_rejected',
      'unlisted_origin_rejected', 'proxy_and_service_route_restrictions', 'revocation_persisted_over_https'];
    if (evidence.passed !== requiredChecks.length || !Array.isArray(evidence.checks)
        || requiredChecks.some(check => !evidence.checks.includes(check))) throw new Error('TLS checks were incomplete.');
    result = { ...evidence, stateImage: stateId, caddyImage: caddyId, scope: 'isolated Docker network; internal CA; no public TLS or cloud deployment' };
  } catch {
    throw new Error('State TLS verification failed during ' + stage + '.');
  } finally {
    const failures = [];
    for (const { type, name } of resources.reverse()) {
      try {
        if (!await inspectForCleanup(type, name)) continue;
        await own(type, name);
        await docker([type, 'rm', ...(type === 'container' ? ['--force'] : []), name]);
      }
      catch { failures.push(name); }
    }
    try {
      if (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith(prefix + '-')
          || (await lstat(directory)).isSymbolicLink() || dirname(await realpath(directory)) !== temporaryRoot
          || await readFile(join(directory, 'owner'), 'utf8') !== id) throw new Error('Temporary directory ownership mismatch.');
      for (const name of expectedFiles) await unlink(join(directory, name)).catch(error => { if (error.code !== 'ENOENT') throw error; });
      await rmdir(directory);
    } catch { failures.push('owned temporary directory'); }
    if (failures.length) throw new Error('TLS verifier cleanup incomplete; inspect only these owned resources: ' + failures.join(', '));
  }
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 2 || args[0] !== '--state-image') throw new Error('Usage: node tools/verify-state-tls.mjs --state-image <built-state-image>');
    console.log(JSON.stringify(await verifyStateTls({ stateImage: args[1] }), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
