import { createServer } from 'node:http';
import { open } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { authenticatedStateHeaders, createStateService, configuredOrigins } from '../state/service.mjs';
import { STATE_SERVICE_PATH, STATE_REQUEST_LIMIT, STATE_RESPONSE_LIMIT, exactStateOrigin, validStateToken } from '../state/remote.mjs';

const FAILURE = Buffer.from('{"error":"State service request failed."}');
const configurationError = () => new Error('Invalid state server configuration.');
const integerIn = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;

function sendFailure(response, status) {
  if (response.destroyed || response.writableEnded) return;
  if (response.headersSent) { response.destroy(); return; }
  response.writeHead(status, {
    'Content-Type': 'application/json', 'Content-Length': FAILURE.length,
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Connection': 'close',
  });
  response.end(FAILURE);
}

function rejectSocket(socket, status, reason) {
  if (socket.destroyed) return;
  if (socket.writableEnded) { socket.destroy(); return; }
  socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  // Upgraded/tunnel sockets no longer have HTTP request deadlines. A peer can
  // keep its write side open after our FIN, so finish closing independently.
  const timer = setTimeout(() => socket.destroy(), 250);
  timer.unref();
  socket.once('close', () => clearTimeout(timer));
}

function boundedInput(request, signal) {
  return new Promise((resolveBody, reject) => {
    let size = 0, ended = false;
    const chunks = [];
    const cleanup = () => {
      request.off('data', onData); request.off('end', onEnd); request.off('error', onError);
      signal.removeEventListener('abort', onAbort);
    };
    const fail = status => {
      if (ended) return;
      ended = true; cleanup(); request.pause();
      reject(Object.assign(new Error('Request body unavailable.'), { status }));
    };
    const onData = chunk => {
      size += chunk.byteLength;
      if (size > STATE_REQUEST_LIMIT) { fail(413); return; }
      chunks.push(chunk);
    };
    const onEnd = () => {
      if (ended) return;
      ended = true; cleanup(); resolveBody(Buffer.concat(chunks, size));
    };
    const onError = () => fail(400);
    const onAbort = () => fail(499);
    const declared = request.headers['content-length'];
    if (declared && /^\d+$/.test(declared) && Number(declared) > STATE_REQUEST_LIMIT) { fail(413); return; }
    request.on('data', onData); request.once('end', onEnd); request.once('error', onError);
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
}

function raceAbort(pending, signal) {
  return new Promise((resolveValue, reject) => {
    const abort = () => reject(Object.assign(new Error('Request interrupted.'), { status: 499 }));
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    Promise.resolve(pending).then(resolveValue, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

export function createStateServer({
  store, token, origins, publicOrigin, host = '127.0.0.1', port = 8788,
  requestTimeoutMs = 12000, headersTimeoutMs = 5000, shutdownTimeoutMs = 5000,
} = {}) {
  if (typeof store?.fetch !== 'function' || !validStateToken(token) || !configuredOrigins(origins)
      || !exactStateOrigin(publicOrigin) || typeof host !== 'string' || !host || /[\s/\\]/.test(host)
      || !integerIn(port, 0, 65535) || !integerIn(requestTimeoutMs, 10, 120000)
      || !integerIn(headersTimeoutMs, 10, 120000) || !integerIn(shutdownTimeoutMs, 10, 120000)) throw configurationError();
  const service = createStateService({ store });
  const env = Object.freeze({ MODELBRIDGE_STATE_TOKEN: token, MODELBRIDGE_STATE_ORIGINS: origins });
  const connections = new Set(), active = new Map(), handledSockets = new WeakSet();
  let closing = false, closingPromise;
  const server = createServer({ maxHeaderSize: 8192, headersTimeout: Math.min(headersTimeoutMs, requestTimeoutMs),
    requestTimeout: requestTimeoutMs, connectionsCheckingInterval: Math.min(1000, headersTimeoutMs),
    keepAliveTimeout: 1000,
  });
  server.maxHeadersCount = 64;
  server.on('connection', socket => {
    connections.add(socket);
    socket.once('close', () => connections.delete(socket));
  });
  server.on('clientError', (error, socket) => {
    if (!socket.writable || socket.destroyed) return;
    // A parser failure after a response started cannot produce a second HTTP
    // response on that connection (for example a rejected GET carrying a body).
    if (handledSockets.has(socket)) { socket.destroy(); return; }
    const status = error.code === 'HPE_HEADER_OVERFLOW' ? 431 : error.code === 'ERR_HTTP_REQUEST_TIMEOUT' ? 408 : 400;
    const reason = { 431: 'Request Header Fields Too Large', 408: 'Request Timeout', 400: 'Bad Request' }[status];
    rejectSocket(socket, status, reason);
  });
  for (const event of ['connect', 'upgrade']) server.on(event, (_request, socket) => {
    rejectSocket(socket, 405, 'Method Not Allowed');
  });
  server.on('checkContinue', (request, response) => {
    // Do not ask an unauthenticated caller to upload a body through this RPC.
    sendFailure(response, 417);
    request.pause();
  });
  server.on('request', (request, response) => {
    handledSockets.add(request.socket);
    const controller = new AbortController();
    const abort = () => { if (!controller.signal.aborted) controller.abort(); };
    const onInputClose = () => { if (!request.complete) abort(); };
    const onOutputClose = () => { if (!response.writableFinished) abort(); };
    request.once('close', onInputClose);
    // The permanent error listener avoids an unhandled transport error after a
    // bounded reader removes its own listeners while rejecting an upload.
    request.on('error', abort);
    response.once('close', onOutputClose);
    const timer = setTimeout(() => { sendFailure(response, 504); abort(); }, requestTimeoutMs);
    const work = (async () => {
      try {
        if (closing) { sendFailure(response, 503); return; }
        // Compare the raw request-target: URL normalization must not turn an
        // encoded path, absolute-form proxy target, or query into this RPC.
        if (request.url !== STATE_SERVICE_PATH) { sendFailure(response, 404); return; }
        if (request.method !== 'POST') { sendFailure(response, 405); return; }
        if (request.rawHeaders.length > 128) { sendFailure(response, 431); return; }
        const headers = new Headers();
        for (let index = 0; index < request.rawHeaders.length; index += 2) headers.append(request.rawHeaders[index], request.rawHeaders[index + 1]);
        // Reject a service credential from the headers alone. Unauthenticated
        // callers must not consume the bounded upload buffer or its deadline.
        if (!await authenticatedStateHeaders(headers, token)) { sendFailure(response, 401); return; }
        const body = await boundedInput(request, controller.signal);
        // Host and forwarding headers never select the authenticated origin.
        const incoming = new Request(publicOrigin + STATE_SERVICE_PATH, {
          method: 'POST', headers, body, signal: controller.signal,
        });
        const result = await raceAbort(service.fetch(incoming, env), controller.signal);
        const bytes = new Uint8Array(await raceAbort(result.arrayBuffer(), controller.signal));
        if (bytes.byteLength > STATE_RESPONSE_LIMIT) { sendFailure(response, 502); return; }
        if (controller.signal.aborted || response.destroyed || response.writableEnded) return;
        response.statusCode = result.status;
        for (const name of ['content-type', 'cache-control', 'x-content-type-options']) {
          const value = result.headers.get(name);
          if (value) response.setHeader(name, value);
        }
        response.setHeader('Content-Length', bytes.byteLength);
        await raceAbort(new Promise(resolveSent => response.end(bytes, resolveSent)), controller.signal);
      } catch (error) {
        if (!controller.signal.aborted) sendFailure(response, [400, 413].includes(error.status) ? error.status : 503);
      } finally {
        clearTimeout(timer);
        request.off('close', onInputClose);
        response.off('close', onOutputClose);
        // Rejected uploads are never drained without a byte/time bound.
        if (!request.complete) {
          const stopInput = () => {
            request.pause();
            // Let the final HTTP error reach a client still uploading. Destroying
            // a socket with unread input immediately can replace 413 with RST.
            request.socket.end();
            const closingTimer = setTimeout(() => request.destroy(), 250);
            closingTimer.unref();
            request.socket.once('close', () => clearTimeout(closingTimer));
          };
          if (response.destroyed) request.destroy();
          else if (response.writableFinished) stopInput();
          else response.once('finish', stopInput);
        }
      }
    })();
    active.set(work, controller);
    void work.finally(() => active.delete(work)).catch(() => {});
  });

  return {
    server,
    async listen() {
      if (closing || server.listening) throw configurationError();
      await new Promise((resolveListening, reject) => {
        const onError = () => { server.off('listening', onListening); reject(new Error('State server could not listen.')); };
        const onListening = () => { server.off('error', onError); resolveListening(); };
        server.once('error', onError); server.once('listening', onListening);
        server.listen(port, host);
      });
      return server.address();
    },
    close() {
      if (closingPromise) return closingPromise;
      closing = true;
      closingPromise = (async () => {
        const force = () => {
          for (const controller of active.values()) controller.abort();
          server.closeAllConnections();
          for (const socket of connections) socket.destroy();
        };
        const timer = setTimeout(force, shutdownTimeoutMs);
        try {
          await new Promise(resolveClosed => server.close(() => resolveClosed()));
          await Promise.allSettled([...active.keys()]);
        } finally { clearTimeout(timer); }
        let closeTimer;
        try {
          await Promise.race([
            Promise.resolve().then(() => store.close?.()),
            new Promise((_, reject) => { closeTimer = setTimeout(() => reject(new Error('State server shutdown timed out.')), shutdownTimeoutMs); }),
          ]);
        } finally { clearTimeout(closeTimer); }
      })();
      return closingPromise;
    },
  };
}

async function readTokenFile(path) {
  let file;
  try {
    file = await open(path, 'r');
    const stats = await file.stat();
    if (!stats.isFile() || stats.size > 514) throw configurationError();
    const bytes = Buffer.alloc(515);
    const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
    if (bytesRead > 514) throw configurationError();
    const token = bytes.subarray(0, bytesRead).toString('utf8').replace(/\r?\n$/, '');
    if (!validStateToken(token)) throw configurationError();
    return token;
  } catch { throw configurationError(); }
  finally { await file?.close(); }
}

export async function stateServerOptionsFromEnv(env = process.env) {
  const direct = Object.hasOwn(env, 'MODELBRIDGE_STATE_TOKEN');
  const file = Object.hasOwn(env, 'MODELBRIDGE_STATE_TOKEN_FILE');
  if (direct === file || typeof env.DB_PATH !== 'string' || !env.DB_PATH.trim()
      || !exactStateOrigin(env.MODELBRIDGE_STATE_PUBLIC_ORIGIN) || !configuredOrigins(env.MODELBRIDGE_STATE_ORIGINS)) throw configurationError();
  const token = file ? await readTokenFile(env.MODELBRIDGE_STATE_TOKEN_FILE) : env.MODELBRIDGE_STATE_TOKEN;
  if (!validStateToken(token)) throw configurationError();
  const port = env.PORT === undefined ? 8788 : /^\d+$/.test(env.PORT) ? Number(env.PORT) : NaN;
  const host = env.HOST === undefined ? '127.0.0.1' : env.HOST;
  if (!integerIn(port, 1, 65535) || !host || /[\s/\\]/.test(host)) throw configurationError();
  return { path: resolve(env.DB_PATH), token, origins: env.MODELBRIDGE_STATE_ORIGINS,
    publicOrigin: env.MODELBRIDGE_STATE_PUBLIC_ORIGIN, host, port };
}

export async function startStateServerFromEnv(env = process.env) {
  // Validate secrets before opening a database or a listening socket.
  const { path, ...options } = await stateServerOptionsFromEnv(env);
  const { createSqliteStateStore } = await import('../state/sqlite.mjs');
  const store = createSqliteStateStore({ path });
  let host;
  try {
    await store.ready;
    host = createStateServer({ ...options, store });
    await host.listen();
    return host;
  } catch {
    if (host) await host.close().catch(() => {});
    else await store.close?.();
    throw new Error('State server could not start.');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const host = await startStateServerFromEnv();
    console.log('State server is listening.');
    let stopping = false;
    const stop = async () => {
      if (stopping) return;
      stopping = true;
      try { await host.close(); process.exitCode = 0; }
      catch { console.error('State server shutdown failed.'); process.exit(1); }
    };
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
  } catch {
    console.error('State server startup failed.');
    process.exitCode = 1;
  }
}
