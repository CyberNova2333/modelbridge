# 模桥 · ModelBridge 代码地图

先用[一次请求的交接](walkthroughs/one-real-run.md)建立行为模型，再按职责选修改入口。本页覆盖根 Worker、测试、维护工具、CI 与文档站的第一方实现；详细机制归各概念页，不用文件列表代替流程解释。

| 路径 | 职责 | 关键代码 | 与主流程的关系 |
| --- | --- | --- | --- |
| `./` | 处理请求、权限、配置、协议和内嵌界面 | `_worker.js`、`wrangler.toml` | 业务入口与云端绑定 |
| `tests/` | 以模拟上游和存储检验业务边界 | `*.test.mjs` | 按公共请求检查正常及失败路径 |
| `tools/` | 离线检查暂存对象、提交信息及推送历史 | `repo_maintenance_guard.py`、Git hooks | 开发维护支线 |
| `.github/workflows/` | 运行回归，验证并提议上游更新 | `test.yml`、`sync-upstream.yml` | 交付支线，不参与生成 |
| `docs-site/` | 独立发布中文指南 | `.vitepress/`、页面 include、`tests/` | 文档支线，不参与业务请求 |
| `assets/`、`img/` | 保存品牌图形和演示截图 | SVG、PNG | 展示资源，不参与模型路由 |

## `./`

| 重要代码 | 功能 | 关键符号 | 调用方 / 使用方 |
| --- | --- | --- | --- |
| [请求入口](../_worker.js) | 分派业务、管理和 Gemini 路由 | `fetch / handleRequest / handleV1Proxy / handleGeminiEndpoint` | Worker 请求 |
| [权限与配置](../_worker.js) | 分离调用权、管理会话及配置更新 | `checkProxyAuth / AppConfigStore / configRequest / getAppConfig` | 所有鉴权及配置操作 |
| [输入与账号校验](../_worker.js) | 有界读取 JSON，规范账号和凭据更换 | `readRequestJson / normalizeProviderAccountInput` | 业务与管理入口 |
| [模型和上游选择](../_worker.js) | 解析目标并筛选候选账号 | `resolveModelName / parseUpstreamTarget / getMatchingUpstreamAccounts` | 聊天、嵌入、协议适配 |
| [协议转换](../_worker.js) | 维护消息、工具、思考、结束与流语义 | `handleCompletions / handleMessages / normalizeGeminiRequestFields / anthropicStreamTransform` | 三类客户端和各上游 |
| [嵌入契约](../_worker.js) | 归一化请求配置并校验向量输出 | `handleEmbeddings / normalizeEmbeddingOptions / validateEmbeddingOutput` | OpenAI 与 Gemini 向量入口 |
| [上游资源边界](../_worker.js) | 有界读取、明确拒绝切换、错误脱敏 | `fetchUpstream / shouldRetryUpstream / sanitizeUpstreamErrorStream` | 模型调用及连接测试 |
| [OAuth 与统计](../_worker.js) | 刷新 Token、发现项目、缓存 Cloudflare 用量 | `getAntigravityToken / refreshAntigravityToken / usageAccountGroups` | Antigravity 与管理统计 |
| [部署配置](../wrangler.toml) | 指定服务名、绑定、迁移和日志选项 | `KV / CONFIG_STORE / AppConfigStore` | Wrangler；Secret 另行配置 |
| [项目许可](../LICENSE)、[来源声明](../NOTICE)、[上游 MIT](../LICENSES/WorkersAI2API-MIT.txt) | 记录 GPLv3 分发与保留的上游许可 | `GPL-3.0-only` | 源码再分发 |

改权限或存储先看[配置生命周期](modules/access-and-config.md)，改转换先看[协议契约](modules/routing-and-protocols.md)，改网络行为先看[资源与配额边界](modules/upstream-and-quota.md)。这些机制仍在单文件中，不能只凭一个聊天用例确认全部兼容。

### 品牌与部署名称

网页静态名称由 `PROJECT_DISPLAY_NAME` 设置为“模桥 ModelBridge”；Worker 服务名由 `wrangler.toml` 的 `name` 设置，当前是 `aigateway`。改服务名不会自动改网页品牌。

首页、后台侧栏与移动顶栏使用 `projectBrandMarkup` 和 `PROJECT_BRAND_CSS`；内嵌 `PROJECT_ICON_SVG` 通过数据地址用于品牌图片及页签图标。仓库的 [Logo](../assets/modelbridge-logo.svg) 和[方形图标](../assets/modelbridge-icon.svg)是独立素材，修改图形要同时核对内嵌版本。当前 Worker 没有 `/assets/` 静态路由，README 的图片链接不是线上下载地址。

## `tests/`

在根目录运行 `node --test tests/*.test.mjs`。测试以公共入口或专门提取的转换器约束行为；需要 Node.js 24+、Python 3.10+ 和 Git。

