# One Real Run Walkthrough (Source Guide)

::: info Chinese Source Guide
The line-referenced walkthrough is maintained in Chinese at [`repo-docs/walkthroughs/one-real-run.md`](https://github.com/CyberNova2333/modelbridge/blob/main/repo-docs/walkthroughs/one-real-run.md) in the repository. Switch the site language switcher to **简体中文** to inspect the rendered page in-site.
:::

## Summary of Request Lifecycle

1. **Platform Entry (`src/platforms/{cloudflare,edgeone,esa}.mjs`)**: Injects platform limits (`PLATFORM_LIMITS`) and runtime state bindings via `runPlatformRequest`, then calls `createGateway(runtime).fetch(...)` in `_worker.js`.
2. **Auth & Limits**: Enforces ingress size limits (`API_JSON_LIMIT` 16 MiB; EdgeOne `1 MiB`), checks client `apiKeys` against the active state authority (`AppConfigStore` DO or remote `STATE_SERVICE_PATH`), and validates payload/replay contracts (`validateReplayMetadata`, `validateToolStrictness`).
3. **Model Resolution & Dispatch**: `resolveModelName` handles `upstream:<accountId>:<model>`, `@cf/`, provider prefixes, custom `modelMap`, and the 65-entry `DEFAULT_MODEL_MAP`.
4. **Bounded Upstream Fetch (`fetchUpstream`)**: Applies `120s` header/idle timeouts and `32 MiB` response caps, failing over across at most 3 shuffled candidate accounts only on explicit `401/403/404/429`.

## English Documentation Links

- [Architecture & Code Tour](/en/docs/architecture)
- [API, Security & Routing Contracts](/en/docs/contracts)
- [Code Map & Module Reference](/en/code-map)
