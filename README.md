# WorkersAI2API

把 Cloudflare Workers AI 变成 OpenAI 兼容接口，自带可视化管理面板。部署在 Cloudflare Workers / Pages 上。

## 🚀 它能干什么

- OpenAI 兼容：把 CF 免费 AI 模型转成 `/v1/chat/completions` 格式，Cursor、LobeChat、NextChat 等客户端直接接入
- 多模态支持：除对话外还支持 `/v1/embeddings` 和 Anthropic `/v1/messages`
- 负载均衡：绑定多个 CF 账号，请求随机分配，单个账号额度用完或故障自动切换下一个
- 管理面板：可视化查看用量、管理账号/密钥、自定义模型映射
- 灵活鉴权：配置 API Key 即开启鉴权，不配就是公开的

## ⚡ 快速部署

### 📦 Pages 部署（推荐）

1. 把 `_worker.js` 拖到 Cloudflare Pages 上传
2. 绑定 KV：变量名填 `KV`，选一个你创建的 KV 命名空间
3. 添加环境变量 `ADMIN_PASSWORD`（必设，否则服务拒绝访问）
4. 重新部署让绑定生效

### 🔧 Workers 部署

```bash
npm install -g wrangler
wrangler login
wrangler deploy
```

`wrangler.toml` 里绑定 KV：
```toml
[[kv_namespaces]]
binding = "KV"
id = "你的KV命名空间ID"
```

## 📋 使用步骤

1. 打开部署地址，输入管理员密码登录
2. 在「账号管理」添加 CF 账号（Account ID + API Token）。Token 在 [Cloudflare Dashboard](https://dash.cloudflare.com/) → My Profile → API Tokens → Workers AI 模板生成
3. 在「API 密钥」生成调用密钥（`sk-wa-xxx`）
4. 客户端配置 Base URL 为 `https://你的域名.pages.dev/v1`，填入密钥即可

## 🔑 模型映射

内置了这些模型（可在面板自定义）：

| 请求名 | CF 实际模型 |
|--------|------------|
| `glm-5.2` | `@cf/zai-org/glm-5.2` |
| `kimi-k2.7-code` | `@cf/moonshotai/kimi-k2.7-code` |
| `gemma-4-26b-a4b-it` | `@cf/google/gemma-4-26b-a4b-it` |
| `nemotron-3-120b-a12b` | `@cf/nvidia/nemotron-3-120b-a12b` |
| `gpt-oss-20b` | `@cf/openai/gpt-oss-20b` |
| `gpt-oss-120b` | `@cf/openai/gpt-oss-120b` |
| `bge-m3` | `@cf/baai/bge-m3` |

直接传 `@cf/xxx` 开头的模型名会跳过映射直接透传。