| 重要代码 | 功能 | 关键符号 | 调用方 / 使用方 |
| --- | --- | --- | --- |
| [配置迁移](../tests/config-auth.test.mjs)、[请求作用域](../tests/config-scope-regressions.test.mjs)、[管理安全](../tests/security-hardening.test.mjs) | 迁移、并发、撤销、会话与界面注入 | DO/KV 模拟、管理公共路由 | 权限或存储变更 |
| [跨上游](../tests/universal-upstreams.test.mjs)、[跨协议](../tests/cross-protocol.test.mjs)、[Gemini 端点](../tests/gemini-endpoints.test.mjs) | 多供应商 JSON/SSE、工具和端点契约 | 模拟上游与客户端协议 | 转换与路由变更 |
| [协议安全](../tests/protocol-safety.test.mjs)、[SSE 元信息](../tests/sse-metadata-security.test.mjs)、[签名回放](../tests/replay-compatibility.test.mjs) | 约束拒绝、元信息过滤及回放 | 工具、签名思考、分块输入 | 协议边界变更 |
| [请求回归](../tests/review-request-security.test.mjs)、[协议回归](../tests/review-protocol-regressions.test.mjs)、[后续协议回归](../tests/review-protocol-round2.test.mjs) | 字节预算、别名冲突、终止、严格工具与原生工具 | 有效输入及零调用拒绝 | 安全与语义修补 |
| [上游安全](../tests/upstream-safety.test.mjs)、[上游回归](../tests/review-upstream-regressions.test.mjs)、[账号与向量回归](../tests/review-account-embedding-round2.test.mjs) | 重试、超时、取消、凭据切换、向量结果 | HTTP 模拟、异常与并发 | 资源控制或账号变更 |
| [账号管理](../tests/provider-admin.test.mjs)、[配额与项目](../tests/quota-project-regressions.test.mjs)、[Antigravity](../tests/antigravity.test.mjs) | 连接测试、统计去重、项目发现及 OAuth | 账号编辑与用量公共路由 | OAuth 或管理变更 |
| [维护护栏](../tests/repo-maintenance-guard.test.mjs) | 在临时仓库检查例外撤销、合并及历史 | Python / Git 子进程 | 维护脚本变更 |

其余同目录协议专项用例仍由通配命令执行，不能把上表选取的修改入口理解为完整覆盖证明。实际结果见[同步记录](change-log.md)。

## `tools/`

| 重要代码 | 功能 | 关键符号 | 调用方 / 使用方 |
| --- | --- | --- | --- |
| [离线护栏](../tools/repo_maintenance_guard.py) | 读取索引和历史 Git 对象，检查标题与敏感内容 | `staged / pushed / revoked_exception_paths / ObjectBatch` | Git hooks 和隔离回归 |
| [提交前钩子](../tools/repo_maintenance_hooks/pre-commit)、[消息钩子](../tools/repo_maintenance_hooks/commit-msg)、[推送钩子](../tools/repo_maintenance_hooks/pre-push) | 串联原钩子与补充检查，失败阻止操作 | 对应 guard 子命令 | 本机 Git 操作 |

安装与提交说明由[贡献指南](../CONTRIBUTING.md)维护，扫描边界由[安全说明](../SECURITY.md)维护。护栏是补充检查，不能证明业务正确或所有凭证都已识别。

## `.github/workflows/`

| 重要代码 | 功能 | 关键符号 | 调用方 / 使用方 |
| --- | --- | --- | --- |
| [测试工作流](../.github/workflows/test.yml) | 分开运行 Worker 回归与文档依赖审计、冒烟、构建 | `test / docs` jobs | PR、main 推送、手动触发 |
| [上游更新提案](../.github/workflows/sync-upstream.yml) | 在只读任务测试候选树，写权限任务核对后创建草稿 PR | `validate / propose` jobs | fork 的定时或手动触发 |

上游提案不是自动合并或部署。更改安全工作流时要同时检查权限、候选代码执行位置和树哈希核对，不能只验证 YAML 能解析。

## `docs-site/`

| 重要代码 | 功能 | 关键符号 | 调用方 / 使用方 |
| --- | --- | --- | --- |
| [包配置](../docs-site/package.json)、[锁文件](../docs-site/package-lock.json) | 文档依赖与开发、构建、冒烟命令 | `docs:build / test:smoke / overrides` | npm 与文档 CI |
| [站点配置](../docs-site/.vitepress/config.mts) | 导航、搜索虚拟模块兼容及页面路由 | `pages / localSearchIds / themeConfig` | VitePress |
| [链接处理](../docs-site/.vitepress/guide-links.mts) | 把指南链接改为站点路由，源码链接显示精确路径 | `guideLinks` | Markdown 构建 |
| [主题入口](../docs-site/.vitepress/theme/index.ts) | 使用 VitePress 默认主题 | `DefaultTheme` | 站点展示，与业务界面独立 |
| [页面包装](../docs-site/index.md)及对应子页 | include 读取唯一指南正文 | `repoGuideSource / @include` | Markdown 构建 |
| [服务冒烟](../docs-site/tests/dev-server.test.mjs) | 临时服务检验初始搜索、正文 HMR 和访问边界 | HTTP / WebSocket | `test:smoke` |

VitePress 1.6.4 的开发搜索索引需重启开发服务刷新；静态构建会重建索引。正文热更新与生产构建不由这项已知开发限制否定。

## 覆盖范围

已覆盖第一方业务入口及维护支线的责任和关键修改点；没有逐段审计每个 UI 控件、用量 GraphQL 字段或所有供应商功能。`repo-docs/` 是本指南正文，根 README 是双语使用入口，贡献与安全文件各有独立维护职责。

`assets/` 和 `img/` 仅作为展示素材概述；`node_modules`、`.vitepress/cache`、`.vitepress/dist`、`.wrangler` 和外部临时日志是依赖或生成物。文档主题目录保留的未启用装饰资源与第三方 vendor 不参与当前默认主题，也不作为业务源码覆盖。

证据状态：除特别标注外，本页基于当前源码已确认。
