# 0.1.0 开发与源码运行

首次使用请从[安装指南](installation-guide.md)开始。本页供源码运行、架构调试和贡献代码使用；架构不变量与开发约束见 [AGENTS.md](../../../AGENTS.md) 与[插件组合决策](../../decisions/0002-plugin-composition-0.1.0.md)。

## 准备与启动

`0.1.0` 是首个正式软件版本，本页适用于 Git 源码检出或不含 `.git` 的源码归档。

- **运行环境**：需要 Git、默认 Node.js **26.13.0**（`.node-version`）和随 Node 安装的 npm。DSH bundle 目标为 Node 26，Node 24 仅保留兼容，运行时支持范围仍为 `>=24.22.1 <25 || >=26.12.1 <27`；源码运行可使用这两个受支持主版本内更新的稳定补丁版，Node 25 和未来主版本暂不在支持范围内。
- **依赖来源**：Git 用于取得固定 DSH 源码（应用自身构建不要求源码归档含 Git 元数据）；本仓库、固定 DSH 源码与 npm 依赖均来自公开来源。TXT／Markdown 启动无需 Python 或 PDF 资产。

在仓库根目录执行：

```powershell
npm ci
npm run setup:dsh
npm run build
npm start
```

- **构建本地 npm 包**：完成上述依赖与 DSH 准备后，运行 `npm run pack:npm -- <输出目录>` 可生成 `ivoraige-0.1.0.tgz`；从该 tarball 安装到独立目录即可使用 CLI／HTTP／MCP 及文本工作台（该命令仅构建本地 tarball，不向 npm registry 发布；目前不提供预构建下载包，旧 Release 附件已撤下）。
- **插件交付测试依赖**：插件交付测试使用 `npm ci` 安装的锁定开发依赖 `pnpm 11.25.0`，无需全局安装 `pnpm`；安装器在各平台均通过当前 Node 可执行文件启动该包。使用已发布源码包的用户需单独安装 `pnpm`。

### 数据目录与隔离调试

启动器会自动打开浏览器，数据目录与源码目录分开保存，默认位置按平台决定：

- **Windows**：`%LOCALAPPDATA%\ivoraige`（未设置 `LOCALAPPDATA` 时使用用户目录下的 `AppData\Local\ivoraige`）
- **Linux / macOS**：`$XDG_DATA_HOME/ivoraige`（未设置 `XDG_DATA_HOME` 时使用 `~/.local/share/ivoraige`）
- 设置环境变量 `IVORAIGE_DATA_DIR` 可直接覆盖整个默认数据目录。

需要隔离开发数据时，显式指定 `--store`：

```powershell
node src/cli.mjs serve --store ./evaluation/runs/workbench-0.1.0/store.sqlite
```

打开终端打印的本机地址。**同一 SQLite 数据库同时只能运行一个内核**；服务运行期间，其他 CLI 命令需加 `--url http://127.0.0.1:8787` 连接它。所有 CLI 参数以 `node src/cli.mjs help` 为准。源码启动若需使用环境代理，可自行设置 `NODE_USE_ENV_PROXY=1`（本机回环服务应绕过代理）。

在 VS Code 中首次完成依赖准备后，选择“**ivoraige: 启动文本工作台**”并按 `F5`，构建任务会先行执行。PDF 调试需先按 [PDF 开发参考](pdf-development.md)准备组件；两个启动配置共用同一数据库和端口，切勿同时运行。

## 验证与测试

```powershell
npm test
npm run smoke:package
```

- **CI 矩阵**：CI 使用锁文件中的依赖，仅在 Linux、macOS 和 Windows 上运行 Node.js 26.13.0；Node 24 的运行时支持范围不变，但不再单独运行 CI job。历史运行记录保留。
- **按受影响路径验证**：默认测试使用本地 mock，不调用付费模型。修改代码后按受影响路径验证；纯文档修改检查链接、版本和打包内容，不为纯文案增加业务测试。发行构建与 Sandbox 验收见[维护者指南](installation-maintenance.md)。

## 内核组装与持久化边界

