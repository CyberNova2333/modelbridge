---
title: FAQ & Troubleshooting
description: Frequently asked questions and routing diagnostics for ModelBridge.
---

::: warning AI Translation Notice
This document was translated by an AI language model. In case of any discrepancies or ambiguities, please refer to the [original Chinese documentation](/docs/faq) as the authoritative reference.
:::

# FAQ & Troubleshooting

Common questions and answers regarding daily usage and integration:

### Q: How does ModelBridge decide when to trigger failover?

**A**: When an upstream returns a 429 (rate limited), 5xx server error, or times out, ModelBridge instantly redirects the request to the next healthy provider in the priority chain.

### Q: Can I log and inspect token usage across all providers?

**A**: Yes. ModelBridge normalizes usage metrics (prompt tokens, completion tokens) across all vendors into a standard telemetry format.


---

## General Troubleshooting Steps

1. **Verify Runtime Versions**: Ensure Node.js, Python, Rust, or browser versions meet minimum compatibility requirements.
2. **Check Diagnostic Logs**: Review console output and error logs for informative stack traces and line numbers.
3. **Submit Issue Feedback**: If you discover an underlying bug, please open an issue on the GitHub repository with a reproducible test case.
