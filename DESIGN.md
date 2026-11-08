---
version: 1.0.0
name: ModelBridge Primer Design System
description: 面向边缘多源 LLM 路由与模型网关（modelbridge）的 Primer 设计系统规范。与 CloudForge 同色系同风格，基于 GitHub Primer 功能原语定义公共 API 门户页、多供应商账号池管理后台（Cloudflare / OpenAI / Anthropic / Gemini / OAuth）以及四态错误诊断页的视觉与交互契约。
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

# ModelBridge Primer 设计系统规范 (`DESIGN.md`)

本文档是 [`modelbridge`](file:///D:/Projects/CyberNova2333/git-repos/modelbridge) 的设计系统规范，与 [`cloudforge/DESIGN.md`](file:///D:/Projects/CyberNova2333/git-repos/cloudforge/DESIGN.md) 保持**同色系同风格（GitHub Primer Functional Design System）**，指导 [`_worker.js`](file:///D:/Projects/CyberNova2333/git-repos/modelbridge/_worker.js) 内嵌的四个核心 Web 视图（公共门户 `handleLandingPage`、管理后台 `handleAdminPage`、存储未绑定诊断页 `handleKVError`、密码未配置诊断页 `handlePasswordError`）的样式与交互实现。

---

## Overview

1. **Productive Complexity（高密度网关可观测性）**：ModelBridge 管理多协议（OpenAI `/v1/chat/completions`、Anthropic `/v1/messages`、Gemini `/v1beta`）、多上游供应商账号池与模型别名映射。通过 `14px` 正文锚点、`12px` 等宽端点/模型 ID、Primer `Box`（`1px solid` 边框 + `6px` 圆角）与紧凑表格呈现高密度运维信息。
2. **Strict Nonce CSP & Self-Contained Safety（严格 CSP 与自包含安全）**：所有内联 `<style>` 与 `<script>` 必须绑定单次请求生成的 `nonce="${nonce}"`，零外部 CDN 依赖；已保存的上游凭据在表格与编辑态中一律掩码为 `********`。
3. **Pragmatic Visuals（务实视觉）**：使用 `canvas.inset`（`#f6f8fa` Light / `#010409` Dark）作为顶栏与管理侧边栏底色，`canvas.default`（`#ffffff` / `#0d1117`）作为主工作区与 `Box` 底色，`canvas.subtle`（`#f6f8fa` / `#161b22`）作为表头与卡片头部底色。拒绝廉价渐变、发光阴影与悬浮位移。
4. **Consistency through Primitives（原语驱动的一致性）**：Light 与 Dark 双模式通过切换根级 Primer 功能变量实现无缝过渡。

---

## Colors

### W3C `$value/$type` Token 注册表

| Primer 功能 Token | `_worker.js` 变量映射 | Light `$value` | Dark `$value` | 用途与组件绑定 |
| :--- | :--- | :--- | :--- | :--- |
| `accent.fg` | `--accent-color` | `#0969da` | `#2f81f7` | 端点链接、激活侧栏导航、焦点环、复制高亮 |
| `accent.emphasis` | `--btn-primary-bg` | `#0969da` | `#1f6feb` | Primary 主按钮填充（保存配置、新增账号、登录） |
| `accent.subtle` | `--accent-subtle` | `#ddf4ff` | `rgba(56,139,253,0.15)` | 激活导航项背景、代码块协议徽章底色 |
| `canvas.default` | `--bg-canvas` / `--bg-card` | `#ffffff` | `#0d1117` | 主工作区画布、`.stat-card` 与 `.section-card` `Box` 主体底色 |
| `canvas.inset` | `--bg-inset` | `#f6f8fa` | `#010409` | 顶部栏（`.site-header`）、管理后台左侧导航栏（`aside`）、代码块底色 |
| `canvas.subtle` | `--bg-subtle` / `--bg-table-head` | `#f6f8fa` | `#161b22` | `Box` 头部、表格 `<thead>`、次要按钮与列表项底色 |
| `fg.default` | `--text-main` | `#1f2328` | `#f0f6fc` | 标题、表格主数据、表单输入文字 |
| `fg.muted` | `--text-muted` | `#57606a` | `#8b949e` | 辅助说明、表头列名、字段提示、页脚 |
| `border.default` | `--border-color` | `#d0d7de` | `#30363d` | 所有 `.stat-card`、`.section-card`、`.error-card`、输入框与按钮的 `1px solid` 边框 |
| `border.muted` | `--border-muted` | `#d8dee4` | `#21262d` | 表格行间分隔线、列表项内部分隔线 |
| `success.fg` | `--color-success` | `#1a7f37` | `#3fb950` | 账号 `active` 状态徽章、服务在线圆点、测试连接通过 |
| `attention.fg` | `--color-warning` | `#9a6700` | `#d29922` | 额度预警、配置未初始化提示横幅 |
| `danger.fg` | `--color-danger` | `#cf222e` | `#f85149` | 账号异常/禁用、删除按钮、500/503 错误诊断页状态标示 |

---

## Typography & Layout

1. **字阶体系**：
   - `body` 强制为 **`14px`**（`line-height: 1.5`）；页面主标题 `20px`（`font-weight: 600`）；区块标题 `16px`（`font-weight: 600`）；端点路径、模型 ID、API 密钥掩码与 JSON 示例统一使用 **`12px`** 等宽字体（`--font-mono`）与 `font-variant-numeric: tabular-nums`。
2. **Primer `Box` 与双栏管理壳层**：
   - **公共门户页（`/`）**：顶部 `canvas.inset` 导航栏 + `1200px` 居中主容器，包含网关概览 `Box`、三协议快速接入示例 `Box` 与实时可用模型检索表 `Box`。
   - **管理控制台（`/admin`）**：左侧 `240px` `canvas.inset` 垂直导航轨（`aside`，`border-right: 1px solid var(--border-color)`）+ 右侧 `canvas.default` 滚动工作区，所有数据块均封装在 `6px` 圆角、`1px solid var(--border-color)` 的 `.section-card` / `.stat-card` 中。
   - **错误诊断视图（`handleKVError` / `handlePasswordError`）**：居中 `640px` Primer `Box` 诊断卡，顶部带语义状态条与等宽配置指引步骤。

---

## Do's and Don'ts

- ✅ **Do**：所有卡片、表格、按钮与输入框使用 `1px solid var(--border-color)` 与 `6px` 圆角；状态徽章使用 `9999px` 胶囊圆角。
- ❌ **Don't**：严禁在 `:root` 中将画布或正文设为蓝色，严禁追加冲突的覆盖 `<style>` 块，严禁破坏 `_worker.js` 的 CSP `nonce` 或 DOM ID 契约。