`createApp({ store })` 提供持久化及导出能力；增加 `settingsDir` 可装配 DSH 设置、凭据与模型；无参数调用保持纯解析。显式 `translation` 配置仅供示例和测试使用，不能与 `settingsDir` 同时提供。

- **示例与模型调用边界**：
  - [人工译文与冻结输出示例](../../../examples/text-records.mjs)：原创文本，零模型调用。
  - [显式翻译示例](../../../examples/translate-text.mjs)与[配置模板](../../../examples/translation-config.example.json)：实际运行时可能调用模型。真实模型试验须有单独授权及调用预算；未知 token 用量记为 `null`/未知而非 `0`；API Key 切勿提交或写入示例。
- **文件系统锁与语言作用域**：数据库及 `.owner.sqlite` 所有权文件须置于支持 SQLite 文件锁的本地文件系统（NFS/SMB 不在保证范围内），调用方须先创建父目录。原文内容变化会产生新文档；不同目标语言隔离修订（`zh` 与 `zh-CN` 亦相互独立）。
- **冻结快照与来源模式**：导出指定 `snapshotId` 可重放原接受版本，默认从当前已接受内容冻结；缺失接受译文默认失败，显式 `skip` 保留原文且不补调模型。原文结构化导出可使用 `node src/cli.mjs export <docId> --format md,json --content-mode source`（HTTP `exportDocument` 传 `contentMode: "source"`），无需 `--target-lang` 或已接受译文；默认已接受译文导出仍要求目标语言。
- **只读兼容与写时升级**：旧记录和旧快照在只读访问时不改写；首次成功执行对应新特性写入时才升级记录载荷或存储单元版本。升级前请停止写入、关闭唯一存储 owner，并备份一致的 SQLite 数据库及受管源文件。未知记录／IR 版本会拒绝写入；回退旧版程序时必须从备份完整恢复，不能只替换程序代码。
- **后台配额与关停截止期**：组件安装与业务任务共享 DSH 未指定 owner 的配额桶（当前并发上限 1）：安装先占用时业务任务保持 `queued`，待 jobs settled 后重试；业务运行期间发起安装则返回 `CONFLICT`。关停与任务收尾使用的 jobs wait 设有 30 秒总截止期，超时报告 `UPSTREAM_FAILURE`，绝不伪造任务完成；生产者仍须响应取消并完成资源清理。

## 贡献与文档约定

优先通过所属插件接入功能并复用 DSH 基础设施；设计时明确能力归属、依赖、缺件行为与生命周期，并验证实际边界。组合原则见 [ADR-0002](../../decisions/0002-plugin-composition-0.1.0.md)；现行规范与拟议目标的层次见[设计导航](../../requirements/README.md)。新能力按 [0.1.x 工作包](../0.1.x/work-packages.md)逐项实现和验收，规划存在不代表契约已启用。

修改行为或配置时同步更新 `README.md` 与 `README.zh-CN.md`：用户操作写入用户指南，历史验证写入阶段实施记录，未完成事项记入 [follow-ups](../follow-ups/README.md)。文档路径按软件版本命名，保留既有历史链接。源码构建包含 MCP `stdio`／`Streamable HTTP` 入口，客户端配置与权限边界见 [MCP 指南](mcp-guide.md)，实际验证见 [MCP 实施记录](mcp.md)。

## 0.1.x 基础与生命周期专题

### P03 适配器选择、来源投影与恢复约束

