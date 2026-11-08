import {
  STATE_SERVICE_PATH, STATE_REQUEST_LIMIT, StatePayloadError,
  boundedStateResponse, exactStateOrigin, readStateJson, stateError,
  validStateRoute, validStateToken,
} from './remote.mjs';

export { AppConfigStore } from '../../_worker.js';

const encoder = new TextEncoder();
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const onlyKeys = (value, keys) => isObject(value) && Object.keys(value).every(key => keys.includes(key));
const hashPattern = /^[a-f0-9]{64}$/;
const validHash = value => typeof value === 'string' && hashPattern.test(value);
const validId = id => typeof id === 'string' && id.length > 0 && id.length <= 512;

async function sha256(value) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
}

async function equalToken(supplied, expected) {
  if (!validStateToken(supplied)) return false;
  const [left, right] = await Promise.all([sha256(supplied), sha256(expected)]);
  let difference = 0;
  for (let index = 0; index < left.length; index++) difference |= left[index] ^ right[index];
  return difference === 0;
}

export function authenticatedStateHeaders(headers, expectedToken) {
  const token = headers.get('authorization')?.match(/^Bearer ([\x21-\x7e]+)$/)?.[1];
  return equalToken(token, expectedToken);
}

export function configuredOrigins(value) {
  if (typeof value !== 'string' || !value || value.length > 16384) return null;
  const origins = value.split(',').map(origin => origin.trim());
  return origins.length <= 64 && origins.every(exactStateOrigin) ? new Set(origins) : null;
}

function validConfigOperation(body) {
  if (!isObject(body)) return false;
  switch (body.type) {
    case 'account.upsert':
      return onlyKeys(body, ['type', 'account', 'expectedAccountRevision', 'antigravityProject']) && isObject(body.account)
        && (body.expectedAccountRevision === undefined || validHash(body.expectedAccountRevision))
        && (body.antigravityProject === undefined || (onlyKeys(body.antigravityProject, ['projectId', 'projectSource', 'projectIdentity'])
          && typeof body.antigravityProject.projectId === 'string'
          && ['auto', 'manual'].includes(body.antigravityProject.projectSource)
          && validHash(body.antigravityProject.projectIdentity)));
    case 'account.delete':
    case 'key.delete':
      return onlyKeys(body, ['type', 'id']) && validId(body.id);
    case 'key.add':
      return onlyKeys(body, ['type', 'key']) && onlyKeys(body.key, ['id', 'name', 'key', 'createdAt'])
        && validId(body.key.id) && typeof body.key.name === 'string' && !!body.key.name
        && typeof body.key.key === 'string' && !!body.key.key
        && typeof body.key.createdAt === 'string' && Number.isFinite(Date.parse(body.key.createdAt));
    case 'models.replace':
      return onlyKeys(body, ['type', 'map']) && isObject(body.map)
        && Object.values(body.map).every(value => typeof value === 'string' && !!value.trim());
    default: return false;
  }
}

async function validAuthOperation(body, origin) {
  if (!onlyKeys(body, ['type', 'token', 'ipKey', 'scope', 'fingerprint', 'passwordMatched'])
      || !['login', 'verify', 'logout'].includes(body.type) || !validHash(body.scope)
      || !validHash(body.fingerprint) || typeof body.passwordMatched !== 'boolean') return false;
  const scope = Array.from(await sha256('admin-origin-v3:' + origin), byte => byte.toString(16).padStart(2, '0')).join('');
  if (scope !== body.scope) return false;
  if (body.type === 'login') return validHash(body.ipKey) && body.token === undefined;
  return typeof body.token === 'string' && /^as2_[a-f0-9]{64}$/.test(body.token)
    && body.passwordMatched === false && body.ipKey === undefined;
}

async function forwardEnvelope(envelope, store, origins, signal) {
  if (!onlyKeys(envelope, ['path', 'method', 'body', 'origin'])
      || !Object.hasOwn(envelope, 'body') || !validStateRoute(envelope.path, envelope.method)
      || !exactStateOrigin(envelope.origin) || !origins.has(envelope.origin)) return stateError(400);
  const { path, method, body, origin } = envelope;
  if (path === '/auth') {
    if (!await validAuthOperation(body, origin)) return stateError(400);
  } else if (path === '/' && method === 'POST') {
    if (!validConfigOperation(body)) return stateError(400);
  } else if (body !== null) return stateError(400);
  return store.fetch(new Request('https://config.internal' + path, {
    method, signal,
    ...(body === null ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  }));
}

// Authentication and envelope validation are independent of the storage host.
// The store receives only validated internal requests, never arbitrary URLs.
export function createStateService({ store } = {}) {
  return { async fetch(request, env = {}) {
    try {
      const url = new URL(request.url);
      if (url.pathname !== STATE_SERVICE_PATH || url.search || url.hash) return stateError(404);
      if (request.method !== 'POST') return stateError(405);
      if (url.protocol !== 'https:') return stateError(400);
      const origins = configuredOrigins(env.MODELBRIDGE_STATE_ORIGINS);
      if (!validStateToken(env.MODELBRIDGE_STATE_TOKEN) || !origins || typeof store?.fetch !== 'function') return stateError(503);
      if (!await authenticatedStateHeaders(request.headers, env.MODELBRIDGE_STATE_TOKEN)) return stateError(401);
      // Browser cookies and Origin headers confer no service permission. A service
      // token is binding-equivalent authority, including reading upstream secrets.
      if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || '')) return stateError(415);
      return boundedStateResponse(async signal => {
        let envelope;
        try { envelope = await readStateJson(request, STATE_REQUEST_LIMIT, signal); }
        catch (error) { return stateError(error instanceof StatePayloadError ? error.status : 400); }
        return forwardEnvelope(envelope, store, origins, signal);
      }, { timeoutMs: 12000, signal: request.signal });
    } catch {
      return stateError(503);
    }
  } };
}

// Existing Cloudflare deployments retain their binding and object identity.
export default {
  fetch(request, env = {}) {
    const binding = env.CONFIG_STORE;
    const store = typeof binding?.get === 'function' && typeof binding?.idFromName === 'function'
      ? { fetch: input => binding.get(binding.idFromName('app-config-v1')).fetch(input) } : undefined;
    return createStateService({ store }).fetch(request, env);
  },
};
