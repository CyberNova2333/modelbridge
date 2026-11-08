---
title: 配置与使用指南
description: ModelBridge 适配总线 的参数配置详解、典型使用场景与最佳实践
---

# 配置与使用指南

### 适配器矩阵支持列表

| 平台 (Platform) | 驱动模块 | 支持模型类型 |
| :--- | :--- | :--- |
| **Cloudflare Workers** | `@modelbridge/adapter-cf` | Llama 3, DeepSeek, Mistral |
| **Tencent EdgeOne** | `@modelbridge/adapter-eo` | 混元大模型、通用文本嵌入 |
| **Alibaba ESA** | `@modelbridge/adapter-esa` | 通义千问系列、代码模型 |
| **Self-Hosted** | `@modelbridge/adapter-node` | 任意兼容 OpenAI 规范的本地私有模型 |

---

## 生产部署建议

1. **环境变量保护**：切勿将包含真实密钥或 Token 的配置提交至版本库；
2. **优雅停机与超时**：建议将关键长任务的超时时限设置为合理范围，避免僵尸进程驻留；
3. **日志监控**：结合控制台输出建立定期检查机制，捕获潜在异常。
