import { constants } from 'node:fs';
import { chmod, link, lstat, mkdir, open, rmdir, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { backup, DatabaseSync } from 'node:sqlite';
import { createRemoteState, STATE_RESPONSE_LIMIT } from '../src/state/remote.mjs';
import { createSqliteStateStore, isValidStateConfig } from '../src/state/sqlite.mjs';

const FORMAT = 'modelbridge-state-config-v1';
// A maximum-size state response still needs its migration envelope and newline.
// The configuration itself remains subject to the state transport/storage limit.
const CONFIG_FILE_LIMIT = STATE_RESPONSE_LIMIT + 1024;
const invalid = () => new Error('State administration failed. Check configuration, file access and whether the destination is unused.');

async function readPrivateJson(path) {
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > CONFIG_FILE_LIMIT) throw invalid();
    const decoder = new TextDecoder('utf-8', { fatal: true });
    const buffer = Buffer.alloc(65536);
    let text = '', total = 0;
    while (true) {
      const { bytesRead } = await file.read(buffer);
      if (!bytesRead) break;
      total += bytesRead;
      if (total > CONFIG_FILE_LIMIT) throw invalid();
      text += decoder.decode(buffer.subarray(0, bytesRead), { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally { await file.close(); }
}

export async function exportRemoteConfig({ url, token, origin, out, fetch: transport = globalThis.fetch }) {
  const remote = createRemoteState({ url, token, origin, fetch: transport });
  const response = await remote.request('/');
  if (!response.ok) throw invalid();
  const config = await response.json();
  if (!isValidStateConfig(config)) throw invalid();
  const content = JSON.stringify({ format: FORMAT, exportedAt: new Date().toISOString(), config }) + '\n';
  if (Buffer.byteLength(content) > CONFIG_FILE_LIMIT) throw invalid();
  // Exclusive creation preserves every existing file. A failed write remains
  // visibly incomplete; it is never silently treated as a usable export.
  const file = await open(out, 'wx', 0o600);
  try { await file.writeFile(content); await file.sync(); }
  finally { await file.close(); }
}

export async function importConfigFile({ db, file }) {
  const envelope = await readPrivateJson(file);
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)
      || Object.keys(envelope).some(key => !['format', 'exportedAt', 'config'].includes(key))
      || envelope.format !== FORMAT || typeof envelope.exportedAt !== 'string'
      || !Number.isFinite(Date.parse(envelope.exportedAt)) || !isValidStateConfig(envelope.config)
      || Buffer.byteLength(JSON.stringify(envelope.config)) > STATE_RESPONSE_LIMIT) throw invalid();
  const store = createSqliteStateStore({ path: db });
  try { await store.importConfig(envelope.config); }
  finally { await store.close(); }
}

export async function backupStateDatabase({ db, out }) {
  const source = resolve(db), destination = resolve(out);
  const sourceInfo = await lstat(source);
  // SQLite WAL/SHM companions are selected by path. A hard-link alias can read
  // an older main file while committed changes live in the other name's WAL.
  if (source === destination || !sourceInfo.isFile() || sourceInfo.nlink !== 1) throw invalid();
  // Reserve a private staging directory beside the destination. SQLite's backup
  // API overwrites its target, so it must never receive the user's output path.
  // Publish via an exclusive hard link only after a complete, consistent backup.
  const temporaryDirectory = join(dirname(destination), '.modelbridge-backup-' + crypto.randomUUID());
  await mkdir(temporaryDirectory, { mode: 0o700 });
  const temporaryFile = join(temporaryDirectory, 'snapshot.sqlite');
  let database;
  try {
    database = new DatabaseSync(source, { readOnly: true });
    if (database.prepare('PRAGMA user_version').get().user_version !== 1
        || database.prepare('PRAGMA application_id').get().application_id !== 0x4d425331
        || !database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'state_records'").get()) throw invalid();
    await backup(database, temporaryFile);
    await chmod(temporaryFile, 0o600);
    const snapshot = new DatabaseSync(temporaryFile);
    try {
      // A backup of a WAL database carries its journal mode. Make the published
      // artifact a complete standalone database, without companion WAL/SHM files.
      snapshot.exec('PRAGMA journal_mode = DELETE');
      if (snapshot.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw invalid();
    }
    finally { snapshot.close(); }
    const file = await open(temporaryFile, 'r+');
    try { await file.sync(); } finally { await file.close(); }
    await link(temporaryFile, destination);
  } finally {
    database?.close();
    // Only these task-owned paths are removed; no recursive cleanup.
    for (const path of [temporaryFile, temporaryFile + '-wal', temporaryFile + '-shm', temporaryFile + '-journal']) {
      await unlink(path).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
    await rmdir(temporaryDirectory);
  }
}

export async function runStateAdmin(args, env = process.env) {
  const [command, ...rest] = args;
  const options = {};
  if (rest.length % 2) throw invalid();
  for (let index = 0; index < rest.length; index += 2) {
    const name = rest[index];
    if (!['--db', '--file', '--out'].includes(name) || Object.hasOwn(options, name) || !rest[index + 1]) throw invalid();
    options[name] = rest[index + 1];
  }
  if (command === 'export-remote' && Object.keys(options).length === 1 && options['--out']) {
    return exportRemoteConfig({ url: env.MODELBRIDGE_STATE_URL, token: env.MODELBRIDGE_STATE_TOKEN,
      origin: env.MODELBRIDGE_STATE_EXPORT_ORIGIN, out: options['--out'] });
  }
  if (command === 'import' && Object.keys(options).length === 2 && options['--db'] && options['--file']) {
    return importConfigFile({ db: options['--db'], file: options['--file'] });
  }
  if (command === 'backup' && Object.keys(options).length === 2 && options['--db'] && options['--out']) {
    return backupStateDatabase({ db: options['--db'], out: options['--out'] });
  }
  throw invalid();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await runStateAdmin(process.argv.slice(2));
    console.log('State administration completed. Protect the database and any exported files.');
  } catch {
    // Never print exported configuration, a service token, remote diagnostics,
    // connection strings or errors that may embed those values.
    console.error(invalid().message);
    process.exitCode = 1;
  }
}
