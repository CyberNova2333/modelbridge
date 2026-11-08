---
title: Configuration Guide
description: Provider configurations, priority weighting, and fallback pipelines.
---

::: warning AI Translation Notice
This document was translated by an AI language model. In case of any discrepancies or ambiguities, please refer to the [original Chinese documentation](/docs/configuration) as the authoritative reference.
:::

# Configuration Guide

### Primary Configuration

```json
{
  "providers": [
    { "id": "openai-primary", "type": "openai", "priority": 1 },
    { "id": "anthropic-backup", "type": "anthropic", "priority": 2 },
    { "id": "gemini-fallback", "type": "gemini", "priority": 3 }
  ],
  "routing": {
    "strategy": "priority-failover",
    "timeout_ms": 15000
  }
}
```

---

## Production Recommendations

1. **Environment Variable Protection**: Never commit real API keys or sensitive credentials into Git repositories.
2. **Graceful Shutdown & Timeouts**: Set appropriate timeout constraints on long-running processes to prevent orphan executions.
3. **Continuous Monitoring**: Combine console logs and health telemetry to monitor service uptime and operational status.
