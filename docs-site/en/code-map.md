# Code Map & Source Navigation

::: info Chinese Source Guide
The full line-anchored code map is maintained in Chinese at [`repo-docs/code-map.md`](https://github.com/CyberNova2333/modelbridge/blob/main/repo-docs/code-map.md). Switch the site language switcher to **简体中文** to browse it rendered in-site.
:::

## Repository Layout Overview

| Path | Role |
| :--- | :--- |
| `_worker.js` | Shared gateway core: portal `/`, admin `/admin`, 4-domain auth, `AppConfigStore` DO, routing, protocol conversion, `fetchUpstream` |
| `src/platforms/` | `cloudflare.mjs`, `edgeone.mjs`, `esa.mjs`, `shared.mjs` (`PLATFORM_LIMITS` & runtime adapters) |
| `src/state/` | `remote.mjs` (`2 MiB`/`16 MiB` RPC), `service.mjs` (DO RPC server), `sqlite.mjs` (`node:sqlite` WAL + `BEGIN IMMEDIATE`) |
| `src/self-hosted/server.mjs` | Node.js 24 state service (`127.0.0.1:8788`, `/_modelbridge/state`, strict Origin & token enforcement) |
| `tools/` | `build-platforms.mjs`, `state-admin.mjs`, `verify-*.mjs`, `repo_maintenance_guard.py` |
| `deploy/` | Templates for `cloudflare`, `cloudflare-remote`, `edgeone`, `esa`, `state-service`, `self-hosted-state` (`compose.yaml`, `Caddyfile`) |
| `tests/` | Mocked Node.js test suite (`node --test tests/*.test.mjs`) |

## Related English Pages

- [3. Architecture & Code Tour](/en/docs/architecture)
- [One Real Run Walkthrough](/en/walkthroughs/one-real-run)
- [Module: Access & Config](/en/modules/access-and-config) · [Routing & Protocols](/en/modules/routing-and-protocols) · [Upstream & Quota](/en/modules/upstream-and-quota) · [Platform Adapters](/en/modules/platform-adapters)
