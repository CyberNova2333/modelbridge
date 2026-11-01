# 上游请求、刷新与配额

等待超时只说明网关没拿到确定结果，并不说明供应商没有生成或计费。模桥把“明确拒绝”与“结果不确定”分开处理，再给读取、取消、连接测试和统计刷新设置各自的边界。

## 一次失败是否允许换账号

| 上游结果 | 网关行为 |
| --- | --- |
| 明确返回 401、403、404 或 429 | 普通聊天和向量路由可尝试下一个匹配账号，最多三个候选账号 |
| 连接失败、响应头超时、读取停滞或 5xx | 返回失败，不再发起另一轮生成 |
| HTTP 200 内含错误，JSON 无效或结果不能使用 | 返回错误，不因“成功但坏了”而重复生成 |
| 已开始的流出现错误或异常终止 | 结束流并暴露协议错误，不切换账号续写 |

代表场景：账号 A 返回明确的 429，可继续尝试 B；若 A 的连接超时，即使 B 可用，也不会补发生成。若 A 返回的向量数量不对，同样返回 502，而不是用 B 重算。候选账号会打乱顺序；这不是按余额选路或强制均匀分配。

Antigravity 也最多选择三个候选账号，但不等于最多三次 HTTP 调用：同一账号遇到 401 可强制刷新一次后重试，404 可尝试备用服务端点；OAuth 和项目发现还需要自己的请求。已收到生成结果前的网络不确定性仍不会触发另一轮生成。具体目标是否可用，取决于真实账号权限和供应商服务。

[重试实现](../../_worker.js)可定位 `shouldRetryUpstream / callOpenAICompatibleAPI / handleEmbeddings / callAntigravityUpstream`；[上游安全断言](../../tests/upstream-safety.test.mjs)与[Antigravity 约束断言](../../tests/antigravity-constraints.test.mjs)可反查拒绝及不确定失败分支。

## 字节预算和连接生命周期

| 边界 | 当前实现 |
| --- | --- |
| 登录 JSON 输入 | 16 KiB |
| 管理 JSON 输入 | 1 MiB |
| 聊天、向量和 Gemini JSON 输入 | 16 MiB，包含内嵌 base64 的实际传输字节 |
| 生成与向量上游响应 | 等待响应头 120 秒、响应体闲置 120 秒、累计响应体最多 32 MiB |
| Cloudflare 连接测试响应 | 等待响应头及响应体闲置各 15 秒，累计响应体最多 1 MiB |

输入限制按实际读取字节累计，缺失或伪造 `Content-Length` 不能绕过；无效 JSON 返回 400，超限返回 413 并取消读取。内部协议转换复用已经通过限制的解析结果，避免回放元数据展开后被重复计入外部字节预算。

上游闲置超时会随读取到数据重新计时，并不是整次生成只能运行 120 秒。累计响应体限制同样覆盖流式数据；超过限制会中断连接。正常完成、超时和客户端取消都会清理读取器及计时器。生成和向量请求使用手动重定向，不自动把上游凭据随重定向发往新地址。

客户端取消会传给正在进行的生成连接；取消期间可能返回 499，也可能已经发出响应头。供应商是否停止计算或停止计费仍需其自身确认。OAuth 登录和项目发现有独立的 20 秒超时，不应把取消传播理解为每个准备阶段都已同步停止。

[输入与传输实现](../../_worker.js)可定位 `readRequestJson / fetchUpstream / refreshAntigravityToken / discoverAntigravityProject`；[请求大小回归](../../tests/review-request-security.test.mjs)及[响应清理断言](../../tests/upstream-safety.test.mjs)约束实际读取与资源释放。

向量结果还要检查输入输出数量、索引唯一且有效、数值为有限 float32、维度非空且一致、请求维度及 base64 编码。OpenAI 的数字 Token 数组算一条输入，不把每个 Token 当成一条向量。无效结果不返回成功，也不重算；详见[向量输出回归](../../tests/review-upstream-regressions.test.mjs)。

## “测试连接”到底做了什么

| 账号类型 | 远端动作 | 能说明什么 |
| --- | --- | --- |
| OpenAI、Anthropic、Gemini | 读取一页模型目录，15 秒超时，不发送生成请求 | 目录请求成功；不证明所有模型或生成权限 |
| Antigravity | 取得登录状态并查询项目，不发送生成请求 | OAuth 与项目准备可用；不证明模型生成权限 |
| Cloudflare | 并行检查模型读取、向量推理和统计权限 | 三项权限的本次结果；其中一次小型向量推理会消耗额度 |

Cloudflare 诊断使用与生成相同的有界读取工具，但采用上表更小预算并响应客户端取消。错误会截断与脱敏，账号标识被限制在 URL 路径片段内。界面防止同一次连接测试期间重复点击；这不把测试变成免费的操作。

[连接测试实现](../../_worker.js)位于 `handleDashboardApi` 的 `/api/accounts/test` 分支；[连接诊断回归](../../tests/review-upstream-regressions.test.mjs)检查超时、大小、取消和凭据脱敏。

