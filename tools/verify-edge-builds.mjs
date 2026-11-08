// Opt-in official CLI checks. Installs only in a new OS temporary directory;
// never logs in, publishes, or reads the repository's Wrangler configuration.
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { gzipSync } from 'node:zlib';
import { buildPlatforms } from './build-platforms.mjs';

export const CLI_VERSIONS = Object.freeze({ wrangler: '4.156.1', edgeone: '1.6.47', 'esa-cli': '1.0.13' });
const ESA_RUNTIME = Object.freeze({ version: '1.0.0', sha256: 'a8b9993672b0c7c766a9e670274d9b6905f333481c7bdf72324b552afa1e8ef3' });
const exec = promisify(execFile);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function isolatedEnvironment(profile) {
  // Only these OS plumbing variables survive. Account tokens, NODE_OPTIONS,
  // npm configuration, and project Secrets are never inherited by the tools.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(path|systemroot|windir|comspec|temp|tmp)$/i.test(key)));
  return Object.assign(env, {
    HOME: profile, USERPROFILE: profile,
    APPDATA: join(profile, 'AppData', 'Roaming'), LOCALAPPDATA: join(profile, 'AppData', 'Local'),
    XDG_CONFIG_HOME: join(profile, '.config'), XDG_CACHE_HOME: join(profile, '.cache'),
    WRANGLER_SEND_METRICS: 'false', DO_NOT_TRACK: '1', CI: 'true', NO_COLOR: '1',
  });
}

async function command(file, args, { cwd, env, log, timeout = 120_000 } = {}) {
  try {
    const result = await exec(file, args, { cwd, env, windowsHide: true, timeout, maxBuffer: 4 * 1024 * 1024 });
    const output = result.stdout + result.stderr;
    if (log) await writeFile(log, output);
    return output;
  } catch (error) {
    if (log) await writeFile(log, (error.stdout || '') + (error.stderr || ''));
    throw new Error(`Local CLI command failed (${error.code ?? 'timeout'}); see ${log ?? 'CLI output'}.`);
  }
}

async function findNpmCli() {
  const candidates = [
    process.env.npm_execpath,
    join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'),
    join(dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js'),
  ];
  for (const candidate of candidates) {
    if (candidate && /npm-cli\.js$/.test(candidate) && await stat(candidate).then(x => x.isFile(), () => false)) return candidate;
  }
  throw new Error('Cannot locate npm-cli.js beside Node; run this command through npm.');
}

async function installTools(directory, env, log) {
  await mkdir(directory, { recursive: true });
  const userConfig = join(directory, 'user.npmrc'), globalConfig = join(directory, 'global.npmrc');
  await writeFile(userConfig, '');
  await writeFile(globalConfig, '');
  await writeFile(join(directory, 'package.json'), JSON.stringify({
    name: 'modelbridge-cli-verification', version: '0.0.0', private: true, dependencies: CLI_VERSIONS,
  }, null, 2) + '\n');
  await command(process.execPath, [await findNpmCli(), 'install', '--prefix', directory,
    '--userconfig', userConfig, '--globalconfig', globalConfig, '--cache', join(directory, 'cache'),
    '--registry', 'https://registry.npmjs.org', '--no-audit', '--no-fund', '--ignore-scripts', '--package-lock=true',
  ], { cwd: directory, env, log, timeout: 600_000 });
  // Keep the resolved graph and registry integrity values with this run's
  // evidence. This records transitive versions; it is not a repository lock.
}

async function availablePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const { port } = server.address();
  await new Promise(resolve => server.close(resolve));
  return port;
}

function localRequest(port, path, { method = 'GET', body, headers = {}, tls = true } = {}) {
  return new Promise((resolve, reject) => {
    // This relaxation applies solely to Wrangler's generated localhost cert.
    const req = (tls ? https : http).request({ hostname: '127.0.0.1', port, path, method,
      rejectUnauthorized: false, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    }, res => {
      let text = '';
      res.on('data', chunk => { text += chunk; if (text.length > 2 * 1024 * 1024) req.destroy(new Error('Local response limit')); });
      res.once('end', () => resolve({ status: res.statusCode, headers: res.headers, body: text }));
      res.once('error', reject);
    });
    req.setTimeout(3000, () => req.destroy(new Error('Local request timeout')));
    req.once('error', reject);
    req.end(body);
  });
}

