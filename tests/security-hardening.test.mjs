import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../_worker.js', import.meta.url), 'utf8');
let serial = 0;
async function harness(keys = [{ id: 'key', key: 'client-key' }]) {
  const module = await import('data:text/javascript;base64,' + Buffer.from('const fetch = () => { throw new Error("Unexpected external request"); };\n' + source + '\nexport { handleAdminPage, handleLandingPage, handleKVError, handlePasswordError }; //security ' + serial++).toString('base64'));
  const values = new Map([['config', { accounts: [], apiKeys: keys, customModelMap: {} }]]);
  const env = { ADMIN_PASSWORD: 'test-password', KV: { async get() { return null; } } };
  let queue = Promise.resolve();
  const state = { storage: {
    async get(key) { return structuredClone(values.get(key)); },
    async put(key, value) { values.set(key, structuredClone(value)); },
  }, blockConcurrencyWhile(fn) { const task = queue.then(fn); queue = task.catch(() => {}); return task; } };
  let store = new module.AppConfigStore(state, env);
  env.CONFIG_STORE = { idFromName: name => name, get: () => ({ fetch: (url, init) => store.fetch(new Request(url, init)) }) };
  const call = (path, { method = 'GET', headers = {}, body } = {}) => module.default.fetch(new Request('https://gateway.test' + path, {
    method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }), env, {});
  const login = (password = env.ADMIN_PASSWORD, ip = '192.0.2.1') => call('/api/auth/login', { method: 'POST', headers: { 'CF-Connecting-IP': ip, 'Content-Type': 'application/json' }, body: { password } });
  return { module, values, env, call, login, restart() { store = new module.AppConfigStore(state, env); } };
}
const cookieOf = response => response.headers.get('set-cookie').split(';')[0];

test('empty keys and deletion of the last key deny every client protocol', async () => {
  const h = await harness([]);
  for (const path of ['/v1/models', '/v1/chat/completions', '/v1/messages', '/v1beta/models', '/v1beta/models/test:generateContent']) {
    assert.equal((await h.call(path, { headers: { authorization: 'Bearer anything', 'x-api-key': 'anything', 'x-goog-api-key': 'anything' } })).status, 401, path);
  }
  const cookie = cookieOf(await h.login());
  assert.equal((await h.call('/api/keys', { method: 'POST', headers: { cookie }, body: { name: 'Client', key: 'client-key' } })).status, 200);
  assert.equal((await h.call('/v1/models', { headers: { authorization: 'Bearer client-key' } })).status, 200);
  const [key] = await (await h.call('/api/keys', { headers: { cookie } })).json();
  assert.equal((await h.call('/api/keys', { method: 'DELETE', headers: { cookie }, body: { id: key.id } })).status, 200);
  assert.equal((await h.call('/v1/models', { headers: { authorization: 'Bearer client-key' } })).status, 401);
});

