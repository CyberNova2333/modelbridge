# 部署运维与排错 FAQ

本页汇总 ModelBridge 在 Cloudflare Workers / Pages、EdgeOne Makers、阿里云 ESA 与自建 Node.js 24 + SQLite 状态服务上线期间的高频故障及定位方法。

## 网关启动与权限配置类问题

### Q：访问 `/admin` 登录或调用 `/api/*` 返回 `503 Service Unavailable`？

原生 DO 模式与远程网关模式在缺少必要依赖时均会**直接拒绝服务（Fail Closed）**，不会降级为内存或无鉴权模式：
1. 检查运行平台是否已配置 `ADMIN_PASSWORD`（去掉首尾空白后非空）。
2. **原生 DO 模式**：检查 `wrangler.toml` 是否同时绑定了 `CONFIG_STORE`（指向 `AppConfigStore`）与 `KV`。若将代码部署至 Cloudflare Pages 并引用外部 Worker 的 DO，确认 `durable_objects.bindings` 已设置 `script_name`。
3. **远程网关模式**（`cloudflare-remote`、`edgeone`、`esa`）：检查 `MODELBRIDGE_STATE_URL` 与 `MODELBRIDGE_STATE_TOKEN` 是否均已作为运行时 Secret 注入。

### Q：远程网关读写配置失败，日志出现 `401` 或 `Origin` 被状态服务拒绝？

`src/state/service.mjs` 与 `src/self-hosted/server.mjs` 对服务间 RPC 实施双重校验：
1. **来源精确匹配**：状态服务校验请求头中的来源与 `MODELBRIDGE_STATE_ORIGINS` 列表。`MODELBRIDGE_STATE_ORIGINS` 必须是逗号分隔的精确 HTTPS Origin（如 `https://gw1.example,https://gw2.example`），**不能**包含尾部 `/`、子路径或 `*` 通配符。
2. **令牌一致与格式校验**：`MODELBRIDGE_STATE_TOKEN` 必须为 32–512 位无空白可见 ASCII 字符，且网关侧与状态服务侧完全一致。
3. **URL 固定路径**：网关侧 `MODELBRIDGE_STATE_URL` 必须以 `/_modelbridge/state` 结尾，不接受查询参数、fragment 或 `user:pass@` 用户信息。

### Q：自建状态服务启动直接报错退出（拒绝加载配置或数据库）？

逐项排查 `src/self-hosted/server.mjs` 与 `src/state/sqlite.mjs` 的安全前置条件：
- `MODELBRIDGE_STATE_TOKEN` 与 `MODELBRIDGE_STATE_TOKEN_FILE` **必须且只能设置其一**，同时设置或均缺失都会报错。
- `MODELBRIDGE_STATE_PUBLIC_ORIGIN` 必须是精确的 `https://...` 来源（不能带 `/`、路径或端口以外多余成分）。
- `DB_PATH` 若指向已存在的文件，其硬链接计数必须为 `nlink === 1`，且 SQLite 头中的 `APPLICATION_ID` 必须匹配 `0x4d425331`（空库或新建库会自动初始化，非 ModelBridge 数据库文件会被拒绝覆盖）。

## 边缘平台预算与反代问题

### Q：EdgeOne Makers 部署后请求体报 `413 Payload Too Large`，或提示找不到静态目录？

- **请求体预算**：EdgeOne Makers 适配器（`src/platforms/edgeone.mjs`）通过 `PLATFORM_LIMITS.edgeone` 将单次入口请求体限制在 **`1 MiB`**（Cloudflare 与 ESA 为 `16 MiB`），超大 Base64 图片或多轮长上下文会直接触发 `413`。超出此预算请改用 Cloudflare Workers、ESA，或精简上下文长度。
- **静态产物路径**：`deploy/edgeone/edgeone.json` 配置了 `"outputDirectory": "./public"`，构建脚本 `node tools/build-platforms.mjs` 会在 `dist/edgeone/public/` 生成占位静态目录；请基于 `dist/edgeone/` 整目录部署，避免手动删空 `public/` 导致 Makers 构建失败。

### Q：阿里云 ESA 频繁触发 `503 platform_subrequest_limit` 或超时中断？

`src/platforms/esa.mjs` 通过 `PLATFORM_LIMITS.esa` 明确约束了单次请求的运行时预算：
- **单次请求最多 `4` 次外部 `fetch`**。注意：远程状态读取、Antigravity OAuth token 刷新、上游重试候选（最多尝试 3 个账号）以及末尾用量统计都会消耗子请求额度。在 ESA 上若配置多个失效账号引发连续重试或同时叠加远程用量写入，极易触及第 4 次上限。
- **解决建议**：保证 ESA 上的首选上游账号凭据健康有效；控制候选账号数量避免无效链式重试；并留意 ESA 首包超时 `9000ms` 与总执行时间 `115000ms` 预算，避免给极慢的推理链路分配过多超时等待。
- **入口文件**：`deploy/esa/esa.jsonc` 使用 `"entry": "./worker.js"`，不要用根目录 `_worker.js` 直接覆盖 `dist/esa/worker.js`。

### Q：为什么前端或管理面板有时报错，状态却像被“重新执行了一遍”？

检查你放在状态服务或自建网关前面的反向代理（Nginx / Caddy / 云 WAF）：
- 代理层绝不能对状态服务 `/_modelbridge/state` 或推理路由开启自动重试（Caddy 模板 `deploy/self-hosted-state/Caddyfile` 明确设置了 `lb_retries 0`）。
- 确保反代对状态服务使用 HTTP/1.1（Caddy 中为 `protocols h1`）并透传原始协议与真实来源。

## 自建 SQLite 运维与备份问题

### Q：可以直接用 `cp` 拷贝正在运行的 `.sqlite` 文件做热备份吗？

**不建议直接拷贝主文件**。自建状态库运行在 WAL 模式（`synchronous = FULL`）下，未 checkpoint 的事务写入位于 `-wal` 伴生文件中，直接复制主 `.sqlite` 文件会丢失最近提交或导致快照不一致。

请使用内置维护工具执行在线安全快照：

```sh
node tools/state-admin.mjs backup --db ./data/modelbridge.sqlite --out ./backups/modelbridge-$(date +%F).sqlite
```

`tools/state-admin.mjs backup` 会调用 `node:sqlite` 的在线 `backup()` API 生成独立事务快照，并将输出切换为 `DELETE` 日志模式后通过唯一临时目录与排他硬链接发布（避免覆盖既有文件或受到硬链接篡改）。

### Q：如何从 Cloudflare DO 在线迁出配置并导入自建 SQLite？

完整步骤与容量边界说明请参见 [关键架构决策与迁移](/docs/migrations)。

## 下一步

- 核对协议端点的请求体限制、模型映射优先级与错误码格式，请参阅 [2. 接口、安全与路由契约](/docs/contracts)。
