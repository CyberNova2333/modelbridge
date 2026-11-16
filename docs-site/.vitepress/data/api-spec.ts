import type { ApiCatalogSpec } from './api-types'

export const apiSpecZh: ApiCatalogSpec = {
  project: 'ModelBridge 模桥 · 多协议网关 API 参考',
  subtitle:
    '涵盖 OpenAI / Anthropic / Gemini 客户端推理入口、管理面板 /api/*、自建 Node.js 24 + SQLite 状态协议 /_modelbridge/state，以及四态密钥与平台预算约束。',
  environments: [
    { label: '边缘网关生产地址', value: 'https://gateway.example.com' },
    { label: '自建 SQLite 状态端', value: 'http://127.0.0.1:8788' },
  ],
  searchPlaceholder: '搜索 /v1/messages、upstream: 路由、:countTokens 或预算限制…',
  emptyText: '没有找到匹配的网关端点或状态接口。',
  labels: {
    allGroups: '全部',
    canDo: '✅ 能做到',
    cannotDo: '⛔ 明确限制 / 拒绝条件',
    params: '请求参数、鉴权域与大小上限',
    paramName: '字段 / 路由段',
    paramLocation: '位置',
    paramType: '类型',
    paramRequired: '要求',
    paramDesc: '说明与平台限制',
    responses: '响应状态与 semantic pre-flight',
    examples: '标准调用示例',
    responseSample: '标准响应 / 回放结构示例',
    copy: '复制',
    copied: '已复制',
    noParams: '无需额外请求参数。',
    required: '必填',
    optional: '可选',
    deepDocs: '查看多协议安全契约',
    totalItems: '组端点',
    envLabel: '入口视图切换',
    mobilePicker: '切换接口端点',
    defaultLabel: '默认',
    plainIndexToggle: '纯文本检索与打印索引（Ctrl+K 站内搜索定位）',
  },
  groups: [
    { id: 'client-api', title: '客户端多协议入口' },
    { id: 'admin-state', title: '管理面板与状态 RPC' },
  ],
  items: [
    {
      id: 'openai-ingress',
      group: 'client-api',
      kind: 'POST',
      title: 'OpenAI 兼容多端点 (chat / completions / embeddings / models)',
      signature: 'POST /v1/chat/completions · /v1/completions · /v1/embeddings · GET /v1/models',
      auth: 'Authorization: Bearer <client-api-key>',
      stability: '核心客户端入口',
      summary:
        '接收标准 OpenAI 协议请求，依「upstream:<账号ID>:<模型> > @cf/ 前缀 > 自定义 modelMap > 65 条预设别名」精确确定路由，仅在明确 401/403/404/429 时最多尝试 3 个候选账号。',
      relatedLink: '/docs/contracts',
      relatedLabel: '查看四态密钥与路由优先级',
      capabilities: [
        '跨供应商转换完整保留工具调用、strict 与签名思考回放元数据（gemini_parts / anthropic_content）',
        '按平台注入预算上限：Cloudflare 16 MiB、EdgeOne Makers 1 MiB、阿里云 ESA 16 MiB / 4 次出站 fetch / 9s 首包 / 115s 总时长',
      ],
      limitations: [
        '明确不实现 OpenAI /v1/responses、完整图像生成/编辑或音频 TTS/STT 接口',
        'modelMap 不是访问控制白名单（限制可用模型须配置账号级 models 字段）；超时与 5xx 绝不自动切换重试防重复计费',
      ],
      params: [
        { name: 'Authorization', location: 'header', type: 'Bearer <client-api-key>', required: true, description: '实例调用密钥（无 /api/* 管理权限，受 enabled 状态实时开关控制）。' },
        { name: 'model', location: 'body', type: 'string', required: true, description: '支持模型名、@cf/... 或 upstream:<accountId>:<model> 精准定向上游。' },
      ],
      responses: [
        {
          status: '200 OK',
          tone: 'ok',
          summary: '返回标准 OpenAI ChatCompletion / SSE stream',
          example: `{
  "id": "chatcmpl-mb-...",
  "object": "chat.completion",
  "model": "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  "choices": [{ "index": 0, "message": { "role": "assistant", "content": "Ready." } }]
}`,
        },
        { status: '400 / 401 / 413 / 502', tone: 'err', summary: 'EdgeOne Makers 超 1 MiB、思考回放校验失败或上游明确报错' },
      ],
      examples: [
        {
          label: 'curl (指定 upstream: 路由)',
          lang: 'sh',
          code: `curl -sS -X POST "{{BASE_URL}}/v1/chat/completions" \\
  -H "Authorization: Bearer <client-api-key>" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"upstream:acc_01:gemini-2.5-flash","messages":[{"role":"user","content":"Hello"}]}'`,
        },
      ],
    },
    {
      id: 'anthropic-messages',
      group: 'client-api',
      kind: 'POST',
      title: 'Anthropic Messages 协议适配与严格预检',
      signature: 'POST /v1/messages',
      auth: 'x-api-key 或 Authorization: Bearer',
      stability: '跨协议语义守护',
      summary:
        '完整兼容 Anthropic Messages 与工具调用 SSE delta；在转换给非 Anthropic 上游前先运行严格语义校验，遇到目标上游不支持的约束直接返回 400。',
      relatedLink: '/docs/contracts',
      relatedLabel: '查看 convertAnthropicToOpenAI 校验规则',
      capabilities: [
        '执行 rejectAnthropicProviderTools 与 validateToolStrictness，无法跨协议表达的 thinking/output_config/output_format 拒绝假装成功',
        '支持助手消息块 validateReplayMetadata 精确一致性比对（防止伪造思考回放元数据）',
      ],
      limitations: [
        '禁止在无法忠实映射的工具声明上静默丢弃字段后调用上游',
        '单次请求受当前运行边缘平台体积预算限制（如 Makers 上限 1 MiB）',
      ],
      params: [
        { name: 'x-api-key', location: 'header', type: 'string', required: true, description: '支持 x-api-key 或 Bearer client-api-key 认证。' },
        { name: 'model / messages / max_tokens', location: 'body', type: 'Anthropic Messages', required: true, description: 'Anthropic 标准参数。' },
      ],
      responses: [
        { status: '200 OK', tone: 'ok', summary: '返回 Anthropic message JSON 或增量 SSE 事件流' },
        { status: '400 Bad Request', tone: 'err', summary: '不兼容协议参数或工具严格度校验未通过（pre-flight 拦截）' },
      ],
      examples: [
        {
          label: 'curl',
          lang: 'sh',
          code: `curl -sS -X POST "{{BASE_URL}}/v1/messages" \\
  -H "x-api-key: <client-api-key>" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"claude-sonnet-4-5","max_tokens":256,"messages":[{"role":"user","content":"Ping"}]}'`,
        },
      ],
    },
    {
      id: 'gemini-ingress',
      group: 'client-api',
      kind: 'POST',
      title: 'Gemini Native 格式适配 (generate / embed)',
      signature: 'POST /v1beta/models/<id>:* · /v1/models/<id>:*',
      auth: 'x-goog-api-key 或 Bearer（生产优先请求头）',
      stability: 'Gemini 兼容端点',
      summary:
        '支持 :generateContent、:streamGenerateContent、:embedContent 与 :batchEmbedContents；统一脱离查询串并经 validateReplayMetadata 校验回放签名。',
      relatedLink: '/docs/contracts',
      relatedLabel: '查看 Gemini 动作列表与限额',
      capabilities: ['在 wrangler.toml 开启 observability.redact_query_string = true，防止查询串密钥进日志'],
      limitations: [
        ':countTokens 明确返回 HTTP 501，不提供跨供应商精确 token 计数',
      ],
      params: [
        { name: 'x-goog-api-key', location: 'header', type: 'string', required: true, description: 'Gemini 风格认证请求头。' },
      ],
      responses: [
        { status: '200 OK', tone: 'ok', summary: '标准 Gemini GenerateContentResponse / SSE 流' },
        { status: '501 Not Implemented (:countTokens)', tone: 'warn', summary: '显式拒绝跨供应商估算请求' },
      ],
      examples: [
        {
          label: 'curl (:generateContent)',
          lang: 'sh',
          code: `curl -sS -X POST "{{BASE_URL}}/v1beta/models/gemini-2.5-flash:generateContent" \\
  -H "x-goog-api-key: <client-api-key>" \\
  -H "Content-Type: application/json" \\
  -d '{"contents":[{"role":"user","parts":[{"text":"Ping"}]}]}'`,
        },
      ],
    },
    {
      id: 'admin-api-panel',
      group: 'admin-state',
      kind: 'POST',
      title: '管理控制台与鉴权 API (/admin · /api/*)',
      signature: '/api/auth/* · /api/accounts · /api/keys · /api/settings · /api/usage/*',
      auth: 'ADMIN_PASSWORD 签发 24h 管理员会话（不可用于推理）',
      stability: '网关治理接口',
      summary:
        '提供可视化 /admin 登录锁定（10 次失败锁 15 分钟）、上游账号连通测试、客户 apiKeys 启停及站点设置（单次管理 JSON 上限 1 MiB / 登录 16 KiB）。',
      relatedLink: '/docs/contracts',
      relatedLabel: '查看 validateProviderBaseUrl 安全规则',
      capabilities: [
        '上游账号密钥在列表响应脱敏且从 upstream 错误文本剥离；修改账号 provider 强制重输凭据',
        'validateProviderBaseUrl 强制公网 https://（仅允许 localhost/127.0.0.1/[::1] 回环调试），拒绝内网 IP 段 SSRF',
      ],
      limitations: [
        '65 条 cloudflare-model-map.json 与控制台 10,000 Neurons 计数器仅为 5 分钟缓存发现展示，非强制服务端扣费拦截器',
        'ADMIN_PASSWORD 绝不授权任何 /v1/* 推理调用；apiKeys 绝不可访问 /api/*',
      ],
      params: [
        { name: 'baseUrl', location: 'body', type: 'public HTTPS URL', required: false, description: '禁止 0.0.0.0、10.*、169.254.*、192.168.*、172.16.0.0/12、fc/fd/fe80+ 及带凭据或查询串的 URL。' },
      ],
      responses: [
        { status: '200 OK', tone: 'ok', summary: '返回脱敏账号列表、密钥清单或探测状态' },
        { status: '429 Lockout / 400 SSRF Guard', tone: 'err', summary: '连续输错管理员密码 10 次锁定 15 分钟，或拦截私网 baseUrl' },
      ],
      examples: [
        {
          label: '登录并读取摘要',
          lang: 'sh',
          code: `curl -sS "{{BASE_URL}}/api/auth/status"`,
        },
      ],
    },
    {
      id: 'state-rpc-sqlite',
      group: 'admin-state',
      kind: 'POST',
      title: '自建 Node 24 SQLite 状态服务 RPC',
      signature: 'POST /_modelbridge/state',
      auth: 'MODELBRIDGE_STATE_TOKEN (32..512 字符) + MODELBRIDGE_STATE_ORIGINS',
      stability: '单权威事务存储',
      summary:
        '以 Node.js 24 内置 SQLite（WAL + BEGIN IMMEDIATE + synchronous=FULL，APPLICATION_ID=0x4d425331）或兼容 Cloudflare AppConfigStore DO 运行配置与配额状态，供多端无状态边缘网关共享。',
      relatedLink: '/docs/',
      relatedLabel: '查看自建状态与 Caddy 部署要求',
      capabilities: [
        '使 Cloudflare、EdgeOne Makers、阿里云 ESA 共享同一配置权威；状态请求上限 2 MiB、响应上限 16 MiB',
      ],
      limitations: [
        '单一部署严格单一权威：不在自建 SQLite 与 DO 之间做双写或静默运行降级；Caddy 反代须保持 protocols h1 与 lb_retries 0',
      ],
      params: [
        { name: 'Authorization / Origin', location: 'header', type: 'STATE_TOKEN / Origin', required: true, description: '校验 32–512 ASCII 非空白服务间令牌及精确配置网关 Origin 白名单。' },
      ],
      responses: [
        { status: '200 OK', tone: 'ok', summary: '事务读写提交并同步 WAL 最新配置快照' },
      ],
      examples: [
        {
          label: '本地启动自建状态服务',
          lang: 'sh',
          code: `MODELBRIDGE_STATE_TOKEN="$(openssl rand -hex 32)" \\
DB_PATH=./data/modelbridge.sqlite \\
pnpm run start:state`,
        },
      ],
    },
  ],
}

