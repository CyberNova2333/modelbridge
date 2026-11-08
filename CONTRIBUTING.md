# 贡献指南 / Contributing

本项目按 [GPL-3.0-only](LICENSE) 分发，贡献内容应与该许可兼容；保留上游及第三方版权与许可声明，来源记录见 [NOTICE](NOTICE)。

This project is distributed under GPL-3.0-only. Contributions must be compatible with that license; retain upstream and third-party notices as documented in NOTICE.

修复一个协议问题时，先用模拟上游复现，再修改对应适配逻辑，补齐回归断言和指南，最后在提交说明里写清实际验证与兼容边界。先读 [Agent 操作约束](AGENTS.md)、[项目指南](repo-docs/README.md) 和 [安全说明](SECURITY.md)；改动位置从 [代码地图](repo-docs/code-map.md) 查找。

For a protocol fix, reproduce the failure with a mocked upstream, change the adapter, add regression assertions, and update the guide. State the checks actually run and the compatibility boundary in the commit message. Read the instructions, living guide and security policy first; use the code map to locate the responsible code.

## 改动与验证 / Changes and verification

| 改动 / Change | 验证入口 / Verification |
| --- | --- |
| Worker 行为 / Worker behavior | `node --check _worker.js`；`node --test tests/*.test.mjs` |
| 平台适配与部署产物 / Platform adapters and deployment artifacts | `npm run check`；`npm run build`；完整回归 / full regression suite。真实平台验收单列 / report real platform acceptance separately |
| 自建状态、迁移与备份 / Self-hosted state, migration and backup | `node --test tests/sqlite-state.test.mjs tests/self-hosted-server.test.mjs tests/self-hosted-platforms.test.mjs tests/state-admin.test.mjs`；磁盘恢复、TLS 和云端验收另列 / separately verify deployment storage, recovery, TLS and cloud behavior |
| 部署验收工具 / Deployment verification tools | 显式运行 `npm run verify:container`、`npm run verify:tls -- --state-image <image>`、`npm run verify:edge-builds`；需要 Docker/厂商 CLI，不在默认回归中下载或启动 / opt-in Docker and CLI checks, separate from default regression |
| 文档内容 / Documentation content | 核对源码、链接与示例；`npm --prefix docs-site run docs:build` / Check source, links and examples; build the documentation site |
| 文档站配置与依赖 / Documentation site configuration and dependencies | `npm --prefix docs-site audit --audit-level=moderate`；`npm --prefix docs-site run test:smoke`；文档站构建 / site build |
| 提交护栏 / Maintenance guard | `node --test tests/repo-maintenance-guard.test.mjs`；核对下文安装状态 / inspect the installation status below |

业务回归需要 Node.js 24+、Python 3.10+ 和 Git，不需要根目录 npm 依赖，使用模拟上游和临时 Git 仓库。首次构建文档站先运行 `npm --prefix docs-site ci`。文档站烟测自行启动临时本地开发服务器；不要改动现有运行服务来检查文档。模拟测试、真实账号权限、持久化与生产验收分别报告，不用一次聊天成功代表所有协议兼容。

Regression tests require Node.js 24+, Python 3.10+ and Git, with no root npm install. They use mocked upstreams and temporary Git repositories. Run `npm --prefix docs-site ci` before the first documentation build. The site smoke test starts its own temporary local development server; do not change an existing service to validate documentation. Report mocked tests, real account permissions, persistence and production acceptance separately.

用户可见的输入、输出或拒绝条件变化，同步主走读和对应概念页；责任位置变化，同步代码地图；有意义的指南调整记入 `repo-docs/change-log.md`，附实际验证和 `Synced through <sha>`。保留未提交工作；发布、推送与部署按 [AGENTS.md](AGENTS.md) 取得明确授权。

Update the walkthrough and owning concept page for input, output or rejection changes, and the code map for responsibility changes. Record meaningful guide updates with their actual verification and a sync anchor. Preserve uncommitted work; publishing, pushing and deploying require explicit authorization.

<!-- repo-maintenance:begin -->
## Commit Message

本项目采用 `type(scope): 中文描述`，用行为说明结果，例如 `fix(protocol): 保留工具调用的严格约束`。标题不超过 100 个字符；细节移到正文。一次提交对应一个可审阅主题，不把格式整理、业务修复与部署结果混写成同一件事。

Use `type(scope): Chinese description`, describing the resulting behavior. Keep the subject within 100 characters and put details in the body. Keep each commit focused on one reviewable topic; distinguish formatting, application changes and deployment results.

