# 起步与多平台部署

**模桥（ModelBridge）** 用同一套核心网关逻辑（`_worker.js`）对外暴露 **OpenAI、Anthropic 与 Gemini** 客户端接口，内置 Primer 风格门户页 `/` 与管理控制台 `/admin`，并通过 `src/platforms/` 适配 **Cloudflare Workers、EdgeOne Makers、阿里云 ESA**，配合 `src/self-hosted/` 提供的 **Node.js 24 + SQLite** 自建状态服务运行。

## 能力定位与明确边界

| 能力维度 | 当前实现 | 明确不提供的能力 / 注意事项 |
| :--- | :--- | :--- |
| **OpenAI 入口** | `GET /v1/models`、`POST /v1/chat/completions`、`POST /v1/completions`、`POST /v1/embeddings` | 不实现 `/v1/responses`，不实现图像生成/编辑或音频 TTS/STT 接口 |
| **Anthropic 入口** | `POST /v1/messages`（支持工具调用与流式增量转换） | 不接收无对应目标映射的私有 Beta 语义并伪装成功 |
| **Gemini 入口** | `/v1beta/models/<id>:*` 与 `/v1/models/<id>:*`（`:generateContent`、`:streamGenerateContent`、`:embedContent`、`:batchEmbedContents`） | `:countTokens` 返回 `501`，不提供跨供应商精确 token 计数 |
| **配置与权威** | 自建 SQLite（WAL + `BEGIN IMMEDIATE`）或 Cloudflare `AppConfigStore` DO | 单一配置权威，不在 DO 与远程状态之间做双写或运行时静默降级 |
| **免费模型预设与额度展示** | `cloudflare-model-map.json`（65 条 `@cf/...` 别名）与 5 分钟缓存参考计数器 | 别名表与控制台 10,000 Neurons 参考展示不做服务端强制消费拦截 |

## 本地构建与推荐起步流程

仓库核心运行时和自建状态服务在 **Node.js 24+** 下直接执行，根目录无需安装第三方 npm 运行依赖：

```sh
# 1. 静态检查与全量模拟回归
pnpm run check
node --test tests/*.test.mjs

# 2. 生成六套独立部署产物（dist/）
node tools/build-platforms.mjs
```

### 推荐生产组合：自建状态服务 + 边缘无状态网关

当你的网关部署在 EdgeOne Makers、阿里云 ESA，或希望 Cloudflare Workers 与多个边缘入口共用同一份配置时，推荐使用 `dist/self-hosted-state/` 搭配无状态网关：

1. **启动 Node.js 24 + SQLite 状态服务**（本地开发示例）：

```sh
MODELBRIDGE_STATE_TOKEN="$(openssl rand -hex 32)" \
DB_PATH=./data/modelbridge.sqlite \
MODELBRIDGE_STATE_PUBLIC_ORIGIN=https://state.example \
MODELBRIDGE_STATE_ORIGINS=https://gateway.example \
pnpm run start:state
```

2. **配置反代 HTTPS**：生产环境通过 TLS 反向代理（如 `deploy/self-hosted-state/Caddyfile`）对外暴露固定路径 `/_modelbridge/state`，保持进程监听回环地址 `127.0.0.1:8788`。
3. **部署边缘网关**：将 `dist/cloudflare-remote/`、`dist/edgeone/` 或 `dist/esa/` 部署至对应平台，并在平台 Secret 中填入 `ADMIN_PASSWORD`、`MODELBRIDGE_STATE_URL`（如 `https://state.example/_modelbridge/state`）与同一 `MODELBRIDGE_STATE_TOKEN`。
4. **初始化控制台**：打开 `https://<你的网关域名>/admin`，使用 `ADMIN_PASSWORD` 登录，添加至少一个上游供应商账号（`cloudflare`、`openai`、`anthropic`、`gemini` 或 `antigravity`）与客户端调用密钥（`apiKeys`）。

## 多平台部署矩阵

运行 `node tools/build-platforms.mjs` 会在 `dist/` 下生成 6 个自包含项目目录，对应的平台适配入口与运行预算如下：

