import { createGateway } from '../../_worker.js';
import { createRemoteState } from '../state/remote.mjs';
import { runPlatformRequest } from './shared.mjs';

// This entry is deliberately remote-only. Incomplete remote settings must never
// select an existing CONFIG_STORE binding or a stale KV configuration instead.
export function createCloudflareHandler({ gatewayFactory = createGateway, stateFactory = createRemoteState, fetchImpl, timers } = {}) {
  return {
    fetch(request, env, context) {
      return runPlatformRequest({
        platform: 'cloudflare', request, env, context,
        gatewayFactory, stateFactory, fetchImpl, timers,
      });
    },
  };
}

export default createCloudflareHandler();