async function startWorker(cli, project, profile, logs, name, vars) {
  const port = await availablePort();
  const child = spawn(process.execPath, [cli, 'dev', '--local', '--config', join(project, 'wrangler.toml'),
    '--ip', '127.0.0.1', '--port', String(port), '--inspector-ip', '127.0.0.1', '--inspector-port', '0',
    '--local-protocol', 'https', '--persist-to', join(profile, name + '-state'),
    '--show-interactive-dev-session=false', ...Object.entries(vars).flatMap(([key, value]) => ['--var', `${key}:${value}`]),
  ], { cwd: project, env: isolatedEnvironment(profile), windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '', exited = false;
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  child.once('exit', () => { exited = true; });
  child.once('error', error => { output += error.message; exited = true; });
  const stop = async () => {
    if (!exited && child.pid) {
      if (process.platform === 'win32') {
        await exec('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }).catch(() => {});
      } else {
        try { process.kill(-child.pid, 'SIGTERM'); } catch { /* Already stopped. */ }
        for (let n = 0; n < 20 && !exited; n++) await sleep(100);
        if (!exited) { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* Already stopped. */ } }
      }
    }
    await writeFile(join(logs, name + '-local.log'), output);
  };
  try {
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline && !exited) {
      try { await localRequest(port, '/robots.txt'); return { port, stop }; } catch { await sleep(200); }
    }
    throw new Error(`Wrangler local runtime did not become ready; see ${join(logs, name + '-local.log')}.`);
  } catch (error) { await stop(); throw error; }
}

async function inspectBundle(directory, env) {
  const entries = (await readdir(directory)).filter(name => /\.(?:m?js)$/.test(name));
  assert.ok(entries.length, 'Official CLI must emit JavaScript');
  let bytes = 0, gzipBytes = 0;
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry), source = await readFile(path);
    // Fully bundled edge artifacts must not retain Node imports or adapters.
    assert.doesNotMatch(source.toString(), /(?:from\s*|import\s*\(|require\s*\()\s*['"](?:node:|sqlite|fs(?:\/|['"])|http(?:s)?['"])/);
    await command(process.execPath, ['--check', path], { cwd: directory, env });
    bytes += source.length;
    gzipBytes += gzipSync(source).length;
    files.push({ name: entry, bytes: source.length, sha256: createHash('sha256').update(source).digest('hex') });
  }
  return { bytes, gzipBytes, files, nodeImports: false };
}

