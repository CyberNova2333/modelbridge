# Getting Started & Multi-Platform Deployment

::: warning AI Translation Notice
This page is an English translation of the [authoritative Chinese deployment documentation](/docs/). Refer to the Chinese version in case of discrepancies.
:::

**ModelBridge** serves **OpenAI, Anthropic, and Gemini** client endpoints from a single shared gateway core (`_worker.js`), ships a Primer-styled portal `/` and admin console `/admin`, and adapts across **Cloudflare Workers, EdgeOne Makers, Alibaba Cloud ESA**, and a **self-hosted Node.js 24 + SQLite** state service.

## Capability Scope & Boundaries

| Area | Implemented Behavior | Explicit Boundaries |
| :--- | :--- | :--- |
| **OpenAI Ingress** | `GET /v1/models`, `POST /v1/chat/completions`, `POST /v1/completions`, `POST /v1/embeddings` | Does not implement `/v1/responses`, image generation/editing, or audio TTS/STT endpoints |
| **Anthropic Ingress** | `POST /v1/messages` (with tool calling and SSE delta translation) | Rejects unrepresentable cross-protocol parameters pre-flight instead of silently dropping them |
| **Gemini Ingress** | `/v1beta/models/<id>:*` and `/v1/models/<id>:*` (`:generateContent`, `:streamGenerateContent`, `:embedContent`, `:batchEmbedContents`) | `:countTokens` returns `501`; no exact cross-provider token counting |
| **State Authority** | Self-hosted SQLite (WAL + `BEGIN IMMEDIATE`) or Cloudflare `AppConfigStore` DO | Single authority per deployment; no dual-write or silent runtime fallback |
| **Presets & Reference Usage** | `cloudflare-model-map.json` (65 `@cf/...` aliases) + 5-minute cached Neurons indicator | Discovery and display helpers only; not a hard server-side billing cap |

> Want interactive schemas and runnable requests for OpenAI, Anthropic, Gemini, `/api/*`, and `/_modelbridge/state`? Jump to the [API & Component Reference](/en/api-reference/).

## Local Verification & Quick Build

Requires **Node.js 24+** at the repository root (zero third-party runtime npm dependencies):

```sh
pnpm run check
node --test tests/*.test.mjs
node tools/build-platforms.mjs
```

### Recommended Production Topology: Self-Hosted State + Stateless Edge Gateways

1. **Start the Node.js 24 + SQLite state service** (local example):

```sh
MODELBRIDGE_STATE_TOKEN="$(openssl rand -hex 32)" \
DB_PATH=./data/modelbridge.sqlite \
MODELBRIDGE_STATE_PUBLIC_ORIGIN=https://state.example \
MODELBRIDGE_STATE_ORIGINS=https://gateway.example \
pnpm run start:state
```

2. **Front with HTTPS reverse proxy**: Expose fixed path `/_modelbridge/state` over TLS (see `deploy/self-hosted-state/Caddyfile`) while keeping Node bound to `127.0.0.1:8788`.
3. **Deploy stateless gateway bundle**: Deploy `dist/cloudflare-remote/`, `dist/edgeone/`, or `dist/esa/` with runtime secrets `ADMIN_PASSWORD`, `MODELBRIDGE_STATE_URL` (`https://state.example/_modelbridge/state`), and the matching `MODELBRIDGE_STATE_TOKEN`.
4. **Configure `/admin`**: Sign in with `ADMIN_PASSWORD`, add upstream accounts (`cloudflare`, `openai`, `anthropic`, `gemini`, `antigravity`), and issue client `apiKeys`.

## Multi-Platform Deployment Matrix

`node tools/build-platforms.mjs` generates six standalone projects under `dist/`:

