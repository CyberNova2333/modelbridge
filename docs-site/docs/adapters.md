# 2. 上游容错、适配器与扩展指南

本页说明 ModelBridge 如何在多账号候选间执行有界切换、如何在跨平台适配器间复用统一核心，以及扩展新平台或上游供应商时的架构边界。模块级代码细节请参阅 [模块：上游、OAuth 与配额](/modules/upstream-and-quota) 与 [模块：边缘平台与自建状态](/modules/platform-adapters)。

## 上游故障切换与取消契约

### 有界切换规则（`shouldRetryUpstream`）

ModelBridge 对同一模型的多个活跃候选账号采用**确定性有界切换**而非无条件重试：

| 上游反馈情形 | 是否切换下一账号 | 上限与原理 |
| :--- | :--- | :--- |
| 明确的 `401`、`403`、`404`、`429` HTTP 拒绝 | **切换** | 对匹配账号列表执行洗牌后仅取前 **3 个**候选（`shuffledUpstreams(candidates).slice(0, 3)`）；这些状态码意味着目标端明确拒绝执行，尚未产生有效生成计费。 |
| `5xx`、网络异常、首包/空闲超时（`120s`）、响应体超 `32 MiB` 或无效 `200` 载荷 | **不切换，直接报错** | 请求可能已抵达上游并开始生成或计费；重放会在后台造成重复扣费，且在阿里云 ESA 等严格预算环境容易耗尽仅 `4` 次的子请求配额。 |
| 客户端主动断开（`request.signal.aborted`） | **立即中止，返回 `499`** | 监听取消信号并向上游连接传播 abort，释放流读取锁与内存。 |

> 若网关前方部署了 Caddy 或 Nginx，务必关闭反代层的自动重发（见 `deploy/self-hosted-state/Caddyfile` 中的 `lb_retries 0`），避免网关“不重试”策略被反代静默绕过。

## 五类上游供应商与 Antigravity OAuth

`ACCOUNT_PROVIDERS` 当前显式支持五类账号类型：

1. **`cloudflare`**：Workers AI REST 接口，必填 `accountId` 与 `apiToken`；控制台可查询近 24 小时参考用量（10,000 Neurons 参考指标，5 分钟缓存，非硬性扣费锁）。
2. **`openai`**：OpenAI 官方或任何 OpenAI 兼容端点（如自建 Ollama、vLLM、OneAPI 等）。在管理后台填写公开 `https://` 或本地开发回环 `http://` 的自定义 `baseUrl` 与声明的模型列表即可接入。
3. **`anthropic`**：Anthropic Messages 上游，默认 `https://api.anthropic.com/v1`，原生保留 `thinking`、`output_config` 与 `strict` 工具语义。
4. **`gemini`**：Google Generative Language API 上游，默认 `https://generativelanguage.googleapis.com/v1beta`。
5. **`antigravity`**：OAuth Refresh Token 或 API Key 账号模型；支持后台账号级 `projectId`、`oauthClientId` / `oauthClientSecret`，或在无状态环境变量模式下通过 `ANTIGRAVITY_ACCOUNTS`（及兼容环境变量 `ANTIGRAVITY_REFRESH_TOKEN`、`ANTIGRAVITY_API_KEY`、`ANTIGRAVITY_PROJECT_ID` 等）加载，并按 token 生命周期自动缓存/刷新访问令牌。

## 平台适配器架构（`createGateway` + `src/platforms/`）

核心逻辑 `_worker.js` 通过导出工厂函数 `createGateway(runtime)` 实现与具体边缘运行时解耦：

```text
边缘平台入口 (src/platforms/{cloudflare,edgeone,esa}.mjs)
  ├── 传入 platform 名称 ('cloudflare' | 'edgeone' | 'esa')
  └── 调用 runPlatformRequest(platform, request, env, handler)
        ├── 读取 PLATFORM_LIMITS[platform]（请求体字节、最大出站 fetch 数、超时预算）
        ├── 注入统一客户端 IP 解析 (platformClientIp) 与状态后端绑定（DO 或 remote HTTP）
        └── 委托 _worker.js 的 createGateway(runtime).fetch(request, env, ctx)
```

各平台构建产物由 `tools/build-platforms.mjs` 统一生成到 `dist/<platform>/`，通过替换/注入平台配置和捆绑 `src/` 共享模块保持所有平台行为一致。

## 扩展指南：新增平台或上游供应商

### 场景 A：适配新的无服务器 / 边缘 JS 运行时

1. 在 `src/platforms/shared.mjs` 的 `PLATFORM_LIMITS` 中登记新平台的硬约束（如请求体字节上限、子请求次数上限、首包/总时长预算）。
2. 新建 `src/platforms/<platform>.mjs`，通过 `runPlatformRequest` 与 `createGateway(createRequestRuntime(...))` 导出目标平台所需的 `fetch` / handler 签名。
3. 更新 `tools/build-platforms.mjs` 生成对应 `dist/<platform>/` 产物，并在 `deploy/<platform>/` 补充不含凭据的模板与 `README.md`。
4. 在 `tests/` 下补充模拟平台预算触顶（如超请求体、超子请求数）回归测试，并在 `tools/verify-edge-builds.mjs` 中纳入离线构建检验。

### 场景 B：接入新的上游推理协议或账号类型

1. 在 `_worker.js` 的 `ACCOUNT_PROVIDERS` 与 `normalizeProviderAccountInput` 中登记新供应商枚举与参数校验（包括 URL SSRF 规则 `validateProviderBaseUrl`）。
2. 为该供应商实现请求映射、流式 SSE 增量转换、错误体脱敏与 `validateReplayMetadata` 兼容校验；对于无法映射到目标协议的客户端参数，**必须遵循生成前返回 `400`/`501` 拒绝**的原则，禁止静默吞掉参数。
3. 同步更新管理后台表单（`_worker.js` 内嵌控制台模板）与 `tests/` 中的跨协议一致性与安全边界测试。

## 扩展与选型常见问答（FAQ）

### Q：为什么不直接把 Ollama 做成第 6 个独立 `provider`？

Ollama（`/v1` 兼容模式）、vLLM、SGLang 等自托管推理服务均实现了标准 OpenAI Chat/Embeddings 协议。ModelBridge 将协议形态与供应商解耦：`openai` 类型账号本身即支持自定义 `baseUrl` 与模型白名单，只要网关所在网络可访问该公网 HTTPS（或本地开发回环地址），即可直接调度，无需重复维护一套相同协议转换代码。

### Q：我的代理后端有时卡住 3 分钟才返回首包，能调高超时吗？

`_worker.js` 的 `fetchUpstream` 固定了 `120s` 的响应头与流空闲超时、以及 `32 MiB` 单次响应上限；同时阿里云 ESA 平台硬约束了 `9000ms` 首包与 `115000ms` 总时长。如果上游需要数分钟级同步等待，请优先启用流式输出（`stream: true`）以持续刷新空闲计时器，或部署在无短首包超时限制的节点上。

## 下一步

- 查看整个系统的交互拓扑、代码目录分工与完整请求走读：阅读 [3. 架构全景与源码导览](/docs/architecture)。
- 需要做 Cloudflare DO 到 SQLite 的迁移或了解核心架构取舍：阅读 [关键架构决策与迁移](/docs/migrations)。
