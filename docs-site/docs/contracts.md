# 2. 接口、安全与路由契约

本页说明客户端与管理员接入 ModelBridge 时的请求入口、四态凭据边界、载荷限额、模型解析顺序及跨协议语义保证。源码级实现细节可对照 [模块：路由与协议转换](/modules/routing-and-protocols) 与 [模块：访问与配置存储](/modules/access-and-config)。

## 四态凭据与访问边界

ModelBridge 将所有秘密信息拆分为四个互不通用、不可越权替换的凭据域：

| 凭据域 | 用途与入口 | 有效期 / 锁定 / 隔离机制 |
| :--- | :--- | :--- |
| **管理员口令 (`ADMIN_PASSWORD`)** | 登录 `/admin` 并调用 `/api/*` 管理接口 | 经登录验证后签发 **24 小时** 会话 Cookie（`ADMIN_SESSION_TTL`）；同一客户端在 **15 分钟**（`ADMIN_LOGIN_WINDOW`）内连续失败 **10 次**（`ADMIN_LOGIN_ATTEMPTS`）触发锁定。仅在 `POST /api/auth/setup` / `login` 使用，不用于调用模型推理接口。 |
| **实例调用密钥 (`apiKeys`)** | 调用 `/v1/*`、`/v1beta/models/*` 与 `/v1/models/*` 推理/嵌入入口 | 支持全局启用与单个密钥独立 `enabled` 开关（撤销立即失效）；不具备读写管理后台或修改上游账号的权限。 |
| **上游供应商凭据** | 网关向 Cloudflare、OpenAI、Anthropic、Gemini、Antigravity 发起出站调用 | 明文仅存于状态存储（或 Antigravity 环境变量回退）；管理端回显脱敏、错误日志中通过凭据脱敏逻辑过滤，禁止回传给调用方。 |
| **服务间令牌 (`MODELBRIDGE_STATE_TOKEN`)** | 边缘网关与 `state-service` / `self-hosted-state` 之间的 `/_modelbridge/state` RPC | 32–512 位无空白可见 ASCII，配合 `MODELBRIDGE_STATE_ORIGINS` 精确 HTTPS 来源校验；不可当作客户端 `apiKeys` 或管理员口令使用。 |

### 客户端请求鉴权头

- **OpenAI 入口**（`/v1/chat/completions`、`/v1/completions`、`/v1/embeddings`、`/v1/models`）：通过 `Authorization: Bearer <client-api-key>` 鉴权。
- **Anthropic 入口**（`/v1/messages`）：通过 `x-api-key` 或 `Authorization: Bearer <client-api-key>` 鉴权。
- **Gemini 入口**（`/v1beta/models/*`、`/v1/models/*`）：通过 `x-goog-api-key` 或 `Authorization: Bearer <client-api-key>` 鉴权；原生 `wrangler.toml` 已启用 `observability.redact_query_string = true`，推荐始终通过 Header 传递密钥。

## 客户端与管理端路由总览

### 客户端推理与模型目录端点

| 入口路径 | HTTP 方法 | 协议形态 | 备注与边界 |
| :--- | :--- | :--- | :--- |
| `/v1/models` | `GET` | OpenAI | 返回聚合去重后的可用模型列表 |
| `/v1/chat/completions` | `POST` | OpenAI Chat | 支持流式 SSE、工具调用与部分回放元数据 |
| `/v1/completions` | `POST` | OpenAI Legacy | 转换为单轮 `user` 消息调用底层路由 |
| `/v1/embeddings` | `POST` | OpenAI Embeddings | 路由至支持嵌入的账号与模型 |
| `/v1/messages` | `POST` | Anthropic Messages | 保留或校验 `thinking`、工具 `strict` 等约束 |
| `/v1beta/models/<id>:generateContent` 等 | `POST` | Gemini | 支持 `:generateContent`、`:streamGenerateContent`、`:embedContent`、`:batchEmbedContents`（同步支持 `/v1/models/<id>:*`）；**`:countTokens` 固定返回 `501`** |

### 门户、管理界面与管理 API

- 公共门户与界面：`GET /`、`GET /admin`、`GET /robots.txt`（附带严格安全响应头，禁用危险内联权限）。
- 会话与用量：`GET /api/auth/status`、`POST /api/auth/setup`、`POST /api/auth/login`、`POST /api/auth/logout`、`GET|POST /api/usage/summary`。
- 资源管理：`GET|POST|PUT|DELETE /api/accounts`、`POST /api/accounts/test`、`GET /api/accounts/usage`、`GET|POST|PUT|DELETE /api/keys`、`GET|PUT /api/settings`。

## 请求体限额与安全校验规则

### 载荷与响应字节上限

