# Glossary (English Index)

::: info Chinese Source Guide
The complete three-column glossary is maintained in Chinese at [`repo-docs/glossary.md`](https://github.com/CyberNova2333/modelbridge/blob/main/repo-docs/glossary.md).
:::

| Term | Meaning in ModelBridge |
| :--- | :--- |
| **`AppConfigStore` DO** | SQLite-backed Cloudflare Durable Object (`app-config-v1`) acting as native single configuration authority |
| **`self-hosted-state`** | Node.js 24 + SQLite (`WAL`, `synchronous=FULL`) state service exposed on `/_modelbridge/state` |
| **`PLATFORM_LIMITS`** | Per-platform payload, subrequest, and timeout caps injected by `src/platforms/shared.mjs` |
| **Four-Domain Isolation** | Separation of `ADMIN_PASSWORD`, `apiKeys`, upstream credentials, and `MODELBRIDGE_STATE_TOKEN` |
| **Bounded Failover** | Up to 3 shuffled candidates on `401/403/404/429` rejections only; zero retries on timeouts or `5xx` |

## English Documentation Links

- [Architecture & Code Tour](/en/docs/architecture)
- [API, Security & Routing Contracts](/en/docs/contracts)
