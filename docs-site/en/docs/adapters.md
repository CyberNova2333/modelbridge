# 2. Failover, Adapters & Extensions

::: warning AI Translation Notice
This page is an English translation of the [authoritative Chinese adapters guide](/docs/adapters). Refer to the Chinese version in case of discrepancies.
:::

## Bounded Upstream Failover (`shouldRetryUpstream`)

| Upstream Outcome | Failover? | Rule & Rationale |
| :--- | :--- | :--- |
| Explicit `401`, `403`, `404`, `429` | **Yes** | Shuffles matching active candidates and tries at most **3 accounts** (`shuffledUpstreams(candidates).slice(0, 3)`). Generation has clearly been refused before execution. |
| `5xx`, network error, `120s` idle timeout, `> 32 MiB` body, invalid `200` | **No** | Avoids duplicate upstream generation/billing and respects tight edge budgets (such as ESA's `4`-fetch cap). |
| Client abort (`request.signal.aborted`) | **Abort (`499`)** | Propagates cancellation immediately to the active upstream request. |

> Keep `lb_retries 0` in reverse proxies (`deploy/self-hosted-state/Caddyfile`) so proxies do not silently re-issue aborted or timed-out generation calls.

## Supported Upstream Providers (`ACCOUNT_PROVIDERS`)

- **`cloudflare`**: Workers AI REST API (`accountId` + `apiToken`), with 5-minute cached 24h reference dashboard usage.
- **`openai`**: OpenAI or any OpenAI-compatible backend (including Ollama `/v1`, vLLM, SGLang) via validated custom `baseUrl` and declared `models`.
- **`anthropic`**: Native Anthropic Messages API (`thinking`, `output_config`, strict tools).
- **`gemini`**: Google Generative Language API (`v1beta`).
- **`antigravity`**: OAuth refresh-token or API-key accounts (`projectId`, optional custom `oauthClientId`/`oauthClientSecret`, or env fallback via `ANTIGRAVITY_ACCOUNTS`, `ANTIGRAVITY_REFRESH_TOKEN`, `ANTIGRAVITY_API_KEY`, etc.).

## Platform Adapter Pattern & Extension Guide

Root `_worker.js` exports `createGateway(runtime)` so platform entries (`src/platforms/{cloudflare,edgeone,esa}.mjs`) remain thin wrappers around `runPlatformRequest` and `PLATFORM_LIMITS` in `src/platforms/shared.mjs`:

1. **Adding an Edge Platform**: Register limits in `PLATFORM_LIMITS` (`src/platforms/shared.mjs`), add `src/platforms/<name>.mjs`, update `tools/build-platforms.mjs` + `deploy/<name>/`, and add mocked limit tests under `tests/`.
2. **Adding an Upstream Provider**: Extend `ACCOUNT_PROVIDERS` and `normalizeProviderAccountInput` (keeping `validateProviderBaseUrl` protections), implement request/SSE/error-redaction adapters, and fail fast with `400`/`501` rather than dropping unsupported semantic constraints.

## Next Steps

- Explore the interactive system diagram and source walkthroughs in [3. Architecture & Code Tour](/en/docs/architecture).