| 边界位置 | 上限值 | 说明 |
| :--- | :--- | :--- |
| `/api/auth/login` 与 `/api/auth/setup` | `16 KiB`（`LOGIN_JSON_LIMIT`） | 防止大包体登录探测耗尽解析内存 |
| `/api/*` 管理接口 JSON | `1 MiB`（`ADMIN_JSON_LIMIT`） | 覆盖账号批量变更与模型映射更新 |
| 客户端推理入口（默认 / CF / ESA） | `16 MiB`（`API_JSON_LIMIT`） | EdgeOne Makers 平台注入更严格的 **`1 MiB`** 单请求上限 |
| 远程状态服务 RPC | 请求 `2 MiB` / 响应 `16 MiB` | `STATE_REQUEST_LIMIT` 与 `STATE_RESPONSE_LIMIT` |
| 单次上游响应（`fetchUpstream`） | `32 MiB`，首包/流空闲 `120s` | 超限立即中止流并向上游与客户端传递取消信号 |

### 自定义上游 `baseUrl` SSRF 校验（`validateProviderBaseUrl`）

当管理端新增或修改 `openai`、`anthropic`、`gemini` 类型的账号并填写自定义 `baseUrl` 时（默认地址分别为 `https://api.openai.com/v1`、`https://api.anthropic.com/v1`、`https://generativelanguage.googleapis.com/v1beta`），网关会强制执行以下校验：
- 仅允许公网 `https://` 地址；仅对本机回环主机（`localhost`、`127.0.0.1`、`[::1]`）允许 `http://` 以便本地开发对接 Ollama / vLLM。
- 明确拒绝 `0.0.0.0`、私有/链路本地 IPv4 网段（`10.*`、`127.*`、`169.254.*`、`192.168.*`、`172.16.0.0/12`）、`.localhost`/`.local`/`.internal` 后缀域名及 IPv6 ULA/链路本地地址（`fc*`/`fd*`/`fe80+`）。
- 禁止在 URL 中携带 `username:password`、查询字符串 `?` 或片段 `#`。
- 账号切换 `provider` 类型时，必须重新提交新的有效 `apiToken`，不允许沿用脱敏掩码（`********` 或含 `...`）。

## 模型解析顺序与语义保留契约

### 1. 模型名解析与“映射表非白名单”原则

`resolveModelName(model, env)` 按以下顺序确定实际路由目标：
1. **`upstream:<账号ID>:<目标模型>` 显式指定**：直接锁定到特定账号 ID 与模型名（用于同厂商多账号分流、灰度验证或排查特定账号）。
2. **`@cf/...` 或供应商前缀**：已携带 `@cf/` 的 Cloudflare 模型直接透传，或按已注册/配置的前缀规则识别目标供应商。
3. **动态与默认别名映射（`modelMap` + `cloudflare-model-map.json`）**：优先匹配管理台配置中的自定义 `modelMap`，未命中时查找内置的 65 条 `DEFAULT_MODEL_MAP`（与根目录 `cloudflare-model-map.json` 一致）。

> **重要安全提示：`modelMap` 不是访问控制白名单**。客户端只要持有有效 `apiKey`，即可直接传入 `@cf/...`、供应商模型名或 `upstream:<账号ID>:<模型>` 请求；如需限制某上游账号可服务的模型范围，请在账号配置中明确维护其 `models` 列表。

### 2. 跨协议语义保真与生成前拒绝（Pre-flight Fail Fast）

- **Anthropic -> 非 Anthropic 上游**（`convertAnthropicToOpenAI` 等）：在发往上游前调用 `rejectAnthropicProviderTools` 与 `validateToolStrictness`，对于 `thinking`、`output_config`、`output_format` 等无法无损表达到 OpenAI 协议的约束，直接返回 **`400`** 错误提示改用 Anthropic 上游，不静默丢弃约束。
- **思考与工具调用回放元数据（`validateReplayMetadata`）**：OpenAI 扩展消息可携带 `gemini_parts` 或 `anthropic_content`（仅限 `assistant` 角色）以在多轮对话中保留 `thoughtSignature` 等上游签名；网关会逐字段校验允许键集合，并严格比对元数据中的可见文本、思考文本（`reasoning_content`）和工具调用（`tool_calls`）是否与外层可见消息完全一致，不一致直接拒绝。
- **错误响应包络对齐**：`/api/*` 返回 `{ error }`，`/v1beta|v1/models/*` 返回 Gemini 错误 JSON，`/v1/messages` 返回 `{ type: 'error', error }`，其余 `/v1/*` 返回 OpenAI 标准 `{ error: { message, type, ... } }`。

## 下一步

- 需要排查账号切换行为、Antigravity OAuth 或扩展新平台/上游供应商？继续阅读 [2. 上游容错、适配器与扩展指南](/docs/adapters)。