| 字段 / Field | 约定 / Convention |
| --- | --- |
| `type` | `feat` 新能力；`fix` 修复；`docs` 文档；`style` 不改变行为的样式或格式；`refactor` 重构；`perf` 性能；`test` 测试；`build` 构建与依赖；`ci` 流水线；`chore` 维护；`revert` 撤销；`data` 数据 |
| `scope` | 按责任选择，如 `gateway`、`auth`、`config`、`protocol`、`upstream`、`embeddings`、`admin`、`docs`、`guard`、`ci`；不要为单个函数不断新增范围 / choose a stable responsibility |
| `!` | 确有不兼容变化时使用，并在正文解释迁移影响 / reserve for a breaking change and explain migration |

正文按需要说明原因、最终行为、兼容性或配额影响、实际验证、文档位置和发布状态。验证要注明真实命令与结果；未运行、仅模拟或未部署时直接写明。不要推测作者、参与者或签名身份；署名尾注和签名遵守实际参与情况、现有配置与更严格的上级约定。

Use the body to explain the reason, resulting behavior, compatibility or quota impact, actual checks, documentation and release status where relevant. Name real commands and results; explicitly identify unrun checks, mocked coverage and undeployed changes. Attribute real participants and retain the configured signing identity and any stricter parent requirements.

以下是待填写的示例，尖括号内容必须换成实际结果后再使用：

This is a template; replace the bracketed fields with actual evidence before use:

```text
fix(protocol): 保留工具调用的严格约束

原因与变化：<触发条件、原行为和修复后的行为>
兼容性与资源影响：<是否改变请求约束、重试或配额消耗>
验证：<实际执行的命令、结果和未验证边界>
文档：<同步的页面，或无需改动的原因>
发布状态：<是否提交、推送或部署；仅填写已核实的结果>
```

补充护栏实际接受可省略的 `scope`、上述类型和 `!`；范围只能含 ASCII 字母、数字、`_`、`.`、`/`、`-`。Git 自动生成的 `Merge `、`Revert `、`fixup! `、`squash! ` 标题免格式与长度检查；消息内容仍检查常见凭证形态。护栏不检查中文、参与者尾注或签名，因此通过护栏不等于符合全部项目约定。

The supplementary guard permits an omitted scope, the types above and `!`. Scope characters are ASCII letters, digits, `_`, `.`, `/` and `-`. Git-generated subjects beginning with `Merge `, `Revert `, `fixup! ` or `squash! ` are exempt from format and length checks, but message content is still scanned for common credentials. The guard does not enforce Chinese text, attribution trailers or signatures; passing it does not establish full policy compliance.

## 本地钩子 / Local hooks

新克隆安装一次，已有克隆先查状态：

Install once in a fresh clone; inspect an existing clone first:

```sh
python tools/repo_maintenance_guard.py status
python tools/repo_maintenance_guard.py install
```

安装只修改当前克隆的 Git 配置和仓库内钩子，保留已有钩子与自定义提交模板。默认模板是 [`.gitmessage.txt`](.gitmessage.txt)。钩子需要 Python 3.10+ 和 Git；检查无法完成时阻止操作。手动运行 `python tools/repo_maintenance_guard.py pre-commit` 只检查暂存对象，没有暂存内容时不能证明工作区安全。消息文件可用 `python tools/repo_maintenance_guard.py commit-msg <message-file>` 检查；文件应使用 UTF-8。

Installation changes this clone's Git configuration and in-repository hooks, retaining existing hooks and a custom commit template. The default template is `.gitmessage.txt`. Python 3.10+ and Git are required; incomplete checks block the operation. A manual `pre-commit` checks only staged objects, so an empty index does not validate the working tree. Use `commit-msg <message-file>` to check a UTF-8 message file.

## 历史信息整理 / History maintenance

历史信息整理仅用于维护者明确授权的场景，不是日常提交步骤。改写会改变提交编号；保持作者、提交者、日期、文件树与父图关系，保留原始引用和旧新编号映射，并重新验证签名。不要为历史提交补写未经证实的测试、部署或参与者。发布改写后的历史需要独立核对远端引用与协作者状态。

Rewriting history requires an explicit maintenance request and is not a routine commit step. Preserve identities, dates, trees, graph relationships, recovery references and an old-to-new mapping, then verify new signatures. Do not add unverified checks, deployment claims or participants to historical messages. Review remote state and collaborator impact separately before publishing rewritten history.
<!-- repo-maintenance:end -->
