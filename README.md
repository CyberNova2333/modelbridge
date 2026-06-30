# WorkersAI2API

WorkersAI2API 是一个将 Cloudflare Workers AI 整合并反向代理为 OpenAI 兼容接口格式（Chat Completions / Text Completions / Embeddings）的项目。

最终编译并部署在 Cloudflare Workers 或 Cloudflare Pages 中，并且提供一个美观、现代且功能完善的 Web 仪表盘控制面板。

## 主要特性

- 🌐 **OpenAI 兼容**：完全兼容 `/v1/chat/completions`, `/v1/completions` 和 `/v1/embeddings` 接口，可直接配置于 Cursor, NextChat, LobeChat, Obsidian-Copilot 等常用客户端。
- ⚖️ **负载均衡 (Load Balancing)**：支持绑定多个 Cloudflare 账号，请求时自动随机分配，实现负载均衡。
- 🛡️ **故障转移 (Failover)**：当某个 CF 账号因 10k 免费额度用尽 (Error 3036/4006)、频率超限 (429) 或凭证失效时，代理会自动顺延并尝试下一个账号，保证高可用性。
- 🔑 **API Key 鉴权**：支持配置独立的调用 API 密钥（以 `sk-wa-` 开头），若未配置密钥则默认公开不校验，满足不同场景需求。
- 📊 **可视化控制面板**：
  - **未登录状态**：展示所有账号今日用量汇总、免费限额进度和账号状态，保障数据隐私的同时又方便快速查看。
  - **已登录状态**：
    - 账号健康状态检测及用量单独进度条（今日已用 xxxx / 10,000 Neurons）。
    - 过去 7 天消耗趋势走势图（使用 Chart.js 绘制）。
    - 今日使用模型占比饼图。
    - Cloudflare 账号（Account ID + API Token）的新增、编辑、删除与即时连接性测试（利用 BGE 向量生成做轻量测试）。
    - 代理调用密钥管理（生成/删除/复制）。
    - 自定义模型映射（自由定义如 `gpt-4o` 转发到 CF 的哪个模型，也支持未映射模型直接通过 `@cf/` 开头透传）。

---

## 部署教程

### 方式一：Cloudflare Pages 部署 (推荐，最便捷)

1. 下载或克隆本项目。
2. 在 Cloudflare 控制面板中，导航至 **Workers & Pages** -> **Create** -> **Pages** -> **Upload assets**。
3. 给项目起个名字（例如 `workers-ai2api`）。
4. 将本仓库中的 `_worker.js` 文件放入一个新建文件夹（如 `dist`）中，然后将整个文件夹拖入上传区域上传。
5. 部署成功后，进入项目的 **Settings** -> **Functions** -> **KV namespace bindings**。
6. 点击 **Add binding**：
   - **Variable name** 必须填：`KV`
   - **KV namespace** 选择您新建的一个 KV 命名空间（如果没有，需先去左侧菜单 KV 处创建一个）。
7. （可选）在 **Settings** -> **Environment variables** 中添加 `ADMIN_PASSWORD` 变量作为管理员密码。如果不配置，可在页面首次加载时在前台配置，密码将安全保存在 KV 中。
8. 重新部署一次以使绑定生效。

### 方式二：Cloudflare Workers 部署 (Wrangler CLI)

1. 安装 Wrangler CLI：`npm install -g wrangler`
2. 登录您的 Cloudflare 账号：`wrangler login`
3. 复制项目中的 `wrangler.toml` 文件，并填入您的 KV Namespace ID：
   ```toml
   [[kv_namespaces]]
   binding = "KV"
   id = "您的生产环境KV命名空间ID"
   ```
4. 部署至 Cloudflare：`wrangler deploy`

---

## 控制面板初始化与登录

