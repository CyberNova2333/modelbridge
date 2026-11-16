---
layout: home

hero:
  name: 模桥 ModelBridge
  text: 多协议 AI 模型网关
  tagline: 用同一共享核心对外提供 OpenAI、Anthropic 与 Gemini 接口，运行于 Cloudflare Workers、EdgeOne Makers、阿里云 ESA 与自建 Node.js 24 SQLite 状态服务。
  actions:
    - theme: brand
      text: 起步与部署
      link: /docs/
    - theme: alt
      text: API 与组件参考
      link: /api-reference/
    - theme: alt
      text: 契约与扩展
      link: /docs/contracts
    - theme: alt
      text: 原理与源码
      link: /docs/architecture

features:
  - title: 多协议互通与严格语义
    details: 提供 /v1/chat/completions、/v1/completions、/v1/embeddings、/v1/messages 与 /v1beta/models/*，跨供应商转换保留工具调用与签名回放校验，无法表达的约束在生成前拒绝。
  - title: 单一状态权威与四态隔离
    details: 严格隔离管理员密码、实例调用密钥、上游凭据与 STATE_TOKEN；支持自建 Node.js 24 SQLite（WAL + IMMEDIATE）事务权威或兼容 Cloudflare AppConfigStore DO。
  - title: 边缘预算与有界容错
    details: 针对 Cloudflare（16 MiB）、EdgeOne Makers（1 MiB）与阿里云 ESA（4 次出站 fetch / 9s 首包 / 115s 总时长）注入运行约束；仅在 401/403/404/429 明确拒绝时最多尝试 3 个候选账号。
---

## 能力定位与明确边界

::: info 能做到什么程度（已实现能力）
- **三协议互通与语义 pre-flight 守门**：同时暴露 OpenAI（`/v1/chat/completions`、`/v1/completions`、`/v1/embeddings`、`/v1/models`）、Anthropic `/v1/messages` 与 Gemini `/v1beta/models/*`，跨协议保留工具严格度与签名思考回放元数据。
- **四态密钥隔离与单一状态权威**：`ADMIN_PASSWORD`、`apiKeys`、上游密钥与 `MODELBRIDGE_STATE_TOKEN` 严格隔离；Node 24 SQLite（WAL）状态服务与 Cloudflare `AppConfigStore` DO 各守单一权威，支持 `upstream:<id>:<model>` 精准路由。
- **边缘平台预算注入与 SSRF 校验**：开箱生成 6 套平台产物（Cloudflare `16 MiB`、Makers `1 MiB`、ESA `4` 次 fetch）；`validateProviderBaseUrl` 强制公网 HTTPS 防私网探测。
:::

::: warning 明确不能做什么（非目标与硬限制）
- **明确裁剪接口**：不提供 OpenAI `/v1/responses`、完整图像/音频生成编辑，Gemini `:countTokens` 固定返回 `501`；不做跨供应商精确 token 计量。
- **不以别名表替白名单、超时不盲重试**：`cloudflare-model-map.json`（65 条）与控制台 Neurons 计数仅作展示与发现（非硬配额拦截）；超时及 `5xx` 绝不触发多账号重试防重复计费。
- **无双写降级**：不在自建 SQLite 与原生 DO 之间双写或静默切换；`Makers` 请求体硬上限为 `1 MiB`。
:::

## 架构全景

<DiagramFrame
  src="/diagrams/modelbridge-architecture.html"
  title="多平台边缘计算适配矩阵（基于 Archify 的高保真交互图表，支持平移/缩放/探查）"
  aspect="710 / 498"
  new-tab-label="在新窗口全屏打开 ↗"
/>

## 本地快速验证

仓库根目录运行需要 Node.js 24+，主网关与状态服务不依赖第三方 npm 包：

```sh
# 1. 运行静态语法检查与全部模拟回归测试
pnpm run check
node --test tests/*.test.mjs

# 2. 生成六套多平台独立部署目录（dist/）
node tools/build-platforms.mjs

# 3. 本地启动自建 SQLite 状态服务（默认 127.0.0.1:8788）
MODELBRIDGE_STATE_TOKEN="$(openssl rand -hex 32)" pnpm run start:state
```

## 文档分层导航

::: tip 按照读者需求快速跳转
- **个人部署 / 运维工程师**：阅读 [起步与多平台部署](/docs/) 与 [部署运维与排错 FAQ](/docs/deployment-faq)，掌握自建 SQLite vs 原生 DO 选型、Secret 矩阵与多云部署；
- **客户端 / SDK 接入方**：查阅 [接口、安全与路由契约](/docs/contracts)，核对 OpenAI / Anthropic / Gemini 请求格式、模型前缀与别名路由；
- **二次开发 / 扩展贡献者**：查阅 [上游容错与扩展指南](/docs/adapters) 与 [边缘平台与自建状态](/modules/platform-adapters)，了解 Antigravity OAuth 与 `createGateway` 适配层；
- **架构审计 / 源码研读**：查阅 [架构全景与模块交互](/docs/architecture)、[关键架构决策与迁移](/docs/migrations)、[源码走读](/walkthroughs/one-real-run) 与 [代码地图](/code-map)。
:::
