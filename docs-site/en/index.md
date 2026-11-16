---
layout: home

hero:
  name: ModelBridge
  text: Multi-Protocol LLM Gateway
  tagline: One shared gateway core exposing OpenAI, Anthropic, and Gemini APIs across Cloudflare Workers, EdgeOne Makers, Alibaba Cloud ESA, and a self-hosted Node.js 24 + SQLite state service.
  actions:
    - theme: brand
      text: Deployment
      link: /en/docs/
    - theme: alt
      text: API & Endpoints
      link: /en/api-reference/
    - theme: alt
      text: Contracts
      link: /en/docs/contracts
    - theme: alt
      text: Architecture
      link: /en/docs/architecture

features:
  - title: Cross-Protocol Translation
    details: Serves /v1/chat/completions, /v1/completions, /v1/embeddings, /v1/messages, and /v1beta/models/* while preserving tool calls, strict mode, and signed thinking replay metadata.
  - title: Single State Authority
    details: Isolates admin passwords, client apiKeys, upstream credentials, and MODELBRIDGE_STATE_TOKEN across self-hosted SQLite (WAL) transactions or compatibility AppConfigStore DO.
  - title: Platform Budgets & Bounded Failover
    details: Enforces Cloudflare (16 MiB), Makers (1 MiB), and ESA (4 subrequests / 9s first byte / 115s total) budgets; fails over across at most 3 accounts only on 401/403/404/429.
---

::: warning AI Translation Notice
This site and documentation have been translated by an AI language model. In case of any discrepancies or ambiguities, please refer to the [Chinese documentation](/docs/) as the authoritative source.
:::

## Capabilities & Explicit Limits

::: info What ModelBridge Delivers
- **Three-Protocol Ingress & Pre-Flight Checks**: Exposes OpenAI (`/v1/chat/completions`, `/v1/completions`, `/v1/embeddings`, `/v1/models`), Anthropic `/v1/messages`, and Gemini `/v1beta/models/*` while preserving tool strictness and signed thinking replay metadata.
- **Four-Domain Secret Isolation & Single Authority**: Separates `ADMIN_PASSWORD`, `apiKeys`, upstream creds, and `MODELBRIDGE_STATE_TOKEN` across WAL SQLite or `AppConfigStore` DO, supporting explicit `upstream:<id>:<model>` pinning.
- **Platform Budget Injection & SSRF Guards**: Emits 6 platform bundles (Cloudflare `16 MiB`, Makers `1 MiB`, ESA `4`-fetch limit) and validates custom upstream `baseUrl` values via public HTTPS checks.
:::

::: warning Explicit Non-Goals & Hard Boundaries
- **Explicitly Omitted Surfaces**: Does not implement `/v1/responses` or image/audio media generation; Gemini `:countTokens` always returns `501`.
- **Advisory Discovery & No Blind 5xx Retries**: The 65-alias map and Neurons indicator are non-enforcing helpers; timeouts and `5xx` errors never fail over across accounts to avoid duplicate billing.
- **No Dual-Write State Fallback**: Never dual-writes between self-hosted SQLite and native DO; EdgeOne Makers enforces a strict `1 MiB` request cap.
:::

## Architecture Overview

<div class="archify-diagram-card" style="margin: 1.5rem 0; border: 1px solid var(--vp-c-border); border-radius: 12px; overflow: hidden; background: var(--vp-c-bg-soft); box-shadow: 0 4px 16px rgba(0,0,0,0.06);">
  <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 18px; background: var(--vp-c-bg-elv); border-bottom: 1px solid var(--vp-c-border); font-size: 13px;">
    <span style="font-weight: 600; color: var(--vp-c-text-1); display: flex; align-items: center; gap: 8px;">
      <span style="font-size: 16px;">📐</span> ModelBridge Architecture (Archify interactive diagram; pan / zoom / inspect supported)
    </span>
    <a href="/diagrams/modelbridge-architecture.html" target="_blank" rel="noreferrer" style="font-size: 12px; color: var(--vp-c-brand-1); text-decoration: none; font-weight: 500;">
      Open Fullscreen ↗
    </a>
  </div>
  <iframe src="/diagrams/modelbridge-architecture.html" width="100%" height="520px" frameborder="0" style="display: block; border: none;" allowfullscreen loading="lazy"></iframe>
</div>

## Local Quick Verification

Requires Node.js 24+ at the repository root (zero third-party runtime dependencies for the core gateway and state service):

```sh
# 1. Run syntax checks and full mocked regression tests
pnpm run check
node --test tests/*.test.mjs

# 2. Build all six deployment bundles under dist/
node tools/build-platforms.mjs

# 3. Start the self-hosted SQLite state service locally (127.0.0.1:8788)
MODELBRIDGE_STATE_TOKEN="$(openssl rand -hex 32)" pnpm run start:state
```

## Documentation Guide

::: tip Quick Navigation by Role & Goal
- **Operator / Self-Hoster**: Start with [Getting Started & Deployment](/en/docs/) and [Deployment FAQ](/en/docs/deployment-faq) for SQLite vs native DO selection, secret matrix, and Makers / ESA / Caddy setup;
- **Client / SDK Integrator**: Read [API, Security & Routing Contracts](/en/docs/contracts) for OpenAI / Anthropic / Gemini endpoints, auth headers, and `upstream:` / alias resolution;
- **Contributor / Extender**: See [Failover, Adapters & Extensions](/en/docs/adapters) for retry limits, Antigravity OAuth, and `createGateway` platform / provider adapters;
- **Architect / Auditor**: Explore [Architecture & Code Tour](/en/docs/architecture) and [Decisions & Migrations](/en/docs/migrations).
:::
