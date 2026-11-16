---
layout: page
sidebar: false
title: API & Component Reference
description: Interactive specification for ModelBridge OpenAI, Anthropic, and Gemini ingress routes, /api/* admin controls, and /_modelbridge/state RPC.
---

<script setup lang="ts">
import { apiSpecEn } from '../../.vitepress/data/api-spec'
</script>

<ApiExplorer :spec="apiSpecEn">

### OpenAI Ingress Endpoints (`/v1/chat/completions` / `/v1/embeddings` / `/v1/models`) {#openai-ingress}

Resolves `upstream:` and modelMap routing with bounded 3-account failover strictly on `401/403/404/429`; omits `/v1/responses` and media generation.

### Anthropic Messages with Strict Pre-Flight Checks (`POST /v1/messages`) {#anthropic-messages}

Preserves tool strictness and replay metadata checks, rejecting unrepresentable features pre-flight.

### Gemini Native Endpoints (`POST /v1beta/models/<id>:*`) {#gemini-ingress}

Supports generation and embeddings; `:countTokens` explicitly returns `501 Not Implemented`.

### Admin Console & Management API (`/api/*`) {#admin-api-panel}

Isolates `ADMIN_PASSWORD` management sessions from inference keys and enforces SSRF checks on custom `baseUrl` values.

### Self-Hosted Node 24 SQLite State RPC (`POST /_modelbridge/state`) {#state-rpc-sqlite}

Single WAL SQLite transaction authority or compatibility `AppConfigStore` Durable Object shared across stateless edge bundles.

</ApiExplorer>