test('sessions are random, revocable and secret; password digests are never admin credentials', async () => {
  const h = await harness();
  const first = await h.login(), second = await h.login();
  const cookie = cookieOf(first), other = cookieOf(second), token = cookie.split('=')[1];
  assert.notEqual(cookie, other);
  for (const flag of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Max-Age=86400']) assert.ok(first.headers.get('set-cookie').includes(flag));
  const oldDigest = createHash('sha256').update(h.env.ADMIN_PASSWORD).digest('hex');
  for (const headers of [{ cookie: 'admin_token=' + oldDigest }, { authorization: 'Bearer ' + oldDigest }]) assert.equal((await h.call('/api/keys', { headers })).status, 401);
  assert.equal((await h.call('/api/keys', { headers: { authorization: 'Bearer ' + token } })).status, 200);
  const stored = JSON.stringify([...h.values]);
  assert.equal(stored.includes(token), false);
  assert.equal(stored.includes(h.env.ADMIN_PASSWORD), false);
  assert.equal(JSON.stringify(h.values.get('config')).includes('sessions'), false);
  assert.equal((await h.call('/api/auth/logout', { method: 'POST', headers: { cookie } })).status, 200);
  h.restart();
  assert.equal((await h.call('/api/keys', { headers: { cookie } })).status, 401);
  assert.equal((await h.call('/api/keys', { headers: { cookie: other } })).status, 200);
});

test('server-side expiry and password rotation invalidate sessions across store restarts', async () => {
  const h = await harness();
  const cookie = cookieOf(await h.login());
  h.restart();
  assert.equal((await h.call('/api/keys', { headers: { cookie } })).status, 200);
  const realNow = Date.now;
  try {
    const then = realNow(); Date.now = () => then + 24 * 60 * 60 * 1000 + 1;
    assert.equal((await h.call('/api/keys', { headers: { cookie } })).status, 401);
  } finally { Date.now = realNow; }
  const freshCookie = cookieOf(await h.login());
  h.env.ADMIN_PASSWORD = 'replacement-password'; h.restart();
  assert.equal((await h.call('/api/keys', { headers: { cookie: freshCookie } })).status, 401);
  assert.equal((await h.login('test-password')).status, 401);
  assert.equal((await h.login()).status, 200);
});

test('login attempts persist by trusted edge IP, expire and do not lock out other clients', async () => {
  const h = await harness();
  for (let index = 0; index < 10; index++) {
    assert.equal((await h.login('wrong', '192.0.2.20')).status, 401);
    h.restart();
  }
  const limited = await h.login(h.env.ADMIN_PASSWORD, '192.0.2.20');
  assert.equal(limited.status, 429); assert.ok(Number(limited.headers.get('retry-after')) > 0);
  assert.equal(JSON.stringify(h.values.get('admin-auth-v2')).includes('192.0.2.20'), false);
  assert.equal((await h.login(h.env.ADMIN_PASSWORD, '192.0.2.21')).status, 200);
  const realNow = Date.now;
  try {
    const then = realNow(); Date.now = () => then + 15 * 60 * 1000 + 1;
    assert.equal((await h.login(h.env.ADMIN_PASSWORD, '192.0.2.20')).status, 200);
  } finally { Date.now = realNow; }
});

test('foreign origins cannot log in, revoke sessions or change management data', async () => {
  const h = await harness(), cookie = cookieOf(await h.login());
  for (const path of ['/api/auth/login', '/api/auth/logout', '/api/settings']) {
    assert.equal((await h.call(path, { method: 'POST', headers: { cookie, Origin: 'https://attacker.test' }, body: { password: h.env.ADMIN_PASSWORD, customModelMap: {} } })).status, 403);
  }
  assert.equal((await h.call('/api/keys', { headers: { cookie } })).status, 200);
});

test('every HTML page blocks injected scripts, framing and caching and uses only local assets', async () => {
  const h = await harness(), req = new Request('https://gateway.test/');
  for (const fn of [h.module.handleAdminPage, h.module.handleLandingPage, h.module.handleKVError, h.module.handlePasswordError]) {
    const response = await fn(req, h.env, {}), html = await response.text();
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-frame-options'), 'DENY');
    const policy = response.headers.get('content-security-policy');
    assert.match(policy, /script-src-attr 'none'/); assert.match(policy, /connect-src 'self'/); assert.match(policy, /frame-ancestors 'none'/);
    assert.doesNotMatch(html, /<script[^>]+src=|fonts\.google|cdn\.jsdelivr/);
    const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
    for (const [, attrs, script] of scripts) {
      const nonce = attrs.match(/nonce="([^"]+)"/)[1]; assert.ok(policy.includes("'nonce-" + nonce + "'")); new vm.Script(script);
    }
    const markup = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');
    assert.doesNotMatch(markup, /\son\w+=/);
  }
});

function uiFunction(script, from, to) {
  const start = script.indexOf(from), end = script.indexOf(to, start);
  assert.ok(start >= 0 && end > start); return script.slice(start, end);
}
function node() { return { textContent: '', style: {}, children: [], listeners: {}, classList: { add() {}, remove() {} }, appendChild(child) { this.children.push(child); }, addEventListener(name, callback) { this.listeners[name] = callback; } }; }