- **显式与自动选择**：导入使用 `--format` 声明格式，同一格式有多个来源实现时可加 `--adapter <sourceAdapterId>`；导出同样可用 `--adapter <outputAdapterId>` 指定输出实现。公开上传将 `FileRef` 传给与 `Tasks` 直接调用一致的 `Parse`／`Importer` 选择逻辑：原始字节与有效 UTF-8 视图按各来源声明的 `inputKinds` 打分，同一来源兼有两者时取其最高分（同分时原始字节优先），不同来源并列最高分则要求显式指定 `--adapter`。`Tasks` 保留所选实现及上传输入直至完成或取消，执行时核对已选注册身份与版本而不再重新打分。来源导入的枚举、自动／显式选择和 `assertSelection()` 统一排除 `unavailable`、`disabled`、`failed` 状态的适配器，绝不对其运行 matcher 或 parser。
- **可读投影（`readableText`）与视图检查（`outputViewError`）**：公开暴露正文的来源插件须显式实现 `readableText(binding, unit, text)`（正文已可直接公开的 TXT/Markdown 声明恒等投影）；请求可读视图但无投影时返回 `PRECONDITION_FAILED`，投影返回非字符串时返回 `INTERNAL`，绝不回退暴露不透明的内部单元文本。`requiredViews: []` 的冻结二进制输出（如从受管原件校验复制的原 PDF）不依赖 `Parse` 或可读投影。
  - `Parse` 持有无副作用的 `outputViewError(binding, { views, provenance })` 检查，统一核对来源注册、固定适配器 ID／版本、binding schema 版本及所需投影方法（`native-markdown` 作为可选特化保留可读文本回退）。
  - `Outputs` 在 `availableFor`、`listFormats`、`listAdapters` 和 `get` 中复用该检查：无 `binding` 时描述全局已安装能力，有文档 `binding` 时由 `Records` 提供不可变的文档 `provenance` 进行筛选。`Tasks` 与直接 `Exporter` 调用在创建任何快照或任务前校验所有所选输出，混合请求若含不兼容项则整体拒绝。
  - 公开能力和订阅状态的输入格式列表统一将 `markdown` 规范化并去重为 `md`；无 `Parse` 时 `capabilities` 仍可读取（输入格式为空并报告组件状态）。操作注册可提供同步 `isAvailable` 谓词，目录在检查必需服务后同时用于发现与调用，且不将该函数暴露到公开元数据。
- **输出版本固定与任务恢复（Resume）**：`Outputs.get(format, { adapterId, adapterVersion, binding, contentMode })` 校验显式输出版本（必须是非空字符串，与已装版本不符时在创建快照／任务前返回 `PRECONDITION_FAILED`；省略版本时保持原行为并记录实际版本或 `unversioned`）。恢复暂停或失败的导出任务时，先解析既有冻结快照，从任务游标起按保存的适配器 ID／版本、`binding`、来源 `provenance` 和 `contentMode` 校验剩余未完成输出，全部通过后才将状态改为 `queued`；校验失败则保留原状态、错误、快照、游标和已完成产物检查点（已完成产物无需重新生成，也不要求原输出适配器仍在场）。受理后若组件被撤下或投影抛错，执行期仍会复检并保留快照供恢复后重试（不承诺任意第三方热卸载原子性）。

### Q02 资源保留、清理墓碑与存储升级

- **放弃失败任务（`abandon`）**：失败的持久任务默认保留可恢复状态并锁定其引用的导出快照。执行 `abandon TASK_ID`（HTTP `POST /api/tasks/{taskId}/abandon`，MCP `ivoraige_task_abandon`）可显式将其状态改为 `abandoned`，保留错误与历史记录并释放重试占用。`cancel` 不能用于已失败任务；排队、运行或暂停中的任务不可 `abandon`。
- **产物删除与物理清理（`retain` vs `delete-owned`）**：
  - `artifacts DOC_ID delete ARTIFACT_ID`（HTTP `DELETE /api/documents/{docId}/artifacts/{artifactId}?fileAction=retain|delete-owned`，MCP `ivoraige_artifact_delete`）默认仅删除记录与终态任务检查点，文件保留在 `retainedPath`（显式外部 `--out` 路径及无归属标记的旧产物仅支持此模式）。
  - 指定 `--file-action delete-owned` 可物理删除内核默认导出目录中的受管文件：内核在删除前核对根目录归属、普通文件身份、原始 SHA-256 摘要、共享路径引用、活跃／失败任务引用及读取／快照租约，绝不删除活跃产物。快照仅在其任务、产物、租约及待清理引用全部归零后才允许删除。
