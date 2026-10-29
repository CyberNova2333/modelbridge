# 模桥 · ModelBridge 源码证据

这是调查台账：解释主流程的依据与边界，不能替代运行日志。源码锚点为 `27e5f558fb689e67c7dd1b5fe545f1a306783aff`；本轮还读取了当前工作树，未提交内容不等于已交付版本。

## Evidence Traversal Log

| Pass | Purpose | Inspected evidence | What changed in the model |
| --- | --- | --- | --- |
| Pass 1 | 建立输入、状态和输出路径 | `_worker.js`, `_worker.js`, `_worker.js`；根 README、package 或构建入口、Agent 规则 | 固定 walkthrough 的代表性行为，并列出交接位置。 |
| Pass 2 | 反查失败与遗漏依赖 | `tests/upstream-safety.test.mjs`, `tests/config-auth.test.mjs`, `README.md`；配置、已有文档与范围内目录 | 核对模型未识别、账号筛选、三次预算、明确拒绝与不确定失败的差别；反查模拟上游测试，确认不能把它们当作真实账号权限或计费验证。 |

## 证据表

| Claim | Evidence | Confidence | Caveat | Used by |
| --- | --- | --- | --- | --- |
| 先确认绑定和客户端调用权限 | [源码定位](../../_worker.js)：`fetch、handleRequest、handleV1Proxy、checkProxyAuth` | Confirmed | 源码静态确认；本轮未运行业务路径 | [主流程](../walkthroughs/one-real-run.md)、[代码地图](../code-map.md) |
| 校验聊天输入并解析模型 | [源码定位](../../_worker.js)：`handleCompletions、resolveModelName` | Confirmed | 源码静态确认；本轮未运行业务路径 | [主流程](../walkthroughs/one-real-run.md)、[代码地图](../code-map.md) |
| 只把请求送给匹配的上游 | [源码定位](../../_worker.js)：`callOpenAICompatibleAPI、parseUpstreamTarget、getMatchingUpstreamAccounts` | Confirmed | 源码静态确认；本轮未运行业务路径 | [主流程](../walkthroughs/one-real-run.md)、[代码地图](../code-map.md) |
| 按明确失败决定是否换账号 | [源码定位](../../_worker.js)：`shouldRetryUpstream、fetchUpstream；tests/upstream-safety.test.mjs` | Confirmed | 源码静态确认；本轮未运行业务路径 | [主流程](../walkthroughs/one-real-run.md)、[代码地图](../code-map.md) |
| 把结果与错误转换为客户端协议 | [源码定位](../../_worker.js)：`passthroughStream、sanitizeUpstreamErrorStream、handleCompletions` | Confirmed | 源码静态确认；本轮未运行业务路径 | [主流程](../walkthroughs/one-real-run.md)、[代码地图](../code-map.md) |

## 反证与后续问题

反证检查（Falsifying check）：若一个网络结果不确定的请求会自动换账号重新生成，或模型白名单不能限制凭据路由，当前转发模型就被推翻。

下一位读者可能问（Next reader question）：其他客户端协议怎样转换工具与签名思考？根 README 介绍兼容边界，tests/cross-protocol.test.mjs 与协议专项用例继续验证；本页不声称完整矩阵覆盖。

## 范围与未验证事项

覆盖 OpenAI Chat Completions 输入、调用密钥、模型解析、通用上游选择和错误/流返回边界。管理界面、完整 Durable Object 配置生命周期、用量查询、Antigravity OAuth、嵌入及所有协议组合不逐段展开。当前主要实现和测试含未提交改动，源码可读不等于已经生产验收。

测试使用模拟上游；当前可读用例覆盖错误包、账号隔离、重试预算和协议转换，但本轮未运行这些业务测试。真实账号权限、云端持久化和生产流取消仍需独立验证。

本轮文档结构校验与站点构建结果记在[同步记录](../change-log.md)。源码链接在仓库阅读时指向真实文件；独立站点只发布指南；文档目录之外的仓库源码链接在网页中显示为精确路径，源码不随站点打包。原始 Markdown 保留本地可核对链接。已有 VitePress 使用原文包含，正文只维护一份。