test('malicious key and model values stay text and copy/delete listeners retain literal arguments', async () => {
  const h = await harness(), html = await h.module.handleAdminPage(new Request('https://gateway.test/admin'), h.env, {}).text();
  const script = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(x => x[1]).find(x => x.includes('async function loadKeys()'));
  const attack = `\"><img src=x onerror=alert(1)>'\\`, key = { id: attack, name: attack, key: attack, createdAt: '2026-01-01' };
  const rows = [], calls = [], tbody = node(); tbody.appendChild = row => rows.push(row);
  const context = vm.createContext({ console, defaultMappings: {}, customMappings: {}, filterMappings() {},
    apiFetch: async path => Response.json(path === '/api/keys' ? [key] : { customModelMap: { [attack]: 'openai:' + attack } }),
    copyKeyText: value => calls.push(['key', value]), deleteKey: value => calls.push(['deleteKey', value]),
    copyModelId: value => calls.push(['model', value]), deleteMapping: value => calls.push(['deleteMapping', value]),
    document: { getElementById: id => id === 'no-key-warning' ? node() : tbody,
      createElement: () => { const row = node(); row.name = node(); row.codes = [node(), node()]; row.buttons = [node(), node()]; row.cells = [node(), node(), node()];
        row.querySelector = selector => ({ strong: row.name, code: row.codes[0], button: row.buttons[0] }[selector]);
        row.querySelectorAll = selector => ({ code: row.codes, button: row.buttons, td: row.cells }[selector]); return row; } }
  });
  vm.runInContext(uiFunction(script, 'async function loadKeys()', 'function sen('), context);
  vm.runInContext(uiFunction(script, 'async function loadSettings()', 'async function addMapping()'), context);
  await vm.runInContext('loadKeys()', context); await vm.runInContext('loadSettings()', context);
  assert.equal(rows.length, 2); assert.equal(rows[0].name.textContent, attack); assert.equal(rows[1].codes[0].textContent, attack); assert.equal(rows[1].codes[1].textContent, 'openai:' + attack);
  for (const row of rows) { assert.doesNotMatch(row.innerHTML, /onclick=|onerror=/); assert.equal(row.innerHTML.includes(attack), false); }
  rows[0].buttons.forEach(button => button.listeners.click()); rows[1].codes.forEach(code => code.listeners.click()); rows[1].buttons[0].listeners.click();
  assert.deepEqual(calls, [['key', attack], ['deleteKey', attack], ['model', attack], ['model', 'openai:' + attack], ['deleteMapping', attack]]);
});

test('toasts and permission error titles never interpret upstream messages as markup', async () => {
  const h = await harness(), attack = '<img src=x onerror=alert(1)>';
  for (const fn of [h.module.handleAdminPage, h.module.handleLandingPage]) {
    const html = await (await fn(new Request('https://gateway.test/'), h.env, {})).text();
    const script = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(x => x[1]).find(x => x.includes('function showToast('));
    const container = node(), context = vm.createContext({ document: { querySelector: () => container, createElement: node }, setTimeout() {} });
    vm.runInContext(uiFunction(script, 'function showToast(', '\n\t\tfunction '), context);
    context.attack = attack; vm.runInContext('showToast(attack)', context);
    const toast = container.children[0]; assert.equal(toast.children[0].textContent, attack); assert.equal(toast.innerHTML.includes(attack), false);
    if (script.includes('function updatePermissionStatus(')) {
      const element = node(); element.firstElementChild = node();
      const permissionContext = vm.createContext({ document: { getElementById: () => element }, attack });
      vm.runInContext(uiFunction(script, 'function updatePermissionStatus(', 'function escapeHtml('), permissionContext);
      vm.runInContext('updatePermissionStatus("permission", { error: attack })', permissionContext);
      assert.equal(element.firstElementChild.title, attack); assert.equal(element.innerHTML.includes(attack), false);
    }
  }
});

