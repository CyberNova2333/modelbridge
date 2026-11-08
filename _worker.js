/**
 * 模桥 ModelBridge
 * 多供应商、多协议模型网关，带账号、调用密钥和模型映射管理。
 * 自包含的 Cloudflare 入口；其他平台通过 createGateway 注入状态与网络能力。
 */

// 网页品牌独立于部署服务名；不会自动读取 Wrangler 的 Worker 名称。
const PROJECT_DISPLAY_NAME = '模桥 ModelBridge';
// Standalone SVG matches assets/modelbridge-icon.svg; data URLs isolate its gradient IDs.
const PROJECT_ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><defs><linearGradient id="blue" x1="12" y1="8" x2="116" y2="128" gradientUnits="userSpaceOnUse"><stop stop-color="#3481ff"/><stop offset="1" stop-color="#1646b4"/></linearGradient></defs><rect width="128" height="128" rx="30" fill="url(#blue)"/><rect x="1" y="1" width="126" height="126" rx="29" fill="none" stroke="#fff" stroke-opacity=".16" stroke-width="2"/><g fill="none" stroke="#fff" stroke-linecap="round" stroke-linejoin="round"><path d="M35 91V43M93 91V43M35 71C47 43 81 43 93 71" stroke-width="8"/><path d="M50 54V91M78 54V91" stroke-width="4" stroke-opacity=".55"/><path d="M25 92H103" stroke-width="8"/></g><circle cx="25" cy="92" r="6" fill="#bce4ff"/><circle cx="103" cy="92" r="6" fill="#bce4ff"/><circle cx="25" cy="92" r="2" fill="#2563eb"/><circle cx="103" cy="92" r="2" fill="#2563eb"/></svg>';
const PROJECT_ICON_DATA_URI = 'data:image/svg+xml,' + encodeURIComponent(PROJECT_ICON_SVG);
const PROJECT_BRAND_CSS = `
.project-brand { display: inline-flex; align-items: center; gap: 11px; flex-shrink: 0; color: var(--text-main, #f0f6fc); text-decoration: none; }
.project-brand-icon { display: block; width: 36px; height: 36px; flex: 0 0 auto; border-radius: 6px; }
.project-brand-copy { display: flex; flex-direction: column; gap: 2px; white-space: nowrap; }
.project-brand-wordmark { font: 600 20px/1.15 -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif; letter-spacing: -.4px; }
.project-brand-wordmark span { color: #2f81f7; }
:root[data-theme="light"] .project-brand-wordmark span { color: #0969da; }
.project-brand-caption { font: 500 11px/1.25 -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif; letter-spacing: .4px; color: var(--text-muted, #8b949e); }
.project-brand:focus-visible { outline: 2px solid var(--accent-color, #2f81f7); outline-offset: 4px; border-radius: 6px; }
.logo-area .project-brand { gap: 10px; }
.logo-area .project-brand-icon { width: 32px; height: 32px; }
.logo-area .project-brand-wordmark { font-size: 18px; letter-spacing: -.3px; }
.logo-area .project-brand-caption { font-size: 11px; letter-spacing: .3px; }
@media(max-width:480px) {
 .site-header { gap: 12px; }
 .project-brand, .logo-area .project-brand { gap: 8px; }
 .project-brand-icon, .logo-area .project-brand-icon { width: 32px; height: 32px; }
 .project-brand-wordmark, .logo-area .project-brand-wordmark { font-size: 17px; letter-spacing: -.3px; }
 .project-brand-caption, .logo-area .project-brand-caption { font-size: 10px; letter-spacing: .3px; }
}

/* Tactile GitHub Primer v2 Buttons & Controls */
.btn, .floating-btn {
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.6), 0 1px 2px rgba(31, 35, 40, 0.06);
  transition: background-color 100ms ease, border-color 100ms ease, box-shadow 100ms ease, transform 80ms ease !important;
}
:root[data-theme="dark"] .btn, :root[data-theme="dark"] .floating-btn {
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08), 0 1px 2px rgba(1, 4, 9, 0.4);
}
.btn:hover:not(:disabled), .floating-btn:hover:not(:disabled) {
  transform: translateY(-0.5px);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.7), 0 2px 5px rgba(31, 35, 40, 0.1);
}
:root[data-theme="dark"] .btn:hover:not(:disabled), :root[data-theme="dark"] .floating-btn:hover:not(:disabled) {
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.14), 0 2px 6px rgba(1, 4, 9, 0.55);
}
.btn:active:not(:disabled), .floating-btn:active:not(:disabled) {
  transform: translateY(0.5px) scale(0.99);
  box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.18);
}
.btn-primary, .floating-btn.primary-action {
  background: linear-gradient(180deg, color-mix(in srgb, var(--primary-bg, #0969da) 88%, #ffffff 12%) 0%, var(--primary-bg, #0969da) 100%) !important;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.28), 0 1px 3px rgba(9, 105, 218, 0.24) !important;
  font-weight: 600;
}
.btn-primary:hover:not(:disabled), .floating-btn.primary-action:hover:not(:disabled) {
  background: linear-gradient(180deg, var(--primary-bg, #0969da) 0%, var(--primary-hover, #0860ca) 100%) !important;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.35), 0 3px 8px rgba(9, 105, 218, 0.32) !important;
  transform: translateY(-0.5px);
}
.btn-secondary {
  background: linear-gradient(180deg, var(--card-bg, #ffffff) 0%, var(--btn-secondary-bg, #f6f8fa) 100%);
}
:root[data-theme="dark"] .btn-secondary {
  background: linear-gradient(180deg, #21262d 0%, #161b22 100%);
}
html.dn-color-shift, html.dn-color-shift * {
  transition: background-color 0.42s ease, color 0.42s ease, border-color 0.42s ease !important;
}
`;

function projectBrandMarkup() {
	return `<a class="project-brand" href="/" aria-label="${PROJECT_DISPLAY_NAME} 首页"><img class="project-brand-icon" src="${PROJECT_ICON_DATA_URI}" width="42" height="42" alt=""><span class="project-brand-copy"><span class="project-brand-wordmark">Model<span>Bridge</span></span><span class="project-brand-caption">模桥 · AI 模型网关</span></span></a>`;
}

// 默认模型映射表（左边是客户端请求的模型名，右边是 Cloudflare 上对应的真实模型）
// 仅收录官方目录中无需付费计费方式、可使用每日免费额度的模型。
const DEFAULT_MODEL_MAP = {
	"apertus-v1.5-8b": "@cf/swiss-ai/apertus-v1.5-8b",
	"aura-1": "@cf/deepgram/aura-1",
	"aura-2-en": "@cf/deepgram/aura-2-en",
	"aura-2-es": "@cf/deepgram/aura-2-es",
	"bge-base-en-v1.5": "@cf/baai/bge-base-en-v1.5",
	"bge-large-en-v1.5": "@cf/baai/bge-large-en-v1.5",
	"bge-m3": "@cf/baai/bge-m3",
	"bge-reranker-base": "@cf/baai/bge-reranker-base",
	"bge-small-en-v1.5": "@cf/baai/bge-small-en-v1.5",
	"clairic": "@cf/cloudflare/clairic",
	"clef": "@cf/cloudflare/clef",
	"clef-flash": "@cf/cloudflare/clef-flash",
	"clef-omni": "@cf/cloudflare/clef-omni",
	"deepseek-r1-distill-qwen-32b": "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b",
	"distilbert-sst-2-int8": "@cf/huggingface/distilbert-sst-2-int8",
	"dreamshaper-8-lcm": "@cf/lykon/dreamshaper-8-lcm",
	"embeddinggemma-300m": "@cf/google/embeddinggemma-300m",
	"eurollm-9b-it": "@cf/utter-project/eurollm-9b-it",
	"flux": "@cf/deepgram/flux",
	"flux-1-schnell": "@cf/black-forest-labs/flux-1-schnell",
	"flux-2-dev": "@cf/black-forest-labs/flux-2-dev",
	"flux-2-klein-4b": "@cf/black-forest-labs/flux-2-klein-4b",
	"flux-2-klein-9b": "@cf/black-forest-labs/flux-2-klein-9b",
	"gemma-2b-it-lora": "@cf/google/gemma-2b-it-lora",
	"gemma-4-26b-a4b-it": "@cf/google/gemma-4-26b-a4b-it",
	"gemma-7b-it-lora": "@cf/google/gemma-7b-it-lora",
	"gemma-sea-lion-v4-27b-it": "@cf/aisingapore/gemma-sea-lion-v4-27b-it",
	"glm-4.7-flash": "@cf/zai-org/glm-4.7-flash",
	"gpt-oss-120b": "@cf/openai/gpt-oss-120b",
	"gpt-oss-20b": "@cf/openai/gpt-oss-20b",
	"granite-4.0-h-micro": "@cf/ibm-granite/granite-4.0-h-micro",
	"indictrans2-en-indic-1B": "@cf/ai4bharat/indictrans2-en-indic-1B",
	"llama-2-7b-chat-hf-lora": "@cf/meta-llama/llama-2-7b-chat-hf-lora",
	"llama-3.1-8b-instruct-fp8": "@cf/meta/llama-3.1-8b-instruct-fp8",
	"llama-3.2-11b-vision-instruct": "@cf/meta/llama-3.2-11b-vision-instruct",
	"llama-3.2-1b-instruct": "@cf/meta/llama-3.2-1b-instruct",
	"llama-3.2-3b-instruct": "@cf/meta/llama-3.2-3b-instruct",
	"llama-3.3-70b-instruct-fp8-fast": "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
	"llama-4-scout-17b-16e-instruct": "@cf/meta/llama-4-scout-17b-16e-instruct",
	"llama-guard-3-8b": "@cf/meta/llama-guard-3-8b",
	"llava-1.5-7b-hf": "@cf/llava-hf/llava-1.5-7b-hf",
	"lucid-origin": "@cf/leonardo/lucid-origin",
	"m2m100-1.2b": "@cf/meta/m2m100-1.2b",
	"melotts": "@cf/myshell-ai/melotts",
	"mistral-7b-instruct-v0.2-lora": "@cf/mistral/mistral-7b-instruct-v0.2-lora",
	"mistral-small-3.1-24b-instruct": "@cf/mistralai/mistral-small-3.1-24b-instruct",
	"moondream3.1-9B-A2B": "@cf/moondream/moondream3.1-9B-A2B",
	"nemotron-3-120b-a12b": "@cf/nvidia/nemotron-3-120b-a12b",
	"nova-3": "@cf/deepgram/nova-3",
	"phoenix-1.0": "@cf/leonardo/phoenix-1.0",
	"phonellm-mini-alpha-2": "@cf/daily-co/phonellm-mini-alpha-2",
	"plamo-embedding-1b": "@cf/pfnet/plamo-embedding-1b",
	"qwen2.5-coder-32b-instruct": "@cf/qwen/qwen2.5-coder-32b-instruct",
	"qwen3-30b-a3b-fp8": "@cf/qwen/qwen3-30b-a3b-fp8",
	"qwen3-embedding-0.6b": "@cf/qwen/qwen3-embedding-0.6b",
	"qwen3.8-27b": "@cf/qwen/qwen3.8-27b",
	"qwq-32b": "@cf/qwen/qwq-32b",
	"resnet-50": "@cf/microsoft/resnet-50",
	"smart-turn-v2": "@cf/pipecat-ai/smart-turn-v2",
	"stable-diffusion-v1-5-inpainting": "@cf/runwayml/stable-diffusion-v1-5-inpainting",
	"stable-diffusion-xl-base-1.0": "@cf/stabilityai/stable-diffusion-xl-base-1.0",
	"stable-diffusion-xl-lightning": "@cf/bytedance/stable-diffusion-xl-lightning",
	"whisper": "@cf/openai/whisper",
	"whisper-large-v3-turbo": "@cf/openai/whisper-large-v3-turbo",
	"whisper-tiny-en": "@cf/openai/whisper-tiny-en"
};

// Only this request may reuse its configuration snapshot. Never cache a deployment's
// env object across requests, otherwise revoked keys can remain usable.
const REQUEST_CONTEXT = Symbol('request-context');
const GATEWAY_RUNTIME = Symbol('gateway-runtime');
const REQUEST_BODY_LIMITS = new WeakMap();

// Dependencies belong to this gateway/request, never to mutable module globals.
// Keep the default entry self-contained for existing Workers / Pages deployments.
export function createGateway(runtime = {}) {
	const dependencies = Object.freeze({ ...runtime });
	return {
	async fetch(request, env, ctx) {
		try {
			const requestEnv = Object.create(env || {});
			requestEnv[GATEWAY_RUNTIME] = dependencies;
			requestEnv[REQUEST_CONTEXT] = { origin: new URL(request.url).origin, config: undefined };
			if (dependencies.maxRequestBytes !== undefined) {
				if (!Number.isSafeInteger(dependencies.maxRequestBytes) || dependencies.maxRequestBytes <= 0) throw new Error('Invalid runtime body budget');
				REQUEST_BODY_LIMITS.set(request, dependencies.maxRequestBytes);
			}
			return await handleRequest(request, requestEnv, ctx);
		} catch (error) {
			if (error instanceof RequestBodyError) return addCORSHeaders(requestJsonErrorResponse(request, error));
			// Exception messages may contain parsed input, credentials or provider diagnostics.
			console.error('Request failed: internal_error');
			return addCORSHeaders(Response.json({ error: { message: 'Service temporarily unavailable', type: 'server_error' } }, { status: 503 }));
		}
	}
	};
}

export default createGateway();

function hasExternalState(env) {
	return typeof env[GATEWAY_RUNTIME]?.state?.request === 'function';
}

function runtimeFetch(env) {
	return env[GATEWAY_RUNTIME]?.fetch || fetch;
}

function stateRequest(env, path, init) {
	if (hasExternalState(env)) return env[GATEWAY_RUNTIME].state.request(path, init);
	const store = env.CONFIG_STORE.get(env.CONFIG_STORE.idFromName('app-config-v1'));
	return store.fetch('https://config.internal' + path, init);
}

async function handleRequest(request, env, ctx) {
		// 1. 检查是否绑定了 KV 存储
		if (!hasExternalState(env) && !env.KV) {
			return handleKVError(request);
		}

		// 2. 检查是否配置了 ADMIN_PASSWORD 环境变量
		if (!env.ADMIN_PASSWORD) {
			return handlePasswordError(request);
		}
		if (!hasExternalState(env) && !env.CONFIG_STORE) {
			return Response.json({ error: { message: 'CONFIG_STORE Durable Object binding is required. See README for setup.', type: 'server_error' } }, { status: 503 });
		}

		// 处理跨域预检请求（OPTIONS）
		if (request.method === 'OPTIONS') {
			return new Response(null, {
				headers: {
					'Access-Control-Allow-Origin': '*',
					'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, DELETE',
					'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key, x-goog-api-key, anthropic-version, anthropic-beta'
				}
			});
		}

		const url = new URL(request.url);
		if (/^\/(?:v1beta|v1)\/models(?:\/|$)/.test(url.pathname) && url.pathname !== '/v1/models') {
			return addCORSHeaders(await handleGeminiEndpoint(request, env));
		}

		// 2. OpenAI 兼容的代理接口（/v1/ 开头）
		if (url.pathname.startsWith('/v1/')) {
			const response = await handleV1Proxy(request, env, ctx);
			return addCORSHeaders(response);
		}

		// 3. 后台管理面板的 API 接口（/api/ 开头）
		if (url.pathname.startsWith('/api/')) {
			const response = await handleDashboardApi(request, env, ctx);
			return addCORSHeaders(response);
		}

		// 4. 后台管理面板页面
		if (url.pathname === '/admin' || url.pathname === '/admin/') {
			const isLoggedIn = await verifyAdminCookie(request, env);
			if (isLoggedIn) {
				return handleAdminPage(request, env, ctx);
			} else {
				// 未登录则跳转到首页（登录页）
				return new Response(null, {
					status: 302,
					headers: { 'Location': '/', 'Cache-Control': 'no-store' }
				});
			}
		}

		// 5. 首页 / 登录页
		if (url.pathname === '/') {
			return handleLandingPage(request, env, ctx);
		}

		// robots.txt 支持，用于屏蔽搜索引擎爬虫
		if (url.pathname === '/robots.txt') {
			return new Response('User-agent: *\nDisallow: /', {
				headers: { 'Content-Type': 'text/plain; charset=utf-8' }
			});
		}

		// 6. 其他路径一律返回 404
		return new Response('404 Not Found', { status: 404 });
}

// 工具函数：给响应加上跨域（CORS）响应头
function addCORSHeaders(response) {
	const newResponse = new Response(response.body, response);
	newResponse.headers.set('Cache-Control', 'no-store');
	newResponse.headers.set('X-Content-Type-Options', 'nosniff');
	newResponse.headers.set('Access-Control-Allow-Origin', '*');
	newResponse.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, DELETE');
	newResponse.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key, x-goog-api-key, anthropic-version, anthropic-beta');
	return newResponse;
}

const LOGIN_JSON_LIMIT = 16 * 1024;
const ADMIN_JSON_LIMIT = 1024 * 1024;
const API_JSON_LIMIT = 16 * 1024 * 1024;

class RequestBodyError extends Error {
	constructor(status, message) { super(message); this.status = status; }
}

// Count actual bytes, including chunked requests, before decoding or parsing JSON.
async function readRequestJson(request, maxBytes = API_JSON_LIMIT) {
	maxBytes = Math.min(maxBytes, REQUEST_BODY_LIMITS.get(request) ?? maxBytes);
	const tooLarge = () => new RequestBodyError(413, 'JSON request body exceeds the size limit.');
	if (Number(request.headers.get('content-length')) > maxBytes) {
		void request.body?.cancel().catch(() => {});
		throw tooLarge();
	}
	if (!request.body) throw new RequestBodyError(400, 'Invalid JSON body.');
	const reader = request.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true });
	const cancel = () => { void reader.cancel().catch(() => {}); };
	request.signal.addEventListener('abort', cancel, { once: true });
	let bytes = 0, text = '';
	try {
		while (true) {
			if (request.signal.aborted) throw new RequestBodyError(499, 'Request cancelled.');
			const { value, done } = await reader.read();
			if (request.signal.aborted) throw new RequestBodyError(499, 'Request cancelled.');
			if (done) break;
			bytes += value.byteLength;
			if (bytes > maxBytes) throw tooLarge();
			text += decoder.decode(value, { stream: true });
		}
		text += decoder.decode();
		const payload = JSON.parse(text);
		if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new RequestBodyError(400, 'Request body must be an object.');
		return payload;
	} catch (error) {
		cancel();
		if (error instanceof RequestBodyError) throw error;
		throw new RequestBodyError(400, 'Invalid JSON body.');
	} finally {
		request.signal.removeEventListener('abort', cancel);
		reader.releaseLock();
	}
}

function requestJsonErrorResponse(request, error) {
	const status = error instanceof RequestBodyError ? error.status : 400;
	const message = error instanceof RequestBodyError ? error.message : 'Invalid JSON body.';
	const path = new URL(request.url).pathname;
	if (path.startsWith('/api/')) return Response.json({ error: message }, { status });
	if (/^\/(?:v1beta|v1)\/models\//.test(path)) return geminiError(message, status);
	const details = { message, type: 'invalid_request_error' };
	return Response.json(path === '/v1/messages' ? { type: 'error', error: details } : { error: details }, { status });
}

// 工具函数：计算字符串的 SHA-256 哈希值
async function sha256(message) {
	const msgBuffer = new TextEncoder().encode(message);
	const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
	const hashArray = Array.from(new Uint8Array(hashBuffer));
	return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// ----------------------------------------------------
// 配置由选定的权威存储串行更新，KV 仅用于原生 DO 的旧配置首次迁移。
// ----------------------------------------------------
const PROVIDER_DEFAULT_URLS = {
	openai: 'https://api.openai.com/v1',
	anthropic: 'https://api.anthropic.com/v1',
	gemini: 'https://generativelanguage.googleapis.com/v1beta'
};
const ACCOUNT_PROVIDERS = ['cloudflare', 'antigravity', 'openai', 'anthropic', 'gemini'];

function accountProviderForAdmin(account) {
	if (typeof getAccountProvider === 'function') return getAccountProvider(account);
	if (account.provider || account.source) return account.provider || account.source;
	return /^(1\/\/|ya29\.)/.test(account.apiToken || '') ? 'antigravity' : 'cloudflare';
}

function validateProviderBaseUrl(value) {
	const url = new URL(value);
	const hostname = url.hostname.toLowerCase();
	const local = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
	const privateHost = hostname === '0.0.0.0' || /^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(hostname)
		|| /\.(localhost|local|internal)$/.test(hostname) || /^\[(fc|fd|fe[89ab])/.test(hostname);
	if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) || (privateHost && !local)
		|| url.username || url.password || url.search || url.hash || !hostname) {
		throw new Error('Base URL must be a public HTTPS URL without credentials, query or fragment');
	}
	return url.href.replace(/\/+$/, '');
}

function normalizeProviderAccountInput(input, existing) {
	if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid account payload');
	if (input.id !== undefined && typeof input.id !== 'string') throw new Error('Invalid account ID');
	const provider = input.provider || accountProviderForAdmin(existing || input);
	if (!ACCOUNT_PROVIDERS.includes(provider)) throw new Error('Unsupported provider');
	const providerChanged = !!existing && provider !== accountProviderForAdmin(existing);
	const retained = providerChanged ? undefined : existing;
	if (providerChanged && (typeof input.apiToken !== 'string' || !input.apiToken.trim() || input.apiToken.trim() === '********' || input.apiToken.includes('...'))) {
		throw new Error('Changing provider requires a new API key or token.');
	}
	const name = input.name === undefined ? (existing?.name || 'Upstream account') : input.name;
	if (typeof name !== 'string') throw new Error('Account name must be a string');
	const accountId = input.accountId ?? retained?.accountId ?? '';
	if (typeof accountId !== 'string' || (provider === 'cloudflare' && !accountId.trim())) throw new Error('Cloudflare Account ID is required');
	let apiToken = input.apiToken ?? retained?.apiToken;
	if (retained && (apiToken === '' || apiToken === '********' || (typeof apiToken === 'string' && apiToken.includes('...')))) apiToken = retained.apiToken;
	if (typeof apiToken !== 'string' || !apiToken.trim() || apiToken.trim() === '********') throw new Error('API key or token is required');
	const status = input.status ?? existing?.status ?? 'active';
	if (!['active', 'disabled'].includes(status)) throw new Error('Status must be active or disabled');
	let models = input.models ?? retained?.models ?? [];
	if (typeof models === 'string') models = models.split(/[\n,]+/).map(value => value.trim()).filter(Boolean);
	if (!Array.isArray(models) || models.some(value => typeof value !== 'string' || !value.trim())) throw new Error('Models must be an array of non-empty model IDs');
	models = [...new Set(models.map(value => value.trim()))];
	let baseUrl = input.baseUrl ?? retained?.baseUrl ?? PROVIDER_DEFAULT_URLS[provider] ?? '';
	if (typeof baseUrl !== 'string') throw new Error('Base URL must be a string');
	if (PROVIDER_DEFAULT_URLS[provider]) baseUrl = validateProviderBaseUrl(baseUrl.trim() || PROVIDER_DEFAULT_URLS[provider]);
	else baseUrl = '';
	let projectId = provider === 'antigravity' ? (input.projectId ?? retained?.projectId ?? '') : '';
	if (typeof projectId !== 'string') throw new Error('Project ID must be a string');
	const oauth = {};
	for (const field of ['oauthClientId', 'oauthClientSecret']) {
		let value = provider === 'antigravity' ? (input[field] ?? retained?.[field] ?? '') : '';
		if (typeof value !== 'string') throw new Error('OAuth client settings must be strings');
		value = value.trim();
		if (provider === 'antigravity' && retained && (!value || value === '********')) value = retained[field] || '';
		if (value === '********') throw new Error('OAuth client settings cannot use a masked value for a new provider.');
		oauth[field] = value.trim();
	}
	if (provider === 'antigravity' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(accountId.trim()) && !retained) throw new Error('Antigravity email is required');
	const account = { ...existing, ...(input.id ? { id: input.id } : {}), name: name.trim() || 'Upstream account', provider, accountId: accountId.trim(), apiToken: apiToken.trim(), baseUrl, models, status, projectId: projectId.trim(), ...oauth };
	if (providerChanged) for (const field of ['refreshToken', 'apiKey', 'source', 'projectIdentity', 'projectSource']) delete account[field];
	if (provider === 'antigravity') {
		// apiToken is the editable canonical credential. Legacy refreshToken must not override a replacement.
		if (typeof input.apiToken === 'string' && input.apiToken.trim() && input.apiToken !== '********' && !input.apiToken.includes('...')) delete account.refreshToken;
		const explicitProject = typeof input.projectId === 'string' && input.projectId.trim() && input.projectId.trim() !== (retained?.projectId || '');
		account.projectSource = explicitProject ? 'manual' : (account.projectId ? (retained?.projectSource || 'auto') : 'auto');
		const identity = value => JSON.stringify([value?.accountId?.toLowerCase(), value?.refreshToken || value?.apiToken, value?.oauthClientId || '', value?.oauthClientSecret || '']);
		if (existing && identity(account) !== identity(existing) && account.projectSource !== 'manual') {
			account.projectId = '';
			delete account.projectIdentity;
		}
		if (!account.projectId) delete account.projectIdentity;
	}
	return account;
}

function validAppConfig(config) {
	return config && typeof config === 'object' && !Array.isArray(config)
		&& Array.isArray(config.accounts) && config.accounts.every(account => account && typeof account.accountId === 'string' && typeof account.apiToken === 'string'
			&& (account.provider === undefined || ACCOUNT_PROVIDERS.includes(account.provider))
			&& (account.baseUrl === undefined || typeof account.baseUrl === 'string')
			&& (account.projectId === undefined || typeof account.projectId === 'string')
			&& (account.models === undefined || (Array.isArray(account.models) && account.models.every(model => typeof model === 'string'))))
		&& Array.isArray(config.apiKeys) && config.apiKeys.every(key => key && typeof key.key === 'string' && key.key.length > 0)
		&& config.customModelMap && typeof config.customModelMap === 'object' && !Array.isArray(config.customModelMap)
		&& Object.values(config.customModelMap).every(model => typeof model === 'string' && model.length > 0);
}

export function isValidStateConfig(config) {
	return validAppConfig(config);
}

// The business state engine is independent of its persistence adapter. Native
// Cloudflare keeps its historical KV migration through AppConfigStore below.
export class GatewayStateStore {
	constructor(state, env = {}, { legacyKv = false, usageFetch } = {}) {
		this.state = state;
		this.env = env;
		this.legacyKv = legacyKv;
		this.usageFetch = usageFetch;
	}

	async fetch(request) {
		if (new URL(request.url).pathname === '/usage') return handleUsageStoreRequest(this, request);
		return this.state.blockConcurrencyWhile(async () => {
			if (new URL(request.url).pathname === '/auth') return handleAdminSessionOperation(this, request);
			let config = await this.state.storage.get('config');
			if (config === undefined) {
				const raw = this.legacyKv ? await this.env.KV.get('config') : null;
				config = raw === null
					? { accounts: [], apiKeys: [], customModelMap: { ...DEFAULT_MODEL_MAP } }
					: JSON.parse(raw);
				if (!validAppConfig(config)) {
					throw new Error('Invalid legacy configuration; migration refused');
				}
				await this.state.storage.put('config', config);
			}
			if (!validAppConfig(config)) throw new Error('Invalid stored configuration');
			if (request.method === 'GET') return Response.json(config);
			if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
			const operation = await request.json();
			switch (operation.type) {
				case 'account.upsert': {
					const existing = operation.account?.id ? config.accounts.find(a => a.id === operation.account.id) : undefined;
					if (operation.account?.id && !existing) return Response.json({ error: 'Account not found' }, { status: 404 });
					if (operation.expectedAccountRevision && await sha256(JSON.stringify(existing)) !== operation.expectedAccountRevision) return Response.json({ error: 'Account changed during validation; reload and try again.' }, { status: 409 });
					let account;
					try { account = normalizeProviderAccountInput(operation.account, existing); }
					catch (error) { return Response.json({ error: error.message }, { status: 400 }); }
					if (account.provider === 'antigravity' && operation.antigravityProject) Object.assign(account, operation.antigravityProject);
					if (existing) config.accounts = config.accounts.map(item => item.id === existing.id ? account : item);
					else config.accounts.push({ ...account, id: crypto.randomUUID() });
					break;
				}
				case 'account.delete':
					config.accounts = config.accounts.filter(a => a.id !== operation.id);
					break;
				case 'key.add':
					config.apiKeys.push(operation.key);
					break;
				case 'key.delete':
					config.apiKeys = config.apiKeys.filter(k => k.id !== operation.id);
					break;
				case 'models.replace':
					config.customModelMap = operation.map;
					break;
				default:
					return Response.json({ error: 'Unknown configuration operation' }, { status: 400 });
			}
			await this.state.storage.put('config', config);
			return Response.json({ success: true });
		});
	}
}

export class AppConfigStore extends GatewayStateStore {
	constructor(state, env) { super(state, env, { legacyKv: true }); }
}

async function configRequest(env, operation) {
	const response = await stateRequest(env, '/', operation === undefined ? undefined : {
		method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(operation)
	});
	if (!response.ok) throw Object.assign(new Error(`Configuration operation failed (${response.status})`), { status: response.status });
	if (operation !== undefined && Object.hasOwn(env, REQUEST_CONTEXT)) env[REQUEST_CONTEXT].config = undefined;
	return response.json();
}

async function getAppConfig(env) {
	const context = Object.hasOwn(env, REQUEST_CONTEXT) ? env[REQUEST_CONTEXT] : undefined;
	if (!context) return configRequest(env);
	if (!context.config) context.config = configRequest(env).catch(error => { context.config = undefined; throw error; });
	return context.config;
}

async function getAccounts(env) {
	const config = await getAppConfig(env);
	return config.accounts;
}

async function getApiKeys(env) {
	const config = await getAppConfig(env);
	return config.apiKeys;
}

async function getCustomModelMap(env) {
	const config = await getAppConfig(env);
	return config.customModelMap;
}

async function saveCustomModelMap(env, map) {
	return configRequest(env, { type: 'models.replace', map });
}

// ----------------------------------------------------
// Admin sessions are opaque, expiring and revocable; password digests are never bearer credentials.
// ----------------------------------------------------
const ADMIN_SESSION_TTL = 24 * 60 * 60 * 1000;
const ADMIN_LOGIN_WINDOW = 15 * 60 * 1000;
const ADMIN_LOGIN_ATTEMPTS = 10;

function adminSessionToken(request, cookieOnly = false) {
	const cookie = (request.headers.get('Cookie') || '').match(/(?:^|;\s*)admin_token=([^;]+)/)?.[1];
	const bearer = cookieOnly ? null : request.headers.get('Authorization')?.match(/^Bearer (.+)$/)?.[1];
	const token = cookie || bearer;
	return typeof token === 'string' && /^as2_[a-f0-9]{64}$/.test(token) ? token : null;
}

async function adminSessionRequest(env, operation, request) {
	if (!hasExternalState(env) && !env.CONFIG_STORE) return { valid: false };
	const password = String(env.ADMIN_PASSWORD || '').trim();
	const origin = request ? new URL(request.url).origin : env[REQUEST_CONTEXT]?.origin;
	if (!password || !origin) return { valid: false, success: false };
	// The binding is the trust boundary: callers send only server-derived context,
	// never a browser-supplied password match, fingerprint or origin. Pages and its
	// hosting Worker may share data while authenticating with different Secrets.
	const payload = {
		type: operation.type, token: operation.token, ipKey: operation.ipKey,
		scope: await sha256('admin-origin-v3:' + origin),
		fingerprint: await sha256('admin-session-v3:' + password),
		passwordMatched: operation.type === 'login' && typeof operation.password === 'string' && operation.password === password
	};
	const response = await stateRequest(env, '/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
	if (!response.ok) throw new Error('Session store unavailable');
	return response.json();
}

async function handleAdminSessionOperation(store, request) {
	if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
	const operation = await request.json(), now = Date.now();
	const { scope, fingerprint } = operation;
	if (!/^[a-f0-9]{64}$/.test(scope || '') || !/^[a-f0-9]{64}$/.test(fingerprint || '')) return Response.json({ valid: false, success: false }, { status: 400 });
	let auth = await store.state.storage.get('admin-auth-v2');
	// A version upgrade deliberately expires old sessions. Keep one bounded record
	// instead of allocating storage per origin supplied by incoming requests.
	if (!auth || auth.version !== 3) auth = { version: 3, sessions: {}, attempts: {} };
	let changed = false;
	for (const [key, session] of Object.entries(auth.sessions)) {
		if (session.expiresAt <= now || (session.scope === scope && session.fingerprint !== fingerprint)) { delete auth.sessions[key]; changed = true; }
	}
	for (const [key, attempt] of Object.entries(auth.attempts)) {
		if (attempt.until <= now || (attempt.scope === scope && attempt.fingerprint !== fingerprint)) { delete auth.attempts[key]; changed = true; }
	}
	if (operation.type === 'login') {
		const ipKey = await sha256(scope + ':' + String(operation.ipKey || 'unknown'));
		const attempt = auth.attempts[ipKey];
		if (attempt?.count >= ADMIN_LOGIN_ATTEMPTS) return Response.json({ success: false, limited: true, retryAfter: Math.max(1, Math.ceil((attempt.until - now) / 1000)) });
		if (operation.passwordMatched !== true) {
			// Bound the serialized auth record well below the Durable Object value-size limit.
			if (!attempt && Object.keys(auth.attempts).length >= 512) delete auth.attempts[Object.keys(auth.attempts)[0]];
			auth.attempts[ipKey] = { scope, fingerprint, count: (attempt?.count || 0) + 1, until: attempt?.until || now + ADMIN_LOGIN_WINDOW };
			await store.state.storage.put('admin-auth-v2', auth);
			return Response.json({ success: false });
		}
		delete auth.attempts[ipKey];
		const token = 'as2_' + Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('');
		if (Object.keys(auth.sessions).length >= 64) delete auth.sessions[Object.keys(auth.sessions)[0]];
		auth.sessions[await sha256(token)] = { scope, fingerprint, expiresAt: now + ADMIN_SESSION_TTL };
		await store.state.storage.put('admin-auth-v2', auth);
		return Response.json({ success: true, token });
	}
	const token = typeof operation.token === 'string' && /^as2_[a-f0-9]{64}$/.test(operation.token) ? operation.token : '';
	const tokenHash = token ? await sha256(token) : '';
	const session = auth.sessions[tokenHash];
	const valid = !!session && session.scope === scope && session.fingerprint === fingerprint;
	if (operation.type === 'logout') {
		if (valid) { delete auth.sessions[tokenHash]; changed = true; }
		if (changed) await store.state.storage.put('admin-auth-v2', auth);
		return Response.json({ success: true });
	}
	if (changed) await store.state.storage.put('admin-auth-v2', auth);
	return Response.json({ valid });
}

async function checkAdminAuth(request, env) {
	const token = adminSessionToken(request);
	return !!token && (await adminSessionRequest(env, { type: 'verify', token }, request)).valid === true;
}

async function verifyAdminCookie(request, env) {
	const token = adminSessionToken(request, true);
	return !!token && (await adminSessionRequest(env, { type: 'verify', token }, request)).valid === true;
}

// ----------------------------------------------------
// 代理接口的鉴权工具函数
// ----------------------------------------------------
async function checkProxyAuth(request, env) {
	const url = new URL(request.url);
	const candidates = [];
	if (/^\/(?:v1beta|v1)\/models(?:\/|$)/.test(url.pathname)) {
		const googleKey = request.headers.get('x-goog-api-key') || url.searchParams.get('key');
		if (googleKey) candidates.push(googleKey);
	}
	const xApiKey = request.headers.get('x-api-key');
	if (xApiKey) candidates.push(xApiKey);
	const authHeader = request.headers.get('Authorization');
	if (authHeader?.startsWith('Bearer ') && authHeader.length > 7) candidates.push(authHeader.substring(7));
	if (!candidates.length) return false;
	const apiKeys = await getApiKeys(env);
	return apiKeys.some(key => candidates.includes(key.key));
}

// ----------------------------------------------------
// 用量统计的缓存工具函数
// ----------------------------------------------------
const USAGE_CACHE_TTL_MS = 5 * 60 * 1000;
const USAGE_CACHE_KEY = 'usage-cache-v2';

function uniqueCloudflareAccounts(accounts) {
	const seen = new Set();
	return accounts.filter(account => {
		if (accountProviderForAdmin(account) !== 'cloudflare' || account.status !== 'active') return false;
		const id = account.accountId.trim().toLowerCase();
		if (seen.has(id)) return false;
		seen.add(id);
		return true;
	});
}

async function usageAccountGroups(accounts) {
	const groups = new Map();
	for (const account of accounts) {
		if (accountProviderForAdmin(account) !== 'cloudflare' || account.status !== 'active') continue;
		const id = account.accountId.trim().toLowerCase();
		if (!groups.has(id)) groups.set(id, { id, account, credentials: [] });
		groups.get(id).credentials.push(account.apiToken);
	}
	for (const group of groups.values()) {
		group.credentials = [...new Set(group.credentials)];
		group.fingerprint = await sha256(JSON.stringify([...group.credentials].sort()));
	}
	return groups;
}

async function queryUsageAccountGroup(group, startDateTime, networkFetch = fetch) {
	// Analytics permissions can differ between tokens for the same real account.
	// Only explicit authorization rejection permits a bounded credential fallback.
	const credentials = group.credentials.slice(0, 3);
	for (let index = 0; index < credentials.length; index++) {
		try { return await queryGraphQL(group.id, credentials[index], startDateTime, networkFetch); }
		catch (error) { if (!error.credentialRejected || index === credentials.length - 1) throw error; }
	}
	throw new Error('No Cloudflare analytics credential is available.');
}

function freshUsageEntry(entry, now = Date.now()) {
	return entry && Number.isFinite(entry.timestamp) && now >= entry.timestamp && now - entry.timestamp < USAGE_CACHE_TTL_MS
		&& new Date(entry.timestamp).toISOString().slice(0, 10) === new Date(now).toISOString().slice(0, 10);
}

function usageRecordsForAccounts(cache, groups) {
	const result = {};
	for (const group of groups.values()) {
		const entry = cache[group.id];
		if (!entry || !Number.isFinite(entry.timestamp) || entry.fingerprint !== group.fingerprint) continue;
		const { fingerprint, ...publicEntry } = entry;
		// Yesterday's daily counters must never be displayed as today's quota usage.
		if (new Date(entry.timestamp).toISOString().slice(0, 10) !== new Date().toISOString().slice(0, 10)) {
			publicEntry.usageToday = 0;
			publicEntry.modelsToday = [];
		}
		result[group.account.id] = publicEntry;
	}
	return result;
}

async function readUsageStoreState(store) {
	const config = await (await store.fetch(new Request('https://config.internal/'))).json();
	let cache;
	try { cache = await store.state.storage.get(USAGE_CACHE_KEY); } catch (_) {}
	return { groups: await usageAccountGroups(config.accounts), cache: cache && typeof cache === 'object' && !Array.isArray(cache) ? cache : {} };
}

async function refreshUsageStore(store, limit) {
	const { groups, cache } = await readUsageStoreState(store);
	const pending = [...groups.values()].filter(group => cache[group.id]?.fingerprint !== group.fingerprint || !freshUsageEntry(cache[group.id]))
		.sort((a, b) => (cache[a.id]?.timestamp || 0) - (cache[b.id]?.timestamp || 0)).slice(0, limit);
	const start = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000);
	start.setUTCHours(0, 0, 0, 0);
	let index = 0;
	await Promise.all(Array.from({ length: Math.min(4, pending.length) }, async () => {
		while (index < pending.length) {
			const group = pending[index++];
			try {
				// Seven daily buckets already include today; no second query is necessary.
				const analytics = processAnalytics(await queryUsageAccountGroup(group, start.toISOString(), store.usageFetch));
				cache[group.id] = { fingerprint: group.fingerprint, status: 'active', error: null, usageToday: analytics.todayTotalNeurons, modelsToday: analytics.todayModels, history: analytics.history, timestamp: Date.now() };
			} catch (_) {
				const previous = cache[group.id]?.fingerprint === group.fingerprint ? cache[group.id] : undefined;
				const sameDay = Number.isFinite(previous?.timestamp) && new Date(previous.timestamp).toISOString().slice(0, 10) === new Date().toISOString().slice(0, 10);
				cache[group.id] = { fingerprint: group.fingerprint, status: 'error', error: 'Cloudflare usage could not be refreshed. Check the account analytics permission.', usageToday: sameDay ? previous.usageToday : 0, modelsToday: sameDay ? previous.modelsToday : [], history: previous?.history || [], timestamp: Date.now() };
			}
		}
	}));
	// An account can be edited/deleted during network I/O. Do not publish results for obsolete credentials.
	const latest = await readUsageStoreState(store);
	const retained = {};
	for (const group of latest.groups.values()) if (cache[group.id]?.fingerprint === group.fingerprint) retained[group.id] = cache[group.id];
	if (pending.length) {
		try { await store.state.storage.put(USAGE_CACHE_KEY, retained); }
		catch (_) { /* A cache write failure must not turn usable analytics into a gateway outage. */ }
	}
	return usageRecordsForAccounts(retained, latest.groups);
}

async function handleUsageStoreRequest(store, request) {
	if (request.method === 'GET') {
		const { groups, cache } = await readUsageStoreState(store);
		return Response.json(usageRecordsForAccounts(cache, groups));
	}
	if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
	const requested = Number(new URL(request.url).searchParams.get('limit')) || 20;
	const limit = Math.min(20, Math.max(1, Math.trunc(requested)));
	if (!store.usageInFlight) store.usageInFlight = refreshUsageStore(store, limit).finally(() => { store.usageInFlight = null; });
	return Response.json(await store.usageInFlight);
}

async function usageStoreRequest(env, refresh = false, limit = 20) {
	const response = await stateRequest(env, '/usage?limit=' + limit, { method: refresh ? 'POST' : 'GET' });
	if (!response.ok) throw new Error('Usage cache unavailable');
	return response.json();
}

async function refreshAccountsUsage(env, accounts, limit = 20) {
	return usageStoreRequest(env, true, limit);
}

function buildUsageSummary(accounts, cacheMap) {
	const unique = uniqueCloudflareAccounts(accounts), models = new Map();
	let totalNeuronsToday = 0;
	for (const account of unique) {
		const cached = cacheMap[account.id];
		totalNeuronsToday += cached?.usageToday || 0;
		for (const item of cached?.modelsToday || []) models.set(item.model, (models.get(item.model) || 0) + item.neurons);
	}
	const totalLimit = unique.length * 10000;
	return { totalNeuronsToday, totalAccounts: unique.length, totalLimit, usagePercentage: totalLimit ? Number((totalNeuronsToday / totalLimit * 100).toFixed(2)) : 0,
		modelsToday: [...models].map(([model, neurons]) => ({ model, neurons })), needUpdate: unique.some(account => !freshUsageEntry(cacheMap[account.id])) };
}

// ----------------------------------------------------
// Cloudflare GraphQL 用量分析查询
// ----------------------------------------------------
async function queryGraphQL(accountId, apiToken, startDateTime, networkFetch = fetch) {
	const query = `
		query GetAIUsage($accountId: String!, $start: String!) {
			viewer {
				accounts(filter: { accountTag: $accountId }) {
					aiInferenceAdaptiveGroups(
						filter: { datetime_geq: $start }
						limit: 1000
					) {
						count
						sum {
							totalNeurons
						}
						dimensions {
							date
							modelId
						}
					}
				}
			}
		}
	`;
	const response = await networkFetch(`https://api.cloudflare.com/client/v4/graphql`, {
		method: 'POST',
		redirect: 'manual',
		signal: AbortSignal.timeout(15000),
		headers: {
			'Authorization': `Bearer ${apiToken}`,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({
			query,
			variables: {
				accountId,
				start: startDateTime
			}
		})
	});

	if (!response.ok) {
		await response.body?.cancel().catch(() => {});
		throw Object.assign(new Error(`GraphQL API error (${response.status})`), { credentialRejected: response.status === 401 || response.status === 403 });
	}

	const result = await response.json();
	if (result.errors && result.errors.length > 0) {
		const errors = result.errors;
		const credentialRejected = errors.every(error => {
			const code = String(error?.extensions?.code || error?.code || '').toUpperCase();
			return ['UNAUTHENTICATED', 'UNAUTHORIZED', 'FORBIDDEN', 'AUTHENTICATION_ERROR', 'AUTHORIZATION_ERROR', 'NOT_AUTHORIZED'].includes(code)
				|| /^(?:authentication|authorization) (?:failed|error)$|^(?:unauthorized|not authorized|forbidden)(?:\b|$)|does not have (?:the )?(?:required )?permission|insufficient permissions|permission (?:denied|to access)/i.test(String(error?.message || ''));
		});
		throw Object.assign(new Error('Cloudflare analytics query was rejected.'), { credentialRejected });
	}

	return result?.data?.viewer?.accounts?.[0]?.aiInferenceAdaptiveGroups || [];
}

function processAnalytics(groups) {
	const todayStr = new Date().toISOString().split('T')[0];

	let todayTotalNeurons = 0;
	const todayModelsMap = Object.create(null);
	const historyMap = Object.create(null);

	// 先把最近 7 天的历史数据全部初始化为 0
	for (let i = 6; i >= 0; i--) {
		const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
		const dStr = d.toISOString().split('T')[0];
		historyMap[dStr] = 0;
	}

	for (const group of groups) {
		const date = group.dimensions.date;
		const model = group.dimensions.modelId;
		const neurons = group.sum.totalNeurons || 0;
		const count = group.count || 0;

		if (date === todayStr) {
			todayTotalNeurons += neurons;
			if (!todayModelsMap[model]) {
				todayModelsMap[model] = { model, neurons: 0, requests: 0 };
			}
			todayModelsMap[model].neurons += neurons;
			todayModelsMap[model].requests += count;
		}

		if (historyMap[date] !== undefined) {
			historyMap[date] += neurons;
		}
	}

	const todayModels = Object.values(todayModelsMap).sort((a, b) => b.neurons - a.neurons);
	const history = Object.keys(historyMap)
		.sort()
		.map(date => ({ date, neurons: historyMap[date] }));

	return {
		todayTotalNeurons,
		todayModels,
		history
	};
}

// ----------------------------------------------------
// OpenAI 兼容代理接口（/v1/）的处理函数
// ----------------------------------------------------
async function handleV1Proxy(request, env, ctx) {
	const url = new URL(request.url);

	// 1. 校验调用密钥（API Key）
	if (!await checkProxyAuth(request, env)) {
		// /v1/messages 返回 Anthropic 格式错误，其他路径返回 OpenAI 格式
		if (url.pathname === '/v1/messages') {
			return new Response(JSON.stringify({
				type: 'error',
				error: {
					type: 'authentication_error',
					message: 'Invalid x-api-key or Authorization header.'
				}
			}), { status: 401, headers: { 'Content-Type': 'application/json' } });
		}
		return new Response(JSON.stringify({
			error: {
				message: "Incorrect or missing API key. Configure keys in the dashboard.",
				type: "invalid_request_error",
				param: null,
				code: "invalid_api_key"
			}
		}), { status: 401, headers: { 'Content-Type': 'application/json' } });
	}

	// 2. 获取模型列表接口（/v1/models）
	if (url.pathname === '/v1/models' && request.method === 'GET') {
		const customMap = await getCustomModelMap(env);

		const modelsData = Object.keys(customMap).map(id => {
			const isEmbedding = id.includes('embedding');
			return {
				id,
				object: 'model',
				created: 1686935000,
				owned_by: isEmbedding ? 'openai' : 'meta'
			};
		});
		const upstreamAccounts = await getAccounts(env);
		const listedModelIds = new Set(modelsData.map(entry => entry.id));
		for (const account of upstreamAccounts) {
			const provider = getAccountProvider(account);
			if (account.status !== 'active' || !['openai', 'anthropic', 'gemini'].includes(provider)) continue;
			for (const model of account.models || []) {
				for (const id of [model, `${provider}:${model}`]) {
					if (!listedModelIds.has(id)) {
						listedModelIds.add(id);
						modelsData.push({ id, object: 'model', created: 1700000000, owned_by: provider });
					}
				}
			}
		}

		if (typeof getAntigravityModelList === 'function') {
			const agModels = await getAntigravityModelList(env, customMap);
			for (const ag of agModels) {
				if (!listedModelIds.has(ag.id)) {
					listedModelIds.add(ag.id);
					modelsData.push(ag);
				}
			}
		}


		return new Response(JSON.stringify({
			object: 'list',
			data: modelsData
		}), { headers: { 'Content-Type': 'application/json' } });
	}

	// 3. 对话补全 / 文本补全 接口
	if ((url.pathname === '/v1/chat/completions' || url.pathname === '/v1/completions') && request.method === 'POST') {
		return handleCompletions(request, env, url.pathname);
	}

	// 4. Anthropic Messages API 接口（/v1/messages）
	if (url.pathname === '/v1/messages' && request.method === 'POST') {
		return handleMessages(request, env);
	}

	// 向量嵌入接口
	if (url.pathname === '/v1/embeddings' && request.method === 'POST') {
		return handleEmbeddings(request, env);
	}

	return new Response(JSON.stringify({
		error: { message: `Path not found: ${url.pathname}`, type: "invalid_request_error" }
	}), { status: 404, headers: { 'Content-Type': 'application/json' } });
}

// ----------------------------------------------------
// 可复用的核心 API 调用函数
// 将 OpenAI Chat Completions 格式的请求发送到 Cloudflare AI 网关，
// 支持多账号负载均衡和故障自动切换。
// 返回格式：{ success: true, data: cfJson } 或 { success: false, error: "..." }
// ----------------------------------------------------
async function callOpenAICompatibleAPI(cfPayload, env, stream, clientSignal) {
	const accounts = await getAccounts(env);
	const route = parseUpstreamTarget(cfPayload.model, accounts);
	const candidates = getMatchingUpstreamAccounts(route, accounts);
	if (!candidates.length) return { success: false, status: 503, error: 'No active upstream account matches this model.' };
	let failure = { success: false, status: 502, error: 'All matching upstream accounts failed.' };
	for (const account of shuffledUpstreams(candidates).slice(0, 3)) {
		if (clientSignal?.aborted) return { success: false, status: 499, error: 'Request cancelled.' };
		let requestStarted = false;
		try {
			const provider = getAccountProvider(account);
			const { _anthropicRequest, _outputProtocol, ...suppliedPayload } = cfPayload;
			const payload = _anthropicRequest?.messages && _outputProtocol === 'anthropic' && provider !== 'anthropic'
				? convertAnthropicToOpenAI(_anthropicRequest) : suppliedPayload;
			payload.model = route.model;
			payload.stream = !!stream;
			if (provider !== 'gemini') rejectUnsupportedGeminiSafetySettings(payload);
			let url, body = payload;
			const headers = { 'Content-Type': 'application/json', Accept: stream ? 'text/event-stream' : 'application/json' };
			if (provider === 'cloudflare') {
				validateToolStrictness(payload.tools, 'cloudflare');
				cloudflareModelPath(route.model);
				body = sanitizeOpenAIUpstreamPayload(payload);
				url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account.accountId)}/ai/v1/chat/completions`;
				headers.Authorization = `Bearer ${account.apiToken}`;
			} else if (provider === 'openai') {
				body = sanitizeOpenAIUpstreamPayload(payload);
				url = upstreamEndpoint(account, provider, 'chat/completions');
				if (new URL(url).hostname === 'api.openai.com' && payload.top_k !== undefined) {
					throw Object.assign(new TypeError('The OpenAI API does not support top_k sampling. Remove topK/top_k or use an upstream that supports it.'), { status: 400 });
				}
				headers.Authorization = `Bearer ${account.apiToken}`;
			} else if (provider === 'anthropic') {
				if (_anthropicRequest) validateToolStrictness(_anthropicRequest.tools, 'anthropic', false);
				url = upstreamEndpoint(account, provider, 'messages');
				headers['x-api-key'] = account.apiToken;
				headers['anthropic-version'] = '2023-06-01';
				body = _anthropicRequest ? { ..._anthropicRequest, model: route.model, stream: !!stream } : openAIToAnthropicUpstreamRequest(payload);
			} else if (provider === 'gemini') {
				url = upstreamEndpoint(account, provider, `models/${encodeURIComponent(route.model.replace(/^models\//, ''))}:${stream ? 'streamGenerateContent' : 'generateContent'}`);
				if (stream) url += '?alt=sse';
				headers['x-goog-api-key'] = account.apiToken;
				body = openAIToGeminiRequest(payload);
			} else return { success: false, status: 400, error: 'Unsupported upstream protocol for this operation.' };
			requestStarted = true;
			const response = await fetchUpstream(url, { headers, body: JSON.stringify(body), signal: clientSignal }, {}, runtimeFetch(env));
			if (!response.ok) {
				failure = await upstreamFailure(response, account);
				if (!shouldRetryUpstream(response.status)) return failure;
				continue;
			}
			if (stream) {
				if (!response.body) return { success: false, status: 502, error: 'Upstream returned an empty stream.' };
				const contentType = (response.headers.get('content-type') || '').toLowerCase();
				if (contentType && !contentType.includes('text/event-stream')) {
					await response.body.cancel().catch(() => {});
					return { success: false, status: 502, error: 'Upstream returned a non-SSE response for a streaming request. The request was not repeated.' };
				}
				const safeStream = sanitizeUpstreamErrorStream(response.body, account, { openAI: provider === 'openai' || provider === 'cloudflare' });
				if (provider === 'anthropic' && _outputProtocol === 'anthropic') return { success: true, nativeAnthropic: true, stream: safeStream };
				const transformed = provider === 'anthropic' ? anthropicToOpenAIUpstreamStream(safeStream, route.model)
					: provider === 'gemini' ? geminiToOpenAIStream(safeStream, route.model) : safeStream;
				return { success: true, stream: transformed };
			}
			const data = await response.json();
			if (isUpstreamErrorEnvelope(data)) return { success: false, status: 502, error: cleanUpstreamError(upstreamErrorMessage(data), account) };
			if (!validUpstreamCompletion(data, provider)) return { success: false, status: 502, error: 'Upstream returned an invalid completion. The request was not repeated.' };
			if (provider === 'anthropic' && _outputProtocol === 'anthropic') return { success: true, nativeAnthropic: true, data };
			return { success: true, data: provider === 'anthropic' ? anthropicToOpenAIUpstreamResponse(data, route.model)
				: provider === 'gemini' ? geminiToOpenAIResponse(data, route.model) : sanitizeOpenAIUpstreamResponse(data) };
		} catch (error) {
			if (error.status === 400 || (!requestStarted && error instanceof TypeError)) return { success: false, status: 400, error: error.message };
			return { success: false, status: clientSignal?.aborted ? 499 : 502, error: clientSignal?.aborted ? 'Request cancelled.' : 'Unable to obtain a valid response from the configured upstream. The request was not repeated.' };
		}
	}
	return failure;
}

function rejectUnsupportedGeminiSafetySettings(payload) {
	const extra = normalizeGeminiRequestFields(payload.gemini_extra || {});
	const supportedRequestFields = ['systemInstruction', 'generationConfig', 'tools', 'toolConfig', 'safetySettings'];
	if (Object.keys(extra).some(key => !supportedRequestFields.includes(key))) throw new TypeError('This upstream protocol cannot preserve the requested Gemini request field. Use a Gemini upstream or remove the constraint explicitly.');
	const settings = extra.safetySettings;
	if (settings !== undefined && (!Array.isArray(settings) || settings.length > 0)) {
		throw Object.assign(new Error('Gemini safetySettings cannot be enforced by this upstream protocol. Use a Gemini upstream or remove the settings explicitly.'), { status: 400 });
	}
	const config = extra.generationConfig || {};
	const supported = ['temperature', 'topP', 'topK', 'maxOutputTokens', 'stopSequences', 'candidateCount', 'presencePenalty', 'frequencyPenalty', 'seed', 'responseMimeType', 'responseSchema', 'responseJsonSchema', 'thinkingConfig'];
	if (Object.keys(config).some(key => !supported.includes(key))) throw new TypeError('This upstream protocol cannot enforce the requested Gemini generationConfig field. Use a Gemini upstream or remove the constraint explicitly.');
	if (extra.toolConfig && (Object.keys(extra.toolConfig).some(key => key !== 'functionCallingConfig')
		|| Object.keys(extra.toolConfig.functionCallingConfig || {}).some(key => !['mode', 'allowedFunctionNames'].includes(key)))) throw new TypeError('This upstream protocol cannot enforce the requested Gemini toolConfig field.');
	if (extra.toolConfig?.functionCallingConfig?.mode === 'VALIDATED') throw new TypeError('This upstream protocol cannot guarantee Gemini VALIDATED function calling.');
	for (const tool of extra.tools || []) for (const fn of tool.functionDeclarations || []) {
		if (Object.keys(fn).some(key => !['name', 'description', 'parameters', 'parametersJsonSchema'].includes(key))) throw new TypeError('This upstream protocol cannot preserve the requested Gemini function declaration field.');
	}
	const mimeType = config.responseMimeType;
	if (mimeType !== undefined && !['text/plain', 'application/json'].includes(mimeType)) {
		throw Object.assign(new Error('This upstream protocol cannot enforce the requested Gemini responseMimeType. Use a Gemini upstream or remove the format constraint explicitly.'), { status: 400 });
	}
	if ((config.responseSchema !== undefined || config.responseJsonSchema !== undefined) && mimeType !== 'application/json') throw new TypeError('Gemini response schemas require application/json for this upstream protocol.');
	for (const [field, value] of Object.entries(geminiGenerationToOpenAI(config))) {
		if (!protocolJsonEqual(payload[field], value)) throw new TypeError('Gemini generationConfig conflicts with or is missing its translated request constraint.');
	}
}

function validateToolStrictness(tools, provider, openAI = true) {
	for (const tool of tools || []) {
		const strict = (openAI ? tool?.function : tool)?.strict;
		if (strict !== undefined && typeof strict !== 'boolean') throw new TypeError('Tool strict must be a boolean.');
		if (strict && !['openai', 'anthropic'].includes(provider)) throw new TypeError(`This ${provider} adapter cannot guarantee strict tool schemas.`);
	}
}

function rejectAnthropicProviderTools(tools) {
	for (const tool of tools || []) {
		if (tool?.type != null && tool.type !== 'custom') throw Object.assign(new TypeError('Anthropic provider-defined tools require an Anthropic upstream. This adapter supports custom tools only.'), { status: 400 });
	}
}

// Only native adapters may create full-content replay metadata. An OpenAI upstream
// must not smuggle a second, invisible message into another provider's history.
function sanitizeOpenAIUpstreamResponse(data) {
	const cleaned = { ...data };
	for (const key of Object.keys(cleaned)) if (key.startsWith('gemini_') || key.startsWith('anthropic_')) delete cleaned[key];
	if (Array.isArray(data.choices)) cleaned.choices = data.choices.map(choice => {
		const result = { ...choice };
		for (const key of Object.keys(result)) if (key.startsWith('gemini_') || key.startsWith('anthropic_')) delete result[key];
		for (const field of ['message', 'delta']) if (result[field] && typeof result[field] === 'object') {
			result[field] = { ...result[field] };
			for (const key of Object.keys(result[field])) if (key.startsWith('gemini_') || key.startsWith('anthropic_')) delete result[field][key];
		}
		return result;
	});
	return cleaned;
}

function sanitizeOpenAIUpstreamPayload(payload) {
	rejectUnsupportedGeminiSafetySettings(payload);
	validateToolStrictness(payload.tools, 'openai');
	if (payload.thinking_config !== undefined) throw Object.assign(new Error('Gemini thinking_config cannot be represented by this OpenAI adapter.'), { status: 400 });
	const cleaned = { ...payload };
	delete cleaned.gemini_extra;
	delete cleaned.thinking_config;
	cleaned.messages = (payload.messages || []).map(message => {
		const result = { ...message };
		for (const key of Object.keys(result)) if (key.startsWith('gemini_') || key.startsWith('anthropic_')) delete result[key];
		if (Array.isArray(result.tool_calls)) result.tool_calls = result.tool_calls.map(tool => {
			const { gemini_thought_signature, ...standard } = tool;
			return standard;
		});
		if (Array.isArray(result.content)) result.content = result.content.map(part => {
			if (part.type !== 'image_url') return part;
			const image = typeof part.image_url === 'string' ? { url: part.image_url } : part.image_url;
			const mimeType = image?.mime_type || /^data:([^;,]+)/.exec(image?.url || '')?.[1];
			if (mimeType && !mimeType.startsWith('image/')) throw Object.assign(new Error('This upstream adapter does not accept non-image media as an image input.'), { status: 400 });
			if (!image || typeof image.url !== 'string') throw Object.assign(new Error('Invalid image input.'), { status: 400 });
			const { mime_type, ...standardImage } = image;
			return { ...part, image_url: standardImage };
		});
		return result;
	});
	return cleaned;
}

function openAIToAnthropicUpstreamRequest(payload, { allowGeminiThinking = false } = {}) {
	rejectUnsupportedGeminiSafetySettings(payload);
	validateToolStrictness(payload.tools, 'anthropic');
	for (const field of ['seed', 'presence_penalty', 'frequency_penalty', 'top_logprobs', 'reasoning_effort']) {
		if (payload[field] !== undefined) throw Object.assign(new TypeError(`This Anthropic adapter cannot enforce ${field}.`), { status: 400 });
	}
	if (payload.logprobs !== undefined && payload.logprobs !== false) throw Object.assign(new TypeError('This Anthropic adapter cannot provide logprobs.'), { status: 400 });
	if (payload.thinking_config !== undefined && !allowGeminiThinking) throw Object.assign(new Error('Gemini thinking_config cannot be represented by this Anthropic adapter.'), { status: 400 });
	if (payload.response_format?.type === 'json_object') throw Object.assign(new Error('This Anthropic adapter requires response_format.type=json_schema for structured output; json_object is not supported.'), { status: 400 });
	if (payload.n !== undefined && payload.n !== 1) throw Object.assign(new Error('Anthropic supports one candidate per request.'), { status: 400 });
	const result = { model: payload.model, max_tokens: payload.max_completion_tokens ?? payload.max_tokens ?? 4096, messages: [], stream: !!payload.stream };
	if (allowGeminiThinking && payload.thinking_config !== undefined) result.thinking_config = structuredClone(payload.thinking_config);
	const system = [];
	function parts(content) {
		if (content === null || content === undefined) return [];
		if (typeof content === 'string') return content ? [{ type: 'text', text: content }] : [];
		if (!Array.isArray(content)) throw Object.assign(new Error('Message content must be text or content parts.'), { status: 400 });
		return content.map(part => {
			if (part.type === 'text') return { type: 'text', text: part.text || '', ...(part.cache_control ? { cache_control: part.cache_control } : {}) };
			if (part.type === 'image_url') {
				const url = part.image_url?.url;
				const inline = /^data:([^;,]+);base64,(.+)$/s.exec(url || '');
				if (inline && inline[1].startsWith('image/')) return { type: 'image', source: { type: 'base64', media_type: inline[1], data: inline[2] } };
				if (!inline && (!part.image_url?.mime_type || part.image_url.mime_type.startsWith('image/')) && typeof url === 'string' && /^https?:\/\//.test(url)) return { type: 'image', source: { type: 'url', url } };
			}
			throw Object.assign(new Error(`Content part ${part.type || 'unknown'} cannot be represented by this Anthropic adapter.`), { status: 400 });
		});
	}
	function push(role, content) {
		if (!content.length) return;
		const previous = result.messages.at(-1);
		if (previous?.role === role) previous.content.push(...content);
		else result.messages.push({ role, content });
	}
	for (const message of payload.messages || []) {
		validateReplayMetadata(message);
		if (message.role === 'system' || message.role === 'developer') { system.push(...parts(message.content)); continue; }
		if (message.role === 'tool') {
			push('user', [{ type: 'tool_result', tool_use_id: message.tool_call_id, content: parts(message.content) }]);
			continue;
		}
		const nativeContent = Array.isArray(message.anthropic_content) || (message.role === 'assistant' && Array.isArray(message.gemini_parts));
		const content = Array.isArray(message.anthropic_content) ? structuredClone(message.anthropic_content)
			: nativeContent ? geminiPartsToAnthropicContent(message.gemini_parts, message.tool_calls, 400) : parts(message.content);
		if (message.role === 'assistant' && !nativeContent) {
			for (const tool of message.tool_calls || []) {
				const input = parseToolArguments(tool.function?.arguments);
				content.push({ type: 'tool_use', id: tool.id, name: tool.function?.name, input,
					...(toolThoughtSignature(tool) ? { thoughtSignature: toolThoughtSignature(tool) } : {}) });
			}
		}
		push(message.role === 'assistant' ? 'assistant' : 'user', content);
	}
	if (system.length) result.system = system;
	for (const field of ['temperature', 'top_p', 'top_k', 'thinking']) if (payload[field] !== undefined) result[field] = payload[field];
	if (payload.stop !== undefined) result.stop_sequences = Array.isArray(payload.stop) ? payload.stop : [payload.stop];
	if (Array.isArray(payload.tools)) result.tools = payload.tools.map(tool => ({ name: tool.function?.name, description: tool.function?.description || '', input_schema: tool.function?.parameters || { type: 'object', properties: {} }, ...(tool.function?.strict !== undefined ? { strict: tool.function.strict } : {}) }));
	if (payload.tool_choice !== undefined) {
		const choice = payload.tool_choice;
		result.tool_choice = choice === 'auto' ? { type: 'auto' } : choice === 'required' ? { type: 'any' }
			: choice === 'none' ? { type: 'none' } : choice?.function?.name ? { type: 'tool', name: choice.function.name } : undefined;
		if (!result.tool_choice) throw Object.assign(new Error('Unsupported tool_choice.'), { status: 400 });
		if (payload.parallel_tool_calls === false) result.tool_choice.disable_parallel_tool_use = true;
	} else if (payload.parallel_tool_calls === false && result.tools?.length) result.tool_choice = { type: 'auto', disable_parallel_tool_use: true };
	if (payload.response_format?.type === 'json_schema') result.output_config = { format: { type: 'json_schema', schema: payload.response_format.json_schema?.schema } };
	return result;
}

function anthropicFinishReason(reason) {
	if (reason === 'max_tokens' || reason === 'model_context_window_exceeded') return 'length';
	if (reason === 'tool_use') return 'tool_calls';
	if (reason === 'refusal') return 'content_filter';
	if (reason === 'end_turn' || reason === 'stop_sequence') return 'stop';
	throw new Error('Anthropic upstream returned an unsupported terminal state.');
}

function anthropicUpstreamUsage(usage = {}) {
	const cached = usage.cache_read_input_tokens || 0;
	const input = (usage.input_tokens || 0) + cached + (usage.cache_creation_input_tokens || 0);
	return { prompt_tokens: input, completion_tokens: usage.output_tokens || 0, total_tokens: input + (usage.output_tokens || 0),
		...(cached ? { prompt_tokens_details: { cached_tokens: cached } } : {}) };
}

function anthropicToOpenAIUpstreamResponse(data, model) {
	const content = Array.isArray(data.content) ? data.content : [];
	const tools = content.filter(block => block.type === 'tool_use').map(block => ({ id: block.id, type: 'function', function: { name: block.name, arguments: JSON.stringify(parseToolArguments(block.input, 502)) },
		...(toolThoughtSignature(block) ? { gemini_thought_signature: toolThoughtSignature(block) } : {}) }));
	const thinking = content.filter(block => block.type === 'thinking').map(block => block.thinking || '').join('');
	const message = { role: 'assistant', content: content.filter(block => block.type === 'text').map(block => block.text || '').join('') || null,
		anthropic_content: content };
	if (content.some(block => block.type === 'thinking' || toolThoughtSignature(block))) message.gemini_parts = anthropicContentToGeminiParts(content);
	if (tools.length) message.tool_calls = tools;
	if (thinking) message.reasoning_content = thinking;
	return { id: data.id || `chatcmpl-${crypto.randomUUID()}`, object: 'chat.completion', created: Math.floor(Date.now() / 1000), model,
		choices: [{ index: 0, message, finish_reason: anthropicFinishReason(data.stop_reason) }], usage: anthropicUpstreamUsage(data.usage),
		...(data.stop_sequence ? { anthropic_stop_sequence: data.stop_sequence } : {}) };
}

function anthropicToOpenAIUpstreamStream(upstreamBody, model) {
	const reader = upstreamBody.getReader();
	const decoder = new TextDecoder(), encoder = new TextEncoder();
	let buffer = '', dataLines = [], done = false, id = `chatcmpl-${crypto.randomUUID()}`, finishReason = 'stop';
	let usage = {}, nextTool = 0, nextBlock = 0;
	const blocks = new Map();
	const blockOrder = [];
	const created = Math.floor(Date.now() / 1000);
	function emit(controller, delta, finish = null, tokenUsage) {
		controller.enqueue(encoder.encode(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model,
			choices: delta === null ? [] : [{ index: 0, delta, finish_reason: finish }], ...(tokenUsage ? { usage: tokenUsage } : {}) })}\n\n`));
	}
	function flushBlocks(controller) {
		// Metadata is append-only on the wire. Emit signed thinking and complete tool
		// input once, together with their visible fields, in the original block order.
		// Text remains incremental whenever earlier blocks have finished.
		while (nextBlock < blockOrder.length) {
			const index = blockOrder[nextBlock], block = blocks.get(index);
			if (block.type === 'text') {
				const text = block.text.slice(block.sent);
				if (text) {
					emit(controller, { content: text, gemini_parts: [{ text, ...(block.signature ? { thoughtSignature: block.signature } : {}) }] });
					block.sent = block.text.length;
				}
				if (!block.complete) return;
			} else {
				if (!block.complete) return;
				if (block.type === 'thinking') {
					emit(controller, { reasoning_content: block.text,
						gemini_parts: [{ text: block.text, thought: true, ...(block.signature ? { thoughtSignature: block.signature } : {}) }],
						...(block.signature ? { anthropic_signature: block.signature, anthropic_block_index: index } : {}) });
				} else if (block.type === 'tool_use') {
					const input = parseToolArguments(block.arguments || '{}', 502);
					emit(controller, { tool_calls: [{ index: block.toolIndex, id: block.id, type: 'function',
						function: { name: block.name, arguments: JSON.stringify(input) },
						...(block.signature ? { gemini_thought_signature: block.signature } : {}) }],
						gemini_parts: [{ functionCall: { id: block.id, name: block.name, args: input },
							...(block.signature ? { thoughtSignature: block.signature } : {}) }] });
				}
			}
			nextBlock++;
		}
	}
	function event(controller) {
		if (!dataLines.length || done) return;
		const raw = dataLines.join('\n'); dataLines = [];
		const data = JSON.parse(raw);
		if (data.type === 'error') {
			controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: { message: data.error?.message || 'Anthropic streaming error.', type: 'upstream_error' } })}\n\n`));
			done = true;
		} else if (data.type === 'message_start') {
			id = data.message?.id || id; usage = { ...usage, ...data.message?.usage };
			emit(controller, { role: 'assistant', content: '' });
		} else if (data.type === 'content_block_start') {
			const block = data.content_block || {};
			if (blocks.has(data.index) || !['text', 'thinking', 'tool_use'].includes(block.type)) throw new Error('Unsupported Anthropic content block.');
			blocks.set(data.index, { type: block.type, toolIndex: block.type === 'tool_use' ? nextTool++ : null,
				id: block.id, name: block.name, text: block.type === 'thinking' ? block.thinking || '' : block.text || '', sent: 0,
				signature: block.type === 'thinking' ? block.signature || '' : toolThoughtSignature(block) || '',
				arguments: Object.keys(block.input || {}).length ? JSON.stringify(block.input) : '', complete: false });
			blockOrder.push(data.index); flushBlocks(controller);
		} else if (data.type === 'content_block_delta') {
			const delta = data.delta || {};
			const block = blocks.get(data.index);
			if (!block || block.complete) throw new Error('Invalid Anthropic content block delta.');
			if (delta.type === 'text_delta' && block.type === 'text') block.text += delta.text || '';
			else if (delta.type === 'thinking_delta' && block.type === 'thinking') block.text += delta.thinking || '';
			else if (delta.type === 'signature_delta' && block.type === 'thinking') block.signature += delta.signature || '';
			else if (delta.type === 'input_json_delta' && block.type === 'tool_use') block.arguments += delta.partial_json || '';
			else throw new Error('Unsupported Anthropic content block delta.');
			flushBlocks(controller);
		} else if (data.type === 'content_block_stop') {
			const block = blocks.get(data.index);
			if (!block || block.complete) throw new Error('Invalid Anthropic content block stop.');
			block.complete = true; flushBlocks(controller);
		} else if (data.type === 'message_delta') {
			finishReason = anthropicFinishReason(data.delta?.stop_reason); usage = { ...usage, ...data.usage };
		} else if (data.type === 'message_stop') {
			if (nextBlock !== blockOrder.length) throw new Error('Anthropic message ended with an incomplete content block.');
			emit(controller, {}, finishReason); emit(controller, null, null, anthropicUpstreamUsage(usage)); done = true;
		}
		if (done) controller.enqueue(encoder.encode('data: [DONE]\n\n'));
	}
	function parse(controller, final = false) {
		let position;
		while (!done && (position = buffer.indexOf('\n')) >= 0) {
			const line = buffer.slice(0, position).replace(/\r$/, ''); buffer = buffer.slice(position + 1);
			if (!line) event(controller); else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
		}
		if (final && !done) {
			if (buffer.startsWith('data:')) dataLines.push(buffer.slice(5).replace(/^ /, '').replace(/\r$/, ''));
			buffer = ''; event(controller);
		}
	}
	return new ReadableStream({
		async pull(controller) {
			try {
				while (!done) {
					const { value, done: ended } = await reader.read();
					buffer += ended ? decoder.decode() : decoder.decode(value, { stream: true });
					parse(controller, ended);
					if (done) { controller.close(); await reader.cancel(); return; }
					if (ended) throw new Error('Anthropic stream ended before message_stop.');
					if ((controller.desiredSize ?? 0) <= 0) return;
				}
			} catch (error) {
				if (!done) {
					controller.enqueue(encoder.encode('data: ' + JSON.stringify({ error: { type: 'upstream_error', message: 'Anthropic stream ended prematurely or returned invalid content.' } }) + '\n\n'));
					done = true; controller.close();
				}
				await reader.cancel(error).catch(() => {});
			}
		},
		cancel(reason) { done = true; return reader.cancel(reason); }
	});
}

function getAccountProvider(account) {
	if (typeof account?.provider === 'string' && account.provider) return account.provider.toLowerCase();
	if (account?.source === 'antigravity' || /^(1\/\/|ya29\.)/.test(account?.apiToken || '')) return 'antigravity';
	return 'cloudflare';
}

function parseUpstreamTarget(target, accounts = []) {
	if (/^(antigravity:|@antigravity\/)/i.test(target || '')) return { provider: 'antigravity', model: getAntigravityModelName(target) };
	const channel = /^upstream:([^:]+):(.+)$/.exec(target || '');
	if (channel) {
		const account = accounts.find(a => a.id === channel[1]);
		return { provider: account ? getAccountProvider(account) : 'unknown', accountId: channel[1], model: channel[2] };
	}
	const protocol = /^(openai|anthropic|gemini):(.+)$/.exec(target || '');
	return protocol ? { provider: protocol[1], model: protocol[2] } : { provider: 'cloudflare', model: target };
}

function getMatchingUpstreamAccounts(route, accounts) {
	return accounts.filter(account => account.status === 'active' && getAccountProvider(account) === route.provider
		&& (!route.accountId || account.id === route.accountId)
		&& (!Array.isArray(account.models) || account.models.length === 0 || account.models.includes(route.model)));
}

function shuffledUpstreams(accounts) {
	const copy = [...accounts];
	for (let i = copy.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[copy[i], copy[j]] = [copy[j], copy[i]];
	}
	return copy;
}

function normalizeUpstreamBaseUrl(account, provider = getAccountProvider(account)) {
	const defaults = { openai: 'https://api.openai.com/v1', anthropic: 'https://api.anthropic.com/v1', gemini: 'https://generativelanguage.googleapis.com/v1beta' };
	let url;
	try { url = new URL(validateProviderBaseUrl(account.baseUrl || defaults[provider])); } catch (_) { throw Object.assign(new Error('Use a public HTTPS upstream base URL, or HTTP localhost for local development.'), { status: 400 }); }
	const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
	if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) || url.username || url.password || url.search || url.hash) {
		throw Object.assign(new Error('Use an HTTPS base URL without credentials, query parameters or a fragment.'), { status: 400 });
	}
	url.pathname = url.pathname.replace(/\/+$/, '');
	return url.toString().replace(/\/$/, '');
}

function upstreamEndpoint(account, provider, operation) {
	let base = normalizeUpstreamBaseUrl(account, provider);
	const suffix = provider === 'openai' ? /\/(?:chat\/completions|embeddings|models)$/
		: provider === 'anthropic' ? /\/(?:messages|models)$/ : /\/models$/;
	const suppliedEndpoint = suffix.test(new URL(base).pathname);
	base = base.replace(suffix, '');
	const pathname = new URL(base).pathname;
	if (provider === 'gemini' && /\/models\//.test(pathname)) throw Object.assign(new Error('Gemini Base URL must end at the API version, not at a particular model action.'), { status: 400 });
	const versioned = /\/v\d+(?:beta\d*)?$/.test(pathname);
	// Google exposes an OpenAI-compatible root under /v1beta/openai, not /openai/v1.
	const openaiCompatibleRoot = provider === 'openai' && /\/openai$/i.test(pathname);
	if (!versioned && !suppliedEndpoint && !openaiCompatibleRoot) base += provider === 'gemini' ? '/v1beta' : '/v1';
	return `${base}/${operation}`;
}

async function fetchUpstream(url, options = {}, { headerTimeoutMs = 120000, bodyIdleTimeoutMs = 120000, maxResponseBytes = 32 * 1024 * 1024 } = {}, networkFetch = fetch) {
	const abort = new AbortController(), clientSignal = options.signal;
	let timer, closed = false, reader, output, rejectInterrupted, received = 0;
	const interrupted = new Promise((_, reject) => { rejectInterrupted = reject; });
	function cleanup() { clearTimeout(timer); clientSignal?.removeEventListener('abort', onClientAbort); }
	function cancelReader(reason) {
		if (!reader) return;
		try { Promise.resolve(reader.cancel(reason)).catch(() => {}); }
		catch (_) { /* Transport cancellation is best effort. */ }
	}
	function fail(error) {
		if (closed) return;
		closed = true; cleanup(); abort.abort(error); rejectInterrupted(error);
		output?.error(error);
		cancelReader(error);
	}
	function onClientAbort() { fail(new Error('Client cancelled the request.')); }
	function arm(milliseconds) { clearTimeout(timer); timer = setTimeout(() => fail(new Error('Upstream response timed out.')), milliseconds); timer?.unref?.(); }
	clientSignal?.addEventListener('abort', onClientAbort, { once: true });
	// Attach the rejection handler before an already-aborted signal is processed.
	interrupted.catch(() => {});
	if (clientSignal?.aborted) { onClientAbort(); throw abort.signal.reason; }
	arm(headerTimeoutMs);
	try {
		const pending = networkFetch(url, { method: 'POST', ...options, redirect: 'manual', signal: abort.signal }).then(response => {
			if (closed) { void response.body?.cancel().catch(() => {}); throw abort.signal.reason; }
			return response;
		});
		const response = await Promise.race([pending, interrupted]);
		if (!response.body) { closed = true; cleanup(); return response; }
		reader = response.body.getReader();
		arm(bodyIdleTimeoutMs);
		const body = new ReadableStream({
			start(controller) { output = controller; },
			async pull(controller) {
				try {
					const { value, done } = await reader.read();
					if (closed) return;
					if (done) { closed = true; cleanup(); controller.close(); return; }
					received += value.byteLength;
					if (received > maxResponseBytes) { fail(new Error('Upstream response exceeded the size limit.')); return; }
					arm(bodyIdleTimeoutMs); controller.enqueue(value);
				} catch (_) { fail(new Error('Upstream response body failed.')); }
			},
			cancel(reason) {
				if (closed) return;
				closed = true; cleanup(); abort.abort(reason);
				// Stop consuming locally even when the transport never acknowledges
				// cancellation. The signal still propagates; billing may continue.
				cancelReader(reason);
			}
		});
		return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
	} catch (error) { cleanup(); if (!closed) { closed = true; abort.abort(error); } throw error; }
}

function shouldRetryUpstream(status) {
	// Retry only explicit rejections. Timeouts, 5xx and decoding failures may follow a billed generation.
	return status === 401 || status === 403 || status === 404 || status === 429;
}

function isUpstreamErrorEnvelope(data) {
	return !!data && typeof data === 'object' && (data.success === false || data.type === 'error' || !!data.error || (Array.isArray(data.errors) ? data.errors.length > 0 : !!data.errors));
}

function upstreamErrorMessage(data) {
	const message = data?.error?.message || data?.errors?.[0]?.message || data?.message;
	return typeof message === 'string' ? message : 'Upstream rejected the request.';
}

function validUpstreamCompletion(data, provider) {
	if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
	if (provider === 'anthropic') return Array.isArray(data.content);
	if (provider === 'gemini') return (Array.isArray(data.candidates) && data.candidates.length > 0) || !!data.promptFeedback?.blockReason;
	return Array.isArray(data.choices) && data.choices.length > 0 && data.choices.every(choice => choice && choice.message && typeof choice.message === 'object');
}

function cloudflareModelPath(model) {
	if (typeof model !== 'string' || !/^@cf\/[A-Za-z0-9_-]+\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(model) || /(?:^|\/)\.{1,2}(?:\/|$)/.test(model)) {
		throw Object.assign(new Error('Invalid Cloudflare model ID.'), { status: 400 });
	}
	return '@cf/' + model.slice(4).split('/').map(segment => encodeURIComponent(segment)).join('/');
}

function redactUpstreamCredential(value, account) {
	let safe = String(value);
	if (account.apiToken) {
		for (const secret of new Set([account.apiToken, encodeURIComponent(account.apiToken)])) safe = safe.split(secret).join('[redacted]');
	}
	return safe;
}

function cleanUpstreamError(message, account) {
	return redactUpstreamCredential(message || 'Upstream request failed.', account).slice(0, 600);
}

// HTTP 200 may carry a provider error inside SSE. Redact errors and transport
// metadata before conversion, leaving normal generated text and signatures intact.
function sanitizeUpstreamErrorStream(upstreamBody, account, { openAI = false } = {}) {
	const reader = upstreamBody.getReader(), decoder = new TextDecoder(), encoder = new TextEncoder();
	let buffer = '', closed = false, terminalError = false;
	function redactErrorValue(value) {
		if (typeof value === 'string') return redactUpstreamCredential(value, account);
		if (Array.isArray(value)) return value.map(redactErrorValue);
		if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [redactUpstreamCredential(key, account), redactErrorValue(item)]));
		return value;
	}
	function safeFrame(frame) {
		const eventError = frame.split(/\r\n|\r|\n/).some(line => /^event:\s*error\s*$/i.test(line));
		// Comments, IDs, event names and unknown fields are transport metadata, not
		// generated content. Preserve their original line endings while redacting
		// exact credentials even when the frame has no JSON data or is a heartbeat.
		const segments = frame.split(/(\r\n|\r|\n)/);
		for (let index = 0; index < segments.length; index += 2) {
			if (!segments[index].startsWith('data:')) segments[index] = redactUpstreamCredential(segments[index], account);
		}
		const safeMetadataFrame = segments.join('');
		const lines = safeMetadataFrame.split(/\r\n|\r|\n/);
		const data = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).replace(/^ /, '')).join('\n');
		let parsed;
		try { parsed = JSON.parse(data); } catch (_) {
			if (!eventError && (!data.trim() || data.trim() === '[DONE]')) return safeMetadataFrame;
			// Non-JSON data is invalid for these protocols. Never reflect a provider's
			// raw diagnostic body, which may contain its Authorization header.
			parsed = { error: { message: 'Upstream stream error.', type: 'upstream_error' } };
		}
		if (!eventError && !isUpstreamErrorEnvelope(parsed)) {
			if (!openAI) return safeMetadataFrame;
			if (!parsed || !Array.isArray(parsed.choices)) throw new Error('Upstream returned an invalid completion stream envelope.');
			const metadata = lines.filter(line => !line.startsWith('data:')).join('\n');
			return (metadata ? metadata + '\n' : '') + 'data: ' + JSON.stringify(sanitizeOpenAIUpstreamResponse(parsed));
		}
		const safe = redactErrorValue(parsed);
		const details = safe?.error && typeof safe.error === 'object' && !Array.isArray(safe.error) ? safe.error : {};
		terminalError = true;
		return 'event: error\ndata: ' + JSON.stringify({ type: 'error', error: { ...details, type: details.type || 'api_error', message: cleanUpstreamError(upstreamErrorMessage(parsed), account) } });
	}
	return new ReadableStream({
		async pull(controller) {
			try {
				let emitted = false;
				while (!closed && !emitted) {
					const { value, done } = await reader.read();
					buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
					let separator;
					while ((separator = /\r\n\r\n|\n\n|\r\r/.exec(buffer))) {
						const frame = buffer.slice(0, separator.index);
						buffer = buffer.slice(separator.index + separator[0].length);
						controller.enqueue(encoder.encode(safeFrame(frame) + separator[0]));
						emitted = true;
						if (terminalError) { closed = true; controller.close(); await reader.cancel().catch(() => {}); return; }
					}
					if (done) {
						if (buffer) controller.enqueue(encoder.encode(safeFrame(buffer)));
						closed = true;
						controller.close();
						return;
					}
				}
			} catch (error) {
				closed = true;
				controller.error(new Error(cleanUpstreamError(error?.message || 'Upstream stream failed.', account)));
				await reader.cancel().catch(() => {});
			}
		},
		cancel(reason) { closed = true; return reader.cancel(reason); }
	});
}

async function upstreamFailure(response, account) {
	let message = 'Upstream request failed.';
	try {
		const text = await response.text();
		try { const data = JSON.parse(text); message = data.error?.message || data.errors?.[0]?.message || data.message || message; }
		catch (_) { /* Do not expose unstructured upstream pages or reflected credentials. */ }
	} catch (_) { }
	return { success: false, status: response.status === 400 || response.status === 422 ? 400 : response.status === 429 ? 429 : 502,
		error: cleanUpstreamError(message, account) };
}

// 显式协议前缀和已声明的模型路由到对应服务，未声明模型不会成为开放透传。
async function resolveModelName(model, env) {
	if (typeof model !== 'string' || !model) return null;
	if (model.startsWith('@cf/')) return model;
	if (model.startsWith('antigravity:') || model.startsWith('@antigravity/')) return model;
	if (/^(openai|anthropic|gemini):.+/.test(model) || /^upstream:[^:]+:.+/.test(model)) return model;
	const customMap = await getCustomModelMap(env);
	const mappedModel = Object.hasOwn(customMap, model) ? customMap[model] : null;
	const accounts = await getAccounts(env);
	const target = typeof mappedModel === 'string' && mappedModel ? mappedModel : model;
	if (/^(@cf\/|antigravity:|@antigravity\/|openai:|anthropic:|gemini:|upstream:)/.test(target)) return target;
	const matching = accounts.filter(a => a.status === 'active' && ['openai', 'anthropic', 'gemini'].includes(getAccountProvider(a))
		&& Array.isArray(a.models) && a.models.includes(target));
	if (matching.length) return `${getAccountProvider(matching[0])}:${target}`;
	if (/^(claude-|gemini-)/i.test(target) && (await hasAntigravityConfigured(env))) return `antigravity:${target}`;
	if (typeof mappedModel === 'string' && mappedModel) return mappedModel;
	return null;
}

// 对话补全 / 文本补全 的代理处理函数
async function handleCompletions(request, env, pathname, parsedBody) {
	// Internal protocol adapters pass their already-bounded input directly. Reading
	// a serialized conversion again would apply the wire limit to duplicated metadata.
	let body = parsedBody;
	if (body === undefined) {
		try { body = await readRequestJson(request); }
		catch (error) { return requestJsonErrorResponse(request, error); }
	}

	if (!body || typeof body !== 'object' || Array.isArray(body)) {
		return new Response(JSON.stringify({ error: { message: "Request body must be an object", type: "invalid_request_error" } }), { status: 400, headers: { 'Content-Type': 'application/json' } });
	}
	const { model, messages, prompt, stream } = body;
	const isLegacy = pathname === '/v1/completions';

	if (typeof model !== 'string' || !model.trim()) {
		return new Response(JSON.stringify({ error: { message: "model must be a non-empty string", type: "invalid_request_error" } }), { status: 400, headers: { 'Content-Type': 'application/json' } });
	}
	if (!isLegacy && (!Array.isArray(messages) || messages.length === 0)) {
		return new Response(JSON.stringify({ error: { message: "messages must be a non-empty array", type: "invalid_request_error" } }), { status: 400, headers: { 'Content-Type': 'application/json' } });
	}
	if (isLegacy && typeof prompt !== 'string') {
		return new Response(JSON.stringify({ error: { message: "prompt must be a string", type: "invalid_request_error" } }), { status: 400, headers: { 'Content-Type': 'application/json' } });
	}

	// 解析模型名映射
	const cfModel = await resolveModelName(model, env);
	if (!cfModel) {
		return new Response(JSON.stringify({ error: { message: `Model not found: ${model}`, type: "invalid_request_error", code: "model_not_found" } }), { status: 400, headers: { 'Content-Type': 'application/json' } });
	}

	if (typeof isAntigravityTarget === 'function' && isAntigravityTarget(cfModel)) {
		return handleAntigravityCompletions(body, env, cfModel, isLegacy, pathname, request.signal);
	}

	// 构造发给 Cloudflare 的请求体
	const cfPayload = {
		model: cfModel,
		messages: pathname === '/v1/chat/completions' ? messages : [{ role: 'user', content: prompt }],
		stream: !!stream,
	};

	const passthroughFields = [
		'temperature', 'max_tokens', 'top_p', 'n',
		'stop', 'presence_penalty', 'frequency_penalty',
		'logprobs', 'top_logprobs', 'seed', 'user',
		'tools', 'tool_choice', 'parallel_tool_calls',
		'response_format', 'stream_options', 'max_completion_tokens', 'reasoning_effort',
		'thinking', 'top_k', 'gemini_extra', 'thinking_config',
	];
	for (const field of passthroughFields) {
		if (body[field] !== undefined) cfPayload[field] = body[field];
	}
	if (isLegacy && typeof body.logprobs === 'number') {
		cfPayload.logprobs = true;
		cfPayload.top_logprobs = body.logprobs;
	}

	const result = await callOpenAICompatibleAPI(cfPayload, env, stream, request.signal);

	if (!result.success) {
		return new Response(JSON.stringify({
			error: { message: result.error, type: "server_error" }
		}), { status: result.status || 502, headers: { 'Content-Type': 'application/json' } });
	}

	if (stream) {
		const transformedStream = isLegacy
			? legacyCompletionStream(result.stream, model)
			: passthroughStream(result.stream, model);
		return new Response(transformedStream, {
			headers: {
				'Content-Type': 'text/event-stream',
				'Cache-Control': 'no-cache',
			},
		});
	} else {
		const cfJson = result.data;
		if (cfJson.model !== undefined) cfJson.model = model;
		return new Response(JSON.stringify(isLegacy ? toLegacyCompletion(cfJson, model) : cfJson), {
			headers: { 'Content-Type': 'application/json' },
		});
	}
}

// ----------------------------------------------------
// Anthropic Messages API → OpenAI Chat Completions 格式转换
// ----------------------------------------------------
function toolThoughtSignature(tool) {
	return tool?.thoughtSignature || tool?.gemini_thought_signature || tool?.extra_content?.google?.thought_signature;
}

function parseToolArguments(value, status = 400) {
	try {
		const parsed = typeof value === 'string' ? JSON.parse(value) : value ?? {};
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
		return parsed;
	} catch (_) {
		throw Object.assign(new Error('Tool call arguments must contain a valid JSON object.'), { status });
	}
}

function protocolJsonEqual(left, right) {
	const canonical = value => Array.isArray(value) ? value.map(canonical)
		: value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
	return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

function visibleReplayContent(content) {
	const values = typeof content === 'string' ? [{ type: 'text', text: content }] : content ?? [];
	if (!Array.isArray(values)) throw new TypeError('Replay content must be text or content parts.');
	const result = [];
	for (const part of values) {
		if (part?.type === 'text') {
			if (!part.text) continue;
			if (result.at(-1)?.type === 'text') result.at(-1).text += part.text;
			else result.push({ type: 'text', text: part.text });
		} else if (part?.type === 'image_url') {
			const image = typeof part.image_url === 'string' ? { url: part.image_url } : part.image_url;
			result.push({ type: 'image_url', url: image?.url });
		} else throw new TypeError('Unsupported replay content part.');
	}
	return result;
}

// Signed provider history may accompany a visible message, but cannot replace it
// with different text, reasoning, tool names, arguments, or media.
function validateReplayMetadata(message) {
	const validateParts = parts => {
		if (!Array.isArray(parts)) throw new TypeError('Replay metadata must be an array.');
		parts = parts.map(normalizeGeminiPart);
		for (const part of parts) {
			if (!part || typeof part !== 'object' || Array.isArray(part)
				|| Object.keys(part).some(key => !['text', 'thought', 'thoughtSignature', 'functionCall', 'inlineData', 'fileData'].includes(key))
				|| ['text', 'functionCall', 'inlineData', 'fileData'].filter(key => part[key] !== undefined).length !== 1
				|| (part.thought && typeof part.text !== 'string')) throw new TypeError('Unsupported replay metadata part.');
			if (part.functionCall && Object.keys(part.functionCall).some(key => !['id', 'name', 'args'].includes(key))) throw new TypeError('Unsupported replay function call field.');
			if (part.inlineData && Object.keys(part.inlineData).some(key => !['mimeType', 'data'].includes(key))) throw new TypeError('Unsupported replay inline media field.');
			if (part.fileData && Object.keys(part.fileData).some(key => !['mimeType', 'fileUri'].includes(key))) throw new TypeError('Unsupported replay file media field.');
		}
		const ordinary = parts.filter(part => !part.thought && !part.functionCall);
		if (!protocolJsonEqual(visibleReplayContent(geminiProtocolContent(ordinary)), visibleReplayContent(message.content))) throw new TypeError('Replay metadata does not match the visible message content.');
		const thoughts = parts.filter(part => part.thought).map(part => part.text || '').join('');
		if (thoughts !== (message.reasoning_content || '')) throw new TypeError('Replay metadata does not match the visible reasoning content.');
		const calls = parts.filter(part => part.functionCall).map(part => part.functionCall), tools = message.tool_calls || [];
		if (!Array.isArray(tools) || calls.length !== tools.length || (calls.length && message.role !== 'assistant')) throw new TypeError('Replay metadata does not match the visible tool calls.');
		for (let index = 0; index < calls.length; index++) {
			const call = calls[index], tool = tools[index];
			if (call.name !== tool.function?.name || (call.id !== undefined && call.id !== tool.id)
				|| !protocolJsonEqual(parseToolArguments(call.args), parseToolArguments(tool.function?.arguments))) throw new TypeError('Replay metadata does not match the visible tool calls.');
		}
	};
	if (message.gemini_parts !== undefined) validateParts(message.gemini_parts);
	if (message.anthropic_content !== undefined) {
		if (message.role !== 'assistant' || !Array.isArray(message.anthropic_content)
			|| message.anthropic_content.some(block => !['text', 'thinking', 'redacted_thinking', 'tool_use'].includes(block?.type))) throw new TypeError('Unsupported Anthropic replay metadata.');
		validateParts(anthropicContentToGeminiParts(message.anthropic_content));
	}
}

function anthropicContentToGeminiParts(content) {
	return content.flatMap(block => {
		if (block.type === 'tool_use') return [{ functionCall: { id: block.id, name: block.name, args: parseToolArguments(block.input) },
			...(toolThoughtSignature(block) ? { thoughtSignature: toolThoughtSignature(block) } : {}) }];
		if (block.type === 'thinking') return [{ text: block.thinking || '', thought: true, ...(block.signature ? { thoughtSignature: block.signature } : {}) }];
		if (block.type === 'text') return [{ text: block.text || '', ...(toolThoughtSignature(block) ? { thoughtSignature: toolThoughtSignature(block) } : {}) }];
		return [];
	});
}

function geminiPartsToAnthropicContent(parts, tools = [], status = 502) {
	const content = [];
	let toolIndex = 0;
	for (const part of parts) {
		if (part.functionCall) {
			const tool = tools?.[toolIndex++];
			content.push({ type: 'tool_use', id: tool?.id || part.functionCall.id || `toolu_${crypto.randomUUID()}`, name: part.functionCall.name,
				input: parseToolArguments(part.functionCall.args, status), ...(part.thoughtSignature ? { thoughtSignature: part.thoughtSignature } : {}) });
		} else if (part.thought) {
			const previous = content.at(-1);
			if (previous?.type === 'thinking' && !previous.signature) {
				previous.thinking += part.text || '';
				if (part.thoughtSignature) previous.signature = part.thoughtSignature;
			} else content.push({ type: 'thinking', thinking: part.text || '', ...(part.thoughtSignature ? { signature: part.thoughtSignature } : {}) });
		} else if (typeof part.text === 'string') content.push({ type: 'text', text: part.text, ...(part.thoughtSignature ? { thoughtSignature: part.thoughtSignature } : {}) });
		else throw Object.assign(new Error('Upstream content cannot be represented as an Anthropic message.'), { status });
	}
	return content;
}

function convertAnthropicToOpenAI(anthropicBody) {
	rejectAnthropicProviderTools(anthropicBody.tools);
	validateToolStrictness(anthropicBody.tools, 'openai', false);
	for (const field of ['thinking', 'output_config', 'output_format']) {
		if (anthropicBody[field] !== undefined) throw Object.assign(new Error(`Anthropic ${field} cannot be represented by this cross-protocol adapter. Use an Anthropic upstream to preserve this constraint.`), { status: 400 });
	}
	const openaiBody = {};
	if (anthropicBody.top_k !== undefined) openaiBody.top_k = anthropicBody.top_k;

	// model 直接映射
	openaiBody.model = anthropicBody.model;

	// max_tokens 直接映射
	if (anthropicBody.max_tokens !== undefined) {
		openaiBody.max_tokens = anthropicBody.max_tokens;
	}

	// stream 直接映射
	if (anthropicBody.stream !== undefined) {
		openaiBody.stream = anthropicBody.stream;
	}

	// temperature 直接映射
	if (anthropicBody.temperature !== undefined) {
		openaiBody.temperature = anthropicBody.temperature;
	}

	// top_p 直接映射
	if (anthropicBody.top_p !== undefined) {
		openaiBody.top_p = anthropicBody.top_p;
	}

	// stop_sequences → stop
	if (anthropicBody.stop_sequences !== undefined) {
		openaiBody.stop = anthropicBody.stop_sequences;
	}

	// 构建 OpenAI 格式的 messages 数组
	const openaiMessages = [];

	// Anthropic system 字段 → OpenAI system role message (插入到 messages 最前面)
	if (anthropicBody.system) {
		let systemContent = '';
		if (typeof anthropicBody.system === 'string') {
			systemContent = anthropicBody.system;
		} else if (Array.isArray(anthropicBody.system)) {
			// system 为数组格式：[{type: "text", text: "..."}, ...]
			for (const block of anthropicBody.system) {
				if (block?.type !== 'text') throw new TypeError('Unsupported Anthropic system content block.');
				if (block.type === 'text' && block.text) {
					systemContent += block.text + '\n';
				}
			}
			systemContent = systemContent.trim();
		}
		if (systemContent) {
			openaiMessages.push({ role: 'system', content: systemContent });
		}
	}

	// 转换 messages
	for (const msg of anthropicBody.messages) {
		const role = msg.role;
		const content = msg.content;
		if (!['user', 'assistant'].includes(role)) throw new TypeError('Unsupported Anthropic message role.');
		if (typeof content !== 'string' && !Array.isArray(content)) throw new TypeError('Unsupported Anthropic message content.');

		// Anthropic 的 content 可能是字符串或数组
		if (typeof content === 'string') {
			openaiMessages.push({ role, content });
		} else if (Array.isArray(content)) {

			// assistant 消息：text 和 tool_use 需合并为一条消息（Bug #4）
			if (role === 'assistant') {
				let textContent = '';
				const toolCalls = [];

				for (const block of content) {
					if (!['text', 'tool_use', 'thinking'].includes(block?.type)) throw new TypeError('This Anthropic assistant content cannot be translated to the selected upstream.');
					if (block.type === 'text') {
						textContent += block.text || '';
					} else if (block.type === 'tool_use') {
						toolCalls.push({
							id: block.id,
							type: 'function',
							...(toolThoughtSignature(block) ? { gemini_thought_signature: toolThoughtSignature(block) } : {}),
							function: {
								name: block.name,
								arguments: JSON.stringify(parseToolArguments(block.input))
							}
						});
					}
				}

				const assistantMsg = { role: 'assistant', content: textContent || null };
				const thinking = content.filter(block => block.type === 'thinking').map(block => block.thinking || '').join('');
				if (thinking) assistantMsg.reasoning_content = thinking;
				const geminiParts = anthropicContentToGeminiParts(content);
				if (geminiParts.some(part => part.thoughtSignature || part.thought)) assistantMsg.gemini_parts = geminiParts;
				if (toolCalls.length > 0) {
					assistantMsg.tool_calls = toolCalls;
				}
				openaiMessages.push(assistantMsg);
				continue;
			}

			// user 消息：先处理 tool_result，再处理 text/image（Bug #5）
			if (role === 'user') {
				if (content.some(block => !['text', 'image', 'tool_result'].includes(block?.type))) throw new TypeError('This Anthropic user content cannot be translated to the selected upstream.');
				// 先处理 tool_result 块
				for (const block of content) {
					if (block.type === 'tool_result') {
						let resultContent = '';
						if (typeof block.content === 'string') {
							resultContent = block.content;
						} else if (Array.isArray(block.content)) {
							for (const c of block.content) {
								if (c?.type !== 'text') throw new TypeError('This upstream adapter only supports text inside Anthropic tool results.');
								if (c.type === 'text' && c.text) {
									resultContent += c.text;
								}
							}
						} else if (block.content !== undefined) throw new TypeError('Unsupported Anthropic tool result content.');
						const toolMsg = {
							role: 'tool',
							tool_call_id: block.tool_use_id,
							content: resultContent
						};
						if (block.name) toolMsg.name = block.name;
						openaiMessages.push(toolMsg);
					}
				}

				// 再处理剩余的 text 和 image 块
				const openaiContentParts = [];
				for (const block of content) {
					if (block.type === 'text') {
						openaiContentParts.push({ type: 'text', text: block.text || '' });
					} else if (block.type === 'image') {
						// Anthropic image source → OpenAI image_url
						const source = block.source || {};
						let imageUrl = '';
						if (source.type === 'url' && source.url) {
							// URL 类型图片（Bug #3）
							imageUrl = source.url;
						} else if (source.data) {
							const mediaType = source.media_type || 'image/png';
							imageUrl = `data:${mediaType};base64,${source.data}`;
						}
						if (imageUrl) {
							openaiContentParts.push({
								type: 'image_url',
								image_url: { url: imageUrl }
							});
						} else throw new TypeError('Invalid Anthropic image source.');
					}
				}

				if (openaiContentParts.length > 0) {
					openaiMessages.push({ role: 'user', content: openaiContentParts });
				}
				continue;
			}

			// 兜底：其他角色只处理 text 块
			const openaiContentParts = [];
			for (const block of content) {
				if (block.type === 'text') {
					openaiContentParts.push({ type: 'text', text: block.text || '' });
				}
			}
			if (openaiContentParts.length > 0) {
				openaiMessages.push({ role, content: openaiContentParts });
			}
		}
	}

	openaiBody.messages = openaiMessages;

	// tools 字段转换：Anthropic 格式 → OpenAI 格式
	if (anthropicBody.tools && Array.isArray(anthropicBody.tools)) {
		openaiBody.tools = anthropicBody.tools.map(tool => ({
			type: 'function',
			function: {
				name: tool.name,
				description: tool.description || '',
				parameters: tool.input_schema || {},
				...(tool.strict !== undefined ? { strict: tool.strict } : {})
			}
		}));
	}

	// tool_choice 转换
	if (anthropicBody.tool_choice) {
		const tc = anthropicBody.tool_choice;
		if (tc.type === 'auto') {
			openaiBody.tool_choice = 'auto';
		} else if (tc.type === 'any') {
			openaiBody.tool_choice = 'required';
		} else if (tc.type === 'tool' && tc.name) {
			openaiBody.tool_choice = { type: 'function', function: { name: tc.name } };
		} else if (tc.type === 'none') {
			openaiBody.tool_choice = 'none';
		} else throw Object.assign(new Error('Unsupported tool_choice.'), { status: 400 });
		if (tc.disable_parallel_tool_use !== undefined) openaiBody.parallel_tool_calls = !tc.disable_parallel_tool_use;
	}

	return openaiBody;
}

// ----------------------------------------------------
// OpenAI Chat Completion 响应 → Anthropic Messages 格式转换
// ----------------------------------------------------
function convertOpenAIToAnthropic(openaiResponse, originalModel) {
	const choice = openaiResponse.choices?.[0] || {};
	const message = choice.message || {};
	const refused = choice.finish_reason === 'content_filter' || (typeof message.refusal === 'string' && message.refusal.length > 0);

	const anthropicResponse = {
		id: `msg_${crypto.randomUUID()}`,
		type: 'message',
		role: 'assistant',
		content: [],
		model: originalModel,
		stop_reason: null,
		stop_sequence: null,
		usage: {
			input_tokens: openaiResponse.usage?.prompt_tokens || 0,
			output_tokens: openaiResponse.usage?.completion_tokens || 0
		}
	};

	// 文本内容 → text block
	if (message.content) {
		anthropicResponse.content.push({
			type: 'text',
			text: message.content
		});
	}
	if (typeof message.refusal === 'string' && message.refusal) {
		anthropicResponse.content.push({ type: 'text', text: message.refusal });
	}

	// tool_calls → tool_use blocks
	if (!refused && message.tool_calls && Array.isArray(message.tool_calls)) {
		for (const tc of message.tool_calls) {
			const inputObj = parseToolArguments(tc.function?.arguments, 502);
			anthropicResponse.content.push({
				type: 'tool_use',
				id: tc.id,
				name: tc.function.name,
				input: inputObj,
				...(toolThoughtSignature(tc) ? { thoughtSignature: toolThoughtSignature(tc) } : {})
			});
		}
	}
	// Keep opaque Gemini parts in their original order, including signed thinking/text.
	if (!refused && Array.isArray(message.gemini_parts)) {
		anthropicResponse.content = geminiPartsToAnthropicContent(message.gemini_parts, message.tool_calls);
	}

	// finish_reason → stop_reason 映射
	const finishReason = choice.finish_reason;
	if (refused) {
		anthropicResponse.stop_reason = 'refusal';
	} else if (finishReason === 'stop') {
		anthropicResponse.stop_reason = 'end_turn';
	} else if (finishReason === 'tool_calls') {
		anthropicResponse.stop_reason = 'tool_use';
	} else if (finishReason === 'length') {
		anthropicResponse.stop_reason = 'max_tokens';
	} else {
		anthropicResponse.stop_reason = finishReason || 'end_turn';
	}

	return anthropicResponse;
}

// ----------------------------------------------------
// OpenAI 错误响应 → Anthropic 错误格式转换
// ----------------------------------------------------
function convertOpenAIErrorToAnthropic(openaiError, statusCode) {
	return {
		type: 'error',
		error: {
			type: 'api_error',
			message: openaiError?.error?.message || openaiError?.message || 'Unknown error'
		}
	};
}

// ----------------------------------------------------
// Anthropic /v1/messages 路由处理函数
// ----------------------------------------------------
async function handleMessages(request, env) {
	// 认证由 handleV1Proxy 的 checkProxyAuth 统一处理（支持 x-api-key + Bearer）

	// 解析请求体
	let anthropicBody;
	try {
		anthropicBody = await readRequestJson(request);
	} catch (e) {
		return requestJsonErrorResponse(request, e);
	}

	// 基本参数校验
	if (!anthropicBody || typeof anthropicBody !== 'object' || Array.isArray(anthropicBody)
		|| !Array.isArray(anthropicBody.messages) || !anthropicBody.messages.length) {
		return new Response(JSON.stringify({
			type: 'error',
			error: { type: 'invalid_request_error', message: 'messages field is required and must be an array.' }
		}), { status: 400, headers: { 'Content-Type': 'application/json' } });
	}
	if (!anthropicBody.max_tokens) {
		return new Response(JSON.stringify({
			type: 'error',
			error: { type: 'invalid_request_error', message: 'max_tokens is required.' }
		}), { status: 400, headers: { 'Content-Type': 'application/json' } });
	}

	// 解析模型名映射
	const model = anthropicBody.model;
	const cfModel = await resolveModelName(model, env);
	if (!cfModel) {
		return new Response(JSON.stringify({
			type: 'error',
			error: { type: 'invalid_request_error', message: `Model not found: ${model}` }
		}), { status: 400, headers: { 'Content-Type': 'application/json' } });
	}

	if (typeof isAntigravityTarget === 'function' && isAntigravityTarget(cfModel)) {
		return handleAntigravityMessages(anthropicBody, env, cfModel, request.signal);
	}

	// Preserve native content for an Anthropic upstream. Other providers validate
	// and convert it only after routing, before any generation request is made.
	const openaiBody = { model: cfModel, _anthropicRequest: anthropicBody, _outputProtocol: 'anthropic' };

	const stream = !!anthropicBody.stream;

	const result = await callOpenAICompatibleAPI(openaiBody, env, stream, request.signal);

	if (!result.success) {
		// 尝试解析 CF 错误详情
		let errorDetail;
		try {
			if (result.error && result.error.includes('CF API returned')) {
				const match = result.error.match(/CF API returned \d+: (.+)/);
				if (match) {
					errorDetail = JSON.parse(match[1]);
				}
			}
		} catch (_) { }

		const anthropicError = convertOpenAIErrorToAnthropic(
			errorDetail || { message: result.error },
			result.status || 502
		);
		return new Response(JSON.stringify(anthropicError), {
			status: result.status || 502,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	if (stream) {
		// 流式：转换流
		const transformedStream = result.nativeAnthropic ? validatedNativeAnthropicStream(result.stream) : anthropicStreamTransform(result.stream, model, anthropicBody.messages);
		return new Response(transformedStream, {
			headers: {
				'Content-Type': 'text/event-stream',
				'Cache-Control': 'no-cache',
			},
		});
	} else {
		// 非流式：转换响应
		const openaiResponse = result.data;
		let anthropicResponse;
		try { anthropicResponse = result.nativeAnthropic ? { ...openaiResponse, model } : convertOpenAIToAnthropic(openaiResponse, model); }
		catch (_) { return Response.json({ type: 'error', error: { type: 'api_error', message: 'Upstream response contains invalid tool arguments or unsupported content.' } }, { status: 502 }); }
		return new Response(JSON.stringify(anthropicResponse), {
			headers: { 'Content-Type': 'application/json' },
		});
	}
}

// ----------------------------------------------------
// Anthropic SSE 流式转换
// 将 OpenAI SSE 格式实时转换为 Anthropic SSE 格式
// ----------------------------------------------------
function anthropicStreamTransform(upstreamBody, modelName, originalMessages) {
	const reader = upstreamBody.getReader();
	const decoder = new TextDecoder();
	const encoder = new TextEncoder();
	const messageId = `msg_${crypto.randomUUID()}`;
	const tools = new Map();
	let buffer = '';
	let eventData = [];
	let nextBlockIndex = 0;
	let textBlockIndex = null;
	let thinkingBlockIndex = null;
	let streamedTool = null;
	let trailingText = '';
	let streamStarted = false;
	let contentFinished = false;
	let finalized = false;
	let finishReason = null;
	let refused = false;
	let inputTokens = 0;
	let outputTokens = 0;
	let enqueuedAny = false;

	function emit(controller, event) {
		controller.enqueue(encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`));
		enqueuedAny = true;
	}

	function startMessage(controller) {
		if (streamStarted) return;
		streamStarted = true;
		emit(controller, {
			type: 'message_start',
			message: {
				id: messageId, type: 'message', role: 'assistant', content: [], model: modelName,
				stop_reason: null, stop_sequence: null,
				usage: { input_tokens: inputTokens, output_tokens: outputTokens }
			}
		});
	}

	function stopBlock(controller, index) {
		emit(controller, { type: 'content_block_stop', index });
	}

	function closeText(controller) {
		if (textBlockIndex === null) return;
		stopBlock(controller, textBlockIndex);
		textBlockIndex = null;
	}
	function closeThinking(controller) {
		if (thinkingBlockIndex === null) return;
		stopBlock(controller, thinkingBlockIndex); thinkingBlockIndex = null;
	}

	function sendText(controller, text) {
		if (!text) return;
		startMessage(controller);
		closeThinking(controller);
		if (textBlockIndex === null) {
			textBlockIndex = nextBlockIndex++;
			emit(controller, { type: 'content_block_start', index: textBlockIndex, content_block: { type: 'text', text: '' } });
		}
		emit(controller, { type: 'content_block_delta', index: textBlockIndex, delta: { type: 'text_delta', text } });
	}

	function startTool(controller, tool) {
		startMessage(controller);
		closeText(controller);
		closeThinking(controller);
		tool.blockIndex = nextBlockIndex++;
		emit(controller, {
			type: 'content_block_start', index: tool.blockIndex,
			content_block: { type: 'tool_use', id: tool.id, name: tool.name, input: {}, ...(tool.signature ? { thoughtSignature: tool.signature } : {}) }
		});
	}

	function sendToolArguments(controller, tool) {
		for (; tool.sentChunks < tool.chunks.length; tool.sentChunks++) {
			emit(controller, {
				type: 'content_block_delta', index: tool.blockIndex,
				delta: { type: 'input_json_delta', partial_json: tool.chunks[tool.sentChunks] }
			});
		}
	}

	function finishContent(controller) {
		if (contentFinished) return;
		if (finishReason !== 'length' && !refused) for (const tool of tools.values()) parseToolArguments(tool.chunks.join(''), 502);
		contentFinished = true;
		closeText(controller);
		closeThinking(controller);
		if (streamedTool) {
			sendToolArguments(controller, streamedTool);
			stopBlock(controller, streamedTool.blockIndex);
		}
		// OpenAI may interleave tools, while Anthropic consumers expect complete blocks.
		// Stream the first tool immediately and buffer later tools until their input is complete.
		for (const [, tool] of [...tools.entries()].sort(([a], [b]) => a - b)) {
			if (tool === streamedTool || refused) continue;
			startTool(controller, tool);
			sendToolArguments(controller, tool);
			stopBlock(controller, tool.blockIndex);
		}
		if (trailingText) {
			sendText(controller, trailingText);
			closeText(controller);
			trailingText = '';
		}
	}

	function finishMessage(controller) {
		if (finalized) return;
		if (!finishReason) throw new Error('Upstream stream ended before a finish reason.');
		startMessage(controller);
		finishContent(controller);
		const stopReason = refused ? 'refusal' : finishReason === 'length' ? 'max_tokens'
			: finishReason === 'tool_calls' || (!finishReason && tools.size) ? 'tool_use'
			: 'end_turn';
		emit(controller, {
			type: 'message_delta', delta: { stop_reason: stopReason, stop_sequence: null },
			usage: { input_tokens: inputTokens, output_tokens: outputTokens }
		});
		emit(controller, { type: 'message_stop' });
		finalized = true;
	}

	function processEvent(controller) {
		if (!eventData.length || finalized) return;
		const data = eventData.join('\n');
		eventData = [];
		if (data.trim() === '[DONE]') {
			finishMessage(controller);
			return;
		}
		let chunk;
		try { chunk = JSON.parse(data); } catch (_) { throw new Error('Upstream returned invalid stream JSON.'); }
		if (chunk.error) {
			emit(controller, { type: 'error', error: { type: 'api_error', message: chunk.error.message || 'Upstream stream error' } });
			finalized = true;
			return;
		}
		// The final usage-only OpenAI chunk has an empty choices array.
		if (chunk.usage) {
			inputTokens = chunk.usage.prompt_tokens ?? inputTokens;
			outputTokens = chunk.usage.completion_tokens ?? outputTokens;
		}
		const choice = chunk.choices?.[0];
		if (!choice) return;
		const delta = choice.delta || {};
		if (choice.finish_reason === 'content_filter' || (typeof delta.refusal === 'string' && delta.refusal)) refused = true;
		if (!contentFinished) {
			if (Array.isArray(delta.gemini_parts)) {
				let callIndex = 0;
				for (const part of delta.gemini_parts) {
					startMessage(controller); closeText(controller);
					if (!part.thought) closeThinking(controller);
					if (part.functionCall) {
						if (refused) continue;
						const tc = delta.tool_calls?.[callIndex++];
						const input = parseToolArguments(part.functionCall.args, 502), index = nextBlockIndex++;
						emit(controller, { type: 'content_block_start', index, content_block: { type: 'tool_use', id: tc?.id || part.functionCall.id || `toolu_${crypto.randomUUID()}`, name: part.functionCall.name, input: {}, ...(part.thoughtSignature ? { thoughtSignature: part.thoughtSignature } : {}) } });
						emit(controller, { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) } });
						stopBlock(controller, index);
					} else if (typeof part.text === 'string') {
						if (part.thought) {
							if (thinkingBlockIndex === null) {
								thinkingBlockIndex = nextBlockIndex++;
								emit(controller, { type: 'content_block_start', index: thinkingBlockIndex, content_block: { type: 'thinking', thinking: '' } });
							}
							emit(controller, { type: 'content_block_delta', index: thinkingBlockIndex, delta: { type: 'thinking_delta', thinking: part.text } });
							if (part.thoughtSignature) { emit(controller, { type: 'content_block_delta', index: thinkingBlockIndex, delta: { type: 'signature_delta', signature: part.thoughtSignature } }); closeThinking(controller); }
						} else {
							const index = nextBlockIndex++;
							emit(controller, { type: 'content_block_start', index, content_block: { type: 'text', text: '', ...(part.thoughtSignature ? { thoughtSignature: part.thoughtSignature } : {}) } });
							emit(controller, { type: 'content_block_delta', index, delta: { type: 'text_delta', text: part.text } });
							stopBlock(controller, index);
						}
					} else throw new Error('Unsupported Gemini stream content.');
				}
			} else if (delta.content) {
				if (tools.size) trailingText += delta.content;
				else sendText(controller, delta.content);
			}
			if (typeof delta.refusal === 'string' && delta.refusal) {
				if (tools.size) trailingText += delta.refusal;
				else sendText(controller, delta.refusal);
			}
			if (!refused && !Array.isArray(delta.gemini_parts) && Array.isArray(delta.tool_calls)) {
				startMessage(controller);
				for (const tc of delta.tool_calls) {
					const index = tc.index ?? 0;
					let tool = tools.get(index);
					if (!tool) {
						tool = { id: '', name: '', chunks: [], sentChunks: 0, blockIndex: null };
						tools.set(index, tool);
					}
					if (tc.id) tool.id = tc.id;
					if (toolThoughtSignature(tc)) tool.signature = toolThoughtSignature(tc);
					if (tc.function?.name) tool.name += tc.function.name;
					if (tc.function?.arguments) tool.chunks.push(tc.function.arguments);
					if (!streamedTool && tool.id && tool.name) {
						streamedTool = tool;
						startTool(controller, tool);
					}
					if (tool === streamedTool) sendToolArguments(controller, tool);
				}
			}
		}
		if (choice.finish_reason) {
			finishReason = choice.finish_reason;
			finishContent(controller);
		}
	}

	function processBuffer(controller, flush = false) {
		let lineEnd;
		while (!finalized && (lineEnd = buffer.indexOf('\n')) !== -1) {
			const line = buffer.slice(0, lineEnd).replace(/\r$/, '');
			buffer = buffer.slice(lineEnd + 1);
			if (!line) processEvent(controller);
			else if (line.startsWith('data:')) eventData.push(line.slice(5).replace(/^ /, ''));
		}
		if (flush && !finalized) {
			if (buffer.startsWith('data:')) eventData.push(buffer.slice(5).replace(/^ /, '').replace(/\r$/, ''));
			buffer = '';
			processEvent(controller);
		}
	}

	return new ReadableStream({
		async pull(controller) {
			enqueuedAny = false;
			try {
				while (!enqueuedAny && !finalized) {
					const { value, done } = await reader.read();
					if (done) {
						buffer += decoder.decode();
						processBuffer(controller, true);
						finishMessage(controller);
						controller.close();
						return;
					}
					buffer += decoder.decode(value, { stream: true });
					processBuffer(controller);
				}
				if (finalized) {
					controller.close();
					await reader.cancel();
				}
			} catch (error) {
				if (!finalized) emit(controller, { type: 'error', error: { type: 'api_error', message: 'Upstream stream ended prematurely or returned invalid content.' } });
				finalized = true; controller.close();
				await reader.cancel(error).catch(() => {});
			}
		},
		cancel(reason) { return reader.cancel(reason); }
	});
}

// 向量嵌入（Embeddings）的代理处理函数
function normalizeEmbeddingOptions(input) {
 if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Embedding request must be an object.');
 const tasks = ['TASK_TYPE_UNSPECIFIED', 'RETRIEVAL_QUERY', 'RETRIEVAL_DOCUMENT', 'SEMANTIC_SIMILARITY', 'CLASSIFICATION', 'CLUSTERING', 'QUESTION_ANSWERING', 'FACT_VERIFICATION', 'CODE_RETRIEVAL_QUERY'];
 const aliases = {
  title: ['title'], taskType: ['taskType', 'task_type'],
  outputDimensionality: ['outputDimensionality', 'output_dimensionality', 'dimensions'],
  autoTruncate: ['autoTruncate', 'auto_truncate'], documentOcr: ['documentOcr', 'document_ocr'],
  audioTrackExtraction: ['audioTrackExtraction', 'audio_track_extraction']
 };
 const allowed = new Set(Object.values(aliases).flat()), result = {};
 const sources = [input];
 for (const field of ['embedContentConfig', 'embed_content_config']) if (Object.hasOwn(input, field)) {
  const config = input[field];
  if (!config || typeof config !== 'object' || Array.isArray(config) || Object.keys(config).some(key => !allowed.has(key))) throw new TypeError('Invalid or unsupported embedding configuration.');
  sources.push(config);
 }
 for (const [field, names] of Object.entries(aliases)) for (const source of sources) for (const name of names) if (Object.hasOwn(source, name)) {
  let value = source[name];
  if (value === undefined) continue;
  if (field === 'taskType' && Number.isInteger(value) && value >= 0 && value < tasks.length) value = tasks[value];
  if (Object.hasOwn(result, field) && result[field] !== value) throw new TypeError('Conflicting embedding configuration aliases.');
  result[field] = value;
 }
 if (result.outputDimensionality !== undefined && (!Number.isInteger(result.outputDimensionality) || result.outputDimensionality <= 0)) throw new TypeError('Embedding dimensionality must be a positive integer.');
 if (result.taskType !== undefined) {
  if (!tasks.includes(result.taskType)) throw new TypeError('Unsupported embedding task type.');
 }
 if (result.title !== undefined && typeof result.title !== 'string') throw new TypeError('Embedding title must be a string.');
 if (result.title !== undefined && result.taskType !== 'RETRIEVAL_DOCUMENT') throw new TypeError('Embedding title requires RETRIEVAL_DOCUMENT task type.');
 for (const field of ['autoTruncate', 'documentOcr', 'audioTrackExtraction']) if (result[field] !== undefined && typeof result[field] !== 'boolean') throw new TypeError('Embedding configuration flags must be booleans.');
 return result;
}

async function handleEmbeddings(request, env, parsedBody) {
 let body = parsedBody;
 if (body === undefined) {
  try { body = await readRequestJson(request); } catch (error) { return requestJsonErrorResponse(request, error); }
 }
 if (!body || typeof body !== 'object' || Array.isArray(body)) return Response.json({ error: { message: 'Request body must be an object', type: 'invalid_request_error' } }, { status: 400 });
 const { model, input, encoding_format = 'float' } = body;
 let embeddingOptions;
 try { embeddingOptions = normalizeEmbeddingOptions(body); }
 catch (error) { return Response.json({ error: { message: error.message, type: 'invalid_request_error' } }, { status: 400 }); }
 const dimensions = embeddingOptions.outputDimensionality;
 const inputValid = typeof input === 'string' ? input.length > 0 : Array.isArray(input) && input.length > 0 &&
  (input.every(value => typeof value === 'string' && value.length > 0) || input.every(Number.isInteger) || input.every(value => Array.isArray(value) && value.length && value.every(Number.isInteger)));
 if (!inputValid || !['float', 'base64'].includes(encoding_format) || (dimensions !== undefined && (!Number.isInteger(dimensions) || dimensions <= 0))) {
  return Response.json({ error: { message: 'Invalid input, encoding_format or dimensions', type: 'invalid_request_error' } }, { status: 400 });
 }
 const target = await resolveModelName(model, env);
 if (!target) return Response.json({ error: { message: 'Model not found: ' + model, type: 'invalid_request_error', param: 'model', code: 'model_not_found' } }, { status: 400 });
 const accounts = await getAccounts(env), route = parseUpstreamTarget(target, accounts);
 if (!['cloudflare', 'openai', 'gemini'].includes(route.provider)) return Response.json({ error: { message: 'This upstream does not support embeddings.', type: 'invalid_request_error' } }, { status: 400 });
 if (route.provider !== 'gemini' && Object.keys(embeddingOptions).some(field => field !== 'outputDimensionality')) return Response.json({ error: { message: 'This upstream cannot enforce the requested Gemini embedding configuration.', type: 'invalid_request_error' } }, { status: 400 });
 const matches = getMatchingUpstreamAccounts(route, accounts);
 if (!matches.length) return Response.json({ error: { message: 'No active upstream account matches this embedding model.', type: 'server_error' } }, { status: 503 });
 const texts = typeof input === 'string' ? [input] : input;
 if (route.provider !== 'openai' && !texts.every(value => typeof value === 'string')) return Response.json({ error: { message: 'This upstream accepts text input only.', type: 'invalid_request_error' } }, { status: 400 });
 let failure = { status: 502, error: 'All matching embedding accounts failed.' };
 for (const account of shuffledUpstreams(matches).slice(0, 3)) {
  if (request.signal.aborted) return Response.json({ error: { message: 'Request cancelled.' } }, { status: 499 });
  try {
   let url, payload, headers = { 'Content-Type': 'application/json' };
   if (route.provider === 'cloudflare') {
    url = 'https://api.cloudflare.com/client/v4/accounts/' + encodeURIComponent(account.accountId) + '/ai/run/' + cloudflareModelPath(route.model);
    headers.Authorization = 'Bearer ' + account.apiToken; payload = { text: texts };
    if (dimensions !== undefined) payload.dimensions = dimensions;
   } else if (route.provider === 'openai') {
    url = upstreamEndpoint(account, 'openai', 'embeddings'); headers.Authorization = 'Bearer ' + account.apiToken;
    payload = { model: route.model, input, encoding_format, ...(dimensions === undefined ? {} : { dimensions }), ...(body.user === undefined ? {} : { user: body.user }) };
   } else {
    const name = route.model.replace(/^models\//, '');
    url = upstreamEndpoint(account, 'gemini', 'models/' + encodeURIComponent(name) + ':batchEmbedContents'); headers['x-goog-api-key'] = account.apiToken;
    payload = { requests: texts.map(text => ({ model: 'models/' + name, content: { parts: [{ text }] }, ...(Object.keys(embeddingOptions).length ? { embedContentConfig: embeddingOptions } : {}) })) };
   }
   const response = await fetchUpstream(url, { headers, body: JSON.stringify(payload), signal: request.signal }, {}, runtimeFetch(env));
   if (!response.ok) { failure = await upstreamFailure(response, account); if (!shouldRetryUpstream(response.status)) break; continue; }
   const data = await response.json(); let embeddings, usage;
   if (isUpstreamErrorEnvelope(data)) return Response.json({ error: { message: cleanUpstreamError(upstreamErrorMessage(data), account), type: 'server_error' } }, { status: 502 });
   if (route.provider === 'openai') { embeddings = data.data; usage = data.usage || { prompt_tokens: 0, total_tokens: 0 }; }
   else {
    if (route.provider === 'cloudflare' && data.success !== true) return Response.json({ error: { message: 'Cloudflare embedding inference failed.' } }, { status: 502 });
    const vectors = route.provider === 'cloudflare' ? data.result?.data : data.embeddings?.map(embedding => embedding.values);
    if (!Array.isArray(vectors) || vectors.length !== texts.length) throw new Error('Invalid embedding output.');
    embeddings = vectors.map((embedding, index) => ({ object: 'embedding', index, embedding }));
    const tokens = data.usageMetadata?.promptTokenCount ?? data.usageMetadata?.totalTokenCount ?? texts.reduce((sum, text) => sum + Math.ceil(text.length / 4), 0);
    usage = { prompt_tokens: tokens, total_tokens: tokens };
   }
   const expectedCount = typeof input === 'string' || input.every(Number.isInteger) ? 1 : input.length;
   embeddings = validateEmbeddingOutput(embeddings, expectedCount, encoding_format, dimensions);
   return Response.json({ object: 'list', data: embeddings, model, usage });
  } catch (error) { if (error.status === 400) return Response.json({ error: { message: error.message, type: 'invalid_request_error' } }, { status: 400 }); return Response.json({ error: { message: request.signal.aborted ? 'Request cancelled.' : 'Unable to obtain a valid embedding response. The request was not repeated.' } }, { status: request.signal.aborted ? 499 : 502 }); }
 }
 return Response.json({ error: { message: failure.error, type: failure.status === 400 ? 'invalid_request_error' : 'server_error' } }, { status: failure.status });
}

function validateEmbeddingOutput(embeddings, expectedCount, encoding, dimensions) {
 if (!Array.isArray(embeddings) || embeddings.length !== expectedCount) throw new Error('Invalid embedding output.');
 const indices = new Set();
 let vectorLength = dimensions;
 const result = embeddings.map(item => {
  if (!item || !Number.isInteger(item.index) || item.index < 0 || item.index >= expectedCount || indices.has(item.index)) throw new Error('Invalid embedding index.');
  indices.add(item.index);
  const vector = item.embedding;
  let length, encoded;
  if (typeof vector === 'string' && encoding === 'base64') {
   if (!vector || vector.length % 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(vector)) throw new Error('Invalid base64 embedding.');
   const binary = atob(vector);
   if (!binary.length || binary.length % 4 || btoa(binary) !== vector) throw new Error('Invalid base64 embedding.');
   const bytes = Uint8Array.from(binary, value => value.charCodeAt(0)), view = new DataView(bytes.buffer);
   for (let offset = 0; offset < bytes.length; offset += 4) if (!Number.isFinite(view.getFloat32(offset, true))) throw new Error('Invalid embedding vector.');
   length = bytes.length / 4;
   encoded = vector;
  } else {
   if (!Array.isArray(vector) || !vector.length || vector.some(value => typeof value !== 'number' || !Number.isFinite(value) || !Number.isFinite(Math.fround(value)))) throw new Error('Invalid embedding vector.');
   length = vector.length;
   if (encoding === 'base64') encoded = encodeFloatEmbedding(vector);
  }
  if (vectorLength === undefined) vectorLength = length;
  if (length !== vectorLength) throw new Error('Invalid embedding dimensions.');
  return { object: 'embedding', index: item.index, embedding: encoded ?? vector };
 });
 return result.sort((left, right) => left.index - right.index);
}

function encodeFloatEmbedding(embedding) {
 const bytes = new Uint8Array(embedding.length * 4), view = new DataView(bytes.buffer);
 embedding.forEach((value, index) => view.setFloat32(index * 4, value, true));
 let encoded = '';
 for (let index = 0; index < bytes.length; index += 8192) encoded += String.fromCharCode(...bytes.subarray(index, index + 8192));
 return btoa(encoded);
}

// 粗略估算 token 数量（按每 4 个字符约 1 个 token 估算）
function estimateUsage(messages, answer) {
	let promptChars = 0;
	for (const msg of messages) {
		promptChars += (msg.content || '').length;
	}
	const completionChars = (answer || '').length;

	const promptTokens = Math.ceil(promptChars / 4);
	const completionTokens = Math.ceil(completionChars / 4);

	return {
		prompt_tokens: promptTokens,
		completion_tokens: completionTokens,
		total_tokens: promptTokens + completionTokens
	};
}

// 将 Chat Completions 响应转换成旧版 Completions 的 text/logprobs 结构。
function toLegacyCompletion(response, modelName, streaming = false, textOffsets = new Map()) {
	if (!Array.isArray(response.choices)) return response; // 保留上游错误信息。
	return {
		...response,
		object: 'text_completion',
		model: modelName,
		choices: response.choices.map((choice, position) => {
			const index = choice.index ?? position;
			const content = streaming ? choice.delta?.content : choice.message?.content;
			const text = typeof content === 'string' ? content : '';
			let offset = textOffsets.get(index) || 0;
			let logprobs = choice.logprobs ?? null;
			if (Array.isArray(logprobs?.content)) {
				const entries = logprobs.content;
				logprobs = {
					tokens: entries.map(entry => entry.token),
					token_logprobs: entries.map(entry => entry.logprob),
					top_logprobs: entries.map(entry => Object.fromEntries((entry.top_logprobs || []).map(top => [top.token, top.logprob]))),
					text_offset: entries.map(entry => {
						const start = offset;
						offset += entry.token.length;
						return start;
					}),
				};
			}
			textOffsets.set(index, (textOffsets.get(index) || 0) + text.length);
			return { index, text, logprobs, finish_reason: choice.finish_reason ?? null };
		}),
	};
}

function legacyCompletionStream(upstreamBody, modelName) {
	const reader = upstreamBody.getReader();
	const decoder = new TextDecoder();
	const encoder = new TextEncoder();
	const textOffsets = new Map();
	let buffer = '';
	let closed = false;
	const completion = openAIStreamCompletion();

	function emitFrame(frame, controller) {
		const lines = frame.split(/\r?\n/);
		const dataLines = lines.filter(line => line.startsWith('data:'));
		if (dataLines.length === 0) {
			if (frame.trim()) controller.enqueue(encoder.encode(frame + '\n\n'));
			return;
		}
		const data = dataLines.map(line => line.slice(5).replace(/^ /, '')).join('\n');
		if (data.trim() === '[DONE]') {
			completion.finish();
			controller.enqueue(encoder.encode('data: [DONE]\n\n'));
			closed = true;
			controller.close();
			return;
		}
		let payload;
		payload = JSON.parse(data);
		completion.accept(payload);
		payload = toLegacyCompletion(payload, modelName, true, textOffsets);
		const metadata = lines.filter(line => !line.startsWith('data:')).join('\n');
		controller.enqueue(encoder.encode(`${metadata ? metadata + '\n' : ''}data: ${JSON.stringify(payload)}\n\n`));
		if (payload.error) { closed = true; controller.close(); }
	}

	return new ReadableStream({
		async pull(controller) {
			try {
			let emitted = false;
			while (!closed && !emitted) {
				const { value, done } = await reader.read();
				buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
				let separator;
				while (!closed && (separator = /\r?\n\r?\n/.exec(buffer))) {
					const frame = buffer.slice(0, separator.index);
					buffer = buffer.slice(separator.index + separator[0].length);
					emitFrame(frame, controller);
					if (frame.trim()) emitted = true;
				}
				if (closed) {
					await reader.cancel();
					return;
				}
				if (done) {
					if (buffer.trim()) emitFrame(buffer, controller);
					if (!closed) {
						completion.finish();
						controller.enqueue(encoder.encode('data: [DONE]\n\n'));
						closed = true;
						controller.close();
					}
					return;
				}
			}
			} catch (error) {
				if (!closed) {
					controller.enqueue(encoder.encode('data: ' + JSON.stringify({ error: { type: 'upstream_error', message: 'Upstream stream ended prematurely or returned invalid content.' } }) + '\n\n'));
					closed = true; controller.close();
				}
				await reader.cancel(error).catch(() => {});
			}
		},
		cancel(reason) {
			closed = true;
			return reader.cancel(reason);
		},
	});
}

// 透传 CF /ai/v1/chat/completions 返回的 SSE 流
// CF 返回的本来就是标准 OpenAI 的 SSE 格式，我们只把模型名改一下，
// 这样 tool_calls、finish_reason、reasoning_content、usage 等字段都能原样保留。
function passthroughStream(upstreamBody, modelName) {
 const reader = upstreamBody.getReader(), decoder = new TextDecoder(), encoder = new TextEncoder();
 let buffer = '', closed = false;
 const completion = openAIStreamCompletion();
 function emitFrame(frame, controller) {
  if (!frame.trim() || closed) return false;
  const lines = frame.split(/\r?\n/), dataLines = lines.filter(line => line.startsWith('data:'));
  if (!dataLines.length) { controller.enqueue(encoder.encode(frame.replace(/\r\n/g, '\n') + '\n\n')); return true; }
  const raw = dataLines.map(line => line.slice(5).replace(/^ /, '')).join('\n');
  if (raw.trim() === '[DONE]') {
   completion.finish();
   controller.enqueue(encoder.encode('data: [DONE]\n\n')); controller.close(); closed = true; return true;
  }
  let payload;
  payload = JSON.parse(raw);
  completion.accept(payload);
  if (payload && typeof payload === 'object' && payload.model !== undefined) payload.model = modelName;
  const metadata = lines.filter(line => !line.startsWith('data:')).join('\n');
  controller.enqueue(encoder.encode((metadata ? metadata + '\n' : '') + 'data: ' + JSON.stringify(payload) + '\n\n'));
  if (payload.error) { closed = true; controller.close(); }
  return true;
 }
 return new ReadableStream({
  async pull(controller) {
   try {
    let emitted = false;
    while (!closed && !emitted) {
     const { value, done } = await reader.read();
     buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
     let separator;
     while (!closed && (separator = /\r?\n\r?\n/.exec(buffer))) {
      const frame = buffer.slice(0, separator.index); buffer = buffer.slice(separator.index + separator[0].length);
      emitted = emitFrame(frame, controller) || emitted;
     }
     if (closed) { await reader.cancel(); return; }
     if (done) {
      if (buffer.trim()) emitFrame(buffer, controller);
      if (!closed) { completion.finish(); controller.enqueue(encoder.encode('data: [DONE]\n\n')); controller.close(); closed = true; }
      return;
     }
    }
   } catch (error) {
    if (!closed) {
     controller.enqueue(encoder.encode('data: ' + JSON.stringify({ error: { type: 'upstream_error', message: 'Upstream stream ended prematurely or returned invalid content.' } }) + '\n\n'));
     closed = true; controller.close();
    }
    await reader.cancel(error).catch(() => {});
   }
  },
  cancel(reason) { closed = true; return reader.cancel(reason); }
 });
}

// A transport EOF or [DONE] marker cannot complete unfinished model candidates.
function openAIStreamCompletion() {
	const choices = new Map();
	return {
		accept(data) {
			for (const [position, choice] of (data.choices || []).entries()) {
				const index = choice.index ?? position;
				choices.set(index, !!choice.finish_reason || choices.get(index) || false);
			}
		},
		finish() {
			if (!choices.size || [...choices.values()].some(finished => !finished)) throw new Error('Upstream stream ended before a finish reason.');
		}
	};
}

function validatedNativeAnthropicStream(upstreamBody) {
	const reader = upstreamBody.getReader(), decoder = new TextDecoder(), encoder = new TextEncoder();
	let buffer = '', ended = false;
	const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
	const typed = value => object(value) && typeof value.type === 'string' && value.type.length > 0;
	const count = value => Number.isInteger(value) && value >= 0;
	function validEvent(event) {
		if (!typed(event)) return false;
		const fields = {
			message_start: ['message'], content_block_start: ['index', 'content_block'],
			content_block_delta: ['index', 'delta'], content_block_stop: ['index'],
			message_delta: ['delta', 'usage'], message_stop: [], ping: [], error: ['error']
		}[event.type];
		if (!fields || Object.keys(event).some(key => key !== 'type' && !fields.includes(key))) return false;
		if (event.type === 'message_start') {
			const message = event.message;
			return object(message) && message.type === 'message' && message.role === 'assistant'
				&& typeof message.id === 'string' && typeof message.model === 'string' && Array.isArray(message.content)
				&& object(message.usage) && count(message.usage.input_tokens) && count(message.usage.output_tokens);
		}
		if (event.type === 'error') return typed(event.error) && typeof event.error.message === 'string';
		if (event.type === 'message_delta') return object(event.delta) && object(event.usage) && count(event.usage.output_tokens)
			&& (event.delta.stop_reason === null || typeof event.delta.stop_reason === 'string')
			&& (event.delta.stop_sequence === undefined || event.delta.stop_sequence === null || typeof event.delta.stop_sequence === 'string');
		if (event.type.startsWith('content_block_')) {
			if (!count(event.index)) return false;
			if (event.type === 'content_block_stop') return true;
			const payload = event.type === 'content_block_start' ? event.content_block : event.delta;
			if (!typed(payload)) return false;
			if ((event.type === 'content_block_delta') !== payload.type.endsWith('_delta')) return false;
			const stringField = { text: 'text', thinking: 'thinking', redacted_thinking: 'data',
				text_delta: 'text', thinking_delta: 'thinking', signature_delta: 'signature', input_json_delta: 'partial_json' }[payload.type];
			if (stringField) return typeof payload[stringField] === 'string';
			if (payload.type === 'tool_use' || payload.type === 'server_tool_use') return typeof payload.id === 'string' && typeof payload.name === 'string' && object(payload.input);
			if (payload.type === 'citations_delta') return object(payload.citation);
			// Native provider extensions remain typed content; do not reinterpret or
			// scan generated tool results, citations, text, or opaque signatures.
			return true;
		}
		return true;
	}
	function frame(value, controller) {
		if (!value.trim() || ended) return;
		const lines = value.split(/\r\n|\r|\n/), dataLines = lines.filter(line => line.startsWith('data:'));
		const raw = dataLines.map(line => line.slice(5).replace(/^ /, '')).join('\n');
		if (dataLines.length) {
			const event = JSON.parse(raw);
			const eventName = lines.findLast(line => line.startsWith('event:'))?.slice(6).trim();
			if (!validEvent(event) || (eventName && eventName !== event.type)) throw new Error('Invalid Anthropic stream event.');
			if (event.type === 'message_stop' || event.type === 'error') ended = true;
		}
		controller.enqueue(encoder.encode(value.replace(/\r\n|\r/g, '\n') + '\n\n'));
	}
	return new ReadableStream({
		async pull(controller) {
			try {
				while (!ended) {
					const { value, done } = await reader.read();
					buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
					let separator, emitted = false;
					while (!ended && (separator = /\r\n\r\n|\n\n|\r\r/.exec(buffer))) {
						frame(buffer.slice(0, separator.index), controller); buffer = buffer.slice(separator.index + separator[0].length); emitted = true;
					}
					if (done && !ended) { frame(buffer, controller); if (!ended) throw new Error('Anthropic stream ended before message_stop.'); }
					if (ended) { controller.close(); await reader.cancel(); return; }
					if (emitted) return;
				}
			} catch (error) {
				controller.enqueue(encoder.encode('event: error\ndata: ' + JSON.stringify({ type: 'error', error: { type: 'api_error', message: 'Anthropic stream ended prematurely or returned invalid content.' } }) + '\n\n'));
				ended = true; controller.close(); await reader.cancel(error).catch(() => {});
			}
		},
		cancel(reason) { ended = true; return reader.cancel(reason); }
	});
}

// ----------------------------------------------------
// Antigravity (Google Cloud Code) 集成模块
// ----------------------------------------------------
const ANTIGRAVITY_ENDPOINTS = [
	'https://daily-cloudcode-pa.googleapis.com',
	'https://cloudcode-pa.googleapis.com'
];

const KNOWN_ANTIGRAVITY_MODELS = [
	'claude-sonnet-4-5-thinking',
	'claude-opus-4-5-thinking',
	'claude-sonnet-4-5',
	'claude-3-7-sonnet',
	'claude-3-5-sonnet',
	'claude-3-5-sonnet-20241022',
	'claude-3-5-haiku',
	'claude-3-opus',
	'gemini-3-flash',
	'gemini-3-pro-low',
	'gemini-3-pro-high',
	'gemini-2.5-flash',
	'gemini-2.5-flash-lite',
	'gemini-2.5-pro',
	'gemini-2.0-flash',
	'gemini-2.0-flash-lite'
];

function isAntigravityTarget(model) {
	if (typeof model !== 'string' || !model) return false;
	const lower = model.toLowerCase();
	return lower.startsWith('antigravity:') || lower.startsWith('@antigravity/');
}

function getAntigravityModelName(model) {
	return (model || '').replace(/^(@antigravity\/|antigravity:)/i, '');
}

function getModelFamily(model) {
	const lower = (model || '').toLowerCase();
	if (lower.includes('claude')) return 'claude';
	if (lower.includes('gemini')) return 'gemini';
	return 'unknown';
}

function isThinkingModel(model) {
	const lower = (model || '').toLowerCase();
	if (lower.includes('claude') && lower.includes('thinking')) return true;
	if (lower.includes('gemini')) {
		if (lower.includes('thinking')) return true;
		const match = lower.match(/gemini-(\d+)/);
		if (match && parseInt(match[1], 10) >= 3) return true;
	}
	return false;
}

// 运行时内存缓存（单 Worker 实例内复用）
const antigravityTokenCache = new Map();
const antigravityTokenRefreshes = new Map();
// Injected transports own a request's cancellation and fetch budget. An in-flight
// refresh must not make another request depend on that transport's lifetime.
const antigravityRuntimeTokenRefreshes = new WeakMap();
const antigravitySignatureCache = new Map();
const antigravityProjectCache = new Map();
// Public installed-app client used by Antigravity/CLIProxyAPI; this is not a user credential.
// https://github.com/router-for-me/CLIProxyAPI/blob/main/internal/auth/antigravity/constants.go
const ANTIGRAVITY_OAUTH_CLIENT = {
	id: '1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com',
	secret: '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'
};

function antigravityOAuthClient(account, env) {
	const id = account.oauthClientId || env.OAUTH_CLIENT_ID;
	const secret = account.oauthClientSecret || env.OAUTH_CLIENT_SECRET;
	if (!!id !== !!secret) throw Object.assign(new Error('Provide both OAuth client ID and client secret, or leave both empty for the Antigravity client.'), { status: 400 });
	return { id: id || ANTIGRAVITY_OAUTH_CLIENT.id, secret: secret || ANTIGRAVITY_OAUTH_CLIENT.secret };
}

async function hasAntigravityConfigured(env) {
	if (env.ANTIGRAVITY_REFRESH_TOKEN || env.ANTIGRAVITY_API_KEY || env.ANTIGRAVITY_ACCOUNTS || env.ACCOUNTS_JSON) {
		return true;
	}
	try {
		const accounts = await getAccounts(env);
		return accounts.some(a => a.status === 'active' && (
			a.provider === 'antigravity' ||
			a.source === 'antigravity' ||
			(typeof a.apiToken === 'string' && (a.apiToken.startsWith('1//') || a.apiToken.startsWith('ya29.')))
		));
	} catch (_) {
		return false;
	}
}

async function getAntigravityModelList(env, customMap) {
	const list = [];
	const hasConfig = await hasAntigravityConfigured(env);
	for (const id of KNOWN_ANTIGRAVITY_MODELS) {
		const isExplicitlyMapped = Object.values(customMap || {}).some(m => m === id || m === `antigravity:${id}` || m === `@antigravity/${id}`);
		if (hasConfig || isExplicitlyMapped) {
			list.push({
				id,
				object: 'model',
				created: 1700000000,
				owned_by: id.includes('claude') ? 'anthropic' : 'google'
			});
		}
	}
	return list;
}

async function getAntigravityAccounts(env) {
	const result = [];
	const fallbackProject = typeof env.ANTIGRAVITY_PROJECT_ID === 'string' ? env.ANTIGRAVITY_PROJECT_ID.trim() : '';

	if (env.ANTIGRAVITY_REFRESH_TOKEN) {
		result.push({
			id: 'env-ag-oauth',
			name: 'Antigravity Env (OAuth)',
			accountId: env.ANTIGRAVITY_EMAIL || 'default@antigravity',
			refreshToken: env.ANTIGRAVITY_REFRESH_TOKEN.trim(),
			projectId: fallbackProject,
			source: 'oauth',
			status: 'active'
		});
	}
	if (env.ANTIGRAVITY_API_KEY) {
		result.push({
			id: 'env-ag-key',
			name: 'Antigravity Env (Key)',
			accountId: 'default@antigravity',
			apiKey: env.ANTIGRAVITY_API_KEY.trim(),
			projectId: fallbackProject,
			source: 'manual',
			status: 'active'
		});
	}

	const rawJson = env.ANTIGRAVITY_ACCOUNTS || env.ACCOUNTS_JSON;
	if (rawJson) {
		try {
			const parsed = JSON.parse(rawJson);
			const list = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.accounts) ? parsed.accounts : []);
			for (let i = 0; i < list.length; i++) {
				const item = list[i];
				if (!item || item.status === 'disabled') continue;
				if (item.refreshToken || item.apiKey) {
					result.push({
						id: item.id || `env-json-${i}`,
						name: item.name || item.email || `Antigravity ${i + 1}`,
						accountId: item.email || item.accountId || `account-${i}@antigravity`,
						refreshToken: item.refreshToken,
						apiKey: item.apiKey,
						projectId: item.projectId || item.project_id || fallbackProject,
						oauthClientId: item.oauthClientId || item.client_id,
						oauthClientSecret: item.oauthClientSecret || item.client_secret,
						models: Array.isArray(item.models) ? item.models : [],
						source: item.refreshToken ? 'oauth' : 'manual',
						status: 'active'
					});
				}
			}
		} catch (_) {}
	}

	try {
		const stored = await getAccounts(env);
		for (const a of stored) {
			if (a.status !== 'active') continue;
			const isAG = getAccountProvider(a) === 'antigravity';
			if (isAG) {
				const isRefresh = !!a.refreshToken || !a.apiToken.startsWith('ya29.');
				result.push({
					id: a.id,
					name: a.name || 'Antigravity Account',
					accountId: a.accountId,
					refreshToken: isRefresh ? (a.refreshToken || a.apiToken) : undefined,
					apiKey: !isRefresh ? a.apiToken : undefined,
					projectId: a.projectId || fallbackProject,
					projectSource: a.projectSource || 'auto',
					projectIdentity: a.projectIdentity,
					oauthClientId: a.oauthClientId,
					oauthClientSecret: a.oauthClientSecret,
					models: Array.isArray(a.models) ? a.models : [],
					source: isRefresh ? 'oauth' : 'manual',
					status: 'active'
				});
			}
		}
	} catch (_) {}

	return result;
}

async function antigravityTokenCacheKey(account, env) {
	const client = antigravityOAuthClient(account, env);
	return `${account.id || account.accountId || 'default'}:${await sha256(JSON.stringify({
		refreshToken: account.refreshToken || '', apiKey: account.apiKey || '', clientId: client.id, clientSecret: client.secret
	}))}`;
}

async function getAntigravityToken(account, env, { forceRefresh = false } = {}) {
	if (!account.refreshToken && typeof account.apiKey === 'string' && account.apiKey.trim()) return account.apiKey.trim();
	const cacheKey = await antigravityTokenCacheKey(account, env);
	const network = env[GATEWAY_RUNTIME]?.fetch;
	let refreshes = antigravityTokenRefreshes;
	if (typeof network === 'function') {
		refreshes = antigravityRuntimeTokenRefreshes.get(network);
		if (!refreshes) { refreshes = new Map(); antigravityRuntimeTokenRefreshes.set(network, refreshes); }
	}
	// A forced refresh bypasses completed cache entries, but joins a refresh
	// for the same credentials within this transport's cancellation/budget scope.
	// Native Cloudflare requests retain the existing isolate-wide single flight.
	if (refreshes.has(cacheKey)) return refreshes.get(cacheKey);
	const cached = antigravityTokenCache.get(cacheKey);
	if (!forceRefresh && cached && cached.expiresAt > Date.now()) {
		return cached.token;
	}

	if (!account.refreshToken) {
		throw new Error(`Account ${account.accountId} has neither refreshToken nor apiKey`);
	}
	const refresh = refreshAntigravityToken(account, env, cacheKey);
	refreshes.set(cacheKey, refresh);
	try { return await refresh; }
	finally { if (refreshes.get(cacheKey) === refresh) refreshes.delete(cacheKey); }
}

// Control responses have a small byte budget and one deadline covering headers
// and the entire body. Native shared refreshes do not inherit a single caller's
// signal; injected transports use their request-scoped signal explicitly.
async function fetchAntigravityControlJson(url, options, env, label) {
	const controller = new AbortController();
	const signals = [AbortSignal.timeout(20000), env[GATEWAY_RUNTIME]?.signal].filter(Boolean);
	const onAbort = () => controller.abort(new Error('Antigravity control request cancelled or timed out.'));
	for (const signal of signals) {
		signal.addEventListener('abort', onAbort, { once: true });
		if (signal.aborted) onAbort();
	}
	try {
		let response;
		try {
			response = await fetchUpstream(url, { ...options, signal: controller.signal }, {
				headerTimeoutMs: 20000, bodyIdleTimeoutMs: 20000, maxResponseBytes: 1024 * 1024,
			}, runtimeFetch(env));
		} catch (error) {
			// Transport errors can carry request diagnostics. Never reflect them to
			// management or inference callers, including OAuth client credentials.
			const safe = new Error(`${label} request failed or timed out.`);
			if (error?.code === 'request_cancelled') safe.code = 'request_cancelled';
			throw safe;
		}
		if (!response.ok) {
			void response.body?.cancel().catch(() => {});
			return { ok: false, status: response.status };
		}
		let data;
		try { data = await response.json(); }
		catch (_) { throw new Error(`${label} returned invalid JSON or exceeded the response limit.`); }
		if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(`${label} returned invalid JSON.`);
		return { ok: true, status: response.status, data };
	} finally {
		for (const signal of signals) signal.removeEventListener('abort', onAbort);
	}
}

async function refreshAntigravityToken(account, env, cacheKey) {
	const { id: clientId, secret: clientSecret } = antigravityOAuthClient(account, env);

	const resp = await fetchAntigravityControlJson('https://oauth2.googleapis.com/token', {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		redirect: 'manual',
		body: new URLSearchParams({
			client_id: clientId,
			client_secret: clientSecret,
			refresh_token: account.refreshToken,
			grant_type: 'refresh_token'
		})
	}, env, 'Google OAuth');

	if (!resp.ok) {
		throw new Error(`Google OAuth token refresh failed (${resp.status}); check the refresh token and matching OAuth client.`);
	}

	const data = resp.data;
	const token = data.access_token;
	const expiresIn = typeof data.expires_in === 'number' ? data.expires_in : 3600;
	if (typeof token !== 'string' || !token || !Number.isFinite(expiresIn) || expiresIn <= 0) throw new Error('Google OAuth returned an invalid access token or expiry.');
	for (const [key, value] of antigravityTokenCache) if (value.expiresAt <= Date.now()) antigravityTokenCache.delete(key);
	if (antigravityTokenCache.size >= 256) antigravityTokenCache.delete(antigravityTokenCache.keys().next().value);
	antigravityTokenCache.set(cacheKey, {
		token,
		expiresAt: Date.now() + Math.max(1, expiresIn - Math.min(300, expiresIn / 10)) * 1000
	});

	return token;
}

function antigravityProjectFromResponse(data) {
	for (const field of ['cloudaicompanionProject', 'projectId', 'project']) {
		const value = data?.[field];
		const id = typeof value === 'string' ? value : value?.id;
		if (typeof id === 'string' && id.trim()) return id.trim();
	}
	return '';
}

async function antigravityProjectIdentity(account, env) {
	const client = antigravityOAuthClient(account, env);
	return sha256(JSON.stringify({ refreshToken: account.refreshToken || '', apiKey: account.apiKey || '', clientId: client.id, clientSecret: client.secret, email: (account.accountId || '').toLowerCase(), configuredProject: env.ANTIGRAVITY_PROJECT_ID || '' }));
}

async function discoverAntigravityProject(account, env, initialToken) {
	const key = await antigravityProjectIdentity(account, env);
	if (account.projectId && (account.projectSource !== 'auto' || account.projectIdentity === key)) return String(account.projectId).trim();
	if (env.ANTIGRAVITY_PROJECT_ID) return String(env.ANTIGRAVITY_PROJECT_ID).trim();
	const cached = antigravityProjectCache.get(key);
	if (cached?.expiresAt > Date.now()) return cached.projectId;
	let token = initialToken || await getAntigravityToken(account, env), refreshed = false;
	async function control(action, body) {
		for (;;) {
			const response = await fetchAntigravityControlJson('https://daily-cloudcode-pa.googleapis.com/v1internal:' + action, {
				method: 'POST', redirect: 'manual',
				headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', 'User-Agent': 'antigravity/1.11.5 worker/unknown' },
				body: JSON.stringify(body)
			}, env, 'Antigravity project discovery');
			if (response.status === 401 && account.refreshToken && !refreshed) {
				refreshed = true;
				token = await getAntigravityToken(account, env, { forceRefresh: true }); continue;
			}
			if (!response.ok) {
				throw Object.assign(new Error(`Antigravity ${action} failed (HTTP ${response.status}); check account authorization or supply an authorized project ID.`), { status: response.status === 401 || response.status === 403 ? response.status : 502 });
			}
			const data = response.data;
			if (data.error) throw Object.assign(new Error('Antigravity project discovery returned an error; verify this account in Antigravity.'), { status: 502 });
			return data;
		}
	}
	// Public CLIProxyAPI client flow: use only the project and eligible tier returned for this account.
	const loaded = await control('loadCodeAssist', { metadata: { ideType: 'ANTIGRAVITY' } });
	let projectId = antigravityProjectFromResponse(loaded);
	if (!projectId) {
		const tier = loaded.allowedTiers?.find(item => item.isDefault)?.id || loaded.currentTier?.id;
		if (typeof tier !== 'string' || !tier) throw Object.assign(new Error('Antigravity returned no project or eligible default tier; sign in to Antigravity first or enter an authorized project ID.'), { status: 400 });
		for (let attempt = 0; attempt < 3 && !projectId; attempt++) {
			const onboarded = await control('onboardUser', { tier_id: tier, metadata: { ide_type: 'ANTIGRAVITY', ide_name: 'antigravity', ide_version: '1.11.5' } });
			if (onboarded.done) { projectId = antigravityProjectFromResponse(onboarded.response); break; }
			if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 1000));
		}
	}
	if (!projectId) throw Object.assign(new Error('Antigravity project discovery did not complete; retry after signing in to Antigravity or enter an authorized project ID.'), { status: 400 });
	if (antigravityProjectCache.size >= 256) antigravityProjectCache.delete(antigravityProjectCache.keys().next().value);
	antigravityProjectCache.set(key, { projectId, expiresAt: Date.now() + 3600000 });
	return projectId;
}

function antigravityRuntimeAccount(account) {
	const refreshToken = account.refreshToken || (!account.apiToken?.startsWith('ya29.') ? account.apiToken : undefined);
	return { ...account, refreshToken, apiKey: refreshToken ? undefined : account.apiToken || account.apiKey };
}

function sanitizeToolSchema(schema, root = schema, seen = new Set()) {
	const invalid = message => { throw Object.assign(new Error(`Antigravity tool schema: ${message}`), { status: 400 }); };
	if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return invalid('expected a JSON Schema object.');
	if (schema.$ref !== undefined) {
		if (typeof schema.$ref !== 'string' || !schema.$ref.startsWith('#/') || seen.has(schema.$ref)) return invalid('external or recursive $ref is unsupported.');
		let referenced = root;
		for (const path of schema.$ref.slice(2).split('/').map(part => part.replace(/~1/g, '/').replace(/~0/g, '~'))) {
			if (!referenced || !Object.hasOwn(referenced, path)) return invalid('unresolved $ref.');
			referenced = referenced[path];
		}
		const siblings = Object.keys(schema).filter(key => !['$ref', 'description', 'title'].includes(key));
		if (siblings.length) return invalid('$ref with constraint siblings is unsupported.');
		return { ...sanitizeToolSchema(referenced, root, new Set([...seen, schema.$ref])), ...(schema.description ? { description: schema.description } : {}) };
	}
	const metadata = new Set(['$schema', '$id', '$defs', 'definitions', 'examples', 'default']);
	const allowed = new Set(['type', 'description', 'properties', 'required', 'items', 'enum', 'title', 'const']);
	for (const key of Object.keys(schema)) if (!metadata.has(key) && !allowed.has(key)) return invalid(`constraint ${key} cannot be represented safely.`);
	if (schema.type !== undefined && (typeof schema.type !== 'string' || !['object', 'array', 'string', 'integer', 'number', 'boolean'].includes(schema.type))) return invalid('union or unknown types are unsupported.');
	const result = {};
	for (const key of ['type', 'description', 'title']) if (schema[key] !== undefined) result[key] = schema[key];
	if (schema.properties !== undefined) {
		if (!schema.properties || typeof schema.properties !== 'object' || Array.isArray(schema.properties)) return invalid('properties must be an object.');
		result.properties = Object.fromEntries(Object.entries(schema.properties).map(([name, value]) => [name, sanitizeToolSchema(value, root, seen)]));
	}
	if (schema.items !== undefined) result.items = sanitizeToolSchema(schema.items, root, seen);
	if (schema.required !== undefined) {
		if (!Array.isArray(schema.required) || schema.required.some(name => typeof name !== 'string' || !Object.hasOwn(schema.properties || {}, name))) return invalid('required must reference declared properties.');
		result.required = [...schema.required];
	}
	if (schema.enum !== undefined) {
		if (!Array.isArray(schema.enum) || !schema.enum.length || schema.enum.some(value => value === null || typeof value === 'object')) return invalid('enum must contain primitive non-null values.');
		result.enum = [...schema.enum];
	}
	if (schema.const !== undefined) {
		if (schema.const === null || typeof schema.const === 'object') return invalid('object or null constants are unsupported.');
		if (result.enum && !result.enum.includes(schema.const)) return invalid('const contradicts enum.');
		result.enum = [schema.const];
	}
	if (!result.type) result.type = result.properties || result.required ? 'object' : result.items ? 'array'
		: result.enum ? (typeof result.enum[0] === 'number' && Number.isInteger(result.enum[0]) ? 'integer' : typeof result.enum[0]) : 'object';
	return result;
}

function cacheAntigravitySignature(id, signature) {
	if (!id || !signature) return;
	if (antigravitySignatureCache.size >= 512) antigravitySignatureCache.delete(antigravitySignatureCache.keys().next().value);
	antigravitySignatureCache.set(id, signature);
}

async function deriveAntigravitySessionId(messages) {
	if (!Array.isArray(messages) || messages.length === 0) return crypto.randomUUID();
	const firstUser = messages.find(m => m.role === 'user');
	const text = typeof firstUser?.content === 'string'
		? firstUser.content
		: JSON.stringify(firstUser?.content || '');
	if (!text) return crypto.randomUUID();
	const hash = await sha256(text);
	return `session-${hash.slice(0, 16)}`;
}

async function buildAntigravityCloudCodeRequest(anthropicRequest, projectId) {
	rejectAnthropicProviderTools(anthropicRequest.tools);
	validateToolStrictness(anthropicRequest.tools, 'Antigravity', false);
	if (typeof projectId !== 'string' || !projectId.trim()) throw Object.assign(new Error('Antigravity requires an authorized projectId on the account or ANTIGRAVITY_PROJECT_ID.'), { status: 400 });
	const invalid = message => { throw Object.assign(new Error(message), { status: 400 }); };
	if (anthropicRequest.output_config?.format || anthropicRequest.output_format || anthropicRequest.response_format) {
		invalid('This Antigravity adapter cannot guarantee structured JSON output. Remove the output format or use a compatible upstream.');
	}
	const model = getAntigravityModelName(anthropicRequest.model);
	const family = getModelFamily(model);
	const isClaude = family === 'claude';
	const isGemini = family === 'gemini';
	const isThinking = isThinkingModel(model);

	const systemParts = [];
	if (anthropicRequest.system) {
		if (typeof anthropicRequest.system === 'string') {
			systemParts.push({ text: anthropicRequest.system });
		} else if (Array.isArray(anthropicRequest.system)) {
			for (const part of anthropicRequest.system) {
				if (part?.type !== 'text' || typeof part.text !== 'string') invalid('Antigravity system instructions must contain text only.');
				if (part.text) systemParts.push({ text: part.text });
			}
		} else invalid('Antigravity system instructions must be text or text blocks.');
	}

	const contents = [];
	const toolNames = new Map();
	for (const msg of anthropicRequest.messages || []) for (const block of Array.isArray(msg.content) ? msg.content : []) {
		if (block?.type === 'tool_use' && block.id && block.name) toolNames.set(block.id, block.name);
	}
	for (const msg of (anthropicRequest.messages || [])) {
		if (!msg || !['assistant', 'user'].includes(msg.role)) invalid('Antigravity messages require an assistant or user role.');
		const role = msg.role === 'assistant' ? 'model' : 'user';
		const parts = [];

		if (typeof msg.content === 'string') {
			if (msg.content.trim()) parts.push({ text: msg.content });
		} else if (Array.isArray(msg.content)) {
			for (const block of msg.content) {
				if (!block || typeof block !== 'object') invalid('Invalid Antigravity content block.');
				if (block.type === 'text') {
					if (typeof block.text !== 'string') invalid('Antigravity text blocks require text.');
					if (block.text.trim()) parts.push({ text: block.text, ...(toolThoughtSignature(block) ? { thoughtSignature: toolThoughtSignature(block) } : {}) });
				} else if (block.type === 'image') {
					if (block.source?.type === 'url' || typeof block.source?.data !== 'string' || !block.source.data) invalid('Antigravity images require inline base64 data; remote image URLs are unsupported.');
					if (block.source.media_type && !block.source.media_type.startsWith('image/')) invalid('Antigravity image blocks must use an image media type.');
					parts.push({
						inlineData: {
							mimeType: block.source.media_type || 'image/jpeg',
							data: block.source.data
						}
					});
				} else if (block.type === 'tool_use') {
					const functionCall = {
						name: block.name,
						args: parseToolArguments(block.input)
					};
					if (isClaude && block.id) functionCall.id = block.id;

					const part = { functionCall };
					if (isGemini) {
						const signature = block.thoughtSignature || block.gemini_thought_signature || block.extra_content?.google?.thought_signature || antigravitySignatureCache.get(block.id);
						if (signature) part.thoughtSignature = signature;
						else if (isThinking && !parts.some(previous => previous.functionCall)) throw Object.assign(new Error('Antigravity Gemini thinking tool history requires the original signature on its first function call; preserve gemini_thought_signature or anthropic_content between turns.'), { status: 400 });
					}
					parts.push(part);
				} else if (block.type === 'tool_result') {
					let responseObj;
					if (typeof block.content === 'string') {
						responseObj = { result: block.content };
					} else if (Array.isArray(block.content)) {
						if (block.content.some(c => c?.type !== 'text' || typeof c.text !== 'string')) invalid('Antigravity tool results support text only; image and document results are unsupported.');
						const text = block.content.filter(c => c.type === 'text').map(c => c.text).join('\n');
						responseObj = { result: text };
					} else {
						responseObj = { result: JSON.stringify(block.content || {}) };
					}
					const functionResponse = {
						name: toolNames.get(block.tool_use_id) || block.name,
						response: responseObj
					};
					if (!functionResponse.name) throw Object.assign(new Error('Tool result has no matching tool call name.'), { status: 400 });
					if (isClaude && block.tool_use_id) functionResponse.id = block.tool_use_id;
					parts.push({ functionResponse });
				} else if (block.type === 'thinking' && block.signature) {
					parts.push({
						text: block.thinking || '',
						thought: true,
						thoughtSignature: block.signature
					});
				} else invalid('Unsupported Antigravity content block: ' + (block.type || 'unknown') + '.');
			}
		} else invalid('Antigravity message content must be text or content blocks.');

		if (parts.length > 0) {
			contents.push({ role, parts });
		}
	}

	const generationConfig = {
		maxOutputTokens: anthropicRequest.max_tokens || 4096
	};
	if (anthropicRequest.temperature !== undefined) generationConfig.temperature = anthropicRequest.temperature;
	if (anthropicRequest.top_p !== undefined) generationConfig.topP = anthropicRequest.top_p;
	if (anthropicRequest.top_k !== undefined) generationConfig.topK = anthropicRequest.top_k;
	if (anthropicRequest.stop_sequences) generationConfig.stopSequences = anthropicRequest.stop_sequences;
	if (anthropicRequest.thinking_config !== undefined) {
		const config = anthropicRequest.thinking_config;
		if (!config || typeof config !== 'object' || Array.isArray(config)
			|| Object.keys(config).some(key => !['thinkingBudget', 'thinkingLevel', 'includeThoughts'].includes(key))
			|| (config.thinkingBudget !== undefined && (!Number.isInteger(config.thinkingBudget) || config.thinkingBudget < -1))
			|| (config.thinkingLevel !== undefined && (typeof config.thinkingLevel !== 'string' || !config.thinkingLevel))
			|| (config.includeThoughts !== undefined && typeof config.includeThoughts !== 'boolean')
			|| (config.thinkingBudget !== undefined && config.thinkingLevel !== undefined)) invalid('Unsupported Antigravity thinking configuration.');
		generationConfig.thinkingConfig = structuredClone(config);
	}
	if (anthropicRequest.thinking !== undefined) {
		const thinking = anthropicRequest.thinking;
		if (!thinking || typeof thinking !== 'object' || Array.isArray(thinking)
			|| Object.keys(thinking).some(key => !['type', 'budget_tokens'].includes(key))) invalid('Unsupported Antigravity thinking configuration.');
		let budget;
		if (thinking.type === 'disabled' && thinking.budget_tokens === undefined) budget = 0;
		else if ((thinking.type === undefined || thinking.type === 'enabled') && Number.isInteger(thinking.budget_tokens) && thinking.budget_tokens >= 0) budget = thinking.budget_tokens;
		else invalid('Antigravity thinking requires an explicit token budget or type disabled.');
		if (generationConfig.thinkingConfig && (generationConfig.thinkingConfig.thinkingLevel !== undefined
			|| (generationConfig.thinkingConfig.thinkingBudget !== undefined && generationConfig.thinkingConfig.thinkingBudget !== budget))) invalid('Conflicting Antigravity thinking budgets.');
		generationConfig.thinkingConfig = { ...generationConfig.thinkingConfig, thinkingBudget: budget };
	}

	let tools = undefined;
	if (anthropicRequest.tools && anthropicRequest.tools.length > 0) {
		tools = [{
			functionDeclarations: anthropicRequest.tools.map(t => ({
				name: t.name,
				description: t.description || '',
				parameters: sanitizeToolSchema(t.input_schema || t.parameters)
			}))
		}];
	}

	const sessionId = await deriveAntigravitySessionId(anthropicRequest.messages);

	const payload = {
		project: projectId.trim(),
		model: model,
		request: {
			contents,
			...(systemParts.length ? { systemInstruction: {
				role: 'user',
				parts: systemParts
			} } : {}),
			generationConfig,
			sessionId
		},
		userAgent: 'antigravity',
		requestType: 'agent',
		requestId: 'agent-' + crypto.randomUUID()
	};

	if (tools) payload.request.tools = tools;
	if (anthropicRequest.tool_choice) {
		const choice = anthropicRequest.tool_choice;
		const mode = { auto: 'AUTO', any: 'ANY', none: 'NONE', tool: 'ANY' }[choice.type];
		if (!mode || choice.disable_parallel_tool_use) throw Object.assign(new Error('This Antigravity adapter cannot represent the requested tool choice or parallel-call restriction.'), { status: 400 });
		if (choice.type === 'tool' && !anthropicRequest.tools?.some(tool => tool.name === choice.name)) throw Object.assign(new Error('Selected tool is not declared.'), { status: 400 });
		payload.request.toolConfig = { functionCallingConfig: { mode, ...(choice.type === 'tool' ? { allowedFunctionNames: [choice.name] } : {}) } };
	}

	return { payload, actualModel: model };
}

function convertOpenAIReqToAnthropic(openaiRequest) {
	if (openaiRequest.response_format && openaiRequest.response_format.type !== 'text') {
		throw Object.assign(new Error('This Antigravity adapter cannot guarantee structured JSON output. Remove response_format or use a compatible upstream.'), { status: 400 });
	}
	let request;
	try { request = openAIToAnthropicUpstreamRequest(openaiRequest, { allowGeminiThinking: true }); }
	catch (error) { if (error instanceof TypeError) error.status = 400; throw error; }
	// Preserve explicit signatures so a second Worker isolate can replay tool history.
	const originalTools = new Map();
	for (const message of openaiRequest.messages || []) for (const tool of message.tool_calls || []) originalTools.set(tool.id, tool);
	for (const message of request.messages) for (const block of Array.isArray(message.content) ? message.content : []) {
		if (block.type !== 'tool_use') continue;
		const tool = originalTools.get(block.id);
		const signature = tool?.gemini_thought_signature || tool?.extra_content?.google?.thought_signature || tool?.thoughtSignature;
		if (signature) block.thoughtSignature = signature;
	}
	return request;
}

async function callAntigravityUpstream(anthropicRequest, env, stream, clientSignal) {
	const actualModel = getAntigravityModelName(anthropicRequest.model);
	const accounts = (await getAntigravityAccounts(env)).filter(account => !account.models?.length || account.models.includes(actualModel));
	if (!accounts.length) return { success: false, status: 503, error: 'No Antigravity accounts configured for this model. Add an enabled account and its projectId.' };
	let prepared;
	try { prepared = (await buildAntigravityCloudCodeRequest(anthropicRequest, 'validation-only')).payload; }
	catch (error) { return { success: false, status: 400, error: error.message }; }
	let failure = { success: false, status: 502, error: 'All Antigravity accounts/endpoints failed.' };
	accountLoop: for (const account of shuffledUpstreams(accounts).slice(0, 3)) {
		if (clientSignal?.aborted) return { success: false, status: 499, error: 'Request cancelled.' };
		let token, payload, retried401 = false;
		try {
			token = await getAntigravityToken(account, env);
			const projectId = await discoverAntigravityProject(account, env, token);
			// Discovery can refresh a rejected access token; reuse the current cached token.
			token = await getAntigravityToken(account, env);
			payload = { ...prepared, project: projectId.trim() };
		} catch (error) {
			failure = { success: false, status: error.status === 400 ? 400 : 502, error: error.message };
			continue;
		}
		for (const endpoint of ANTIGRAVITY_ENDPOINTS) {
			if (clientSignal?.aborted) return { success: false, status: 499, error: 'Request cancelled.' };
			const url = stream || isThinkingModel(actualModel)
				? endpoint + '/v1internal:streamGenerateContent?alt=sse' : endpoint + '/v1internal:generateContent';
			while (true) {
				try {
					const headers = {
						Authorization: 'Bearer ' + token, 'Content-Type': 'application/json',
						'User-Agent': 'antigravity/1.11.5 worker/unknown',
						'X-Goog-Api-Client': 'google-cloud-sdk vscode_cloudshelleditor/0.1',
						'Client-Metadata': JSON.stringify({ ideType: 'IDE_UNSPECIFIED', platform: 'PLATFORM_UNSPECIFIED', pluginType: 'GEMINI' })
					};
					if (getModelFamily(actualModel) === 'claude' && isThinkingModel(actualModel)) headers['anthropic-beta'] = 'interleaved-thinking-2025-05-14';
					const response = await fetchUpstream(url, { headers, body: JSON.stringify(payload), signal: clientSignal }, {}, runtimeFetch(env));
					if (response.ok) {
						const contentType = response.headers.get('content-type') || '';
						if ((stream || isThinkingModel(actualModel)) && contentType && !contentType.includes('text/event-stream')) {
							await response.body?.cancel();
							return { success: false, status: 502, error: 'Antigravity returned a non-streaming response. The request was not repeated.' };
						}
						return { success: true, response, actualModel };
					}
					let message = 'Antigravity upstream returned HTTP ' + response.status + '.';
					try {
						const body = await response.json();
						if (typeof body.error?.message === 'string') message += ' ' + body.error.message;
					} catch (_) { /* Do not expose unstructured responses or reflected credentials. */ }
					for (const credential of [token, account.refreshToken, account.apiKey, account.oauthClientSecret, env.OAUTH_CLIENT_SECRET, ANTIGRAVITY_OAUTH_CLIENT.secret]) if (credential) message = redactUpstreamCredential(message, { apiToken: credential });
					failure = { success: false, status: response.status === 400 || response.status === 422 ? 400 : response.status === 429 ? 429 : 502, error: message.slice(0, 600) };
					if (response.status === 401 && account.refreshToken && !retried401) {
						retried401 = true;
						antigravityTokenCache.delete(await antigravityTokenCacheKey(account, env));
						token = await getAntigravityToken(account, env, { forceRefresh: true });
						continue;
					}
					if (failure.status === 400) return failure;
					if (response.status === 401 || response.status === 403 || response.status === 429) continue accountLoop;
					if (response.status === 404) break;
					return failure;
				} catch (error) {
					failure = { success: false, status: error.status === 400 ? 400 : 502, error: error.status === 400 ? error.message : 'Antigravity upstream connection failed.' };
					return clientSignal?.aborted ? { success: false, status: 499, error: 'Request cancelled.' } : failure;
				}
			}
		}
	}
	return failure;
}

function antigravityFinishKind(reason) {
	if (reason === 'STOP') return 'stop';
	if (reason === 'MAX_TOKENS') return 'length';
	if (['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII', 'IMAGE_SAFETY'].includes(reason)) return 'content_filter';
	throw Object.assign(new Error('Antigravity returned an unsupported or missing finish reason.'), { status: 502 });
}

function parseGoogleResponseToAnthropic(googleData, modelName) {
	googleData = googleData.response || googleData;
	if (googleData.error) throw Object.assign(new Error('Antigravity returned an upstream error.'), { status: 502 });
	if (googleData.promptFeedback?.blockReason) throw Object.assign(new Error('Antigravity blocked this response.'), { status: 502 });
	const firstCandidate = googleData.candidates?.[0] || {};
	const finish = antigravityFinishKind(firstCandidate.finishReason);
	const parts = finish === 'content_filter' ? [] : (firstCandidate.content?.parts || []).filter(part => finish !== 'length' || !part.functionCall);
	const content = [];

	for (const part of parts) {
		if (part.thought) {
			content.push({
				type: 'thinking',
				thinking: part.text || '',
				signature: part.thoughtSignature || undefined
			});
		} else if (part.text) {
			content.push({
				type: 'text',
				text: part.text
			});
		} else if (part.functionCall) {
			const id = part.functionCall.id || `toolu_${crypto.randomUUID().slice(0, 12)}`;
			if (part.thoughtSignature) {
				cacheAntigravitySignature(id, part.thoughtSignature);
			}
			content.push({
				type: 'tool_use',
				id,
				name: part.functionCall.name,
				input: parseToolArguments(part.functionCall.args, 502),
				thoughtSignature: part.thoughtSignature || undefined
			});
		}
	}

	let stop_reason = finish === 'content_filter' ? 'refusal' : 'end_turn';
	if (finish === 'length') stop_reason = 'max_tokens';
	else if (content.some(c => c.type === 'tool_use')) stop_reason = 'tool_use';

	const usage = googleData.usageMetadata || {};
	const inputTokens = (usage.promptTokenCount || 0) - (usage.cachedContentTokenCount || 0);
	const outputTokens = (usage.candidatesTokenCount || 0) + (usage.thoughtsTokenCount || 0);

	return {
		id: `msg_${crypto.randomUUID()}`,
		type: 'message',
		role: 'assistant',
		content,
		model: modelName,
		stop_reason,
		stop_sequence: null,
		usage: {
			input_tokens: Math.max(0, inputTokens),
			output_tokens: outputTokens,
			cache_read_input_tokens: usage.cachedContentTokenCount || 0,
			cache_creation_input_tokens: 0
		}
	};
}

// Cloud Code SSE is decoded once, including terminal frames without a newline.
// Errors remain errors instead of turning into successful empty responses.
function antigravityEventStream(upstreamBody) {
	const reader = upstreamBody.getReader(), decoder = new TextDecoder();
	let buffer = '', lines = [], ended = false, emitted = false;
	const completion = openAIStreamCompletion();
	// Do not expose function calls until the model has completed normally. A later
	// filter, token limit or malformed-function ending must not leave executable tools.
	const pendingParts = new Map();
	function dispatch(controller) {
		if (!lines.length || ended) return;
		const raw = lines.join('\n'); lines = [];
		if (raw.trim() === '[DONE]') { completion.finish(); ended = true; return; }
		let envelope;
		try { envelope = JSON.parse(raw); } catch (_) { throw new Error('Antigravity returned invalid stream JSON.'); }
		const data = envelope.response || envelope;
		if (envelope.error || data.error) {
			throw new Error('Antigravity returned an upstream stream error.');
		}
		for (const [position, candidate] of (data.candidates || []).entries()) {
			const index = candidate.index ?? position;
			const finish = candidate.finishReason ? antigravityFinishKind(candidate.finishReason) : null;
			const parts = candidate.content?.parts || [];
			const pending = pendingParts.get(index) || [];
			if (finish) {
				const complete = [...pending, ...parts];
				if (candidate.content || pending.length) candidate.content = { ...candidate.content, parts: finish === 'content_filter' ? []
					: finish === 'length' ? complete.filter(part => !part.functionCall) : complete };
				pendingParts.delete(index);
			} else {
				const firstTool = pending.length ? 0 : parts.findIndex(part => part.functionCall);
				if (firstTool >= 0) {
					pendingParts.set(index, [...pending, ...parts.slice(firstTool)]);
					candidate.content = { ...candidate.content, parts: parts.slice(0, firstTool) };
				}
			}
		}
		completion.accept({ choices: (data.candidates || []).map((candidate, index) => ({ index: candidate.index ?? index, finish_reason: candidate.finishReason })) });
		controller.enqueue(data); emitted = true;
	}
	function parse(controller, flush = false) {
		let end;
		while (!ended && (end = buffer.indexOf('\n')) >= 0) {
			const line = buffer.slice(0, end).replace(/\r$/, ''); buffer = buffer.slice(end + 1);
			if (!line) dispatch(controller);
			else if (line.startsWith('data:')) lines.push(line.slice(5).replace(/^ /, ''));
		}
		if (flush && !ended) {
			if (buffer.startsWith('data:')) lines.push(buffer.slice(5).replace(/^ /, '').replace(/\r$/, ''));
			buffer = ''; dispatch(controller);
		}
	}
	return new ReadableStream({
		async pull(controller) {
			emitted = false;
			try {
				while (!ended && !emitted) {
					const result = await reader.read();
					buffer += result.done ? decoder.decode() : decoder.decode(result.value, { stream: true });
					parse(controller, result.done);
					if (result.done) { completion.finish(); ended = true; }
				}
				if (ended) { controller.close(); await reader.cancel(); }
			} catch (error) { ended = true; controller.error(error); await reader.cancel(error).catch(() => {}); }
		},
		cancel(reason) { ended = true; return reader.cancel(reason); }
	});
}

async function parseThinkingSSEResponse(response) {
	const reader = antigravityEventStream(response.body).getReader();
	const finalParts = [];
	let usageMetadata = {}, finishReason;
	try {
		while (true) {
			const { value: data, done } = await reader.read();
			if (done) break;
			if (data.promptFeedback?.blockReason) throw new Error('Antigravity blocked this response.');
			if (data.usageMetadata) usageMetadata = { ...usageMetadata, ...data.usageMetadata };
			const candidate = data.candidates?.[0] || {};
			if (candidate.finishReason) finishReason = candidate.finishReason;
			for (const part of candidate.content?.parts || []) {
				if (part.functionCall?.partialArgs) throw new Error('Antigravity incremental partialArgs are unsupported.');
				const previous = finalParts.at(-1);
				if (typeof part.text === 'string' && previous && !part.functionCall && typeof previous.text === 'string' && !!previous.thought === !!part.thought) {
					previous.text += part.text;
					if (part.thoughtSignature) previous.thoughtSignature = part.thoughtSignature;
				} else finalParts.push(structuredClone(part));
			}
		}
	} finally { await reader.cancel().catch(() => {}); }
	return { candidates: [{ content: { parts: finalParts }, finishReason }], usageMetadata };
}

function antigravityToAnthropicStream(upstreamBody, modelName) {
	const reader = antigravityEventStream(upstreamBody).getReader(), encoder = new TextEncoder();
	const messageId = 'msg_' + crypto.randomUUID();
	let started = false, ended = false, index = -1, blockType = null, signature = '';
	let usage = {}, finishReason = null, hasTools = false;
	const seenTools = new Map();
	function emit(controller, event) { controller.enqueue(encoder.encode('event: ' + event.type + '\ndata: ' + JSON.stringify(event) + '\n\n')); }
	function start(controller) {
		if (started) return;
		started = true;
		emit(controller, { type: 'message_start', message: {
			id: messageId, type: 'message', role: 'assistant', content: [], model: modelName,
			stop_reason: null, stop_sequence: null,
			usage: { input_tokens: Math.max(0, (usage.promptTokenCount || 0) - (usage.cachedContentTokenCount || 0)), output_tokens: 0, cache_read_input_tokens: usage.cachedContentTokenCount || 0 }
		} });
	}
	function closeBlock(controller) {
		if (blockType === null) return;
		if (blockType === 'thinking' && signature) emit(controller, { type: 'content_block_delta', index, delta: { type: 'signature_delta', signature } });
		emit(controller, { type: 'content_block_stop', index });
		blockType = null; signature = '';
	}
	function begin(controller, type, content) {
		start(controller); closeBlock(controller); index++; blockType = type;
		emit(controller, { type: 'content_block_start', index, content_block: content });
	}
	return new ReadableStream({
		async pull(controller) {
			try {
				while (!ended) {
					const { value: data, done } = await reader.read();
					if (done) {
						start(controller); closeBlock(controller);
						const finish = antigravityFinishKind(finishReason);
						const reason = finish === 'content_filter' ? 'refusal' : finish === 'length' ? 'max_tokens' : hasTools ? 'tool_use' : 'end_turn';
						emit(controller, { type: 'message_delta', delta: { stop_reason: reason, stop_sequence: null }, usage: {
							input_tokens: Math.max(0, (usage.promptTokenCount || 0) - (usage.cachedContentTokenCount || 0)),
							output_tokens: (usage.candidatesTokenCount || 0) + (usage.thoughtsTokenCount || 0), cache_read_input_tokens: usage.cachedContentTokenCount || 0
						} });
						emit(controller, { type: 'message_stop' }); ended = true; controller.close(); return;
					}
					if (data.error) throw new Error('Antigravity returned an upstream error.');
					if (data.promptFeedback?.blockReason) throw new Error('Antigravity blocked this response.');
					if (data.usageMetadata) usage = { ...usage, ...data.usageMetadata };
					const candidate = data.candidates?.[0] || {};
					if (candidate.finishReason) finishReason = candidate.finishReason;
					let sent = false;
					for (const part of candidate.content?.parts || []) {
						if (part.functionCall) {
							const call = part.functionCall;
							if (call.partialArgs) throw new Error('Antigravity incremental partialArgs are unsupported.');
							const args = parseToolArguments(call.args, 502);
							const id = call.id || 'toolu_' + crypto.randomUUID();
							if (seenTools.has(id)) {
								if (seenTools.get(id) !== JSON.stringify(args)) throw new Error('Antigravity changed arguments for an existing tool call.');
								continue;
							}
							seenTools.set(id, JSON.stringify(args));
							hasTools = true; cacheAntigravitySignature(id, part.thoughtSignature);
							begin(controller, 'tool_use', { type: 'tool_use', id, name: call.name, input: {}, ...(part.thoughtSignature ? { thoughtSignature: part.thoughtSignature } : {}) });
							emit(controller, { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(args) } });
							closeBlock(controller); sent = true;
						} else if (part.thought) {
							if (blockType !== 'thinking') begin(controller, 'thinking', { type: 'thinking', thinking: '' });
							if (part.thoughtSignature) signature = part.thoughtSignature;
							if (part.text) emit(controller, { type: 'content_block_delta', index, delta: { type: 'thinking_delta', thinking: part.text } });
							sent = true;
						} else if (typeof part.text === 'string' && part.text) {
							if (blockType !== 'text') begin(controller, 'text', { type: 'text', text: '' });
							emit(controller, { type: 'content_block_delta', index, delta: { type: 'text_delta', text: part.text } }); sent = true;
						}
					}
					if (sent) return;
				}
			} catch (error) {
				emit(controller, { type: 'error', error: { type: 'api_error', message: 'Antigravity upstream stream failed or returned unsupported data.' } });
				ended = true; controller.close(); await reader.cancel(error).catch(() => {});
			}
		},
		cancel(reason) { ended = true; return reader.cancel(reason); }
	});
}

function antigravityToOpenAIStream(upstreamBody, modelName) {
	const reader = antigravityEventStream(upstreamBody).getReader(), encoder = new TextEncoder();
	const id = 'chatcmpl-' + crypto.randomUUID(), created = Math.floor(Date.now() / 1000);
	let started = false, ended = false, nextTool = 0, finishReason = null, usage = {}, hasTools = false;
	const seenTools = new Map();
	function emit(controller, delta, reason = null, tokenUsage) {
		controller.enqueue(encoder.encode('data: ' + JSON.stringify({ id, object: 'chat.completion.chunk', created, model: modelName,
			choices: delta === null ? [] : [{ index: 0, delta, finish_reason: reason }], ...(tokenUsage ? { usage: tokenUsage } : {})
		}) + '\n\n'));
	}
	return new ReadableStream({
		async pull(controller) {
			try {
				while (!ended) {
					const { value: data, done } = await reader.read();
					if (done) {
						if (!started) emit(controller, { role: 'assistant', content: '' });
						const finish = antigravityFinishKind(finishReason);
						const reason = finish === 'content_filter' ? 'content_filter' : finish === 'length' ? 'length' : hasTools ? 'tool_calls' : 'stop';
						emit(controller, {}, reason); emit(controller, null, null, geminiUsageToOpenAI(usage));
						controller.enqueue(encoder.encode('data: [DONE]\n\n')); ended = true; controller.close(); return;
					}
					if (data.promptFeedback?.blockReason) throw new Error('Antigravity blocked this response.');
					if (data.usageMetadata) usage = { ...usage, ...data.usageMetadata };
					const candidate = data.candidates?.[0] || {};
					if (candidate.finishReason) finishReason = candidate.finishReason;
					const parts = candidate.content?.parts || [];
					if (parts.length && !started) { started = true; emit(controller, { role: 'assistant', content: '' }); }
					let sent = false;
					for (const part of parts) {
						if (part.functionCall) {
							const call = part.functionCall;
							if (call.partialArgs) throw new Error('Antigravity incremental partialArgs are unsupported.');
							const args = parseToolArguments(call.args, 502);
							const toolId = call.id || 'call_' + crypto.randomUUID();
							if (seenTools.has(toolId)) {
								if (seenTools.get(toolId) !== JSON.stringify(args)) throw new Error('Antigravity changed arguments for an existing tool call.');
								continue;
							}
							seenTools.set(toolId, JSON.stringify(args)); hasTools = true;
							cacheAntigravitySignature(toolId, part.thoughtSignature);
							emit(controller, { gemini_parts: [{ ...structuredClone(part), functionCall: { ...structuredClone(call), args, id: toolId } }], tool_calls: [{
								index: nextTool++, id: toolId, type: 'function', function: { name: call.name, arguments: JSON.stringify(args) },
								...(part.thoughtSignature ? { gemini_thought_signature: part.thoughtSignature, extra_content: { google: { thought_signature: part.thoughtSignature } } } : {})
							}] }); sent = true;
						} else if (part.thought) {
							emit(controller, { reasoning_content: part.text || '', gemini_parts: [structuredClone(part)],
								...(part.thoughtSignature ? { anthropic_signature: part.thoughtSignature } : {}) }); sent = true;
						} else if (typeof part.text === 'string' && part.text) {
							emit(controller, { content: part.text, gemini_parts: [structuredClone(part)] }); sent = true;
						}
					}
					if (sent) return;
				}
			} catch (error) {
				controller.enqueue(encoder.encode('data: ' + JSON.stringify({ error: { type: 'upstream_error', message: 'Antigravity upstream stream failed or returned unsupported data.' } }) + '\n\n'));
				ended = true; controller.close(); await reader.cancel(error).catch(() => {});
			}
		},
		cancel(reason) { ended = true; return reader.cancel(reason); }
	});
}

async function handleAntigravityMessages(anthropicBody, env, targetModel, clientSignal) {
	try {
	const stream = !!anthropicBody.stream;
	const result = await callAntigravityUpstream({ ...anthropicBody, model: targetModel || anthropicBody.model }, env, stream, clientSignal);

	if (!result.success) {
		return new Response(JSON.stringify({
			type: 'error',
			error: {
				type: 'api_error',
				message: result.error
			}
		}), {
			status: result.status || 502,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	const modelName = anthropicBody.model || targetModel;

	if (stream) {
		const transformedStream = antigravityToAnthropicStream(result.response.body, modelName);
		return new Response(transformedStream, {
			headers: {
				'Content-Type': 'text/event-stream',
				'Cache-Control': 'no-cache',
			}
		});
	} else {
		const googleData = isThinkingModel(result.actualModel)
			? await parseThinkingSSEResponse(result.response)
			: await result.response.json();
		const anthropicResp = parseGoogleResponseToAnthropic(googleData, modelName);
		return new Response(JSON.stringify(anthropicResp), {
			headers: { 'Content-Type': 'application/json' }
		});
	}
	} catch (error) {
		return Response.json({ type: 'error', error: { type: error.status === 400 ? 'invalid_request_error' : 'api_error', message: error.status === 400 ? error.message : 'Antigravity response could not be decoded.' } }, { status: error.status === 400 ? 400 : 502 });
	}
}

async function handleAntigravityCompletions(openaiBody, env, targetModel, isLegacy, pathname, clientSignal) {
	try {
	const anthropicReq = convertOpenAIReqToAnthropic({ ...openaiBody, model: targetModel || openaiBody.model,
		...(isLegacy ? { messages: [{ role: 'user', content: openaiBody.prompt }] } : {}) });
	const stream = !!openaiBody.stream;
	const result = await callAntigravityUpstream(anthropicReq, env, stream, clientSignal);

	if (!result.success) {
		return new Response(JSON.stringify({
			error: {
				message: result.error,
				type: 'server_error'
			}
		}), {
			status: result.status || 502,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	const modelName = openaiBody.model || targetModel;

	if (stream) {
		const transformedStream = antigravityToOpenAIStream(result.response.body, modelName);
		return new Response(isLegacy ? legacyCompletionStream(transformedStream, modelName) : transformedStream, {
			headers: {
				'Content-Type': 'text/event-stream',
				'Cache-Control': 'no-cache',
			}
		});
	} else {
		const googleData = isThinkingModel(result.actualModel)
			? await parseThinkingSSEResponse(result.response)
			: await result.response.json();
		const anthropicResp = parseGoogleResponseToAnthropic(googleData, modelName);
		const openaiResp = anthropicToOpenAIUpstreamResponse(anthropicResp, modelName);
		for (const tool of openaiResp.choices?.[0]?.message?.tool_calls || []) {
			const signature = anthropicResp.content.find(block => block.type === 'tool_use' && block.id === tool.id)?.thoughtSignature;
			if (signature) { tool.gemini_thought_signature = signature; tool.extra_content = { google: { thought_signature: signature } }; }
		}
		return new Response(JSON.stringify(isLegacy ? toLegacyCompletion(openaiResp, modelName) : openaiResp), {
			headers: { 'Content-Type': 'application/json' }
		});
	}
	} catch (error) {
		return Response.json({ error: { type: error.status === 400 ? 'invalid_request_error' : 'server_error', message: error.status === 400 ? error.message : 'Antigravity response could not be decoded.' } }, { status: error.status === 400 ? 400 : 502 });
	}
}

// ----------------------------------------------------
// 后台管理面板的 API 接口处理函数
// ----------------------------------------------------
function geminiError(message, code = 400) {
	const statuses = { 400: 'INVALID_ARGUMENT', 401: 'UNAUTHENTICATED', 403: 'PERMISSION_DENIED', 404: 'NOT_FOUND', 405: 'METHOD_NOT_ALLOWED', 413: 'RESOURCE_EXHAUSTED', 429: 'RESOURCE_EXHAUSTED', 499: 'CANCELLED', 501: 'UNIMPLEMENTED', 503: 'UNAVAILABLE' };
	return Response.json({ error: { code, message, status: statuses[code] || 'INTERNAL' } }, { status: code });
}

async function handleGeminiEndpoint(request, env) {
	if (!await checkProxyAuth(request, env)) return geminiError('Invalid or missing API key.', 401);
	const url = new URL(request.url);
	const match = /^\/(v1beta|v1)\/models(?:\/(.+?))?(?::(generateContent|streamGenerateContent|embedContent|batchEmbedContents|countTokens))?$/.exec(url.pathname);
	if (!match) return geminiError('Path not found.', 404);
	let model;
	try { model = match[2] ? decodeURIComponent(match[2]) : null; } catch (_) { return geminiError('Invalid model name.'); }
	const action = match[3];
	if (!action && request.method === 'GET') {
		const listHeaders = new Headers(request.headers);
		if (url.searchParams.has('key')) listHeaders.set('x-goog-api-key', url.searchParams.get('key'));
		const modelsResponse = await handleV1Proxy(new Request(new URL('/v1/models', url), { headers: listHeaders }), env);
		if (!modelsResponse.ok) return geminiError('Model configuration unavailable.', modelsResponse.status);
		const available = (await modelsResponse.json()).data || [];
		const map = await getCustomModelMap(env);
		const describe = entry => {
			const target = map[entry.id] || entry.id;
			const embeddings = /embedding|(?:^|\/)bge-(?:small|base|large|m3)/i.test(target);
			const otherTask = /(?:^|\/)(?:aura-|whisper|flux|nova-3|melotts|smart-turn|stable-diffusion|dreamshaper|lucid-origin|phoenix-|resnet-|distilbert-|bge-reranker|m2m100-|indictrans2-)/i.test(target);
			return { name: `models/${entry.id}`, displayName: entry.id, supportedGenerationMethods: embeddings ? ['embedContent', 'batchEmbedContents'] : otherTask ? [] : ['generateContent', 'streamGenerateContent'] };
		};
		if (model) {
			const found = available.find(entry => entry.id === model);
			return found ? Response.json(describe(found)) : geminiError(`Model not found: ${model}`, 404);
		}
		const pageSize = Math.min(1000, Math.max(1, Number(url.searchParams.get('pageSize') || 1000)));
		const offset = Number(url.searchParams.get('pageToken') || 0);
		if (!Number.isInteger(pageSize) || !Number.isInteger(offset) || offset < 0) return geminiError('Invalid pagination parameters.');
		return Response.json({ models: available.slice(offset, offset + pageSize).map(describe), ...(offset + pageSize < available.length ? { nextPageToken: String(offset + pageSize) } : {}) });
	}
	if (request.method !== 'POST') return geminiError('This endpoint requires POST.', 405);
	if (!model || !action) return geminiError('Path not found.', 404);
	if (action === 'countTokens') return geminiError('Exact token counting is not available across upstream protocols.', 501);
	let body;
	try { body = await readRequestJson(request); } catch (error) { return requestJsonErrorResponse(request, error); }
	if (!body || typeof body !== 'object' || Array.isArray(body)) return geminiError('Request body must be an object.');
	try {
		if (action === 'embedContent' || action === 'batchEmbedContents') {
			const items = action === 'batchEmbedContents' ? body.requests : [body];
			if (!Array.isArray(items) || !items.length) return geminiError('Embedding requests must be a non-empty array.');
			if (action === 'batchEmbedContents' && Object.keys(normalizeEmbeddingOptions(body)).length) return geminiError('Put embedding configuration on each batch request.');
			const configurations = items.map(normalizeEmbeddingOptions), options = configurations[0];
			if (configurations.some(config => !protocolJsonEqual(config, options))) return geminiError('Batch embedding options must match.');
			const input = items.map(item => {
				if (item.model && item.model !== `models/${model}` && item.model !== model) throw new TypeError('All embedding requests must use the path model.');
				if (!Array.isArray(item.content?.parts) || !item.content.parts.length || item.content.parts.some(part => typeof part.text !== 'string')) throw new TypeError('Embeddings require text content parts.');
				return item.content.parts.map(part => part.text).join('\n');
			});
			const response = await handleEmbeddings(request, env, { model, input, embedContentConfig: options });
			const data = await response.json();
			if (!response.ok) return geminiError(data.error?.message || 'Embedding request failed.', response.status);
			const embeddings = data.data.map(item => ({ values: item.embedding }));
			return Response.json(action === 'batchEmbedContents' ? { embeddings } : { embedding: embeddings[0] });
		}
		const payload = geminiToOpenAIRequest(body, model);
		payload.stream = action === 'streamGenerateContent';
		const response = await handleCompletions(request, env, '/v1/chat/completions', payload);
		if (!response.ok) {
			const error = await response.json();
			return geminiError(error.error?.message || 'Generation failed.', response.status);
		}
		if (payload.stream) {
			const sse = url.searchParams.get('alt') === 'sse';
			return new Response(openAIToGeminiStream(response.body, model, { sse }), { headers: { 'Content-Type': sse ? 'text/event-stream' : 'application/json', 'Cache-Control': 'no-cache' } });
		}
		return Response.json(openAIToGeminiResponse(await response.json(), model));
	} catch (error) {
		if (error instanceof TypeError || error.status === 400) return geminiError(error.message);
		console.error('Gemini request failed: upstream_error');
		return geminiError('Upstream request failed.', 502);
	}
}

async function handleDashboardApi(request, env, ctx) {
	const url = new URL(request.url);
	const method = request.method;
	if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && request.headers.get('Origin') && request.headers.get('Origin') !== url.origin) {
		return Response.json({ error: 'Origin not allowed' }, { status: 403 });
	}

	// 1. 查询初始化状态（密码通过环境变量配置，所以这里永远返回已初始化）
	if (url.pathname === '/api/auth/status' && method === 'GET') {
		return new Response(JSON.stringify({
			isSetup: true
		}), { headers: { 'Content-Type': 'application/json' } });
	}

	// 2. 设置首个管理员密码（已停用，改由环境变量 ADMIN_PASSWORD 配置）
	if (url.pathname === '/api/auth/setup' && method === 'POST') {
		return new Response(JSON.stringify({ error: 'Setup is handled via environment variable ADMIN_PASSWORD' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
	}

	// Login attempts and revocable sessions share the selected authoritative store.
	if (url.pathname === '/api/auth/login' && method === 'POST') {
		if (request.headers.get('Origin') && request.headers.get('Origin') !== url.origin) return Response.json({ error: 'Origin not allowed' }, { status: 403 });
		let payload;
		try { payload = await readRequestJson(request, LOGIN_JSON_LIMIT); } catch (error) { return requestJsonErrorResponse(request, error); }
		if (typeof payload?.password !== 'string' || payload.password.length > 4096) return Response.json({ error: 'Invalid login payload' }, { status: 400 });
		const ipKey = await sha256('admin-login:' + (env[GATEWAY_RUNTIME]?.clientIp ?? (request.headers.get('CF-Connecting-IP') || 'local')));
		const result = await adminSessionRequest(env, { type: 'login', password: payload.password, ipKey }, request);
		if (result.limited) return Response.json({ error: 'Too many login attempts. Please try again later.' }, { status: 429, headers: { 'Retry-After': String(result.retryAfter), 'Cache-Control': 'no-store' } });
		if (!result.success) return Response.json({ error: 'Incorrect password' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
		return Response.json({ success: true }, { headers: { 'Set-Cookie': `admin_token=${result.token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=86400`, 'Cache-Control': 'no-store' } });
	}

	// 4. 退出登录
	if (url.pathname === '/api/auth/logout' && method === 'POST') {
		const token = adminSessionToken(request);
		if (token) await adminSessionRequest(env, { type: 'logout', token }, request);
		return new Response(JSON.stringify({ success: true }), {
			headers: {
				'Content-Type': 'application/json',
				'Set-Cookie': `admin_token=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`,
				'Cache-Control': 'no-store'
			}
		});
	}

	// 5. Public summaries only read the authoritative cache; authenticated refreshes share one flight.
	if (url.pathname === '/api/usage/summary' && (method === 'GET' || method === 'POST')) {
		if (method === 'POST' && !await checkAdminAuth(request, env)) return Response.json({ error: 'Unauthorized' }, { status: 401 });
		const accounts = await getAccounts(env);
		const cacheMap = await usageStoreRequest(env, method === 'POST');
		return Response.json(buildUsageSummary(accounts, cacheMap));
	}

	// --------------------------------------------------
	// 下面这些都是需要登录后才能访问的接口
	// --------------------------------------------------
	const isAuthorized = await checkAdminAuth(request, env);
	if (!isAuthorized) {
		return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
	}

	if (url.pathname === '/api/accounts') {
		if (method === 'GET') {
			const accounts = await getAccounts(env);
			return Response.json(accounts.map(account => ({
				id: account.id, name: account.name, accountId: account.accountId,
				provider: accountProviderForAdmin(account), baseUrl: account.baseUrl || '',
				models: account.models || [], status: account.status, projectId: account.projectId || '', projectSource: account.projectSource || '', apiToken: '********'
			})));
		}

		if (method === 'POST') {
			const payload = await readRequestJson(request, ADMIN_JSON_LIMIT);
			const existing = payload?.id ? (await getAccounts(env)).find(account => account.id === payload.id) : undefined;
			if (payload?.id && !existing) return Response.json({ error: 'Account not found' }, { status: 404 });
			let account;
			try { account = normalizeProviderAccountInput(payload, existing); }
			catch (error) { return Response.json({ error: error.message }, { status: 400 }); }
			let antigravityProject;
			if (account.provider === 'antigravity' && account.status === 'active') {
				try {
					const runtime = antigravityRuntimeAccount(account);
					const token = await getAntigravityToken(runtime, env);
					antigravityProject = { projectId: await discoverAntigravityProject(runtime, env, token), projectSource: account.projectSource, projectIdentity: await antigravityProjectIdentity(runtime, env) };
				} catch (error) { return Response.json({ error: error.message || 'Antigravity sign-in failed' }, { status: error.status === 400 ? 400 : 502 }); }
			}
			try { await configRequest(env, { type: 'account.upsert', account: payload, antigravityProject, expectedAccountRevision: existing ? await sha256(JSON.stringify(existing)) : undefined }); }
			catch (error) {
				if (error.status === 409) return Response.json({ error: 'Account changed during validation; reload and try again.' }, { status: 409 });
				throw error;
			}
			return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
		}

		if (method === 'DELETE') {
			const { id } = await readRequestJson(request, ADMIN_JSON_LIMIT);
			await configRequest(env, { type: 'account.delete', id });
			return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
		}
	}

	// 7. 测试账号是否能正常连接
	if (url.pathname === '/api/accounts/test' && method === 'POST') {
		const payload = await readRequestJson(request, ADMIN_JSON_LIMIT);
		const existing = payload?.id ? (await getAccounts(env)).find(account => account.id === payload.id) : undefined;
		if (payload?.id && !existing) return Response.json({ success: false, error: 'Account not found' }, { status: 404 });
		let account;
		try { account = normalizeProviderAccountInput(payload, existing); }
		catch (error) { return Response.json({ success: false, error: error.message }, { status: 400 }); }
		const provider = account.provider;
		if (provider === 'antigravity') {
			try {
				const runtime = antigravityRuntimeAccount(account);
				const token = await getAntigravityToken(runtime, env);
				const projectId = await discoverAntigravityProject(runtime, env, token);
				return Response.json({ success: true, provider, projectId, message: '登录及项目查询成功，未发送生成请求。' });
			} catch (error) { return Response.json({ success: false, provider, error: error.message || 'Antigravity sign-in failed' }); }
		}
		if (provider !== 'cloudflare') {
			try {
				const target = new URL(upstreamEndpoint(account, provider, 'models'));
				if (provider !== 'gemini') target.searchParams.set('limit', '1');
				else target.searchParams.set('pageSize', '1');
				const headers = provider === 'gemini' ? { 'x-goog-api-key': account.apiToken }
					: provider === 'anthropic' ? { 'x-api-key': account.apiToken, 'anthropic-version': '2023-06-01' }
					: { Authorization: `Bearer ${account.apiToken}` };
				const response = await fetchUpstream(target.href, { method: 'GET', headers, signal: request.signal }, {
					headerTimeoutMs: 15000, bodyIdleTimeoutMs: 15000, maxResponseBytes: 1024 * 1024
				}, runtimeFetch(env));
				void response.body?.cancel().catch(() => {});
				return Response.json({ success: response.ok, provider, status: response.status, ...(response.ok ? { message: '模型目录连接成功，未发送生成请求。' } : { error: `Upstream model listing returned HTTP ${response.status}` }) });
			} catch (error) { return Response.json({ success: false, provider, error: 'Unable to connect to the upstream model listing: ' + cleanUpstreamError(error.message, account) }); }
		}
		const targetAccountId = account.accountId;
		const targetApiToken = account.apiToken;
		if (env[GATEWAY_RUNTIME]?.hasFetchBudget?.(3) === false) {
			return Response.json({ success: false, code: 'platform_subrequest_limit',
				error: 'The platform request budget cannot complete this connection test. No upstream probes were sent.' }, { status: 503 });
		}
		const fetchConnectionTest = (target, options) => fetchUpstream(target, { ...options, signal: request.signal }, {
			headerTimeoutMs: 15000, bodyIdleTimeoutMs: 15000, maxResponseBytes: 1024 * 1024
		}, runtimeFetch(env));

		const [readResult, editResult, analyticsResult] = await Promise.all([
			// 1. Workers AI > Read
			(async () => {
				try {
					const res = await fetchConnectionTest(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(targetAccountId)}/ai/models/search?limit=1`, {
						method: 'GET',
						headers: {
							'Authorization': `Bearer ${targetApiToken}`,
							'Content-Type': 'application/json'
						}
					});
					const data = await res.json();
					if (res.ok && data.success !== false) {
						return { success: true };
					}
					return { success: false, error: cleanUpstreamError(data.errors?.[0]?.message || `HTTP ${res.status}`, account) };
				} catch (e) {
					return { success: false, error: cleanUpstreamError(e.message, account) };
				}
			})(),
			// 2. Workers AI > Edit
			(async () => {
				try {
					const res = await fetchConnectionTest(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(targetAccountId)}/ai/run/@cf/google/embeddinggemma-300m`, {
						method: 'POST',
						headers: {
							'Authorization': `Bearer ${targetApiToken}`,
							'Content-Type': 'application/json'
						},
						body: JSON.stringify({ text: ['test'] })
					});
					const data = await res.json();
					if (res.ok && data.success !== false) {
						return { success: true };
					}
					return { success: false, error: cleanUpstreamError(data.errors?.[0]?.message || `HTTP ${res.status}`, account) };
				} catch (e) {
					return { success: false, error: cleanUpstreamError(e.message, account) };
				}
			})(),
			// 3. Account Analytics > Read
			(async () => {
				try {
					const query = `
						query GetAIUsage($accountId: String!, $start: String!) {
							viewer {
								accounts(filter: { accountTag: $accountId }) {
									aiInferenceAdaptiveGroups(
										filter: { datetime_geq: $start }
										limit: 1
									) {
										count
									}
								}
							}
						}
					`;
					const todayUTC = new Date();
					todayUTC.setUTCHours(0, 0, 0, 0);
					const startToday = todayUTC.toISOString().split('.')[0] + 'Z';

					const res = await fetchConnectionTest(`https://api.cloudflare.com/client/v4/graphql`, {
						method: 'POST',
						headers: {
							'Authorization': `Bearer ${targetApiToken}`,
							'Content-Type': 'application/json'
						},
						body: JSON.stringify({
							query,
							variables: {
								accountId: targetAccountId,
								start: startToday
							}
						})
					});
					const data = await res.json();
					if (res.ok && !data.errors && data.data?.viewer?.accounts) {
						return { success: true };
					}
					return { success: false, error: cleanUpstreamError(data.errors?.[0]?.message || `HTTP ${res.status}`, account) };
				} catch (e) {
					return { success: false, error: cleanUpstreamError(e.message, account) };
				}
			})()
		]);

		const allSuccess = readResult.success && editResult.success && analyticsResult.success;
		let overallError = null;
		if (!allSuccess) {
			const failedPerms = [];
			if (!readResult.success) failedPerms.push(`Workers AI > Read (${readResult.error})`);
			if (!editResult.success) failedPerms.push(`Workers AI > Edit (${editResult.error})`);
			if (!analyticsResult.success) failedPerms.push(`Account Analytics > Read (${analyticsResult.error})`);
			overallError = failedPerms.join('; ');
		}

		return new Response(JSON.stringify({
			success: allSuccess,
			error: overallError,
			permissions: {
				workersAiRead: readResult,
				workersAiEdit: editResult,
				accountAnalyticsRead: analyticsResult
			}
		}), { headers: { 'Content-Type': 'application/json' } });
	}

	// 8. 登录后看到的详细用量统计
	if (url.pathname === '/api/accounts/usage' && method === 'GET') {
		const accounts = await getAccounts(env);
		if (accounts.length === 0) {
			return new Response(JSON.stringify([]), { headers: { 'Content-Type': 'application/json' } });
		}

		// Refresh at most 20 stale, distinct Cloudflare accounts. Fresh entries reuse the shared cache.
		const cacheMap = await refreshAccountsUsage(env, accounts, 20);
		const uniqueIds = new Map(uniqueCloudflareAccounts(accounts).map(account => [account.accountId.trim().toLowerCase(), account.id]));

		// 构建完整结果列表，若没有缓存数据则标为 pending
		const results = accounts.map(account => {
			const cloudflareActive = accountProviderForAdmin(account) === 'cloudflare' && account.status === 'active';
			const duplicateOf = cloudflareActive && uniqueIds.get(account.accountId.trim().toLowerCase()) !== account.id ? uniqueIds.get(account.accountId.trim().toLowerCase()) : undefined;
			const usageSupported = cloudflareActive && !duplicateOf;
			const cached = usageSupported ? cacheMap[account.id] : undefined;
			return {
				id: account.id,
				name: account.name,
				accountId: account.accountId,
				provider: accountProviderForAdmin(account),
				usageSupported,
				duplicateOf,
				status: usageSupported ? (cached ? cached.status : 'pending') : (account.status === 'disabled' ? 'disabled' : 'unsupported'),
				error: cached ? cached.error : undefined,
				usageToday: cached ? cached.usageToday : 0,
				modelsToday: cached ? cached.modelsToday : [],
				history: cached ? cached.history : [],
				lastUpdated: cached ? cached.timestamp : 0
			};
		});

		return new Response(JSON.stringify(results), { headers: { 'Content-Type': 'application/json' } });
	}

	// 9. 代理接口用的自定义 API 密钥管理
	if (url.pathname === '/api/keys') {
		if (method === 'GET') {
			const keys = await getApiKeys(env);
			return new Response(JSON.stringify(keys), { headers: { 'Content-Type': 'application/json' } });
		}

		if (method === 'POST') {
			const { name, key } = await readRequestJson(request, ADMIN_JSON_LIMIT);
			if (typeof name !== 'string' || !name || (key !== undefined && typeof key !== 'string')) {
				return new Response(JSON.stringify({ error: 'Name is required' }), { status: 400 });
			}

			const generatedKey = key || `sk-wa-${crypto.randomUUID().replace(/-/g, '')}`;
			await configRequest(env, { type: 'key.add', key: {
				id: crypto.randomUUID(),
				name,
				key: generatedKey,
				createdAt: new Date().toISOString()
			} });
			return new Response(JSON.stringify({ success: true, key: generatedKey }), { headers: { 'Content-Type': 'application/json' } });
		}

		if (method === 'DELETE') {
			const { id } = await readRequestJson(request, ADMIN_JSON_LIMIT);
			await configRequest(env, { type: 'key.delete', id });
			return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
		}
	}

	// 10. 模型设置和映射
	if (url.pathname === '/api/settings') {
		if (method === 'GET') {
			const customMap = await getCustomModelMap(env);
			return new Response(JSON.stringify({ customModelMap: customMap }), { headers: { 'Content-Type': 'application/json' } });
		}

		if (method === 'POST') {
			const { customModelMap } = await readRequestJson(request, ADMIN_JSON_LIMIT);
			if (!customModelMap || typeof customModelMap !== 'object' || Array.isArray(customModelMap)
				|| Object.values(customModelMap).some(value => typeof value !== 'string' || !value.trim())) {
				return new Response(JSON.stringify({ error: 'Invalid customModelMap payload' }), { status: 400 });
			}
			await saveCustomModelMap(env, customModelMap);
			return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
		}
	}

	return new Response(JSON.stringify({ error: 'Endpoint not found' }), { status: 404 });
}

// ----------------------------------------------------
// 前端页面处理函数（按页面拆分）
// ----------------------------------------------------

// Small first-party canvas renderer. No network-fetched JavaScript runs beside credentials.
function gatewayChartRuntime() {
	window.clearPrivateUiCache = () => ['cache_accounts_usage', 'cache_usage_details_last_fetched', 'cache_keys_count'].forEach(key => localStorage.removeItem(key));
	window.Chart = class {
		constructor(context, config) {
			this.context = context; this.canvas = context.canvas; this.config = config;
			this.canvas.setAttribute('role', 'img');
			this.canvas.setAttribute('aria-label', (config.data.labels || []).map((label, i) => String(label) + ': ' + (config.data.datasets[0]?.data[i] || 0)).join('; '));
			this.observer = new ResizeObserver(() => this.draw()); this.observer.observe(this.canvas.parentElement); this.draw();
		}
		draw() {
			const { canvas, context: ctx, config } = this;
			const rect = canvas.parentElement.getBoundingClientRect(), width = Math.max(1, rect.width), height = Math.max(1, rect.height || 190), scale = devicePixelRatio || 1;
			canvas.width = Math.round(width * scale); canvas.height = Math.round(height * scale); canvas.style.width = width + 'px'; canvas.style.height = height + 'px';
			ctx.setTransform(scale, 0, 0, scale, 0, 0); ctx.clearRect(0, 0, width, height);
			const dataset = config.data.datasets[0] || {}, values = (dataset.data || []).map(value => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0);
			const light = document.documentElement.getAttribute('data-theme') === 'light', textColor = light ? '#57606a' : '#8b949e';
			if (config.type === 'doughnut') {
				const total = values.reduce((sum, value) => sum + value, 0), radius = Math.max(1, Math.min(width, height) * 0.42), stroke = radius * 0.3;
				let angle = -Math.PI / 2;
				ctx.lineWidth = stroke;
				values.forEach((value, index) => {
					if (!value || !total) return;
					const next = angle + value / total * Math.PI * 2;
					ctx.beginPath(); ctx.arc(width / 2, height / 2, radius - stroke / 2, angle, next);
					ctx.strokeStyle = dataset.backgroundColor?.[index % dataset.backgroundColor.length] || '#2f81f7'; ctx.stroke(); angle = next;
				});
				ctx.fillStyle = textColor; ctx.font = '600 16px system-ui'; ctx.textAlign = 'center'; ctx.fillText(Math.ceil(total).toLocaleString(), width / 2, height / 2 + 5);
			} else {
				const left = 48, top = 18, bottom = 30, right = 12, plotWidth = Math.max(1, width - left - right), plotHeight = Math.max(1, height - top - bottom);
				const max = Math.max(1, Math.ceil(Math.max(0, ...values) / 4)) * 4;
				ctx.font = '12px system-ui'; ctx.fillStyle = textColor; ctx.textAlign = 'right';
				for (let i = 0; i <= 4; i++) {
					const y = top + plotHeight * i / 4;
					ctx.strokeStyle = light ? '#d8dee4' : '#21262d'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(width - right, y); ctx.stroke();
					ctx.fillText(Math.round(max * (1 - i / 4)).toLocaleString(), left - 7, y + 4);
				}
				ctx.beginPath(); values.forEach((value, i) => { const x = left + plotWidth * i / Math.max(1, values.length - 1), y = top + plotHeight * (1 - value / max); if (!i) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
				ctx.strokeStyle = dataset.borderColor || '#2f81f7'; ctx.lineWidth = 2.5; ctx.stroke();
				(config.data.labels || []).forEach((label, i, labels) => { if (i % Math.max(1, Math.ceil(labels.length / 7))) return; const x = left + plotWidth * i / Math.max(1, labels.length - 1); ctx.textAlign = i === 0 ? 'left' : i === labels.length - 1 ? 'right' : 'center'; ctx.fillText(String(label).slice(-5), x, height - 8); });
			}
		}
		destroy() { this.observer.disconnect(); this.context.clearRect(0, 0, this.canvas.width, this.canvas.height); }
	};
}

function secureHtmlResponse(html) {
	html = html.replace('</head>', `<style>${PROJECT_BRAND_CSS}</style></head>`);
	const nonce = crypto.randomUUID().replace(/-/g, '');
	const handlers = [];
	// Convert only authored markup, never script string contents, to nonce-bound listeners.
	html = html.split(/(<script\b[^>]*>[\s\S]*?<\/script>)/gi).map(part => /^<script\b/i.test(part) ? part : part.replace(/\son(click|input|change|keydown)="([^"]*)"/g, (_, event, code) => {
		const id = handlers.length; handlers.push({ event, code, id }); return ` data-ui-${event}="${id}"`;
	})).join('');
	const bindings = handlers.map(({ event, code, id }) => `document.querySelector('[data-ui-${event}="${id}"]').addEventListener('${event}',function(event){${code}});`).join('\n');
	html = html.replace(/<script>/g, `<script nonce="${nonce}">`).replace('</body>', `<script nonce="${nonce}">${bindings}</script></body>`);
	return new Response(html, { headers: {
		'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
		'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY',
		'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; script-src-attr 'none'; style-src 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`
	} });
}

// 1. 首页 / 登录页
const DAY_NIGHT_SWITCH_SCRIPT = `
(function() {
  const REF_CSS = "* { margin: 0; padding: 0; transition: 0.7s; -webkit-tap-highlight-color:rgba(0,0,0,0); } .container { position: absolute;top: 50%;left: 50%;margin-top: -35em;margin-left: -90em;width: 180em; height: 70em; display: inline-block; vertical-align: bottom; transform: translate3d(0, 0, 0); } .components{ position:fixed; width: 180em; height: 70em; background-color: rgba(70, 133, 192,1); border-radius: 100em; box-shadow: inset 0 0 5em 3em rgba(0, 0, 0, 0.5); overflow: hidden; transition: 0.7s; transition-timing-function: cubic-bezier( 0,0.5, 1,1); cursor: pointer; } .main-button{ margin: 7.5em 0 0 7.5em; width: 55em; height:55em; background-color: rgba(255, 195, 35,1); border-radius: 50%; box-shadow:3em 3em 5em rgba(0, 0, 0, 0.5), inset -3em -5em 3em -3em rgba(0, 0, 0, 0.5), inset 4em 5em 2em -2em rgba(255, 230, 80,1); transition: 1.0s; transition-timing-function: cubic-bezier(0.56, 1.35, 0.52, 1.00); } .moon{ position: absolute; background-color: rgba(150, 160, 180, 1); box-shadow:inset 0em 0em 1em 1em rgba(0, 0, 0, 0.3) ; border-radius: 50%; transition: 0.5s; opacity: 0; } .moon:nth-child(1){ top: 7.5em; left: 25em; width: 12.5em; height: 12.5em; } .moon:nth-child(2){ top: 20em; left: 7.5em; width: 20em; height: 20em; } .moon:nth-child(3){ top: 32.5em; left: 32.5em; width: 12.5em; height: 12.5em; } .daytime-background { position: absolute; border-radius: 50%; transition: 1.0s; transition-timing-function: cubic-bezier(0.56, 1.35, 0.52, 1.00); } .daytime-background:nth-child(2){ top: -20em; left: -20em; width: 110em; height:110em; background-color: rgba(255, 255, 255,0.2); z-index: -2; } .daytime-background:nth-child(3){ top: -32.5em; left: -17.5em; width: 135em; height:135em; background-color: rgba(255, 255, 255,0.1); z-index: -3; } .daytime-background:nth-child(4){ top: -45em; left: -15em; width: 160em; height:160em; background-color: rgba(255, 255, 255,0.05); z-index: -4; } .cloud,.cloud-light{ transform: translateY(10em); transition: 1.0s; transition-timing-function: cubic-bezier(0.56, 1.35, 0.52, 1.00); } .cloud-son{ position: absolute; background-color: #fff; border-radius: 50%; z-index: -1; transition: transform 6s,right 1s,bottom 1s; } .cloud-son:nth-child(6n+1){ right: -20em; bottom: 10em; width: 50em; height: 50em; } .cloud-son:nth-child(6n+2) { right: -10em; bottom: -25em; width: 60em; height: 60em; } .cloud-son:nth-child(6n+3) { right: 20em; bottom: -40em; width: 60em; height: 60em; } .cloud-son:nth-child(6n+4) { right: 50em; bottom: -35em; width: 60em; height: 60em; } .cloud-son:nth-child(6n+5) { right: 75em; bottom: -60em; width: 75em; height: 75em; } .cloud-son:nth-child(6n+6) { right: 110em; bottom: -50em; width: 60em; height: 60em; } .cloud{ z-index: -2; } .cloud-light{ position: absolute; right: 0em; bottom: 25em; opacity: 0.5; z-index: -3; } .stars{ transform: translateY(-125em); z-index: -2; transition: 1.0s; transition-timing-function: cubic-bezier(0.56, 1.35, 0.52, 1.00); } .big { --size: 7.5em; } .medium { --size: 5em; } .small { --size: 3em; } .star { position: absolute; width: calc(2*var(--size)); height: calc(2*var(--size)); } .star:nth-child(1){ top: 11em; left: 39em; } .star:nth-child(2){ top: 39em; left: 91em; } .star:nth-child(3){ top: 26em; left: 19em; } .star:nth-child(4){ top: 37em; left: 66em; } .star:nth-child(5){ top: 21em; left: 75em; } .star:nth-child(6){ top: 51em; left: 38em; } .star-son{ float: left; width: var(--size); height: var(--size); background-image: radial-gradient(circle var(--size) at var(--pos, left 0), transparent var(--size), #fff); } .star-son:nth-child(1) { --pos: left 0; } .star-son:nth-child(2) { --pos: right 0; } .star-son:nth-child(3) { --pos: 0 bottom; } .star-son:nth-child(4) { --pos: right bottom; }";
  const EXTRA_CSS = ".dn-plane, .dn-bear { position: absolute; left: 0; top: 0; z-index: -1; opacity: 0; pointer-events: none; transition: opacity 0.8s ease; } .dn-plane svg, .dn-bear svg { display: block; } .dn-plane svg { width: 24em; height: 14.5em; } .dn-bear svg { width: 30em; height: 30em; } .is-day .dn-plane { opacity: 0.95; } .is-night .dn-bear { opacity: 0.95; } .dn-plane { animation: dn-plane-fly 9.5s linear infinite; } .dn-bear { animation: dn-bear-float 17s linear infinite; } @keyframes dn-plane-fly { 0% { transform: translate(-28em, 14em) rotate(-4deg); } 35% { transform: translate(70em, 9em) rotate(2deg); } 70% { transform: translate(150em, 15em) rotate(-2deg); } 100% { transform: translate(196em, 10em) rotate(4deg); } } @keyframes dn-bear-float { 0% { transform: translate(-30em, 34em) rotate(-10deg); } 30% { transform: translate(50em, 27em) rotate(6deg); } 55% { transform: translate(112em, 33em) rotate(-6deg); } 80% { transform: translate(160em, 26em) rotate(8deg); } 100% { transform: translate(200em, 32em) rotate(-10deg); } } @media (prefers-reduced-motion: reduce) { .dn-plane, .dn-bear { animation: none !important; opacity: 0 !important; } }";
  const REF_HTML = '<div class="components"><div class="main-button"><div class="moon"></div><div class="moon"></div><div class="moon"></div></div><div class="daytime-background"></div><div class="daytime-background"></div><div class="daytime-background"></div><div class="cloud"><div class="cloud-son"></div><div class="cloud-son"></div><div class="cloud-son"></div><div class="cloud-son"></div><div class="cloud-son"></div><div class="cloud-son"></div></div><div class="cloud-light"><div class="cloud-son"></div><div class="cloud-son"></div><div class="cloud-son"></div><div class="cloud-son"></div><div class="cloud-son"></div><div class="cloud-son"></div></div><div class="stars"><div class="star big"><div class="star-son"></div><div class="star-son"></div><div class="star-son"></div><div class="star-son"></div></div><div class="star medium"><div class="star-son"></div><div class="star-son"></div><div class="star-son"></div><div class="star-son"></div></div><div class="star small"><div class="star-son"></div><div class="star-son"></div><div class="star-son"></div><div class="star-son"></div></div></div></div>';
  const EXTRA_HTML = '<div class="dn-plane" aria-hidden="true"><svg viewBox="0 0 30 18"><path d="M30 9 L1 0.5 L11 9 Z" fill="#fff"/><path d="M30 9 L11 9 L1 17.5 Z" fill="rgba(0,0,0,0.16)"/></svg></div><div class="dn-bear" aria-hidden="true"><svg viewBox="-20 -20 40 40"><rect x="-9" y="2" width="18" height="14" rx="5" fill="#b9c4d4"/><ellipse cx="0" cy="9" rx="7.5" ry="8" fill="#e6ecf5"/><circle cx="0" cy="-1.5" r="8" fill="#a8845c"/><circle cx="0" cy="-1" r="13.5" fill="rgba(255,255,255,0.16)" stroke="#fff" stroke-width="1.6"/></svg></div>';

  window.DayNightSwitch = {
    mount(target, opts) {
      if (!target) return null;
      target.innerHTML = '';
      const host = document.createElement('div');
      host.className = 'dn-host';
      host.style.cssText = 'position:relative;width:90px;height:35px;cursor:pointer;user-select:none;display:inline-block;';
      const shadow = host.attachShadow({ mode: 'closed' });
      const container = document.createElement('div');
      container.className = 'container';
      container.style.cssText = 'font-size:1px;transform:scale(0.5);transform-origin:center;position:absolute;top:50%;left:50%;margin-top:-35em;margin-left:-90em;width:180em;height:70em;';
      container.innerHTML = REF_HTML;
      const comp = container.querySelector('.components');
      if (comp) comp.insertAdjacentHTML('beforeend', EXTRA_HTML);
      const style = document.createElement('style');
      style.textContent = REF_CSS + EXTRA_CSS;
      shadow.appendChild(style);
      shadow.appendChild(container);
      target.appendChild(host);

      function apply(dark) {
        container.classList.remove('is-day', 'is-night');
        container.classList.add(dark ? 'is-night' : 'is-day');
        const knob = shadow.querySelector('.main-button');
        const bgs = Array.from(shadow.querySelectorAll('.daytime-background'));
        const cloud = shadow.querySelector('.cloud');
        const cloudLight = shadow.querySelector('.cloud-light');
        const track = shadow.querySelector('.components');
        const moons = Array.from(shadow.querySelectorAll('.moon'));
        const stars = shadow.querySelector('.stars');
        if (dark) {
          if (knob) { knob.style.transform = 'translateX(110em)'; knob.style.backgroundColor = 'rgba(195, 200, 210, 1)'; }
          if (bgs[0]) bgs[0].style.transform = 'translateX(110em)';
          if (bgs[1]) bgs[1].style.transform = 'translateX(80em)';
          if (bgs[2]) bgs[2].style.transform = 'translateX(50em)';
          if (cloud) cloud.style.transform = 'translateY(80em)';
          if (cloudLight) cloudLight.style.transform = 'translateY(80em)';
          if (track) track.style.backgroundColor = 'rgba(25, 30, 50, 1)';
          moons.forEach(m => { m.style.opacity = '1'; });
          if (stars) { stars.style.transform = 'translateY(-62.5em)'; stars.style.opacity = '1'; }
        } else {
          if (knob) { knob.style.transform = 'translateX(0)'; knob.style.backgroundColor = 'rgba(255, 195, 35, 1)'; }
          bgs.forEach(b => { b.style.transform = 'translateX(0)'; });
          if (cloud) cloud.style.transform = 'translateY(10em)';
          if (cloudLight) cloudLight.style.transform = 'translateY(10em)';
          if (track) track.style.backgroundColor = 'rgba(70, 133, 192, 1)';
          moons.forEach(m => { m.style.opacity = '0'; });
          if (stars) { stars.style.transform = 'translateY(-125em)'; stars.style.opacity = '0'; }
        }
      }

      host.addEventListener('click', () => {
        const nextDark = !opts.isDark();
        document.documentElement.classList.add('dn-color-shift');
        setTimeout(() => document.documentElement.classList.remove('dn-color-shift'), 500);
        apply(nextDark);
        opts.onToggle(nextDark);
      });

      apply(opts.isDark());
      return { apply };
    }
  };
})();
`;

async function handleLandingPage(request, env, ctx) {
	const isLoggedIn = await verifyAdminCookie(request, env);

	let actionCardHtml = '';
	if (isLoggedIn) {
		actionCardHtml = `
			<div class="section-card" style="text-align: center;">
				<div class="section-title" style="justify-content: center; margin-bottom: 10px;">欢迎回来</div>
				<p style="font-size: 14px; color: var(--text-muted); margin-bottom: 20px;">您当前已登录管理员身份。</p>
				<a href="/admin" class="btn btn-primary" style="width: 100%; text-decoration: none; display: flex; align-items: center; justify-content: center;">进入后台管理面板</a>
				<button class="btn btn-secondary" onclick="submitLogout()" style="width: 100%; margin-top: 12px;">安全退出</button>
			</div>
		`;
	} else {
		actionCardHtml = `
			<div class="section-card" id="login-form-card">
				<div class="section-title">后台管理员登录</div>
				<div class="form-group" style="margin-top: 15px;">
					<label for="login-password">管理员密码</label>
					<input type="password" id="login-password" autocomplete="current-password" placeholder="请输入管理员密码" onkeydown="if(event.key==='Enter')submitLogin()">
				</div>
				<button class="btn btn-primary" onclick="submitLogin()" style="width: 100%; margin-top: 10px;">登录</button>
			</div>
		`;
	}

	const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
	<meta charset="UTF-8">
	<meta name="robots" content="noindex, nofollow">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>${PROJECT_DISPLAY_NAME}</title>
	<link rel="icon" href="${PROJECT_ICON_DATA_URI}">
	<script>${gatewayChartRuntime.toString()}; gatewayChartRuntime();
${DAY_NIGHT_SWITCH_SCRIPT}</script>
	<style>
		:root {
			color-scheme: dark;
			--bg-color: #0d1117;
			--sidebar-bg: #010409;
			--card-bg: #161b22;
			--section-item-bg: #0d1117;
			--table-header-bg: #161b22;
			--code-bg: #161b22;
			--border-color: #30363d;
			--border-muted: #21262d;
			--text-main: #f0f6fc;
			--text-muted: #8b949e;
			--primary-gradient: #1f6feb;
			--primary-bg: #1f6feb;
			--primary-hover: #388bfd;
			--accent-color: #2f81f7;
			--accent-contrast: #ffffff;
			--accent-soft: rgba(56, 139, 253, 0.15);
			--primary-text: #ffffff;
			--success-color: #3fb950;
			--warning-color: #d29922;
			--danger-color: #f85149;
			--input-bg: #0d1117;
			--input-border: #30363d;
			--input-text: #f0f6fc;
			--btn-secondary-bg: #21262d;
			--btn-secondary-hover: #30363d;
			--btn-secondary-text: #f0f6fc;
			--modal-overlay-bg: rgba(1, 4, 9, 0.75);
			--card-shadow: 0 0 transparent;
			--surface-fill: var(--card-bg);
			--brand-top: #1f6feb;
			--brand-bottom: #0969da;
			--code-color: #f0f6fc;
			--code-border: #30363d;
		}
		:root[data-theme="light"] {
			color-scheme: light;
			--bg-color: #f6f8fa;
			--sidebar-bg: #f6f8fa;
			--card-bg: #ffffff;
			--section-item-bg: #f6f8fa;
			--table-header-bg: #f6f8fa;
			--code-bg: #f6f8fa;
			--border-color: #d0d7de;
			--border-muted: #d8dee4;
			--text-main: #1f2328;
			--text-muted: #57606a;
			--primary-gradient: #0969da;
			--primary-bg: #0969da;
			--primary-hover: #0860ca;
			--accent-color: #0969da;
			--accent-contrast: #ffffff;
			--accent-soft: #ddf4ff;
			--primary-text: #ffffff;
			--success-color: #1a7f37;
			--warning-color: #9a6700;
			--danger-color: #cf222e;
			--input-bg: #ffffff;
			--input-border: #d0d7de;
			--input-text: #1f2328;
			--btn-secondary-bg: #f6f8fa;
			--btn-secondary-hover: #f3f4f6;
			--btn-secondary-text: #1f2328;
			--modal-overlay-bg: rgba(27, 31, 36, 0.5);
			--card-shadow: 0 1px 0 rgba(31, 35, 40, 0.04);
			--surface-fill: var(--card-bg);
			--brand-top: #0969da;
			--brand-bottom: #0860ca;
			--code-color: #1f2328;
			--code-border: #d0d7de;
		}
		* { box-sizing: border-box; margin: 0; padding: 0; }
		body {
			font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
			background: var(--bg-color); color: var(--text-main);
			min-height: 100vh; min-height: 100dvh;
			display: flex; flex-direction: column; align-items: center;
			padding: 0 32px; overflow-x: hidden;
			-webkit-font-smoothing: antialiased;
		}
		h1, h2, h3, button, input { font-family: inherit; }
		button, a, input { -webkit-tap-highlight-color: transparent; }
		button:focus-visible, a:focus-visible { outline: 2px solid var(--accent-color); outline-offset: 2px; }
		.hidden { display: none !important; }
		.site-header {
			width: 100%; max-width: 1120px; min-height: 68px;
			display: flex; align-items: center; justify-content: space-between; gap: 20px;
			border-bottom: 1px solid var(--border-color);
		}
		.brand { display: flex; align-items: center; gap: 12px; }
		.logo-icon {
			width: 32px; height: 32px; border-radius: 6px;
			background: var(--primary-bg); border: 1px solid rgba(240,246,252,.15);
			display: flex; align-items: center; justify-content: center;
			font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 14px; font-weight: 600; color: #ffffff;
		}
		.logo-text { font-size: 16px; font-weight: 600; letter-spacing: -.2px; }
		.brand-tag { color: var(--text-muted); font-size: 12px; font-weight: 500; margin-top: 2px; }
		.action-btn-group { display: flex; align-items: center; gap: 8px; }
		.floating-btn {
			background: var(--btn-secondary-bg); border: 1px solid var(--border-color); color: var(--btn-secondary-text);
			width: 32px; height: 32px; border-radius: 6px;
			display: inline-flex; align-items: center; justify-content: center; cursor: pointer;
			box-shadow: var(--card-shadow);
			transition: background .1s, color .1s, border-color .1s;
		}
		.floating-btn:hover { color: var(--text-main); background: var(--btn-secondary-hover); border-color: var(--input-border); }
		.floating-btn.primary-action { background: var(--primary-bg); color: var(--primary-text); border-color: rgba(240,246,252,.15); width: auto; height: 32px; padding: 0 12px; gap: 6px; }
		.action-label { font-size: 13px; font-weight: 500; }
		.project-title { margin: 0; line-height: 1; }
		.project-title .project-brand-wordmark { font-size: 20px; }
		.project-title .project-brand-icon { width: 36px; height: 36px; }
		.dashboard-container { max-width: 1120px; width: 100%; display: flex; flex-direction: column; gap: 20px; flex: 1; padding: 28px 0 48px; }
		.hero {
			display: flex; flex-direction: column; align-items: flex-start; gap: 16px;
			padding: 20px 24px; background: var(--card-bg); border: 1px solid var(--border-color);
			border-radius: 6px; box-shadow: var(--card-shadow);
		}
		.eyebrow { display: flex; align-items: center; gap: 8px; color: var(--accent-color); font: 600 12px/1.4 ui-monospace, SFMono-Regular, Consolas, monospace; margin-bottom: 12px; }
		.eyebrow::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
		.hero-description { color: var(--text-muted); font-size: 14px; line-height: 1.6; margin: 0; }
		.endpoint-list { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px; width: 100%; padding-top: 4px; }
		.endpoint-list > div { background: var(--section-item-bg); border: 1px solid var(--border-color); border-radius: 6px; padding: 10px 14px; }
		.endpoint-label { font-size: 11px; font-weight: 600; letter-spacing: .04em; color: var(--text-muted); margin-bottom: 6px; }
		.endpoint-list code { display: inline-block; font: 500 12px/1.5 ui-monospace, SFMono-Regular, Consolas, monospace; background: var(--accent-soft); border: 1px solid rgba(56,139,253,.35); border-radius: 6px; padding: 3px 8px; color: var(--accent-color); }
		.dashboard-grid { display: grid; grid-template-columns: .9fr 1.3fr; gap: 16px; width: 100%; }
		.dashboard-grid.single-col { grid-template-columns: 1fr; }
		.stat-card, .section-card { background: var(--surface-fill); border: 1px solid var(--border-color); border-radius: 6px; padding: 20px 24px; box-shadow: var(--card-shadow); min-width: 0; }
		.stat-card { display: flex; flex-direction: column; gap: 16px; overflow: hidden; }
		.stat-title { font-size: 12px; line-height: 1.5; color: var(--text-muted); font-weight: 600; }
		.stat-value { font-size: 28px; line-height: 1.3; font-weight: 600; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-variant-numeric: tabular-nums; letter-spacing: -0.5px; color: var(--text-main); }
		.stat-unit { color: var(--text-muted); font: 12px ui-monospace, SFMono-Regular, Consolas, monospace; margin-left: 6px; }
		.progress-container { width: 100%; height: 8px; background: var(--btn-secondary-bg); border-radius: 9999px; overflow: hidden; border: 1px solid var(--border-muted); }
		.progress-bar { height: 100%; background: var(--accent-color); border-radius: 9999px; width: 0; transition: width .35s ease; }
		.public-chart-wrapper { position: relative; height: 190px; width: 100%; display: flex; align-items: center; justify-content: center; gap: 28px; overflow: hidden; }
		.public-chart-wrapper canvas { max-width: 100% !important; }
		#public-chart-legend { scrollbar-width: thin; scrollbar-color: var(--border-color) transparent; }
		.section-card { display: flex; flex-direction: column; gap: 16px; }
		.section-title { font-size: 16px; font-weight: 600; display: flex; align-items: center; gap: 8px; }
		.form-group { display: flex; flex-direction: column; gap: 6px; }
		.form-group label { font-size: 12px; font-weight: 600; color: var(--text-main); }
		input { width: 100%; height: 32px; background: var(--input-bg); border: 1px solid var(--input-border); color: var(--input-text); padding: 5px 12px; border-radius: 6px; outline: none; font-size: 14px; transition: border-color .1s, box-shadow .1s; }
		input::placeholder { color: var(--text-muted); opacity: .75; }
		input:focus { border-color: var(--accent-color); box-shadow: 0 0 0 3px var(--accent-soft); }
		.btn { display: inline-flex; align-items: center; justify-content: center; min-height: 32px; padding: 5px 12px; border-radius: 6px; font-weight: 500; font-size: 14px; line-height: 20px; cursor: pointer; border: 1px solid transparent; text-decoration: none; transition: background .1s, border-color .1s; }
		.btn-primary { background: var(--primary-bg); color: var(--primary-text); border-color: rgba(240,246,252,.15); box-shadow: var(--card-shadow); }
		.btn-primary:hover, .floating-btn.primary-action:hover { background: var(--primary-hover); opacity: 1; }
		.btn-secondary { background: var(--btn-secondary-bg); color: var(--btn-secondary-text); border-color: var(--border-color); box-shadow: var(--card-shadow); }
		.btn-secondary:hover { background: var(--btn-secondary-hover); }
		.modal-overlay { position: fixed; inset: 0; background: var(--modal-overlay-bg); display: flex; align-items: center; justify-content: center; z-index: 1000; opacity: 0; visibility: hidden; pointer-events: none; padding: 20px; transition: opacity .15s ease; }
		.modal-overlay.active { opacity: 1; visibility: visible; pointer-events: auto; }
		.modal-card { background: var(--surface-fill); border: 1px solid var(--border-color); border-radius: 8px; width: 100%; max-width: 420px; padding: 24px; box-shadow: 0 16px 32px rgba(1,4,9,.45); display: flex; flex-direction: column; gap: 16px; max-height: calc(100dvh - 40px); overflow-y: auto; }
		.modal-header { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding-bottom: 14px; border-bottom: 1px solid var(--border-color); }
		.modal-header h3 { font-size: 16px; font-weight: 600; }
		.modal-description { font-size: 12px; line-height: 1.6; color: var(--text-muted); }
		.close-btn { width: 28px; height: 28px; border-radius: 6px; background: transparent; border: none; color: var(--text-muted); cursor: pointer; display: flex; align-items: center; justify-content: center; }
		.close-btn:hover { color: var(--text-main); background: var(--btn-secondary-bg); }
		.toast-container { position: fixed; top: 24px; right: 24px; display: flex; flex-direction: column; gap: 10px; z-index: 9999; pointer-events: none; max-width: calc(100vw - 32px); }
		.toast { background: var(--card-bg); border: 1px solid var(--border-color); color: var(--text-main); min-width: 260px; padding: 12px 16px; border-radius: 6px; box-shadow: 0 8px 24px rgba(1,4,9,.28); font-size: 13px; line-height: 1.5; font-weight: 500; display: flex; align-items: center; gap: 10px; opacity: 0; transition: opacity .15s; pointer-events: auto; }
		.toast.show { opacity: 1; }
		.toast-icon { width: 18px; height: 18px; flex-shrink: 0; }
		.toast-success { border-left: 3px solid var(--success-color); }
		.toast-error { border-left: 3px solid var(--danger-color); }
		.toast-warning { border-left: 3px solid var(--warning-color); }
		.page-footer { width: 100%; max-width: 1120px; display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 20px 0; border-top: 1px solid var(--border-color); font-size: 12px; line-height: 1.6; color: var(--text-muted); }
		.page-footer a { color: var(--accent-color); text-decoration: none; }
		.page-footer a:hover { text-decoration: underline; }
		@keyframes spin { to { transform: rotate(360deg); } }
		.spinner { display: inline-block; width: 16px; height: 16px; border: 2px solid var(--border-color); border-radius: 50%; border-top-color: var(--accent-color); animation: spin .8s linear infinite; }
		@media (max-width: 768px) {
			body { padding: 0 20px; }
			.site-header { min-height: 64px; }
			.dashboard-container { padding: 20px 0 32px; gap: 16px; }
			.hero { padding: 16px; gap: 14px; }
			.endpoint-list { grid-template-columns: 1fr; gap: 10px; }
			.dashboard-grid { grid-template-columns: 1fr; gap: 16px; }
			.stat-card, .section-card { padding: 18px; }
			.public-chart-wrapper { gap: 24px !important; }
			.public-chart-wrapper > div:first-child { width: 150px !important; height: 150px !important; }
			.page-footer { flex-wrap: wrap; gap: 5px; padding: 16px 0; }
		}
		@media (max-width: 480px) {
			body { padding: 0 16px; }
			.logo-text { font-size: 14px; }
			.brand-tag { font-size: 12px; }
			.brand { gap: 9px; }
			.action-btn-group { gap: 7px; }
			.action-label { display: none; }
			.floating-btn.primary-action { width: 32px; padding: 0; }
			.project-title .project-brand-wordmark { font-size: 18px; }
			.project-title .project-brand-icon { width: 32px; height: 32px; }
			.hero-description { font-size: 13px; }
			.public-chart-wrapper { flex-direction: column !important; height: auto !important; gap: 20px !important; padding-top: 4px; }
			.public-chart-wrapper > div:nth-child(2) { width: 100% !important; height: auto !important; }
			#public-chart-legend { max-height: 180px !important; width: 100%; }
			.modal-card { padding: 20px; }
			.toast-container { top: 16px; right: 16px; left: 16px; }
			.toast { min-width: 0; width: 100%; }
		}
		@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: .01ms !important; transition-duration: .01ms !important; } }
	</style>
</head>
<body>

	<header class="site-header">
		<h1 class="project-title" aria-label="${PROJECT_DISPLAY_NAME}">${projectBrandMarkup()}</h1>
	<div class="action-btn-group">
		<div id="landing-theme-toggle" class="day-night-control" style="display:inline-flex;align-items:center;"></div>
		<button class="floating-btn primary-action" onclick="openLoginModal()" aria-haspopup="dialog" aria-controls="login-modal" title="${isLoggedIn ? '管理后台' : '管理员登录'}">
			${isLoggedIn ? `
				<!-- User Check Icon -->
				<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 20px; height: 20px;">
					<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
					<circle cx="9" cy="7" r="4" />
					<polyline points="16 11 18 13 22 9" />
				</svg>
			` : `
				<!-- User Icon -->
				<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 20px; height: 20px;">
					<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
					<circle cx="12" cy="7" r="4" />
				</svg>
			`}
			<span class="action-label">控制台</span>
		</button>
	</div>
	</header>

	<main class="dashboard-container">
		<section class="hero">
			<p class="hero-description">集中管理账号、调用密钥和模型映射，随时查看服务用量。</p>
			<div class="endpoint-list">
				<div><div class="endpoint-label">OPENAI COMPATIBLE</div><code>/v1/chat/completions</code></div>
				<div><div class="endpoint-label">ANTHROPIC COMPATIBLE</div><code>/v1/messages</code></div>
				<div><div class="endpoint-label">GEMINI COMPATIBLE</div><code>/v1beta/models/{model}:generateContent</code></div>
			</div>
		</section>

		<div class="dashboard-grid">
			<!-- Public stats widget -->
			<div class="stat-card" style="justify-content: space-between;">
				<div>
					<div class="stat-title" style="margin-bottom: 10px;">今日用量汇总</div>
					<div style="display: flex; align-items: baseline; gap: 4px;">
						<div class="stat-value" id="public-neurons">0</div>
						<span class="stat-unit">Neurons</span>
					</div>
				</div>

				<div style="margin-top: 16px;">
					<div class="progress-container">
						<div class="progress-bar" id="public-progress" style="width: 0%;"></div>
					</div>
					<div style="display: flex; justify-content: space-between; font-size: 12px; color: var(--text-muted); margin-top: 8px;">
						<span id="public-limit-desc">总限额: 0 Neurons</span>
						<span id="public-percent-desc" style="font-weight: 600; color: var(--accent-color);">0.00%</span>
					</div>
				</div>
			</div>
			<!-- Public model chart widget -->
			<div class="stat-card" id="public-models-card">
				<div class="stat-title">模型用量分布</div>
				<!-- Chart and custom legend container -->
				<div class="public-chart-wrapper" id="public-chart-wrapper" style="display: none; height: 190px; width: 100%; flex-direction: row; align-items: center; justify-content: space-between; gap: 40px;">
					<!-- Left column: Chart (takes full height of wrapper, i.e., 190px) -->
					<div style="position: relative; height: 190px; width: 190px; flex-shrink: 0; display: flex; align-items: center; justify-content: center;">
						<canvas id="publicModelsChart"></canvas>
					</div>
					<!-- Right column: Legend list -->
					<div style="flex: 1; display: flex; flex-direction: column; justify-content: center; min-width: 0; align-self: stretch; height: 190px;">
						<div id="public-chart-legend" style="flex: 1; display: flex; flex-direction: column; gap: 6px; min-width: 0; max-height: 180px; overflow-y: auto; padding-right: 4px;"></div>
					</div>
				</div>

				<!-- Loading / Empty Placeholder -->
				<div id="public-chart-placeholder" style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 190px; width: 100%; color: var(--text-muted); font-size: 12px; gap: 12px;">
					<span class="spinner" style="width: 24px; height: 24px; border-width: 2.5px;"></span>
					<span>正在载入数据...</span>
				</div>
			</div>
		</div>
	</main>

	<!-- 弹窗：管理员登录 / 后台快捷入口 -->
	<div class="modal-overlay" id="login-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
		<div class="modal-card">
			<div class="modal-header">
				<h3 id="modal-title">${isLoggedIn ? '管理面板入口' : '管理员登录'}</h3>
				<button onclick="closeLoginModal()" class="close-btn" aria-label="关闭登录窗口">
					<svg style="width: 20px; height: 20px;" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
					</svg>
				</button>
			</div>

			${isLoggedIn ? `
				<div style="text-align: center; display: flex; flex-direction: column; gap: 16px; margin-top: 10px;">
					<div class="eyebrow" style="justify-content:center; margin:0;">ADMINISTRATOR</div>
					<p style="font-size: 14px; color: var(--text-muted); line-height: 1.5;">您当前已登录管理员身份。</p>
					<a href="/admin" class="btn btn-primary" style="width: 100%; text-decoration: none; display: flex; align-items: center; justify-content: center; height: 42px;">进入后台管理面板</a>
					<button class="btn btn-secondary" onclick="submitLogout()" style="width: 100%; height: 42px;">安全退出</button>
				</div>
			` : `
				<div class="form-group" style="margin-top: 10px;">
					<label for="login-password">管理员密码</label>
					<input type="password" id="login-password" placeholder="请输入管理员密码" onkeydown="if(event.key==='Enter')submitLogin()">
				</div>
				<div class="modal-footer" style="margin-top: 10px; display: flex; gap: 12px; justify-content: flex-end; width: 100%;">
					<button class="btn btn-secondary" onclick="closeLoginModal()" style="height: 38px;">取消</button>
					<button class="btn btn-primary" onclick="submitLogin()" style="height: 38px;">登录</button>
				</div>
			`}
		</div>
	</div>

	<script>
		// Toast Helper
		function showToast(message, type = 'success') {
			let container = document.querySelector('.toast-container');
			if (!container) {
				container = document.createElement('div');
				container.className = 'toast-container';
				document.body.appendChild(container);
			}

			const toast = document.createElement('div');
			toast.className = \`toast toast-\${type}\`;

			let iconSvg = '';
			if (type === 'success') {
				iconSvg = \`<svg class="toast-icon" style="color: #fafafa;" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>\`;
			} else if (type === 'error') {
				iconSvg = \`<svg class="toast-icon" style="color: #fafafa;" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>\`;
			} else {
				iconSvg = \`<svg class="toast-icon" style="color: #fafafa;" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>\`;
			}

			toast.innerHTML = iconSvg;
			const messageNode = document.createElement('span'); messageNode.textContent = String(message); toast.appendChild(messageNode);
			container.appendChild(toast);

			toast.offsetHeight; // trigger reflow
			toast.classList.add('show');

			setTimeout(() => {
				toast.classList.remove('show');
				setTimeout(() => toast.remove(), 400);
			}, 3000);
		}

		let dnSwitchLanding = null;
		function initTheme() {
			const systemPrefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
			const defaultTheme = systemPrefersDark ? 'dark' : 'light';
			document.documentElement.setAttribute('data-theme', defaultTheme);
			window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
				const next = e.matches ? 'dark' : 'light';
				document.documentElement.setAttribute('data-theme', next);
				dnSwitchLanding?.apply(next === 'dark');
				if (lastPublicSummaryData) renderPublicSummary(lastPublicSummaryData);
			});
			const container = document.getElementById('landing-theme-toggle');
			if (container && window.DayNightSwitch && !dnSwitchLanding) {
				dnSwitchLanding = window.DayNightSwitch.mount(container, {
					isDark: () => document.documentElement.getAttribute('data-theme') === 'dark',
					onToggle: (nextDark) => {
						const nextTheme = nextDark ? 'dark' : 'light';
						document.documentElement.setAttribute('data-theme', nextTheme);
						localStorage.setItem('theme', nextTheme);
						if (lastPublicSummaryData) renderPublicSummary(lastPublicSummaryData);
					}
				});
			}
			updateThemeIcons();
		}

		let publicModelsChartInstance = null;
		let lastPublicSummaryData = null;

		function toggleTheme() {
			const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
			const newTheme = currentTheme === 'light' ? 'dark' : 'light';
			document.documentElement.setAttribute('data-theme', newTheme);
			localStorage.setItem('theme', newTheme);
			updateThemeIcons();
			if (lastPublicSummaryData) {
				renderPublicSummary(lastPublicSummaryData);
			}
		}

		function updateThemeIcons() {
			const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
			const sunIcons = document.querySelectorAll('.theme-icon-sun');
			const moonIcons = document.querySelectorAll('.theme-icon-moon');
			if (currentTheme === 'light') {
				sunIcons.forEach(el => el.style.display = 'none');
				moonIcons.forEach(el => el.style.display = 'block');
			} else {
				sunIcons.forEach(el => el.style.display = 'block');
				moonIcons.forEach(el => el.style.display = 'none');
			}
		}

		let loginModalTrigger = null;
		function openLoginModal() {
			loginModalTrigger = document.activeElement;
			document.getElementById('login-modal').classList.add('active');
			document.body.style.overflow = 'hidden';
			const pwdInput = document.getElementById('login-password');
			if (pwdInput) {
				pwdInput.value = '';
				pwdInput.focus();
			} else document.querySelector('#login-modal .close-btn').focus();
		}

		function closeLoginModal() {
			document.getElementById('login-modal').classList.remove('active');
			document.body.style.overflow = '';
			if (loginModalTrigger) loginModalTrigger.focus();
		}
		document.addEventListener('keydown', event => {
			const modal = document.getElementById('login-modal');
			if (!modal.classList.contains('active')) return;
			if (event.key === 'Escape') { event.preventDefault(); closeLoginModal(); }
			if (event.key !== 'Tab') return;
			const controls = modal.querySelectorAll('button, input, a[href]');
			const first = controls[0], last = controls[controls.length - 1];
			if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
			else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
		});

		initTheme();

		window.onload = function() {
			loadPublicSummary();
		};

		async function loadPublicSummary() {
			try {
				const res = await fetch('/api/usage/summary');
				const data = await res.json();

				renderPublicSummary(data);

				// 公开首页只读取缓存；刷新上游用量由已登录的管理面板触发。
			} catch (e) {
				console.error(e);
			}
		}

		function animateNumber(id, end, duration = 1200) {
			const obj = document.getElementById(id);
			if (!obj) return;
			let start = parseInt(obj.innerText.replace(/,/g, ''), 10);
			if (isNaN(start) || start <= 0) {
				start = end > 100 ? 100 : 0;
			}
			const range = end - start;
			if (range === 0) {
				obj.innerText = end.toLocaleString();
				return;
			}
			const startTime = performance.now();
			function update(currentTime) {
				const elapsed = currentTime - startTime;
				const progress = Math.min(elapsed / duration, 1);
				const easeProgress = 1 - Math.pow(2, -10 * progress);
				const current = Math.ceil(start + range * easeProgress);
				obj.innerText = current.toLocaleString();
				if (progress < 1) {
					requestAnimationFrame(update);
				} else {
					obj.innerText = end.toLocaleString();
				}
			}
			requestAnimationFrame(update);
		}

		function renderPublicSummary(data) {
			lastPublicSummaryData = data;
			const percent = Number(data.usagePercentage).toFixed(2);
			const roundedNeurons = Math.ceil(data.totalNeuronsToday);

			// 触发数字滚动的动效
			animateNumber('public-neurons', roundedNeurons, 1000);

			document.getElementById('public-progress').style.width = percent + '%';
			document.getElementById('public-limit-desc').innerText = '总限额: ' + Number(data.totalLimit).toLocaleString() + ' Neurons';
			document.getElementById('public-percent-desc').innerText = percent + '%';

			const wrapper = document.getElementById('public-chart-wrapper');
			const placeholder = document.getElementById('public-chart-placeholder');
			const legendContainer = document.getElementById('public-chart-legend');

			if (data.modelsToday && data.modelsToday.length > 0) {
				if (wrapper) wrapper.style.display = 'flex';
				if (placeholder) placeholder.style.display = 'none';

				// 按 Neurons 消耗数从大到小排序
				const sortedModelsToday = [...data.modelsToday].sort((a, b) => b.neurons - a.neurons);

				const labels = sortedModelsToday.map(m => m.model.split('/').pop());
				const chartData = sortedModelsToday.map(m => m.neurons);

				const isLight = document.documentElement.getAttribute('data-theme') === 'light';
				const textColor = isLight ? '#57606a' : '#8b949e';
				const borderColor = isLight ? '#ffffff' : '#161b22';

				const ctx = document.getElementById('publicModelsChart').getContext('2d');
				if (publicModelsChartInstance) {
					publicModelsChartInstance.destroy();
				}

				// 清空旧的 HTML Legend 标签
				if (legendContainer) legendContainer.innerHTML = '';

				publicModelsChartInstance = new Chart(ctx, {
					type: 'doughnut',
					data: {
						labels: labels,
						datasets: [{
							data: chartData,
							backgroundColor: (isLight ? ['#0969da', '#1a7f37', '#8250df', '#9a6700', '#218bff', '#54aeff'] : ['#2f81f7', '#3fb950', '#a371f7', '#d29922', '#388bfd', '#58a6ff']),
							borderWidth: 2,
							borderColor: borderColor
						}]
					},
					options: {
						responsive: true,
						maintainAspectRatio: false,
						cutout: '70%',
						animation: {
							animateRotate: true,
							animateScale: true,
							duration: 1000,
							easing: 'easeOutQuart'
						},
						plugins: {
							legend: {
								display: false // 关闭原生图例，使用 HTML 图例
							}
						}
					}
				});

				// 动态且逐个淡入渲染模型说明 ID
				if (legendContainer) {
					const colors = (isLight ? ['#0969da', '#1a7f37', '#8250df', '#9a6700', '#218bff', '#54aeff'] : ['#2f81f7', '#3fb950', '#a371f7', '#d29922', '#388bfd', '#58a6ff']);
					const total = chartData.reduce((a, b) => a + b, 0);

					labels.forEach((label, index) => {
						const val = chartData[index];
						const color = colors[index % colors.length];
						const pct = total > 0 ? ((val / total) * 100).toFixed(1) : '0.0';

						const item = document.createElement('div');
						item.style.display = 'flex';
						item.style.alignItems = 'center';
						item.style.gap = '8px';
						item.style.fontSize = '12px';
						item.style.color = textColor;
						item.style.opacity = '1';
						item.style.transform = 'none';
						item.style.transition = 'color .15s';

						item.innerHTML = '<span style="width: 8px; height: 8px; border-radius: 50%; background-color: ' + color + '; flex-shrink: 0; margin-right: 2px;"></span>' +
							'<span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; font-weight: 500;"></span>' +
							'<span style="color: var(--text-muted); font-family: monospace; font-size: 12px; flex-shrink: 0; margin-left: 4px;">' + pct + '%</span>';
						item.children[1].textContent = label; item.children[1].title = label;

						legendContainer.appendChild(item);


					});
				}
			} else {
				if (wrapper) wrapper.style.display = 'none';
				if (placeholder) {
					placeholder.style.display = 'flex';
					placeholder.innerHTML = '<svg style="width: 32px; height: 32px; opacity: 0.5;" fill="none" stroke="currentColor" viewBox="0 0 24 24">' +
						'<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z"></path>' +
						'<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z"></path>' +
						'</svg><span>今日暂无消耗数据</span>';
				}
				if (publicModelsChartInstance) {
					publicModelsChartInstance.destroy();
					publicModelsChartInstance = null;
				}
			}
		}

		async function submitLogin() {
			const password = document.getElementById('login-password').value;
			const res = await fetch('/api/auth/login', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ password })
			});
			if (res.ok) {
				showToast('登录成功！跳转中...');
				setTimeout(() => {
					window.location.href = '/admin';
				}, 600);
			} else {
				const data = await res.json();
				showToast('登录失败: ' + (data.error || '密码不正确！'), 'error');
			}
		}

		async function submitLogout() {
			const res = await fetch('/api/auth/logout', { method: 'POST' });
			if (res.ok) {
				clearPrivateUiCache();
				showToast('安全退出成功');
				setTimeout(() => {
					window.location.reload();
				}, 600);
			}
		}
	</script>
	<footer class="page-footer">
		<span>${PROJECT_DISPLAY_NAME} · OpenAI / Anthropic / Gemini</span>
		<a href="https://github.com/cmliussss2024/WorkersAI2API" target="_blank" rel="noopener">基于 WorkersAI2API ↗</a>
	</footer>
</body>
</html>`;

	return secureHtmlResponse(html);
}

// 2. 后台管理控制台页面
function handleAdminPage(request, env, ctx) {
	const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
	<meta charset="UTF-8">
	<meta name="robots" content="noindex, nofollow">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>控制台 · ${PROJECT_DISPLAY_NAME}</title>
	<link rel="icon" href="${PROJECT_ICON_DATA_URI}">
	<script>${gatewayChartRuntime.toString()}; gatewayChartRuntime();
${DAY_NIGHT_SWITCH_SCRIPT}</script>
	<style>
		:root {
			color-scheme: dark;
			--bg-color: #0d1117;
			--sidebar-bg: #010409;
			--card-bg: #161b22;
			--border-color: #30363d;
			--border-muted: #21262d;
			--text-main: #f0f6fc;
			--text-muted: #8b949e;
			--accent-color: #2f81f7;
			--primary-bg: #1f6feb;
			--primary-hover: #388bfd;
			--primary-text: #ffffff;
			--accent-contrast: #ffffff;
			--accent-soft: rgba(56, 139, 253, 0.15);
			--primary-gradient: #1f6feb;
			--success-color: #3fb950;
			--warning-color: #d29922;
			--danger-color: #f85149;
			--sidebar-width: 248px;
			--sidebar-menu-hover: rgba(177, 186, 196, 0.12);
			--input-bg: #0d1117;
			--input-border: #30363d;
			--input-text: #f0f6fc;
			--table-header-bg: #161b22;
			--btn-secondary-bg: #21262d;
			--btn-secondary-hover: #30363d;
			--btn-secondary-text: #f0f6fc;
			--modal-overlay-bg: rgba(1, 4, 9, 0.75);
			--section-item-bg: #0d1117;
			--card-shadow: 0 0 transparent;
			--code-bg: #0d1117;
			--code-color: #f0f6fc;
			--code-border: #30363d;
		}
		:root[data-theme="light"] {
			color-scheme: light;
			--bg-color: #ffffff;
			--sidebar-bg: #f6f8fa;
			--card-bg: #ffffff;
			--border-color: #d0d7de;
			--border-muted: #d8dee4;
			--text-main: #1f2328;
			--text-muted: #57606a;
			--accent-color: #0969da;
			--primary-bg: #0969da;
			--primary-hover: #0860ca;
			--primary-text: #ffffff;
			--accent-contrast: #ffffff;
			--accent-soft: #ddf4ff;
			--success-color: #1a7f37;
			--warning-color: #9a6700;
			--danger-color: #cf222e;
			--sidebar-menu-hover: rgba(208, 215, 222, 0.32);
			--input-bg: #ffffff;
			--input-border: #d0d7de;
			--input-text: #1f2328;
			--table-header-bg: #f6f8fa;
			--btn-secondary-bg: #f6f8fa;
			--btn-secondary-hover: #f3f4f6;
			--btn-secondary-text: #1f2328;
			--modal-overlay-bg: rgba(27, 31, 36, 0.5);
			--section-item-bg: #f6f8fa;
			--card-shadow: 0 1px 0 rgba(31, 35, 40, 0.04);
			--code-bg: #f6f8fa;
			--code-color: #1f2328;
			--code-border: #d0d7de;
		}
		* { box-sizing: border-box; margin: 0; padding: 0; }
		body {
			font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
			background: var(--bg-color);
			color: var(--text-main);
			font-size: 14px;
			line-height: 1.5;
			min-height: 100vh;
		}
		button, input { font: inherit; }
		button { touch-action: manipulation; }
		button:focus-visible, input:focus-visible, [tabindex]:focus-visible {
			outline: 2px solid var(--accent-color);
			outline-offset: 2px;
		}
		::selection { background: var(--accent-soft); color: var(--text-main); }
		.hidden { display: none !important; }
		.tab-content { display: none; min-width: 0; }
		.tab-content.active { display: block; }
		.app-container { display: flex; min-height: 100vh; }
		aside {
			width: var(--sidebar-width);
			background: var(--sidebar-bg);
			border-right: 1px solid var(--border-color);
			display: flex;
			flex-direction: column;
			padding: 20px 12px 16px;
			position: fixed;
			inset: 0 auto 0 0;
			z-index: 100;
			overflow-y: auto;
			transition: transform 180ms ease;
		}
		.logo-area { display: flex; align-items: center; gap: 10px; margin-bottom: 24px; padding: 0 8px 16px; border-bottom: 1px solid var(--border-color); }
		.logo-icon {
			width: 32px; height: 32px; border-radius: 6px; flex-shrink: 0;
			background: var(--primary-bg); color: var(--primary-text);
			display: flex; align-items: center; justify-content: center;
			font-size: 12px; font-weight: 600;
		}
		.logo-text { font-size: 16px; font-weight: 600; color: var(--text-main); }
		.workspace-caption { font-size: 12px; font-weight: 600; color: var(--text-muted); padding: 0 10px; margin-bottom: 6px; }
		.nav-menu { display: flex; flex-direction: column; gap: 2px; flex: 1; padding-bottom: 24px; }
		.nav-item {
			text-align: left; background: transparent; width: 100%;
			display: flex; align-items: center; gap: 10px; padding: 8px 10px;
			border: 1px solid transparent; border-radius: 6px; cursor: pointer;
			font-size: 14px; font-weight: 400; color: var(--text-main);
			transition: color 80ms linear, background-color 80ms linear;
		}
		.nav-item:hover { background: var(--sidebar-menu-hover); }
		.nav-item.active { font-weight: 600; background: var(--sidebar-menu-hover); box-shadow: inset 3px 0 0 var(--accent-color); }
		.nav-item svg { flex-shrink: 0; color: var(--text-muted); }
		.nav-item.active svg { color: var(--accent-color); }
		.aside-footer { display: flex; flex-direction: column; gap: 8px; border-top: 1px solid var(--border-color); padding-top: 16px; }
		.sidebar-backdrop { display: none; }
		main { flex: 1; min-width: 0; margin-left: var(--sidebar-width); padding: 28px 32px; }
		#auth-views { max-width: 1440px; margin: 0 auto; }
		header { display: flex; justify-content: space-between; align-items: center; gap: 16px; padding-bottom: 16px; border-bottom: 1px solid var(--border-color); }
		#view-title { font-size: 20px; font-weight: 600; line-height: 1.3; }
		.header-eyebrow { color: var(--text-muted); font-size: 12px; letter-spacing: 0.04em; margin-bottom: 4px; font-weight: 600; }
		.card-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; }
		.stat-card { box-shadow: var(--card-shadow); min-width: 0; background: var(--card-bg); border: 1px solid var(--border-color); border-radius: 6px; padding: 18px 20px; display: flex; flex-direction: column; gap: 12px; }
		.stat-title { font-size: 12px; color: var(--text-muted); font-weight: 600; }
		.stat-value { font-size: 28px; line-height: 1.2; font-weight: 600; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-variant-numeric: tabular-nums; letter-spacing: -0.5px; }
		.stat-desc { font-size: 12px; color: var(--text-muted); line-height: 1.5; }
		.progress-container { width: 100%; height: 8px; background: var(--btn-secondary-bg); border-radius: 9999px; overflow: hidden; border: 1px solid var(--border-muted); }
		.progress-bar { height: 100%; width: 0%; background: var(--accent-color); border-radius: 9999px; transition: width 300ms ease; }
		.section-card { box-shadow: var(--card-shadow); min-width: 0; background: var(--card-bg); border: 1px solid var(--border-color); border-radius: 6px; padding: 20px 24px; margin-bottom: 20px; }
		.section-note { margin-top: 4px; color: var(--text-muted); font-size: 12px; line-height: 1.6; }
		.section-header { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; margin-bottom: 16px; padding-bottom: 12px; border-bottom: 1px solid var(--border-muted); }
		.section-title { font-size: 16px; font-weight: 600; display: flex; align-items: center; gap: 8px; }
		.access-endpoint-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
		.access-endpoint-card { min-width: 0; text-align: left; padding: 16px; border: 1px solid var(--border-color); border-radius: 6px; background: var(--section-item-bg); color: inherit; }
		.endpoint-badge { display: inline-flex; color: var(--accent-color); background: var(--accent-soft); border: 1px solid rgba(56,139,253,.35); padding: 2px 8px; border-radius: 9999px; font-size: 12px; font-weight: 500; }
		.endpoint-url { display: block; margin-top: 10px; font: 12px/1.6 ui-monospace, SFMono-Regular, Consolas, monospace; word-break: break-all; color: var(--text-main); background: none; border: 0; text-align: left; text-decoration: none; cursor: pointer; }
		.endpoint-url:hover { color: var(--accent-color); text-decoration: underline; text-underline-offset: 4px; }
		.endpoint-hint { margin-top: 8px; font-size: 12px; color: var(--text-muted); }
		.form-group { min-width: 0; display: flex; flex-direction: column; gap: 6px; margin-bottom: 14px; }
		.form-group label { font-size: 12px; font-weight: 600; color: var(--text-main); }
		input, select, textarea { min-width: 0; width: 100%; min-height: 32px; background: var(--input-bg); border: 1px solid var(--input-border); color: var(--input-text); padding: 5px 12px; border-radius: 6px; outline: none; font: inherit; font-size: 14px; transition: border-color 100ms ease, box-shadow 100ms ease; }
		input::placeholder { color: var(--text-muted); opacity: 0.7; }
		input:focus, select:focus, textarea:focus { border-color: var(--accent-color); box-shadow: 0 0 0 3px var(--accent-soft); }
		.btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 32px; padding: 5px 12px; border: 1px solid transparent; border-radius: 6px; font-size: 14px; font-weight: 500; line-height: 20px; cursor: pointer; white-space: nowrap; transition: background-color 80ms linear, border-color 80ms linear; }
		.btn-primary { background: var(--primary-bg); color: var(--primary-text); border-color: rgba(240,246,252,0.15); box-shadow: var(--card-shadow); }
		.btn-primary:hover { background: var(--primary-hover); }
		.btn-secondary { box-shadow: var(--card-shadow); background: var(--btn-secondary-bg); color: var(--btn-secondary-text); border-color: var(--border-color); }
		.btn-secondary:hover { background: var(--btn-secondary-hover); border-color: var(--input-border); }
		.btn-success { background: rgba(46,160,67,0.15); color: var(--success-color); border-color: rgba(46,160,67,0.4); }
		.btn-success:hover { background: rgba(46,160,67,0.25); }
		.btn:disabled { opacity: 0.5; cursor: not-allowed; filter: none; }
		@keyframes spinner-border { to { transform: rotate(360deg); } }
		.spinner { display: inline-block; width: 12px; height: 12px; border: 2px solid currentColor; border-right-color: transparent; border-radius: 50%; animation: spinner-border 0.75s linear infinite; }
		.card-update-flash { border-color: var(--accent-color) !important; }
		.table-scroll { width: 100%; max-width: 100%; overflow: auto; border: 1px solid var(--border-color); border-radius: 6px; scrollbar-width: thin; scrollbar-color: var(--input-border) transparent; }
		table { width: 100%; border-collapse: collapse; text-align: left; font-size: 13px; }
		th { background: var(--table-header-bg); color: var(--text-muted); padding: 10px 14px; border-bottom: 1px solid var(--border-color); font-size: 12px; font-weight: 600; white-space: nowrap; position: sticky; top: 0; z-index: 1; }
		td { padding: 10px 14px; border-bottom: 1px solid var(--border-muted); color: var(--text-main); white-space: nowrap; }
		tr:last-child td { border-bottom: 0; }
		tr:hover td { background: var(--section-item-bg); }
		code { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; background: var(--code-bg); color: var(--code-color); padding: 2px 6px; border: 1px solid var(--code-border); border-radius: 6px; font-size: 12px; }
		.badge { display: inline-flex; align-items: center; gap: 5px; padding: 2px 8px; border-radius: 9999px; font-size: 12px; font-weight: 500; border: 1px solid transparent; white-space: nowrap; }
		.badge-success { color: var(--success-color); background: rgba(46,160,67,0.15); border-color: rgba(46,160,67,0.4); }
		.badge-warning { color: var(--warning-color); background: rgba(187,128,9,0.15); border-color: rgba(187,128,9,0.4); }
		.badge-danger { color: var(--danger-color); background: rgba(248,81,73,0.15); border-color: rgba(248,81,73,0.4); }
		.badge-info { color: var(--accent-color); background: var(--accent-soft); border-color: rgba(56,139,253,0.4); }
		.charts-grid { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr); gap: 16px; }
		.chart-container { position: relative; height: 280px; width: 100%; margin-top: 16px; }
		.public-chart-wrapper { display: flex; align-items: center; justify-content: center; min-width: 0; gap: 22px; }
		.public-chart-wrapper canvas { max-width: 100% !important; }
		#admin-chart-legend { scrollbar-width: thin; scrollbar-color: var(--input-border) transparent; }
		.modal-overlay { position: fixed; inset: 0; padding: 16px; background: var(--modal-overlay-bg); display: flex; align-items: center; justify-content: center; z-index: 1000; opacity: 0; visibility: hidden; pointer-events: none; transition: opacity 150ms ease; }
		.modal-overlay.active { opacity: 1; visibility: visible; pointer-events: auto; }
		.modal-card { width: 100%; max-width: 500px; max-height: calc(100dvh - 32px); overflow-y: auto; background: var(--card-bg); border: 1px solid var(--border-color); border-radius: 8px; padding: 24px; box-shadow: 0 16px 32px rgba(1,4,9,0.45); display: flex; flex-direction: column; gap: 16px; }
		.modal-header { display: flex; justify-content: space-between; align-items: center; gap: 12px; border-bottom: 1px solid var(--border-color); padding-bottom: 14px; }
		.modal-header h3 { font-size: 16px; font-weight: 600; }
		.modal-header button { min-width: 28px; min-height: 28px; display: grid; place-items: center; }
		.modal-footer { display: flex; justify-content: flex-end; gap: 8px; flex-wrap: wrap; border-top: 1px solid var(--border-color); padding-top: 16px; margin-top: 4px; }
		.toast-container { position: fixed; top: 22px; right: 22px; display: flex; flex-direction: column; gap: 10px; z-index: 9999; pointer-events: none; }
		.toast { max-width: min(420px, calc(100vw - 32px)); padding: 12px 16px; background: var(--card-bg); border: 1px solid var(--border-color); border-radius: 6px; box-shadow: 0 8px 24px rgba(1,4,9,0.28); font-size: 13px; display: flex; align-items: center; gap: 10px; opacity: 0; transform: translateY(-6px); transition: opacity 150ms ease, transform 150ms ease; pointer-events: auto; }
		.toast.show { opacity: 1; transform: translateY(0); }
		.toast-icon { width: 18px; height: 18px; flex-shrink: 0; }
		.toast-success { border-left: 3px solid var(--success-color); }
		.toast-error { border-left: 3px solid var(--danger-color); }
		.toast-warning { border-left: 3px solid var(--warning-color); }
		.toast-success .toast-icon { color: var(--success-color) !important; }
		.toast-error .toast-icon { color: var(--danger-color) !important; }
		.toast-warning .toast-icon { color: var(--warning-color) !important; }
		.mapping-form { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.5fr); gap: 14px; padding: 16px; background: var(--section-item-bg); border: 1px solid var(--border-color); border-radius: 6px; margin-top: 16px; }
		.mapping-form-actions { grid-column: 1 / -1; display: flex; gap: 10px; }
		.mapping-toolbar { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; margin: 20px 0 12px; }
		.mapping-toolbar input { max-width: 340px; }
		.mapping-count { font-size: 12px; color: var(--text-muted); font-variant-numeric: tabular-nums; }
		.mapping-table-scroll { max-height: 580px; }
		.mapping-empty { padding: 24px; text-align: center; font-size: 12px; color: var(--text-muted); }
		.mobile-header { display: none !important; }
		@media (max-width: 1280px) {
			.card-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
			.charts-grid { grid-template-columns: 1fr; }
		}
		@media (max-width: 768px) {
			.mobile-header { display: flex !important; position: sticky; top: 0; }
			.mobile-header .logo-area { padding: 0; }
			.mobile-header .logo-text { font-size: 14px; }
			.mobile-nav-toggle { background: none; border: 0; color: var(--text-main); display: flex; align-items: center; gap: 6px; cursor: pointer; font-size: 12px; min-height: 36px; }
			aside { transform: translateX(-100%); }
			aside.active { transform: translateX(0); }
			aside.active + .sidebar-backdrop { display: block; position: fixed; inset: 0; border: 0; background: var(--modal-overlay-bg); z-index: 99; }
			main { margin-left: 0; padding: 25px 16px; }
			header { align-items: flex-start; padding-bottom: 20px; }
			#view-title { font-size: 24px; }
			header .user-profile { padding-top: 22px; }
			#auth-views { gap: 24px !important; }
			.stat-card { padding: 16px; gap: 12px; }
			.stat-value { font-size: 24px; }
			.section-card { padding: 18px; }
			.section-header > div:last-child { flex-wrap: wrap; }
			.access-endpoint-grid { grid-template-columns: 1fr; }
			#accounts-usage-list { grid-template-columns: minmax(0, 1fr) !important; }
			.mapping-form { grid-template-columns: minmax(0, 1fr); }
			.mapping-toolbar input { max-width: none; }
			.mapping-table-scroll { max-height: 65vh; }
			.modal-card { padding: 20px; }
			.toast-container { top: 16px; right: 16px; }
			#admin-chart-wrapper { height: auto !important; min-height: 240px; flex-direction: column !important; gap: 18px !important; }
			#admin-canvas-wrapper { width: 180px !important; height: 180px !important; }
			#admin-legend-wrapper { width: 100%; }
			#admin-chart-legend { display: grid !important; grid-template-columns: repeat(2, minmax(0, 1fr)); max-height: 180px !important; gap: 8px !important; }
		}
		@media (max-width: 420px) {
			.card-grid { gap: 10px; }
			.stat-title { font-size: 12px; }
			.stat-card svg { width: 18px !important; height: 18px !important; }
			header .user-profile { display: none; }
			.modal-footer .btn { flex: 1; }
		}
		@media (prefers-reduced-motion: reduce) {
			*, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; scroll-behavior: auto !important; }
		}
	</style>
</head>
<body>
	<!-- App Header for Mobile Toggle -->
	<div style="display: flex; justify-content: space-between; align-items: center; padding: 15px 20px; background-color: var(--sidebar-bg); border-bottom: 1px solid var(--border-color); z-index: 90;" class="mobile-header">
		<div class="logo-area" style="margin-bottom: 0;">
			${projectBrandMarkup()}
		</div>
		<div style="display: flex; align-items: center; gap: 12px;">
			<button class="mobile-nav-toggle" onclick="toggleSidebar()">
				<svg style="width: 20px; height: 20px;" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"></path></svg>
				<span>菜单</span>
			</button>
		</div>
	</div>

	<div class="app-container">
		<!-- Sidebar -->
		<aside id="sidebar">
			<div class="logo-area">
				${projectBrandMarkup()}
			</div>

			<div class="workspace-caption">WORKSPACE</div>
			<div class="nav-menu">
				<button type="button" class="nav-item active" id="menu-overview" onclick="switchTab('overview')">
					<svg style="width: 18px; height: 18px;" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path></svg>
					数据看板
				</button>
				<button type="button" class="nav-item" id="menu-accounts" onclick="switchTab('accounts')">
					<svg style="width: 18px; height: 18px;" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"></path></svg>
					账号管理
				</button>
				<button type="button" class="nav-item" id="menu-keys" onclick="switchTab('keys')">
					<svg style="width: 18px; height: 18px;" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"></path></svg>
					API 密钥
				</button>
				<button type="button" class="nav-item" id="menu-settings" onclick="switchTab('settings')">
					<svg style="width: 18px; height: 18px;" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
					模型映射
				</button>
			</div>

			<div class="aside-footer">
				<div id="admin-theme-toggle" class="day-night-control" style="display:flex;justify-content:center;margin-bottom:8px;"></div>
				<button class="btn btn-secondary" onclick="logout()">退出登录</button>
				<div style="text-align: center; font-size: 12px; color: var(--text-muted); opacity: 0.55; padding-top: 4px;">
					基于 <a href="https://github.com/cmliussss2024/WorkersAI2API" target="_blank" rel="noopener" style="color: inherit; text-decoration: underline; text-underline-offset: 2px;">WorkersAI2API</a>
				</div>
			</div>
		</aside>
		<button class="sidebar-backdrop" aria-label="关闭导航" onclick="toggleSidebar()"></button>

		<!-- Main Workspace -->
		<main>
			<div id="auth-views" style="display: flex; flex-direction: column; gap: 30px; width: 100%;">

				<!-- Header -->
				<header>
					<div>
						<div class="header-eyebrow">${PROJECT_DISPLAY_NAME} / CONSOLE</div>
						<h1 id="view-title">数据看板</h1>
						<p style="color: var(--text-muted); font-size: 14px; margin-top: 4px;">统一管理模型路由、访问密钥与账号用量。</p>
					</div>
					<div class="user-profile">
						<span class="badge badge-success">管理控制台</span>
					</div>
				</header>

				<!-- TAB: Overview -->
				<div id="tab-overview" class="tab-content active">
					<div class="card-grid">
						<div class="stat-card">
							<div style="display: flex; justify-content: space-between; align-items: flex-start;">
								<div class="stat-title">今日总消耗量</div>
								<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" style="width: 22px; height: 22px; color: var(--accent-color); opacity: 0.85;">
									<path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
								</svg>
							</div>
							<div class="stat-value" id="stat-total-neurons">0</div>
							<div class="progress-container">
								<div class="progress-bar" id="stat-neurons-progress" style="width: 0%;"></div>
							</div>
							<div class="stat-desc" id="stat-neurons-desc">0 / 0 Neurons (0.00%)</div>
						</div>
						<div class="stat-card">
							<div style="display: flex; justify-content: space-between; align-items: flex-start;">
								<div class="stat-title">已绑定账号</div>
								<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" style="width: 22px; height: 22px; color: var(--accent-color); opacity: 0.85;">
									<path stroke-linecap="round" stroke-linejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
								</svg>
							</div>
							<div class="stat-value" id="stat-accounts-count">0</div>
							<div class="stat-desc">已加入请求分配的 Cloudflare 账号</div>
						</div>
						<div class="stat-card">
							<div style="display: flex; justify-content: space-between; align-items: flex-start;">
								<div class="stat-title">代理 API 密钥</div>
								<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" style="width: 22px; height: 22px; color: var(--accent-color); opacity: 0.85;">
									<path stroke-linecap="round" stroke-linejoin="round" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
								</svg>
							</div>
							<div class="stat-value" id="stat-keys-count">0</div>
							<div class="stat-desc">当前可用于客户端接入的密钥</div>
						</div>
						<div class="stat-card">
							<div style="display: flex; justify-content: space-between; align-items: flex-start;">
								<div class="stat-title">今日剩余额度</div>
								<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" style="width: 22px; height: 22px; color: var(--accent-color); opacity: 0.85;">
									<path stroke-linecap="round" stroke-linejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
								</svg>
							</div>
							<div class="stat-value" id="stat-cost-saving">0</div>
							<div class="stat-desc">Cloudflare 免费 Neurons 估算；实际用量与费用以上游为准</div>
						</div>
					</div>

					<!-- Charts -->
					<div class="charts-grid" style="margin-top: 24px;">
						<div class="section-card">
							<div class="section-title">过去 7 日消耗走势 (Neurons)</div>
							<div class="chart-container">
								<canvas id="historyChart"></canvas>
							</div>
						</div>
						<div class="section-card">
							<div class="section-title">今日模型消耗占比</div>
							<div class="chart-container public-chart-wrapper" id="admin-chart-wrapper" style="display: flex; flex-direction: row; align-items: center; justify-content: space-between; gap: 30px; height: 300px; padding: 10px 0;">
								<!-- Left: Chart -->
								<div id="admin-canvas-wrapper" style="position: relative; height: 220px; width: 220px; flex-shrink: 0; display: flex; align-items: center; justify-content: center;">
									<canvas id="modelsChart"></canvas>
								</div>
								<!-- Right: Legend -->
								<div id="admin-legend-wrapper" style="flex: 1; display: flex; flex-direction: column; justify-content: center; min-width: 0; align-self: stretch; height: 100%;">
									<div id="admin-chart-legend" style="flex: 1; display: flex; flex-direction: column; gap: 6px; min-width: 0; max-height: 260px; overflow-y: auto; padding-right: 4px;"></div>
								</div>
								<!-- Empty Placeholder -->
								<div id="admin-chart-placeholder" style="display: none; flex-direction: column; align-items: center; justify-content: center; height: 100%; width: 100%; color: var(--text-muted); font-size: 12px; gap: 12px; margin: auto;">
									<svg style="width: 32px; height: 32px; opacity: 0.5;" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z"></path>
										<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z"></path>
									</svg>
									<span>今日暂无消耗数据</span>
								</div>
							</div>
						</div>
					</div>

					<!-- Detailed Accounts Usage Grid -->
					<div class="section-card" style="margin-top: 24px;">
						<div class="section-header">
							<div class="section-title">账号用量明细</div>
							<div style="display: flex; align-items: center; gap: 12px;">
								<span id="txt-last-updated" style="font-size: 12px; color: var(--text-muted); font-family: monospace;"></span>
								<button class="btn btn-secondary" id="btn-refresh-usage" onclick="loadUsageDetails(true)">刷新用量</button>
							</div>
						</div>
						<div id="accounts-usage-list" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 16px;">
							<!-- Individual account progress item -->
						</div>
					</div>
				</div>

				<!-- TAB: Accounts -->
				<div id="tab-accounts" class="tab-content">
					<div class="section-card">
						<div class="section-header">
							<div class="section-title">账号配置</div>
							<button class="btn btn-primary" onclick="openAddAccountModal()">
								<svg style="width: 16px; height: 16px;" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path></svg>
								添加账号
							</button>
						</div>

						<div class="table-scroll"><table>
							<thead>
								<tr>
									<th>别名</th>
									<th>提供商 / 上游地址</th>
									<th>API Token</th>
									<th>操作</th>
								</tr>
							</thead>
							<tbody id="accounts-table-body">
								<!-- Accounts rows -->
							</tbody>
						</table></div>
					</div>
				</div>

				<!-- TAB: API Keys -->
				<div id="tab-keys" class="tab-content">
					<!-- Proxy URL Info -->
					<div class="section-card" style="margin-bottom: 24px;">
						<div class="section-title">接入信息</div>
						<div class="section-note">支持 OpenAI、Anthropic 和 Gemini 客户端。Gemini 请求请将 {model} 替换为模型别名，使用 x-goog-api-key 传入实例密钥。</div>
						<div class="access-endpoint-grid" style="margin-top: 18px;">
							<div class="access-endpoint-card">
								<div class="endpoint-badge">OpenAI 兼容格式</div>
								<button type="button" class="endpoint-url" id="openai-endpoint-url" data-endpoint-url="" onclick="copyEndpointUrl(this.dataset.endpointUrl)">https://domain/v1/chat/completions</button>
							</div>
							<div class="access-endpoint-card">
								<div class="endpoint-badge">Anthropic 兼容格式</div>
								<button type="button" class="endpoint-url" id="anthropic-endpoint-url" data-endpoint-url="" onclick="copyEndpointUrl(this.dataset.endpointUrl)">https://domain/v1/messages</button>
							</div>
							<div class="access-endpoint-card">
								<div class="endpoint-badge">Gemini 兼容格式</div>
								<button type="button" class="endpoint-url" id="gemini-endpoint-url" data-endpoint-url="" onclick="copyEndpointUrl(this.dataset.endpointUrl)">https://domain/v1beta/models/{model}:generateContent</button>
							</div>
						</div>
					</div>

					<div class="section-card">
						<div class="section-header">
							<div class="section-title">API 密钥管理</div>
							<button class="btn btn-primary" onclick="openAddKeyModal()">
								<svg style="width: 16px; height: 16px;" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path></svg>
								生成新密钥
							</button>
						</div>

						<div style="background-color: rgba(245, 158, 11, 0.1); border: 1px solid rgba(245, 158, 11, 0.2); padding: 16px; border-radius: 8px; font-size: 12px; color: var(--warning-color); line-height: 1.5; margin-bottom: 10px;" id="no-key-warning" class="hidden">
							<strong>提示：</strong> 目前未配置任何 API 密钥，所有模型接口已停止接受调用。请点击“生成新密钥”后，将密钥填入客户端。
						</div>

						<div class="table-scroll"><table>
							<thead>
								<tr>
									<th>密钥描述</th>
									<th>API Key</th>
									<th>创建时间</th>
									<th>操作</th>
								</tr>
							</thead>
							<tbody id="keys-table-body">
								<!-- Keys rows -->
							</tbody>
						</table></div>
					</div>
				</div>

				<!-- TAB: Settings (Model Mapping) -->
				<div id="tab-settings" class="tab-content">
					<div class="section-card">
						<div class="section-title">模型映射</div>
						<p style="font-size: 12px; color: var(--text-muted); margin-top: 8px; margin-bottom: 20px; line-height: 1.6;">将客户端模型别名对应到上游模型。Cloudflare 使用 @cf/...；其他接口使用 openai:、anthropic:、gemini: 或 antigravity: 前缀。</p>

						<div class="mapping-form">
							<div class="form-group" style="margin-bottom: 0;">
								<label>客户端模型别名</label>
								<input type="text" id="map-source" placeholder="例如：my-model">
							</div>
							<div class="form-group" style="margin-bottom: 0;">
								<label>上游目标模型</label>
								<input type="text" id="map-target" placeholder="例如：@cf/openai/gpt-oss-20b">
							</div>
							<div class="mapping-form-actions">
								<button class="btn btn-primary" onclick="addMapping()" style="min-height: 38px;">添加/修改</button>
								<button class="btn btn-secondary" onclick="restorePresetMappings()" style="min-height: 38px;">预设映射</button>
							</div>
						</div>

						<div class="mapping-toolbar">
							<input id="mapping-search" type="search" placeholder="搜索模型别名或完整 ID…" aria-label="搜索模型映射" oninput="filterMappings()">
							<span class="mapping-count" id="mapping-count"></span>
						</div>
						<div class="table-scroll mapping-table-scroll"><table>
							<thead>
								<tr>
									<th>客户端请求模型</th>
									<th>上游目标模型</th>
									<th>类型</th>
									<th style="width: 100px;">操作</th>
								</tr>
							</thead>
							<tbody id="mappings-table-body">
								<!-- Mapping rows -->
							</tbody>
						</table></div>
						<p id="mapping-search-empty" class="mapping-empty hidden">没有匹配的模型，试试其他关键词。</p>
					</div>
				</div>

			</div>
		</main>
	</div>

	<!-- Modal: Add Cloudflare Account -->
	<div class="modal-overlay" id="account-modal">
		<div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="account-modal-title">
			<div class="modal-header">
				<h3 id="account-modal-title">添加上游账号</h3>
				<button type="button" aria-label="关闭账号弹窗" onclick="closeAccountModal()" style="background: none; border: none; color: var(--text-muted); cursor: pointer;">
					<svg style="width: 20px; height: 20px;" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
				</button>
			</div>
			<input type="hidden" id="account-id-edit">
			<div class="form-group">
				<label for="account-provider">上游接口类型</label>
				<select id="account-provider" onchange="onProviderChange()">
					<option value="cloudflare">Cloudflare Workers AI</option>
					<option value="openai">OpenAI 兼容接口</option>
					<option value="anthropic">Anthropic Messages 接口</option>
					<option value="gemini">Gemini 原生接口</option>
					<option value="antigravity">Antigravity</option>
				</select>
			</div>
			<div class="form-group">
				<label for="account-name">账号别名 (如: 主账号 A)</label>
				<input type="text" id="account-name" placeholder="请输入备注名">
			</div>
			<div class="form-group" id="account-id-group">
				<label for="account-id" id="account-id-label">Account ID</label>
				<input type="text" id="account-id" placeholder="获取于 CF 控制台 Workers AI 页面" oninput="onAccountInfoChange()">
			</div>
			<div class="form-group hidden" id="account-base-url-group">
				<label for="account-base-url">Base URL</label>
				<input type="url" id="account-base-url" placeholder="https://api.openai.com/v1" oninput="onAccountInfoChange()">
			</div>
			<div class="form-group hidden" id="account-models-group">
				<label for="account-models">上游模型 ID（每行一个或逗号分隔）</label>
				<textarea id="account-models" rows="3" placeholder="例如：gpt-4.1、claude-sonnet-4-5、gemini-2.5-flash" oninput="onAccountInfoChange()"></textarea>
				<small style="color:var(--text-muted);">填写后可直接使用模型 ID；留空时请在模型映射中使用 openai:、anthropic: 或 gemini: 前缀。</small>
			</div>
			<div class="form-group">
				<label for="account-token" id="account-token-label">API Key / Token</label>
				<div id="account-cf-permissions" style="font-size: 12px; color: var(--text-muted); background: rgba(9,9,11,0.15); padding: 8px 12px; border-radius: 4px; margin-top: 4px; margin-bottom: 4px; line-height: 1.5; font-family: monospace;">
					• Workers AI &gt; Read <span id="perm-wa-read" style="margin-left: 8px;"></span><br>
					• Workers AI &gt; Edit <span id="perm-wa-edit" style="margin-left: 8px;"></span><br>
					• Account Analytics &gt; Read <span id="perm-aa-read" style="margin-left: 8px;"></span>
				</div>
				<input type="password" id="account-token" autocomplete="new-password" placeholder="输入 API Key / Token；编辑时留空保留原值" oninput="onAccountInfoChange()">
			</div>
			<div class="form-group hidden" id="account-antigravity-group">
				<small style="color:var(--text-muted);">填写 Antigravity 邮箱与 refresh_token，保存时自动登录并查询项目。编辑时凭据留空保留原值。</small>
				<details style="margin-top:12px;"><summary style="cursor:pointer;">高级设置（可选）</summary>
					<label for="account-project-id" style="margin-top:12px;">Project ID</label>
					<input type="text" id="account-project-id" placeholder="留空自动查询账号项目" oninput="onAccountInfoChange()">
					<label for="account-oauth-client-id" style="margin-top:12px;">OAuth Client ID</label>
					<input type="text" id="account-oauth-client-id" autocomplete="off" placeholder="留空使用 Antigravity 客户端；编辑时保留原值" oninput="onAccountInfoChange()">
					<label for="account-oauth-client-secret" style="margin-top:12px;">OAuth Client Secret</label>
					<input type="password" id="account-oauth-client-secret" autocomplete="new-password" placeholder="使用其他客户端签发的 Token 时填写；编辑时保留原值" oninput="onAccountInfoChange()">
				</details>
			</div>
			<div class="form-group">
				<label for="account-status">账号状态</label>
				<select id="account-status"><option value="active">启用</option><option value="disabled">停用</option></select>
			</div>

			<div id="test-result-alert" style="display: none; padding: 12px 16px; border-radius: 8px; font-size: 12px; font-weight: 500; word-break: break-word; overflow-wrap: break-word; max-height: 200px; overflow-y: auto; line-height: 1.6; border: 1px solid transparent;"></div>
			<p id="account-test-note" style="font-size:12px; color:var(--text-muted); margin-top:12px;">Cloudflare 测试会发起一次小型向量请求，占用少量模型配额；保存账号无需测试。</p>

			<div class="modal-footer">
				<button class="btn btn-success" onclick="testConnection()" id="btn-test-conn">测试连接</button>
				<button class="btn btn-primary" onclick="saveAccount()" id="btn-save-account" disabled>保存账号</button>
			</div>
		</div>
	</div>

	<!-- Modal: Add API Key -->
	<div class="modal-overlay" id="key-modal">
		<div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="key-modal-title">
			<div class="modal-header">
				<h3 id="key-modal-title">生成新 API 密钥</h3>
				<button type="button" aria-label="关闭密钥弹窗" onclick="closeKeyModal()" style="background: none; border: none; color: var(--text-muted); cursor: pointer;">
					<svg style="width: 20px; height: 20px;" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
				</button>
			</div>
			<div id="key-modal-form">
				<div class="form-group" style="margin-bottom: 16px;">
					<label for="key-name">密钥描述/使用客户端 (如: Cursor / NextChat)</label>
					<input type="text" id="key-name" placeholder="请输入描述名" style="width: 100%;">
				</div>
				<div class="form-group" style="margin-bottom: 16px;">
					<label for="key-val">API 密钥值 (可选，为空则随机生成 sk-wa-...)</label>
					<input type="text" id="key-val" placeholder="留空则随机生成密钥" style="width: 100%;">
				</div>
				<div class="modal-footer" style="margin-top: 10px; display: flex; gap: 12px; justify-content: flex-end; width: 100%;">
					<button class="btn btn-secondary" onclick="closeKeyModal()">取消</button>
					<button class="btn btn-primary" onclick="saveKey()">生成密钥</button>
				</div>
			</div>
			<div id="key-modal-success" class="hidden" style="display: flex; flex-direction: column; gap: 16px;">
				<div style="text-align: center; color: var(--success-color); font-size: 32px; margin-bottom: 8px;">✓</div>
				<p style="font-size: 14px; text-align: center; line-height: 1.6; color: var(--text-main);">
					密钥生成成功！请务必复制保存此密钥，关闭后将无法再次完整查看。
				</p>
				<div class="form-group">
					<label>API Key</label>
					<div style="display: flex; gap: 10px;">
						<input type="text" id="generated-key-val" readonly style="flex: 1; font-family: monospace;">
						<button class="btn btn-primary" onclick="copyGeneratedKey()">复制</button>
					</div>
				</div>
				<div class="modal-footer" style="margin-top: 10px; width: 100%;">
					<button class="btn btn-secondary" onclick="closeKeyModal()" style="width: 100%;">我已保存，关闭</button>
				</div>
			</div>
		</div>
	</div>

	<script>
		let activeAdminModal = null;
		const modalTriggers = new WeakMap();

		function openAdminModal(id, initialFocusId) {
			const modal = document.getElementById(id);
			if (!modal.classList.contains('active')) modalTriggers.set(modal, document.activeElement);
			modal.classList.add('active');
			activeAdminModal = modal;
			const card = modal.querySelector('.modal-card');
			card.tabIndex = -1;
			(document.getElementById(initialFocusId) || card).focus({ preventScroll: true });
		}

		function closeAdminModal(id) {
			const modal = document.getElementById(id);
			if (!modal.classList.contains('active')) return;
			modal.classList.remove('active');
			if (activeAdminModal === modal) activeAdminModal = null;
			const trigger = modalTriggers.get(modal);
			modalTriggers.delete(modal);
			if (trigger && trigger.isConnected) trigger.focus({ preventScroll: true });
		}

		document.addEventListener('keydown', event => {
			if (event.key === 'Escape') {
				if (activeAdminModal) {
					event.preventDefault();
					closeAdminModal(activeAdminModal.id);
				}
				document.getElementById('sidebar').classList.remove('active');
				return;
			}
			if (event.key !== 'Tab' || !activeAdminModal) return;
			const focusable = [...activeAdminModal.querySelectorAll('button:not([disabled]), input:not([disabled]):not([type="hidden"]), a[href], select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
				.filter(element => element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden');
			if (!focusable.length) {
				event.preventDefault();
				activeAdminModal.querySelector('.modal-card').focus();
				return;
			}
			const first = focusable[0];
			const last = focusable[focusable.length - 1];
			if (!activeAdminModal.contains(document.activeElement) || (event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last)) {
				event.preventDefault();
				(event.shiftKey ? last : first).focus();
			}
		});
		let currentTab = 'overview';
		let historyChart = null;
		let modelsChart = null;
		const defaultMappings = ${JSON.stringify(DEFAULT_MODEL_MAP)};
		let customMappings = {};

		// Toast Helper
		function showToast(message, type = 'success') {
			let container = document.querySelector('.toast-container');
			if (!container) {
				container = document.createElement('div');
				container.className = 'toast-container';
				document.body.appendChild(container);
			}

			const toast = document.createElement('div');
			toast.className = \`toast toast-\${type}\`;

			let iconSvg = '';
			if (type === 'success') {
				iconSvg = \`<svg class="toast-icon" style="color: #fafafa;" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>\`;
			} else if (type === 'error') {
				iconSvg = \`<svg class="toast-icon" style="color: #fafafa;" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>\`;
			} else {
				iconSvg = \`<svg class="toast-icon" style="color: #fafafa;" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>\`;
			}

			toast.innerHTML = iconSvg;
			const messageNode = document.createElement('span'); messageNode.textContent = String(message); toast.appendChild(messageNode);
			container.appendChild(toast);

			toast.offsetHeight; // trigger reflow
			toast.classList.add('show');

			setTimeout(() => {
				toast.classList.remove('show');
				setTimeout(() => toast.remove(), 400);
			}, 3000);
		}

		function renderUsageDetails(data) {
			let totalUsageToday = 0;
			let totalLimit = data.filter(account => account.usageSupported !== false && (!account.provider || account.provider === 'cloudflare')).length * 10000;
			let historyData = {};
			let modelsToday = {};

			const usageList = document.getElementById('accounts-usage-list');

			// 记录刷新前已有卡片的最后更新时间戳
			const previousTimestamps = new Map();
			usageList.querySelectorAll('.section-card').forEach(card => {
				const id = card.dataset.id;
				const ts = parseInt(card.dataset.lastUpdated || '0', 10);
				if (id) previousTimestamps.set(id, ts);
			});

			usageList.innerHTML = '';

			if (data.length === 0) {
				usageList.innerHTML = '<div style="color: var(--text-muted); font-size:14px; text-align:center; padding: 20px; width: 100%;">没有绑定的账号，请前往“账号管理”添加账号。</div>';
				return;
			}

			data.forEach(account => {
				if (account.usageSupported === false) {
					const item = document.createElement('div');
					item.className = 'section-card';
					item.style.padding = '20px';
					item.innerHTML = '<strong>' + escapeHtml(account.name) + '</strong><div class="stat-desc" style="margin-top:12px;">' + escapeHtml(account.provider || '上游接口') + ' · ' + (account.duplicateOf ? '与另一凭证共享额度，已合并统计' : account.status === 'disabled' ? '已停用' : '供应商用量请在上游控制台查看') + '</div>';
					usageList.appendChild(item);
					return;
				}
				totalUsageToday += account.usageToday;

				// Percentage formatted to 2 decimal places
				const percentage = Math.min(100, Number(((account.usageToday / 10000) * 100).toFixed(2)));
				const warningClass = account.status === 'error' ? 'badge-danger' : (account.status === 'pending' ? 'badge-info' : (percentage >= 90 ? 'badge-warning' : 'badge-success'));
				const statusText = account.status === 'error' ? '连接异常' : (account.status === 'pending' ? '待刷新' : (percentage >= 100 ? '用尽 (10k)' : '正常运行'));

				// Usage rounded up (Math.ceil)
				const roundedUsage = Math.ceil(account.usageToday);

				const item = document.createElement('div');
				const isRefreshed = previousTimestamps.has(account.id) && previousTimestamps.get(account.id) !== account.lastUpdated;
				item.className = 'section-card' + (isRefreshed ? ' card-update-flash' : '');
				item.dataset.id = account.id;
				item.dataset.lastUpdated = account.lastUpdated || 0;
				item.style.padding = '20px';
				item.style.backgroundColor = 'rgba(250,250,250,0.01)';
				item.innerHTML = \`
					<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 12px; gap: 12px;">
						<div style="min-width: 0; flex: 1; display: flex; align-items: center; gap: 8px;">
							<strong style="font-size:14px; font-weight:600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 0 1 auto;" title="\${escapeHtml(account.name)}">\${escapeHtml(account.name)}</strong>
							<span style="font-size:12px; color: var(--text-muted); font-family: monospace; white-space: nowrap; flex-shrink: 0;">(\${escapeHtml(account.accountId.substring(0,6))}...\${escapeHtml(account.accountId.substring(account.accountId.length-4))})</span>
						</div>
						<span class="badge \${warningClass}" style="flex-shrink: 0;">\${statusText}</span>
					</div>
					<div class="progress-container">
						<div class="progress-bar" style="width: \${percentage}%;"></div>
					</div>
					<div style="display:flex; justify-content:space-between; font-size:12px; color: var(--text-muted); margin-top: 6px;">
						<span>今日已用: \${roundedUsage.toLocaleString()} / 10,000 Neurons</span>
						<span>\${percentage.toFixed(2)}%</span>
					</div>
					\${account.error ? \`<div style="color: var(--danger-color); font-size:12px; margin-top: 8px; background: rgba(239,68,68,0.08); padding: 8px 12px; border-radius: 4px; border: 1px solid rgba(239,68,68,0.12);">错误信息: \${escapeHtml(account.error)}</div>\` : ''}
				\`;
				usageList.appendChild(item);

				if (account.history) {
					account.history.forEach(h => {
						historyData[h.date] = (historyData[h.date] || 0) + h.neurons;
					});
				}

				if (account.modelsToday) {
					account.modelsToday.forEach(m => {
						modelsToday[m.model] = (modelsToday[m.model] || 0) + m.neurons;
					});
				}
			});

			// Top stats formatting (Usage rounded up, Percentage 2 decimals)
			const roundedTotalUsageToday = Math.ceil(totalUsageToday);
			document.getElementById('stat-total-neurons').innerText = roundedTotalUsageToday.toLocaleString();
			document.getElementById('stat-accounts-count').innerText = data.length;

			const overallPercentage = totalLimit > 0 ? Math.min(100, Number(((totalUsageToday / totalLimit) * 100).toFixed(2))) : 0;
			document.getElementById('stat-neurons-progress').style.width = overallPercentage + '%';
			document.getElementById('stat-neurons-desc').innerText = \`\${roundedTotalUsageToday.toLocaleString()} / \${totalLimit.toLocaleString()} Neurons (\${overallPercentage.toFixed(2)}%)\`;

			document.getElementById('stat-cost-saving').innerText = Math.max(0, totalLimit - roundedTotalUsageToday).toLocaleString();

			const dates = Object.keys(historyData).sort();
			const neuronsData = dates.map(d => historyData[d]);
			renderHistoryChart(dates, neuronsData);

			const models = Object.keys(modelsToday);
			const modelsNeurons = models.map(m => modelsToday[m]);
			renderModelsChart(models, modelsNeurons);
		}

		let isRefreshingUsage = false;

		async function loadUsageDetails(isManual = false) {
			// 如果已经在刷新中，则直接返回，避免并发请求
			if (isRefreshingUsage) return;

			const now = Date.now();
			const lastFetchedRaw = localStorage.getItem('cache_usage_details_last_fetched');
			let lastFetched = lastFetchedRaw ? parseInt(lastFetchedRaw, 10) : 0;

			// 优先从浏览器 localStorage 读取并渲染上次缓存的数据
			const cachedDataRaw = localStorage.getItem('cache_accounts_usage');
			if (cachedDataRaw) {
				try {
					const cachedData = JSON.parse(cachedDataRaw);
					renderUsageDetails(cachedData);
				} catch (e) {
					console.error('Error parsing cached usage details:', e);
				}
			}
			const cachedKeysCount = localStorage.getItem('cache_keys_count');
			if (cachedKeysCount) {
				document.getElementById('stat-keys-count').innerText = cachedKeysCount;
			}

			// 更新文字显示
			updateLastUpdatedText(lastFetched);

			// 如果不是手动刷新，且最后更新时间在 15 分钟以内，则直接使用缓存，不发起 API 请求
			if (!isManual && lastFetched && (now - lastFetched) < 15 * 60 * 1000) {
				console.log('Skipping auto refresh, last fetch was ' + Math.round((now - lastFetched) / 1000) + 's ago');
				return;
			}

			const btn = document.getElementById('btn-refresh-usage');
			let originalBtnText = '';
			if (btn) {
				originalBtnText = btn.innerHTML;
				btn.disabled = true;
				btn.innerHTML = '<span class="spinner"></span> 刷新中...';
			}

			isRefreshingUsage = true;

			try {
				const res = await apiFetch('/api/accounts/usage');
				const data = await res.json();

				// 渲染最新的实时数据
				renderUsageDetails(data);

				// 保存/更新本地缓存
				localStorage.setItem('cache_accounts_usage', JSON.stringify(data));

				// 记录更新时间戳，并更新文字
				localStorage.setItem('cache_usage_details_last_fetched', now);
				updateLastUpdatedText(now);

				// 刷新并缓存 API 密钥数
				const keysRes = await apiFetch('/api/keys');
				const keys = await keysRes.json();
				document.getElementById('stat-keys-count').innerText = keys.length;
				localStorage.setItem('cache_keys_count', keys.length);

			} catch (e) {
				console.error(e);
			} finally {
				isRefreshingUsage = false;
				if (btn) {
					btn.disabled = false;
					btn.innerHTML = originalBtnText;
				}
			}
		}

		function updateLastUpdatedText(timestamp) {
			const label = document.getElementById('txt-last-updated');
			if (!label) return;
			if (!timestamp) {
				label.innerText = '从未更新';
				return;
			}
			const date = new Date(timestamp);
			const yyyy = date.getFullYear();
			const MM = String(date.getMonth() + 1).padStart(2, '0');
			const dd = String(date.getDate()).padStart(2, '0');
			const hh = String(date.getHours()).padStart(2, '0');
			const mm = String(date.getMinutes()).padStart(2, '0');
			const ss = String(date.getSeconds()).padStart(2, '0');
			label.innerText = '最后更新: ' + yyyy + '-' + MM + '-' + dd + ' ' + hh + ':' + mm + ':' + ss;
		}

		let dnSwitchAdmin = null;
		function initTheme() {
			const systemPrefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
			const defaultTheme = systemPrefersDark ? 'dark' : 'light';
			document.documentElement.setAttribute('data-theme', defaultTheme);
			window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
				const next = e.matches ? 'dark' : 'light';
				document.documentElement.setAttribute('data-theme', next);
				dnSwitchAdmin?.apply(next === 'dark');
				if (currentTab === 'overview') loadUsageDetails();
			});
			const container = document.getElementById('admin-theme-toggle');
			if (container && window.DayNightSwitch && !dnSwitchAdmin) {
				dnSwitchAdmin = window.DayNightSwitch.mount(container, {
					isDark: () => document.documentElement.getAttribute('data-theme') === 'dark',
					onToggle: (nextDark) => {
						const nextTheme = nextDark ? 'dark' : 'light';
						document.documentElement.setAttribute('data-theme', nextTheme);
						localStorage.setItem('theme', nextTheme);
						if (currentTab === 'overview') loadUsageDetails();
					}
				});
			}
			updateThemeIcons();
		}

		function toggleTheme() {
			const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
			const newTheme = currentTheme === 'light' ? 'dark' : 'light';
			document.documentElement.setAttribute('data-theme', newTheme);
			localStorage.setItem('theme', newTheme);
			updateThemeIcons();
			if (currentTab === 'overview') {
				loadUsageDetails();
			}
		}

		function updateThemeIcons() {
			const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
			const sunIcons = document.querySelectorAll('.theme-icon-sun');
			const moonIcons = document.querySelectorAll('.theme-icon-moon');
			if (currentTheme === 'light') {
				sunIcons.forEach(el => el.style.display = 'none');
				moonIcons.forEach(el => el.style.display = 'block');
			} else {
				sunIcons.forEach(el => el.style.display = 'block');
				moonIcons.forEach(el => el.style.display = 'none');
			}
		}

		initTheme();

		window.onload = function() {
			const openaiUrl = window.location.origin + '/v1/chat/completions';
			const anthropicUrl = window.location.origin + '/v1/messages';
			const geminiUrl = window.location.origin + '/v1beta/models/{model}:generateContent';
			const openaiUrlEl = document.getElementById('openai-endpoint-url');
			const anthropicUrlEl = document.getElementById('anthropic-endpoint-url');
			const geminiUrlEl = document.getElementById('gemini-endpoint-url');
			if (openaiUrlEl) {
				openaiUrlEl.dataset.endpointUrl = openaiUrl;
				openaiUrlEl.textContent = openaiUrl;
			}
			if (anthropicUrlEl) {
				anthropicUrlEl.dataset.endpointUrl = anthropicUrl;
				anthropicUrlEl.textContent = anthropicUrl;
			}
			if (geminiUrlEl) {
				geminiUrlEl.dataset.endpointUrl = geminiUrl;
				geminiUrlEl.textContent = geminiUrl;
			}
			loadUsageDetails();
		};

		function toggleSidebar() {
			document.getElementById('sidebar').classList.toggle('active');
		}

		async function logout() {
			const res = await fetch('/api/auth/logout', { method: 'POST' });
			if (res.ok) {
				clearPrivateUiCache();
				showToast('已安全退出登录');
				setTimeout(() => {
					window.location.href = '/';
				}, 800);
			}
		}

		function switchTab(tabName) {
			if (tabName === currentTab) return;
			currentTab = tabName;
			document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
			document.getElementById('menu-' + tabName).classList.add('active');

			document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
			document.getElementById('tab-' + tabName).classList.add('active');

			const titles = {
				overview: '数据看板',
				accounts: '账号管理',
				keys: 'API 密钥',
				settings: '模型映射'
			};
			document.getElementById('view-title').innerText = titles[tabName];
			document.getElementById('sidebar').classList.remove('active');

			if (tabName === 'overview') {
				loadUsageDetails();
			} else if (tabName === 'accounts') {
				loadAccounts();
			} else if (tabName === 'keys') {
				loadKeys();
			} else if (tabName === 'settings') {
				loadSettings();
			}
		}

		async function apiFetch(path, options = {}) {
			const res = await fetch(path, options);
			if (res.status === 401) {
				clearPrivateUiCache();
				window.location.href = '/';
				throw new Error('Unauthorized');
			}
			return res;
		}


		function renderHistoryChart(labels, data) {
			if (historyChart) historyChart.destroy();
			const isLight = document.documentElement.getAttribute('data-theme') === 'light';
			const gridColor = isLight ? '#d8dee4' : '#21262d';
			const textColor = isLight ? '#57606a' : '#8b949e';
			const ctx = document.getElementById('historyChart').getContext('2d');
			const chartAccent = isLight ? '#0969da' : '#2f81f7';
			const chartFill = isLight ? 'rgba(9,105,218,0.08)' : 'rgba(47,129,247,0.12)';
			historyChart = new Chart(ctx, {
				type: 'line',
				data: {
					labels: labels,
					datasets: [{
						label: 'Neuron 消耗数',
						data: data,
						borderColor: chartAccent,
						backgroundColor: chartFill,
						borderWidth: 2,
						tension: 0.25,
						fill: true,
						pointBackgroundColor: chartAccent,
						pointBorderColor: 'rgba(250,250,250,0.8)',
						pointBorderWidth: 1.5,
						pointRadius: 2,
						pointHoverRadius: 6,
						pointHoverBorderWidth: 3
					}]
				},
				options: {
					responsive: true,
					maintainAspectRatio: false,
					plugins: { legend: { display: false } },
					scales: {
						y: { grid: { color: gridColor }, ticks: { color: textColor } },
						x: { grid: { display: false }, ticks: { color: textColor } }
					}
				}
			});
		}

		function renderModelsChart(labels, data) {
			if (modelsChart) modelsChart.destroy();

			const legendContainer = document.getElementById('admin-chart-legend');
			const canvasWrapper = document.getElementById('admin-canvas-wrapper');
			const legendWrapper = document.getElementById('admin-legend-wrapper');
			const placeholder = document.getElementById('admin-chart-placeholder');

			if (legendContainer) legendContainer.innerHTML = '';

			if (labels.length === 0) {
				if (canvasWrapper) canvasWrapper.style.display = 'none';
				if (legendWrapper) legendWrapper.style.display = 'none';
				if (placeholder) placeholder.style.display = 'flex';
				return;
			} else {
				if (canvasWrapper) canvasWrapper.style.display = 'flex';
				if (legendWrapper) legendWrapper.style.display = 'flex';
				if (placeholder) placeholder.style.display = 'none';
			}

			// Sort the model data descending by neurons
			const combined = labels.map((label, idx) => ({
				fullLabel: label,
				cleanLabel: label.split('/').pop(),
				value: data[idx]
			})).sort((a, b) => b.value - a.value);

			const sortedLabels = combined.map(x => x.cleanLabel);
			const sortedData = combined.map(x => x.value);

			const isLight = document.documentElement.getAttribute('data-theme') === 'light';
			const textColor = isLight ? '#57606a' : '#8b949e';
			const borderColor = isLight ? '#ffffff' : '#161b22';
			const ctx = document.getElementById('modelsChart').getContext('2d');

			modelsChart = new Chart(ctx, {
				type: 'doughnut',
				data: {
					labels: sortedLabels,
					datasets: [{
						data: sortedData,
						backgroundColor: ['#2f81f7', '#3fb950', '#a371f7', '#d29922', '#388bfd', '#58a6ff'],
						borderWidth: 2,
						borderColor: borderColor
					}]
				},
				options: {
					responsive: true,
					maintainAspectRatio: false,
					cutout: '70%',
					animation: {
						animateRotate: false,
						animateScale: false,
						duration: 200,
						easing: 'easeOutQuart'
					},
					plugins: {
						legend: {
							display: false // 关闭原生图例，使用 HTML 自定义图例
						}
					}
				}
			});

			// Render Custom HTML Legend for Admin Page
			if (legendContainer) {
				const colors = ['#2f81f7', '#3fb950', '#a371f7', '#d29922', '#388bfd', '#58a6ff'];
				const total = sortedData.reduce((a, b) => a + b, 0);

				combined.forEach((itemData, index) => {
					const label = itemData.cleanLabel;
					const fullLabel = itemData.fullLabel;
					const val = itemData.value;
					const color = colors[index % colors.length];
					const pct = total > 0 ? ((val / total) * 100).toFixed(1) : '0.0';

					const item = document.createElement('div');
					item.style.display = 'flex';
					item.style.alignItems = 'center';
					item.style.gap = '8px';
					item.style.fontSize = '12px';
					item.style.color = textColor;
					item.style.opacity = '0';
					item.style.transform = 'translateX(10px)';
					item.style.transition = 'all 0.4s cubic-bezier(0.16, 1, 0.3, 1)';

					item.innerHTML = '<span style="width: 8px; height: 8px; border-radius: 50%; background-color: ' + color + '; flex-shrink: 0; margin-right: 2px;"></span>' +
						'<span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; font-weight: 500;"></span>' +
						'<span style="color: var(--text-muted); font-family: monospace; font-size: 12px; flex-shrink: 0; margin-left: 4px;">' + pct + '%</span>';
					item.children[1].textContent = label; item.children[1].title = fullLabel;

					legendContainer.appendChild(item);

					// 与环形图同时开始加载，依次淡入滑出
					setTimeout(() => {
						item.style.opacity = '1';
						item.style.transform = 'translateX(0)';
					}, index * 80);
				});
			}
		}

		async function copyEndpointUrl(url) {
			if (!url) return;
			try {
				if (navigator.clipboard && window.isSecureContext) {
					await navigator.clipboard.writeText(url);
				} else {
					const input = document.createElement('input');
					input.value = url;
					input.style.position = 'fixed';
					input.style.opacity = '0';
					input.style.left = '-9999px';
					document.body.appendChild(input);
					input.select();
					document.execCommand('copy');
					document.body.removeChild(input);
				}
				showToast('已复制接入地址！');
			} catch (e) {
				console.error(e);
				showToast('复制失败，请手动复制 URL', 'error');
			}
		}

		async function loadAccounts() {
			try {
				const res = await apiFetch('/api/accounts');
				const accounts = await res.json();
				const tbody = document.getElementById('accounts-table-body');
				tbody.innerHTML = '';
				if (accounts.length === 0) {
					tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color: var(--text-muted); padding: 30px;">暂无配置的上游账号</td></tr>';
					return;
				}
				accounts.forEach(acc => {
					const maskedToken = acc.apiToken.length > 8 ? acc.apiToken.substring(0, 4) + '...' + acc.apiToken.substring(acc.apiToken.length - 4) : '********';
					const tr = document.createElement('tr');
					tr.innerHTML = \`
						<td><strong style="font-weight:600;"></strong></td>
						<td><code></code></td>
						<td><code></code></td>
						<td>
							<div style="display:flex; gap:8px;">
								<button class="btn btn-secondary" style="padding:6px 12px; font-size:12px; border-radius:4px;">编辑</button>
								<button class="btn btn-secondary" style="padding:6px 12px; font-size:12px; border-radius:4px; color: var(--danger-color);">删除</button>
							</div>
						</td>
					\`;
					tr.querySelector('strong').textContent = acc.name;
					const codeCells = tr.querySelectorAll('code');
					codeCells[0].textContent = !acc.provider || acc.provider === 'cloudflare' ? acc.accountId : acc.provider + ' · ' + (acc.baseUrl || acc.accountId || 'Antigravity');
					codeCells[0].title = (acc.status === 'disabled' ? '已停用 · ' : '已启用 · ') + (acc.provider || 'cloudflare') + ((acc.models || []).length ? ' · ' + acc.models.join(', ') : '');
					codeCells[1].textContent = maskedToken;
					const buttons = tr.querySelectorAll('button');
					buttons[0].addEventListener('click', () => editAccount(acc.id, acc.name, acc.accountId, acc.apiToken, acc));
					buttons[1].addEventListener('click', () => deleteAccount(acc.id));
					tbody.appendChild(tr);
				});
			} catch (e) {
				console.error(e);
			}
		}

		let accountCredentialReusable = false;
		let lastAccountProvider = null;
		function openAddAccountModal() {
			accountCredentialReusable = false;
			lastAccountProvider = 'cloudflare';
			document.getElementById('account-modal-title').innerText = '添加上游账号';
			document.getElementById('account-id-edit').value = '';
			document.getElementById('account-provider').value = 'cloudflare';
			document.getElementById('account-base-url').value = '';
			document.getElementById('account-models').value = '';
			document.getElementById('account-project-id').value = '';
			document.getElementById('account-oauth-client-id').value = '';
			document.getElementById('account-oauth-client-secret').value = '';
			document.getElementById('account-status').value = 'active';
			document.getElementById('account-name').value = '';
			document.getElementById('account-id').value = '';
			document.getElementById('account-token').value = '';
			document.getElementById('test-result-alert').style.display = 'none';
			document.getElementById('perm-wa-read').innerHTML = '';
			document.getElementById('perm-wa-edit').innerHTML = '';
			document.getElementById('perm-aa-read').innerHTML = '';
			onProviderChange();
			openAdminModal('account-modal', 'account-name');
		}

		function closeAccountModal() {
			closeAdminModal('account-modal');
		}

		function editAccount(id, name, accountId, apiToken, account = {}) {
			accountCredentialReusable = true;
			lastAccountProvider = account.provider || 'cloudflare';
			document.getElementById('account-modal-title').innerText = '编辑上游账号';
			document.getElementById('account-id-edit').value = id;
			document.getElementById('account-name').value = name;
			document.getElementById('account-id').value = accountId;
			document.getElementById('account-token').value = '';
			document.getElementById('account-provider').value = account.provider || 'cloudflare';
			document.getElementById('account-base-url').value = account.baseUrl || '';
			document.getElementById('account-models').value = (account.models || []).join('\\n');
			document.getElementById('account-project-id').value = account.projectId || '';
			document.getElementById('account-oauth-client-id').value = '';
			document.getElementById('account-oauth-client-secret').value = '';
			document.getElementById('account-status').value = account.status || 'active';
			document.getElementById('test-result-alert').style.display = 'none';
			document.getElementById('perm-wa-read').innerHTML = '';
			document.getElementById('perm-wa-edit').innerHTML = '';
			document.getElementById('perm-aa-read').innerHTML = '';
			document.getElementById('btn-save-account').disabled = true;
			onProviderChange();
			openAdminModal('account-modal', 'account-name');
		}

		function readAccountForm() {
			return {
				id: document.getElementById('account-id-edit').value || undefined,
				name: document.getElementById('account-name').value,
				provider: document.getElementById('account-provider').value,
				accountId: document.getElementById('account-id').value,
				apiToken: document.getElementById('account-token').value,
				baseUrl: document.getElementById('account-base-url').value,
				projectId: document.getElementById('account-project-id').value,
				oauthClientId: document.getElementById('account-oauth-client-id').value,
				oauthClientSecret: document.getElementById('account-oauth-client-secret').value,
				models: document.getElementById('account-models').value.split(/[\\n,]+/).map(value => value.trim()).filter(Boolean),
				status: document.getElementById('account-status').value
			};
		}

		function onProviderChange() {
			const provider = document.getElementById('account-provider').value;
			if (lastAccountProvider && lastAccountProvider !== provider) {
				accountCredentialReusable = false;
				for (const id of ['account-token', 'account-id', 'account-base-url', 'account-models', 'account-project-id', 'account-oauth-client-id', 'account-oauth-client-secret']) document.getElementById(id).value = '';
			}
			lastAccountProvider = provider;
			const defaults = ${JSON.stringify(PROVIDER_DEFAULT_URLS)};
			const generic = Object.prototype.hasOwnProperty.call(defaults, provider);
			document.getElementById('account-id-group').classList.toggle('hidden', provider !== 'cloudflare' && provider !== 'antigravity');
			document.getElementById('account-base-url-group').classList.toggle('hidden', !generic);
			document.getElementById('account-models-group').classList.toggle('hidden', !generic);
			document.getElementById('account-cf-permissions').classList.toggle('hidden', provider !== 'cloudflare');
			document.getElementById('account-antigravity-group').classList.toggle('hidden', provider !== 'antigravity');
			document.getElementById('account-id-label').textContent = provider === 'antigravity' ? '邮箱 (email)' : 'Account ID';
			document.getElementById('account-id').placeholder = provider === 'antigravity' ? '你的 Antigravity 登录邮箱' : '获取于 CF 控制台 Workers AI 页面';
			document.getElementById('account-token-label').textContent = provider === 'antigravity' ? 'Refresh Token (refresh_token)' : 'API Key / Token';
			document.getElementById('account-token').placeholder = accountCredentialReusable ? '同一上游类型编辑时可留空保留原值' : '请填写此上游的凭据；更换类型后必须重新填写';
			document.getElementById('account-test-note').textContent = provider === 'cloudflare' ? 'Cloudflare 测试会发起一次小型向量请求，占用少量模型配额；保存账号无需测试。' : provider === 'antigravity' ? '测试会刷新登录并查询项目，不生成模型内容。' : '测试只查询可用模型，不生成模型内容。';
			if (generic) document.getElementById('account-base-url').placeholder = defaults[provider];
			onAccountInfoChange();
		}

		function accountFormHasCredential(account) {
			const value = account.apiToken.trim();
			return (value && value !== '********' && !value.includes('...')) || (account.id && accountCredentialReusable);
		}

		function onAccountInfoChange() {
			const account = readAccountForm();
			document.getElementById('btn-save-account').disabled = !accountFormHasCredential(account) || (['cloudflare', 'antigravity'].includes(account.provider) && !account.accountId.trim());
			document.getElementById('test-result-alert').style.display = 'none';
			document.getElementById('perm-wa-read').innerHTML = '';
			document.getElementById('perm-wa-edit').innerHTML = '';
			document.getElementById('perm-aa-read').innerHTML = '';
		}

		function updatePermissionStatus(elementId, statusObj) {
			const el = document.getElementById(elementId);
			if (!el) return;
			if (statusObj && statusObj.success) {
				el.innerHTML = '<span style="color: #10b981; font-weight: bold; margin-left: 6px;">✅ 有效</span>';
			} else {
				const err = (statusObj && statusObj.error) ? statusObj.error : '测试失败';
				el.innerHTML = '<span style="color: #ef4444; font-weight: bold; margin-left: 6px;">🔴 无效</span>';
				el.firstElementChild.title = String(err);
			}
		}

		function escapeHtml(str) {
			if (!str) return '';
			return String(str)
				.replace(/&/g, '&amp;')
				.replace(/</g, '&lt;')
				.replace(/>/g, '&gt;')
				.replace(/"/g, '&quot;')
				.replace(/'/g, '&#39;');
		}

		function setAlertStyle(el, type) {
			const styles = {
				warning: { bg: 'rgba(245, 158, 11, 0.12)', color: '#f59e0b', border: 'rgba(245, 158, 11, 0.3)' },
				success: { bg: 'rgba(16, 185, 129, 0.12)', color: '#10b981', border: 'rgba(16, 185, 129, 0.3)' },
				danger:  { bg: 'rgba(239, 68, 68, 0.12)', color: '#ef4444', border: 'rgba(239, 68, 68, 0.3)' }
			};
			const s = styles[type] || styles.danger;
			el.style.backgroundColor = s.bg;
			el.style.color = s.color;
			el.style.borderColor = s.border;
		}

		const ALERT_ICONS = {
			spinner: '<svg style="width:16px;height:16px;animation:spin 1s linear infinite;flex-shrink:0;" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>',
			check:    '<svg style="width:18px;height:18px;flex-shrink:0;" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>',
			warning: '<svg style="width:18px;height:18px;flex-shrink:0;margin-top:1px;" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>'
		};

		let connectionTestInFlight = false;
		async function testConnection() {
			if (connectionTestInFlight) return;
			connectionTestInFlight = true;
			document.getElementById('btn-test-conn').disabled = true;
			const account = readAccountForm();
			const alertEl = document.getElementById('test-result-alert');
			alertEl.style.display = 'block';
			setAlertStyle(alertEl, 'warning');
			alertEl.innerHTML = '<div style="display:flex;align-items:center;gap:8px;">' + ALERT_ICONS.spinner + '<span>测试中...</span></div>';

			document.getElementById('perm-wa-read').innerHTML = '';
			document.getElementById('perm-wa-edit').innerHTML = '';
			document.getElementById('perm-aa-read').innerHTML = '';
			document.getElementById('btn-save-account').disabled = true;

			try {
				const res = await apiFetch('/api/accounts/test', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(account)
				});
				const data = await res.json();
				if (data.permissions) {
					updatePermissionStatus('perm-wa-read', data.permissions.workersAiRead);
					updatePermissionStatus('perm-wa-edit', data.permissions.workersAiEdit);
					updatePermissionStatus('perm-aa-read', data.permissions.accountAnalyticsRead);
				}
				if (data.success) {
					setAlertStyle(alertEl, 'success');
					alertEl.innerHTML = '<div style="display:flex;align-items:center;gap:8px;">' + ALERT_ICONS.check + '<span>' + escapeHtml(data.message || '连接成功！API 权限全部有效') + '</span></div>';
					showToast('连接测试成功！');
					document.getElementById('btn-save-account').disabled = false;
				} else {
					setAlertStyle(alertEl, 'danger');

					// Build structured error details from permissions data
					let errorDetailHtml = '';
					if (data.permissions) {
						const permList = [
							{ key: 'workersAiRead',       label: 'Workers AI > Read' },
							{ key: 'workersAiEdit',       label: 'Workers AI > Edit' },
							{ key: 'accountAnalyticsRead', label: 'Account Analytics > Read' }
						];
						const failedItems = permList.filter(p => {
							const perm = data.permissions[p.key];
							return perm && !perm.success;
						});
						if (failedItems.length > 0) {
							errorDetailHtml = failedItems.map(p => {
								const perm = data.permissions[p.key];
								const errMsg = escapeHtml(perm.error || '未知错误');
								return '<div style="padding:3px 0;word-break:break-all;overflow-wrap:break-word;"><span style="opacity:0.6;">●</span> <strong>' + p.label + '</strong>: ' + errMsg + '</div>';
							}).join('');
						}
					}
					if (!errorDetailHtml) {
						errorDetailHtml = '<div style="padding:3px 0;word-break:break-all;overflow-wrap:break-word;">' + escapeHtml(data.error || '部分权限验证未通过') + '</div>';
					}

					alertEl.innerHTML = '<div style="display:flex;align-items:flex-start;gap:8px;">' +
						ALERT_ICONS.warning +
						'<div style="flex:1;min-width:0;">' +
						'<div style="font-weight:700;margin-bottom:4px;">连接失败 — 以下权限验证未通过：</div>' +
						'<div style="font-size:12px;opacity:0.85;line-height:1.7;">' + errorDetailHtml + '</div>' +
						'</div>' +
						'</div>';

					showToast('测试连接失败，请检查 Token 权限', 'error');
					document.getElementById('btn-save-account').disabled = true;
				}
			} catch (e) {
				setAlertStyle(alertEl, 'danger');
				alertEl.innerHTML = '<div style="display:flex;align-items:center;gap:8px;">' + ALERT_ICONS.warning + '<span>连接超时或异常，请重试</span></div>';
				showToast('连接异常，请重试', 'error');
				document.getElementById('btn-save-account').disabled = true;
			} finally {
				connectionTestInFlight = false;
				document.getElementById('btn-test-conn').disabled = false;
			}
		}

		async function saveAccount() {
			const account = readAccountForm();
			if (!accountFormHasCredential(account) || (['cloudflare', 'antigravity'].includes(account.provider) && !account.accountId.trim())) {
				showToast('请填写必需的账号信息和凭据。', 'warning');
				return;
			}
			const res = await apiFetch('/api/accounts', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(account)
			});
			if (res.ok) {
				closeAccountModal();
				loadAccounts();
				showToast('账号保存成功！');
			} else {
				const data = await res.json().catch(() => ({}));
				showToast(data.error || '保存失败！', 'error');
			}
		}

		async function deleteAccount(id) {
			if (!confirm('确定要删除这个上游账号吗？')) return;
			const res = await apiFetch('/api/accounts', {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ id })
			});
			if (res.ok) {
				loadAccounts();
				showToast('账号已成功删除');
			} else {
				showToast('删除失败', 'error');
			}
		}

		async function loadKeys() {
			try {
				const res = await apiFetch('/api/keys');
				const keys = await res.json();
				const tbody = document.getElementById('keys-table-body');
				tbody.innerHTML = '';
				if (keys.length === 0) {
					tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color: var(--text-muted); padding: 30px;">暂无配置的 API 密钥</td></tr>';
					document.getElementById('no-key-warning').classList.remove('hidden');
					return;
				} else {
					document.getElementById('no-key-warning').classList.add('hidden');
				}
				keys.forEach(k => {
					const tr = document.createElement('tr');
					const dateStr = new Date(k.createdAt).toLocaleString();
					tr.innerHTML = \`
						<td><strong style="font-weight:600;"></strong></td>
						<td>
							<div style="display:flex; align-items:center; gap:8px;">
								<code></code>
								<button class="btn btn-secondary" style="padding:4px 8px; font-size:12px; border-radius:4px;">复制</button>
							</div>
						</td>
						<td></td>
						<td>
							<button class="btn btn-secondary" style="padding:6px 12px; font-size:12px; border-radius:4px; color: var(--danger-color);">删除</button>
						</td>
					\`;
					tr.querySelector('strong').textContent = k.name;
					tr.querySelector('code').textContent = k.key.length > 6 ? k.key.substring(0, 5) + '...' + k.key.substring(k.key.length - 1) : k.key.substring(0, Math.min(3, k.key.length)) + '...';
					tr.querySelectorAll('td')[2].textContent = dateStr;
					const buttons = tr.querySelectorAll('button');
					buttons[0].addEventListener('click', () => copyKeyText(k.key));
					buttons[1].addEventListener('click', () => deleteKey(k.id));
					tbody.appendChild(tr);
				});
			} catch (e) {
				console.error(e);
			}
		}

		function sen(str) {
			return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
		}

		function copyKeyText(val) {
			const input = document.createElement('input');
			input.value = val;
			document.body.appendChild(input);
			input.select();
			document.execCommand('copy');
			document.body.removeChild(input);
			showToast('API Key 复制成功！');
		}

		function openAddKeyModal() {
			document.getElementById('key-name').value = '';
			document.getElementById('key-val').value = '';
			document.getElementById('key-modal-title').innerText = '生成新 API 密钥';
			document.getElementById('key-modal-form').classList.remove('hidden');
			document.getElementById('key-modal-success').classList.add('hidden');
			openAdminModal('key-modal', 'key-name');
		}

		function closeKeyModal() {
			closeAdminModal('key-modal');
		}

		async function saveKey() {
			const name = document.getElementById('key-name').value;
			const key = document.getElementById('key-val').value;
			if (!name) {
				showToast('请输入描述名称！', 'warning');
				return;
			}
			const res = await apiFetch('/api/keys', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name, key })
			});
			if (res.ok) {
				const data = await res.json();
				loadKeys();
				document.getElementById('key-modal-title').innerText = '密钥已生成';
				document.getElementById('key-modal-form').classList.add('hidden');
				document.getElementById('key-modal-success').classList.remove('hidden');
				document.getElementById('generated-key-val').value = data.key;
				document.getElementById('generated-key-val').focus();
			} else {
				showToast('保存密钥失败！', 'error');
			}
		}

		function copyGeneratedKey() {
			const el = document.getElementById('generated-key-val');
			el.select();
			document.execCommand('copy');
			showToast('API Key 复制成功！');
		}

		async function deleteKey(id) {
			if (!confirm('确定要删除这个 API 密钥吗？')) return;
			const res = await apiFetch('/api/keys', {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ id })
			});
			if (res.ok) {
				loadKeys();
				showToast('密钥已成功删除');
			} else {
				showToast('删除密钥失败', 'error');
			}
		}

		function copyModelId(val) {
			const input = document.createElement('input');
			input.value = val;
			document.body.appendChild(input);
			input.select();
			document.execCommand('copy');
			document.body.removeChild(input);
			showToast(\`已复制模型: \${val}\`);
		}


		function filterMappings() {
			const query = document.getElementById('mapping-search').value.trim().toLowerCase();
			const rows = document.querySelectorAll('#mappings-table-body tr');
			let visible = 0;
			rows.forEach(row => {
				const matches = row.textContent.toLowerCase().includes(query);
				row.hidden = !matches;
				if (matches) visible++;
			});
			document.getElementById('mapping-count').textContent = visible + ' / ' + rows.length + ' 个模型';
			document.getElementById('mapping-search-empty').classList.toggle('hidden', visible > 0);
		}

		async function loadSettings() {
			try {
				const res = await apiFetch('/api/settings');
				const data = await res.json();
				customMappings = data.customModelMap || {};
				const tbody = document.getElementById('mappings-table-body');
				tbody.innerHTML = '';
				Object.keys(customMappings).forEach(source => {
					const target = customMappings[source];
					const isPreset = Object.prototype.hasOwnProperty.call(defaultMappings, source) && defaultMappings[source] === target;
					const typeText = isPreset ? '<span class="badge badge-success">预设映射</span>' : '<span class="badge badge-warning">自定义</span>';
					const tr = document.createElement('tr');
					tr.innerHTML = \`
						<td><code style="cursor: pointer;" title="点击复制"></code></td>
						<td><code style="cursor: pointer;" title="点击复制"></code></td>
						<td>\${typeText}</td>
						<td>
							<button class="btn btn-secondary" style="padding:6px 12px; font-size:12px; border-radius:4px; color: var(--danger-color);">删除</button>
						</td>
					\`;
					const codeCells = tr.querySelectorAll('code');
					codeCells[0].textContent = source; codeCells[0].addEventListener('click', () => copyModelId(source));
					codeCells[1].textContent = target; codeCells[1].addEventListener('click', () => copyModelId(target));
					tr.querySelector('button').addEventListener('click', () => deleteMapping(source));
					tbody.appendChild(tr);
				});
				filterMappings();
			} catch(e) {
				console.error(e);
			}
		}

		async function addMapping() {
			const source = document.getElementById('map-source').value.trim();
			const target = document.getElementById('map-target').value.trim();
			if (!source || !target) {
				showToast('请求模型名称和目标模型路径不能为空！', 'warning');
				return;
			}
			customMappings[source] = target;
			const res = await apiFetch('/api/settings', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ customModelMap: customMappings })
			});
			if (res.ok) {
				document.getElementById('map-source').value = '';
				document.getElementById('map-target').value = '';
				loadSettings();
				showToast('映射配置成功！');
			} else {
				showToast('添加映射失败！', 'error');
			}
		}

		async function restorePresetMappings() {
			const mergedMappings = { ...customMappings, ...defaultMappings };
			const hasChanges = Object.keys(defaultMappings).some(source => customMappings[source] !== defaultMappings[source]);

			if (!hasChanges && Object.keys(defaultMappings).every(source => customMappings[source] === defaultMappings[source])) {
				showToast('预设映射已存在，无需重复添加');
				return;
			}

			const res = await apiFetch('/api/settings', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ customModelMap: mergedMappings })
			});
			if (res.ok) {
				customMappings = mergedMappings;
				loadSettings();
				showToast('已恢复预设映射');
			} else {
				showToast('恢复预设映射失败！', 'error');
			}
		}

		async function deleteMapping(source) {
			if (!confirm('确定要删除此映射吗？')) return;
			delete customMappings[source];
			const res = await apiFetch('/api/settings', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ customModelMap: customMappings })
			});
			if (res.ok) {
				loadSettings();
				showToast('已删除映射');
			} else {
				showToast('删除映射失败！', 'error');
			}
		}
	</script>
</body>
</html>`;

	return secureHtmlResponse(html);
}

// 3. KV 未绑定时的报错页面
function handleKVError(request) {
	const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>KV 绑定异常 - ${PROJECT_DISPLAY_NAME}</title>
	<style>
		:root {
			color-scheme: dark;
			--bg-color: #010409;
			--card-bg: #0d1117;
			--border-color: #30363d;
			--text-main: #f0f6fc;
			--text-muted: #8b949e;
			--accent-color: #2f81f7;
			--accent-soft: rgba(56, 139, 253, 0.15);
		}
		* { box-sizing: border-box; margin: 0; padding: 0; }
		body {
			font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif;
			background: var(--bg-color);
			color: var(--text-main);
			min-height: 100vh;
			min-height: 100dvh;
			display: flex;
			align-items: center;
			justify-content: center;
			padding: 24px 16px;
		}
		.error-card {
			width: 100%;
			max-width: 600px;
			padding: clamp(24px, 5vw, 36px);
			background: var(--card-bg);
			border: 1px solid var(--border-color);
			border-radius: 6px;
			box-shadow: none;
		}
		.error-icon {
			display: inline-flex;
			align-items: center;
			justify-content: center;
			width: 40px;
			height: 40px;
			margin-bottom: 20px;
			border: 1px solid rgba(56, 139, 253, 0.4);
			border-radius: 6px;
			color: var(--accent-color);
			background: var(--accent-soft);
			box-shadow: none;
		}
		.error-icon svg { width: 20px; height: 20px; }
		h1 { font-size: 20px; line-height: 1.3; font-weight: 600; margin-bottom: 12px; }
		p { color: var(--text-muted); font-size: 14px; line-height: 1.65; margin-bottom: 20px; overflow-wrap: anywhere; }
		strong { color: var(--text-main); font-weight: 600; }
		.code-block { background: #161b22; border: 1px solid var(--border-color); border-radius: 6px; padding: 16px; color: var(--text-muted); font-size: 12px; line-height: 1.8; overflow-wrap: anywhere; }
		.btn { display: inline-flex; align-items: center; justify-content: center; min-height: 32px; margin-top: 20px; padding: 5px 14px; background: #1f6feb; color: #ffffff; border: 1px solid rgba(240, 246, 252, 0.1); border-radius: 6px; text-decoration: none; font-size: 14px; font-weight: 500; transition: background-color 0.1s; }
		.btn:hover { background: #388bfd; }
		.btn:focus-visible { outline: 2px solid var(--accent-color); outline-offset: 2px; }
		@media (max-height: 600px) { body { align-items: flex-start; } }
		@media (prefers-reduced-motion: reduce) { .btn { transition: none; } }
	</style>
</head>
<body>
	<div class="error-card">
		<div class="error-icon" aria-hidden="true"><svg fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4m0 4h.01M10.3 4.8 2.8 18a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.7 4.8a2 2 0 0 0-3.4 0Z"/></svg></div>
		<h1>KV 命名空间未绑定</h1>
		<p>系统检测到您未在 Cloudflare 平台中为该项目绑定 KV 命名空间，或者绑定的变量名称不为 <strong>KV</strong>。这会导致数据无法保存，系统无法正常运行。</p>
		
		<div class="code-block">
			<strong>解决方案：</strong><br>
			1. 进入您的 Cloudflare Workers/Pages 仪表盘。<br>
			2. 导航至 Settings -> Functions (或 Settings -> Variables) -> KV namespace bindings。<br>
			3. 添加绑定，将【变量名称 (Variable name)】设置为: <strong>KV</strong><br>
			4. 保存并重新部署项目即可。
		</div>
		
		<a href="https://developers.cloudflare.com/kv/learning/kv-bindings/" target="_blank" rel="noopener noreferrer" class="btn">查看官方绑定教程</a>
	</div>
</body>
</html>`;

	const url = new URL(request.url);
	if (url.pathname.startsWith('/v1/') || url.pathname.startsWith('/api/')) {
		return new Response(JSON.stringify({
			error: {
				message: "Cloudflare KV namespace binding 'KV' is missing. Please bind a KV namespace to 'KV' in your Worker/Pages settings.",
				type: "server_error"
			}
		}), { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
	}

	return secureHtmlResponse(html);
}

// 4. Password Error UI Page
function handlePasswordError(request) {
	const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>管理员密码未配置 - ${PROJECT_DISPLAY_NAME}</title>
	<style>
		:root {
			color-scheme: dark;
			--bg-color: #010409;
			--card-bg: #0d1117;
			--border-color: #30363d;
			--text-main: #f0f6fc;
			--text-muted: #8b949e;
			--accent-color: #2f81f7;
			--accent-soft: rgba(56, 139, 253, 0.15);
		}
		* { box-sizing: border-box; margin: 0; padding: 0; }
		body {
			font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif;
			background: var(--bg-color);
			color: var(--text-main);
			min-height: 100vh;
			min-height: 100dvh;
			display: flex;
			align-items: center;
			justify-content: center;
			padding: 24px 16px;
		}
		.error-card {
			width: 100%;
			max-width: 600px;
			padding: clamp(24px, 5vw, 36px);
			background: var(--card-bg);
			border: 1px solid var(--border-color);
			border-radius: 6px;
			box-shadow: none;
		}
		.error-icon {
			display: inline-flex;
			align-items: center;
			justify-content: center;
			width: 40px;
			height: 40px;
			margin-bottom: 20px;
			border: 1px solid rgba(56, 139, 253, 0.4);
			border-radius: 6px;
			color: var(--accent-color);
			background: var(--accent-soft);
			box-shadow: none;
		}
		.error-icon svg { width: 20px; height: 20px; }
		h1 { font-size: 20px; line-height: 1.3; font-weight: 600; margin-bottom: 12px; }
		p { color: var(--text-muted); font-size: 14px; line-height: 1.65; margin-bottom: 20px; overflow-wrap: anywhere; }
		strong { color: var(--text-main); font-weight: 600; }
		.code-block { background: #161b22; border: 1px solid var(--border-color); border-radius: 6px; padding: 16px; color: var(--text-muted); font-size: 12px; line-height: 1.8; overflow-wrap: anywhere; }
		.btn { display: inline-flex; align-items: center; justify-content: center; min-height: 32px; margin-top: 20px; padding: 5px 14px; background: #1f6feb; color: #ffffff; border: 1px solid rgba(240, 246, 252, 0.1); border-radius: 6px; text-decoration: none; font-size: 14px; font-weight: 500; transition: background-color 0.1s; }
		.btn:hover { background: #388bfd; }
		.btn:focus-visible { outline: 2px solid var(--accent-color); outline-offset: 2px; }
		@media (max-height: 600px) { body { align-items: flex-start; } }
		@media (prefers-reduced-motion: reduce) { .btn { transition: none; } }
	</style>
</head>
<body>
	<div class="error-card">
		<div class="error-icon" aria-hidden="true"><svg fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15.5 3a5.5 5.5 0 0 0-5.1 7.6L3 18v3h3v-3h3l2.4-2.4A5.5 5.5 0 1 0 15.5 3Z"/><path stroke-linecap="round" d="M16 7h.01"/></svg></div>
		<h1>管理员密码未配置</h1>
		<p>系统检测到您未在 Cloudflare 平台中为该项目配置 <strong>ADMIN_PASSWORD</strong> 环境变量。为了您的接口和管理后台安全，系统已拦截所有访问，直到密码配置完成。</p>
		
		<div class="code-block">
			<strong>解决方案：</strong><br>
			1. 进入您的 Cloudflare Workers/Pages 仪表盘。<br>
			2. 导航至 Settings -> Variables (或 Settings -> Environment Variables)。<br>
			3. 点击【Add variable】，将【Variable name】设置为: <strong>ADMIN_PASSWORD</strong><br>
			4. 输入您的管理员登录密码作为其值，保存并部署即可。
		</div>
	</div>
</body>
</html>`;

	const url = new URL(request.url);
	if (url.pathname.startsWith('/v1/') || url.pathname.startsWith('/api/')) {
		return new Response(JSON.stringify({
			error: {
				message: "ADMIN_PASSWORD environment variable is missing. Please add the ADMIN_PASSWORD variable to your Worker/Pages settings.",
				type: "server_error"
			}
		}), { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key, x-goog-api-key, anthropic-version, anthropic-beta' } });
	}

	return secureHtmlResponse(html);
}
// Gemini REST adapters use OpenAI Chat Completions as the interchange format.
function normalizeGeminiPart(value) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid Gemini content part');
	const part = structuredClone(value);
	const aliases = { function_call: 'functionCall', function_response: 'functionResponse', thought_signature: 'thoughtSignature', inline_data: 'inlineData', file_data: 'fileData' };
	for (const [alias, canonical] of Object.entries(aliases)) if (part[alias] !== undefined) {
		if (part[canonical] !== undefined && !protocolJsonEqual(part[canonical], part[alias])) throw new TypeError('Conflicting Gemini content aliases');
		part[canonical] ??= part[alias];
		delete part[alias];
	}
	for (const media of [part.inlineData, part.fileData]) if (media && typeof media === 'object') {
		for (const [alias, canonical] of Object.entries({ mime_type: 'mimeType', file_uri: 'fileUri' })) if (media[alias] !== undefined) {
			if (media[canonical] !== undefined && media[canonical] !== media[alias]) throw new TypeError('Conflicting Gemini media aliases');
			media[canonical] ??= media[alias];
			delete media[alias];
		}
	}
	if (['text', 'functionCall', 'functionResponse', 'inlineData', 'fileData'].filter(key => part[key] !== undefined).length !== 1
		|| (part.thought && typeof part.text !== 'string')) throw new TypeError('Gemini content parts must contain exactly one visible payload');
	return part;
}

function geminiVisibleContent(parts) {
	const visible = parts.filter(part => !part.thought && !part.functionCall);
	if (visible.every(part => typeof part.text === 'string')) return visible.map(part => part.text).join('');
	return geminiProtocolContent(visible);
}

function geminiProtocolArgs(value) {
	if (typeof value === 'string') {
		try {
			value = JSON.parse(value);
		} catch {
			throw new TypeError('Function arguments must be valid JSON');
		}
	}
	value ??= {};
	if (typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Function arguments must be an object');
	return value;
}
function geminiProtocolContent(parts) {
	const out = [];
	for (const part of parts) {
		if (typeof part.text === 'string') out.push({ type: 'text', text: part.text });
		else if (part.inlineData || part.inline_data) {
			const d = part.inlineData || part.inline_data;
			out.push({ type: 'image_url', image_url: { url: `data:${d.mimeType || d.mime_type};base64,${d.data}` } });
		} else if (part.fileData || part.file_data) {
			const d = part.fileData || part.file_data;
			out.push({
				type: 'image_url',
				image_url: { url: d.fileUri || d.file_uri, mime_type: d.mimeType || d.mime_type }
			});
		} else throw new TypeError('Unsupported Gemini content part');
	}
	return out.length === 1 && out[0].type === 'text' ? out[0].text : out;
}
function geminiProtocolSchema(schema) {
	if (!schema || typeof schema !== 'object') return schema;
	const result = structuredClone(schema);
	if (typeof result.type === 'string') result.type = result.type.toLowerCase();
	// Traverse schema nodes only. Defaults, constants, examples and enum values
	// are user literals, even when they contain a property named "type".
	for (const field of ['properties', '$defs', 'definitions', 'dependentSchemas']) if (result[field] && typeof result[field] === 'object') {
		result[field] = Object.fromEntries(Object.entries(result[field]).map(([name, value]) => [name, geminiProtocolSchema(value)]));
	}
	for (const field of ['items', 'additionalProperties', 'contains', 'not', 'propertyNames', 'if', 'then', 'else']) if (result[field] !== undefined) result[field] = geminiProtocolSchema(result[field]);
	for (const field of ['allOf', 'anyOf', 'oneOf', 'prefixItems']) if (Array.isArray(result[field])) result[field] = result[field].map(geminiProtocolSchema);
	return result;
}

function normalizeGeminiAliases(value, aliases, label) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`Gemini ${label} must be an object.`);
	const result = structuredClone(value);
	for (const [alias, canonical] of Object.entries(aliases)) if (result[alias] !== undefined) {
		if (result[canonical] !== undefined && !protocolJsonEqual(result[canonical], result[alias])) throw new TypeError(`Conflicting Gemini ${label} aliases.`);
		result[canonical] = result[alias]; delete result[alias];
	}
	return result;
}

function normalizeGeminiGenerationConfig(value) {
	const prepared = structuredClone(value);
	for (const field of ['thinkingConfig', 'thinking_config']) if (prepared?.[field] !== undefined) prepared[field] = normalizeGeminiAliases(prepared[field], {
		thinking_budget: 'thinkingBudget', include_thoughts: 'includeThoughts', thinking_level: 'thinkingLevel'
	}, 'thinkingConfig');
	return normalizeGeminiAliases(prepared, {
		top_p: 'topP', top_k: 'topK', max_output_tokens: 'maxOutputTokens', stop_sequences: 'stopSequences', candidate_count: 'candidateCount',
		presence_penalty: 'presencePenalty', frequency_penalty: 'frequencyPenalty', response_mime_type: 'responseMimeType', response_schema: 'responseSchema',
		response_json_schema: 'responseJsonSchema', thinking_config: 'thinkingConfig', response_format: 'responseFormat', image_config: 'imageConfig'
	}, 'generationConfig');
}

function normalizeGeminiRequestFields(value) {
	const prepared = structuredClone(value);
	for (const field of ['generationConfig', 'generation_config']) if (prepared?.[field] !== undefined) prepared[field] = normalizeGeminiGenerationConfig(prepared[field]);
	for (const field of ['toolConfig', 'tool_config']) if (prepared?.[field] !== undefined) {
		const config = structuredClone(prepared[field]);
		for (const key of ['functionCallingConfig', 'function_calling_config']) if (config?.[key] !== undefined) {
			config[key] = normalizeGeminiAliases(config[key], { allowed_function_names: 'allowedFunctionNames', stream_function_call_arguments: 'streamFunctionCallArguments' }, 'functionCallingConfig');
			if (typeof config[key].mode === 'string') config[key].mode = config[key].mode.toUpperCase();
		}
		prepared[field] = normalizeGeminiAliases(config, { function_calling_config: 'functionCallingConfig' }, 'toolConfig');
	}
	if (Array.isArray(prepared?.tools)) prepared.tools = prepared.tools.map(tool => {
		const entry = structuredClone(tool);
		for (const field of ['functionDeclarations', 'function_declarations']) if (Array.isArray(entry?.[field])) entry[field] = entry[field].map(fn => normalizeGeminiAliases(fn, {
			parameters_json_schema: 'parametersJsonSchema', response_json_schema: 'responseJsonSchema', response_mime_type: 'responseMimeType'
		}, 'functionDeclaration'));
		return normalizeGeminiAliases(entry, { function_declarations: 'functionDeclarations' }, 'tool');
	});
	return normalizeGeminiAliases(prepared, {
		system_instruction: 'systemInstruction', generation_config: 'generationConfig', tool_config: 'toolConfig', safety_settings: 'safetySettings',
		cached_content: 'cachedContent', continuation_token: 'continuationToken', service_tier: 'serviceTier'
	}, 'request');
}

function geminiGenerationToOpenAI(config) {
	const result = {};
	for (const [source, target] of Object.entries({ temperature: 'temperature', topP: 'top_p', topK: 'top_k', maxOutputTokens: 'max_tokens', stopSequences: 'stop', candidateCount: 'n', presencePenalty: 'presence_penalty', frequencyPenalty: 'frequency_penalty', seed: 'seed' })) {
		if (config[source] !== undefined) result[target] = structuredClone(config[source]);
	}
	if (config.responseMimeType === 'application/json') {
		if (config.responseSchema !== undefined && config.responseJsonSchema !== undefined) throw new TypeError('Gemini responseSchema and responseJsonSchema cannot both be set.');
		const schema = config.responseJsonSchema !== undefined ? structuredClone(config.responseJsonSchema) : config.responseSchema !== undefined ? geminiProtocolSchema(config.responseSchema) : undefined;
		result.response_format = schema !== undefined ? { type: 'json_schema', json_schema: { name: 'response', schema } } : { type: 'json_object' };
	}
	if (config.thinkingConfig !== undefined) result.thinking_config = structuredClone(config.thinkingConfig);
	return result;
}
function geminiToOpenAIRequest(body, model) {
	body = normalizeGeminiRequestFields(body);
	if (!body || typeof body !== 'object' || !Array.isArray(body.contents) || !body.contents.length)
		throw new TypeError('contents must be a non-empty array');
	const result = { model, messages: [], gemini_extra: structuredClone(body) };
	delete result.gemini_extra.contents;
	delete result.gemini_extra.model;
	const system = body.systemInstruction || body.system_instruction;
	if (system?.parts?.length) result.messages.push({ role: 'system', content: geminiProtocolContent(system.parts) });
	const calls = [];
	for (const content of body.contents) {
		if (!Array.isArray(content.parts) || !content.parts.length)
			throw new TypeError('Each content requires non-empty parts');
		if (content.role && !['user', 'model'].includes(content.role))
			throw new TypeError('Gemini content role must be user or model');
		const normalizedParts = content.parts.map(normalizeGeminiPart);
		const role = content.role === 'model' ? 'assistant' : 'user',
			toolCalls = [],
			remaining = [],
			toolResults = [];
		for (const part of normalizedParts) {
			const fc = part.functionCall || part.function_call,
				fr = part.functionResponse || part.function_response;
			if (fc) {
				if (role !== 'assistant' || typeof fc.name !== 'string')
					throw new TypeError('functionCall requires model role and name');
				const id = fc.id || `call_${calls.length}`;
				calls.push({ id, name: fc.name, responded: false });
				toolCalls.push({
					id,
					type: 'function',
					function: { name: fc.name, arguments: JSON.stringify(geminiProtocolArgs(fc.args)) },
					...(part.thoughtSignature ? { gemini_thought_signature: part.thoughtSignature } : {})
				});
			} else if (fr) {
				if (role !== 'user' || typeof fr.name !== 'string')
					throw new TypeError('functionResponse requires user role and name');
				const match = calls.find((c) => !c.responded && (fr.id ? c.id === fr.id : c.name === fr.name));
				if (!match && !fr.id) throw new TypeError('functionResponse has no matching functionCall');
				if (match) match.responded = true;
				toolResults.push({
					role: 'tool',
					tool_call_id: fr.id || match.id,
					name: fr.name,
					content: JSON.stringify(fr.response ?? {}),
					gemini_function_response: structuredClone(part)
				});
			} else if (part.thought) {
				if (typeof part.text !== 'string') throw new TypeError('Unsupported Gemini thought part');
			} else remaining.push(part);
		}
		result.messages.push(...toolResults);
		if (remaining.length || toolCalls.length || (role === 'assistant' && normalizedParts.some((p) => p.thought))) {
			const message = { role, content: remaining.length ? geminiProtocolContent(remaining) : null };
			if (toolCalls.length) message.tool_calls = toolCalls;
			message.gemini_parts = structuredClone(role === 'assistant' ? normalizedParts : remaining);
			const thoughts = normalizedParts
				.filter((p) => p.thought && typeof p.text === 'string')
				.map((p) => p.text)
				.join('');
			if (thoughts) message.reasoning_content = thoughts;
			result.messages.push(message);
		}
	}
	Object.assign(result, geminiGenerationToOpenAI(body.generationConfig || {}));
	if (body.tools) {
		result.tools = [];
		for (const tool of body.tools) {
			const declarations = tool.functionDeclarations || tool.function_declarations;
			if (
				!Array.isArray(declarations) ||
				Object.keys(tool).some((k) => !['functionDeclarations', 'function_declarations'].includes(k))
			)
				throw new TypeError('Only functionDeclarations tools can be translated across providers');
			for (const fn of declarations)
				result.tools.push({
					type: 'function',
					function: {
						name: fn.name,
						description: fn.description || '',
						parameters: fn.parametersJsonSchema !== undefined ? structuredClone(fn.parametersJsonSchema) : geminiProtocolSchema(fn.parameters || { type: 'object', properties: {} })
					}
				});
		}
	}
	const tc = body.toolConfig?.functionCallingConfig || body.tool_config?.function_calling_config;
	if (tc) {
		const mode = (tc.mode || 'AUTO').toUpperCase();
		if (mode === 'NONE') result.tool_choice = 'none';
		else if (mode === 'AUTO' || mode === 'VALIDATED') result.tool_choice = 'auto';
		else if (mode === 'ANY') {
			const names = tc.allowedFunctionNames || tc.allowed_function_names;
			if (names?.length === 1) result.tool_choice = { type: 'function', function: { name: names[0] } };
			else {
				result.tool_choice = 'required';
				if (names?.length) result.tools = result.tools?.filter((t) => names.includes(t.function.name));
			}
		} else throw new TypeError('Unsupported function calling mode');
	}
	return result;
}
function openAIToGeminiRequest(payload) {
	if (!payload || !Array.isArray(payload.messages)) throw new TypeError('messages must be an array');
	validateToolStrictness(payload.tools, 'Gemini');
	if (payload.parallel_tool_calls === false && payload.tools?.length) throw new TypeError('This Gemini adapter cannot represent a parallel-call restriction.');
	const body = normalizeGeminiRequestFields(payload.gemini_extra || {});
	body.contents = [];
	const systemParts = [],
		names = new Map();
	for (const message of payload.messages) {
		validateReplayMetadata(message);
		if (!['system', 'developer', 'assistant', 'user', 'tool'].includes(message.role))
			throw new TypeError('Unsupported OpenAI message role');
		if (message.role === 'tool') {
			const name = message.name || names.get(message.tool_call_id);
			if (!name) throw new TypeError('Tool result has no matching tool name');
			let response;
			try {
				response = JSON.parse(message.content);
			} catch {
				response = { result: message.content };
			}
			if (!response || typeof response !== 'object' || Array.isArray(response)) response = { result: response };
			if (message.gemini_function_response !== undefined) {
				const saved = normalizeGeminiPart(message.gemini_function_response), native = saved.functionResponse;
				if (!native || Object.keys(saved).some(key => key !== 'functionResponse')
					|| Object.keys(native).some(key => !['id', 'name', 'response'].includes(key))
					|| native.name !== name || (native.id !== undefined && native.id !== message.tool_call_id)
					|| !protocolJsonEqual(native.response ?? {}, response)) throw new TypeError('Replay metadata does not match the visible tool result.');
			}
			const part = message.gemini_function_response ? normalizeGeminiPart(message.gemini_function_response) : {
				functionResponse: { name, id: message.tool_call_id, response }
			};
			const previous = body.contents.at(-1);
			if (previous?.role === 'user' && previous.parts.every((p) => p.functionResponse))
				previous.parts.push(structuredClone(part));
			else body.contents.push({ role: 'user', parts: [structuredClone(part)] });
			continue;
		}
		const role = message.role === 'assistant' ? 'model' : 'user',
			parts = [];
		if (typeof message.content === 'string' && message.content) parts.push({ text: message.content });
		else if (Array.isArray(message.content))
			for (const part of message.content) {
				if (part.type === 'text') parts.push({ text: part.text || '' });
				else if (part.type === 'image_url') {
					const image = typeof part.image_url === 'string' ? { url: part.image_url } : part.image_url,
						match = /^data:([^;]+);base64,([\s\S]+)$/.exec(image?.url || '');
					if (match) parts.push({ inlineData: { mimeType: match[1], data: match[2] } });
					else if (image?.url)
						parts.push({ fileData: { mimeType: image.mime_type || 'image/jpeg', fileUri: image.url } });
					else throw new TypeError('image_url must contain a URL');
				} else if (part.type === 'input_audio')
					parts.push({
						inlineData: {
							mimeType: part.input_audio.format === 'wav' ? 'audio/wav' : 'audio/mpeg',
							data: part.input_audio.data
						}
					});
				else throw new TypeError('Unsupported OpenAI content type: ' + part.type);
			}
		if (['system', 'developer'].includes(message.role)) {
			systemParts.push(...parts);
			continue;
		}
		for (const tc of message.tool_calls || []) {
			if (tc.type && tc.type !== 'function') throw new TypeError('Only function tools are supported');
			names.set(tc.id, tc.function.name);
			parts.push({
				functionCall: {
					name: tc.function.name,
					args: geminiProtocolArgs(tc.function.arguments),
					...(tc.id ? { id: tc.id } : {})
				},
				...(tc.gemini_thought_signature ? { thoughtSignature: tc.gemini_thought_signature } : {})
			});
		}
		if (message.gemini_parts) {
			if (!Array.isArray(message.gemini_parts)) throw new TypeError('gemini_parts must be an array');
			body.contents.push({ role, parts: message.gemini_parts.map(normalizeGeminiPart) });
		} else if (parts.length) body.contents.push({ role, parts });
	}
	if (systemParts.length) body.systemInstruction = { parts: systemParts };
	body.generationConfig = { ...(body.generationConfig || {}) };
	for (const [source, target] of Object.entries({
		temperature: 'temperature',
		top_p: 'topP',
		top_k: 'topK',
		max_tokens: 'maxOutputTokens',
		max_completion_tokens: 'maxOutputTokens',
		stop: 'stopSequences',
		n: 'candidateCount',
		presence_penalty: 'presencePenalty',
		frequency_penalty: 'frequencyPenalty',
		seed: 'seed'
	}))
		if (payload[source] !== undefined)
			body.generationConfig[target] =
				source === 'stop' && typeof payload[source] === 'string' ? [payload[source]] : payload[source];
	if (payload.thinking_config) body.generationConfig.thinkingConfig = structuredClone(payload.thinking_config);
	if (payload.response_format) {
		const f = payload.response_format;
		if (f.type === 'json_object' || f.type === 'json_schema') {
			body.generationConfig.responseMimeType = 'application/json';
			if (f.type === 'json_schema') {
				delete body.generationConfig.responseSchema;
				body.generationConfig.responseJsonSchema = f.json_schema?.schema;
			}
		} else if (f.type !== 'text') throw new TypeError('Unsupported response_format');
	}
	if (payload.tools && !body.tools)
		body.tools = [
			{
				functionDeclarations: payload.tools.map((t) => {
					if (t.type !== 'function') throw new TypeError('Only function tools are supported');
					return {
						name: t.function.name,
						description: t.function.description || '',
						parametersJsonSchema: t.function.parameters || { type: 'object', properties: {} }
					};
				})
			}
		];
	if (payload.tool_choice !== undefined && !body.toolConfig) {
		const c = payload.tool_choice;
		body.toolConfig = {
			...(body.toolConfig || {}),
			functionCallingConfig:
				c === 'none'
					? { mode: 'NONE' }
					: c === 'required'
						? { mode: 'ANY' }
						: typeof c === 'object' && c.function?.name
							? { mode: 'ANY', allowedFunctionNames: [c.function.name] }
							: { mode: 'AUTO' }
		};
	} else if (payload.tool_choice !== undefined && body.toolConfig) {
		const choice = payload.tool_choice, config = body.toolConfig.functionCallingConfig || body.toolConfig.function_calling_config;
		const mode = (config?.mode || 'AUTO').toUpperCase(), names = config?.allowedFunctionNames || config?.allowed_function_names;
		const matches = choice === 'none' ? mode === 'NONE' : choice === 'required' ? mode === 'ANY'
			: choice === 'auto' ? mode === 'AUTO' || mode === 'VALIDATED'
			: typeof choice === 'object' && choice.function?.name && mode === 'ANY' && names?.length === 1 && names[0] === choice.function.name;
		if (!matches) throw new TypeError('Gemini toolConfig conflicts with the explicit tool_choice.');
	}
	return body;
}
function geminiFinishToOpenAI(reason, hasTools) {
	if (!reason) return null;
	if (reason === 'MAX_TOKENS') return 'length';
	if (['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII', 'IMAGE_SAFETY', 'IMAGE_PROHIBITED_CONTENT', 'IMAGE_RECITATION', 'ESCALATION', 'PUP_LIMITED_DISABLED'].includes(reason))
		return 'content_filter';
	if (reason === 'STOP') return hasTools ? 'tool_calls' : 'stop';
	// Malformed calls and unknown terminal states are failures, never normal EOF.
	throw new Error('Gemini upstream did not complete generation successfully.');
}
function geminiUsageToOpenAI(u) {
	if (!u) return undefined;
	return {
		prompt_tokens: u.promptTokenCount || 0,
		completion_tokens: (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0),
		total_tokens: u.totalTokenCount || 0,
		...(u.cachedContentTokenCount !== undefined
			? { prompt_tokens_details: { cached_tokens: u.cachedContentTokenCount } }
			: {}),
		...(u.thoughtsTokenCount !== undefined
			? { completion_tokens_details: { reasoning_tokens: u.thoughtsTokenCount } }
			: {})
	};
}
function openAIUsageToGemini(u) {
	if (!u) return undefined;
	const r = u.completion_tokens_details?.reasoning_tokens || 0;
	return {
		promptTokenCount: u.prompt_tokens || 0,
		candidatesTokenCount: Math.max(0, (u.completion_tokens || 0) - r),
		totalTokenCount: u.total_tokens || 0,
		...(r ? { thoughtsTokenCount: r } : {}),
		...(u.prompt_tokens_details?.cached_tokens !== undefined
			? { cachedContentTokenCount: u.prompt_tokens_details.cached_tokens }
			: {})
	};
}
function geminiToOpenAIResponse(data, model) {
	if (data.error) return { error: data.error };
	const choices = (data.candidates || []).map((c, position) => {
		const parts = (c.content?.parts || []).map(normalizeGeminiPart),
			calls = parts
				.filter((p) => p.functionCall)
				.map((p, i) => ({
					id: p.functionCall.id || `call_${c.index ?? position}_${i}`,
					type: 'function',
					function: { name: p.functionCall.name, arguments: JSON.stringify(geminiProtocolArgs(p.functionCall.args)) },
					...(p.thoughtSignature ? { gemini_thought_signature: p.thoughtSignature } : {})
				}));
		const text = geminiVisibleContent(parts),
			thinking = parts
				.filter((p) => p.thought && typeof p.text === 'string')
				.map((p) => p.text)
				.join('');
		return {
			index: c.index ?? position,
			message: {
				role: 'assistant',
				content: text || (calls.length ? null : ''),
				...(calls.length ? { tool_calls: calls } : {}),
				...(thinking ? { reasoning_content: thinking } : {}),
				gemini_parts: structuredClone(parts)
			},
			finish_reason: geminiFinishToOpenAI(c.finishReason, calls.length > 0),
			...(c.safetyRatings ? { gemini_safety_ratings: c.safetyRatings } : {})
		};
	});
	if (!choices.length && data.promptFeedback?.blockReason)
		choices.push({
			index: 0,
			message: { role: 'assistant', content: '', refusal: data.promptFeedback.blockReason },
			finish_reason: 'content_filter'
		});
	return {
		id: data.responseId || `chatcmpl-${crypto.randomUUID()}`,
		object: 'chat.completion',
		created: Math.floor(Date.now() / 1000),
		model: model || data.modelVersion,
		choices,
		...(data.usageMetadata ? { usage: geminiUsageToOpenAI(data.usageMetadata) } : {}),
		...(data.promptFeedback ? { gemini_prompt_feedback: data.promptFeedback } : {}),
		...(data.modelVersion ? { gemini_model_version: data.modelVersion } : {})
	};
}
function openAIToGeminiResponse(data, model) {
	if (data.error)
		return {
			error: {
				code: typeof data.error.code === 'number' ? data.error.code : 502,
				status: 'INTERNAL',
				message: data.error.message || 'Upstream error'
			}
		};
	const candidates = (data.choices || []).map((c, position) => {
		const m = c.message || {},
			parts = [];
		let nativeParts;
		if (m.gemini_parts !== undefined) {
			validateReplayMetadata(m);
			nativeParts = m.gemini_parts.map(normalizeGeminiPart);
		}
		if (m.reasoning_content) parts.push({ text: m.reasoning_content, thought: true });
		if (typeof m.content === 'string' && m.content) parts.push({ text: m.content });
		else if (Array.isArray(m.content))
			for (const p of m.content) {
				if (p.type === 'text') parts.push({ text: p.text || '' });
				else if (p.type === 'image_url') {
					const image = typeof p.image_url === 'string' ? { url: p.image_url } : p.image_url;
					if (!image || typeof image.url !== 'string' || !image.url) throw new TypeError('Invalid OpenAI response image');
					const inline = /^data:([^;,]+);base64,([\s\S]+)$/.exec(image.url);
					if (inline) parts.push({ inlineData: { mimeType: inline[1], data: inline[2] } });
					else parts.push({ fileData: { mimeType: image.mime_type || 'image/jpeg', fileUri: image.url } });
				} else throw new TypeError('Unsupported OpenAI response content type');
			}
		for (const tc of m.tool_calls || [])
			parts.push({
				functionCall: { id: tc.id, name: tc.function.name, args: geminiProtocolArgs(tc.function.arguments) },
				...(tc.gemini_thought_signature ? { thoughtSignature: tc.gemini_thought_signature } : {})
			});
		return {
			index: c.index ?? position,
			content: { role: 'model', parts: nativeParts || parts },
			finishReason:
				c.finish_reason === 'length' ? 'MAX_TOKENS' : c.finish_reason === 'content_filter' ? 'SAFETY' : 'STOP',
			...(c.gemini_safety_ratings ? { safetyRatings: c.gemini_safety_ratings } : {})
		};
	});
	return {
		candidates,
		...(data.usage ? { usageMetadata: openAIUsageToGemini(data.usage) } : {}),
		modelVersion: data.gemini_model_version || model || data.model,
		...(data.id ? { responseId: data.id } : {}),
		...(data.gemini_prompt_feedback ? { promptFeedback: data.gemini_prompt_feedback } : {})
	};
}
// Incremental SSE decoder: UTF-8 boundaries, terminal frames, cancellation and backpressure.
function geminiProtocolStream(upstreamBody, transform, finish, { sse = true, openAI = false } = {}) {
	const reader = upstreamBody.getReader(),
		decoder = new TextDecoder(),
		encoder = new TextEncoder();
	let buffer = '',
		eventLines = [],
		ended = false,
		first = true,
		finished = false,
		failed = false,
		cancelled = false;
	const queue = [];
	const add = (value) => {
		if (value !== undefined && value !== null)
			for (const item of Array.isArray(value) ? value : [value]) {
				queue.push(item);
				if (item?.error) { failed = true; ended = true; break; }
			}
	};
	function line(value) {
		if (!value) {
			if (eventLines.length) {
				const data = eventLines.join('\n');
				eventLines = [];
				if (data === '[DONE]') ended = true;
				else {
					let parsed;
					try {
						parsed = JSON.parse(data);
					} catch {
						throw new TypeError('Invalid upstream SSE JSON');
					}
					add(transform(parsed));
				}
			}
		} else if (value.startsWith('data:')) eventLines.push(value.slice(5).replace(/^ /, ''));
	}
	function process(flush = false) {
		let index;
		while (!ended && (index = buffer.indexOf('\n')) !== -1) {
			const value = buffer.slice(0, index).replace(/\r$/, '');
			buffer = buffer.slice(index + 1);
			line(value);
		}
		if (flush && !ended) {
			if (buffer) line(buffer.replace(/\r$/, ''));
			buffer = '';
			line('');
		}
	}
	return new ReadableStream({
		async pull(controller) {
			try {
				while (!queue.length && !ended) {
					const { value, done } = await reader.read();
					if (cancelled) return;
					buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
					process(done);
					if (done) ended = true;
				}
				if (ended && !finished && !failed) {
					finished = true;
					add(finish?.());
				}
				if (queue.length) {
					const item = queue.shift();
					controller.enqueue(
						encoder.encode(sse ? `data: ${JSON.stringify(item)}\n\n` : `${first ? '[' : ','}${JSON.stringify(item)}`)
					);
					first = false;
				}
				if (ended && !queue.length) {
					if (sse && openAI && !failed) controller.enqueue(encoder.encode('data: [DONE]\n\n'));
					else if (!sse) controller.enqueue(encoder.encode(first ? '[]' : ']'));
					controller.close();
					await reader.cancel().catch(() => {});
				}
			} catch (error) {
				if (cancelled) return;
				// An errored ReadableStream can appear as a plain EOF once HTTP headers
				// are sent. Put the failure on the wire so remote clients can detect it.
				const message = 'Upstream stream ended prematurely or returned invalid content.';
				const failure = openAI ? { error: { type: 'upstream_error', message } }
					: { error: { code: 502, status: 'INTERNAL', message } };
				queue.length = 0; failed = true; ended = true; finished = true;
				controller.enqueue(encoder.encode(sse ? `data: ${JSON.stringify(failure)}\n\n` : `${first ? '[' : ','}${JSON.stringify(failure)}]`));
				controller.close();
				await reader.cancel(error).catch(() => {});
			}
		},
		cancel(reason) {
			cancelled = true; ended = true; failed = true; queue.length = 0;
			return reader.cancel(reason);
		}
	});
}
function geminiToOpenAIStream(upstreamBody, model) {
	let id = `chatcmpl-${crypto.randomUUID()}`;
	const tools = new Map(), created = Math.floor(Date.now() / 1000);
	const completion = openAIStreamCompletion();
	return geminiProtocolStream(
		upstreamBody,
		(data) => {
			if (data.error) return { error: data.error };
			id = data.responseId || id;
			const choices = (data.candidates || []).map((c, position) => {
				const index = c.index ?? position,
					parts = (c.content?.parts || []).map(normalizeGeminiPart),
					delta = { role: 'assistant' };
				const text = geminiVisibleContent(parts),
					thoughts = parts
						.filter((p) => typeof p.text === 'string' && p.thought)
						.map((p) => p.text)
						.join('');
				if (text) delta.content = text;
				if (thoughts) delta.reasoning_content = thoughts;
				if (parts.length) delta.gemini_parts = structuredClone(parts);
				let count = tools.get(index) || 0;
				const calls = [];
				for (const p of parts)
					if (p.functionCall) {
						const fc = p.functionCall;
						if (fc.partialArgs) throw new TypeError('Gemini partialArgs streaming is not supported');
						calls.push({
							index: count,
							id: fc.id || `call_${index}_${count}`,
							type: 'function',
							function: { name: fc.name, arguments: JSON.stringify(geminiProtocolArgs(fc.args)) },
							...(p.thoughtSignature ? { gemini_thought_signature: p.thoughtSignature } : {})
						});
						count++;
					}
				tools.set(index, count);
				if (calls.length) delta.tool_calls = calls;
				return { index, delta, finish_reason: geminiFinishToOpenAI(c.finishReason, count > 0) };
			});
			if (!choices.length && data.promptFeedback?.blockReason)
				choices.push({
					index: 0,
					delta: { refusal: data.promptFeedback.blockReason },
					finish_reason: 'content_filter'
				});
			completion.accept({ choices });
			return {
				id,
				object: 'chat.completion.chunk',
				created,
				model,
				choices,
				...(data.usageMetadata ? { usage: geminiUsageToOpenAI(data.usageMetadata) } : {}),
				...(data.promptFeedback ? { gemini_prompt_feedback: data.promptFeedback } : {})
			};
		},
		() => { completion.finish(); },
		{ openAI: true }
	);
}
function openAIToGeminiStream(upstreamBody, model, { sse = true } = {}) {
	const states = new Map();
	let lastId;
	function flushTools(state) {
		const parts = [];
		for (const tool of state.tools.values())
			if (!tool.sent) {
				if (!tool.name) throw new TypeError('Streamed tool has no name');
				parts.push({
					functionCall: { id: tool.id, name: tool.name, args: geminiProtocolArgs(tool.args) },
					...(tool.signature ? { thoughtSignature: tool.signature } : {})
				});
				tool.sent = true;
			}
		return parts;
	}
	return geminiProtocolStream(
		upstreamBody,
		(data) => {
			if (data.error)
				return { error: { code: 502, status: 'INTERNAL', message: data.error.message || 'Upstream stream error' } };
			lastId = data.id || lastId;
			const candidates = [];
			for (const c of data.choices || []) {
				const index = c.index ?? 0,
					state = states.get(index) || { tools: new Map(), ended: false };
				states.set(index, state);
				const d = c.delta || {},
					parts = [];
				if (d.gemini_parts) parts.push(...structuredClone(d.gemini_parts));
				else {
					if (d.reasoning_content) parts.push({ text: d.reasoning_content, thought: true });
					if (d.content) parts.push({ text: d.content });
				}
				for (const tc of d.gemini_parts ? [] : d.tool_calls || []) {
					const key = tc.index ?? 0,
						tool = state.tools.get(key) || { id: '', name: '', args: '', sent: false };
					if (tc.id) tool.id = tc.id;
					if (tc.function?.name) tool.name += tc.function.name;
					if (tc.function?.arguments) tool.args += tc.function.arguments;
					if (tc.gemini_thought_signature) tool.signature = tc.gemini_thought_signature;
					state.tools.set(key, tool);
				}
				if (c.finish_reason) {
					if (c.finish_reason !== 'length') parts.push(...flushTools(state));
					state.ended = true;
				}
				if (parts.length || c.finish_reason)
					candidates.push({
						index,
						content: { role: 'model', parts },
						...(c.finish_reason
							? {
									finishReason:
										c.finish_reason === 'length'
											? 'MAX_TOKENS'
											: c.finish_reason === 'content_filter'
												? 'SAFETY'
												: 'STOP'
								}
							: {})
					});
			}
			if (!candidates.length && !data.usage) return undefined;
			return {
				...(candidates.length ? { candidates } : {}),
				...(data.usage ? { usageMetadata: openAIUsageToGemini(data.usage) } : {}),
				modelVersion: model,
				...(lastId ? { responseId: lastId } : {})
			};
		},
		() => {
			if (!states.size || [...states.values()].some(state => !state.ended)) throw new Error('Upstream stream ended before a finish reason.');
		},
		{ sse }
	);
}
