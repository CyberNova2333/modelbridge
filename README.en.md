# ModelBridge

[简体中文](README.md) | **English**

ModelBridge is a Cloudflare Worker gateway with a management interface, generated client keys and configurable upstream accounts. Clients can use OpenAI, Anthropic or Gemini interfaces while the gateway selects an allowed account and translates supported request/response shapes.

## Capabilities

- Chat Completions, legacy Completions, Anthropic Messages, Gemini content-generation routes, model catalogs and embeddings.
- Generic OpenAI/Anthropic/Gemini upstreams, Cloudflare Workers AI and the existing OAuth-based integration.
- Model aliases and per-account model declarations, ordinary JSON and streaming conversion, tool-call handling and explicit unsupported-field errors.
- Durable Object configuration storage, separate admin sessions/client keys/upstream credentials, account management and usage reporting.
- Bounded account failover, error credential redaction, stream validation and cancellation propagation.

## Local setup and deployment

There is no root package dependency installation step. Use Node.js 24+ for the regression tests and Wrangler for the Worker. Inspect `wrangler.toml`, prepare your own KV and SQLite Durable Object bindings, and supply the administrator password as a local or deployed Secret. Never commit real credentials or copy an old KV snapshot over the current Durable Object configuration.

```sh
npx wrangler dev
```

The Chinese README provides Workers/Pages deployment and binding steps. Deployment is a separate cloud mutation, not a documentation check. Use the administrator interface to configure upstream accounts and client keys. Clients use the generated gateway key, not the upstream account token.

Choose a model alias shown by your configured instance. For example, send `POST /v1/chat/completions` with a nonempty model and messages array and a Bearer client-key header; `stream: true` selects streaming. Availability depends on actual upstream permissions, not on the presence of an alias in a catalog.

## Verification

```sh
node --test tests/*.test.mjs
```

Tests use mocked upstreams and storage harnesses; they do not prove that a real account can invoke a model. This documentation pass inspected those tests but did not run business tests, deploy the gateway or verify production delivery.

## Compatibility boundaries

Only supported protocol features are converted. Provider-specific built-in tools, media generation and exact token counting are not simulated across providers. Unrepresentable safety, thinking or output-format constraints are rejected rather than silently weakened. Signed content and replay metadata must remain consistent with visible messages.

Account failover is limited to three matching candidates and explicit authentication/model/rate-limit rejection. Uncertain network outcomes, invalid success responses and server errors do not trigger another generation. Header/body-idle timeouts and response-size limits are implemented, and upstream errors/stream metadata are sanitized. Aborting the connection does not prove that the provider stopped computing or billing.

## Documentation and license

Start with the [Chinese reading guide](repo-docs/README.md), follow [one authenticated chat request](repo-docs/walkthroughs/one-real-run.md), then locate changes with the [code map](repo-docs/code-map.md). The guide is scoped to generic chat forwarding; it does not claim a complete architecture or protocol compatibility audit.

The repository uses the [MIT License](LICENSE). Keep the upstream copyright and license notice when redistributing.

## Documentation site

The [Chinese living guide](repo-docs/README.md) follows one real workflow and states what it leaves uncovered. Build or serve it with its separate Node.js dependencies:

```sh
npm --prefix docs-site ci
npm --prefix docs-site run docs:dev -- --host 127.0.0.1
npm --prefix docs-site run docs:build
```

The documentation site uses the default VitePress theme, with dependencies installed separately from the application. Output defaults to `docs-site/.vitepress/dist/`; append `-- --outDir <external-absolute-directory>` for an isolated build. Markdown remains in `repo-docs/` and is included by the site. Repository source links are shown as exact paths; source files and local resources are not published.
