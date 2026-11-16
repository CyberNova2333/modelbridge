# 架构全景与源码导览

ModelBridge 采用“**共享核心 + 注入式平台适配器 + 独立配置权威**”设计：请求解析、鉴权校验、路由与跨协议转换全部集中在根目录 [`_worker.js`](https://github.com/CyberNova2333/modelbridge/blob/main/_worker.js)，通过工厂函数 `createGateway(runtime)` 消费不同边缘运行时与状态后端能力。

## 交互式架构全景图

<DiagramFrame
  src="/diagrams/modelbridge-architecture.html"
  title="多平台边缘计算适配矩阵（基于 Archify 的高保真交互图表，支持平移/缩放/探查）"
  aspect="710 / 498"
  new-tab-label="在新窗口全屏打开 ↗"
/>

## 源码职责划分

| 源码目录 / 入口 | 核心职责 | 延伸源码指南（`repo-docs/` 实时引入） |
| :--- | :--- | :--- |
| `_worker.js`（核心网关） | 门户/控制台页面、四态鉴权、会话管理、路由匹配、协议互转、`fetchUpstream` 有界出站与响应脱敏 | [一次完整请求走读](/walkthroughs/one-real-run) · [访问与配置存储](/modules/access-and-config) |
| `src/platforms/`（边缘适配层） | `cloudflare.mjs`、`edgeone.mjs`、`esa.mjs` 与共享 `shared.mjs`（注入 `PLATFORM_LIMITS`、客户端 IP 解析与远程状态客户端） | [边缘平台与自建状态](/modules/platform-adapters) |
| `src/state/`（远程状态契约） | `remote.mjs`（`STATE_REQUEST_LIMIT` 2 MiB / `STATE_RESPONSE_LIMIT` 16 MiB）、`service.mjs`（Worker DO RPC 端）、`sqlite.mjs`（`node:sqlite` WAL + `BEGIN IMMEDIATE`） | [访问与配置存储](/modules/access-and-config) |
| `src/self-hosted/server.mjs` | Node.js 24 本地 HTTP 状态服务（默认 `127.0.0.1:8788`、`/_modelbridge/state`），校验 `MODELBRIDGE_STATE_TOKEN` / `_FILE` 与精确 Origin | [边缘平台与自建状态](/modules/platform-adapters) |
| `tools/`（构建、运维与验证） | `build-platforms.mjs` 生成 6 套 `dist/` 产物；`state-admin.mjs` 提供导出、导入与在线备份；`verify-*.mjs` 与 `repo_maintenance_guard.py` | [代码地图（Code Map）](/code-map) |

## 源码级深度指南导览

以下页面直接内联渲染仓库 `repo-docs/` 的源码级参考文档，并保留精确代码行号与证据索引：

- **端到端主链路**：[一次完整请求走读](/walkthroughs/one-real-run) — 追踪客户端请求穿过 `runPlatformRequest`、鉴权、模型映射、`fetchUpstream` 与用量提交的每一步。
- **全仓代码地图**：[代码地图（Code Map）](/code-map) — 按文件定位每个关键模块、测试与部署模板。
- **四个核心子系统**：
  - [访问控制、会话与配置存储](/modules/access-and-config)
  - [模型路由与跨协议转换](/modules/routing-and-protocols)
  - [上游调用、OAuth 与配额统计](/modules/upstream-and-quota)
  - [边缘平台适配与自建状态服务](/modules/platform-adapters)
- **术语、证据与审计台账**：[核心术语表](/glossary) · [源码证据索引](/references/source-evidence) · [文档质量审查](/references/quality-review) · [文档校准与验证记录](/change-log)

## 贡献者日常工作流

```sh
# 1. 提交前必须通过语法与边界检查
pnpm run check

# 2. 运行全部离线模拟测试（Node.js 24+）
node --test tests/*.test.mjs

# 3. 修改多平台打包逻辑后，同步验证 6 套 dist/ 产物
node tools/build-platforms.mjs
```

- 提交规范受仓库内置钩子 `tools/repo_maintenance_hooks`（与 `tools/repo_maintenance_guard.py`）约束：提交标题需符合 Conventional Commits，并自动扫描疑似凭据、内网地址及本机绝对路径残留；**禁止使用 `--no-verify` 跳过检查**。
- 提交规则与安全漏洞披露渠道分别见仓库根目录 `CONTRIBUTING.md` 与 `SECURITY.md`。

## 下一步

- 了解各关键架构取舍背后的原因，以及如何把既有 Cloudflare DO 实例平滑迁入自建 SQLite：继续阅读 [关键架构决策与迁移](/docs/migrations)。