- **持久清理墓碑与故障恢复**：文件删除与 SQLite 更新无法构成单一文件系统事务，因此内核先移除产物记录并写入持久清理墓碑（保存路径、摘要与快照引用），再执行 `unlink`。
  - 若 `unlink` 失败，`artifacts DOC_ID cleanup`（HTTP `GET /api/documents/{docId}/artifact-cleanup`，MCP `ivoraige_artifact_cleanup_list`）会列出该墓碑；排除故障后对同一产物 ID 重试带 `--file-action delete-owned` 的删除命令即可完成清理。
  - 若受管文件或其原父目录在检查、摘要读取或删除期间已消失（`ENOENT`／`ENOTDIR`），即使当前配置的导出根目录已改变，重试删除也会顺利完成墓碑清理；但若旧根目录下的文件仍然存在，内核会保留该文件并拒绝在新根配置下删除（须切回原导出根配置处理，或保留清理标记并从备份恢复）。若文件字节已被外部替换，内核会保守保留替换后的文件。
- **文件符号链接引用保护**：物理删除受管文件前，共享引用检查会先解析文件符号链接的完整规范目标，再推导父目录身份与文件名。同一文档或跨文档通过文件符号链接指向该目标的记录均计入共享引用并阻止 `delete-owned`（使用默认 `retain` 删除别名记录则不受限制，不会解除链接或删除目标文件）。悬空符号链接无法建立可靠身份，对物理删除保守失败关闭。若其他产物路径因目录权限收回或悬空链接无法检查，预检和事务复检均返回 `CONFLICT`，公开详情提供 `blockingDocId`、`blockingArtifactId` 与恢复指引（底层文件系统错误仅留作私有 `cause`），在共享引用检查通过前不会改动任何记录、清理标记或磁盘文件。
- **存储单元版本 2 与 3 升级门禁**：
  - **版本 2（Q02 写入）**：新建库将 DSH `ivoraige_records` 存储单元标为版本 2。现有版本 1 库仍可读取和进行普通写入；首次执行受管默认导出、任务 `abandon` 或产物删除／清理写入前，内核先同步将 `ivoraige_records` 升为版本 2，再将受影响的文档或导入任务行标为 payload schema 3（不批量改写其他 v1/v2 文档）。
  - **版本 3（提示词选择与追溯）**：首次写入 `promptTemplateId`、`promptSelection` 或修订 `promptTrace` 时，会将同一 `ivoraige_records` 存储单元从版本 1/2 升至版本 3（未注入升级回调的独立内嵌 `Records` 服务在版本 1/2 下会拒绝这些字段；提示词库本身位于同一 SQLite 的独立 DSH 域）。
  - **回退边界**：一旦存储单元升至版本 2 或 3（即使随后的行写入失败），旧版二进制都会在打开库时安全拒绝，防止旧代码写回时抹除归属或追溯字段。升级前必须完整备份 SQLite 与导出文件；回退旧版程序须恢复备份，不支持仅回退代码。
- **提示词解析与复用顺序**：翻译任务在检查可复用修订前先通过 `resolvePromptSelection` 解析并固定提示词选择与连接身份；而针对 `basis` 的模型 `preflight`（含不支持的术语约束装配检查）仅在未命中可复用修订、即将实际调用模型并增加调用计数前执行。这保证了：显式指定缺失或不兼容提示词时立即报错，同时带术语约束的适用人工修订仍能零模型调用复用。实现完整提示词契约的模型插件须注册 `ivoraige.translationModel` / `translate-unit` 并同时提供 `resolvePromptSelection`、`preflight` 和 `translate`；暴露 `configuration()` 且返回 `null`（未选定连接）时，隐式任务仍可零调用复用已有接受修订，未命中复用或显式指定模板时则在调用模型前失败。

<a id="p04-operation-and-entry-composition"></a>

### P04 操作目录、入口组合与请求生命周期

