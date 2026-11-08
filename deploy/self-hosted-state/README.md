# 自建共享状态服务

该项目使用 Node.js 24 内置 SQLite，在自己的主机保存账号、调用密钥、管理员会话和用量状态，不需要 npm 依赖、Cloudflare KV 或 Durable Object。Cloudflare 远程入口、EdgeOne Makers 和 ESA 都通过相同的 HTTPS RPC 接入它；模型请求和流转换仍由各边缘网关处理。

新安装可以直接创建空状态库，再在网关管理界面添加账号和调用密钥。迁移已有配置时，应先完成主指南里的显式导出/导入，再启动生产服务；不要把旧 DO 和 SQLite 当作两份可同时写入的权威。`tools/state-admin.mjs` 随产物提供迁移和一致性备份命令。

配置本体的 JSON 上限为 16 MiB；迁移文件另外保留 1 KiB 给格式和导出时间等元数据。导入仍检查内部配置上限，超限时不会创建目标数据库。字节上限不是生产吞吐或延迟保证，应按实际配置规模验收。

## 配置

| 环境变量 | 内容 |
| --- | --- |
| `DB_PATH` | 必填，数据库文件路径；容器模板为 `/data/modelbridge.sqlite` |
| `HOST` | 默认 `127.0.0.1`；仅在隔离容器网络中显式使用 `0.0.0.0` |
| `PORT` | 默认 `8788` |
| `MODELBRIDGE_STATE_PUBLIC_ORIGIN` | 状态服务自己的精确 HTTPS 来源，例如 `https://state.example` |
| `MODELBRIDGE_STATE_ORIGINS` | 允许的网关来源，以逗号分隔，例如 `https://gateway.example,https://gateway-other.example`；不接受尾斜杠、路径或通配符 |
| `MODELBRIDGE_STATE_TOKEN_FILE` | 私密令牌文件的绝对路径；Compose 挂载为 `/run/secrets/state_token` |
| `MODELBRIDGE_STATE_TOKEN` | 不使用文件时的替代方式，与 `_FILE` 严格二选一 |

令牌要求 32 至 512 个无空白的可见 ASCII 字符，建议使用随机 32 字节的 hex 编码。令牌文件允许单个末尾换行。此服务不需要 `ADMIN_PASSWORD`；管理员密码只放在各网关中。HTTP `Host`、`Origin` 和 `X-Forwarded-Proto` 不能代替配置中的来源和服务间令牌。

三个边缘平台均设置 `MODELBRIDGE_STATE_URL=https://state.example/_modelbridge/state` 及同一服务间令牌。所有来源必须在上表的允许列表中；地址不接受查询参数、片段或用户名密码。

## Docker Compose 与 HTTPS

模板包含非 root Node 容器和 Caddy 反向代理。只有 Caddy 发布宿主机 80/443 端口；状态服务的 8788 端口没有宿主机映射。SQLite 持久化在命名卷 `state_data`，Caddy 的证书和配置也使用持久卷。镜像只复制程序文件，`.dockerignore` 不让本地令牌和数据库进入镜像。

状态 RPC 的 Caddy 入口只协商 HTTPS/HTTP 1.1，不启用 HTTP/2、h2c 或 HTTP/3。此限制缓解当前所审计 Caddy 二进制内 Go HTTP/2 的协议层漏洞，不影响 JSON 状态操作；模型 SSE 仍直接走边缘网关。恢复其他协议前，必须核对实际二进制的 Go 与 `golang.org/x/net` 安全版本并重新做 TLS 协商验收，不能仅看 Caddy 的版本号。配置缓解不代表镜像中的全部依赖告警已消除。

在独立部署目录保存生成产物，按下面顺序准备 Linux 主机：

1. 将自己的状态域名解析到主机，并允许 Caddy 使用 80/443 申请和续期证书。不要使用示例域名直接启动。
2. 在构建目录之外建立私密令牌文件，例如 `/srv/modelbridge-secrets/state-token`。保持文件对容器 UID/GID `1000:1000` 可读，其他用户不可读；Linux 可使用所有者 `1000:1000`、权限 `0400`，父目录权限 `0700`。不要覆盖已有令牌。
3. 设置下列非令牌环境变量，核对 Compose 配置后再由维护者启动服务。

