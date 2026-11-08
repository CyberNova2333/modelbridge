import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { link, mkdtemp, readFile, readdir, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { buildPlatforms } from '../tools/build-platforms.mjs';

const execFileAsync = promisify(execFile);
const repo = fileURLToPath(new URL('../', import.meta.url));

async function temporaryDirectory(t) {
  const directory = await mkdtemp(join(tmpdir(), 'modelbridge-platform-build-'));
  t.after(async () => {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith('modelbridge-platform-build-'));
    await rm(directory, { recursive: true, force: true });
  });
  return directory;
}

const load = path => import(pathToFileURL(path).href);

test('generated projects load each runtime contract and fail closed without private configuration', async t => {
  const output = join(await temporaryDirectory(t), 'output');
  const result = await buildPlatforms({ outDir: output });
  assert.deepEqual(result.platforms, ['cloudflare', 'edgeone', 'esa', 'state-service', 'cloudflare-remote', 'self-hosted-state']);

  const cloudflare = await load(join(output, 'cloudflare', '_worker.js'));
  assert.equal(typeof cloudflare.AppConfigStore, 'function');
  assert.equal(typeof cloudflare.createGateway, 'function');
  assert.equal((await cloudflare.default.fetch(new Request('https://gateway.example/v1/models'), { KV: {}, ADMIN_PASSWORD: 'build-test-password' }, {})).status, 503);

  const root = await load(join(output, 'edgeone', 'edge-functions', 'index.js'));
  const catchAll = await load(join(output, 'edgeone', 'edge-functions', '[[default]].js'));
  assert.equal(typeof root.default, 'function');
  assert.equal(root.default, catchAll.default, 'root and nested routes use the same platform adapter');
  for (const path of ['/', '/admin', '/api/settings', '/v1/chat/completions', '/v1beta/models/example:generateContent']) {
    assert.equal((await root.default({ request: new Request('https://gateway.example' + path), env: {}, waitUntil() {} })).status, 503);
  }

  const esa = await load(join(output, 'esa', 'worker.js'));
  assert.equal(typeof esa.default.fetch, 'function');
  assert.equal((await esa.default.fetch(new Request('https://gateway.example/'), {}, {})).status, 503);

  const state = await load(join(output, 'state-service', 'worker.js'));
  assert.equal(typeof state.default.fetch, 'function');
  assert.equal((await state.default.fetch(new Request('https://state.example/_modelbridge/state', { method: 'POST' }), {}, {})).status, 503);

  const remoteCloudflare = await load(join(output, 'cloudflare-remote', 'worker.js'));
  assert.equal(typeof remoteCloudflare.default.fetch, 'function');
  assert.equal((await remoteCloudflare.default.fetch(new Request('https://gateway.example/'), {}, {})).status, 503);

  const host = await load(join(output, 'self-hosted-state', 'src', 'self-hosted', 'server.mjs'));
  assert.equal(typeof host.createStateServer, 'function');
  await assert.rejects(host.startStateServerFromEnv({}));
  const sqlite = await load(join(output, 'self-hosted-state', 'src', 'state', 'sqlite.mjs'));
  assert.equal(typeof sqlite.createSqliteStateStore, 'function');
  const admin = await load(join(output, 'self-hosted-state', 'tools', 'state-admin.mjs'));
  assert.equal(typeof admin.runStateAdmin, 'function');
});

