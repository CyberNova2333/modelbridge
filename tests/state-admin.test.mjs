import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { link, mkdtemp, readFile, readdir, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { createSqliteStateStore } from '../src/state/sqlite.mjs';
import { createStateService } from '../src/state/service.mjs';
import { STATE_RESPONSE_LIMIT } from '../src/state/remote.mjs';
import { backupStateDatabase, exportRemoteConfig, importConfigFile, runStateAdmin } from '../tools/state-admin.mjs';

const exec = promisify(execFile);
const config = { accounts: [], apiKeys: [{ id: 'fixture-key', key: 'fixture-private-key', name: 'test', createdAt: '2026-01-01T00:00:00.000Z' }], customModelMap: { test: 'model-a' } };
const fixture = { url: 'https://state.example/_modelbridge/state', token: 'fixture-private-service-token-000000000000', origin: 'https://gateway.example' };
const readConfig = async store => (await store.fetch(new Request('https://config.internal/'))).json();
const removeKey = store => store.fetch(new Request('https://config.internal/', { method: 'POST', body: JSON.stringify({ type: 'key.delete', id: 'fixture-key' }) }));

async function temporaryDirectory(t) {
  const directory = await mkdtemp(join(tmpdir(), 'modelbridge-state-admin-'));
  t.after(async () => {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith('modelbridge-state-admin-'));
    await rm(directory, { recursive: true, force: true });
  });
  return directory;
}

test('authenticated config export imports once into real SQLite and never overwrites a later revocation', async t => {
  const directory = await temporaryDirectory(t), file = join(directory, 'export.json'), db = join(directory, 'state.sqlite');
  let calls = 0;
  await exportRemoteConfig({ ...fixture, out: file, fetch: async (url, init) => {
    calls++;
    assert.equal(url, fixture.url);
    assert.equal(init.headers.Authorization, 'Bearer ' + fixture.token);
    assert.equal(init.redirect, 'manual');
    assert.deepEqual(JSON.parse(init.body), { path: '/', method: 'GET', body: null, origin: fixture.origin });
    return Response.json(config);
  } });
  assert.equal(calls, 1);
  const exported = JSON.parse(await readFile(file, 'utf8'));
  assert.deepEqual(exported.config, config);
  assert.equal(exported.format, 'modelbridge-state-config-v1');
  assert.deepEqual(Object.keys(exported).sort(), ['config', 'exportedAt', 'format']);
  if (process.platform !== 'win32') assert.equal((await stat(file)).mode & 0o777, 0o600);
  await importConfigFile({ db, file });
  const store = createSqliteStateStore({ path: db });
  try {
    assert.deepEqual(await readConfig(store), config);
    assert.equal((await removeKey(store)).status, 200);
    await assert.rejects(importConfigFile({ db, file }));
    assert.deepEqual((await readConfig(store)).apiKeys, []);
  } finally { await store.close(); }
});

test('exports preserve existing files and refuse malformed or unsuccessful remote snapshots', async t => {
  const directory = await temporaryDirectory(t), file = join(directory, 'export.json');
  await writeFile(file, 'existing-private-content');
  await assert.rejects(exportRemoteConfig({ ...fixture, out: file, fetch: async () => Response.json(config) }));
  assert.equal(await readFile(file, 'utf8'), 'existing-private-content');
  for (const response of [Response.json({ bad: true }), new Response('private-upstream-error', { status: 503 })]) {
    const target = join(directory, 'refused.json');
    await assert.rejects(exportRemoteConfig({ ...fixture, out: target, fetch: async () => response }));
    await assert.rejects(stat(target), { code: 'ENOENT' });
  }
});

test('invalid and oversized imports do not create a destination database', async t => {
  const directory = await temporaryDirectory(t), file = join(directory, 'input.json'), db = join(directory, 'state.sqlite');
  for (const content of ['invalid-json', JSON.stringify({ format: 'wrong', exportedAt: new Date().toISOString(), config }), ' '.repeat(16 * 1024 * 1024 + 1)]) {
    await writeFile(file, content);
    await assert.rejects(importConfigFile({ db, file }));
    await assert.rejects(stat(db), { code: 'ENOENT' });
  }
});