| Bundle (`dist/`) | Target Runtime | State Authority | Injected Platform Limits (`src/platforms/`) | Template & Manifest |
| :--- | :--- | :--- | :--- | :--- |
| `self-hosted-state` | Linux container / Node.js 24 | Local SQLite (`WAL`, `synchronous=FULL`, `APPLICATION_ID=0x4d425331`) | `2 MiB` request / `16 MiB` response; `usageTimeoutMs = 15000` | [deploy/self-hosted-state/README.md](https://github.com/CyberNova2333/modelbridge/blob/main/deploy/self-hosted-state/README.md) (`compose.yaml` + `Caddyfile`) |
| `cloudflare-remote` | Cloudflare Workers (stateless) | Remote HTTPS state service (`/_modelbridge/state`) | `16 MiB` request body | `deploy/cloudflare-remote/` (no KV or DO binding) |
| `edgeone` | Tencent Cloud EdgeOne Makers | Remote HTTPS state service (`/_modelbridge/state`) | **`1 MiB` request body cap** | `deploy/edgeone/edgeone.json` (`outputDirectory: "./public"`) |
| `esa` | Alibaba Cloud ESA Edge Routine | Remote HTTPS state service (`/_modelbridge/state`) | `16 MiB` body, **`4` outbound fetches**, `9000ms` first byte, `115000ms` total | `deploy/esa/esa.jsonc` (`entry: "./worker.js"`) |
| `state-service` | Cloudflare Workers state host | Cloudflare `AppConfigStore` DO | Same `2 MiB` / `16 MiB` state RPC limits | `deploy/state-service/wrangler.toml` (`CONFIG_STORE`) |
| `cloudflare` | Cloudflare Workers native | Embedded `AppConfigStore` DO (one-time KV import) | `16 MiB` request body | `wrangler.toml` / `deploy/cloudflare/` |

> **Caddy Proxy Requirement**: Keep `protocols h1` and `lb_retries 0` in `deploy/self-hosted-state/Caddyfile` so proxy retries never replay upstream generation or state mutations.

## Native Cloudflare DO & Pages Compatibility

The root `_worker.js` + `wrangler.toml` setup (`name = "aigateway"`, `compatibility_date = "2026-06-30"`, `compatibility_flags = ["global_fetch_strictly_public", "enable_request_signal"]`, `observability.redact_query_string = true`) runs natively with:
- **`CONFIG_STORE` -> `AppConfigStore`**: SQLite-backed Durable Object (`new_sqlite_classes`, singleton name `app-config-v1`). `KV` is read at most once on initial DO bootstrap.
- **Cloudflare Pages**: When binding a DO exported by an external Worker, explicitly add `script_name` under `durable_objects.bindings` in your Pages `wrangler.toml`.
- **`cloudflare-model-map.json`**: Provides 65 default `@cf/...` model aliases aligned with `DEFAULT_MODEL_MAP` in `_worker.js`.

## Environment Variables & Secrets Matrix

### Gateway Platform Variables

| Variable | Modes | Required | Constraints |
| :--- | :--- | :--- | :--- |
| `ADMIN_PASSWORD` | All gateway modes | Yes | Admin `/admin` password; `/api/*` fails closed with `503` if unset |
| `MODELBRIDGE_STATE_URL` | `cloudflare-remote`, `edgeone`, `esa` | Remote only | Exact `https://<host>/_modelbridge/state` URL without query, fragment, or userinfo |
| `MODELBRIDGE_STATE_TOKEN` | Remote gateways & state hosts | Remote only | 32–512 printable non-space ASCII characters shared across gateway and state host |
| `KV` / `CONFIG_STORE` | Native Cloudflare DO | DO mode only | Wrangler bindings required for DO initialization and state storage |

### Self-Hosted State & CLI Variables

| Variable | Scope | Notes |
| :--- | :--- | :--- |
| `DB_PATH` | `self-hosted-state` | SQLite path; checks `nlink === 1` and `APPLICATION_ID = 0x4d425331` on existing files |
| `MODELBRIDGE_STATE_PUBLIC_ORIGIN` | `self-hosted-state` | Exact HTTPS origin (e.g., `https://state.example`, no trailing slash) |
| `MODELBRIDGE_STATE_ORIGINS` | `self-hosted-state` & `state-service` | Comma-separated exact HTTPS gateway origins; no wildcards or trailing slashes |
| `MODELBRIDGE_STATE_TOKEN` / `_FILE` | `self-hosted-state` | Specify **exactly one** (`_FILE` mounts `/run/secrets/state_token` in Compose) |
| `HOST` / `PORT` | `self-hosted-state` | Bind host and port (defaults: `127.0.0.1`, `8788`) |
| `STATE_DOMAIN` | `compose.yaml` | Bare hostname used by Compose to construct `MODELBRIDGE_STATE_PUBLIC_ORIGIN` |
| `MODELBRIDGE_STATE_EXPORT_ORIGIN` | `tools/state-admin.mjs export-remote` | HTTPS origin sent during remote config export; must appear in `MODELBRIDGE_STATE_ORIGINS` |
| `ANTIGRAVITY_*` / `OAUTH_CLIENT_*` | Worker env fallback | Optional fallback (`ANTIGRAVITY_REFRESH_TOKEN`, `ANTIGRAVITY_API_KEY`, `ANTIGRAVITY_ACCOUNTS`, `ACCOUNTS_JSON`, `ANTIGRAVITY_EMAIL`, `ANTIGRAVITY_PROJECT_ID`, `OAUTH_CLIENT_ID`, `OAUTH_CLIENT_SECRET`) |

## Next Steps

- Hit a `503`, `401`, `413`, or SQLite startup failure? Check [Deployment & Operations FAQ](/en/docs/deployment-faq).
- Integrating client SDKs? Read [API, Security & Routing Contracts](/en/docs/contracts).
