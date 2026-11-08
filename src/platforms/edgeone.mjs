import { createGateway } from '../../_worker.js';
import { createRemoteState } from '../state/remote.mjs';
import { runPlatformRequest } from './shared.mjs';

export function createEdgeOneHandler({ gatewayFactory = createGateway, stateFactory = createRemoteState, fetchImpl, timers } = {}) {
  return function onRequest(context) {
    return runPlatformRequest({
      platform: 'edgeone', request: context.request, env: context.env, context,
      gatewayFactory, stateFactory, fetchImpl, timers,
    });
  };
}

export const onRequest = createEdgeOneHandler();
export default onRequest;
