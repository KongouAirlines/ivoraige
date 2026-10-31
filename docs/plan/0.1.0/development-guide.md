# 0.1.0 开发与源码运行

首次使用从[安装指南](installation-guide.md)开始。本页供源码运行和贡献代码使用；架构约束见 [AGENTS.md](../../../AGENTS.md) 与 [插件组合决策](../../decisions/0002-plugin-composition-0.1.0.md)。

## 准备与启动

`0.1.0` 是首个正式软件版本，本页可用于源码检出或无 `.git` 的源码归档。需要 Git、Node.js `>=24.22.1 <25 || >=26.12.1 <27` 和随 Node 安装的 npm；源码运行可使用这两个受支持主版本内更新的稳定补丁版，Node 25 和未来主版本暂不在支持范围内。Git 用于取得固定 DSH 源码，应用自身的构建不要求源码归档含 Git 元数据。本仓库、固定 DSH 源码与 npm 依赖均来自公开来源。TXT／Markdown 启动无需 Python 或 PDF 资产。在仓库根目录执行：

```powershell
npm ci
npm run setup:dsh
npm run build
npm start
```

需要本地 npm 安装包时，在完成上述依赖与 DSH 准备后运行 `npm run pack:npm -- <输出目录>`，得到 `ivoraige-0.1.0.tgz`；从该 tarball 安装到独立目录可使用 CLI／HTTP／MCP 及文本工作台。该命令只构建本地 tarball，不向 npm registry 发布。目前不提供预构建下载包；旧 Release 附件已撤下。

启动器打开浏览器，数据目录与源码分开，默认位置按平台决定：

- Windows：`%LOCALAPPDATA%\ivoraige`；未设置 `LOCALAPPDATA` 时使用用户目录下的 `AppData\Local\ivoraige`。
- Linux/macOS：`$XDG_DATA_HOME/ivoraige`；未设置 `XDG_DATA_HOME` 时使用 `~/.local/share/ivoraige`。
- 设置 `IVORAIGE_DATA_DIR` 可直接覆盖整个默认数据目录。

需要隔离开发数据时：

```powershell
node src/cli.mjs serve --store ./evaluation/runs/workbench-0.1.0/store.sqlite
```

打开打印的本机地址。一个数据库只运行一个内核；服务运行时其他 CLI 命令使用 `--url http://127.0.0.1:8787`。所有 CLI 参数以 `node src/cli.mjs help` 为准。源码启动需要环境代理时自行启用 `NODE_USE_ENV_PROXY=1`，本机服务应绕过代理。

VS Code 首次完成依赖准备后，选择“ivoraige: 启动文本工作台”按 F5，构建任务会先执行。PDF 调试需要先按 [PDF 开发参考](pdf-development.md)准备组件；两个启动配置使用同一数据库和端口，不同时运行。

## 验证

```powershell
npm test
npm run smoke:package
```

默认测试使用本地 mock，不调用付费模型。修改后按受影响路径验证；文档修改检查链接、版本和打包内容，不为纯文案增加业务测试。发行构建与 Sandbox 验收见[维护者指南](installation-maintenance.md)。

## 内核与持久化

`createApp({store})` 提供持久化及导出；增加 `settingsDir` 装配 DSH 设置、凭据与模型。无参数保持纯解析。显式 `translation` 配置供示例和测试使用，不能与 `settingsDir` 同时提供。

- [人工译文与冻结输出示例](../../../examples/text-records.mjs)：原创文本，无模型调用。
- [显式翻译示例](../../../examples/translate-text.mjs)与[配置模板](../../../examples/translation-config.example.json)：实际使用时可能调用模型。
- 数据库及 `.owner.sqlite` 所有权文件放在支持 SQLite 文件锁的本地文件系统，NFS/SMB 不在保证范围内。库调用方先创建父目录。
- 原文内容变化产生新文档；不同目标语言隔离修订，`zh` 与 `zh-CN` 也不同。
- 导出指定 `snapshotId` 可重放原接受版本；默认从当前接受内容冻结。缺失接受译文默认失败，显式 skip 保留原文，不补调模型。
- 原文结构化导出可用 `node src/cli.mjs export <docId> --format md,json --content-mode source`，不需要 `--target-lang` 或已接受译文；HTTP `exportDocument` 同样传 `contentMode: "source"`。默认的已接受译文导出仍要求目标语言。
- 旧记录和旧快照在只读访问时不改写；首次成功写入才升级记录载荷版本。升级前停止写入、关闭唯一存储 owner，并备份一致的 SQLite 数据库及受管源文件。未知记录/IR 版本拒绝写入；回退时从备份恢复，不能只替换程序文件。此阶段未执行真实用户库迁移。
- 组件安装与业务任务共享 DSH 未指定 owner 的配额桶（当前上限 1）；安装先占用时业务保持 queued，收到 jobs settled 后重试。反向安装返回 CONFLICT。关停与任务收尾使用的 jobs wait 有 30 秒总截止期；超时报告 UPSTREAM_FAILURE，不伪造任务完成。生产者仍须响应取消并完成资源清理，DSH 原始 dispose 不保证强制终止不合作的生产者。
- 真实模型试验须有单独授权及调用预算。不能把未知 token 用量记为零；API Key 不提交或写入示例。

