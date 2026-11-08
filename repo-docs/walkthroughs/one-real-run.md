# 一次聊天请求怎样得到结果

客户端用一个模型别名发起聊天。模桥先检查调用权，再把别名变成上游目标，选择凭据，最后把结果返回客户端协议。难点是这些选择不能互相替代：模型出现在列表中，不代表账号有权限；账号能响应，也不代表它能执行客户端要求的全部约束。

下面使用一个中性示例。它按当前路由分支组织，不是线上请求记录。假设管理员已创建启用的 OpenAI 兼容账号，账号允许 `example-chat`，并保存映射 `my-chat → openai:example-chat`。客户端持有单独生成的实例调用密钥。

```http
POST /v1/chat/completions
Authorization: Bearer <INSTANCE_API_KEY>
Content-Type: application/json

{"model":"my-chat","messages":[{"role":"user","content":"你好"}],"stream":false}
```

## Step 1: 先确认实例与调用权限

远程状态部署中，Cloudflare、Makers 或 ESA 适配器检查 Secret，注入到同一自建服务的 HTTPS 通道；原生 Cloudflare 部署仍检查 KV、管理员 Secret 和 DO 绑定。两者均把 `/v1/` 请求交给共享核心，调用权限由选定权威的当前配置决定，详见[多平台入口](../modules/platform-adapters.md)。实例调用密钥与权威配置中的密钥匹配才继续；没有密钥或密钥已撤销时返回 401，不发起生成。管理员密码与供应商 Token 不充当这把密钥。

权限通过后，配置读取在本请求内复用；不同请求不共享鉴权快照。自建 SQLite 以事务保存账号、密钥和映射，服务不可用时拒绝请求，不回退旧 DO 或 KV。兼容 DO 模式只在首次初始化时迁入旧 KV，已有配置不会被覆盖。详细状态与并发边界见[访问权限与配置生命周期](../modules/access-and-config.md)。

使用自建部署模板时，状态 RPC 经 Caddy 的 HTTPS/HTTP 1.1 入口访问；模板关闭 h2/h3 以缓解代理依赖的已知协议层风险。此限制不改变边缘网关向客户端返回模型 SSE 的协议。

实现入口：[Worker](../../_worker.js) 的 `handleRequest`、`handleV1Proxy`、`checkProxyAuth` 和 `getAppConfig`。

## Step 2: 把输入与别名变成目标

入口按实际字节读取 JSON；本例原生 Cloudflare 聊天请求上限 16 MiB，Makers 适配器收紧到 1 MiB。超过应用限额返回 413，无效 JSON 返回 400；平台可能在进入代码前拒绝更大的请求。合法请求需要非空模型名与消息数组。解析器把 `my-chat` 解析成 `openai:example-chat`，从而确定供应商和上游模型名。

模型列表用于发现名称，并非授权证据。没有映射、显式目标或已声明模型可解析时，返回 400 `model_not_found`。不同名称形式与冲突处理见[模型路由与协议契约](../modules/routing-and-protocols.md)。

实现入口：[Worker](../../_worker.js) 的 `readRequestJson`、`handleCompletions`、`resolveModelName`。

## Step 3: 从允许的账号中选择凭据

网关只选择启用、供应商匹配、允许 `example-chat` 的账号；若指定了 `upstream:<账号ID>:<模型>`，还必须匹配该账号 ID。没有候选时直接报错，不临时借用 Cloudflare 或其他供应商的凭据。

本例把 `model` 改为 `example-chat`，向账号配置的 OpenAI 兼容地址发送请求，认证头使用该账号凭据。客户端调用密钥留在网关鉴权边界。若请求含目标上游无法保证的格式、工具或思考约束，会在生成前拒绝；不会悄悄删掉约束后继续。

实现入口：[Worker](../../_worker.js) 的 `parseUpstreamTarget`、`getMatchingUpstreamAccounts`、`callOpenAICompatibleAPI`。

## Step 4: 根据失败的确定性决定是否换账号

成功时不再选择其他账号。只有明确的 401、403、404、429 拒绝允许在总计最多三个候选账号内换账号；网络异常、超时、5xx 或无法使用的成功响应不会重新生成，因为前一次可能已经计费。

读取上游响应受大小与闲置超时限制，取消会向连接传播。核心的闲置超时不是总耗时预算；ESA 适配器另有首字节、总时长与四次出站请求预算，可能在三个候选用完前终止。本地断开不能证明供应商停止了计算或计费。[上游请求与配额边界](../modules/upstream-and-quota.md)解释这些取舍以及连接测试和统计查询的开销。

若流被取消或上游响应无法用于当前协议，网关在本地结束读取并发出中止信号；它不等待可能一直未完成的底层取消回调，也不会因此重发生成请求。

若路由到需要 OAuth 的账号，准备阶段的每次登录或项目查询另限制为 20 秒完整读取及 1 MiB；远程平台的请求取消也传给这些读取器。控制响应超限或无法解析时失败，不把异常结果放进共享缓存再用于后续请求。

实现入口：[Worker](../../_worker.js) 的 `fetchUpstream`、`shouldRetryUpstream`；验证用例为[上游安全回归](../../tests/upstream-safety.test.mjs)。

## Step 5: 保留语义并返回结果

普通响应将模型名恢复为客户端使用的 `my-chat`。若本例使用 `stream: true`，则逐段返回 SSE，处理元信息、终止与错误，并将客户端取消传给上游读取器。

错误信息与流元信息要脱敏；模型正文、工具参数和签名思考不能因脱敏而被任意改写。无法表示的异常终止应作为错误返回，不能伪造正常结束。具体跨协议案例见协议页，例如 Gemini 异常工具结束与 Anthropic 拒绝语义。

远程平台入口在路由返回后也会释放没有被消费的上传体；这一清理同样覆盖成功页面和 OPTIONS。HEAD 的平台错误仅返回状态和响应头。控制查询的传输异常另用固定说明，避免把底层诊断当作模型错误正文直接回显。

实现入口：[Worker](../../_worker.js) 的 `passthroughStream`、`sanitizeUpstreamErrorStream` 和协议转换器。

## 检查正常与边界分支

| 改变哪个条件 | 预期结果 |
| --- | --- |
| 本例映射、密钥、账号和响应均合法 | 返回客户端协议，模型名保持 `my-chat` |
| 调用密钥失效 | 401，生成调用为零 |
| 请求体超过实际字节预算 | 413，停止读取，不进入生成 |
| 白名单排除目标模型 | 无可用账号，不借用其他供应商凭据 |
| 上游明确限流且有其他候选 | 有界切换，最多三个候选 |
| 上游响应在网络中丢失 | 返回错误，不重新生成 |
| 请求含不能表达的协议约束 | 在生成前拒绝，不静默降级 |

```sh
node --test tests/*.test.mjs
```

这些断言可在模拟上游中检查交接与拒绝分支，实际执行记录见[同步记录](../change-log.md)。真实账号权限、云端持久化、模型质量和计费不由本例证明。理解流程后，用[代码地图找到下一次修改和对应测试](../code-map.md)。

证据状态：除特别标注外，本页基于当前源码已确认。