// Serialized into an isolated container. This does not alter the installed CLI
// or the generated gateway; the separate probe reports local runtime support.
async function esaContainerMain({ cliVersion, runtime }) {
  const { spawn, execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const { mkdir, writeFile, readFile, readdir, chmod } = await import('node:fs/promises');
  const { createHash } = await import('node:crypto');
  const run = promisify(execFile);
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const children = [];
  try {
    await mkdir('/tmp/cli', { recursive: true });
    await writeFile('/tmp/cli/package.json', JSON.stringify({
      name: 'modelbridge-esa-verification', version: '0.0.0', private: true, dependencies: { 'esa-cli': cliVersion },
    }));
    const install = await run(process.execPath, ['/usr/local/lib/node_modules/npm/bin/npm-cli.js', 'install', '--prefix', '/tmp/cli',
      '--registry', 'https://registry.npmjs.org', '--no-audit', '--no-fund', '--ignore-scripts', '--package-lock=true',
    ], { timeout: 300_000, maxBuffer: 2 * 1024 * 1024 });
    await writeFile('/audit/esa-install.log', install.stdout + install.stderr);
    await writeFile('/audit/esa-package-lock.json', await readFile('/tmp/cli/package-lock.json'));
    // The official installer uses this HTTP endpoint. Pin and check the binary
    // SHA-256 before executing it; do not accept a changed runtime silently.
    const base = 'http://esa-runtime.myalicdn.com/ew2/';
    const manifestResponse = await fetch(base + 'manifest.json', { signal: AbortSignal.timeout(30_000) });
    if (!manifestResponse.ok) throw new Error('ESA runtime manifest download failed');
    const manifest = await manifestResponse.json();
    if (manifest.version !== runtime.version) throw new Error('ESA runtime version changed; review and update the pinned verification runtime');
    const response = await fetch(`${base}${runtime.version}/linux-x86_64/edgeworker2`, { signal: AbortSignal.timeout(120_000) });
    if (!response.ok) throw new Error('ESA runtime download failed');
    const binary = Buffer.from(await response.arrayBuffer());
    if (createHash('sha256').update(binary).digest('hex') !== runtime.sha256) throw new Error('ESA runtime SHA-256 mismatch');
    await mkdir('/root/.ew2', { recursive: true });
    await writeFile('/root/.ew2/edgeworker2', binary);
    await chmod('/root/.ew2/edgeworker2', 0o700);
    await writeFile('/root/.ew2/manifest.json', JSON.stringify(manifest));
    function launch(entry, port) {
      const child = spawn(process.execPath, ['/tmp/cli/node_modules/esa-cli/bin/enter.cjs', 'dev', entry, '--port', String(port), '--skip-update-check'], { cwd: '/project', stdio: ['ignore', 'inherit', 'inherit'] });
      children.push(child);
      return child;
    }
    async function request(port, path) {
      const deadline = Date.now() + 70_000;
      while (Date.now() < deadline) {
        try {
          const response = await fetch(`http://127.0.0.1:${port}${path}`, { headers: { host: 'gateway.example' }, signal: AbortSignal.timeout(3000) });
          return { status: response.status, body: await response.json() };
        } catch { await pause(250); }
      }
      throw new Error('ESA local runtime did not return a response');
    }
    launch('/project/worker.js', 18080);
    const gateway = await request(18080, '/robots.txt');
    if (gateway.status !== 503 || gateway.body.error?.code !== 'platform_unavailable') throw new Error('ESA gateway did not fail closed for missing environment configuration');
    const files = (await readdir('/project/.dev')).filter(name => /^index-\d+\.js$/.test(name));
    if (files.length !== 1) throw new Error('Unexpected ESA bundle output');
    const bundle = await readFile('/project/.dev/' + files[0]);
    await mkdir('/audit/bundle');
    await writeFile('/audit/bundle/worker.js', bundle);
    await writeFile('/project/runtime-probe.mjs', `export default { fetch(request, context, env) { return Response.json({ requestSignal: !!request.signal, signalAddEventListener: typeof request.signal?.addEventListener, AbortController: typeof AbortController, ReadableStream: typeof ReadableStream, TextEncoder: typeof TextEncoder, TextDecoder: typeof TextDecoder, URL: typeof URL, fetch: typeof fetch, crypto: typeof crypto, subtle: typeof crypto?.subtle, ResponseJson: typeof Response.json, envType: typeof env, contextType: typeof context }); } };`);
    launch('/project/runtime-probe.mjs', 18081);
    const probe = await request(18081, '/');
    if (probe.status !== 200 || !probe.body.requestSignal || probe.body.AbortController !== 'function') throw new Error('ESA runtime cancellation primitives unavailable');
    const result = { status: 'local-cli-passed', cliVersion, runtime, bytes: bundle.length,
      gateway, probe: probe.body,
      limitations: ['Local EW2 is not a cloud deployment.', 'Official dev does not supply cloud environment variables; end-to-end state access is not verified here.', 'Primitive presence does not verify incoming disconnect propagation, upstream abort, streaming duration, or production limits.'],
    };
    await writeFile('/audit/esa-result.json', JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally { for (const child of children) child.kill(); }
  // Exiting PID 1 also stops EW2 descendants inside this disposable container.
  process.exit(process.exitCode ?? 0);
}

export async function verifyEsaDocker(directory, project, logs, env = process.env) {
  const runId = randomUUID();
  const id = 'modelbridge-edge-cli-' + runId;
  const network = id + '-net', audit = join(directory, 'esa-container');
  await mkdir(audit);
  await writeFile(join(audit, 'run.mjs'), `(${esaContainerMain.toString()})(${JSON.stringify({ cliVersion: CLI_VERSIONS['esa-cli'], runtime: ESA_RUNTIME })});\n`);
  // Docker uses its own local context; no account variables enter the container.
  // A private bridge isolates the wildcard CLI listener. Clients run inside the
  // same container on loopback; there are no published host ports.
  const labels = ['--label', 'modelbridge.verification=edge-cli', '--label', `modelbridge.verification.run=${runId}`];
  async function removeOwned(kind, name) {
    // List first so a missing resource is distinguished from an unavailable
    // daemon. Inspect exact name and full run UUID before deleting by ID.
    const listArgs = kind === 'container' ? ['container', 'ls', '-a'] : ['network', 'ls'];
    const names = await command('docker', [...listArgs, '--filter', `name=${name}`, '--format', kind === 'container' ? '{{.Names}}' : '{{.Name}}'], { env });
    if (!names.split(/\r?\n/).includes(name)) return;
    const [resource] = JSON.parse(await command('docker', [kind, 'inspect', name], { env }));
    const resourceLabels = kind === 'container' ? resource.Config?.Labels : resource.Labels;
    if (resource.Name !== (kind === 'container' ? '/' + name : name)
        || resourceLabels?.['modelbridge.verification'] !== 'edge-cli'
        || resourceLabels?.['modelbridge.verification.run'] !== runId) {
      throw new Error(`Refusing to remove ${kind} ${name}: verification ownership mismatch`);
    }
    await command('docker', kind === 'container' ? ['container', 'rm', '-f', resource.Id] : ['network', 'rm', resource.Id],
      { env, log: join(logs, `esa-${kind}-cleanup.log`) });
  }
  let result, failure;
  // The generated names/UUID are registered above before creation. Cleanup
  // therefore also covers a successful creation whose acknowledgement is lost.
  try {
    await command('docker', ['network', 'create', ...labels, network], { env, log: join(logs, 'esa-network.log') });
    await command('docker', ['run', '-d', '--name', id, ...labels, '--network', network,
      '--mount', `type=bind,source=${project},target=/project`, '--mount', `type=bind,source=${audit},target=/audit`,
      '--workdir', '/project', 'node:24-trixie-slim', 'node', '/audit/run.mjs'], { env, log: join(logs, 'esa-container-start.log') });
    const exit = await command('docker', ['wait', id], { env, timeout: 540_000, log: join(logs, 'esa-container-exit.log') });
    await command('docker', ['logs', id], { env, log: join(logs, 'esa-container.log') });
    assert.equal(exit.trim(), '0', `ESA local CLI failed; see ${join(logs, 'esa-container.log')}`);
    result = JSON.parse(await readFile(join(audit, 'esa-result.json'), 'utf8'));
    result.bundle = await inspectBundle(join(audit, 'bundle'), isolatedEnvironment(join(directory, 'profile')));
  } catch (error) { failure = error; }
  const cleanupErrors = [];
  for (const [kind, name] of [['container', id], ['network', network]]) {
    try { await removeOwned(kind, name); } catch (error) { cleanupErrors.push(error); }
  }
  if (cleanupErrors.length) throw new AggregateError([...(failure ? [failure] : []), ...cleanupErrors],
    `ESA verification cleanup failed: ${cleanupErrors.map(error => error.message).join('; ')}`);
  if (failure) throw failure;
  return result;
}

export async function verifyEdgeBuilds({ cliDir, esaDocker = false } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'modelbridge-edge-cli-'));
  const profile = join(directory, 'profile'), logs = join(directory, 'logs');
  await mkdir(profile, { recursive: true });
  await mkdir(logs, { recursive: true });
  const env = isolatedEnvironment(profile);
  const tools = cliDir ? resolve(cliDir) : join(directory, 'tools');
  console.log(`Isolated verification directory: ${directory}`);
  if (!cliDir) {
    console.log('Installing pinned official CLIs in the temporary directory.');
    await installTools(tools, env, join(logs, 'npm-install.log'));
  }
  for (const [name, version] of Object.entries(CLI_VERSIONS)) {
    assert.equal(JSON.parse(await readFile(join(tools, 'node_modules', name, 'package.json'), 'utf8')).version, version);
  }
  const modules = join(tools, 'node_modules');
  const wrangler = join(modules, 'wrangler/bin/wrangler.js');
  await command(process.execPath, [wrangler, '--version'], { cwd: directory, env, log: join(logs, 'wrangler-version.log') });
  await command(process.execPath, [join(modules, 'edgeone/edgeone-bin/edgeone.js'), 'makers', '--help'], { cwd: directory, env, log: join(logs, 'makers-help.log') });
  await command(process.execPath, [join(modules, 'esa-cli/bin/enter.cjs'), 'dev', '--help', '--skip-update-check'], { cwd: directory, env, log: join(logs, 'esa-help.log') });
  const projects = join(directory, 'projects');
  await buildPlatforms({ outDir: projects });
  const report = { node: process.version, cliVersions: CLI_VERSIONS, directory, cloudflare: {},
    edgeone: { status: 'not-verified', reason: 'No standalone build/dry-run command. Official dev requires login/token; deploy publishes, including anonymous deployments.' },
    esa: { status: 'not-verified', reason: 'No standalone build/dry-run command. Official dev binds all interfaces; use an isolated Linux container for EW2. Windows dev uses a Deno mock without context/env.' },
  };
  try {
    for (const name of ['cloudflare', 'cloudflare-remote', 'state-service']) {
      console.log(`Wrangler dry-run: ${name}`);
      const bundle = join(directory, 'bundles', name), project = join(projects, name);
      await command(process.execPath, [wrangler, 'deploy', '--dry-run', '--config', join(project, 'wrangler.toml'), '--outdir', bundle],
        { cwd: project, env, log: join(logs, name + '-dry-run.log') });
      report.cloudflare[name] = { dryRun: 'passed', ...await inspectBundle(bundle, env) };
      const vars = name === 'cloudflare' ? { ADMIN_PASSWORD: 'local-cli-smoke-password' }
        : name === 'cloudflare-remote' ? { ADMIN_PASSWORD: 'local-cli-smoke-password', MODELBRIDGE_STATE_URL: 'https://state.invalid/_modelbridge/state', MODELBRIDGE_STATE_TOKEN: 'local-cli-smoke-token-0000000000000000000000000000' } : {};
      const local = await startWorker(wrangler, project, profile, logs, name, vars);
      try {
        const checks = [];
        for (const [path, expected] of name === 'state-service' ? [['/wrong-path', 404], ['/_modelbridge/state', 405]] : [['/', 200], ['/robots.txt', 200], ['/v1/models', 401]]) {
          const response = await localRequest(local.port, path);
          assert.equal(response.status, expected, `${name} ${path}: ${response.body.slice(0, 200)}`);
          checks.push({ path, status: response.status });
        }
        if (name === 'state-service') {
          const response = await localRequest(local.port, '/_modelbridge/state', { method: 'POST', body: '{}' });
          assert.equal(response.status, 503, 'Missing state service credentials must fail closed');
          checks.push({ path: '/_modelbridge/state', method: 'POST', status: response.status });
        }
        if (name === 'cloudflare') {
          const login = await localRequest(local.port, '/api/auth/login', { method: 'POST', body: JSON.stringify({ password: vars.ADMIN_PASSWORD }) });
          assert.equal(login.status, 200, 'Native local Durable Object login');
          const cookie = login.headers['set-cookie']?.[0]?.split(';')[0];
          assert.ok(cookie?.startsWith('admin_token=as2_'));
          const authenticated = await localRequest(local.port, '/api/keys', { headers: { Cookie: cookie } });
          assert.equal(authenticated.status, 200, 'Native local Durable Object session verification');
          checks.push({ path: '/api/auth/login', method: 'POST', status: login.status }, { path: '/api/keys', status: authenticated.status });
        }
        report.cloudflare[name].localWorkerd = { status: 'passed', checks };
      } finally { await local.stop(); }
    }
    if (esaDocker) {
      console.log('ESA official CLI/EW2 smoke in an isolated Linux container.');
      // The Docker CLI needs the caller's selected local Docker context. It never
      // forwards these host variables to the container (there are no --env flags).
      report.esa = await verifyEsaDocker(directory, join(projects, 'esa'), logs, process.env);
    }
  } finally {
    await writeFile(join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  }
  console.log(JSON.stringify(report, null, 2));
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    const options = {};
    while (args.length) {
      const flag = args.shift();
      if (flag === '--esa-docker') options.esaDocker = true;
      else if (flag === '--cli-dir' && args[0]) options.cliDir = args.shift();
      else throw new Error('Usage: node tools/verify-edge-builds.mjs [--cli-dir <isolated-installed-tools>] [--esa-docker]');
    }
    await verifyEdgeBuilds(options);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
