# 模桥 · ModelBridge 源码证据

本页记录 2026-10-31 的 widened docs sync：先沿一次请求找交接，再用失败、并发和协议约束反查。调查起点为 `12a0f67ef4d2e715e421104f31bac5a10a8c159c` 及其后的未提交工作树；历史信息整理后的对应锚点见[同步记录](../change-log.md)。源码检查、模拟测试、文档构建和生产验收分别记账。

## Evidence Traversal Log

| Pass | Purpose | Inspected evidence | What changed in the model |
| --- | --- | --- | --- |
| Pass 1 | 从真实入口建立输入、配置、选择与输出链 | `_worker.js` 的 `fetch`、`handleRequest`、`checkProxyAuth`、`handleV1Proxy`、`handleCompletions`、`resolveModelName`、`callOpenAICompatibleAPI`；`wrangler.toml`；`tests/universal-upstreams.test.mjs` | 选定 OpenAI 聊天输入访问已配置上游的代表场景；区分客户端协议、模型目标和账号凭据。 |
| Pass 2 | 用失败与并发挑战主流程，补全被跳过的依赖 | `AppConfigStore`、`readRequestJson`、`fetchUpstream`、`shouldRetryUpstream`；配置、请求安全、协议与账号专项测试；`tools/`、工作流、文档站配置和脚本 | DO 是配置权威；明确拒绝与不确定结果必须分开；协议转换不能静默丢弃约束；把访问配置、协议路由、资源配额拆成各自的说明页。 |
| Pass 1（2026-11-02） | 沿新平台入口跟随一次调用 | `createGateway`、`src/platforms/`、`src/state/`、`deploy/`、`tools/build-platforms.mjs` | 共享核心保留；新平台直接访问上游，状态仍经认证服务访问原 DO。 |
| Pass 2（2026-11-02） | 检查平台边界与并发反例 | 状态通道、运行时预算和产物回归；Makers/ESA 官方规格；OAuth 取消交叉审查 | 强一致读取不能替代串行更新；首字节、总时长、状态 body 取消和请求级 OAuth 刷新必须分别约束；真实平台尚未验收。 |
| Pass 1（2026-11-02，自建状态） | 跟随三个入口到真实持久化服务 | `GatewayStateStore`、`sqlite.mjs`、Node HTTP 宿主、三入口集成、六套构建模板 | 自建 SQLite 成为独立权威，无 Cloudflare DO/KV 必需依赖；模型流仍直接由网关请求上游。 |
| Pass 2（2026-11-02，自建状态） | 挑战事务、重启、迁移和 HTTP 边界 | 跨连接及跨进程更新、会话重启、空库导入竞态、在线备份、取消与 raw path 测试；Node/SQLite 官方文档和独立复核 | 事务保护完整读改写；旧快照不能覆盖已有状态；修复仅含 VIEW 的其他数据库被误接管；本地集成与生产验收分开。 |
| Pass 1（2026-11-02，部署验收） | 从生成产物进入实际 Linux 容器和官方 CLI | Dockerfile、Caddy 模板、`verify-self-hosted-container.mjs`、`verify-state-tls.mjs`、`verify-edge-builds.mjs` | 把源码导入与产物运行分开；私有 CA TLS 与公网证书分开；按平台记录真正可用的本地命令。 |
| Pass 2（2026-11-02，部署验收） | 检查恢复、证书拒绝、权限和清理边界 | Linux 0600/WAL/硬链接、备份恢复到新路径、跨 origin 会话、未信任 CA、错误主机名、资源 UUID 标签与独立复核 | 备份恢复不能覆盖含旧 WAL/SHM 的路径；TLS 负例不能用网络失败替代；不登录、上传或把通用打包标为厂商验收。 |
| Pass 1（2026-11-02，内部审查） | 沿旧核心与新宿主交界检查文档、安全、逻辑及资源使用 | 共享状态引擎、SQLite/远程信号、OAuth 控制请求、ESA 管理诊断、构建和维护工具；README 与概念页 | 把订阅者取消、共享任务关闭、控制请求读取及平台总预算分别建模；修正仍把用量权威写成 DO 的文档。 |
| Pass 2（2026-11-02，内部审查） | 用真实文件与并发反例验证修复 | 用量 A/B 取消、无响应网络关闭、父子信号、OAuth 挂起/超限/滴流、ESA 零探针拒绝、构建硬链接、摘要数组类型回归 | 修复跨请求取消污染、诊断部分执行、悬挂读取及目录外文件覆盖；摘要严格类型属于授权输入加固，不是越权。 |
| Pass 1（2026-11-02，第二轮审查） | 反查上一轮修复及未覆盖的成功/错误路径 | 模型目录去重、数据库路径与备份、平台成功上传/HEAD、OAuth 和目录诊断；SQLite GraphQL 传输封装 | 备份路径必须与 WAL 对应，硬链接主文件别名不能充当当前权威；成功响应也需要清理未使用上传。 |
| Pass 2（2026-11-02，第二轮审查） | 对照真实 WAL、算法规模及旧 GraphQL 错误语义 | 撤销后硬链接备份反例、目录 1000/5000/10000 模型夹具、HTTP/GraphQL 错误矩阵及平台生命周期测试 | 打开与备份拒绝多链接 DB；集合去重保留目录顺序；有界传输仍保留明确鉴权拒绝回退，其他失败不扩散。 |
| Pass 1（2026-11-02，第三轮审查） | 沿容量与清理边界追查前两轮遗漏 | 满 16 MiB 配置导出、未鉴权停滞上传、半开 CONNECT/Upgrade/解析错误、协议拒绝等待上游取消；Cloudflare 官方 DO 容量说明 | 区分配置字节与迁移封装、认证与正文缓冲、发出取消与取消确认；原生 DO 和自建 SQLite 容量不能混同。 |
| Pass 2（2026-11-02，第三轮审查） | 交叉验证修复与旧契约 | SQLite→认证服务→导出导入往返、超限写入回滚后撤销、真实 TCP、取消未决/抛错/拒绝、完整旧协议矩阵与 keepalive/鉴权中断连 | 导出仅增加元数据余量；认证前置、特殊连接有限关闭；共享取消及时结束本地消费且不重发生成。Expect 上传正常关闭是反证，没有为其增加修复。 |

