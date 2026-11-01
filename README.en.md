# ModelBridge

[简体中文](README.md) | **English**

![ModelBridge](assets/modelbridge-logo.svg)

ModelBridge is a multi-model, multi-protocol API gateway for Cloudflare Workers. Configure upstream accounts and model aliases, then use OpenAI, Anthropic or Gemini client interfaces to call supported models. Its blue management interface handles accounts, gateway keys and Cloudflare usage.

Based on [WorkersAI2API](https://github.com/cmliussss2024/WorkersAI2API), it supports Cloudflare Workers AI, OpenAI-compatible services, Anthropic, Gemini and an experimental Antigravity (Google Cloud Code) integration. Pages deployments also require a Durable Object hosted by a Worker.

Brand assets: [horizontal logo](assets/modelbridge-logo.svg) · [square icon](assets/modelbridge-icon.svg). The website name is set by `PROJECT_DISPLAY_NAME`, independently of the Wrangler Worker service name.

### Interface preview

These screenshots use local demonstration data.

![Public homepage](img/1.png)

![Management interface](img/2.png)

## Reading paths

| Goal | Start here | What you will learn |
| --- | --- | --- |
| Deploy and make a request | [Quick deployment](#quick-deployment) → [First use](#first-use) | Bindings, accounts and request examples |
| Understand a request | [Project guide](repo-docs/README.md) → [Main walkthrough](repo-docs/walkthroughs/one-real-run.md) | Authentication, routing and response handling |
| Check compatibility and operating limits | [Routing and protocols](repo-docs/modules/routing-and-protocols.md), [Upstreams and quota](repo-docs/modules/upstream-and-quota.md) | Supported conversions, explicit rejections and retry boundaries |
| Change code or contribute | [Code map](repo-docs/code-map.md), [Contributing](CONTRIBUTING.md) | Change locations, verification and commit conventions |
| Audit the explanations | [Source evidence](repo-docs/references/source-evidence.md) | Confirmed claims, verification boundaries and exclusions |

The detailed living guide is maintained in Chinese; this README provides the corresponding English setup and usage instructions.

## Capabilities and boundaries

- OpenAI Chat Completions, legacy Completions, Embeddings, Anthropic Messages, and Gemini generation, embedding and model-catalog endpoints.
- Multiple accounts, model aliases, per-account model declarations and bounded failover across at most three candidate accounts.
- Supported JSON and streaming conversions preserve tool calls, refusals, truncation and signed thinking. Constraints that cannot be represented produce explicit errors.
- Separate administrator authentication, client gateway keys and upstream credentials. Model access stays closed until a gateway key exists and closes after the last key is deleted.
- SQLite Durable Object configuration preserves concurrent updates and key revocation; Cloudflare usage is displayed from a cache.

The model catalog includes several task types. A listed model is not necessarily callable through chat. Full image, audio and other media-generation APIs, and exact cross-provider token counting, are not implemented. Real model access depends on upstream permissions; mocked tests do not establish production acceptance.

## Quick deployment

Clone the public repository:

```sh
git clone https://cnb.cool/CyberNova2333/modelbridge.git
cd modelbridge
```

### Workers (recommended)

Install Node.js 24+, sign in to your own Cloudflare account with Wrangler, and create a KV namespace:

```sh
npx wrangler login
npx wrangler kv namespace create KV
```

The checked-in `wrangler.toml` retains the maintainer's deployment settings. Change the following for a new instance; preserve the existing storage bindings when upgrading:

| Setting | Action |
| --- | --- |
| `name` | Choose your Worker name; this does not rename the website brand |
| `account_id` | Use your Cloudflare Account ID |
| `routes` | Use your custom domain, or remove the route to use the Workers domain |
| `kv_namespaces` → `id` | Use the ID returned above; retain the original KV for upgrades |
| `CONFIG_STORE` / `AppConfigStore` | Keep the Durable Object binding and `new_sqlite_classes` migration |

KV binding:

```toml
[[kv_namespaces]]
binding = "KV"
id = "YOUR_KV_NAMESPACE_ID"
```

Retain the `global_fetch_strictly_public` and `enable_request_signal` compatibility flags, and `observability.redact_query_string = true`. The [compatibility flags](https://developers.cloudflare.com/workers/configuration/compatibility-flags/) route global fetch through the public Internet path instead of a shortcut to the Worker's own zone origin, and enable incoming request cancellation signals. The [logging setting](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/script_and_version_settings/) removes query strings from request URLs in logs and traces. Public routing is not a complete private-network firewall.

```sh
npx wrangler deploy
npx wrangler secret put ADMIN_PASSWORD
```

The `ADMIN_PASSWORD` administrator Secret is required: access is blocked without it. Existing deployments do not need to set it again during upgrades. Never put passwords or upstream credentials in `wrangler.toml`.

Wrangler applies the SQLite Durable Object migration on deployment. On first configuration access, `AppConfigStore` imports the original KV `config` once. Accounts, gateway keys and mappings then use the Durable Object as their authority; sessions and usage caches also live there. The old KV snapshot is not kept in sync. A rollback must preserve the current Durable Object; a version that reads only the old KV can restore stale state. See [Access and configuration](repo-docs/modules/access-and-config.md).

### Pages

Under the [Pages binding requirements](https://developers.cloudflare.com/pages/functions/bindings/), Pages cannot host a Durable Object independently; uploading `_worker.js` alone is insufficient:

1. Follow the Workers instructions to deploy a Worker exporting `AppConfigStore`, bound to the original `KV`.
2. Upload `_worker.js` to Pages, bind the same `KV`, and set `ADMIN_PASSWORD`.
3. Add a `CONFIG_STORE` Durable Object binding to that Worker's `AppConfigStore`. A Pages Wrangler configuration needs `script_name`:

```toml
[[durable_objects.bindings]]
name = "CONFIG_STORE"
class_name = "AppConfigStore"
script_name = "YOUR_CONFIG_WORKER_NAME"
```

4. Enable `global_fetch_strictly_public` and `enable_request_signal` for Pages. Prefer client keys in request headers, separately check whether Pages logs retain query parameters, and redeploy.

Keep Pages and its hosting Worker on the same code version. Upgrade the Worker first; it owns the migration. They share configuration, but each entry point authenticates against its own administrator Secret, with sessions isolated by origin.

## First use

1. Open your deployment and sign in with `ADMIN_PASSWORD`.
2. Add an upstream account and its supported model IDs in account management. Cloudflare accounts need an Account ID and API Token.
3. Generate a client gateway key in API key management.
4. Choose a configured model that the upstream account may invoke. For OpenAI clients, use `https://YOUR_GATEWAY_DOMAIN/v1` as the Base URL and supply the gateway key.

The following examples use Bash/curl. Replace the domain, key and model alias:

```sh
curl 'https://YOUR_GATEWAY_DOMAIN/v1/chat/completions' \
  -H 'Authorization: Bearer YOUR_GATEWAY_API_KEY' \
  -H 'Content-Type: application/json' \
  -d '{"model":"gpt-oss-20b","messages":[{"role":"user","content":"Hello"}]}'
```

Administrator sessions use random tokens and expire after 24 hours. Logout or password rotation invalidates the corresponding sessions. Each source IP is limited to 10 failed logins per 15-minute window. Revoked gateway keys stop working on the next request; configuration snapshots are reused only within one request. See [Access and configuration](repo-docs/modules/access-and-config.md) for trust boundaries and [Security](SECURITY.md) for reporting issues.

## Upstreams and model mappings

| Provider | Default Base URL | Credentials |
| --- | --- | --- |
| Cloudflare | Fixed Workers AI address | Account ID and API Token |
| OpenAI | `https://api.openai.com/v1` | API Key |
| Anthropic | `https://api.anthropic.com/v1` | API Key |
| Gemini | `https://generativelanguage.googleapis.com/v1beta` | API Key |
| Antigravity | Built-in Cloud Code address | Email and Refresh Token; Access Token also supported |

Generic upstreams accept a custom compatible Base URL. It must be public HTTPS without a username, password, query or fragment; HTTP loopback addresses are allowed for local development. Blank credentials retain the stored value only when editing the same provider. Changing providers requires a fresh credential and does not inherit the previous destination, identity or OAuth project. Account listings do not return real upstream keys.

Enter upstream model IDs on separate lines or separated by commas. A nonempty list restricts that account to those models; an empty list applies no model restriction. Declared generic upstream models can be used directly. Use explicit mappings to avoid ambiguous names:

```json
{
  "my-chat": "openai:YOUR_MODEL_ID",
  "my-claude": "anthropic:YOUR_MODEL_ID",
  "my-gemini": "gemini:YOUR_MODEL_ID",
  "my-oauth": "antigravity:YOUR_MODEL_ID",
  "my-vector": "@cf/baai/bge-m3"
}
```

For Cloudflare or generic upstreams, use `upstream:ACCOUNT_ID:MODEL_ID` to select a particular stored account; Antigravity uses its own routing prefixes. Only active accounts of the matching provider and model declaration participate. Direct `@cf/...` names and explicit provider prefixes bypass alias lookup, so the mapping table is not a complete access or spending allowlist. Cloudflare model paths containing traversal, queries or fragments are rejected. See [Routing and protocols](repo-docs/modules/routing-and-protocols.md).

The checked-in [Cloudflare mapping](cloudflare-model-map.json) has 65 entries, maintained as models eligible for daily free quota. Restoring defaults reinstates that list. Entries include chat, embeddings and other tasks; choose an endpoint the model supports. The dashboard estimates free quota at 10,000 Neurons per Cloudflare Account ID per day; extra tokens for one account do not increase it. Actual pricing, available models and overage charges follow [Cloudflare pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/). Neither the mapping nor the cached statistics enforce a spending cap.

## Experimental Antigravity integration

Select Antigravity in account management and paste the email and `refresh_token`; no JSON import is needed. Saving an active account validates sign-in and discovers its project before persisting it. Advanced settings can specify an authorized project and the OAuth client that issued the token; normally leave the client settings empty to use the built-in client. Changes to the email, token or OAuth identity trigger rediscovery for automatically discovered projects; manually specified projects are retained.

Environment Secrets are also supported:

```sh
npx wrangler secret put ANTIGRAVITY_REFRESH_TOKEN
```

Optional settings include `ANTIGRAVITY_PROJECT_ID` and `ANTIGRAVITY_EMAIL`. Set `OAUTH_CLIENT_ID` and `OAUTH_CLIENT_SECRET` together; account-level settings take precedence. For multiple environment accounts, use the `ANTIGRAVITY_ACCOUNTS` JSON array described in [Upstreams and quota](repo-docs/modules/upstream-and-quota.md). Legacy `ya29.` Access Tokens work but cannot renew themselves.

Built-in aliases include `claude-sonnet-4-5-thinking`, `claude-opus-4-5-thinking`, `claude-sonnet-4-5`, `gemini-3-flash`, `gemini-3-pro-high` and `gemini-3-pro-low`. An alias does not grant model access. Both `antigravity:` and `@antigravity/` prefixes work. Claude Code can use the gateway root as `ANTHROPIC_BASE_URL` with a gateway key; other clients use their respective protocol endpoints.

This experimental adapter targets an internal Google Cloud Code interface, which may change. A refreshed token permits one 401 retry; concurrent refreshes are coalesced only within the same Worker isolate. Multi-turn tool use must retain returned thinking signatures. Images require inline base64; remote image URLs, documents and non-text tool-result media are unsupported. Structured JSON output constraints and unrepresentable thinking settings are rejected before generation. The gateway does not inject extra system prompts or fabricate user messages.

## Client protocols

| Interface | Method and path | Gateway authentication |
| --- | --- | --- |
| OpenAI model catalog | `GET /v1/models` | `Authorization: Bearer YOUR_GATEWAY_API_KEY` |
| OpenAI chat / legacy completion | `POST /v1/chat/completions`, `/v1/completions` | Same as above |
| OpenAI embeddings | `POST /v1/embeddings` | Same as above |
| Anthropic messages | `POST /v1/messages` | `x-api-key: YOUR_GATEWAY_API_KEY` |
| Gemini catalog / single model | `GET /v1beta/models`, `/v1beta/models/{model}` | `x-goog-api-key: YOUR_GATEWAY_API_KEY` |
| Gemini generation / streaming | `POST /v1beta/models/{model}:generateContent`, `:streamGenerateContent?alt=sse` | Same as above |
| Gemini embeddings / batch | `POST /v1beta/models/{model}:embedContent`, `:batchEmbedContents` | Same as above |

Gemini also accepts `/v1/models/{model}:action`, but `GET /v1/models` always uses the OpenAI list format. Gemini streaming without `alt=sse` returns a JSON array stream; `:countTokens` returns 501. Gemini accepts `?key=`, but headers are recommended and query-string log redaction must be retained. These are gateway keys; configure upstream credentials only in account management or environment Secrets.

```sh
curl 'https://YOUR_GATEWAY_DOMAIN/v1beta/models/gpt-oss-20b:generateContent' \
  -H 'x-goog-api-key: YOUR_GATEWAY_API_KEY' \
  -H 'Content-Type: application/json' \
  -d '{"contents":[{"role":"user","parts":[{"text":"Hello"}]}]}'
```

Support for text, supported image inputs, function tools, structured output and signed replay depends on the destination. Native constraints such as Anthropic built-in search tools or Gemini safety settings and cached context cannot silently degrade across providers. Tool `strict` is retained between OpenAI and Anthropic; routes unable to guarantee strict tools reject them. Conflicting Gemini field aliases and unrepresentable sampling or output constraints return 400. Abnormal terminal states, invalid tool arguments and incomplete streams produce errors. See [Routing and protocols](repo-docs/modules/routing-and-protocols.md) for the full boundaries.

## Usage and resource limits

The public homepage reads cached summaries. Administrator refreshes query Cloudflare usage. The five-minute cache coalesces concurrent refreshes and groups credentials by Account ID, with at most 20 accounts per batch and four concurrent queries. Check other providers' usage in their own consoles.

| Operation | Limits and effects |
| --- | --- |
| Login / management / model JSON input | Actual-byte limits of 16 KiB / 1 MiB / 16 MiB, including inline base64; oversized bodies return 413, malformed JSON returns 400 |
| Model response | Abort after 120 seconds waiting for headers or an idle body; maximum 32 MiB |
| Account failover | At most three matching accounts for explicit 401, 403, 404 or 429 rejection; uncertain network outcomes, invalid success responses and server errors do not regenerate |
| Generic connection test | Reads the model catalog; does not prove invocation permissions for all models |
| Antigravity connection test | Checks sign-in and project, without generating an answer |
| Cloudflare connection test | Includes one small embedding inference and consumes quota; 15-second header/idle timeout and 1 MiB response limit |

Upstream errors and SSE metadata are sanitized; ordinary model text and signatures retain their values. Client cancellation propagates to the upstream connection, but does not prove that computation or billing stopped. Embedding outputs are checked for count, indices, dimensions and encoding; invalid output returns 502 without repeating generation on another account. See [Upstreams and quota](repo-docs/modules/upstream-and-quota.md).

## Local verification and contribution

Regression tests need Node.js 24+, Python 3.10+ and Git, with no root npm installation. They use mocked upstreams and storage; Python and Git exercise the maintenance guard in temporary repositories.

```sh
node --test tests/*.test.mjs
```

Tests cover authentication and concurrent configuration, credential isolation, account routing, JSON/SSE conversions, tools and signed replay, cancellation and response boundaries, embeddings and OAuth refresh. Actual runs are recorded in the [guide change log](repo-docs/change-log.md). Mock results do not establish real account permissions, production persistence or a successful deployment.

See [Contributing](CONTRIBUTING.md) for fresh-clone guard installation, the Commit Message template, verification requirements and history maintenance. Read the [agent rules](AGENTS.md) before changes and follow [Security](SECURITY.md) for sensitive reports.

### Documentation site

The Chinese guide lives in `repo-docs/` and is included by VitePress pages using the default theme. Install documentation dependencies separately:

```sh
npm --prefix docs-site ci
npm --prefix docs-site run docs:build
```

Output defaults to `docs-site/.vitepress/dist/`. Append `-- --outDir <external-absolute-directory>` for an isolated build. Source links display precise repository paths; source files and local resources are not copied into the site.

For local preview, use `npm --prefix docs-site run docs:dev -- --host 127.0.0.1`. The `npm --prefix docs-site run test:smoke` command starts a temporary local service to check initial search, Markdown HMR and file-access boundaries. VitePress 1.6.4 requires a development-server restart to refresh the search index; static builds regenerate it. Dependency versions and security patches are defined by the [documentation package](docs-site/package.json) and lockfile.

## Upstream updates

For GitHub forks, the sync workflow checks upstream daily. A read-only job merges candidate code and runs regression tests. A separate write-enabled job reconstructs the same tree, then creates a `codex/upstream-*` branch and draft PR for human review. It does not automatically merge or deploy, and the job holding a write token never executes candidate code. GitHub Actions must be allowed to create PRs. Conflicts and upstream workflow changes require manual handling. Actions are pinned to full commit SHAs.

## Acknowledgments and license

Thanks to the upstream [WorkersAI2API](https://github.com/cmliussss2024/WorkersAI2API) project and [Cloudflare](https://www.cloudflare.com/) for the platform and open-source ecosystem.

This project is distributed under [GNU GPLv3](LICENSE) (`GPL-3.0-only`). The original WorkersAI2API MIT copyright and license text are preserved in the [upstream license](LICENSES/WorkersAI2API-MIT.txt). See [NOTICE](NOTICE) for provenance and distribution notices; third-party dependencies retain their respective licenses. Retain the applicable copyright and license notices when redistributing.