export const apiSpecEn: ApiCatalogSpec = {
  project: 'ModelBridge · Multi-Protocol API Reference',
  subtitle:
    'Interactive specification covering OpenAI, Anthropic, and Gemini client ingress, /api/* admin controls, Node.js 24 SQLite /_modelbridge/state RPC, and platform budgets.',
  environments: [
    { label: 'Edge Gateway URL', value: 'https://gateway.example.com' },
    { label: 'Self-Hosted SQLite State', value: 'http://127.0.0.1:8788' },
  ],
  searchPlaceholder: 'Filter /v1/messages, upstream: routing, :countTokens, limits…',
  emptyText: 'No matching gateway endpoint or state route found.',
  labels: {
    allGroups: 'All',
    canDo: '✅ Capabilities',
    cannotDo: '⛔ Explicit Limits / Rejections',
    params: 'Parameters, Credentials & Budgets',
    paramName: 'Field / Segment',
    paramLocation: 'Location',
    paramType: 'Type',
    paramRequired: 'Rule',
    paramDesc: 'Description & Platform Caps',
    responses: 'Status & Semantic Pre-Flight',
    examples: 'Standard Invocation',
    responseSample: 'Sample Response / Payload',
    copy: 'Copy',
    copied: 'Copied',
    noParams: 'No additional request parameters.',
    required: 'Required',
    optional: 'Optional',
    deepDocs: 'Open security & routing contracts',
    totalItems: 'endpoint groups',
    envLabel: 'Ingress Target',
    mobilePicker: 'Select Endpoint',
    defaultLabel: 'Default',
    plainIndexToggle: 'Plaintext Search & Print Index (Ctrl+K Target)',
  },
  groups: [
    { id: 'client-api', title: 'Multi-Protocol Client Ingress' },
    { id: 'admin-state', title: 'Admin UI & State RPC' },
  ],
  items: [
    {
      id: 'openai-ingress',
      group: 'client-api',
      kind: 'POST',
      title: 'OpenAI Ingress Endpoints',
      signature: 'POST /v1/chat/completions · /v1/completions · /v1/embeddings · GET /v1/models',
      auth: 'Authorization: Bearer <client-api-key>',
      stability: 'Core Client Ingress',
      summary:
        'Resolves routes across upstream:<id>:<model>, @cf/ prefixes, custom modelMap, and 65 preset aliases, failing over across at most 3 accounts strictly on 401/403/404/429.',
      relatedLink: '/en/docs/contracts',
      relatedLabel: 'View routing precedence & credential domains',
      capabilities: [
        'Preserves tool calling, strict schemas, and signed thinking replay metadata across providers',
        'Enforces per-platform budgets: Cloudflare 16 MiB, Makers 1 MiB, ESA 16 MiB / 4 fetches / 9s TTFB / 115s total',
      ],
      limitations: [
        'Does not implement /v1/responses, image generation/editing, or audio TTS/STT',
        'modelMap is not an access-control allowlist; timeouts and 5xx errors never trigger duplicate retries',
      ],
      params: [
        { name: 'Authorization / model', location: 'header', type: 'Bearer / string', required: true, description: 'Client key and model slug (supports upstream:<accountId>:<model>).' },
      ],
      responses: [{ status: '200 OK', tone: 'ok', summary: 'Standard OpenAI response or SSE chunks' }],
      examples: [
        {
          label: 'curl',
          lang: 'sh',
          code: `curl -sS -X POST "{{BASE_URL}}/v1/chat/completions" -H "Authorization: Bearer <client-api-key>" -H "Content-Type: application/json" -d '{"model":"upstream:acc_01:gemini-2.5-flash","messages":[{"role":"user","content":"Hello"}]}'`,
        },
      ],
    },
    {
      id: 'anthropic-messages',
      group: 'client-api',
      kind: 'POST',
      title: 'Anthropic Messages with Strict Pre-Flight Checks',
      signature: 'POST /v1/messages',
      auth: 'x-api-key or Authorization: Bearer',
      stability: 'Semantic Pre-Flight',
      summary:
        'Translates Anthropic messages and SSE deltas while rejecting unrepresentable tool strictness, thinking configs, or replay metadata mismatches with 400 pre-flight.',
      relatedLink: '/en/docs/contracts',
      relatedLabel: 'Inspect strict translation guards',
      capabilities: ['Validates assistant replay metadata integrity and rejects unrepresentable features early'],
      limitations: ['Never silently drops required semantic constraints to fake upstream compatibility'],
      params: [{ name: 'x-api-key / model / messages / max_tokens', location: 'body', type: 'Anthropic Messages', required: true, description: 'Standard Anthropic payload.' }],
      responses: [{ status: '200 OK / 400 Pre-flight Reject', tone: 'ok', summary: 'SSE message stream or explicit 400 error' }],
      examples: [{ label: 'curl', lang: 'sh', code: `curl -sS -X POST "{{BASE_URL}}/v1/messages" -H "x-api-key: <client-api-key>" -H "Content-Type: application/json" -d '{"model":"claude-sonnet-4-5","max_tokens":256,"messages":[{"role":"user","content":"Ping"}]}'` }],
    },
    {
      id: 'gemini-ingress',
      group: 'client-api',
      kind: 'POST',
      title: 'Gemini Native Endpoints',
      signature: 'POST /v1beta/models/<id>:* · /v1/models/<id>:*',
      auth: 'x-goog-api-key or Bearer',
      stability: 'Gemini Ingress',
      summary: 'Supports :generateContent, :streamGenerateContent, :embedContent, and :batchEmbedContents under signed replay checks and log query redaction.',
      relatedLink: '/en/docs/contracts',
      relatedLabel: 'Review Gemini endpoints',
      capabilities: ['Supports streaming generation and embedding endpoints without query secret logging'],
      limitations: [':countTokens explicitly returns 501 Not Implemented'],
      params: [{ name: 'x-goog-api-key / contents', location: 'header', type: 'string / Gemini payload', required: true, description: 'Preferred header auth and Gemini body.' }],
      responses: [
        { status: '200 OK', tone: 'ok', summary: 'Gemini JSON or SSE response' },
        { status: '501 Not Implemented (:countTokens)', tone: 'warn', summary: 'Cross-provider token counting intentionally omitted' },
      ],
      examples: [{ label: 'curl', lang: 'sh', code: `curl -sS -X POST "{{BASE_URL}}/v1beta/models/gemini-2.5-flash:generateContent" -H "x-goog-api-key: <client-api-key>" -H "Content-Type: application/json" -d '{"contents":[{"role":"user","parts":[{"text":"Ping"}]}]}'` }],
    },
    {
      id: 'admin-api-panel',
      group: 'admin-state',
      kind: 'POST',
      title: 'Admin Console & Management API (/api/*)',
      signature: '/api/auth/* · /api/accounts · /api/keys · /api/settings · /api/usage/*',
      auth: 'ADMIN_PASSWORD (24h Session, Non-Inference)',
      stability: 'Control Plane',
      summary: 'Manages accounts, SSRF-checked custom baseUrls, key flags, and admin sessions (16 KiB login / 1 MiB admin JSON limits; 10-fail 15-min lockout).',
      relatedLink: '/en/docs/contracts',
      relatedLabel: 'Inspect validateProviderBaseUrl rules',
      capabilities: ['Masks upstream secrets in listings and enforces public HTTPS SSRF rules on custom endpoints'],
      limitations: ['10,000 Neurons counter & 65 preset aliases are cached discovery UI helpers, not billing blockers'],
      params: [{ name: 'baseUrl', location: 'body', type: 'public HTTPS URL', required: false, description: 'Blocks private IPv4/IPv6 ranges, .local/.internal, userinfo, queries, and fragments.' }],
      responses: [{ status: '200 OK / 429 Lockout', tone: 'ok', summary: 'Masked accounts or explicit lockout error' }],
      examples: [{ label: 'curl', lang: 'sh', code: `curl -sS "{{BASE_URL}}/api/auth/status"` }],
    },
    {
      id: 'state-rpc-sqlite',
      group: 'admin-state',
      kind: 'POST',
      title: 'Self-Hosted Node 24 SQLite State RPC',
      signature: 'POST /_modelbridge/state',
      auth: 'MODELBRIDGE_STATE_TOKEN (32..512 chars) + MODELBRIDGE_STATE_ORIGINS',
      stability: 'Single State Authority',
      summary: 'WAL SQLite (BEGIN IMMEDIATE, APPLICATION_ID 0x4d425331) or Cloudflare AppConfigStore DO backing stateless edge gateways.',
      relatedLink: '/en/docs/',
      relatedLabel: 'View self-hosted deployment',
      capabilities: ['Unifies state across Cloudflare, Makers, and ESA with 2 MiB request / 16 MiB response caps'],
      limitations: ['Strictly single-authority (no dual-write between SQLite and DO); reverse proxies must keep protocols h1 & lb_retries 0'],
      params: [{ name: 'Authorization / Origin', location: 'header', type: 'STATE_TOKEN / Origin', required: true, description: 'Shared RPC secret and allowlisted gateway origins.' }],
      responses: [{ status: '200 OK', tone: 'ok', summary: 'Transactional WAL state snapshot' }],
      examples: [{ label: 'Start Local State', lang: 'sh', code: `MODELBRIDGE_STATE_TOKEN="$(openssl rand -hex 32)" DB_PATH=./data/modelbridge.sqlite pnpm run start:state` }],
    },
  ],
}
