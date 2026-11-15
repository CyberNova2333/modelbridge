---
layout: home

hero:
  name: 模桥 ModelBridge
  text: 多协议 AI 模型网关
  tagline: 用同一共享核心对外提供 OpenAI、Anthropic 与 Gemini 接口，运行于 Cloudflare Workers、EdgeOne Makers、阿里云 ESA 与自建 Node.js 24 SQLite 状态服务。
  actions:
    - theme: brand
      text: 1. 起步与部署
      link: /docs/
    - theme: alt
      text: 2. 契约与扩展
      link: /docs/contracts
    - theme: alt
      text: 3. 原理与源码
      link: /docs/architecture
    - theme: alt
      text: GitHub 仓库
      link: https://github.com/CyberNova2333/modelbridge

features:
  - title: 多协议互通与严格语义
    details: 提供 /v1/chat/completions、/v1/completions、/v1/embeddings、/v1/messages 与 /v1beta/models/*，跨供应商转换保留工具调用与签名回放校验，无法表达的约束在生成前拒绝。
  - title: 单一状态权威与四态隔离
    details: 严格隔离管理员密码、实例调用密钥、上游凭据与 STATE_TOKEN；支持自建 Node.js 24 SQLite（WAL + IMMEDIATE）事务权威或兼容 Cloudflare AppConfigStore DO。
  - title: 边缘预算与有界容错
    details: 针对 Cloudflare（16 MiB）、EdgeOne Makers（1 MiB）与阿里云 ESA（4 次出站 fetch / 9s 首包 / 115s 总时长）注入运行约束；仅在 401/403/404/429 明确拒绝时最多尝试 3 个候选账号。
---

## 按身份/目标快速入口

| 你的角色 / 目标 | 关注重点 | 推荐入口 |
| :--- | :--- | :--- |
| **个人部署 / 运维工程师** | 选型（自建 SQLite vs 原生 DO）、Secret 矩阵、Makers / ESA / Caddy 部署 | [1. 起步与多平台部署](/docs/) · [部署运维与排错 FAQ](/docs/deployment-faq) |
| **客户端 / SDK 接入方** | OpenAI / Anthropic / Gemini 请求格式、模型前缀与别名路由、响应边界 | [2. 接口、安全与路由契约](/docs/contracts) |
| **二次开发 / 扩展贡献者** | 容错边界、Antigravity OAuth、`createGateway` 平台与上游适配器扩展 | [2. 上游容错与扩展指南](/docs/adapters) · [边缘平台与自建状态](/modules/platform-adapters) |
| **架构审计 / 源码研读** | 一次完整请求的源码走读、代码地图、DO 迁出与关键架构决策（ADR） | [3. 架构全景与源码导览](/docs/architecture) · [关键架构决策与迁移](/docs/migrations) · [源码走读](/walkthroughs/one-real-run) |

## 架构全景

<div class="archify-diagram-card" style="margin: 1.5rem 0; border: 1px solid var(--vp-c-border); border-radius: 12px; overflow: hidden; background: var(--vp-c-bg-soft); box-shadow: 0 4px 16px rgba(0,0,0,0.06);">
  <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 18px; background: var(--vp-c-bg-elv); border-bottom: 1px solid var(--vp-c-border); font-size: 13px;">
    <span style="font-weight: 600; color: var(--vp-c-text-1); display: flex; align-items: center; gap: 8px;">
      <span style="font-size: 16px;">📐</span> 多平台边缘计算适配矩阵（基于 Archify 的高保真交互图表，支持平移/缩放/探查）
    </span>
    <a href="/diagrams/modelbridge-architecture.html" target="_blank" rel="noreferrer" style="font-size: 12px; color: var(--vp-c-brand-1); text-decoration: none; font-weight: 500;">
      在新窗口全屏打开 ↗
    </a>
  </div>
  <iframe src="/diagrams/modelbridge-architecture.html" width="100%" height="520px" frameborder="0" style="display: block; border: none;" allowfullscreen loading="lazy"></iframe>
</div>

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
