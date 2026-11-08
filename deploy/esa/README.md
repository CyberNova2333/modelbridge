# ESA Functions 构建项目

`esa.jsonc` 将 `worker.js` 设为函数入口；这个薄入口导入 `app/` 内的适配器和共享核心。没有配置静态资源或 SPA 回退，首页、后台和 API 都交给同一网关处理。

优先使用 `self-hosted-state` 产物运行自建 Node.js + SQLite 状态服务并配置公网 HTTPS，不需要 Cloudflare DO 或 KV。再通过 ESA 运行时环境变量/Secret 配置 `ADMIN_PASSWORD`、`MODELBRIDGE_STATE_URL` 和 `MODELBRIDGE_STATE_TOKEN`。URL 必须使用完整固定路径，例如 `https://state.example/_modelbridge/state`。状态服务应在 `MODELBRIDGE_STATE_ORIGINS` 中明确允许此部署的 HTTPS 来源；不要将凭据写入构建期环境变量、`esa.jsonc` 或源文件。

检查项目名称后，在此目录使用官方 CLI：

```sh
esa-cli login
esa-cli dev
```

当前已验收的 CLI 本地 EW2 能打包并加载入口，但 `dev` 不提供云端运行时的第三个 `env` 参数；缺少 Secret 时的 503 与 Web API 探针不代表远程状态接入已通过端到端验证。不要把真实 Secret 写入源码绕过此边界。

完成本地检查后，经明确授权，维护者可分别执行 `esa-cli commit` 上传云端版本和 `esa-cli deploy` 选择目标环境，再验收云端 Secret、状态接入、流式响应及断连。两者都是远端操作，构建脚本不会执行它们。CLI 会打包入口的多文件依赖，不需要把业务代码手工拼成单文件。

ESA 平台时限和子请求数量限制比原 Cloudflare 配置更紧，长流与多账号拒绝切换可能提前失败；以适配器的资源预算及真实平台验收结果为准。HTTP 失败不会触发跨平台重试或重复生成。账号、密钥撤销和会话保存在同一状态库，不将 EdgeKV 当作并发配置存储。保留旧 DO 的实例仍可接入 `state-service` 桥接，但这只是兼容选择。

重新构建会覆盖生成模板。构建器拒绝覆盖输出目录中的无关文件；CLI 生成本地元数据后，可用 `--out-dir <新目录>` 生成下一份项目。

依据：[ESA CLI](https://www.alibabacloud.com/help/en/edge-security-acceleration/esa/user-guide/functions-and-pages-cli-tool)、[esa.jsonc 与路由](https://www.alibabacloud.com/help/en/edge-security-acceleration/esa/user-guide/build-pages)。当前构建验证不代表阿里云部署已完成。
