# ModelBridge Agent 规则

本文件是规范单一来源。先读 _worker.js 对应路由与 tests 的当前断言；单文件包含多协议、管理与存储，不能以一个聊天用例声称完整兼容。

## 命令

| 用途 | 命令 |
| --- | --- |
| 回归测试 | `node --test tests/*.test.mjs`（Node.js 24+、Python 3.10+、Git；模拟上游，不需 npm 依赖安装） |
| 多平台产物 | `node tools/build-platforms.mjs`（只生成 `dist/` 下部署项目，不发布） |
| 自建状态服务 | `pnpm run start:state`（Node.js 24+、本地 SQLite；先设置环境及 HTTPS 反代，不默认暴露公网） |
| 本地部署验收 | `pnpm run verify:container`；`pnpm run verify:tls -- --state-image <image>`；`pnpm run verify:edge-builds`（显式运行，需 Docker/下载固定 CLI；不发布） |
| 开发 | `pnpm dlx wrangler dev`（先核对本地绑定/Secret，可能占用端口） |

## 约束

- 调用密钥、管理员登录和上游凭据分离；每个实例只能有一个配置权威（自建 SQLite 或原生 DO），不能用旧 KV、备份或另一后端自动回退。并发配置写不能复活已撤销密钥；切换权威先停止旧端写入，导入仅限空库。
- `_worker.js` 保持自包含共享核心及原生入口；`src/platforms/` 注入请求级状态、fetch、身份与预算，不用可变全局上下文。远程状态令牌是高权限服务凭据，只经固定 HTTPS 端点访问选定状态服务，不重试不确定写入。自建 SQLite 的配置/会话读改写必须在事务内完成，网络请求留在事务外。
- 模型映射解析目标，账号类型、启用状态及模型白名单限制候选；空模型列表不限制，映射不是封闭名称白名单。通用供应商、Cloudflare 和 OAuth 账号不混用凭据。
- 保留不确定网络结果不重试、明确拒绝最多三个候选账号、响应大小/闲置超时、错误脱敏、SSE 元信息过滤和客户端取消传播。不把本地取消当已停止计费。
- 工具、签名思考及协议回放元数据必须保留语义；不支持的约束显式拒绝，不伪造供应商兼容性。模拟上游测试与真实账号权限、持久化、生产验收分开报告。
- 不写真实管理员 Secret、调用密钥、账号 Token 或私有配置到文档/日志；不部署或动运行服务来验证文档。
- 提交格式 `type(scope): 中文描述`（Conventional Commits），具体类型、范围和模板以 CONTRIBUTING.md 为准，保留更严格上级要求。发布、部署、推送需明确授权，保护未提交工作。

## 维护入口

贡献约定见 [CONTRIBUTING.md](CONTRIBUTING.md)，安全报告见 [SECURITY.md](SECURITY.md)。
在新克隆中运行 `python tools/repo_maintenance_guard.py install` 接入补充护栏，再用 `python tools/repo_maintenance_guard.py status` 核对配置。安装保留原有钩子；补充护栏检查暂存内容、提交标题及推送新增历史，检查无法完成时阻止操作。项目原有更严格的署名、签名、分支和验收规则继续适用。安装是配置操作，不是业务验证。

## Repo docs

`repo-docs/` is the living guide; start with [the reading path](repo-docs/README.md) and [the main walkthrough](repo-docs/walkthroughs/one-real-run.md).
This repo's `repo-docs/` guide is reader-facing Chinese documentation. When updating reader-facing guide pages, use `repo-docs-zh` when available; keep Chinese reader handles in the prose and preserve exact source identifiers for lookup.
Read current source, scripts and tests before treating the guide as implementation truth. Repo questions, behavior changes, user uncertainty, stable knowledge discovered in conversation, and knowledge about to be saved to memory trigger a foreground sync gate with `repo-docs` Sync mode when available (otherwise inspect the guide and source manually).
Choose `none`, `answer-only`, `foreground patch`, or `background sync`. Patch the smallest owning page before the final answer when a durable local gap would mislead; use background sync only with a real tracked handoff and no answer-critical gap. Do not rewrite docs for transient debug state.
Update the walkthrough for input/output or boundary changes and the code map for responsibility changes. Record meaningful guide changes and actual verification in `repo-docs/change-log.md` with `Synced through <sha>`; do not imply unrun tests passed.

文档站统一使用 VitePress 默认主题；样式与动效遵循原生主题，构建输出独立于业务界面。
