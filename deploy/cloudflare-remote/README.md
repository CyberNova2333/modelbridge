# Cloudflare Worker 使用自建状态服务

这个入口把账号、调用密钥、管理员会话和用量状态交给通用 HTTPS 状态服务，不需要 KV 或 Durable Object。共享核心和协议转换仍运行在 Cloudflare Worker。

先按 `self-hosted-state` 产物的说明运行 Node.js 24 + SQLite 状态服务，并配置公网 HTTPS，然后在当前 Worker 的 Secrets 中设置：

| 名称 | 内容 |
| --- | --- |
| `ADMIN_PASSWORD` | 此网关的管理员密码，与状态服务令牌分开 |
| `MODELBRIDGE_STATE_URL` | 完整固定地址，例如 `https://state.example/_modelbridge/state` |
| `MODELBRIDGE_STATE_TOKEN` | 与状态服务一致的随机服务间令牌 |

状态服务的 `MODELBRIDGE_STATE_ORIGINS` 还必须包含此网关的精确 HTTPS 来源，例如 `https://gateway.example`。网关域名和状态服务域名职责不同；来源列表不接受尾斜杠、路径或通配符。

检查 `wrangler.toml` 项目名称后，可用 `npx wrangler deploy --dry-run` 检查本地打包。维护者验收后单独执行 `npx wrangler deploy --keep-vars`；构建脚本不会发布。部署时保留 `enable_request_signal`，平台必须提供真实请求取消信号。

此入口严格使用远程状态，URL 或令牌缺失、格式无效、状态服务故障都会拒绝请求。即使环境仍残留旧 `CONFIG_STORE` 或 KV 绑定，也不会恢复旧配置。迁移已有实例需先按主指南导出并导入配置，所有需要共享配置的网关必须使用同一状态库；不应让旧 DO 和 SQLite 同时接受配置写入。

登录限流只在请求携带 Cloudflare 运行时元数据时读取 `CF-Connecting-IP`，不会使用 `X-Forwarded-For` 或 `X-Real-IP`。本地模拟或元数据缺失时使用共享保守桶。来自其他 Worker 的同区子请求可能影响 Cloudflare 注入的客户端 IP，因此不能把此字段当成独立的身份认证依据。[Cloudflare 请求头语义](https://developers.cloudflare.com/fundamentals/reference/http-headers/#cf-connecting-ip)

生成、流转换和错误边界仍由原网关负责；网络取消只表示本地连接停止，不证明上游停止计费。构建和模拟测试不证明真实 Cloudflare、TLS、权限或持久化已经验收。
