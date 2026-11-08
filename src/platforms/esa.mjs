import { createGateway } from '../../_worker.js';
import { createRemoteState } from '../state/remote.mjs';
import { runPlatformRequest } from './shared.mjs';

export function createEsaHandler({ gatewayFactory = createGateway, stateFactory = createRemoteState, fetchImpl, timers } = {}) {
  return {
    // ESA uses request/context/env, unlike Cloudflare's request/env/context.
    fetch(request, context, env) {
      return runPlatformRequest({
        platform: 'esa', request, env, context,
        gatewayFactory, stateFactory, fetchImpl, timers,
      });
    },
  };
}

export default createEsaHandler();
