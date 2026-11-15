# Module: Routing & Cross-Protocol Translation

::: info Chinese Source Guide
Full source-anchored notes are maintained in Chinese at [`repo-docs/modules/routing-and-protocols.md`](https://github.com/CyberNova2333/modelbridge/blob/main/repo-docs/modules/routing-and-protocols.md).
:::

- **Ingress**: OpenAI (`/v1/models`, `/v1/chat/completions`, `/v1/completions`, `/v1/embeddings`), Anthropic (`/v1/messages`), Gemini (`/v1beta/models/*`, `/v1/models/*`; `:countTokens` returns `501`).
- **Resolution & Checks**: `resolveModelName` resolves `upstream:<accountId>:<model>`, `@cf/`, provider prefixes, admin `modelMap`, and the 65-entry `DEFAULT_MODEL_MAP`. `validateReplayMetadata` and `validateToolStrictness` fail fast (`400`) on unrepresentable constraints or tampered replay payloads.

## English Documentation Links

- [2. API, Security & Routing Contracts](/en/docs/contracts)
- [2. Failover, Adapters & Extensions](/en/docs/adapters)
- [3. Architecture & Code Tour](/en/docs/architecture)
