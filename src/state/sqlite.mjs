import { AsyncLocalStorage } from 'node:async_hooks';
import { closeSync, lstatSync, openSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import { GatewayStateStore, isValidStateConfig } from '../../_worker.js';
import { boundedStateResponse, validStateRoute } from './remote.mjs';

export { isValidStateConfig } from '../../_worker.js';

const SCHEMA_VERSION = 1;
const APPLICATION_ID = 0x4d425331; // MBS1: do not modify an unrelated SQLite file.
const MAX_RECORD_BYTES = 16 * 1024 * 1024;
const encoder = new TextEncoder();
const busy = error => [5, 6].includes(Number(error?.errcode) & 0xff);

function failure(message, code = 'STATE_UNAVAILABLE') {
  return Object.assign(new Error(message), { code, status: 503 });
}

function serializeValue(value) {
  let json;
  try { json = JSON.stringify(value); } catch { throw failure('State data could not be serialized.'); }
  if (typeof json !== 'string' || encoder.encode(json).byteLength > MAX_RECORD_BYTES) throw failure('State data exceeds the storage limit.', 'STATE_TOO_LARGE');
  return json;
}

export function createSqliteStateStore({ path, lockTimeoutMs = 5000, usageTimeoutMs = 15000 } = {}) {
  if (typeof path !== 'string' || !path.trim() || path === ':memory:' || path.includes('\0')
      || !Number.isInteger(lockTimeoutMs) || lockTimeoutMs < 0 || lockTimeoutMs > 60000
      || !Number.isInteger(usageTimeoutMs) || usageTimeoutMs < 1 || usageTimeoutMs > 15000) {
    throw new TypeError('A local SQLite file path and a valid lock timeout are required.');
  }
  const databasePath = resolve(path);
  // A new database contains credentials. Its parent directory must already
  // exist; never silently create an arbitrary directory tree or follow links.
  try { closeSync(openSync(databasePath, 'wx', 0o600)); }
  catch (error) { if (error.code !== 'EEXIST') throw failure('The SQLite state file could not be created.'); }
  const file = lstatSync(databasePath);
  // A hard-link alias derives different WAL/SHM names for the same main file,
  // so an alias can miss committed revocations still present only in the WAL.
  if (!file.isFile() || file.nlink !== 1) throw failure('The SQLite state path must be a regular file with one link.');
  const database = new DatabaseSync(databasePath, { timeout: 0 });
  const transactionContext = new AsyncLocalStorage();
  const requestContext = new AsyncLocalStorage();
  const shutdown = new AbortController();
  const active = new Set();
  let tail = Promise.resolve(), closing = false, closed = false, closePromise, poisoned = false;
  let readRecord, writeRecord;

  const assertUsable = () => {
    if (closed || poisoned) throw failure('The SQLite state store is unavailable.');
    if (requestContext.getStore()?.signal?.aborted) throw failure('The state operation was cancelled.', 'STATE_CANCELLED');
  };
  const enqueue = operation => {
    const pending = tail.then(operation);
    tail = pending.catch(() => {});
    return pending;
  };
  const inTransaction = () => transactionContext.getStore()?.active === true;

  async function retryBusy(operation) {
    const deadline = Date.now() + lockTimeoutMs;
    for (;;) {
      assertUsable();
      try { return operation(); }
      catch (error) {
        if (!busy(error)) throw error;
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw failure('The SQLite state store is busy.', 'STATE_BUSY');
        // Synchronous SQLite busy waiting would block a transaction awaiting
        // Web Crypto in another connection on this same Node event loop.
        await delay(Math.min(10, remaining));
      }
    }
  }

  async function transaction(operation) {
    await retryBusy(() => database.exec('BEGIN IMMEDIATE'));
    const context = { active: true };
    try {
      return await transactionContext.run(context, async () => {
        assertUsable();
        const result = await operation();
        assertUsable();
        database.exec('COMMIT');
        return result;
      });
    } catch (error) {
      try { if (database.isTransaction) database.exec('ROLLBACK'); }
      catch { poisoned = true; }
      throw error;
    } finally { context.active = false; }
  }

  const ready = enqueue(async () => {
    await transaction(() => {
      const version = database.prepare('PRAGMA user_version').get().user_version;
      const applicationId = database.prepare('PRAGMA application_id').get().application_id;
      if (version === 0 && applicationId === 0) {
        const otherObjects = database.prepare("SELECT name FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'").all();
        if (otherObjects.length) throw failure('The SQLite file belongs to another application.', 'STATE_SCHEMA');
        database.exec(`CREATE TABLE state_records (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
          PRAGMA application_id = ${APPLICATION_ID}; PRAGMA user_version = ${SCHEMA_VERSION};`);
      } else if (version !== SCHEMA_VERSION || applicationId !== APPLICATION_ID) {
        throw failure('The SQLite state schema is unsupported.', 'STATE_SCHEMA');
      }
      const columns = database.prepare('PRAGMA table_info(state_records)').all();
      if (columns.length !== 2 || columns[0].name !== 'key' || columns[0].type !== 'TEXT' || columns[0].pk !== 1
          || columns[1].name !== 'value' || columns[1].type !== 'TEXT' || columns[1].notnull !== 1) {
        throw failure('The SQLite state schema is invalid.', 'STATE_SCHEMA');
      }
    });
    const journal = await retryBusy(() => database.prepare('PRAGMA journal_mode = WAL').get());
    if (journal.journal_mode !== 'wal') throw failure('SQLite WAL mode is required.', 'STATE_SCHEMA');
    database.exec('PRAGMA synchronous = FULL');
    readRecord = database.prepare('SELECT value FROM state_records WHERE key = ?');
    writeRecord = database.prepare('INSERT INTO state_records (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  });
  // Retain the rejection for callers while avoiding a constructor-time
  // unhandled rejection before a server can await its startup readiness.
  ready.catch(() => {});

  const get = key => {
    assertUsable();
    const row = readRecord.get(key);
    if (!row) return undefined;
    try { return JSON.parse(row.value); }
    catch { throw failure('Stored state is invalid.', 'STATE_CORRUPT'); }
  };
  const put = (key, value) => {
    assertUsable();
    writeRecord.run(key, serializeValue(value));
  };
  const engine = new GatewayStateStore({
    storage: {
      get(key) { return inTransaction() ? Promise.resolve(get(key)) : enqueue(() => retryBusy(() => get(key))); },
      put(key, value) { return inTransaction() ? Promise.resolve(put(key, value)) : enqueue(() => transaction(() => put(key, value))); },
    },
    blockConcurrencyWhile(operation) { return inTransaction() ? operation() : enqueue(() => transaction(operation)); },
  }, {}, {
    usageFetch: (url, options = {}) => boundedStateResponse(signal => fetch(url, { ...options, signal }), {
      timeoutMs: usageTimeoutMs, maxResponseBytes: MAX_RECORD_BYTES,
      signal: options.signal, parentSignal: shutdown.signal,
    }),
  });

  function accept(operation) {
    if (closing || closed) return Promise.reject(failure('The SQLite state store is closed.', 'STATE_CLOSED'));
    const pending = (async () => { await ready; assertUsable(); return operation(); })();
    active.add(pending);
    void pending.finally(() => active.delete(pending)).catch(() => {});
    return pending;
  }

  return {
    path: databasePath,
    ready,
    fetch(request) {
      return accept(() => {
        const url = new URL(request.url);
        if (url.origin !== 'https://config.internal' || url.username || url.password || url.hash
            || !validStateRoute(url.pathname + url.search, request.method)) return Response.json({ error: 'Invalid state operation.' }, { status: 400 });
        if (url.pathname === '/usage') {
          if (request.signal.aborted) throw failure('The state operation was cancelled.', 'STATE_CANCELLED');
          // Usage refresh is shared by concurrent subscribers. Its storage work
          // must not inherit the first subscriber's cancellation context. The
          // upstream query keeps its own timeout; each subscriber still observes
          // its own cancellation, without failing other waiting requests.
          return requestContext.run({}, async () => {
            const response = await engine.fetch(request);
            if (request.signal.aborted) throw failure('The state operation was cancelled.', 'STATE_CANCELLED');
            return response;
          });
        }
        return requestContext.run({ signal: request.signal }, () => engine.fetch(request));
      });
    },
    importConfig(config) {
      return accept(() => {
        if (!isValidStateConfig(config)) throw failure('The imported configuration is invalid.', 'STATE_IMPORT_INVALID');
        const serialized = serializeValue(config);
        const copy = JSON.parse(serialized);
        if (!isValidStateConfig(copy)) throw failure('The imported configuration is invalid.', 'STATE_IMPORT_INVALID');
        return enqueue(() => transaction(() => {
          if (database.prepare('SELECT 1 FROM state_records LIMIT 1').get()) {
            throw failure('Configuration can only be imported into an unused state database.', 'STATE_IMPORT_NOT_EMPTY');
          }
          writeRecord.run('config', serialized);
        }));
      });
    },
    close() {
      if (!closePromise) {
        closing = true;
        // Stop shared analytics independently of subscriber cancellation. The
        // bounded transport settles even if an underlying fetch ignores abort;
        // accepted configuration/auth transactions are still drained normally.
        shutdown.abort();
        closePromise = (async () => {
          await Promise.allSettled([ready, ...active]);
          await tail;
          database.close();
          closed = true;
          transactionContext.disable();
          requestContext.disable();
        })();
      }
      return closePromise;
    },
  };
}