```sh
export STATE_DOMAIN=state.example
export MODELBRIDGE_STATE_ORIGINS=https://gateway.example
export STATE_TOKEN_FILE=/srv/modelbridge-secrets/state-token
docker compose config --quiet
docker compose up -d --build
```

`STATE_DOMAIN` 只能填写域名，不带协议、端口或路径。模板自动生成 `MODELBRIDGE_STATE_PUBLIC_ORIGIN`。Compose Secret 使用文件挂载；实际文件权限仍需主机管理员保证，不应依赖 Compose 的 `uid` 或 `mode` 字段替主机修改权限。更换域名、证书、令牌、磁盘或挂载路径后重新做读写与撤销验收。

生产使用应固定已验证的 Node/Caddy 镜像版本或 digest，并按运维计划更新。模板的 `node:24-bookworm-slim` 和 `caddy:2` 是版本系列，不是不可变镜像。仓库中的验收脚本可在隔离容器中检查运行与私有 CA HTTPS；这不代表你的生产容器或公网证书已部署。

## 直接运行与持久化

也可以预先建立仅服务账号可访问的数据库父目录，配置上表环境后执行 `node src/self-hosted/server.mjs`。默认仅监听回环地址；使用现有 Nginx/Caddy 等在公网终止 HTTPS，将固定 RPC 路径反代至 `127.0.0.1:8788`。不要把裸 HTTP 端口暴露到互联网，也不要让代理记录 Authorization、请求体或状态响应。

单个状态服务实例连接一份本地持久化 SQLite 数据库。不要将数据库放在 NFS/SMB 上，也不要为扩容启动使用不同数据库文件的副本。数据库、日志侧文件和备份包含上游凭据，必须使用受限文件权限和受控存储；需要静态加密时由宿主机磁盘或存储系统提供。

运行镜像仅需 Node 内置模块，已从最终运行文件系统移除 npm、Corepack、Yarn 及其命令入口。容器内使用 `node src/self-hosted/server.mjs` 和 `node tools/state-admin.mjs`，不使用 `npm run`；这不改变宿主机或开发工具的安装。基础系统包与 Node 内嵌组件仍需分别审计，不能把基础镜像自带 npm 的 Undici 版本当成 Node `fetch` 的版本。

正常停止由服务管理器或 `docker compose stop` 发送信号，服务会排空请求并关闭数据库。不要执行会删除数据卷的 `docker compose down -v`。在线备份使用 `tools/state-admin.mjs` 的 SQLite 一致性备份功能，不要只复制正在写入的主数据库文件；备份和恢复应在自己的运维环境验证。

恢复时停止服务，把备份复制到全新的数据库路径或新卷，核对权限后调整 `DB_PATH` 再启动；不能直接覆盖仍带旧 WAL/SHM 的原路径。恢复只得到备份时间点的状态，需核对之后的密钥撤销、会话及上游凭据更换，再开放网关。

状态写入超时可能已经提交，客户端和反向代理都不能自动重试写入。状态服务不可达时网关拒绝请求，不退回边缘 KV 或旧配置快照。自建服务的可用性、磁盘容量、备份和 HTTPS 生命周期由维护者负责；模拟测试不代表公网 TLS、云平台调用或故障恢复已验收。

数据库主文件必须只有一个硬链接；打开和备份入口都会拒绝多链接文件。不要通过硬链接别名打开或备份正在使用的 SQLite，否则别名可能遗漏原路径的 WAL，读到撤销之前的状态。恢复应复制完成的一致性备份到全新路径，不能用硬链接代替复制；数据库目录须由服务账号和获授权维护者独占管理。

模板依据：[Compose Secrets](https://docs.docker.com/reference/compose-file/secrets/)、[Caddy HTTPS](https://caddyserver.com/docs/quick-starts/https)、[Caddy 反向代理](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)。
