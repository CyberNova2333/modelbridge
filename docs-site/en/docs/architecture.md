# 3. Architecture & Code Tour

::: warning AI Translation Notice
This page is an English translation of the [authoritative Chinese architecture guide](/docs/architecture). Refer to the Chinese version in case of discrepancies.
:::

ModelBridge separates **shared gateway core logic** (`_worker.js`), **platform runtime adapters** (`src/platforms/`), **remote/SQLite state primitives** (`src/state/` & `src/self-hosted/`), and **packaging/admin tooling** (`tools/`).

## Interactive Architecture Diagram

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

## Module Responsibilities & Source Guide Index

| Module / Path | Responsibility | Source Reference |
| :--- | :--- | :--- |
| `_worker.js` | Portal/admin UI, 4-domain auth, `AppConfigStore` DO, routing, protocol translation, `fetchUpstream` | `repo-docs/walkthroughs/one-real-run.md` |
| `src/platforms/` | `cloudflare.mjs`, `edgeone.mjs`, `esa.mjs`, `shared.mjs` (`PLATFORM_LIMITS` & `runPlatformRequest`) | `repo-docs/modules/platform-adapters.md` |
| `src/state/` | `remote.mjs` (`2 MiB`/`16 MiB` RPC), `service.mjs` (DO RPC server), `sqlite.mjs` (WAL + `BEGIN IMMEDIATE`) | `repo-docs/modules/access-and-config.md` |
| `src/self-hosted/server.mjs` | Node.js 24 state HTTP service (`127.0.0.1:8788`, `/_modelbridge/state`, strict origin/token checks) | `repo-docs/modules/platform-adapters.md` |
| `tools/` | `build-platforms.mjs` (6 `dist/` bundles), `state-admin.mjs`, `verify-*.mjs`, `repo_maintenance_guard.py` | [Code Map & Module Reference](/en/code-map) |

> Detailed source-verified guides live in Chinese under `repo-docs/` in the repository; browse the English navigation stubs at [Source Guide Index](/en/walkthroughs/one-real-run) and [Code Map Reference](/en/code-map).

## Contributor Workflow & Guards

```sh
pnpm run check
node --test tests/*.test.mjs
node tools/build-platforms.mjs
```

- Commits are checked by `tools/repo_maintenance_hooks` (`tools/repo_maintenance_guard.py`) for Conventional Commit subjects and accidental secret/local-path leakage. Never bypass hooks with `--no-verify`.
- See `CONTRIBUTING.md` and `SECURITY.md` at the repository root for contribution and vulnerability disclosure policies.

## Next Steps

- Read key architectural decisions and the DO-to-SQLite migration runbook in [Architecture Decisions & Migrations](/en/docs/migrations).
