# Module: Access Control & State Storage

::: info Chinese Source Guide
Full source-anchored notes are maintained in Chinese at [`repo-docs/modules/access-and-config.md`](https://github.com/CyberNova2333/modelbridge/blob/main/repo-docs/modules/access-and-config.md).
:::

- **Four-Domain Isolation**: Separates `ADMIN_PASSWORD` (24h admin cookie + 15m/10-attempt lockout), client `apiKeys` (with `enabled` flag), upstream provider credentials, and `MODELBRIDGE_STATE_TOKEN`.
- **Single Authority**: Uses either Cloudflare `AppConfigStore` DO (`app-config-v1`, one-time `KV` import) or remote `/_modelbridge/state` backed by `src/state/sqlite.mjs` (`WAL`, `synchronous = FULL`, `BEGIN IMMEDIATE`, `APPLICATION_ID = 0x4d425331`, `nlink === 1`).

## English Documentation Links

- [API, Security & Routing Contracts](/en/docs/contracts)
- [Architecture Decisions & Migrations](/en/docs/migrations)
- [Architecture & Code Tour](/en/docs/architecture)