test('account cards and both public and private legends escape attacker-controlled values', async () => {
  const h = await harness(), attack = '\"><svg onload=alert(1)>', cards = [], elements = new Map();
  const html = await h.module.handleAdminPage(new Request('https://gateway.test/admin'), h.env, {}).text();
  const script = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(x => x[1]).find(x => x.includes('function renderUsageDetails('));
  const element = id => { if (!elements.has(id)) elements.set(id, node()); return elements.get(id); };
  element('accounts-usage-list').querySelectorAll = () => [];
  element('accounts-usage-list').appendChild = item => cards.push(item);
  const context = vm.createContext({ console, renderHistoryChart() {}, renderModelsChart() {}, document: {
    getElementById: element, createElement() { const item = node(); item.dataset = {}; return item; }
  }, data: [{ id: 'account', name: attack, accountId: attack, usageToday: 5, error: attack, status: 'error' }] });
  vm.runInContext(uiFunction(script, 'function escapeHtml(', 'function setAlertStyle('), context);
  vm.runInContext(uiFunction(script, 'function renderUsageDetails(', 'let isRefreshingUsage'), context);
  vm.runInContext('renderUsageDetails(data)', context);
  assert.equal(cards.length, 1); assert.doesNotMatch(cards[0].innerHTML, /<svg|<img/); assert.match(cards[0].innerHTML, /&lt;svg/);

  for (const fn of [h.module.handleAdminPage, h.module.handleLandingPage]) {
    const page = await (await fn(new Request('https://gateway.test/'), h.env, {})).text();
    const text = [...page.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(x => x[1]).find(x => x.includes('function showToast('));
    const isAdmin = text.includes('function renderModelsChart('), nodes = new Map();
    const getElementById = id => { if (!nodes.has(id)) { const el = node(); el.getContext = () => ({}); nodes.set(id, el); } return nodes.get(id); };
    const legend = getElementById(isAdmin ? 'admin-chart-legend' : 'public-chart-legend');
    const sandbox = vm.createContext({ modelsChart: null, publicModelsChartInstance: null, lastPublicSummaryData: null,
      Chart: class { destroy() {} }, setTimeout() {}, animateNumber() {}, attack,
      document: { getElementById, documentElement: { getAttribute: () => 'dark' }, createElement() { const el = node(); el.children = [node(), node(), node()]; return el; } }
    });
    vm.runInContext(isAdmin ? uiFunction(text, 'function renderModelsChart(', 'async function copyEndpointUrl(') : uiFunction(text, 'function renderPublicSummary(', 'async function submitLogin('), sandbox);
    vm.runInContext(isAdmin ? 'renderModelsChart([attack], [5])' : 'renderPublicSummary({ usagePercentage: 1, totalNeuronsToday: 5, totalLimit: 10000, modelsToday: [{ model: attack, neurons: 5 }] })', sandbox);
    const item = legend.children[0]; assert.ok(item); assert.equal(item.children[1].textContent, attack); assert.equal(item.children[1].title, attack); assert.equal(item.innerHTML.includes(attack), false);
  }
});

test('connection tests ignore duplicate clicks until the first request completes', async () => {
  const h = await harness(), html = await h.module.handleAdminPage(new Request('https://gateway.test/admin'), h.env, {}).text();
  const script = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(x => x[1]).find(x => x.includes('async function testConnection('));
  let resolve, count = 0; const pending = new Promise(done => { resolve = done; }), nodes = new Map();
  const context = vm.createContext({ readAccountForm: () => ({}), setAlertStyle() {}, showToast() {}, escapeHtml: String,
    ALERT_ICONS: { spinner: '', check: '' }, apiFetch: () => { count++; return pending; },
    document: { getElementById(id) { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); } }
  });
  vm.runInContext(uiFunction(script, 'let connectionTestInFlight', 'async function saveAccount('), context);
  const first = vm.runInContext('testConnection()', context); await vm.runInContext('testConnection()', context);
  assert.equal(count, 1); assert.equal(nodes.get('btn-test-conn').disabled, true);
  resolve(Response.json({ success: true })); await first;
  assert.equal(nodes.get('btn-test-conn').disabled, false);
});