## 登录刷新和用量刷新分别合并

Antigravity 的访问令牌缓存和正在进行的刷新，按账号及凭据/OAuth 客户端指纹区分。同一 Worker 实例内，同时使用同一凭据的请求共用一次正在执行的刷新；强制刷新跳过已完成的缓存，但仍加入已有刷新。成功或失败后都会清理进行中记录，凭据改变不会借用旧身份结果。这是单实例内的合并，不是跨所有 Worker 实例的分布式锁。

Cloudflare 用量刷新则由配置 Durable Object 合并。公开首页只读已缓存汇总，不触发统计查询或写入；主动刷新要求管理员权限。统计按真实 Cloudflare Account ID 去重，同账号的不同 Token 共享额度与统计。每批最多刷新 20 个过期账号，同时最多 4 个查询，缓存有效期 5 分钟。只有明确的统计鉴权拒绝才允许在同账号下改试凭据，最多三条不同凭据；网络、限流或服务端故障不会遍历所有凭据。

统计以 UTC 日期分桶，跨日后不会把昨日用量当作今日用量。网络查询结束时会重新检查账号及凭据指纹，不发布已删除或已更换凭据的结果；统计缓存写入失败不应让本来可用的网关变成故障。其他供应商不计入 Cloudflare 统计，应使用各自控制台。

[刷新实现](../../_worker.js)可定位 `getAntigravityToken / antigravityTokenRefreshes / handleUsageStoreRequest / refreshUsageStore`；[OAuth 并发回归](../../tests/review-upstream-regressions.test.mjs)、[统计去重与跨日回归](../../tests/quota-project-regressions.test.mjs)和[统计鉴权回退断言](../../tests/config-scope-regressions.test.mjs)分别检查这些不同层次。

### 通过环境 Secret 提供 Antigravity 账号

后台手动填写邮箱和令牌是常规配置入口；若使用环境配置，`ANTIGRAVITY_ACCOUNTS` 接受 JSON 数组，也兼容包含 `accounts` 数组的对象。下面全是占位值，应在部署环境的 Secret 中填写，不写入版本库：

```json
[
  {
    "email": "you@example.com",
    "refreshToken": "<refresh-token>",
    "projectId": "<project-id>",
    "oauthClientId": "<oauth-client-id>",
    "oauthClientSecret": "<oauth-client-secret>",
    "models": ["<upstream-model-id>"]
  }
]
```

| 字段 | 在环境账号中的含义 |
| --- | --- |
| `email` | 账号显示/识别信息；也兼容 `accountId` |
| `refreshToken` | 用来换取访问令牌；环境数组使用这个字段，后台保存的规范字段则是 `apiToken` |
| `projectId` | 可选；留空时发现项目，亦可使用环境级 `ANTIGRAVITY_PROJECT_ID`。兼容 `project_id` |
| `oauthClientId`、`oauthClientSecret` | 可选的一对自定义 OAuth 客户端设置；也兼容 `client_id`、`client_secret`。未设置时使用环境级设置或内置客户端，最终有效的两个值必须齐全 |
| `models` | 可选模型限制；填写真实上游模型标识，空数组表示不限制 |

环境账号还兼容直接填写 `apiKey` 作为已有访问令牌；这种令牌不等于可长期刷新的凭据。`status: "disabled"` 会跳过该条目。`ACCOUNTS_JSON` 是旧变量别名，优先使用 `ANTIGRAVITY_ACCOUNTS`。这些环境账号与后台账号一起成为候选，并不会导入后台配置，也不出现在可编辑的后台账号列表中。无效 JSON 不会被加载，设置完成后应按实际账号做独立验收。

[环境账号解析](../../_worker.js)可定位 `getAntigravityAccounts / antigravityOAuthClient`；它不读取导出文件常见的 `refresh_token` 字段，不能把任意 `auth.json` 内容直接当作此配置使用。

## 免费映射不是服务端预算

仓库默认的 [Cloudflare 映射清单](../../cloudflare-model-map.json)收录 65 个预设别名，初始化和恢复预设使用相同内容。它选择的是适用免费额度的模型集合，不给每次请求预约额度，也不会在累计达到面板数值时自动拒绝生成。

用量面板按每个不同启用 Cloudflare 账号 10,000 Neurons 计算参考额度。这是源码中的展示计算；统计有缓存、查询延迟和失败状态，不是账单或强制预算。实际模型可用性、免费政策和费用应以供应商控制台及当时政策为准。若要求绝不产生额外费用，需要在上游账号层确认相应限制，不能仅依赖映射和图表。

回到[一次请求的主流程](../walkthroughs/one-real-run.md)，或用[代码地图](../code-map.md)选择修改入口。本页依据本地源码和模拟测试断言，不等于真实账号权限、云端持久化或线上取消计费已经验收；实际执行记录见[指南变更记录](../change-log.md)。

证据状态：除特别标注外，本页基于当前源码已确认。