test('consistent SQLite backup works with an open WAL database and preserves existing targets', async t => {
  const directory = await temporaryDirectory(t), db = join(directory, 'state.sqlite'), out = join(directory, 'snapshot.sqlite');
  const store = createSqliteStateStore({ path: db });
  try {
    await store.importConfig(config);
    await backupStateDatabase({ db, out });
    const snapshotBytes = await readFile(out);
    assert.equal((await stat(out)).nlink, 1, 'publication must remove the private staging link');
    if (process.platform !== 'win32') assert.equal((await stat(out)).mode & 0o777, 0o600);
    await removeKey(store);
    await assert.rejects(backupStateDatabase({ db, out }));
    assert.deepEqual(await readFile(out), snapshotBytes);
    await assert.rejects(backupStateDatabase({ db, out: db }));
    const snapshot = createSqliteStateStore({ path: out });
    try { assert.deepEqual(await readConfig(snapshot), config); }
    finally { await snapshot.close(); }
    assert.ok((await readdir(directory)).every(name => !name.startsWith('.modelbridge-backup-')));
  } finally { await store.close(); }
});

test('administration CLI rejects ambiguous arguments and never prints private values on failure', async t => {
  const directory = await temporaryDirectory(t), missing = join(directory, 'missing-private-credential.json');
  for (const args of [[], ['import', '--db', 'a'], ['backup', '--db', 'a', '--db', 'b'], ['export-remote', '--out', 'a', '--force', 'yes']]) {
    await assert.rejects(runStateAdmin(args, {}));
  }
  const result = await exec(process.execPath, ['tools/state-admin.mjs', 'import', '--db', join(directory, 'db.sqlite'), '--file', missing]).then(() => assert.fail('must reject'), error => error);
  assert.equal(result.code, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /State administration failed/);
  assert.doesNotMatch(result.stderr, /missing-private-credential|fixture-private/);
});

test('backup refuses hard-link aliases whose missing WAL could resurrect a revoked key', async t => {
  const directory = await temporaryDirectory(t), db = join(directory, 'state.sqlite');
  const alias = join(directory, 'alias.sqlite'), out = join(directory, 'snapshot.sqlite');
  const store = createSqliteStateStore({ path: db });
  try {
    await store.importConfig(config);
    const checkpoint = new DatabaseSync(db);
    try { checkpoint.exec('PRAGMA wal_checkpoint(TRUNCATE)'); }
    finally { checkpoint.close(); }
    await link(db, alias);
    assert.equal((await removeKey(store)).status, 200);
    assert.deepEqual((await readConfig(store)).apiKeys, []);
    for (const source of [alias, db]) await assert.rejects(backupStateDatabase({ db: source, out }));
    await assert.rejects(stat(out), { code: 'ENOENT' });
    assert.ok((await readdir(directory)).every(name => !name.startsWith('.modelbridge-backup-')));

    await unlink(alias);
    await backupStateDatabase({ db, out });
    const snapshot = createSqliteStateStore({ path: out });
    try { assert.deepEqual((await readConfig(snapshot)).apiKeys, []); }
    finally { await snapshot.close(); }
  } finally { await store.close(); }
});

test('a maximum-size configuration exports and imports with bounded metadata overhead', async t => {
  const directory = await temporaryDirectory(t), file = join(directory, 'export.json');
  const source = createSqliteStateStore({ path: join(directory, 'source.sqlite') });
  const configuration = { accounts: [], apiKeys: [], customModelMap: { alias: '' } };
  const modelLength = STATE_RESPONSE_LIMIT - Buffer.byteLength(JSON.stringify(configuration));
  configuration.customModelMap.alias = 'x'.repeat(modelLength);
  assert.equal(Buffer.byteLength(JSON.stringify(configuration)), STATE_RESPONSE_LIMIT);
  try {
    await source.importConfig(configuration);
    const service = createStateService({ store: source });
    await exportRemoteConfig({ ...fixture, out: file, fetch: (url, init) => service.fetch(new Request(url, init), {
      MODELBRIDGE_STATE_TOKEN: fixture.token, MODELBRIDGE_STATE_ORIGINS: fixture.origin,
    }) });
    const fileSize = (await stat(file)).size;
    assert.ok(fileSize > STATE_RESPONSE_LIMIT && fileSize <= STATE_RESPONSE_LIMIT + 1024);
    const restoredPath = join(directory, 'restored.sqlite');
    await importConfigFile({ db: restoredPath, file });
    const restored = createSqliteStateStore({ path: restoredPath });
    try { assert.equal((await readConfig(restored)).customModelMap.alias.length, modelLength); }
    finally { await restored.close(); }

    configuration.customModelMap.alias += 'x';
    await writeFile(file, JSON.stringify({ format: 'modelbridge-state-config-v1', exportedAt: new Date().toISOString(), config: configuration }));
    const refusedPath = join(directory, 'oversized.sqlite');
    await assert.rejects(importConfigFile({ db: refusedPath, file }));
    await assert.rejects(stat(refusedPath), { code: 'ENOENT' });
  } finally { await source.close(); }
});
