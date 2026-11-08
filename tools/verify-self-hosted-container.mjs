// Opt-in Docker acceptance test. Uses only synthetic credentials, new labelled
// resources on a private Docker network. Never publishes a port or prunes.
import { execFile } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { lstat, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { buildPlatforms } from './build-platforms.mjs';

const execute = promisify(execFile);
const OWNER_LABEL = 'io.modelbridge.verify.run';
const SERVICE_PATH = '/_modelbridge/state';
const PUBLIC_ORIGIN = 'https://state.verify.invalid';
const GATEWAY_ORIGIN = 'https://gateway.verify.invalid';
const digest = text => createHash('sha256').update(text).digest('hex');
const check = (condition, code) => { if (!condition) throw Object.assign(new Error('Container verification failed.'), { code }); };

async function docker(args, timeout = 60000, input) {
  try {
    const pending = execute('docker', args, { timeout, maxBuffer: 8 * 1024 * 1024, windowsHide: true, encoding: 'utf8' });
    pending.child.stdin.on('error', () => {});
    pending.child.stdin.end(input);
    const result = await pending;
    return result.stdout.trim();
  } catch (error) {
    // Docker output, paths, arguments and HTTP payloads are deliberately omitted.
    throw Object.assign(new Error('Docker verification command failed.'), { code: error.killed ? 'DOCKER_TIMEOUT' : 'DOCKER_COMMAND' });
  }
}

async function inspect(kind, name) {
  const output = await docker([kind, 'inspect', name]);
  const values = JSON.parse(output);
  check(Array.isArray(values) && values.length === 1, 'INSPECT_RESULT');
  return values[0];
}

async function inspectIfPresent(kind, name) {
  try { return await inspect(kind, name); }
  catch {
    // Distinguish a missing object from an inaccessible daemon before claiming
    // cleanup. The exact-name inventory contains no credentials.
    const format = kind === 'container' ? '{{.Names}}' : kind === 'image' ? '{{.Repository}}:{{.Tag}}' : '{{.Name}}';
    const listing = await docker([kind, 'ls', ...(kind === 'container' ? ['--all'] : []), '--format', format]);
    if (listing.split(/\r?\n/).includes(name)) throw Object.assign(new Error('Resource inspection failed.'), { code: 'CLEANUP_INSPECT' });
    return null;
  }
}

async function removeOwned(kind, name, runId) {
  const resource = await inspectIfPresent(kind, name);
  if (!resource) return;
  const labels = kind === 'container' || kind === 'image' ? resource.Config?.Labels : resource.Labels;
  check(labels?.[OWNER_LABEL] === runId && name.startsWith(`modelbridge-verify-${runId}`), 'CLEANUP_OWNER');
  if (kind === 'container') {
    check(resource.Name === '/' + name, 'CLEANUP_NAME');
    await docker(['container', 'rm', '--force', name]);
  } else if (kind === 'image') {
    check(resource.RepoTags?.includes(name), 'CLEANUP_NAME');
    await docker(['image', 'rm', name]);
  } else {
    check(resource.Name === name, 'CLEANUP_NAME');
    await docker([kind, 'rm', name]);
  }
}

async function cleanupDirectory(directory, base, runId) {
  check(!(await lstat(directory)).isSymbolicLink(), 'CLEANUP_DIRECTORY_LINK');
  const actual = await realpath(directory), root = await realpath(base);
  const nested = relative(root, actual);
  check(nested && !isAbsolute(nested) && nested !== '..' && !nested.startsWith('..' + sep)
    && nested.startsWith(`modelbridge-verify-${runId}-`) && !nested.includes(sep), 'CLEANUP_DIRECTORY_SCOPE');
  check(await readFile(join(actual, 'owner.txt'), 'utf8') === runId, 'CLEANUP_DIRECTORY_OWNER');
  await rm(actual, { recursive: true, force: false });
}

/** Builds and tests the Docker template; does not deploy to any public endpoint. */
export async function verifySelfHostedContainer({ keepImage = false, progress = () => {} } = {}) {
  const runId = randomUUID().replaceAll('-', '').slice(0, 12);
  const prefix = `modelbridge-verify-${runId}`;
  const image = `${prefix}:state`, network = `${prefix}-network`;
  const sourceVolume = `${prefix}-source`, restoredVolume = `${prefix}-restored`;
  const secretVolume = `${prefix}-secret`;
  const sourceContainer = `${prefix}-source`, restoredContainer = `${prefix}-restored`, copyContainer = `${prefix}-copy`;
  const clientContainer = `${prefix}-client`, seedContainer = `${prefix}-seed`;
  const resources = { containers: [], volumes: [], networks: [], image: false };
  const base = await realpath(tmpdir());
  const directory = await mkdtemp(join(base, prefix + '-'));
  await writeFile(join(directory, 'owner.txt'), runId, { flag: 'wx', mode: 0o600 });
  const token = randomBytes(32).toString('hex');
  let stage = 'prepare', report, originalError;
  const completed = [];
  const begin = next => { stage = next; progress({ stage, runId, image }); };
  const done = name => completed.push(name);
  try {
    begin('docker-runtime');
    const daemon = JSON.parse(await docker(['version', '--format', '{{json .Server}}']));
    check(daemon.Os === 'linux', 'LINUX_DAEMON_REQUIRED');
    const artifact = await buildPlatforms({ outDir: join(directory, 'build') });
    const context = join(artifact.outDir, 'self-hosted-state');
    const sourceHash = digest(await readFile(join(context, '_worker.js')));
    begin('build-image');
    resources.image = true;
    await docker(['build', '--label', `${OWNER_LABEL}=${runId}`, '--tag', image, context], 600000);
    const imageInfo = await inspect('image', image);
    check(imageInfo.Config?.Labels?.[OWNER_LABEL] === runId, 'IMAGE_OWNER');
    check(imageInfo.Config?.User === 'node', 'IMAGE_NONROOT');
    done('Dockerfile builds with its default Node image');
    progress({ stage: 'image-ready', runId, image, imageId: imageInfo.Id });

    begin('create-isolated-resources');
    resources.networks.push(network);
    // Keep clients inside the task's private network. This also works where
    // Docker Desktop cannot forward Windows loopback ports to Linux containers.
    await docker(['network', 'create', '--internal', '--label', `${OWNER_LABEL}=${runId}`, network]);
    for (const volume of [sourceVolume, restoredVolume, secretVolume]) {
      resources.volumes.push(volume);
      await docker(['volume', 'create', '--label', `${OWNER_LABEL}=${runId}`, volume]);
    }
    begin('seed-private-secret');
    resources.containers.push(seedContainer);
    await docker(['run', '--rm', '--interactive', '--name', seedContainer, '--label', `${OWNER_LABEL}=${runId}`,
      '--network', 'none', '--user', '0:0', '--read-only', '--cap-drop', 'ALL', '--cap-add', 'CHOWN',
      '--security-opt', 'no-new-privileges:true', '--mount', `type=volume,source=${secretVolume},target=/secret`,
      '--entrypoint', 'node', image, '--input-type=module', '-e', `
        import { chmodSync, chownSync, writeFileSync } from 'node:fs';
        let token = ''; for await (const chunk of process.stdin) token += chunk;
        writeFileSync('/secret/state_token', token, { flag: 'wx', mode: 0o600 });
        chmodSync('/secret', 0o700); chownSync('/secret/state_token', 1000, 1000); chownSync('/secret', 1000, 1000);
      `], 60000, token + '\n');
    begin('private-client');
    resources.containers.push(clientContainer);
    await docker(['run', '--detach', '--name', clientContainer, '--label', `${OWNER_LABEL}=${runId}`,
      '--network', network, '--user', '1000:1000', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true',
      '--mount', `type=volume,source=${secretVolume},target=/run/secrets,readonly`, '--entrypoint', 'node', image,
      '--input-type=module', '-e', 'setInterval(() => {}, 1000);']);

    async function http(url, envelope, authenticated = true, timeoutMs = 15000) {
      const output = await docker(['exec', '--interactive', clientContainer, 'node', '--input-type=module', '-e', `
        import { readFileSync } from 'node:fs';
        let input = ''; for await (const chunk of process.stdin) input += chunk;
        const packet = JSON.parse(input);
        const headers = { 'Content-Type': 'application/json' };
        if (packet.authenticated) headers.Authorization = 'Bearer ' + readFileSync('/run/secrets/state_token', 'utf8').trim();
        const response = await fetch(packet.url, { method: 'POST', redirect: 'error', headers,
          body: JSON.stringify(packet.envelope), signal: AbortSignal.timeout(packet.timeoutMs) });
        console.log(JSON.stringify({ status: response.status, body: await response.json() }));
      `], timeoutMs + 10000, JSON.stringify({ url, envelope, authenticated, timeoutMs }));
      return JSON.parse(output);
    }

    async function startContainer(name, volume) {
      resources.containers.push(name);
      await docker(['run', '--detach', '--name', name, '--label', `${OWNER_LABEL}=${runId}`,
        '--network', network, '--init', '--user', '1000:1000',
        '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true',
        '--mount', `type=volume,source=${volume},target=/data`,
        '--mount', `type=volume,source=${secretVolume},target=/run/secrets,readonly`,
        '--env', `MODELBRIDGE_STATE_PUBLIC_ORIGIN=${PUBLIC_ORIGIN}`,
        '--env', `MODELBRIDGE_STATE_ORIGINS=${GATEWAY_ORIGIN}`,
        '--env', 'MODELBRIDGE_STATE_TOKEN_FILE=/run/secrets/state_token', image]);
      const info = await inspect('container', name);
      progress({ stage: 'container-started', runId, container: name, status: info.State?.Status, ports: info.NetworkSettings?.Ports || {} });
      check(info.State?.Running === true, 'CONTAINER_RUNNING');
      check(Object.keys(info.HostConfig.PortBindings || {}).length === 0, 'NO_PUBLISHED_PORTS');
      check(info.HostConfig.ReadonlyRootfs && info.Config.User === '1000:1000', 'CONTAINER_NONROOT_READONLY');
      check(info.Mounts.some(mount => mount.Destination === '/run/secrets' && mount.RW === false && mount.Name === secretVolume), 'SECRET_READONLY');
      check(info.Mounts.some(mount => mount.Destination === '/data' && mount.RW === true && mount.Name === volume), 'DATA_VOLUME');
      const url = `http://${name}:8788${SERVICE_PATH}`;
      const deadline = Date.now() + 60000;
      for (;;) {
        try {
          if ((await http(url, {}, false, 2000)).status === 401) return url;
        } catch { /* bounded startup polling */ }
        check(Date.now() < deadline, 'CONTAINER_STARTUP');
        await delay(200);
      }
    }

    async function rpc(url, path = '/', method = 'GET', body = null) {
      const response = await http(url, { path, method, body, origin: GATEWAY_ORIGIN });
      check(response.status === 200, 'RPC_STATUS');
      return response.body;
    }
    const addKey = id => ({ type: 'key.add', key: { id, name: 'Container fixture', key: 'fixture-' + id, createdAt: new Date().toISOString() } });
    const auth = { scope: digest('admin-origin-v3:' + GATEWAY_ORIGIN), fingerprint: digest('admin-session-v3:fixture-password') };
    const login = { ...auth, type: 'login', passwordMatched: true, ipKey: digest('admin-login:fixture-client') };

    begin('source-container');
    let sourceUrl = await startContainer(sourceContainer, sourceVolume);
    const initial = await rpc(sourceUrl);
    check(Array.isArray(initial.accounts) && initial.accounts.length === 0 && initial.apiKeys.length === 0, 'FRESH_CONFIGURATION');
    await rpc(sourceUrl, '/', 'POST', addKey('revoke-me'));
    const signedIn = await rpc(sourceUrl, '/auth', 'POST', login);
    check(signedIn.success && typeof signedIn.token === 'string', 'ADMIN_LOGIN');
    const verify = { ...auth, type: 'verify', token: signedIn.token, passwordMatched: false };
    check((await rpc(sourceUrl, '/auth', 'POST', verify)).valid === true, 'ADMIN_VERIFY');
    const permissions = JSON.parse(await docker(['exec', sourceContainer, 'node', '--input-type=module', '-e', `
      import { lstatSync, readdirSync, statSync, writeFileSync } from 'node:fs';
      import { DatabaseSync } from 'node:sqlite';
      const db = new DatabaseSync('/data/modelbridge.sqlite', { readOnly: true });
      const journal = db.prepare('PRAGMA journal_mode').get().journal_mode; db.close();
      let secretReadonly = false, rootReadonly = false;
      try { writeFileSync('/run/secrets/state_token', 'invalid', { flag: 'a' }); } catch (error) { secretReadonly = ['EROFS','EACCES','EPERM'].includes(error.code); }
      try { writeFileSync('/app/verify-write-probe', 'invalid', { flag: 'wx' }); } catch (error) { rootReadonly = ['EROFS','EACCES','EPERM'].includes(error.code); }
      const absent = path => { try { lstatSync(path); return false; } catch (error) { if (error.code === 'ENOENT') return true; throw error; } };
      const packageManagersAbsent = ['/usr/local/lib/node_modules/npm', '/usr/local/lib/node_modules/corepack',
        ...['npm', 'npx', 'corepack', 'yarn', 'yarnpkg', 'pnpm', 'pnpx'].map(name => '/usr/local/bin/' + name)].every(absent)
        && readdirSync('/opt').every(name => !name.startsWith('yarn-v'));
      const state = statSync('/data/modelbridge.sqlite');
      console.log(JSON.stringify({ uid: process.getuid(), gid: process.getgid(), mode: state.mode & 511, owner: state.uid, journal, secretReadonly, rootReadonly, packageManagersAbsent, node: process.version }));
    `]));
    check(permissions.uid === 1000 && permissions.gid === 1000 && permissions.owner === 1000
      && permissions.mode === 0o600 && permissions.journal === 'wal' && permissions.secretReadonly && permissions.rootReadonly, 'FILESYSTEM_PERMISSIONS');
    check(permissions.packageManagersAbsent, 'RUNTIME_PACKAGE_MANAGERS_ABSENT');
    done('nonroot UID 1000, private writable WAL volume, read-only root and secret, no bundled package managers');
    done('authenticated configuration and administrator session RPCs over real private-network HTTP with no published ports');

    async function restart(name) {
      await docker(['restart', '--time', '10', name]);
      const info = await inspect('container', name);
      check(Object.keys(info.HostConfig.PortBindings || {}).length === 0, 'NO_PUBLISHED_PORTS');
      const url = `http://${name}:8788${SERVICE_PATH}`;
      const deadline = Date.now() + 60000;
      while (Date.now() < deadline) {
        try { await rpc(url); return url; } catch { await delay(100); }
      }
      throw Object.assign(new Error('Container did not restart.'), { code: 'RESTART_TIMEOUT' });
    }

    begin('restart-and-revoke');
    sourceUrl = await restart(sourceContainer);
    check((await rpc(sourceUrl)).apiKeys.some(item => item.id === 'revoke-me'), 'PERSISTED_KEY');
    check((await rpc(sourceUrl, '/auth', 'POST', verify)).valid === true, 'PERSISTED_SESSION');
    await rpc(sourceUrl, '/', 'POST', { type: 'key.delete', id: 'revoke-me' });
    await rpc(sourceUrl, '/auth', 'POST', { ...verify, type: 'logout' });
    await rpc(sourceUrl, '/', 'POST', addKey('snapshot-key'));
    await rpc(sourceUrl, '/', 'POST', { type: 'models.replace', map: { snapshot: 'openai:fixture-snapshot' } });
    sourceUrl = await restart(sourceContainer);
    const beforeBackup = await rpc(sourceUrl);
    check(!beforeBackup.apiKeys.some(item => item.id === 'revoke-me'), 'REVOKED_KEY_PERSISTED');
    check((await rpc(sourceUrl, '/auth', 'POST', verify)).valid === false, 'REVOKED_SESSION_PERSISTED');
    done('container restarts preserve configuration, session state and subsequent revocation');

    begin('online-backup');
    await docker(['exec', sourceContainer, 'node', 'tools/state-admin.mjs', 'backup', '--db', '/data/modelbridge.sqlite', '--out', '/data/verified-backup.sqlite']);
    check((await rpc(sourceUrl)).apiKeys.some(item => item.id === 'snapshot-key'), 'SOURCE_LIVE_AFTER_BACKUP');
    await rpc(sourceUrl, '/', 'POST', addKey('after-backup'));
    await rpc(sourceUrl, '/', 'POST', { type: 'models.replace', map: { newer: 'openai:fixture-newer' } });
    done('online SQLite backup succeeds while the original state service remains available');

    begin('restore-separate-volume');
    resources.containers.push(copyContainer);
    await docker(['run', '--rm', '--name', copyContainer, '--label', `${OWNER_LABEL}=${runId}`,
      '--network', 'none', '--user', '1000:1000', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true',
      '--mount', `type=volume,source=${sourceVolume},target=/source,readonly`,
      '--mount', `type=volume,source=${restoredVolume},target=/data`, '--entrypoint', 'node', image,
      '--input-type=module', '-e', `import { copyFileSync, constants, chmodSync } from 'node:fs'; copyFileSync('/source/verified-backup.sqlite', '/data/modelbridge.sqlite', constants.COPYFILE_EXCL); chmodSync('/data/modelbridge.sqlite', 0o600);`]);
    const restoredUrl = await startContainer(restoredContainer, restoredVolume);
    const restored = await rpc(restoredUrl);
    check(JSON.stringify(restored) === JSON.stringify(beforeBackup), 'BACKUP_POINT_IN_TIME');
    check(!restored.apiKeys.some(item => item.id === 'revoke-me' || item.id === 'after-backup'), 'RESTORED_KEYS');
    check((await rpc(restoredUrl, '/auth', 'POST', verify)).valid === false, 'RESTORED_SESSION_REVOCATION');
    check((await rpc(sourceUrl)).apiKeys.some(item => item.id === 'after-backup'), 'SOURCE_UNCHANGED_BY_RESTORE');
    done('a fresh volume restores the exact backup point without changing the source or resurrecting pre-backup revocations');

    report = { ok: true, runId, image, imageId: imageInfo.Id, workerSha256: sourceHash,
      dockerVersion: daemon.Version, nodeVersion: permissions.node, tests: completed, imageRetained: keepImage,
      scope: 'Synthetic credentials; private Docker HTTP only with no host ports. TLS and public/cloud-provider deployments are separate checks.' };
  } catch (error) {
    originalError = { stage, code: typeof error.code === 'string' ? error.code : 'VERIFICATION_FAILED' };
  } finally {
    const failures = [];
    for (const [kind, names] of [['container', resources.containers], ['volume', resources.volumes], ['network', resources.networks]]) {
      for (const name of [...names].reverse()) {
        try { await removeOwned(kind, name, runId); }
        catch { failures.push({ kind, name }); }
      }
    }
    if (resources.image && !keepImage) {
      try { await removeOwned('image', image, runId); } catch { failures.push({ kind: 'image', name: image }); }
    }
    try { await cleanupDirectory(directory, base, runId); }
    catch { failures.push({ kind: 'temporary-directory', name: prefix }); }
    if (failures.length) originalError = { ...(originalError || { stage: 'cleanup', code: 'CLEANUP_FAILED' }), cleanupFailures: failures };
    if (report) report.cleanup = failures.length === 0 ? 'owned containers, volumes, network and temporary fixtures removed' : 'incomplete';
  }
  if (originalError) throw Object.assign(new Error('Container verification did not complete.'), { report: { ok: false, runId, image, ...originalError, completed } });
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.some(argument => argument !== '--keep-image') || args.length > 1) {
    console.error(JSON.stringify({ ok: false, code: 'USAGE', usage: 'node tools/verify-self-hosted-container.mjs [--keep-image]' }));
    process.exitCode = 1;
  } else {
    try {
      const report = await verifySelfHostedContainer({ keepImage: args.includes('--keep-image'), progress: value => console.log(JSON.stringify(value)) });
      console.log(JSON.stringify(report, null, 2));
    } catch (error) {
      console.error(JSON.stringify(error.report || { ok: false, code: 'VERIFICATION_FAILED' }, null, 2));
      process.exitCode = 1;
    }
  }
}
