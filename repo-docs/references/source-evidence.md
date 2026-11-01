# 模桥 · ModelBridge 源码证据

本页记录 2026-10-31 的 widened docs sync：先沿一次请求找交接，再用失败、并发和协议约束反查。调查起点为 `12a0f67ef4d2e715e421104f31bac5a10a8c159c` 及其后的未提交工作树；历史信息整理后的对应锚点见[同步记录](../change-log.md)。源码检查、模拟测试、文档构建和生产验收分别记账。

## Evidence Traversal Log

| Pass | Purpose | Inspected evidence | What changed in the model |
| --- | --- | --- | --- |
| Pass 1 | 从真实入口建立输入、配置、选择与输出链 | `_worker.js` 的 `fetch`、`handleRequest`、`checkProxyAuth`、`handleV1Proxy`、`handleCompletions`、`resolveModelName`、`callOpenAICompatibleAPI`；`wrangler.toml`；`tests/universal-upstreams.test.mjs` | 选定 OpenAI 聊天输入访问已配置上游的代表场景；区分客户端协议、模型目标和账号凭据。 |
| Pass 2 | 用失败与并发挑战主流程，补全被跳过的依赖 | `AppConfigStore`、`readRequestJson`、`fetchUpstream`、`shouldRetryUpstream`；配置、请求安全、协议与账号专项测试；`tools/`、工作流、文档站配置和脚本 | DO 是配置权威；明确拒绝与不确定结果必须分开；协议转换不能静默丢弃约束；把访问配置、协议路由、资源配额拆成各自的说明页。 |

## 理解提要

场景：客户端用实例调用密钥向 `/v1/chat/completions` 发送模型别名和消息，别名指向一个已配置的供应商模型。网关核验调用权，解析目标，再从启用且允许该模型的账号中选择上游。普通结果或 SSE 返回客户端协议。

难点是三种权限和多种协议同时存在：知道一个模型名字，不代表有可用账号；请求要求的工具、思考或格式约束，也不一定能跨供应商实现。失败例是网络中断后不能判断是否已经生成，因此不会换账号重做。可推翻这个模型的证据是第二次生成调用、错误凭据路由或被丢弃的显式约束；下一步应检查具体协议与目标账号的组合，而非从聊天成功推断全部兼容。

## 证据表

| Claim | Evidence | Confidence | Caveat | Used by |
| --- | --- | --- | --- | --- |
| 管理凭据、实例调用密钥和供应商凭据分工不同 | [请求与鉴权](../../_worker.js)：`handleRequest`、`checkProxyAuth`、`checkAdminAuth`；[安全断言](../../tests/security-hardening.test.mjs) | 已确认 | 不证明真实 Secret 的保管方式 | [访问与配置](../modules/access-and-config.md)、主流程 |
| 配置、会话与用量缓存由 DO 保存，KV 仅用于旧配置首次迁移 | [配置存储](../../_worker.js)：`AppConfigStore`、`configRequest`、`getAppConfig`；[迁移与并发断言](../../tests/config-auth.test.mjs) | 已确认 | 测试模拟 DO/KV；云端迁移另验 | 访问与配置 |
| JSON 限制累计实际字节，错误不回显原始解析输入 | [有界读取](../../_worker.js)：`readRequestJson`、`requestJsonErrorResponse`；[请求安全回归](../../tests/review-request-security.test.mjs) | 已确认 | 16 MiB 包含内嵌 base64，不是上下文 token 限额 | 主流程、访问与配置 |
| 目标供应商、启用状态、指定账号和模型白名单共同筛选凭据 | [模型选择](../../_worker.js)：`resolveModelName`、`parseUpstreamTarget`、`getMatchingUpstreamAccounts`；[跨上游断言](../../tests/universal-upstreams.test.mjs) | 已确认 | 空账号模型列表不限制模型；上游实际权限仍未知 | [路由与协议](../modules/routing-and-protocols.md) |
| 更换供应商要求新凭据并清除继承目标信息 | [账号归一化](../../_worker.js)：`normalizeProviderAccountInput`；[账号回归](../../tests/review-account-embedding-round2.test.mjs) | 已确认 | 同供应商留空保留原凭据 | 访问与配置 |
| 只有 401/403/404/429 等明确拒绝可换账号，最多三个候选 | [上游边界](../../_worker.js)：`shouldRetryUpstream`、`fetchUpstream`；[失败与预算断言](../../tests/upstream-safety.test.mjs) | 已确认 | 并非任意错误自动恢复；取消不等于停止计费 | [上游与配额](../modules/upstream-and-quota.md)、主流程 |
| 显式协议约束不能执行时拒绝，不伪造正常终止 | [协议回归](../../tests/review-protocol-regressions.test.mjs)、[别名与工具回归](../../tests/review-protocol-round2.test.mjs)；`normalizeGeminiRequestFields`、`geminiFinishToOpenAI` | 已确认 | 测试覆盖指定字段和组合，不是完整供应商兼容认证 | 路由与协议 |
| 嵌入输入配置及输出的数量、索引、维度和数值需校验 | [嵌入实现](../../_worker.js)：`normalizeEmbeddingOptions`、`validateEmbeddingOutput`；[上游回归](../../tests/review-upstream-regressions.test.mjs)、账号回归 | 已确认 | 非法成功响应不重新生成；真实模型维度与权限另验 | 路由与协议 |
| OAuth 刷新合并仅作用于同一实例，用量查询有独立缓存 | [OAuth 与用量实现](../../_worker.js)：`getAntigravityToken`、`refreshAntigravityToken`、`usageAccountGroups`；[配额回归](../../tests/quota-project-regressions.test.mjs) | 已确认 | 不是跨实例锁，也不是硬性预算控制 | 上游与配额 |
| 离线护栏检查索引与提交对象，例外撤销不能继续复用旧判定 | [维护脚本](../../tools/repo_maintenance_guard.py)、[隔离 Git 回归](../../tests/repo-maintenance-guard.test.mjs) | 已确认 | 大文件等扫描边界见 SECURITY；不能替代业务测试 | [贡献规范](../../CONTRIBUTING.md)、代码地图 |
| CI 测试与上游提案隔离，文档站独立构建 | [测试工作流](../../.github/workflows/test.yml)、[上游提案](../../.github/workflows/sync-upstream.yml)、[站点配置](../../docs-site/.vitepress/config.mts) | 已确认 | 配置审阅不等于远端工作流已成功运行 | [代码地图](../code-map.md) |

## 覆盖范围与排除

第一方实现范围：根 Worker、测试、离线维护工具、GitHub 工作流、文档站配置与默认主题入口。品牌 SVG 和截图只核对展示入口；源码地图列出责任及验证位置。

相邻路径已确认但不逐段解释：管理界面每个交互、用量 GraphQL 字段、所有模型的多模态能力和完整跨协议组合。`node_modules`、构建产物、缓存、未启用的文档装饰资源及其第三方 vendor 不作为业务实现证据。没有访问真实账号、读取生产私有配置或执行线上请求。

## 反证与后续问题

反证检查（Falsifying check）：如果同一个不确定网络结果触发第二轮生成、被撤销的密钥因并发写重新出现、或跨供应商转换丢掉显式约束后继续调用，应修改主流程模型并增加对应回归。

下一位读者可能问（Next reader question）：怎样知道一个具体模型与协议组合能用于生产？先检查[路由支持与拒绝边界](../modules/routing-and-protocols.md)，再单独验证真实账号权限、云端存储和流取消；本地模拟与文档构建不能替代这些结果。实际执行记录集中在[同步记录](../change-log.md)。

证据状态：除特别标注外，本页基于当前源码已确认。