| 构建产物（`dist/`） | 目标运行环境 | 配置权威与状态后端 | 平台注入限制（`src/platforms/`） | 部署模板与关键清单 |
| :--- | :--- | :--- | :--- | :--- |
| `self-hosted-state` | Linux 容器 / Node.js 24 | 本地 SQLite（WAL、`synchronous=FULL`、`APPLICATION_ID=0x4d425331`） | 请求体 `2 MiB` / 响应 `16 MiB`；`usageTimeoutMs = 15000` | [deploy/self-hosted-state/README.md](https://github.com/CyberNova2333/modelbridge/blob/main/deploy/self-hosted-state/README.md)（`compose.yaml` + `Caddyfile`） |
| `cloudflare-remote` | Cloudflare Workers（无状态） | 远程 HTTPS 状态服务（`/_modelbridge/state`） | 请求体 `16 MiB` | `deploy/cloudflare-remote/`（无需 KV 或 DO 绑定） |
| `edgeone` | 腾讯云 EdgeOne Makers | 远程 HTTPS 状态服务（`/_modelbridge/state`） | **请求体上限 `1 MiB`** | `deploy/edgeone/edgeone.json`（`outputDirectory: "./public"`） |
| `esa` | 阿里云 ESA Edge Routine | 远程 HTTPS 状态服务（`/_modelbridge/state`） | 请求体 `16 MiB`，**单次请求最多 `4` 次外部 fetch**、首包 `9000ms`、总时长 `115000ms` | `deploy/esa/esa.jsonc`（`entry: "./worker.js"`） |
| `state-service` | Cloudflare Workers 状态端 | Cloudflare `AppConfigStore` DO | 同 remote 状态 RPC 限额（`2 MiB` / `16 MiB`） | `deploy/state-service/wrangler.toml`（需绑定 `CONFIG_STORE`） |
| `cloudflare` | Cloudflare Workers 原生 | 本 Worker 内置 `AppConfigStore` DO（首次可从 `KV` 迁入） | 请求体 `16 MiB` | `wrangler.toml` / `deploy/cloudflare/` |

> **Caddy 反代关键参数**：若使用 `deploy/self-hosted-state/Caddyfile` 前置 TLS，务必保留 `protocols h1` 与 `lb_retries 0`——禁用后端重试可避免状态写入或请求在超时边界被反代静默重放。

## 原生 Cloudflare DO 与 Pages 兼容

仓库根目录提供自包含入口 `_worker.js` 与原生配置 `wrangler.toml`，适用于既有 Cloudflare Workers 实例或直接从单一入口部署：

- **默认 Wrangler 配置**：`name = "aigateway"`、`main = "_worker.js"`、`compatibility_date = "2026-06-30"`、`compatibility_flags = ["global_fetch_strictly_public", "enable_request_signal"]`，并启用 `observability.redact_query_string = true`。
- **Durable Object 与 KV**：`CONFIG_STORE` 绑定到 SQLite-backed Durable Object 类 `AppConfigStore`（`new_sqlite_classes`，唯一实例名称 `app-config-v1`）。`KV` 仅在 DO 首次初始化且尚无配置时触发一次性迁移；如无需迁移旧 KV 数据，也需保留配置完整性校验规则。
- **Cloudflare Pages 兼容**：若以 Cloudflare Pages Functions/Advanced Mode 引用外部 Worker 定义的 `AppConfigStore` DO，必须在 Pages 的 `wrangler.toml` 中为 `durable_objects.bindings` 显式补充 `script_name`。
- **65 条预设别名**：`cloudflare-model-map.json` 与 `_worker.js` 内的 `DEFAULT_MODEL_MAP` 保持一致（可通过管理后台 `/api/settings` 覆盖或追加映射），包含 65 条常见 `@cf/...` 免费额度模型别名。

## 环境变量与 Secret 矩阵

### 1. 网关侧运行时变量（Cloudflare / Makers / ESA）

| 变量名 | 适用模式 | 必填 | 格式与安全约束 |
| :--- | :--- | :--- | :--- |
| `ADMIN_PASSWORD` | 全部网关模式 | 是 | 管理员控制台 `/admin` 登录口令；未配置时登录/管理接口返回 `503` |
| `MODELBRIDGE_STATE_URL` | 远程网关（`cloudflare-remote`、`edgeone`、`esa`） | 远程必填 | 固定公网 HTTPS 完整路径，例如 `https://state.example/_modelbridge/state`；严禁含 query、fragment 或内嵌凭据 |
| `MODELBRIDGE_STATE_TOKEN` | 远程网关与状态端 | 远程必填 | 32 至 512 位无空白可见 ASCII 字符，与状态服务共享 |
| `KV` / `CONFIG_STORE` | 原生 Cloudflare DO | DO 模式必填 | Wrangler Binding；DO 模式要求同时存在 `CONFIG_STORE`（及兼容校验所需的 `KV` 绑定） |

### 2. 自建状态服务与 CF 状态端变量（`self-hosted-state` / `state-service`）

| 变量名 | 说明与默认值 | 约束说明 |
| :--- | :--- | :--- |
| `DB_PATH` | SQLite 数据库文件绝对或相对路径（仅自建模式） | 启动时校验硬链接计数 `nlink === 1`（防止软/硬链接别名绕过）与 `APPLICATION_ID = 0x4d425331` |
| `MODELBRIDGE_STATE_PUBLIC_ORIGIN` | 状态服务自身的精确 HTTPS 来源（仅自建模式） | 例如 `https://state.example`；不能带尾部 `/`、路径、query 或通配符 |
| `MODELBRIDGE_STATE_ORIGINS` | 允许访问状态服务的网关 HTTPS 来源列表（逗号分隔） | 例如 `https://gateway.example,https://esa.example`；严格精确比对，禁止通配符或尾斜杠 |
| `MODELBRIDGE_STATE_TOKEN` | 服务间鉴权令牌明文 | 与 `_FILE` 严格二选一（同时设置或均未设置都会拒绝启动） |
| `MODELBRIDGE_STATE_TOKEN_FILE` | 包含令牌的 Secret 文件路径（仅自建模式） | Docker Compose 模板默认挂载为 `/run/secrets/state_token` |
| `HOST` / `PORT` | 自建 HTTP 服务监听地址与端口 | 默认 `127.0.0.1` 与 `8788` |
| `STATE_DOMAIN` | `deploy/self-hosted-state/compose.yaml` 专用占位变量 | 仅填纯域名，Compose 用它生成 `MODELBRIDGE_STATE_PUBLIC_ORIGIN` |

### 3. Antigravity 与 CLI 工具链补充变量

- **Antigravity 无状态配置回退**（优先读取控制台存储的账号字段，未设置时回退到环境变量）：`ANTIGRAVITY_REFRESH_TOKEN`、`ANTIGRAVITY_API_KEY`、`ANTIGRAVITY_ACCOUNTS`（或兼容字段 `ACCOUNTS_JSON`）、`ANTIGRAVITY_EMAIL`、`ANTIGRAVITY_PROJECT_ID`、`OAUTH_CLIENT_ID`、`OAUTH_CLIENT_SECRET`。
- **导出脚本专用变量**（`tools/state-admin.mjs export-remote`）：使用 `MODELBRIDGE_STATE_URL`、`MODELBRIDGE_STATE_TOKEN` 与 `MODELBRIDGE_STATE_EXPORT_ORIGIN`（与状态服务 `MODELBRIDGE_STATE_ORIGINS` 中的允许来源匹配）。

## 上线前整体验证清单

- [ ] `pnpm run check`：通过全部源码语法与静态边界检查。
- [ ] `node --test tests/*.test.mjs`：通过网关协议、安全、状态存储、限流与边界回归测试。
- [ ] `pnpm run verify:edge-builds`：验证六套 `dist/` 构建产物可被各平台工具链解析与冒烟加载（需对应环境允许安装临时工具锁文件时执行）。
- [ ] `pnpm run verify:container` / `pnpm run verify:tls`：在容器化与真实 HTTPS 反向代理环境下验收自建 SQLite 状态服务的隔离权限、重启恢复与证书校验（需要 Docker/Podman 运行时）。
- [ ] **禁止硬编码凭据**：不要将任何真实密钥提交到 `wrangler.toml`、`edgeone.json`、`esa.jsonc` 或 `.env`；仅在运行平台 Secret 管理或受限权限挂载文件中注入。

## 下一步阅读

- 遇到部署启动失败或平台报错？查看 [部署运维与排错 FAQ](/docs/deployment-faq)。
- 准备接入 OpenAI / Anthropic / Gemini 客户端？阅读 [接口、安全与路由契约](/docs/contracts)。
