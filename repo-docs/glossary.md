# 模桥术语表

| 术语 | 项目里的意思 | 延伸阅读 |
| --- | --- | --- |
| 模桥（ModelBridge） | 网页与仓库的项目品牌；不同于部署时设置的 Worker 服务名 | [品牌与部署名称](code-map.md#品牌与部署名称) |
| 管理员 Secret | 部署环境中的 `ADMIN_PASSWORD`，用于登录换取后台会话 | [访问权限与配置](modules/access-and-config.md) |
| 管理员会话 | 服务端可撤销、限定来源和有效期的登录状态；不是密码哈希或调用密钥 | [访问权限与配置](modules/access-and-config.md) |
| 调用密钥（API Key） | 网关签发给客户端使用的模型接口凭据；不直接发送给供应商 | [访问权限与配置](modules/access-and-config.md) |
| 上游凭据 | 供应商 API Key、Cloudflare Token 或 OAuth 刷新令牌，由被选中账号使用 | [访问权限与配置](modules/access-and-config.md) |
| 配置权威 | Durable Object 中的当前配置；旧 KV 只在配置首次缺失时参与迁移 | [配置持久化](modules/access-and-config.md) |
| 账号版本比较（CAS） | 异步验证之后，只有账号仍与验证前一致才保存；冲突返回 409 | [配置持久化](modules/access-and-config.md) |
| 模型别名与目标 | 别名是客户端名称，目标决定供应商、实际模型或指定账号；映射不是封闭名称白名单。指南中的 `my-chat`、`chat-small` 是示例别名，`example-chat`、`provider-model` 是示例上游模型标识 | [模型路由](modules/routing-and-protocols.md) |
| 账号模型列表 | `models` 非空时限制该账号可承接的实际模型；空列表表示不限制 | [模型路由](modules/routing-and-protocols.md) |
| 原生协议与跨协议转换 | 前者保留供应商原有消息/事件形状，后者要求内容和约束能在另一协议中表达 | [协议边界](modules/routing-and-protocols.md) |
| 上游调用器 | `callOpenAICompatibleAPI` 负责按已解析目标选择普通上游并处理转换；函数名不表示只接入 OpenAI | [代码地图](code-map.md) |
| 回放元数据 | 保存原生历史、工具和签名的扩展内容，必须与可见文本、参数及结果一致 | [历史一致性](modules/routing-and-protocols.md) |
| 服务端发送事件（SSE） | 逐段传送结果或错误的事件流；HTTP 200 不代表后续全部成功 | [结束与错误语义](modules/routing-and-protocols.md) |
| 明确拒绝与不确定结果 | 前者允许在预算内换账号，后者可能已生成或计费，因此不再补发生成 | [重试边界](modules/upstream-and-quota.md) |
| 刷新合并（singleflight） | 并发请求共用正在进行的刷新；OAuth 在单 Worker 实例内，用量刷新在配置对象内 | [刷新与缓存](modules/upstream-and-quota.md) |
| 环境账号集合 | `ANTIGRAVITY_ACCOUNTS` Secret 中的 Antigravity JSON 账号数组；与后台账号共同参与选择，但不导入后台编辑列表 | [环境账号格式](modules/upstream-and-quota.md) |
| 免费额度与硬预算 | 前者是映射及面板的参考口径，后者需强制阻止超支；当前网关没有将两者等同 | [配额边界](modules/upstream-and-quota.md) |
| 模拟上游验证 | 本地测试控制响应、存储与失败；不证明真实账号权限、部署状态或实际计费停止 | [验证记录](change-log.md) |

证据状态：除特别标注外，本页基于当前源码已确认。
