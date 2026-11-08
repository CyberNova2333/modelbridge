---
title: 快速入门
description: ModelBridge 是一套用于抹平各大云厂商与边缘运行时差异的**跨平台边缘 AI 模型调用抽象总线**。
---

# 快速入门

ModelBridge 是一套用于抹平各大云厂商与边缘运行时差异的**跨平台边缘 AI 模型调用抽象总线**。

## 解决的核心痛点

- **痛点 1**：Cloudflare Workers AI、腾讯 EdgeOne、阿里 ESA 等平台的 AI 接口协议互不兼容
- **痛点 2**：业务系统为了多云容灾需要编写大量适配与降级胶水代码
- **痛点 3**：无法在本地 Node.js 或测试环境中模拟真实的边缘平台调用

---

## 环境准备

Node.js 20+，pnpm 12.6.0。

---

## 快速安装与运行

```bash
# 1. 安装依赖
pnpm install

# 2. 运行跨平台适配契约测试
pnpm test

# 3. 示例：使用统一接口发起推理
import { ModelBridge } from 'modelbridge';

const bridge = new ModelBridge({ provider: 'cloudflare' });
const res = await bridge.chat({
  messages: [{ role: 'user', content: '你好！' }]
});
```

---

## 接下来探索

- 深入了解系统内部流转：查阅 [系统架构与设计](/docs/architecture)
- 探索全部配置参数与高级场景：查阅 [配置与使用指南](/docs/configuration)
- 遇到问题排错：查阅 [常见问题与排错](/docs/faq)