1. **设置环境变量**：在 Cloudflare Dashboard 中，为您的 Worker / Page 添加环境变量 `ADMIN_PASSWORD`，其值即为您的后台登录密码。如果未配置该变量，系统默认采用密码 `admin123` 登录（建议线上部署时务必设置自定义变量）。
2. **安全防暴力破解**：系统进行密码比对是在内存中高效进行，**完全不产生任何 KV 数据库读写开销**，大幅提高安全性的同时极大节省了免费 KV 配额，防止恶意暴力破解造成的高额 KV 读写计费。
3. 打开部署成功后的网页，在登录框中直接输入密码登录。
3. **添加 Cloudflare 账号**：
   - 登录后台，进入“账号管理”选项卡，点击“添加账号”。
   - 填写别名、**Account ID** 和 **API Token**。
   - **API Token 获取方式**：
     1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)。
     2. 导航至右上角 **My Profile** -> **API Tokens**。
     3. 点击 **Create Token** -> 选择 **Workers AI** 模板（或者自定义 Token，赋予 `Account -> Workers AI -> Edit` 权限）。
     4. 复制生成的 API Token。
   - 点击“测试连接”，若显示“连接成功”，则保存。
4. **生成 API Key**：
   - 进入“API 密钥”选项卡，点击“生成新密钥”，输入描述（例如：`Cursor使用`）。
   - 复制生成的 `sk-wa-xxxxxxxxxx` 密钥。

---

## 客户端配置示例

以各大常用客户端为例，配置接入此反代服务：

### 1. Cursor
- 进入 **Cursor Settings** -> **Models** -> **OpenAI API**。
- 将 Override OpenAI Base URL 设置为：`https://你的域名.pages.dev/v1`
- API Key 填写您在面板里生成的：`sk-wa-xxxxxx`
- 在下方的 Model 列表中，添加您想使用的模型（例如 `gpt-4o-mini`, `gpt-4` 等）。

### 2. NextChat (ChatGPT Next Web)
- 打开设置，在 **接口服务** 中选择 `OpenAI`。
- **接口地址 (Endpoint)** 填写：`https://你的域名.pages.dev` (注意有些客户端不要带 `/v1`)
- **API Key** 填写您在面板里生成的：`sk-wa-xxxxxx`
- **自定义模型** 填入您映射的模型。

---

## 模型映射说明

系统内置了以下默认的模型映射（左侧为客户端请求名，右侧为 Cloudflare 目标模型）：

| 客户端请求模型 (OpenAI 别名) | Cloudflare 目标模型路径 |
| :--- | :--- |
| `glm-5.2` | `@cf/zai-org/glm-5.2` |
| `glm-4.7-flash` | `@cf/zai-org/glm-4.7-flash` |
| `kimi-k2.7-code` | `@cf/moonshotai/kimi-k2.7-code` |
| `kimi-k2.6` | `@cf/moonshotai/kimi-k2.6` |
| `gemma-4-26b-a4b-it` | `@cf/google/gemma-4-26b-a4b-it` |
| `nemotron-3-120b-a12b` | `@cf/nvidia/nemotron-3-120b-a12b` |
| `gpt-oss-20b` | `@cf/openai/gpt-oss-20b` |
| `gpt-oss-120b` | `@cf/openai/gpt-oss-120b` |
| `embeddinggemma-300m` | `@cf/google/embeddinggemma-300m` |
| `qwen3-embedding-0.6b` | `@cf/qwen/qwen3-embedding-0.6b` |
| `bge-m3` | `@cf/baai/bge-m3` |

您可以在控制面板的 **“自定义模型映射”** 选项卡中，自由地覆盖或者添加新的模型映射（如将 `gpt-4o` 映射为 `@cf/zai-org/glm-5.2` 或 `Kimi K2.7` 等最新模型）。

如果请求的模型名称直接以 `@cf/` 开头，系统将**自动略过映射**直接透传请求，这允许您在无需更改映射配置的情况下，直接调用 Cloudflare 支持的任何模型。

---

## 许可证

本项目基于 MIT 许可证开源。