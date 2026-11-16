# Module: Platform Adapters & Self-Hosted State

::: info Chinese Source Guide
Full source-anchored notes are maintained in Chinese at [`repo-docs/modules/platform-adapters.md`](https://github.com/CyberNova2333/modelbridge/blob/main/repo-docs/modules/platform-adapters.md).
:::

- **Platform Entrypoints**: `src/platforms/cloudflare.mjs`, `edgeone.mjs`, `esa.mjs` delegate via `runPlatformRequest` in `src/platforms/shared.mjs`, injecting `PLATFORM_LIMITS` (`16 MiB` CF, `1 MiB` Makers, `4` fetches / `9000ms` first byte / `115000ms` total ESA).
- **Packaging & Self-Hosted Service**: `tools/build-platforms.mjs` outputs six `dist/` directories; `src/self-hosted/server.mjs` exposes `/_modelbridge/state` on `127.0.0.1:8788` by default behind TLS reverse proxies (`deploy/self-hosted-state/Caddyfile` with `protocols h1` and `lb_retries 0`).

## English Documentation Links

- [Getting Started & Multi-Platform Deployment](/en/docs/)
- [Deployment & Operations FAQ](/en/docs/deployment-faq)
- [Architecture & Code Tour](/en/docs/architecture)