- **按需挂载与入口开关**：`createApp()` 在无 `store` 时即可暴露 `operationCatalog` 和基础能力描述；`createApp({ settingsDir })` 可在不挂载文档任务的情况下提供模型设置管理。入口可通过 `entries: { cli: false, http: false, mcp: false }` 独立启停，`events: false` 关闭新的状态流（但保留旧 `/api/events` 任务流及远程 CLI `--json-events`；`/api/events/state` 和 `/api/state` 关闭）。未启用的入口不监听端口或启动传输。`components`、`exportDir` 和 `maxArtifactBytes` 要求提供 `store`。
- **服务依赖与延迟挂载**：
  - `delete-owned` 调用时要求资源访问与导出服务同时在场，缺一即在修改记录或创建清理标记前返回 `COMPONENT_MISSING`（仅删记录只需 `Records`）。
  - MCP 会列出已注册工具；当工具所需服务尚未挂载时调用返回 `COMPONENT_MISSING`，服务挂载就绪后同一工具即可正常调用。
  - `Operations` 门面构造时仅需 `operationCatalog`，不缓存可选的 `Records`／`Tasks` 服务：即使 `Operations` 先于 `Records`／`Tasks` 挂载，待服务就绪后，`waitTask` 也会在调用开始时解析 `Records` 并在初始读取、订阅后竞态复检及终态重读期间保持同一存储实例。
  - 事件桥支持在桥接器之后挂载 `operationCatalog`，通过服务变更通知自动订阅并在目录卸载或桥接器销毁时释放监听器。
- **通用操作注册与调用边界**：能力插件通过 `app.operationCatalog.register(...)` 注册输入 schema、结果 schema 与处理函数并持有返回的 disposer，自动映射为内部通用投影 `ivoraige call OPERATION --set JSON`、`POST /api/operations/OPERATION` 和 MCP `ivoraige_op_OPERATION`（共用同一校验器，顶层通信信封固定附加 `apiVersion: "2.0"`）。进程内 CLI 调用可使用 `runCli(args, { app })` 且不会销毁调用方宿主。自建本地宿主的通用 `call` 会拒绝声明为 `longRunning` 或 `cancellable: 'task'` 的操作（含 `--no-wait`），此类操作请使用本地等待型 CLI 别名或连接常驻宿主（`--url`／外部传入 `app`）。HTTP 路径标识符中格式错误的百分号编码统一映射为 `400 INVALID_ARGUMENT`。
- **状态流握手与反压**：工作台订阅 `/api/events/state` 收到 ready 屏障后，携带 `subscriptionId` 读取 `/api/state?subscriptionId=...` 并保持订阅；后续失效通知触发重读，断线、缓冲区溢出或宿主 generation 变化则需重新握手。状态 SSE 在传输反压下等待 `drain` 后继续发送会话内保留的通知。通过编程方式调用 `runCli(['serve', ...], { signal, stdout, stderr })` 会在监听前后响应 abort 信号并关闭所属 HTTP 宿主与存储。HTTP 与 MCP 的产物读取共享同一租约／归属服务，可通过 `maxArtifactBytes` 限制读取体积（默认不限；浏览器上传在 10 MiB HTTP JSON 请求体上限内最高支持 7 MiB 文件）。详见 [P04 验证记录](../0.1.x/evidence/foundation-p04.md)。
- **MCP HTTP 原始请求生命周期与同步工厂**：`createMcpHttp` 通过 `AsyncLocalStorage` 将底层 Node 请求的 `AbortController` 作用域传递至共享 SDK 服务工厂，监听 `IncomingMessage` 的 `aborted` 与 `ServerResponse` 的 `close`（不将完整 POST 请求体读取完毕后的正常 `IncomingMessage` close 误判为取消），从而规避 Node 26.12.1 下 SDK 旧分支 `Request.clone` 弱控制器异常，并在端点关闭时中止未完成请求。MCP 同步工厂在分配 SDK 对象或注册表订阅前先检查入口可用性，构造过程在完成所有权注册前不发生异步让出；`McpEntry` 关闭时等待所有已持有句柄释放并按注册顺序传播首个错误。
- **Records 内存归属索引**：`Records` 在加载时构建一次内存 ID 索引；当固定 DSH 的 `domain/changed` 事件在持久化存储与表缓存提交后同步触发时，前置注册的 `Records` 监听器会在公开状态观察者运行前仅增量更新受影响文档中发生变化的集合（写入失败不发布条目）。单元、修订和产物使用各自独立的命名空间，翻译、操作和导入任务共用同一任务命名空间；重复 ID 返回 `CONFLICT`，跨文档请求唯一资源返回 `NOT_FOUND`。已接受修订的复用索引同样按文档维护，检查点复用通过修订索引定位来源。
