# 2. API, Security & Routing Contracts

::: warning AI Translation Notice
This page is an English translation of the [authoritative Chinese contracts guide](/docs/contracts). Refer to the Chinese version in case of discrepancies.
:::

## Four-Credential Security Isolation

ModelBridge strictly separates all secrets into four non-interchangeable domains:

| Credential Domain | Purpose | Enforcement & Lifetimes |
| :--- | :--- | :--- |
| **Admin Password (`ADMIN_PASSWORD`)** | Sign in to `/admin` and manage `/api/*` | Issues **24-hour** admin sessions (`ADMIN_SESSION_TTL`); **15-minute** (`ADMIN_LOGIN_WINDOW`) lockout after **10** failed attempts (`ADMIN_LOGIN_ATTEMPTS`). Never authorizes inference calls. |
| **Client API Keys (`apiKeys`)** | Authenticate `/v1/*`, `/v1beta/models/*`, and `/v1/models/*` | Individual `enabled` flag revokes access immediately; no `/api/*` management privileges. |
| **Upstream Credentials** | Outbound authentication to Cloudflare, OpenAI, Anthropic, Gemini, Antigravity | Masked in admin responses and stripped from upstream error strings; changing account `provider` requires re-entering a fresh secret. |
| **Service Token (`MODELBRIDGE_STATE_TOKEN`)** | Edge-to-state RPC at `/_modelbridge/state` | 32–512 printable non-space ASCII chars paired with exact `MODELBRIDGE_STATE_ORIGINS` verification. |

### Client Auth Headers

- **OpenAI routes**: `Authorization: Bearer <client-api-key>`
- **Anthropic `/v1/messages`**: `x-api-key` or `Authorization: Bearer <client-api-key>`
- **Gemini `/v1beta/models/*` & `/v1/models/*`**: `x-goog-api-key` or `Authorization: Bearer <client-api-key>` (`wrangler.toml` enables `observability.redact_query_string = true`; always prefer headers over query parameters).

## Supported Endpoints & Size Limits

- **OpenAI**: `GET /v1/models`, `POST /v1/chat/completions`, `POST /v1/completions`, `POST /v1/embeddings`
- **Anthropic**: `POST /v1/messages`
- **Gemini**: `/v1beta/models/<id>:*` and `/v1/models/<id>:*` (`:generateContent`, `:streamGenerateContent`, `:embedContent`, `:batchEmbedContents`); **`:countTokens` returns `501`**.
- **Admin & Portal**: `GET /`, `GET /admin`, `GET /robots.txt`, `/api/auth/{status,setup,login,logout}`, `/api/usage/summary`, `/api/accounts`, `/api/accounts/test`, `/api/accounts/usage`, `/api/keys`, `/api/settings`.

| Boundary | Limit |
| :--- | :--- |
| `/api/auth/login` & `setup` JSON | `16 KiB` (`LOGIN_JSON_LIMIT`) |
| `/api/*` admin JSON | `1 MiB` (`ADMIN_JSON_LIMIT`) |
| Client inference body | `16 MiB` (`API_JSON_LIMIT`; **`1 MiB`** on EdgeOne Makers) |
| Remote state RPC | `2 MiB` request (`STATE_REQUEST_LIMIT`) / `16 MiB` response (`STATE_RESPONSE_LIMIT`) |
| Upstream response (`fetchUpstream`) | `32 MiB` max bytes, `120s` header & body idle timeout |

### Custom Upstream `baseUrl` Validation (`validateProviderBaseUrl`)

For `openai` (`https://api.openai.com/v1`), `anthropic` (`https://api.anthropic.com/v1`), and `gemini` (`https://generativelanguage.googleapis.com/v1beta`) accounts:
- Requires public `https://` URLs (`http://` permitted strictly on `localhost`, `127.0.0.1`, `[::1]`).
- Rejects `0.0.0.0`, private/link-local IPv4 ranges (`10.*`, `127.*`, `169.254.*`, `192.168.*`, `172.16.0.0/12`), `.localhost`/`.local`/`.internal`, IPv6 `fc`/`fd`/`fe80+`, userinfo credentials, queries, and fragments.

## Routing Precedence & Semantic Checks

1. **`upstream:<accountId>:<model>`**: Explicitly pins the request to a specific upstream account ID and model string.
2. **`@cf/...` or provider prefix**: Passes through explicit provider/Workers AI identifiers.
3. **Custom `modelMap` & `cloudflare-model-map.json`**: Checks admin overrides, then the 65 built-in `@cf/...` defaults. **`modelMap` is not an access-control allowlist** — use per-account `models` declarations to restrict allowed models.
4. **Pre-flight Rejection & Replay Integrity**:
   - `convertAnthropicToOpenAI` enforces `rejectAnthropicProviderTools` + `validateToolStrictness` and returns `400` if Anthropic `thinking`, `output_config`, or `output_format` is routed to an incompatible upstream.
   - `validateReplayMetadata` accepts `gemini_parts` and assistant-only `anthropic_content`, verifying exact equality against visible `message.content`, `reasoning_content`, and `tool_calls`.

## Next Steps

- Learn bounded failover and how to add adapters in [2. Failover, Adapters & Extensions](/en/docs/adapters).
