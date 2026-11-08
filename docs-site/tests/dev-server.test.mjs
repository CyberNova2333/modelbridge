import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vitepress';

const root = fileURLToPath(new URL('../', import.meta.url));

async function freePort() {
  const probe = net.createServer();
  await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', resolve); });
  const port = probe.address().port;
  await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
  return port;
}

function request(base, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const call = http.get(new URL(path, base), { headers }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => {
        body += chunk;
        if (body.length > 2 * 1024 * 1024) call.destroy(new Error('Smoke response exceeded its budget'));
      });
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body }));
      response.on('error', reject);
    });
    call.setTimeout(10000, () => call.destroy(new Error('Development request timed out')));
    call.on('error', reject);
  });
}

test('patched Vite serves the default guide, initial local search, HMR and bounded development surfaces', { timeout: 30000 }, async t => {
  const id = randomUUID().replaceAll('-', '');
  const filename = `__dependency_smoke_${id}.md`;
  const fixture = join(root, filename);
  const sensitive = join(root, `.env.dependency_smoke_${id}`);
  const outside = join(tmpdir(), `modelbridge-docs-outside-${id}.map`);
  const title = `DependencySmoke${id}`;
  const marker = 'Synthetic dependency boundary fixture';
  const initial = `---\nrepoGuideSource: "repo-docs/README.md"\n---\n\n# ${title}Initial\n\n[Source](../_worker.js)\n`;
  const updated = initial.replace(`${title}Initial`, `${title}Updated`);
  const ownedFiles = new Map();
  let server, socket;
  const cwd = process.cwd();
  t.after(async () => {
    // HTTP/HMR responses can complete before Vite finishes their background
    // transforms. Drain those requests before closing plugins and the optimizer.
    await server?.waitForRequestsIdle();
    socket?.close();
    await server?.close();
    for (const [path, allowed] of ownedFiles) {
      assert.ok(allowed.includes(await readFile(path, 'utf8')), 'Preserve a fixture if unexpected edits appeared');
      await unlink(path);
    }
    process.chdir(cwd);
  });
  for (const [path, body, allowed = [body]] of [[fixture, initial, [initial, updated]], [sensitive, marker], [outside, marker]]) {
    await writeFile(path, body, { flag: 'wx' });
    ownedFiles.set(path, allowed);
  }

  process.chdir(root);
  const port = await freePort();
  server = await createServer(root, { host: '127.0.0.1', port, strictPort: true, open: false });
  await server.listen();
  const base = `http://127.0.0.1:${port}`;
  const html = await request(base, '/');
  assert.equal(html.status, 200);
  assert.match(html.body, /vite/);
  const page = await request(base, '/' + filename + '?import');
  assert.equal(page.status, 200);
  assert.ok(page.body.includes(title + 'Initial'));
  assert.ok(page.body.includes('_worker.js'));
  assert.equal(page.body.includes('../_worker.js'), false, 'Repository links must be rendered as precise source paths');
  const index = await request(base, '/@localSearchIndexroot');
  assert.equal(index.status, 200);
  assert.ok(index.body.includes(title + 'Initial'), 'Initial local search must index the guide');

  // Use http.request for Host checks; Node fetch intentionally ignores Host.
  assert.equal((await request(base, '/', { Host: 'untrusted.invalid' })).status, 403);
  assert.equal((await request(base, '/', { Origin: 'https://untrusted.invalid' })).headers['access-control-allow-origin'], undefined);
  for (const path of [
    '/@fs/' + outside.replaceAll('\\', '/'),
    '/.env.dependency_smoke_' + id + '?raw',
    '/@fs/' + sensitive.replaceAll('\\', '/') + '?raw',
    '/@fs/' + fileURLToPath(new URL('../../_worker.js', import.meta.url)).replaceAll('\\', '/') + '?raw',
  ]) {
    const response = await request(base, path);
    assert.equal(response.body.includes(marker), false);
    if (path.endsWith('.map') && response.status === 200) {
      // The documentation router may return its public HTML shell for an
      // unresolvable map URL; never accept arbitrary 200 file responses.
      assert.match(response.headers['content-type'], /^text\/html\b/);
      assert.match(response.body, /^<!DOCTYPE html>/i);
      assert.ok(response.body.includes('/@vite/client'));
    } else assert.equal(response.status, 403, `Denied file must stay blocked: ${path}`);
  }

  const client = await request(base, '/@vite/client');
  const token = /const wsToken = ("[^"]+")/.exec(client.body);
  assert.ok(token, 'The installed client must expose its authenticated HMR URL');
  const events = [], waiters = new Set();
  socket = new WebSocket(`ws://127.0.0.1:${port}/?token=${encodeURIComponent(JSON.parse(token[1]))}`, 'vite-hmr');
  socket.addEventListener('message', message => {
    const event = JSON.parse(message.data);
    events.push(event);
    for (const waiter of waiters) if (waiter.matches(event)) { waiters.delete(waiter); clearTimeout(waiter.timer); waiter.resolve(event); }
  });
  function waitFor(matches) {
    const existing = events.find(matches);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const waiter = { matches, resolve, timer: setTimeout(() => { waiters.delete(waiter); reject(new Error('HMR event timed out')); }, 10000) };
      waiters.add(waiter);
    });
  }
  await waitFor(event => event.type === 'connected');
  const changed = waitFor(event => event.type === 'update' && event.updates.some(update => update.path.includes(filename)));
  await writeFile(fixture, updated);
  await changed;
  const nextPage = await request(base, '/' + filename + '?import&t=' + Date.now());
  assert.ok(nextPage.body.includes(title + 'Updated'), 'Markdown HMR must compile the edited body');
  // VitePress 1.x caches its initial search index until the dev server restarts.
  // This checks initial indexing and page HMR, without claiming live search reindexing.
});
