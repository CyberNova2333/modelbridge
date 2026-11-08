# Cloudflare Worker 构建项目

这是保留旧存储方式的 Cloudflare 原生部署目录：配置权威仍是 Durable Object，KV 只参与旧数据首次迁移。`_worker.js` 保持无外部模块依赖，可继续单文件使用。若要摆脱 DO/KV，请使用独立的 `cloudflare-remote` 产物，配合 `self-hosted-state`，不要套用本模板。

1. 在生成目录内检查 `wrangler.toml`，填写自己的 Worker 名称及 KV Namespace ID。
2. 在 Cloudflare Secrets 中配置 `ADMIN_PASSWORD`。账号令牌与调用密钥通过现有管理流程添加。
3. 对已有实例保留原 `CONFIG_STORE`、迁移历史和 KV 绑定，不能把模板当作重置配置的工具。

本地构建核对可在此目录执行：

```sh
pnpm dlx wrangler deploy --dry-run
```

正式发布由维护者单独执行 `pnpm dlx wrangler deploy --keep-vars`；本仓库构建脚本不会执行部署。保留旧 DO 作为共享权威时可使用 `state-service` 桥接项目；改用自建 SQLite 时，应完成显式配置迁移并切换所有网关，避免两份权威同时接受写入。

重新构建会覆盖生成目录中的模板；需要长期保存的部署配置应放到自己的受控位置。构建器拒绝覆盖含无关文件的输出目录，可以通过 `--out-dir <新目录>` 生成新副本。

依据：[Wrangler 配置](https://developers.cloudflare.com/workers/wrangler/configuration/)、[构建与部署命令](https://developers.cloudflare.com/workers/wrangler/commands/workers/)。构建和模拟测试不代表云端持久化、真实账号或计费已验收。
