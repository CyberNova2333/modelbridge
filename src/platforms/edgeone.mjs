// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of ModelBridge · 模桥 and is licensed under GNU AGPLv3 with Additional Terms (see LICENSE and ADDITIONAL_TERMS.zh-CN.md; ref: ADDITIONAL_TERMS.en.md).
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
