# Architecture Decisions & Migration Guide

::: warning AI Translation Notice
This page is an English translation of the [authoritative Chinese ADR & migration guide](/docs/migrations). Refer to the Chinese version in case of discrepancies.
:::

## Key Architecture Decisions (ADRs)

1. **ADR-001 — Single State Authority**: Each deployment binds exclusively to either native `AppConfigStore` DO or a remote state host (`MODELBRIDGE_STATE_URL`). Missing bindings/secrets fail closed with `503` instead of falling back across authorities. Remote RPC caps payloads at `2 MiB` (`STATE_REQUEST_LIMIT`) / `16 MiB` (`STATE_RESPONSE_LIMIT`).
2. **ADR-002 — One-Time KV Bootstrap**: `KV` is checked only during initial `AppConfigStore` (`app-config-v1`) startup to import legacy `config`; all ongoing mutations serialize inside DO storage or SQLite WAL (`synchronous = FULL`, `BEGIN IMMEDIATE`).
3. **ADR-003 — Explicit-Rejection Failover Only**: `shouldRetryUpstream` tries at most 3 shuffled accounts exclusively on `401/403/404/429`. Timeouts (`120s`), `5xx`, `> 32 MiB` responses, and invalid `200` payloads abort immediately, paired with Caddy `lb_retries 0`.
4. **ADR-004 — Explicit Platform Budgets**: `PLATFORM_LIMITS` injects `1 MiB` body caps (Makers) and `4`-fetch / `9s` / `115s` limits (ESA) into the request runtime so limits fail cleanly before isolate termination.
5. **ADR-005 — Hardened Self-Hosted State**: `src/self-hosted/server.mjs` binds loopback `127.0.0.1:8788`, verifies `nlink === 1` and `APPLICATION_ID = 0x4d425331`, enforces `MODELBRIDGE_STATE_TOKEN` XOR `_FILE`, and validates exact HTTPS `MODELBRIDGE_STATE_ORIGINS`.

## Migration Runbook: Cloudflare `state-service` / DO -> Self-Hosted SQLite

Use [`tools/state-admin.mjs`](https://github.com/CyberNova2333/modelbridge/blob/main/tools/state-admin.mjs):

```sh
# 1. Export full config from the running remote state endpoint
MODELBRIDGE_STATE_URL="https://state.example/_modelbridge/state" \
MODELBRIDGE_STATE_TOKEN="<32-to-512-char-token>" \
MODELBRIDGE_STATE_EXPORT_ORIGIN="https://gateway.example" \
node tools/state-admin.mjs export-remote --out ./migration-config.json

# 2. Import into a fresh, empty SQLite database (<= 16 MiB + 1 KiB file envelope)
node tools/state-admin.mjs import \
  --db ./data/modelbridge.sqlite \
  --file ./migration-config.json

# 3. Create an online consistent snapshot (DELETE-mode single file) for routine backups
node tools/state-admin.mjs backup \
  --db ./data/modelbridge.sqlite \
  --out ./backups/modelbridge-snapshot.sqlite
```

> Export files contain plaintext upstream secrets and `apiKeys`; store in restricted paths and remove after import.

4. Start `dist/self-hosted-state/` behind your HTTPS proxy, add all gateway HTTPS origins to `MODELBRIDGE_STATE_ORIGINS`, point `MODELBRIDGE_STATE_URL` on each edge deployment to the new endpoint, and verify `/admin` plus one live key-revocation cycle.
