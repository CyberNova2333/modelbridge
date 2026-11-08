# 旧 Cloudflare DO 状态桥接

这个兼容入口保留原 Cloudflare Durable Object 为配置权威，再通过状态 RPC 提供给远程网关。新安装若要摆脱 Cloudflare DO，应选择 `self-hosted-state`；此目录不是自建 SQLite 服务。它不是新的模型代理，也不使用管理员密码作为服务间凭据。

1. 将 `wrangler.toml` 中的 `script_name` 替换成拥有现有 `AppConfigStore` 的 Worker 名称，并使用同一 Cloudflare 账号。
2. 在此服务的 Secrets 中设置独立、随机的 `MODELBRIDGE_STATE_TOKEN`，并在网关平台设置同一值。令牌要求 32 至 512 个无空白的可见 ASCII 字符，建议使用随机 32 字节的 hex 或 base64url 编码。
3. 设置 `MODELBRIDGE_STATE_ORIGINS`，使用逗号分隔的精确 HTTPS 来源，例如 `https://app.example,https://other.example`。不接受 JSON、尾斜杠或通配符。
4. 在网关平台配置 `MODELBRIDGE_STATE_URL`，使用完整固定路径，例如 `https://state.example/_modelbridge/state`。不接受查询参数、片段或 URL 用户信息；不要把令牌放进 URL。

本服务绑定已有 DO，不声明新迁移、不绑定 KV，也不设置 `ADMIN_PASSWORD`。不得为快速部署把它改成另一份独立配置库，否则撤销和账号修改将失去同一权威。

在本目录运行 `pnpm dlx wrangler deploy --dry-run` 可检查模块打包；正式部署由维护者单独执行。生成模板默认关闭持久化请求日志，并保留查询字符串脱敏；服务凭据始终通过 Secret 管理。

重建会覆盖模板；将自己的配置保存在受控位置。CLI 生成无关文件后，使用构建器的 `--out-dir <新目录>` 创建下一份项目。

依据：[跨 Worker Durable Object 绑定](https://developers.cloudflare.com/workers/wrangler/configuration/#durable-objects)。状态服务部署和真实跨平台持久化仍需独立验收。
