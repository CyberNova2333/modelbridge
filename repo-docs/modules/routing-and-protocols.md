# 模型路由与协议边界

客户端用哪个协议发请求，与网关向哪个供应商调用，是两个独立选择。一个 OpenAI 格式的请求可以选中 Gemini 账号；但客户端给出的工具、输出格式和历史签名仍需有可表达的去处，不能为了“成功返回”而丢弃约束。

## 一个别名怎样找到账号

假设管理员保存以下映射，并启用一个 OpenAI 类型账号，其模型列表包含 `provider-model`：

```json
{
  "chat-small": "openai:provider-model"
}
```

客户端请求 `chat-small` 时，网关先把别名解析为 OpenAI 目标，再筛选类型匹配、状态为 `active` 且允许 `provider-model` 的账号。没有匹配账号返回 503，不临时借用其他供应商凭据；成功结果中的客户端模型名保持为 `chat-small`。把账号模型列表改成只有 `other-model`，会使这个请求失去候选账号。

| 目标写法 | 选择含义 |
| --- | --- |
| `@cf/组织/模型` | Cloudflare 模型标识 |
| `openai:模型`、`anthropic:模型`、`gemini:模型` | 对应供应商类型下的候选账号 |
| `upstream:账号ID:模型` | 指定管理配置中的 Cloudflare、OpenAI、Anthropic 或 Gemini 账号；不用于 Antigravity |
| `antigravity:模型`、`@antigravity/模型` | Antigravity OAuth/Cloud Code 路由 |

映射是名称解析规则，并不是封闭的调用名称白名单：显式目标前缀也可直接请求；已启用通用账号声明的模型可使用短名称，特定 Claude/Gemini 名称还存在 Antigravity 解析路径。账号的 `models` 非空时限制具体上游模型；为空时不限制该账号的模型。相同短名称跨供应商出现时，建议用显式前缀或映射消除选择歧义。

模型目录展示配置中的别名和部分已声明模型，不逐个查询供应商权限，也不保证目录中的每个模型都适合聊天。默认映射还包含向量、图像或语音等模型；当前实现了哪些操作应以接口能力为准，不能从“在目录里”推导出存在对应生成端点。

目录按映射、启用账号声明和 Antigravity 条目的顺序合并，用集合去重；同名条目保留最先出现的归属信息。多个账号声明同一模型不会重复展示，禁用账号不补充条目。去重开销随条目数线性增长；目录仍从本次权威配置生成，不使用会延长已撤销权限的跨请求缓存。

[名称解析与账号筛选](../../_worker.js)可定位 `resolveModelName / parseUpstreamTarget / getMatchingUpstreamAccounts / handleV1Proxy`；[通用上游断言](../../tests/universal-upstreams.test.mjs)检查凭据类型与账号模型限制。

## 客户端接口和上游能力

| 客户端入口 | 当前作用与主要限制 |
| --- | --- |
| `GET /v1/models` | OpenAI 形状的模型目录 |
| `POST /v1/chat/completions` | 普通或流式聊天；按目标进行协议转换 |
| `POST /v1/completions` | 旧文本补全接口，接受字符串 `prompt` |
| `POST /v1/messages` | Anthropic Messages；原生 Anthropic 路由保留其消息与流事件语义 |
| `POST /v1/embeddings` | 向量接口；仅支持 Cloudflare、OpenAI 与 Gemini 上游，目标能力仍受模型限制 |
| `/v1beta/models` 或 `/v1/models/{model}` 系列 | Gemini 模型目录、单项查询、`generateContent`、`streamGenerateContent`、`embedContent`、`batchEmbedContents`；`countTokens` 返回 501 |

Gemini 路径的操作通过 `:{action}` 后缀选择。流式生成支持 SSE 或 JSON 数组形式；具体可复制请求、调用密钥请求头及部署步骤见[根 README](../../README.md)。当前没有 `/v1/responses` 实现，模型目录也不是所有供应商 API 的透传入口。

## 不能实现的约束在调用前拒绝

例如 Gemini 请求同时给出 `max_output_tokens: 1` 和 `maxOutputTokens: 2`，别名冲突会返回 400；相同值可归一化。归一化只进入协议配置和 Schema 节点，不重写 Schema 中 `default`、`enum` 或示例对象的字面量。