## 贡献与文档

优先通过所属插件接入功能，复用 DSH 基础设施；设计时说明能力归属、依赖、缺失行为与生命周期，验证实际边界。组合原则见 [ADR-0002](../../decisions/0002-plugin-composition-0.1.0.md)；现行规范与拟议目标的层次见[设计导航](../../requirements/README.md)。新能力按 [0.1.x 工作包](../0.1.x/work-packages.md)逐项实现和验收，规划存在不表示契约已经启用。

`README.md` / `README.zh-CN.md` 同步更新；用户操作写到用户指南，历史验证写到实施记录，未完成事项进入 [follow-ups](../follow-ups/README.md)。新的文档路径按软件版本组织，保留既有历史链接。

源码构建包含 MCP stdio／Streamable HTTP 入口，客户端配置与权限边界见 [MCP 指南](mcp-guide.md)。常驻工作台与 HTTP MCP 共用内核；stdio 仅用于独立数据库，避免两个进程同时占用同一存储。实际验证范围见 [MCP 实施记录](mcp.md)。

### P03 适配器选择与内核边界

原文模式示例：`node src/cli.mjs export <docId> --format md,json --content-mode source`。已接受译文仍需 `--target-lang`。导入使用 `--format` 声明格式；若同一格式有多个来源实现，可加 `--adapter <sourceAdapterId>`。导出同样可用 `--adapter <outputAdapterId>` 指定单一输出格式的实现。可用实现以已安装适配器为准，缺件、禁用或依赖故障会显式失败。

来源插件描述格式、输入类型（文本、字节或文件资源）、排队/取消与 binding 版本。Importer 负责调用插件，Records 持久化通用 IR、修订和冻结快照。MD/JSON 输出需要来源插件的可读投影；原 PDF 二进制输出从受管原件校验复制，不调用重建 sidecar。任务受理时记录来源/输出实现及版本；执行前若该实现缺席或升版，任务失败并可在恢复适配器后重试，绝不自动改用同格式的其他实现。旧记录可只读；没有相容的来源校验器时不能提交或接受需私有校验的修订。

对旧数据库先备份数据库及配套资源目录。存储 domain 仍为 v1，记录载荷在首次写入时按需升级为 v2；未知载荷或 IR 版本拒绝写入。若要回退旧程序，先关闭服务，再恢复升级前的完整备份；不要把已升级的库直接交给旧程序写入。本批只使用临时 fixture 做升级/恢复验证，不迁移真实用户库。

### Prepared import selection

Public uploads pass FileRef data to the same Parse/Importer selection used by direct Tasks calls. Raw bytes and valid UTF-8 views are scored against each source inputKinds; a source advertising both uses its best view, with raw bytes winning an equal same-source score. Different best sources require an explicit adapter. Tasks retains the selection and owned upload input until completion/cancellation, then releases it; execution validates the selected registration/version and does not rescore. TXT/Markdown enforce their own UTF-8 semantics. Managed-resource paths retain their locator and remain subject to adapter-owned file handling.

### Source projection and output availability

Source plugins that expose public text implement `readableText(binding, unit, text)` explicitly, including an identity function when text is already public. A requested readable view with no projection fails `PRECONDITION_FAILED`; a projection returning a non-string fails `INTERNAL`. No fallback exposes opaque unit text. Frozen binary outputs with `requiredViews: []` remain usable without this projection. Unavailable sources never execute `match`; with no usable winner, declarations identify possible missing components, conservatively including compatible sources when the request has no format hint. Output `availableFor(binding, { contentMode })`, `listFormats({ contentMode })`, `listAdapters({ contentMode })` and `get(format, { binding, contentMode })` share availability rules. Listing output compatibility does not replace the source-projection/version checks at export. Registration rejects explicitly invalid output versions before task or artifact admission.

### P03 adapter admission and resume constraints

`Outputs.get(format, { adapterId, adapterVersion, binding, contentMode })` owns output-version constraints. An explicit version must be a nonempty string; a mismatched installed implementation returns `PRECONDITION_FAILED` before a snapshot/task is created. Omitted versions retain the existing behavior: select the adapter and persist its actual version (or `unversioned`). Direct Tasks and Exporter calls use this same check; no new HTTP/CLI version-pin field is introduced.

Export resume resolves the existing frozen snapshot, validates every remaining output from the task cursor using its saved adapter ID/version, binding and content mode, then changes state to queued. Failure preserves paused/failed state, error, snapshot, cursor and artifact checkpoints. Completed outputs are not rebuilt or required to remain installed. Execution still rechecks availability/pins because components may change after admission. This does not promise atomic hot unloading. Source import enumeration, automatic/explicit selection and `assertSelection()` share the unavailable/disabled/failed predicate; those adapters never run a matcher or parser. This import-state rule is distinct from frozen output projection capability.
