<h1 align="center">
  <img src="assets/modelbridge-logo.svg" width="560" alt="模桥 ModelBridge">
</h1>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-GPL--3.0--only-2563eb?style=flat-square" alt="许可证：GPL-3.0-only"></a>
  <a href="#快速部署"><img src="https://img.shields.io/badge/Cloudflare-Workers-0c5cab?style=flat-square&amp;logo=cloudflare&amp;logoColor=white" alt="运行平台：Cloudflare Workers"></a>
  <a href="_worker.js"><img src="https://img.shields.io/badge/JavaScript-ES_Modules-3178c6?style=flat-square&amp;logo=javascript&amp;logoColor=white" alt="JavaScript ES Modules"></a>
  <a href="repo-docs/modules/routing-and-protocols.md"><img src="https://img.shields.io/badge/API-OpenAI%20%7C%20Anthropic%20%7C%20Gemini-1d4ed8?style=flat-square" alt="协议入口：OpenAI、Anthropic、Gemini"></a>
</p>

<p align="center">
  <strong>简体中文</strong> · <a href="README.en.md">English</a>
</p>

<p align="center">
  <a href="#快速部署">快速部署</a> · <a href="repo-docs/README.md">项目文档</a> · <a href="CONTRIBUTING.md">贡献指南</a>
</p>

模桥 ModelBridge 是多模型、多协议 API 网关，提供原生 Cloudflare Workers 入口，以及 EdgeOne Makers、阿里云 ESA 的平台适配器。配置上游账号和模型别名后，客户端可以通过 OpenAI、Anthropic 或 Gemini 接口调用受支持的模型，并在蓝色管理面板管理账号、调用密钥和 Cloudflare 用量。

推荐使用 Node.js 24 + SQLite 自建权威状态服务，Cloudflare Workers、Makers、ESA 均通过 HTTPS 接入，无需 Cloudflare DO 或 KV。原生 DO 部署保留兼容与迁移路径；平台容量存在差异，真实云端运行仍待验收。详见[多平台部署与限制](repo-docs/modules/platform-adapters.md)。

