---
version: 2.0.0
name: ModelBridge Primer Tactile Design System
description: 面向边缘多源 LLM 路由与模型网关（modelbridge）的 Primer 质感设计系统规范。基于 GitHub Primer 功能原语与服务器刀片插槽物理质感，定义公共 API 门户页、多供应商账号池管理后台（Cloudflare / OpenAI / Anthropic / Gemini / OAuth）、流式响应遥测与四态错误诊断页的物理交互契约。
colors:
  primary: '#0969da'
  accent-fg: '#0969da'
  accent-emphasis: '#0969da'
  accent-subtle: '#ddf4ff'
  accent-dark-fg: '#2f81f7'
  canvas-default: '#ffffff'
  canvas-overlay: '#ffffff'
  canvas-inset: '#f6f8fa'
  canvas-subtle: '#f6f8fa'
  canvas-dark-default: '#0d1117'
  canvas-dark-overlay: '#161b22'
  canvas-dark-inset: '#010409'
  canvas-dark-subtle: '#161b22'
  fg-default: '#1f2328'
  fg-muted: '#57606a'
  fg-on-emphasis: '#ffffff'
  fg-dark-default: '#f0f6fc'
  fg-dark-muted: '#8b949e'
  border-default: '#d0d7de'
  border-muted: '#d8dee4'
  border-subtle: '#e1e4e8'
  border-dark-default: '#30363d'
  border-dark-muted: '#21262d'
  success-fg: '#1a7f37'
  success-emphasis: '#1f883d'
  success-subtle: '#dafbe1'
  success-dark-fg: '#3fb950'
  danger-fg: '#cf222e'
  danger-emphasis: '#cf222e'
  danger-subtle: '#ffebe9'
  danger-dark-fg: '#f85149'
  attention-fg: '#9a6700'
  attention-subtle: '#fff8c5'
  attention-dark-fg: '#d29922'
  done-fg: '#8250df'
  done-subtle: '#fbefff'
  done-dark-fg: '#a371f7'
typography:
  body-md:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif"
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: 0px
  body-sm:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif"
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: 0px
  ui-label:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif"
    fontSize: 14px
    fontWeight: 600
    lineHeight: 1.4285
    letterSpacing: 0px
  heading-page:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif"
    fontSize: 20px
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: -0.2px
  heading-section:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif"
    fontSize: 16px
    fontWeight: 600
    lineHeight: 1.5
    letterSpacing: 0px
  code-inline:
    fontFamily: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', 'IBM Plex Mono', monospace"
    fontSize: 12px
    fontWeight: 500
    lineHeight: 1.5
    letterSpacing: 0px
rounded:
  none: 0px
  sm: 3px
  md: 6px
  lg: 12px
  pill: 9999px
spacing:
  none: 0px
  xxs: 4px
  xs: 8px
  sm: 12px
  md: 16px
  lg: 24px
  xl: 32px
components:
  gateway-header:
    backgroundColor: '{colors.canvas-inset}'
    textColor: '{colors.fg-default}'
    typography: '{typography.heading-section}'
    rounded: '{rounded.none}'
    padding: '{spacing.md}'
  section-box:
    backgroundColor: '{colors.canvas-default}'
    textColor: '{colors.fg-default}'
    typography: '{typography.body-md}'
    rounded: '{rounded.md}'
    padding: '{spacing.md}'
  stat-box:
    backgroundColor: '{colors.canvas-default}'
    textColor: '{colors.fg-default}'
    typography: '{typography.body-md}'
    rounded: '{rounded.md}'
    padding: '{spacing.md}'
  provider-badge-active:
    backgroundColor: '{colors.success-subtle}'
    textColor: '{colors.success-fg}'
    typography: '{typography.body-sm}'
    rounded: '{rounded.pill}'
    padding: '{spacing.xxs}'
---

# ModelBridge 质感设计系统规范 (`DESIGN.md`)

