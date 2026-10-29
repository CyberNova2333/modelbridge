# 模桥 · ModelBridge 代码地图

先读[主流程的输入与交接](walkthroughs/one-real-run.md)，再按责任定位修改。本页只覆盖已声明主流程，不把目录出现过当作完整模块调查。

| 路径 | 职责 | 关键代码 | 与主流程的关系 |
| --- | --- | --- | --- |
| `./` | 单文件 Worker 承载入口、鉴权、路由、存储与协议转换 | `_worker.js` | Wrangler main |
| `tests/` | 用模拟存储与模拟上游约束路由和错误边界 | `tests/universal-upstreams.test.mjs` | node --test |
| `assets/` | 品牌静态资源，不承载请求路由 | `assets/modelbridge-logo.svg` | 界面展示，非聊天数据流 |

## `./`

单文件 Worker 承载入口、鉴权、路由、存储与协议转换。范围仅为下表入口及主流程直接使用的契约，其余文件没有逐一审核。

| 重要代码 | 功能 | 关键符号 | 调用方 / 使用方 |
| --- | --- | --- | --- |
| [职责入口](../_worker.js) | 单文件 Worker 承载入口、鉴权、路由、存储与协议转换 | `handleV1Proxy / handleCompletions / callOpenAICompatibleAPI` | Wrangler main |

相关验证：`tests/upstream-safety.test.mjs`。本轮只检查可读证据，业务测试没有执行。

## `tests/`

用模拟存储与模拟上游约束路由和错误边界。范围仅为下表入口及主流程直接使用的契约，其余文件没有逐一审核。

| 重要代码 | 功能 | 关键符号 | 调用方 / 使用方 |
| --- | --- | --- | --- |
| [职责入口](../tests/universal-upstreams.test.mjs) | 用模拟存储与模拟上游约束路由和错误边界 | `跨上游、模型白名单、流转换用例` | node --test |

相关验证：`tests/config-auth.test.mjs`。本轮只检查可读证据，业务测试没有执行。

## `assets/`

品牌静态资源，不承载请求路由。范围仅为下表入口及主流程直接使用的契约，其余文件没有逐一审核。

| 重要代码 | 功能 | 关键符号 | 调用方 / 使用方 |
| --- | --- | --- | --- |
| [职责入口](../assets/modelbridge-logo.svg) | 品牌静态资源，不承载请求路由 | `logo 与 icon` | 界面展示，非聊天数据流 |

相关验证：`README.md`。本轮只检查可读证据，业务测试没有执行。

## 覆盖范围

覆盖 OpenAI Chat Completions 输入、调用密钥、模型解析、通用上游选择和错误/流返回边界。管理界面、完整 Durable Object 配置生命周期、用量查询、Antigravity OAuth、嵌入及所有协议组合不逐段展开。当前主要实现和测试含未提交改动，源码可读不等于已经生产验收。

生成物、依赖安装目录、临时日志及第三方供应商源码不作为本次第一方模块地图。修改范围外机制前应重新调查，不能从本页推断兼容性。

证据状态：除特别标注外，本页基于当前源码已确认。
