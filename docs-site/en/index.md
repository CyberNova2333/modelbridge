---
layout: home

hero:
  name: ModelBridge
  text: Multi-Protocol LLM Gateway
  tagline: One shared gateway core exposing OpenAI, Anthropic, and Gemini APIs across Cloudflare Workers, EdgeOne Makers, Alibaba Cloud ESA, and a self-hosted Node.js 24 + SQLite state service.
  actions:
    - theme: brand
      text: 1. Deployment
      link: /en/docs/
    - theme: alt
      text: 2. Contracts
      link: /en/docs/contracts
    - theme: alt
      text: 3. Architecture
      link: /en/docs/architecture
    - theme: alt
      text: GitHub Repo
      link: https://github.com/CyberNova2333/modelbridge

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

## Quick Entry by Role & Goal

| Role / Goal | What You Will Find | Entry Point |
| :--- | :--- | :--- |
| **Operator / Self-Hoster** | Self-hosted SQLite vs native DO selection, secret matrix, Makers / ESA / Caddy setup | [1. Getting Started & Deployment](/en/docs/) · [Deployment FAQ](/en/docs/deployment-faq) |
| **Client / SDK Integrator** | OpenAI / Anthropic / Gemini endpoints, auth headers, `upstream:` & alias resolution | [2. API, Security & Routing Contracts](/en/docs/contracts) |
| **Contributor / Extender** | Retry limits, Antigravity OAuth, `createGateway` platform & provider adapters | [2. Failover, Adapters & Extensions](/en/docs/adapters) |
| **Architect / Auditor** | Interactive topology diagram, DO-to-SQLite migration runbook, ADRs & source index | [3. Architecture & Code Tour](/en/docs/architecture) · [Decisions & Migrations](/en/docs/migrations) |

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