## 理解提要

场景：客户端用实例调用密钥向 `/v1/chat/completions` 发送模型别名和消息，别名指向一个已配置的供应商模型。网关核验调用权，解析目标，再从启用且允许该模型的账号中选择上游。普通结果或 SSE 返回客户端协议。

难点是三种权限和多种协议同时存在：知道一个模型名字，不代表有可用账号；请求要求的工具、思考或格式约束，也不一定能跨供应商实现。失败例是网络中断后不能判断是否已经生成，因此不会换账号重做。可推翻这个模型的证据是第二次生成调用、错误凭据路由或被丢弃的显式约束；下一步应检查具体协议与目标账号的组合，而非从聊天成功推断全部兼容。

## 证据表

| Claim | Evidence | Confidence | Caveat | Used by |
| --- | --- | --- | --- | --- |
| 三个平台通过认证状态服务共享自建 SQLite；DO 桥接可选 | [远程通道](../../src/state/remote.mjs)、[服务](../../src/state/service.mjs)、[三入口集成](../../tests/self-hosted-platforms.test.mjs) | 已确认本地实现 | Bearer 令牌属于高权限边界，不提供被盗令牌防重放；云端持久化另验 | [平台指南](../modules/platform-adapters.md) |
| 请求级网络、输入及流预算与其他请求隔离 | [运行时](../../src/platforms/shared.mjs)、[核心注入回归](../../tests/gateway-runtime.test.mjs)、[预算回归](../../tests/platform-runtime.test.mjs) | 已确认本地实现 | 原生 signal 存在不证明真实断连传播 | 平台指南、上游与配额 |
| 六套部署产物隔离 Node 模块与边缘入口、源码与静态目录，不读取真实 Secret | [构建器](../../tools/build-platforms.mjs)、[产物测试](../../tests/platform-build.test.mjs)、[部署工具](../../tools/verify-edge-builds.mjs) | 已确认本地实现 | Wrangler dry-run/workerd 与其他平台、云端部署分别验收 | 代码地图、平台指南 |
| 自建产物可以在隔离 Linux 容器运行，Caddy TLS 保持链与主机名验证 | [容器工具](../../tools/verify-self-hosted-container.mjs)、[TLS 工具](../../tools/verify-state-tls.mjs)、[TLS 客户端断言](../../tools/verification/state-tls-client.mjs) | 实际结果见同步记录 | 内部 CA 不证明公网签发；容器重启不等于主机掉电恢复 | 平台指南、部署说明 |
| 管理凭据、实例调用密钥和供应商凭据分工不同 | [请求与鉴权](../../_worker.js)：`handleRequest`、`checkProxyAuth`、`checkAdminAuth`；[安全断言](../../tests/security-hardening.test.mjs) | 已确认 | 不证明真实 Secret 的保管方式 | [访问与配置](../modules/access-and-config.md)、主流程 |
| 配置、会话与用量由选定权威保存；SQLite 配置/会话事务覆盖读改写，KV 只用于原生 DO 首次迁移 | [共享引擎](../../_worker.js)、[SQLite 存储](../../src/state/sqlite.mjs)、[真实事务断言](../../tests/sqlite-state.test.mjs)、[DO 兼容断言](../../tests/config-auth.test.mjs) | 已确认本地实现 | SQLite 支持边界为单机本地磁盘，用量刷新合并不跨进程；云端迁移另验 | 访问与配置 |
| 导入只接受无业务状态的数据库，备份不覆盖已有目标 | [维护工具](../../tools/state-admin.mjs)、[导入及备份断言](../../tests/state-admin.test.mjs) | 已确认本地实现 | 工具不能证明导出时旧写入已冻结，恢复旧备份需核对撤销 | 平台指南 |
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

第一方实现范围：根 Worker、平台与状态适配器、部署模板和构建器、测试、离线维护工具、GitHub 工作流、文档站配置与默认主题入口。品牌 SVG 和截图只核对展示入口；源码地图列出责任及验证位置。

相邻路径已确认但不逐段解释：管理界面每个交互、用量 GraphQL 字段、所有模型的多模态能力和完整跨协议组合。`node_modules`、构建产物、缓存、未启用的文档装饰资源及其第三方 vendor 不作为业务实现证据。没有访问真实账号、读取生产私有配置或执行线上请求。

## 反证与后续问题

反证检查（Falsifying check）：如果同一个不确定网络结果触发第二轮生成、被撤销的密钥因并发写重新出现、或跨供应商转换丢掉显式约束后继续调用，应修改主流程模型并增加对应回归。

下一位读者可能问（Next reader question）：怎样知道一个具体模型与协议组合能用于生产？先检查[路由支持与拒绝边界](../modules/routing-and-protocols.md)，再单独验证真实账号权限、云端存储和流取消；本地模拟与文档构建不能替代这些结果。实际执行记录集中在[同步记录](../change-log.md)。

证据状态：除特别标注外，本页基于当前源码已确认。
