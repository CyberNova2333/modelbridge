# 关键架构决策与迁移指南

本页沉淀 ModelBridge 在存储权威、容错语义、平台预算与反代验收方面的核心架构决策（ADR），并提供从 Cloudflare 原生 Durable Object / KV 迁往自建 Node.js 24 + SQLite 的标准化操作流程。最近一次全仓代码同步与回归验证记录见 [文档校准与验证记录](/change-log)。

## 关键架构决策（ADR）

### ADR-001：单一配置权威，禁止多主双写与静默降级

- **决策**：每个部署实例在运行时只能绑定一个配置权威——要么是原生 Cloudflare `AppConfigStore`（DO SQLite），要么是通过 `MODELBRIDGE_STATE_URL` 访问的远端状态服务（`self-hosted-state` 或 `state-service`）。当 `ADMIN_PASSWORD`、`CONFIG_STORE` / `KV`（原生模式）或 `MODELBRIDGE_STATE_*`（远程模式）缺失时直接返回 `503`。
- **依据**：防止配置（特别是已撤销的 `apiKeys`、已禁用账号或刷新中的 OAuth token）在内存缓存、KV 与多个边缘节点之间出现脑裂或延迟失效。
- **容量与边界**：远程 HTTP 状态 RPC 约束请求体上限为 `2 MiB`（`STATE_REQUEST_LIMIT`）、响应体上限为 `16 MiB`（`STATE_RESPONSE_LIMIT`）；自建 SQLite 运维导入文件上限为 `16 MiB + 1 KiB`（`CONFIG_FILE_LIMIT`），单库以 `WAL` 模式 + `synchronous = FULL` + `BEGIN IMMEDIATE` 串行化写入。

### ADR-002：Cloudflare KV 仅用于 DO 首次初始化迁移

- **决策**：原生 Cloudflare 模式中，`KV` 只在 `AppConfigStore`（实例名 `app-config-v1`）尚无配置数据时读取一次旧键 `config` 完成初始化迁入；此后所有读取与写入均由 DO 单独承担，不再回写 `KV`。
- **依据**：Workers KV 的最终一致性不适合承载即时生效的密钥撤销、登录失败计数锁定（15 分钟 10 次）及多账号并发变更。

### ADR-003：仅对明确拒绝（`401/403/404/429`）执行有限候选切换

- **决策**：`shouldRetryUpstream` 仅在收到上游明确的 `401`、`403`、`404`、`429` 拒绝时，才在随机洗牌后的最多 3 个匹配账号中继续尝试下一个候选；对于 `5xx`、网络故障、`120s` 首包/流空闲超时、超 `32 MiB` 响应或无效 `200` 载荷一律立即返回错误。同时 Caddy 反代模板强制声明 `lb_retries 0` 与 `protocols h1`。
- **依据**：一旦上游已经受理生成，中途断连或 `5xx` 后自动重发不仅会导致客户被重复计费，还会瞬间耗尽阿里云 ESA 单请求仅有 `4` 次外部 `fetch` 的硬预算。

### ADR-004：按平台注入硬预算而非“尽量运行后碰运气”

- **决策**：`src/platforms/shared.mjs` 中的 `PLATFORM_LIMITS` 在请求进入核心网关前注入平台能力与资源上限——Cloudflare `16 MiB`、EdgeOne Makers `1 MiB`、阿里云 ESA `16 MiB` / `4` 次出站 `fetch` / `9000ms` 首包 / `115000ms` 总时长。
- **依据**：提前给出可读的结构化 `413` / `503` 错误，防止在边缘平台强行终止 Isolate 进程前留下半截未完成的状态写入。

### ADR-005：自建状态服务强约束与反代 TLS 独立验收

- **决策**：`src/self-hosted/server.mjs` 默认仅监听 `127.0.0.1:8788`，校验 `DB_PATH` 文件硬链接 `nlink === 1` 与 SQLite `APPLICATION_ID = 0x4d425331`、`MODELBRIDGE_STATE_TOKEN` 与 `_FILE` 严格二选一、以及 `MODELBRIDGE_STATE_ORIGINS` 精确 HTTPS 来源匹配；并发容器与 HTTPS 反代验收脚本由 `pnpm run verify:container` 与 `pnpm run verify:tls` 提供。

---

## 迁移与容灾 Runbook：从 Cloudflare DO / State-Service 迁往自建 SQLite

仓库内置工具 [`tools/state-admin.mjs`](https://github.com/CyberNova2333/modelbridge/blob/main/tools/state-admin.mjs) 负责全量配置的离线导出、严格校验导入与在线一致性备份。

### 1. 从运行中的远程状态端或 `state-service` 导出配置

需要确保运行导出的机器网络来源在远端 `MODELBRIDGE_STATE_ORIGINS` 允许列表中（通过 `MODELBRIDGE_STATE_EXPORT_ORIGIN` 声明精确 HTTPS 来源）：

```sh
MODELBRIDGE_STATE_URL="https://state.example/_modelbridge/state" \
MODELBRIDGE_STATE_TOKEN="<你的32~512位令牌>" \
MODELBRIDGE_STATE_EXPORT_ORIGIN="https://gateway.example" \
node tools/state-admin.mjs export-remote --out ./migration-config.json
```

> 导出文件包含明文上游凭据与实例密钥，请存放在受限权限目录中并在迁入后安全清理，**切勿提交到 Git 仓库**。

### 2. 导入到全新的自建 SQLite 数据库

`import` 命令仅向**尚未包含配置的全新/空数据库**写入数据，且会校验 JSON 大小（`<= 16 MiB + 1 KiB`）与合法配置结构：

```sh
node tools/state-admin.mjs import \
  --db ./data/modelbridge.sqlite \
  --file ./migration-config.json
```

### 3. 在线热备份与快照验证

日常运维禁止直接用 `cp` 拷贝 WAL 运行中的 `.sqlite` 文件，请始终使用内置 `backup` 命令生成已合并日志（`DELETE` 模式）的独立单文件快照：

```sh
node tools/state-admin.mjs backup \
  --db ./data/modelbridge.sqlite \
  --out ./backups/modelbridge-snapshot.sqlite
```

### 4. 切换边缘网关指向

1. 启动 `dist/self-hosted-state/`（及 TLS 反代）并在 `MODELBRIDGE_STATE_ORIGINS` 中加入全部边缘网关的精确 HTTPS 来源。
2. 更新 `cloudflare-remote` / `edgeone` / `esa` 平台环境变量中的 `MODELBRIDGE_STATE_URL` 与 `MODELBRIDGE_STATE_TOKEN`。
3. 登录 `/admin` 核对账号列表、`apiKeys` 与自定义模型映射是否完整，并使用新网关发起一次实际推理调用与一次密钥撤销测试验证写链路即时生效。
