---
layout: home
repoGuideSource: "repo-docs/README.md"

hero:
  name: ModelBridge · 模桥
  text: 多厂商大模型聚合网关与多平台协议适配器
  tagline: 跨 Cloudflare Workers、Makers 与自建环境，互通 OpenAI、Anthropic、Gemini 协议，带权威持久化与配额熔断。
  actions:
    - theme: brand
      text: 开启文档阅读
      link: /walkthroughs/one-real-run
    - theme: alt
      text: 架构代码地图
      link: /code-map
    - theme: alt
      text: 多平台部署
      link: /modules/platform-adapters
    - theme: alt
      text: GitHub 仓库
      link: https://github.com/CyberNova2333/modelbridge

features:
  - title: 三大主流协议任意互转
    details: 在同一个统一网关上支持客户端使用 OpenAI、Anthropic Claude 或 Google Gemini 协议无感接入任意上游模型。
  - title: 多平台架构，解耦 DO 依赖
    details: 核心逻辑抽象为跨平台共享内核，支持 Cloudflare DO 部署，亦可通过独立 SQLite 状态服务运行于自建容器与 Edge。
  - title: 精细配额与防重试风暴
    details: 精准判定请求幂等性、动态凭据切换与超时取消熔断，避免不确定网络失败导致的重复扣费与额度浪费。
---

## 这是什么

**模桥 · ModelBridge** 是一个企业级大模型 API 聚合、路由与协议互转网关。

它解决了多模型混合调度中的核心难题：“谁能调用”、“用哪个账号与凭据”、“哪些协议特殊约束能被兑现”，以及“如何避免故障重试风暴”。无论客户端使用哪种 SDK 规范，ModelBridge 均能自适应转换请求结构，并提供统一的鉴权、用量记账与故障隔离保障。

## 怎么用 / 快速上手

### 1. 本地验证与测试

Node.js 22+ 环境下运行测试：

```bash
# 执行全套协议转换与模拟上游契约测试
node --test tests/*.test.mjs
```

### 2. 客户端调用示例

以标准 OpenAI 客户端调用 Claude 3.5 Sonnet：

```bash
curl -X POST https://your-gateway.example.com/v1/chat/completions \
  -H "Authorization: Bearer YOUR_GATEWAY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-3-5-sonnet-20241022",
    "messages": [
      {"role": "user", "content": "请分析这段架构设计。"}
    ]
  }'
```

## 分层阅读与快速跳转

::: tip 按读者角色快速检索
- **初次接触 / 快速理解**：从[一次真实请求交接](/walkthroughs/one-real-run)开始，追踪一次聊天请求在权限校验、模型路由与协议转换间的完整生命周期。
- **运维部署 / 进阶拓扑**：从[多平台部署与权威状态](/modules/platform-adapters)及[访问权限与配置生命周期](/modules/access-and-config)了解如何迁出 DO、自建 SQLite 或备份数据。
- **协议开发 / 核心贡献**：从[代码地图](/code-map)定位协议映射器，查阅[模型路由与协议契约](/modules/routing-and-protocols)与[上游请求与配额边界](/modules/upstream-and-quota)。
:::

---

## 完整项目指南概览

<!--@include: ../repo-docs/README.md-->