项目基于 [WorkersAI2API](https://github.com/cmliussss2024/WorkersAI2API) 开发，支持 Cloudflare Workers AI、OpenAI 兼容服务、Anthropic、Gemini，以及实验性的 Antigravity（Google Cloud Code）接入。下文的原生 Pages 部署方案需要额外绑定由 Worker 托管的 Durable Object。

品牌素材：[横版 Logo](assets/modelbridge-logo.svg) · [独立图标](assets/modelbridge-icon.svg)。网页显示名由 `PROJECT_DISPLAY_NAME` 设置，与 Wrangler 的 Worker 服务名独立。

### 界面预览

以下截图使用本地演示数据。

![公开首页](img/1.png)

![管理页面](img/2.png)


## 阅读路径

| 读者目标 | 从这里开始 | 读完后获得什么 |
| --- | --- | --- |
| 部署并开始调用 | [快速部署](#快速部署) → [首次使用](#首次使用) | 存储绑定、账号配置与调用示例 |
| 理解一次请求 | [项目指南](repo-docs/README.md) → [主流程](repo-docs/walkthroughs/one-real-run.md) | 从鉴权、选路到返回结果的行为模型 |
| 查兼容范围和运行边界 | [模型路由与协议](repo-docs/modules/routing-and-protocols.md)、[上游与配额](repo-docs/modules/upstream-and-quota.md) | 哪些能力可转换、何时拒绝或停止重试 |
| 修改代码或提交贡献 | [代码地图](repo-docs/code-map.md)、[贡献指南](CONTRIBUTING.md) | 修改入口、验证方式与提交约定 |
| 核对解释依据 | [源码证据](repo-docs/references/source-evidence.md) | 已确认事实、验证边界与未覆盖区域 |

## 功能与边界

- 提供 OpenAI Chat Completions、旧版 Completions、Embeddings、Anthropic Messages，以及 Gemini 内容生成、向量和模型目录端点。
- 支持多账号、模型别名、账号模型声明和最多三个候选账号的有限故障切换。
- 转换受支持的 JSON 与流式响应，保留工具调用、拒绝、截断和签名思考的语义；无法表达的约束会明确报错。
- 管理员登录、客户端调用密钥和上游凭据分离。未创建调用密钥或删除最后一个密钥后，模型调用入口保持关闭。
- 配置由自建 SQLite 事务或原生 Durable Object 统一保存，保留并发更新与密钥撤销；Cloudflare 用量通过缓存展示。

模型目录包含多种任务，并不意味着所有模型都能通过聊天接口调用。本项目没有实现完整的图片、音频或其他媒体生成 API，也不提供跨供应商精确 token 计数。真实模型权限取决于上游账号，模拟测试不等于生产验收。

## 快速部署

从公开仓库获取源码：

```sh
git clone https://github.com/CyberNova2333/modelbridge.git
cd modelbridge
```

推荐新部署采用[自建状态服务与多平台入口](repo-docs/modules/platform-adapters.md)。下面先保留原生 Cloudflare DO 部署步骤，便于已有实例维护。

### Workers（原生 DO 兼容部署）

先安装 Node.js 24+，使用 Wrangler 登录自己的 Cloudflare 账号并创建 KV：

```sh
pnpm dlx wrangler login
pnpm dlx wrangler kv namespace create KV
```

仓库的 `wrangler.toml` 保留维护者实例的部署配置。新建实例前修改以下项目，已有实例升级时保留原有存储绑定：

| 配置 | 操作 |
| --- | --- |
| `name` | 改为自己的 Worker 名称；它不会修改网页品牌 |
| `account_id` | 改为自己的 Cloudflare Account ID |
| `routes` | 改为自己的自定义域名，或移除该配置使用 Workers 域名 |
| `kv_namespaces` 的 `id` | 填入创建命令返回的 ID；升级时使用原 KV |
| `CONFIG_STORE` / `AppConfigStore` | 保留 Durable Object 绑定及 `new_sqlite_classes` 迁移 |

KV 绑定格式：

```toml
[[kv_namespaces]]
binding = "KV"
id = "YOUR_KV_NAMESPACE_ID"
```

保留 `compatibility_flags` 中的 `global_fetch_strictly_public`、`enable_request_signal`，以及 `observability.redact_query_string = true`。前两个[兼容性开关](https://developers.cloudflare.com/workers/configuration/compatibility-flags/)分别让全局 fetch 按公共互联网路径路由（避免直达自身区域源站的捷径）、启用入站请求取消信号；后一个[日志设置](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/script_and_version_settings/)从日志和追踪请求 URL 中移除查询字符串。公共路由开关不等于完整的私网访问防火墙。

```sh
pnpm dlx wrangler deploy
pnpm dlx wrangler secret put ADMIN_PASSWORD
```

`ADMIN_PASSWORD` 是必需的管理员 Secret；缺少它时所有访问被拦截。已有实例升级无需重复设置。不要把密码或上游凭据写入 `wrangler.toml`。

Wrangler 部署时应用 SQLite Durable Object 迁移。首次读取配置时，`AppConfigStore` 将原 KV 的 `config` 导入一次；后续账号、密钥、映射以 Durable Object 为准，会话及用量缓存也存放其中。KV 的旧快照不会继续同步。回滚必须保留当前 Durable Object，不能直接用只读旧 KV 的版本覆盖当前状态。详见[访问与配置](repo-docs/modules/access-and-config.md)。

### Pages

按 [Pages 绑定要求](https://developers.cloudflare.com/pages/functions/bindings/)，Pages 不能独立托管 Durable Object，单独上传 `_worker.js` 不足以运行：

1. 按上面的 Workers 步骤部署导出 `AppConfigStore` 的 Worker，绑定原有 `KV`。
2. 为 Pages 上传 `_worker.js`，绑定同一个 `KV`，设置 `ADMIN_PASSWORD`。
3. 添加名为 `CONFIG_STORE` 的 Durable Object 绑定，选择托管 Worker 的 `AppConfigStore`。使用 Pages 的 Wrangler 配置时指定 `script_name`：

```toml
[[durable_objects.bindings]]
name = "CONFIG_STORE"
class_name = "AppConfigStore"
script_name = "YOUR_CONFIG_WORKER_NAME"
```

4. 在 Pages 兼容性配置中启用 `global_fetch_strictly_public` 和 `enable_request_signal`；客户端优先用请求头传密钥，单独核对 Pages 日志是否保留查询参数，再重新部署。

Pages 与托管 Worker 应使用相同版本代码，升级时先更新 Worker，再更新 Pages；迁移由托管 Worker 管理。两者共享配置，但各入口使用自己的管理员 Secret，会话按入口 origin 隔离。

### 自建状态服务 + Cloudflare / EdgeOne Makers / 阿里云 ESA

使用 Node.js 24+ 生成部署项目，无需安装根目录 pnpm 依赖：

```sh
node tools/build-platforms.mjs
```

新部署使用 `dist/self-hosted-state/`，再选择 `dist/cloudflare-remote/`、`dist/edgeone/` 或 `dist/esa/` 作为网关入口。`dist/cloudflare/` 和 `dist/state-service/` 保留原生 DO 与旧实例迁移用途。各项目带有模板和 README；构建不读取真实 Secret、不修改现有 Wrangler 配置、不发布服务。

先按[自建服务说明](deploy/self-hosted-state/README.md)准备持久化本地磁盘和 HTTPS 反代。服务配置 `DB_PATH`、`MODELBRIDGE_STATE_PUBLIC_ORIGIN`、独立 `MODELBRIDGE_STATE_TOKEN`（或令牌文件）及精确入口列表 `MODELBRIDGE_STATE_ORIGINS`；各网关配置 `ADMIN_PASSWORD`、同一服务令牌和完整 `MODELBRIDGE_STATE_URL`。服务令牌能读取上游凭据并修改状态，必须只保存在服务端 Secret 中。SQLite 版本面向单机部署，不支持把数据库放在网络文件系统上共享或多机独立写入。

Makers 以项目模式构建函数，只把 `public/` 作为静态输出；ESA 使用纯函数入口。Makers 应用输入预算为 1 MiB，实际受平台更小上限约束；ESA 适配器限制四次出站请求、9 秒首个响应数据、115 秒总时长。原生取消 API 缺失时明确拒绝服务。完整步骤、共享限流桶、跨入口会话与验收边界见[平台指南](repo-docs/modules/platform-adapters.md)。

## 首次使用

1. 打开部署地址，用 `ADMIN_PASSWORD` 登录。
2. 在「账号管理」添加上游账号，填写凭据和支持的模型 ID；Cloudflare 使用 Account ID 与 API Token。
3. 在「API 密钥」生成实例调用密钥。
4. 选择实例已配置且上游有权限的模型。OpenAI 客户端 Base URL 为 `https://YOUR_GATEWAY_DOMAIN/v1`，填入实例调用密钥。

以下为 Bash/curl 示例。用自己的域名、实例密钥与模型别名替换占位值：

```sh
curl 'https://YOUR_GATEWAY_DOMAIN/v1/chat/completions' \
  -H 'Authorization: Bearer YOUR_GATEWAY_API_KEY' \
  -H 'Content-Type: application/json' \
  -d '{"model":"gpt-oss-20b","messages":[{"role":"user","content":"你好"}]}'
```

管理员会话为随机令牌，24 小时后到期；退出登录或轮换密码会使相应会话失效。每个来源 IP 在 15 分钟窗口内最多允许 10 次失败登录。调用密钥撤销在下一次请求生效，配置快照只在单次请求内复用。详细信任边界见[访问与配置](repo-docs/modules/access-and-config.md)；报告问题前阅读[安全说明](SECURITY.md)。

## 配置上游与模型映射

| 上游类型 | 默认 Base URL | 凭据 |
| --- | --- | --- |
| Cloudflare | 固定 Workers AI 地址 | Account ID、API Token |
| OpenAI | `https://api.openai.com/v1` | API Key |
| Anthropic | `https://api.anthropic.com/v1` | API Key |
| Gemini | `https://generativelanguage.googleapis.com/v1beta` | API Key |
| Antigravity | 内置 Cloud Code 地址 | 邮箱、Refresh Token；兼容 Access Token |

通用上游可填写自己的兼容服务 Base URL，必须为不含用户名、密码、查询参数和片段的公共 HTTPS 地址；本地开发允许 HTTP loopback 地址。编辑同一类型时凭据留空保留原值，切换类型必须重新填写凭据，旧目标地址、身份与 OAuth 项目不会沿用。账号列表不会返回真实上游密钥。

「上游模型 ID」支持每行一个或逗号分隔；非空列表限制该账号可接收的模型，留空表示不限制。通用上游已声明的模型可直接使用；推荐为有歧义的名称设置显式映射：

```json
{
  "my-chat": "openai:YOUR_MODEL_ID",
  "my-claude": "anthropic:YOUR_MODEL_ID",
  "my-gemini": "gemini:YOUR_MODEL_ID",
  "my-oauth": "antigravity:YOUR_MODEL_ID",
  "my-vector": "@cf/baai/bge-m3"
}
```

Cloudflare 或通用上游需要固定账号时可用 `upstream:账号ID:模型ID`；Antigravity 使用自己的前缀选路。同一供应商中只有启用且匹配模型声明的账号参与选路。直接使用 `@cf/...` 或显式供应商前缀会绕过别名查找，因此映射表不是完整的访问或预算白名单。Cloudflare 模型路径中的路径穿越、查询参数与片段会被拒绝。详见[模型路由与协议](repo-docs/modules/routing-and-protocols.md)。

仓库预设 [Cloudflare 映射](cloudflare-model-map.json) 共 65 条，按可用每日免费额度的模型维护；「恢复预设映射」恢复这份列表。预设含聊天、向量和其他任务，选用时仍需匹配端点能力。面板按每个 Cloudflare Account ID 每日 10,000 Neurons 估算免费额度，相同账号的不同 Token 不增加额度。实际价格、可用模型和超额费用以 [Cloudflare 计费说明](https://developers.cloudflare.com/workers-ai/platform/pricing/) 为准；映射与统计缓存都不是服务端强制预算。

## Antigravity 实验接入

后台选择 Antigravity 后，手动粘贴邮箱和 `refresh_token`，无需导入 JSON。保存启用账号时会验证登录并查询项目，成功后才保存。高级设置可指定已授权项目及签发令牌的 OAuth 客户端；通常留空使用内置客户端。修改自动发现项目所绑定的邮箱、令牌或 OAuth 配置后会重新发现，手动指定项目会保留。

也可使用环境 Secret：

```sh
pnpm dlx wrangler secret put ANTIGRAVITY_REFRESH_TOKEN
```

可选 `ANTIGRAVITY_PROJECT_ID`、`ANTIGRAVITY_EMAIL`；`OAUTH_CLIENT_ID` 与 `OAUTH_CLIENT_SECRET` 必须成对配置，账号级设置优先。多账号环境配置使用 `ANTIGRAVITY_ACCOUNTS` JSON 数组，字段示例见[上游与配额](repo-docs/modules/upstream-and-quota.md)。旧的 `ya29.` Access Token 仍兼容，但不能自动续期。

内置别名包括 `claude-sonnet-4-5-thinking`、`claude-opus-4-5-thinking`、`claude-sonnet-4-5`、`gemini-3-flash`、`gemini-3-pro-high`、`gemini-3-pro-low`；存在别名不代表账号有权限。支持 `antigravity:` 和 `@antigravity/` 前缀。Claude Code 可将 `ANTHROPIC_BASE_URL` 指向网关根地址，并使用实例调用密钥；其他客户端使用对应协议端点。

这是对 Google Cloud Code 内部接口的实验兼容，协议变化可能影响可用性。令牌刷新后最多重试一次 401；并发刷新只在同一 Worker isolate 内合并。多轮工具调用须保留返回的思考签名。图片仅支持内嵌 base64；远程图片、文档及工具结果非文本媒体不支持。结构化 JSON 输出约束和无法表达的思考配置会在生成前拒绝，网关不会额外插入系统提示或伪造用户消息。

## 客户端协议

| 接口 | 方法与路径 | 调用鉴权 |
| --- | --- | --- |
| OpenAI 模型目录 | `GET /v1/models` | `Authorization: Bearer YOUR_GATEWAY_API_KEY` |
| OpenAI 对话 / 旧版补全 | `POST /v1/chat/completions`、`/v1/completions` | 同上 |
| OpenAI 向量 | `POST /v1/embeddings` | 同上 |
| Anthropic 消息 | `POST /v1/messages` | `x-api-key: YOUR_GATEWAY_API_KEY` |
| Gemini 模型目录 / 单个模型 | `GET /v1beta/models`、`/v1beta/models/{模型}` | `x-goog-api-key: YOUR_GATEWAY_API_KEY` |
| Gemini 内容 / 流式生成 | `POST /v1beta/models/{模型}:generateContent`、`:streamGenerateContent?alt=sse` | 同上 |
| Gemini 向量 / 批量向量 | `POST /v1beta/models/{模型}:embedContent`、`:batchEmbedContents` | 同上 |

Gemini 也支持 `/v1/models/{模型}:动作` 路径，但 `GET /v1/models` 始终返回 OpenAI 目录格式。不带 `alt=sse` 的 Gemini 流式请求返回 JSON 数组流；`:countTokens` 返回 501。Gemini 兼容 `?key=`，推荐请求头传密钥并保留查询字符串日志脱敏配置。表中均为实例调用密钥，上游凭据只配置在管理后台或环境 Secret。

```sh
curl 'https://YOUR_GATEWAY_DOMAIN/v1beta/models/gpt-oss-20b:generateContent' \
  -H 'x-goog-api-key: YOUR_GATEWAY_API_KEY' \
  -H 'Content-Type: application/json' \
  -d '{"contents":[{"role":"user","parts":[{"text":"你好"}]}]}'
```

文本、受支持的图片输入、函数工具、结构化输出及签名回放的兼容范围取决于目标上游。Anthropic 内置搜索等供应商工具、Gemini 安全设置与缓存上下文等原生约束不能跨供应商静默降级。OpenAI 与 Anthropic 之间保留工具 `strict`；其他不能保证严格工具模式的路由提前拒绝。Gemini 字段别名冲突、无法表达的采样或输出约束返回 400；异常结束、无效工具参数或不完整流会报错。完整边界见[模型路由与协议](repo-docs/modules/routing-and-protocols.md)。

## 用量与资源限制

公开首页只读缓存汇总，管理员刷新才查询 Cloudflare 用量。缓存为 5 分钟，同期刷新会合并；按 Account ID 去重，每批最多 20 个账号、并发最多 4 个查询。其他供应商用量应在各自控制台查看。

| 操作 | 资源边界与影响 |
| --- | --- |
| 登录 / 管理 / 模型 JSON 输入 | 实际读取字节上限分别为 16 KiB / 1 MiB / 16 MiB，含内嵌 base64；超限 413，无效 JSON 400 |
| 模型响应 | 等待响应头或响应体连续空闲 120 秒中止；最多 32 MiB |
| 账号故障切换 | 仅明确的 401、403、404、429 拒绝最多尝试三个匹配账号；不确定网络结果、无效成功响应及服务器错误不重新生成 |
| 通用上游连接测试 | 只读模型目录，不代表所有模型都可调用 |
| Antigravity 连接测试 | 验证登录和项目，不生成回答 |
| Cloudflare 连接测试 | 含一次小型向量推理，会消耗额度；15 秒响应头/闲置超时、1 MiB 响应上限 |

上表为共享核心的限制。Makers 输入还受 1 MiB 应用预算和平台上限约束；ESA 另受 9 秒首数据、115 秒总时长与每请求四次出站 fetch 限制，状态查询也计入。详见[平台预算](repo-docs/modules/platform-adapters.md#平台预算怎样影响请求)。

上游错误与 SSE 元信息会脱敏，正常模型文本及签名保持原值。客户端取消会传播到上游连接，但不能据此认定上游已停止计算或计费。向量输出校验数量、索引、维度和编码，无效结果返回 502 且不换账号重复生成。更多说明见[上游与配额](repo-docs/modules/upstream-and-quota.md)。

## 本地验证与贡献

回归测试需要 Node.js 24+、Python 3.10+ 和 Git，无需根目录 pnpm 安装。模型上游与 DO/KV 使用模拟；自建状态另以真实临时 SQLite、独立进程和本地 HTTP 验证。Python 和 Git 用于临时仓库中的维护护栏测试。

```sh
node --test tests/*.test.mjs
```

测试覆盖鉴权和并发配置、凭据隔离、账号选路、协议 JSON/SSE 转换、工具与签名回放、取消和响应边界、向量以及 OAuth 刷新。实际运行记录见[指南变更记录](repo-docs/change-log.md)，不以模拟结果声称真实账号权限、生产持久化或线上部署已验收。

新克隆的提交护栏安装、Commit Message 模板、验证范围与历史整理要求见[贡献指南](CONTRIBUTING.md)。提交前阅读 [Agent 约束](AGENTS.md)；安全问题按[安全说明](SECURITY.md)处理。

### 文档站

指南正文以中文维护在 `repo-docs/`，VitePress 页面通过 include 读取，采用默认主题。依赖与业务代码独立安装：

```sh
pnpm --dir docs-site install --frozen-lockfile
pnpm --dir docs-site run docs:build
```

默认输出为 `docs-site/.vitepress/dist/`；隔离构建可追加 `-- --outDir <仓库外绝对目录>`。源码链接在站点中显示精确仓库路径，不复制源码或本机资源。

本地预览使用 `pnpm --dir docs-site run docs:dev -- --host 127.0.0.1`；`pnpm --dir docs-site run test:smoke` 会启动临时本地服务，检查初始搜索、正文热更新和文件访问边界。VitePress 1.6.4 的开发搜索索引需重启服务刷新，静态构建会重新建立索引。依赖版本与安全补丁以[文档站清单](docs-site/package.json)和锁文件为准。

## 上游更新

GitHub fork 的同步工作流每日检查上游：只读任务先合并候选代码并运行回归，独立写入任务再重建相同文件树，创建 `codex/upstream-*` 分支及草稿 PR。人工审核后合入；工作流不自动合并或部署，持有写令牌的任务不执行候选代码。需允许 GitHub Actions 创建 PR；冲突或上游工作流变动转人工处理，Actions 固定到完整提交 SHA。

## 致谢与许可

感谢上游 [WorkersAI2API](https://github.com/cmliussss2024/WorkersAI2API) 和 [Cloudflare](https://www.cloudflare.com/) 的平台与开源生态。

本项目按 [GNU GPLv3](LICENSE)（`GPL-3.0-only`）开源。原 WorkersAI2API 的 MIT 版权与许可全文保留在 [上游许可](LICENSES/WorkersAI2API-MIT.txt)，来源及分发说明见 [NOTICE](NOTICE)；第三方依赖保留各自许可证。再分发时保留适用的版权与许可声明。