test('artifacts keep Cloudflare standalone, dependencies private and deployment settings separate', async t => {
  const output = join(await temporaryDirectory(t), 'output');
  const result = await buildPlatforms({ outDir: output });
  assert.equal(await readFile(join(output, 'cloudflare', '_worker.js'), 'utf8'), await readFile(join(repo, '_worker.js'), 'utf8'));
  assert.deepEqual(await readdir(join(output, 'edgeone', 'public')), []);
  assert.deepEqual((await readdir(join(output, 'edgeone', 'edge-functions'))).sort(), ['[[default]].js', 'index.js']);
  const edgeone = JSON.parse(await readFile(join(output, 'edgeone', 'edgeone.json'), 'utf8'));
  assert.equal(edgeone.outputDirectory, './public');
  assert.ok(!(await readdir(join(output, 'edgeone'))).includes('_worker.js'), 'native CF entry must not be mistaken for platform middleware');
  const esa = JSON.parse(await readFile(join(output, 'esa', 'esa.jsonc'), 'utf8'));
  assert.equal(esa.entry, './worker.js');
  assert.equal(esa.assets, undefined, 'no SPA/static fallback may intercept gateway requests');
  const state = await readFile(join(output, 'state-service', 'wrangler.toml'), 'utf8');
  assert.match(state, /script_name = "REPLACE_WITH_CONFIG_OWNER_WORKER_NAME"/);
  assert.doesNotMatch(state, /\[\[migrations\]\]|\[\[kv_namespaces\]\]/);
  const native = await readFile(join(output, 'cloudflare', 'wrangler.toml'), 'utf8');
  assert.match(native, /REPLACE_WITH_KV_NAMESPACE_ID/);
  assert.doesNotMatch(native, /account_id\s*=|\[\[routes\]\]/);
  const remote = await readFile(join(output, 'cloudflare-remote', 'wrangler.toml'), 'utf8');
  assert.doesNotMatch(remote, /\[\[(?:migrations|kv_namespaces|durable_objects\.bindings)\]\]/);
  assert.match(remote, /enable_request_signal/);
  assert.ok(result.files.every(file => !/(?:^|[\\/])(?:\.env[^\\/]*|\.dev\.vars|node_modules|docs-site)(?:$|[\\/])/.test(file)));
  for (const path of result.files.filter(path => !path.startsWith('self-hosted-state') && /\.(?:mjs|js)$/.test(path))) {
    assert.doesNotMatch(path, /sqlite\.mjs|self-hosted/);
    assert.doesNotMatch(await readFile(join(output, path), 'utf8'), /(?:from\s+|import\s*\()['"]node:/, 'edge deployment must not import Node-only storage/hosting');
  }
  assert.ok(!result.files.some(path => path.startsWith(join('self-hosted-state', 'src', 'platforms'))));
  const hostPackage = JSON.parse(await readFile(join(output, 'self-hosted-state', 'package.json'), 'utf8'));
  assert.equal(hostPackage.engines.node, '>=24');
  assert.equal(hostPackage.dependencies, undefined);
  assert.equal(hostPackage.scripts.start, 'node src/self-hosted/server.mjs');

  // Check every distinct JavaScript artifact; repeated platform copies share bytes.
  const checked = new Set();
  for (const path of result.files.filter(path => /\.(?:mjs|js)$/.test(path))) {
    const content = await readFile(join(output, path));
    const digest = createHash('sha256').update(content).digest('hex');
    if (checked.has(digest)) continue;
    checked.add(digest);
    await execFileAsync(process.execPath, ['--check', join(output, path)]);
  }
});

test('self-hosted artifact command refuses missing secrets before opening storage or a socket', async t => {
  const output = join(await temporaryDirectory(t), 'output');
  await buildPlatforms({ outDir: output });
  const hostRoot = join(output, 'self-hosted-state');
  await assert.rejects(execFileAsync(process.execPath, [join(hostRoot, 'src', 'self-hosted', 'server.mjs')], {
    cwd: hostRoot, env: { PATH: process.env.PATH || '' }, timeout: 5000,
  }), error => error.code === 1 && error.stderr.includes('State server startup failed.') && error.stdout === '');
  assert.ok(!(await readdir(hostRoot)).some(name => /\.sqlite(?:-|$)/.test(name)));
});

test('rebuilding is deterministic and refuses unrelated files before overwriting output', async t => {
  const output = join(await temporaryDirectory(t), 'output');
  const first = await buildPlatforms({ outDir: output });
  const before = await Promise.all(first.files.map(path => readFile(join(output, path))));
  const second = await buildPlatforms({ outDir: output });
  assert.deepEqual(second.files, first.files);
  for (const [index, path] of first.files.entries()) assert.deepEqual(await readFile(join(output, path)), before[index]);
  await writeFile(join(output, 'edgeone', 'public', 'private.txt'), 'must survive');
  await assert.rejects(buildPlatforms({ outDir: output }), /unrelated files/);
  assert.equal(await readFile(join(output, 'edgeone', 'public', 'private.txt'), 'utf8'), 'must survive');
  for (const [index, path] of first.files.entries()) assert.deepEqual(await readFile(join(output, path)), before[index]);
});

test('build output cannot overwrite source trees or follow output junctions', async t => {
  await assert.rejects(buildPlatforms({ outDir: repo }), /under dist/);
  await assert.rejects(buildPlatforms({ outDir: join(repo, 'src') }), /under dist/);
  const temp = await temporaryDirectory(t);
  const target = await temporaryDirectory(t);
  const link = join(temp, 'linked-output');
  await symlink(target, link, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(buildPlatforms({ outDir: link }), /symbolic links or junctions/);
  assert.deepEqual(await readdir(target), []);
});

test('rebuilding refuses hard-linked output before changing any generated or external file', async t => {
  const directory = await temporaryDirectory(t), output = join(directory, 'output');
  const result = await buildPlatforms({ outDir: output });
  const external = join(directory, 'unrelated.txt'), linked = join(output, 'self-hosted-state', 'package.json');
  await writeFile(external, 'must survive');
  await unlink(linked);
  await link(external, linked);
  const before = await Promise.all(result.files.map(path => readFile(join(output, path))));
  await assert.rejects(buildPlatforms({ outDir: output }), /hard-linked files/);
  assert.equal(await readFile(external, 'utf8'), 'must survive');
  for (const [index, path] of result.files.entries()) assert.deepEqual(await readFile(join(output, path)), before[index]);
});