本文档是 [`modelbridge`](file:///D:/Projects/CyberNova2333/git-repos/modelbridge) 的设计系统规范。针对边缘多源大模型中继、上游供应商账号池管理与流式可观测性，基于 GitHub Primer 功能原语融合**模型中继矩阵与服务器刀片物理质感（Model Transit Matrix & Server Blade Tactile Materiality）**，定义网关控制台与遥测面板的物理交互规范。

---

## 1. 核心设计哲学与物理质感

1. **服务器刀片插槽质感（Blade Slot Materiality）**：
   - 供应商账号卡片（`.stat-card` / 供应商池表格）呈现模块化机箱插槽视觉：`1px solid var(--border-color)` 物理边框、顶边缘斜角反光（`box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08), 0 1px 3px rgba(1, 4, 9, 0.4)`）。
   - 账号激活状态胶囊带有物理凹凸感，模拟插槽锁定拉手与接触点。
2. **流式数据脉冲遥测（Stream Pulse Respiration）**：
   - SSE 流式活动指示灯（`.pulse-indicator`）具备物理 LED 呼吸光晕与微透镜效果（微扩散半径 `0 0 8px rgba(63, 185, 80, 0.4)`），提供直观的数据流吞吐律动。
   - 响应延迟仪表条采用物理凹槽导轨设计，呈现拉丝金属质感底槽。
3. **触觉开关与微按压反馈（Tactile Kinematics）**：
   - 所有按钮与测试连接控件具备物理按压三态反馈（`:hover` `translateY(-0.5px)`，`:active` `translateY(0.5px) scale(0.99)` + `inset 0 2px 4px rgba(0, 0, 0, 0.25)`）。

---

## 2. 调色板与语义 Token

### 2.1 W3C `$value/$type` Token 注册表

| Primer 功能 Token | `_worker.js` 变量映射 | Light `$value` | Dark `$value` | 物理映射与用途 |
| :--- | :--- | :--- | :--- | :--- |
| `accent.fg` | `--accent-color` | `#0969da` | `#2f81f7` | 协议端点链接、选中的供应商 Tab、2px 物理焦点环 |
| `accent.emphasis` | `--btn-primary-bg` | `#0969da` | `#1f6feb` | Primary 主按钮填充（保存配置、新增账号） |
| `accent.subtle` | `--accent-subtle` | `#ddf4ff` | `rgba(56,139,253,0.15)` | 协议胶囊底色、活跃数据流高亮 |
| `canvas.default` | `--bg-canvas` / `--bg-card` | `#ffffff` | `#0d1117` | 主工作区底色、插槽卡片表面 |
| `canvas.inset` | `--bg-inset` | `#f6f8fa` | `#010409` | 顶栏机箱底座、侧边导轨底色、代码块内凹槽 |
| `canvas.subtle` | `--bg-subtle` / `--bg-table-head` | `#f6f8fa` | `#161b22` | 卡片表头、次要按钮底板 |
| `fg.default` | `--text-main` | `#1f2328` | `#f0f6fc` | 主要端点数据、配置文本 |
| `fg.muted` | `--text-muted` | `#57606a` | `#8b949e` | 字段说明、毫秒延迟、Token 统计计数 |
| `border.default` | `--border-color` | `#d0d7de` | `#30363d` | 容器物理边框（1px solid） |
| `success.fg` | `--color-success` | `#1a7f37` | `#3fb950` | 正常在线 LED 灯、流式数据通道畅通 |
| `attention.fg` | `--color-warning` | `#9a6700` | `#d29922` | 速率限制、余额预警指示灯 |
| `danger.fg` | `--color-danger` | `#cf222e` | `#f85149` | 认证失效、上游 5xx 故障红灯 |

---

## 3. 字体栈与空间规范

- **系统排版字体栈（`--font-sans`）**：`-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif`
- **等宽数据字体栈（`--font-mono`）**：`ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', 'IBM Plex Mono', monospace`
- **基准字阶**：全局正文 `14px`，卡片标题 `16px`，端点路径、密钥掩码与 JSON 载荷统一使用 `12px` 等宽字体与 `font-variant-numeric: tabular-nums`。

---

## 4. 核心组件与安全约束

1. **CSP Nonce 契约**：所有内联样式与脚本必须严格附带请求一次性 `nonce="${nonce}"`，不引入任何未授权外部资产。
2. **凭据物理掩码**：API Key 等敏感资产在界面与表格中强制展示为固定长度掩码 `********`，防止截屏泄露。
3. **错误诊断卡（Error Diagnostics）**：KV 未绑定或密码未配置时展示居中 `640px` 物理诊断卡，具备物理边框、等宽错误码与修复步骤提示。
