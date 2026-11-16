---
layout: page
sidebar: false
title: API 与组件参考
description: ModelBridge 多协议网关 OpenAI / Anthropic / Gemini 端点、管理面板 /api/* 及自建 Node 24 SQLite /_modelbridge/state 接口参考。
---

<script setup lang="ts">
import { apiSpecZh } from '../.vitepress/data/api-spec'
</script>

<ApiExplorer :spec="apiSpecZh">

### OpenAI 兼容多端点 (`/v1/chat/completions` / `/v1/embeddings` / `/v1/models`) {#openai-ingress}

按 `upstream:<id>:<model>` 与 65 条别名路由，在 `401/403/404/429` 上有限切号最多 3 次，不含 `/v1/responses` 与音视频生成。

### Anthropic Messages 协议适配与严格预检 (`POST /v1/messages`) {#anthropic-messages}

跨协议转换保留思考回放签名校验并在不支持约束上 `400` 前置拒绝。

### Gemini Native 格式适配 (`POST /v1beta/models/<id>:*`) {#gemini-ingress}

支持生成与嵌入端点；`:countTokens` 明确返回 `501 Not Implemented`。

### 管理控制台与鉴权 API (`/admin` / `/api/*`) {#admin-api-panel}

严格隔离 `ADMIN_PASSWORD` 管理会话与推理调用，配置 `validateProviderBaseUrl` 防私网 SSRF。

### 自建 Node 24 SQLite 状态服务 RPC (`POST /_modelbridge/state`) {#state-rpc-sqlite}

提供单一事务配置权威（WAL + `BEGIN IMMEDIATE`），或兼容 Cloudflare `AppConfigStore` DO。

</ApiExplorer>
