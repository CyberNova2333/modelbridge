# 模桥 ModelBridge

**简体中文** | [English](README.en.md)

![模桥 ModelBridge](assets/modelbridge-logo.svg)

模桥 ModelBridge 是一个多模型、多协议 API 网关，汇集 Cloudflare Workers AI、OpenAI、Anthropic 和 Gemini 上游，为客户端提供统一接入和可视化管理面板。推荐部署在 Cloudflare Workers；Pages 部署需要额外绑定由 Worker 托管的 Durable Object。

基于 [WorkersAI2API](https://github.com/cmliussss2024/WorkersAI2API) 开发，当前实例入口为 [aigateway.cbnv.top](https://aigateway.cbnv.top)。

品牌素材：[横版 Logo](assets/modelbridge-logo.svg) · [独立图标](assets/modelbridge-icon.svg)。以下界面截图使用本地演示数据。

#### 主页预览
![公开首页](img/1.png)

#### 管理页面
![管理页面](img/2.png)

## 🚀 它能干什么

- OpenAI 兼容：把 CF 免费 AI 模型转成 `/v1/chat/completions` 格式，Cursor、LobeChat、NextChat 等客户端直接接入
- Antigravity 实验兼容：支持邮箱与 Refresh Token 登录、自动查询项目，以及思考内容和多轮工具调用转换；具体模型权限取决于账号
- 多模态支持：除对话外还支持 `/v1/embeddings` 和 Anthropic `/v1/messages`
- 负载均衡：支持绑定多个 CF 与 Antigravity 账号，请求自动轮询与限流故障转移
- 管理面板：可视化查看用量、管理账号/密钥、自定义模型映射
- 默认鉴权：所有模型调用都需要实例 API Key；未配置或删除最后一个密钥后，调用入口保持关闭

## ⚡ 快速部署

### 🔧 Workers 部署（推荐）

需要两个存储绑定：`KV` 保存旧配置快照，`CONFIG_STORE`（`AppConfigStore` 类）保存账号、API 密钥、模型映射、管理员会话及用量缓存。`ADMIN_PASSWORD` 必设，否则服务拒绝访问。

```bash
npm install -g wrangler
wrangler login
wrangler kv namespace create KV
```

本仓库的 `wrangler.toml` 目前记录了本次线上部署的配置，Worker 服务名称为 `aigateway`，主入口为 `aigateway.cbnv.top`。网页项目显示名由 `_worker.js` 中的静态 `PROJECT_DISPLAY_NAME` 常量独立设置，不会自动读取 Worker 服务名。其他用户部署前，请将 `account_id` 和 `kv_namespaces` 中的 `id` 改为自己的账号与 KV 命名空间，并修改或移除本实例的自定义域名配置。

把创建命令返回的命名空间 ID 填入 `wrangler.toml`；升级已有部署时，填写原有 KV 的 ID：

```toml
[[kv_namespaces]]
binding = "KV"
id = "你的KV命名空间ID"
```

保留 `wrangler.toml` 中的 `CONFIG_STORE` / `AppConfigStore` 绑定和 `new_sqlite_classes` 迁移配置，然后部署并设置管理员密码：

```bash
wrangler deploy
wrangler secret put ADMIN_PASSWORD
```

保留 `compatibility_flags` 中的 `global_fetch_strictly_public` 和 `enable_request_signal`。前者限制外部请求访问私有网络，后者使客户端断开能够触发网关的上游取消逻辑。

Wrangler 会在部署时应用 SQLite Durable Object 迁移。首次访问配置时，`AppConfigStore` 自动导入原 KV 的 `config` 一次；后续配置读写以 Durable Object 为准，原 KV 的 `config` 保留为旧快照，不再作为当前配置读取。用量缓存与会话存放在 Durable Object 的独立键中。已有部署的 `ADMIN_PASSWORD` 无需重复设置。

旧 KV 的 `config` 是迁移时的快照，不会同步之后的修改。回滚时应继续使用 `CONFIG_STORE`；直接换回尚未支持 Durable Object 的旧源码，会重新读取过时配置。如需回到旧存储方式，应先通过受控的配置同步和迁移流程保存最新配置。

### 📦 Pages 部署

Pages 不能直接托管 Durable Object，单独拖入 `_worker.js` 还不足以完成部署：

1. 先按上面的 Workers 步骤部署导出 `AppConfigStore` 的 Worker，并为它绑定原有 `KV`。
2. 在 Pages 项目中上传 `_worker.js`，绑定同一个 `KV`，设置必需的 `ADMIN_PASSWORD`。
3. 为 Pages 添加名为 `CONFIG_STORE` 的 Durable Object 绑定，选择该 Worker 的 `AppConfigStore` 类。使用 Pages 的 Wrangler 配置时，绑定需包含托管 Worker 的 `script_name`：

```toml
[[durable_objects.bindings]]
name = "CONFIG_STORE"
class_name = "AppConfigStore"
script_name = "aigateway" # 改为实际托管 Durable Object 的 Worker 名称
```

4. 在 Pages 的兼容性设置中启用 `global_fetch_strictly_public` 和 `enable_request_signal`，然后重新部署 Pages。Durable Object 类的迁移由托管它的 Worker 管理。

Pages 和托管 Worker 都必须使用当前版本代码；升级时先更新托管 Worker，再更新 Pages。每个入口使用自己的 `ADMIN_PASSWORD` 验证登录，会话按入口 origin 隔离。轮换 Pages 的密码会使该入口旧会话失效，不会改动托管 Worker 的密码。此次会话格式升级会使原有登录状态失效，需要重新登录。

## 📋 使用步骤

1. 打开部署地址，输入管理员密码登录
2. 在「账号管理」添加 CF 账号（Account ID + API Token）。Token 在 [Cloudflare Dashboard](https://dash.cloudflare.com/) → My Profile → API Tokens → Workers AI 模板生成
3. 在「API 密钥」生成调用密钥（`sk-wa-xxx`）
4. 客户端配置 Base URL 为 `https://你的部署域名/v1`，填入密钥即可

用量刷新需要管理员登录；公开首页只读取已缓存的汇总数据，不触发查询或写入。缓存有效期为 5 分钟，同期刷新请求会合并；相同 Cloudflare Account ID 的不同凭据共享统计与额度。每批最多查询 20 个不同账号，同时最多进行 4 个查询。同组凭据遇到明确的鉴权或统计权限拒绝时，最多尝试 3 条不同凭据；网络错误、限流和服务端故障不会触发遍历重试。

模型请求只在当前请求内复用一次配置快照，减少 Durable Object 调用；不同请求不共享鉴权缓存。缺少调用凭据会直接拒绝，撤销密钥会在下一次请求生效。

管理员登录使用随机会话，24 小时后到期；退出登录或修改密码会使相应会话失效。升级后旧登录状态会失效，需要重新登录。密码摘要不能作为管理接口密钥使用。每个来源 IP 在 15 分钟内最多尝试登录 10 次；管理页不加载外部脚本或字体。

## 通用上游接口

在后台「账号管理」添加上游时，可选择 Cloudflare、OpenAI、Anthropic、Gemini 或 Antigravity。OpenAI 兼容服务也可填写第三方 Base URL；地址必须使用 HTTPS，不得包含用户名、密码、查询参数或片段。本地开发允许 `http://localhost` 或 `http://127.0.0.1`。

| 上游类型 | 默认 Base URL | 凭据 |
| --- | --- | --- |
| OpenAI | `https://api.openai.com/v1` | API Key |
| Anthropic | `https://api.anthropic.com/v1` | API Key |
| Gemini | `https://generativelanguage.googleapis.com/v1beta` | Gemini API Key |
| Cloudflare | 固定 Workers AI 地址 | Account ID 和 API Token |
| Antigravity | 内置 Cloud Code 地址 | Refresh Token 或 Access Token |

「上游模型 ID」可每行填写一个，也可用逗号分隔。声明的模型可直接作为客户端模型名；需要别名时，在模型映射中将目标写为 `openai:模型ID`、`anthropic:模型ID` 或 `gemini:模型ID`。同一供应商的多个启用账号可用于故障切换；停用账号不参与请求。若多个账号使用不同模型，应分别填写各自支持的模型 ID。

编辑账号时，凭据留空即保留原值；账号列表不会返回真实上游密钥。「测试连接」对通用上游只读取模型目录，不发送生成请求，也不代表已验证所有模型的调用权限。Antigravity 测试会刷新登录并查询项目，不发送生成请求。Cloudflare 的测试包含一次小型向量生成，会消耗少量额度。

Cloudflare 用量图表和每日 Neurons 额度只统计启用的 Cloudflare 账号。其他供应商的用量应在相应控制台查看，不能计入 Cloudflare 免费额度。

## 🔑 模型映射

预设包含当前官方目录中可使用每日免费额度的 65 个模型，完整列表见 [cloudflare-model-map.json](cloudflare-model-map.json)；已排除要求付费计费方式的模型。“恢复预设映射”只会恢复这些免费额度模型。以下为部分示例：

| 请求名 | CF 实际模型 |
|--------|------------|
| `glm-4.7-flash` | `@cf/zai-org/glm-4.7-flash` |
| `gemma-4-26b-a4b-it` | `@cf/google/gemma-4-26b-a4b-it` |
| `nemotron-3-120b-a12b` | `@cf/nvidia/nemotron-3-120b-a12b` |
| `gpt-oss-20b` | `@cf/openai/gpt-oss-20b` |
| `gpt-oss-120b` | `@cf/openai/gpt-oss-120b` |
| `bge-m3` | `@cf/baai/bge-m3` |

免费指 [Cloudflare 每账号每日赠送的 10,000 Neurons 额度](https://developers.cloudflare.com/workers-ai/platform/pricing/)，并非无限免费；付费套餐超出该额度仍会计费。模型映射和用量面板不是服务端强制预算，统计也存在延迟。

直接传 `@cf/供应商/模型` 格式的模型名会跳过映射；网关会拒绝路径穿越、查询参数和片段。

## 🌌 Antigravity (Google Cloud Code) 配置与使用

这是面向 Google Cloud Code 内部接口的实验兼容实现。已为别名解析、令牌刷新、项目发现、流式响应及带签名的工具历史添加模拟回归测试；真实账号的可用模型和权限仍需实际调用确认，内部协议变化可能影响兼容性。

### 1. 配置账号凭据

在后台「账号管理」选择 Antigravity，手动粘贴邮箱与 `refresh_token` 即可，无需导入 JSON 文件。保存启用账号时会验证登录并自动查询项目，查询成功后才保存。高级设置可以指定已有授权的项目 ID，以及签发令牌所用的 OAuth 客户端；通常留空即可。令牌刷新后自动重试一次 401，停用账号不参与请求。

也可通过环境 Secret 配置：

1. **Wrangler Secret（推荐）**：
   ```bash
   wrangler secret put ANTIGRAVITY_REFRESH_TOKEN
   ```
   输入 Google OAuth 获得的 `refresh_token` 即可。多账号可使用 `ANTIGRAVITY_ACCOUNTS`（JSON 数组格式）。
2. **高级配置**：
   `ANTIGRAVITY_PROJECT_ID` 可指定授权项目，`OAUTH_CLIENT_ID` 与 `OAUTH_CLIENT_SECRET` 可覆盖默认 Antigravity installed-app 客户端，两者需同时填写。账号高级设置优先于全局配置。仍兼容 `ya29.` 开头的 Access Token，但该方式不能自动续期。

### 2. 模型使用

支持直接使用或通过自定义模型映射映射到以下模型（亦可使用 `antigravity:` 前缀透传）：

- `claude-sonnet-4-5-thinking`：Claude Sonnet 4.5 深度思考模型
- `claude-opus-4-5-thinking`：Claude Opus 4.5 深度思考模型
- `claude-sonnet-4-5`：Claude Sonnet 4.5 标准对话模型
- `gemini-3-flash`：Gemini 3 Flash 思考模型
- `gemini-3-pro-high`：Gemini 3 Pro 高算力思考模型
- `gemini-3-pro-low`：Gemini 3 Pro 轻量思考模型

可接入 **Claude Code CLI**（`ANTHROPIC_BASE_URL=https://你的Worker域名`）与 OpenAI、Gemini 客户端。请保留至少一个实例 API Key 才能调用。多轮工具调用需保留返回的思考签名；缺少必要签名或无法表达的工具格式会明确报错。自动发现的项目与凭证身份绑定，修改邮箱、令牌或 OAuth 配置后会重新发现；手动指定的项目会保留。网关不会额外插入系统提示或伪造用户消息。

Antigravity 图片必须使用内嵌 base64；远程图片 URL、文档及工具结果中的非文本媒体会在生成前返回 400。当前适配器无法保证结构化 JSON 输出，因此带 JSON 输出格式约束的请求也会提前拒绝。显式思考预算（包括 `thinkingBudget: 0`）会传给上游；不支持或互相冲突的思考配置会报错。被上游过滤的回答保留拒绝语义，过滤或截断的工具调用不会作为完整工具输出发送。

## 客户端协议与 Gemini 端点

同一实例的上游账号可以被不同协议的客户端调用：

| 客户端 | 地址 |
| --- | --- |
| OpenAI Chat Completions | `POST /v1/chat/completions` |
| OpenAI 旧版 Completions | `POST /v1/completions` |
| Anthropic Messages | `POST /v1/messages` |
| Gemini 内容生成 | `POST /v1beta/models/{模型别名}:generateContent` |
| Gemini 流式生成 | `POST /v1beta/models/{模型别名}:streamGenerateContent?alt=sse` |
| Gemini 模型目录 | `GET /v1beta/models` |
| Gemini 单个模型 | `GET /v1beta/models/{模型别名}` |
| Gemini 向量 | `POST /v1beta/models/{模型别名}:embedContent`、`:batchEmbedContents` |

OpenAI 使用 `Authorization: Bearer <实例密钥>`，Anthropic 使用 `x-api-key`，Gemini 使用 `x-goog-api-key` 或 `?key=`。这些都是网关生成的调用密钥，上游密钥单独保存在账号配置中。Gemini 的 `/v1/models/{模型}:generateContent` 等版本路径也可使用；`GET /v1/models` 保持 OpenAI 列表格式。

推荐通过请求头传递密钥。仓库的 Wrangler 配置启用了 `observability.redact_query_string`，从平台日志和追踪的请求 URL 中移除整个查询字符串；不要依赖平台默认的密钥格式识别。复制部署配置或自行配置日志时，应同时保留这一项。上游 SSE 的注释、事件名和 ID 等元信息也会过滤账号凭证，正常模型文本与签名保持原值。

示例（将模型替换为实例已配置的别名）：

```bash
curl 'https://aigateway.cbnv.top/v1beta/models/gpt-oss-20b:generateContent' \
  -H 'x-goog-api-key: <实例密钥>' \
  -H 'Content-Type: application/json' \
  -d '{"contents":[{"role":"user","parts":[{"text":"你好"}]}]}'
```

支持常见文本、图片输入、函数工具调用、结构化输出及增量流转换。供应商专有内置工具、媒体生成和精确 `countTokens` 不作跨供应商模拟；无法转换的请求会明确报错。Gemini 不带 `alt=sse` 的流式请求返回 JSON 数组流。

跨协议转换会检查请求约束：Gemini 的非空 `safetySettings` 只能发送到 Gemini 上游；OpenAI 的 `json_object` 模式转 Anthropic 时会返回 400，可改用该路由支持的 `json_schema`。无法映射到目标协议的显式思考或输出格式配置会提前拒绝。Anthropic 文档和工具结果图片在原生 Anthropic 路由保留，无法表达它们的跨协议路由会提前拒绝。客户端回传的协议元数据必须与可见消息、思考内容和工具调用一致；OpenAI 上游不能通过附加另一协议的完整内容字段替换后续历史。

Gemini 上游返回的图片可通过普通响应或流式响应保留图片数据与签名。Anthropic 转为其他客户端协议时，带签名思考和工具参数会按完整内容块输出，以便下一轮原样回放；普通文本继续增量返回。

原生 Anthropic 流也会校验事件结构；无法识别的诊断数据或格式异常事件将返回通用错误并终止，不直接回传上游原文。

非法工具参数、上游错误与缺少正常结束标记的流会明确报错。JSON 与 SSE 错误统一识别和脱敏，错误后结束转发。启用 `enable_request_signal` 后，客户端取消会触发网关中止上游连接；实际停止计算及计费取决于上游服务。等待响应头或响应体连续无数据超过 120 秒时中止，单次响应最多 32 MiB。只有明确的鉴权、模型不存在或限流拒绝会尝试其他账号，最多 3 个；网络结果不确定、无效成功响应或服务器错误不会重新生成，避免重复消耗配额。

## 部署配置归属

以自己的 Wrangler 配置与部署账号为准，不复用文档中的个人账号或固定域名。配置保存在对应账号的 KV 和 SQLite Durable Object；已有实例迁移时须保留 Durable Object 中的当前配置，并单独保留管理员 Secret，不能用早期 KV 快照替代当前状态。

## 🧪 本地验证

使用 Node.js 24 或更新版本运行回归测试，无需安装项目依赖，也不会请求真实云服务：

```bash
node --test tests/*.test.mjs
```

测试覆盖配置更新与密钥撤销、账号凭据隔离、模型映射、三种客户端与三种通用上游的 JSON/SSE 交叉调用、并行工具调用、流取消和 UTF-8 分片、Gemini 模型目录与向量接口，以及 Antigravity 登录刷新和协议转换。测试使用模拟上游，不代表已验证某个真实账号的模型权限。

## 上游更新

启用 fork 的上游同步工作流后，每天检查更新。候选代码先在只读权限任务中运行回归测试，再由独立任务创建 `codex/upstream-*` 分支和草稿 PR。经人工审核后合入 `main`；工作流不自动合并或部署，持有仓库写令牌的任务不会执行候选代码。GitHub Actions 设置需要允许创建 PR；合并冲突或上游工作流变更会停止自动提议，需人工处理。使用的 Actions 固定到完整提交 SHA。

## 🤝 致谢

特别感谢 **[Cloudflare](https://www.cloudflare.com/)** 提供强大且免费的 Workers AI 服务和 Pages 托管平台！

## 许可

本仓库采用 [MIT License](LICENSE)，再分发时保留原版权与许可声明。

## 源码阅读与文档站

从[中文阅读路径](repo-docs/README.md)进入[一次真实主流程](repo-docs/walkthroughs/one-real-run.md)，再查[代码地图](repo-docs/code-map.md)与[源码证据](repo-docs/references/source-evidence.md)。指南明确限定覆盖范围，不把未运行的测试写成通过。

文档站采用 VitePress 默认主题，依赖与业务项目分开安装。默认输出 `docs-site/.vitepress/dist/`；独立核验可在构建命令后加 `-- --outDir <仓库外绝对目录>`。指南正文只维护 `repo-docs/`，站点通过 include 读取；网页中的仓库源码链接显示为精确文件路径，不复制源码或本机资源。

```sh
npm --prefix docs-site ci
npm --prefix docs-site run docs:dev -- --host 127.0.0.1
npm --prefix docs-site run docs:build
```

文档站采用 VitePress 默认主题；默认输出 `docs-site/.vitepress/dist/`，独立验证使用 `-- --outDir <仓库外绝对目录>`。指南正文由 repo-docs include 引入，源码链接在网页中显示为精确路径。
