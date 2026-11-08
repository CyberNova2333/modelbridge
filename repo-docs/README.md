# 模桥 · ModelBridge 项目指南

模桥把不同供应商的模型接到同一个网关上，让客户端使用 OpenAI、Anthropic 或 Gemini 协议调用。Cloudflare、Makers 与 ESA 通过适配器运行共享核心，可共用自建 SQLite 状态服务；原生 Cloudflare DO 是保留的兼容部署方式。网关需要同时决定“谁能调用”“用哪个模型和账号”“哪些协议约束能被兑现”，也要避免不确定失败后的重复生成。

公开仓库为 [CyberNova2333/modelbridge](https://github.com/CyberNova2333/modelbridge)，项目按 [GPL-3.0-only](../LICENSE) 分发；上游 MIT 及第三方许可说明见 [NOTICE](../NOTICE)。

新读者先跟随[一次聊天请求的交接](walkthroughs/one-real-run.md)，再用[代码地图定位修改位置](code-map.md)。已经熟悉网关的维护者可以直接进入下列概念页，查找具体边界与验证入口。

## 阅读路径

| 读者目标 | 从这里开始 | 读完后获得什么 |
| --- | --- | --- |
| 部署和接入客户端 | [中文使用说明](../README.md) / [English setup](../README.en.md) | 需要哪些绑定、如何配置账号、调用哪个端点？ |
| 理解请求怎样得到结果 | [主流程与拒绝边界](walkthroughs/one-real-run.md) | 权限、模型、账号和错误怎样交接？ |
| 管理账号、密钥与配置 | [访问权限与配置生命周期](modules/access-and-config.md) | 凭据怎样隔离，为什么不能回退旧配置？ |
| 部署到多个平台、迁出 DO | [平台入口与权威状态服务](modules/platform-adapters.md) | 自建持久化、服务凭据、迁移与备份、容量差异是什么？ |
| 选择模型或排查协议限制 | [模型路由与协议契约](modules/routing-and-protocols.md) | 别名和白名单怎样限制路由，哪些选项会被拒绝？ |
| 控制重复请求与配额开销 | [上游请求与配额边界](modules/upstream-and-quota.md) | 何时换账号，取消能否停止计费，测试是否消耗额度？ |
| 找到修改位置 | [职责、关键代码和测试](code-map.md) | 改入口、存储、界面、CI 或站点应从哪里开始？ |
| 维护品牌 | [网页品牌与部署名称](code-map.md#品牌与部署名称) | ModelBridge 与 Worker 服务名有什么关系？ |
| 核对术语或解释依据 | [术语表](glossary.md)、[两遍源码调查](references/source-evidence.md) | 名称的含义是什么，声明依据和范围在哪里？ |
| 复核文档及交付状态 | [读者模拟](references/quality-review.md)、[同步记录](change-log.md) | 哪些已验证，哪些仍需生产验收？ |

## 覆盖范围

本包采用 Standard 结构，覆盖请求入口、访问与配置、模型账号选择、协议转换边界、上游资源控制，以及维护工具和文档站的职责。主 walkthrough 只重放一条 OpenAI 聊天输入路径；概念页补充其他协议、嵌入和 OAuth 的关键契约。它不是所有模型、字段和协议组合的兼容认证，也不逐个介绍管理页面控件。

源码、配置和测试是实现依据。指南说明当前工作树，提交锚点及验证记录见同步记录；未提交改动和本地测试不代表生产已经更新。

## 运行与验证

在仓库根运行回归，准备 Node.js 24+、Python 3.10+ 和 Git；根目录无需 npm 安装。

```sh
node --test tests/*.test.mjs
```

测试使用模拟模型上游；自建状态集成另使用真实临时 SQLite、独立进程与本地 HTTP，原生 DO/KV 仍为模拟。开发 Worker 前，按根 README 配置绑定与本地 Secret，再运行 `npx wrangler dev`；这些本地验证不代表真实账号或云端迁移已验收。

独立文档站使用 VitePress 默认主题，通过 include 读取本指南。安装与构建见根 README，构建产物独立于业务界面。网页中的指南链接正常导航；指南之外的仓库源码链接显示为精确路径，源码和本机文件不会随站点发布。

证据状态：除特别标注外，本页基于当前源码已确认。
