# Module: Upstream Invocation, OAuth & Quota

::: info Chinese Source Guide
Full source-anchored notes are maintained in Chinese at [`repo-docs/modules/upstream-and-quota.md`](https://github.com/CyberNova2333/modelbridge/blob/main/repo-docs/modules/upstream-and-quota.md).
:::

- **Bounded Failover**: `shouldRetryUpstream` fails over across up to 3 shuffled candidates only on explicit `401/403/404/429` rejections; `fetchUpstream` enforces `120s` header/idle timeouts and a `32 MiB` response cap.
- **Providers & Reference Counters**: Supports `cloudflare`, `antigravity`, `openai`, `anthropic`, and `gemini`; Cloudflare 24h reference Neurons counters cache for 5 minutes and do not enforce billing hard locks.

## English Documentation Links

- [Failover, Adapters & Extensions](/en/docs/adapters)
- [Architecture & Code Tour](/en/docs/architecture)
