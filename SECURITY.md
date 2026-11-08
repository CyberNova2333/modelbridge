# 安全说明 / Security

## 网关问题报告 / Gateway vulnerability reports

先核对 [凭据与配置边界](repo-docs/modules/access-and-config.md) 和 [上游与配额边界](repo-docs/modules/upstream-and-quota.md)。私下报告时提供受影响的路由与客户端协议、上游类型、普通或流式响应、触发条件、预期和实际行为，以及可公开的最小复现。用占位值替换管理员密码、调用密钥、上游 Token、OAuth 凭据和私有配置；不要直接附上管理配置导出或完整请求日志。

Review the credential, configuration, upstream and quota boundaries in the linked guide pages. In a private report, include the affected route and client protocol, upstream type, JSON or streaming response, trigger, expected and actual behavior, and a minimal public-safe reproduction. Replace administrator passwords, client keys, upstream tokens, OAuth credentials and private configuration with placeholders. Do not attach raw configuration exports or complete request logs.

多平台部署额外使用 `MODELBRIDGE_STATE_TOKEN` 访问完整配置及会话操作。该 Bearer 服务凭据具有 DO binding 等价权限，只能保存在获授权网关与状态服务的运行时 Secret 中；精确 origin 限制不能防止已窃取令牌被重放。泄露时轮换该令牌并核查上游凭据和配置操作，不能仅删除浏览器会话。状态服务默认关闭持久化请求日志，平台访问日志的查询参数脱敏仍须单独确认。详见[平台信任边界](repo-docs/modules/platform-adapters.md)。

Multi-platform deployments add a binding-equivalent service credential, `MODELBRIDGE_STATE_TOKEN`, which can read complete configuration and perform session operations. Keep it only in authorized server-side Secrets. Exact origin restrictions do not prevent replay of a stolen Bearer token. Rotate an exposed service token and review upstream credentials and configuration changes; clearing browser sessions alone is insufficient. State-service persistent request logs are disabled by default; separately verify URL-query redaction on each hosting platform.

自建状态服务的 SQLite、WAL、配置导出及备份包含上游凭据和调用密钥，不自带静态加密。使用受限文件权限、磁盘加密及受控备份；Windows 另设服务账号 ACL。HTTP 监听默认只在回环地址，公网必须经 HTTPS 反代；固定 public origin 不代表内网链路自动加密。切换权威或恢复旧备份前停止旧写入并核对期间撤销，避免恢复已失效的访问权；导入工具只接受空库，不自动回退到 DO、KV 或备份。新库导入不复制旧会话和用量缓存。

Self-hosted SQLite files, WAL files, configuration exports and backups contain upstream credentials and gateway keys without built-in encryption at rest. Restrict filesystem access, use disk encryption and protect backups; configure service-account ACLs on Windows. The default HTTP listener is loopback-only and public access requires an HTTPS reverse proxy. Before authority cutover or restoring an older backup, stop old writers and reconcile revocations. Imports require an empty database and omit old sessions and usage caches; no backend or backup fallback is automatic.

依赖报告应注明实际锁文件、Node 内嵌组件版本或镜像 digest，以及受影响代码在网关、代理、文档构建或 CLI 中的调用条件。当前 Caddy 模板限制为 HTTPS/HTTP 1.1，以缓解所审计 Go HTTP/2 漏洞；不代表镜像所有 CVE 已修复。CLI 安装禁用生命周期脚本并保留当次解析锁文件，但仍执行第三方程序，不是系统沙箱。文档站审计不能覆盖容器或工具链，范围与未消除告警见[依赖审计说明](repo-docs/modules/platform-adapters.md#怎样读取依赖审计结果)及[审查记录](repo-docs/change-log.md)。

Dependency reports should identify the resolved lockfile, embedded runtime versions or image digest, and the affected call path. The Caddy template uses HTTPS with HTTP/1.1 to mitigate the reviewed Go HTTP/2 issues; this does not fix every image CVE. CLI installation disables lifecycle scripts and retains each run's resolved lockfile, but executing a CLI still runs third-party code. A clean documentation-site audit does not cover containers or maintenance tools; see the linked scope and review records.

<!-- repo-maintenance:begin -->
## 本地提交与推送检查 / Local commit and push checks

安全钩子只在本机运行。`pre-commit` 检查即将提交的 Git 暂存对象；`commit-msg` 检查标题与信息中的常见凭证形态；`pre-push` 按 Git 提供的引用范围检查新增历史，包含最终版本已经删除的中间提交。不会向外上传源码或扫描结果，也不会自动修改文件。

The hooks run offline. They scan staged objects, commit messages and the commits introduced by a push, including intermediate commits. They do not upload source or results and do not modify application files.

检查覆盖私钥头、常见服务令牌、真实环境配置路径、敏感凭据文件名与本机设计文稿文件名。环境模板可以提交；真实配置、私钥和开发者本机文稿应留在版本控制之外。诊断只显示规则、路径和行号，不回显疑似凭证。超过 8 MiB 的对象只检查路径并明确提示未扫描内容；大型资产继续遵循原有 Git LFS 和专用检查规则。此检查不能识别所有凭证形态，也不替代代码审查、依赖审计和项目已有安全钩子。

Coverage includes private-key headers, common token formats and sensitive paths. Keep real local configuration, private keys and local-only design manuscripts out of version control. Diagnostics show rule identifiers and locations, never the matched value. Blobs larger than 8 MiB receive path checks and an explicit content-scan notice; retain existing LFS and asset checks. These checks do not detect every secret and do not replace review, dependency audits or existing protections.

确认为可公开测试夹具的内容，可以在 `.repo-security-allowlist.json` 登记仓库相对路径、文件完整内容的 `sha256` 和解释用途的 `reason`。不支持通配符；内容变化后必须重新审阅。例外须和文件一起暂存；推送时按每条提交里的例外清单检查，未暂存的工作区清单不能放宽规则。撤销例外或变更其哈希时，即使文件内容不变也会重新检查。历史扫描使用批量 Git 对象读取和有界缓存；缓存按路径、对象和该提交的精确例外隔离，每条新增提交及其中间版本仍在范围内。

Public test fixtures may be reviewed using an exact-path, exact-content SHA-256 entry with a reason in `.repo-security-allowlist.json`. Wildcards are unsupported. Stage the exception with the fixture. The check reads exceptions from the index or the relevant pushed commit, never from unstaged working files. Revoking an exception or changing its hash rechecks even unchanged file content. History scanning uses batched Git objects and a bounded cache keyed by path, object and the commit's exact exception; every introduced commit and intermediate version remains in scope.

```json
{
  "tests/fixtures/public-example.txt": {
    "sha256": "<64 lowercase hexadecimal characters>",
    "reason": "Reviewed public fixture; explain why no credential is usable"
  }
}
```

发现泄露时先撤销或轮换凭据，再评估受影响的历史、制品和日志；删除最新文件无法撤回旧提交。报告只包含必要的复现步骤、影响范围和脱敏位置。使用仓库已有私密联系渠道向维护者报告；未配置私密渠道时先私下建立联系，不在公开 Issue 中粘贴凭证、私密数据或可直接利用的细节。

Revoke or rotate exposed credentials first, then assess history, artifacts and logs. Removing the latest file does not remove older commits. Use an existing private reporting channel; establish a private contact if none is documented, and keep credentials and private data out of public issues.
<!-- repo-maintenance:end -->
