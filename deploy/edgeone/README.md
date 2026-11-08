# EdgeOne Makers 构建项目

本目录是用于 Makers CLI 构建的项目。`edge-functions/index.js` 处理根路径，`edge-functions/[[default]].js` 处理其他路径，两者进入同一个适配器。`app/` 只包含函数依赖；`edgeone.json` 将静态输出限定为独立的空 `public/`，避免静态首页抢占网关路由。

优先使用 `self-hosted-state` 产物运行自建 Node.js + SQLite 状态服务并配置公网 HTTPS，不需要 Cloudflare DO 或 KV。在 Makers 的运行时环境变量/Secret 管理中配置 `ADMIN_PASSWORD`、`MODELBRIDGE_STATE_URL` 和 `MODELBRIDGE_STATE_TOKEN`。URL 必须使用完整固定路径，例如 `https://state.example/_modelbridge/state`。令牌必须与状态服务相同，并在状态服务的 `MODELBRIDGE_STATE_ORIGINS` 中明确列出此部署的 HTTPS 来源。不要把这些值写进代码、`edgeone.json` 或前端构建变量。

修改生成目录内的项目名称后，在此目录使用项目模式：

```sh
edgeone login
edgeone makers deploy -e preview
```

CLI 会构建 Functions；先使用预览环境验收，再由维护者单独发布生产。不要把整个目录作为纯静态 ZIP 上传，也不要把 `outputDirectory` 改成 `.`、`app` 或 `edge-functions`。静态站点上传不会提供网关函数语义，且可能公开服务端源码。此处不使用 `edgeone pages` 旧命令族，也不使用匿名发布。

Makers Edge Functions 的平台请求体限制为 1 MB；适配器采用 1 MiB 应用预算，实际可接收值受平台更小上限约束。长 SSE、取消传播与上游可达性仍需在所选部署区域验收。账号、密钥撤销和会话保存在同一状态库，不能将最终一致的边缘 KV 当成等价的并发配置存储。保留旧 DO 的实例仍可接入 `state-service` 桥接，但这只是兼容选择。

重新构建会覆盖生成模板。构建器拒绝覆盖输出目录中的无关文件；CLI 生成本地元数据后，可用 `node tools/build-platforms.mjs --out-dir <新目录>` 从仓库生成下一份项目。

依据：[CLI 项目构建与部署](https://pages.edgeone.ai/document/edgeone-cli)、[文件路由及平台限制](https://pages.edgeone.ai/document/edge-functions)、[输出目录配置](https://pages.edgeone.ai/document/edgeone-json)。当前构建验证不代表腾讯云部署已完成。