跨协议时，以下情况会在发起生成前拒绝；保留原生协议不等于网关替供应商保证请求合法：

| 约束或内容 | 边界 |
| --- | --- |
| Gemini 枚举输出、安全设置、缓存上下文、续传或其他不能表达的配置 | 不能转成目标协议时返回 400；原生 Gemini 路由可保留相应字段 |
| 工具严格模式 `strict: true` | OpenAI 与 Anthropic 之间保留；Cloudflare、Gemini 和 Antigravity 适配器不能保证时返回 400 |
| Anthropic 内置工具，如服务端搜索 | 原生 Anthropic 保留工具设置、结果与引用；跨供应商不会冒充普通函数 |
| Anthropic 目标无法表达的采样或输出要求 | 例如 `seed`、对数概率请求、部分结构化输出形状会明确拒绝 |
| Gemini 向量任务或截断选项 | 只在能表达的 Gemini 上游使用；其他上游不静默丢弃。批量请求的归一化配置必须一致 |

向量请求兼容新 `embedContentConfig` 与旧顶层配置；支持的选项是 `taskType`、`title`、`outputDimensionality`、`autoTruncate`、`documentOcr`、`audioTrackExtraction`，及实现中相应的 snake_case 别名。重复配置冲突、类型错误或标题缺少文档检索任务会返回 400。维度也可使用 `dimensions`；这不代表所有上游模型都支持降维。

[约束与别名实现](../../_worker.js)可定位 `normalizeGeminiRequestFields / rejectUnsupportedGeminiSafetySettings / validateToolStrictness / rejectAnthropicProviderTools / normalizeEmbeddingOptions`；[协议边界回归](../../tests/review-protocol-round2.test.mjs)和[向量配置回归](../../tests/review-account-embedding-round2.test.mjs)检查拒绝发生在上游工作之前。

## 历史信息必须与可见结果一致

工具调用不仅包含函数名，还包含调用标识、参数、结果以及可能的思考签名。部分协议用额外历史字段保存这些信息，客户端多轮回放时需要原样保留 `gemini_parts`、`anthropic_content`、`gemini_thought_signature` 等适配器产生的字段；随意丢弃会导致原生上游不能接续。

这些字段也不能成为第二套隐藏消息。OpenAI 上游在响应顶层、候选项及消息/增量中加入的 `gemini_*`、`anthropic_*` 扩展会被移除；客户端回放中的可见文本、工具参数、工具结果与扩展内容不一致时返回 400。例如可见回复为 `visible`、附带回放文本却是 `hidden`，请求不能进入 Gemini 上游。原生签名按不透明数据保留，网关检查结构与一致性，不在本地证明供应商签名的密码学有效性。

错误帧和 SSE 注释等传输元信息会脱敏；正常生成文本及签名不会通过全局字符串替换改写。该边界避免协议扩展悄悄增加历史指令，不验证模型回答的事实正确性，也不能阻止已配置供应商在正常可见内容中输出任意文本。

[回放检查与输出清理](../../_worker.js)可定位 `validateReplayMetadata / sanitizeOpenAIUpstreamResponse / sanitizeUpstreamErrorStream`；[历史注入回归](../../tests/protocol-security-regressions.test.mjs)、[签名回放断言](../../tests/anthropic-replay.test.mjs)及[元信息脱敏断言](../../tests/sse-metadata-security.test.mjs)分别检查这些边界。

## 错误不能伪装成正常结束

Gemini 的异常或未知终止状态不会被一律改成 `STOP`：如 `MALFORMED_FUNCTION_CALL` 在普通响应中产生 502，在流中产生可识别错误并终止。Anthropic 上下文窗口耗尽转换为截断；不能表达的终止原因报错。OpenAI 的内容过滤和拒绝文本转换到 Anthropic 时保留拒绝语义。原生 Anthropic 路由保留自身终止信息，不能用跨协议规则删掉原生字段。

流中错误可能出现在响应头和部分文本已经发送之后，因此客户端必须检查流事件中的错误，不能只检查 HTTP 200。失败后是否允许换账号由[上游请求与配额](upstream-and-quota.md)中的结果确定性规则决定。

[终止语义断言](../../tests/review-protocol-regressions.test.mjs)检查普通响应与流式结果；修改入口见[代码地图](../code-map.md)。

证据状态：除特别标注外，本页基于当前源码已确认。
