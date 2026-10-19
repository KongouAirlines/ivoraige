# MCP／文档审查报告（PR #18、#19、#27）

> 2026-10-19 归档。以下评分、发现与验证结果来自原审查；“main”指 `dde75f5`，行号对应各节 PR head。后续变化与查阅方式见[归档说明](README.md)。


原报告署名：review-mcp（MCP/文档）　日期：2026-10-17　范围：当时的统一审查提纲（见[阅读说明](README.md#reading)）

**方法与证据边界**
- 逐一审阅 `pr-18.diff`／`pr-19.diff`／`pr-27.diff`，并用自建 worktree 读到各 PR head 的完整文件树（`3524f96`／`e61c90a`／`ef597b2`），行号均相对该 head 树。
- SDK 契约核对：读取审查环境中已安装的 `@modelcontextprotocol/{server@2.3.1,node@2.1.1,client@2.3.1}` 类型声明，验证 `createMcpHandler`／`serveStdio`／`McpServer.registerTool`／`ResourceTemplate`／`ProtocolError`／`context.mcpReq.signal`／`handler.notify`／`toNodeHandler.maxRequestBodySize` 的用法。`[确认]`
- 版本／tag：`git for-each-ref`、`git rev-list -n1 v0.1.0`、`git cat-file`；`v0.1.0` 为 annotated tag，解引用到 `cb7e4a4`；tag 树与 PR #25 head `4d36624` 树相同。`[确认]`
- 静态链接扫描：PR #19 head 交付包内 md 相对链接 33 条全部可解析（与 `documentation.md:42` 自述一致）；PR #19 变更文档相对链接 141 条无断链；仓库全局 21 条断链全部位于未改动的 MVP 历史文档。`[确认]`
- 截图 `docs/assets/0.1.0/workbench.jpg` 为有效 JPEG（1280×720，FF D8），目视为真实工作台、仅展示已实现功能（TXT 导入、zh-CN 修订接受、MD/JSON 导出）。`[确认]`
- 未运行全量测试／构建（不在本报告审查范围内）；真实 Windows／macOS 运行、私有 Release 远端附件与下载摘要均无法在本机复核，相关记录一律标 `[待验证]`。

---

<a id="pr-18"></a>

## PR #18 — feat(0.1.0): 以可选 Cordis 插件接入 MCP 与冻结导出（MERGED，base=c8a146d，head=3524f96，+1458/-48，28 files）

**结论**：**B+**（无 P0/P1）。这是本组最具实质价值的 PR：`ivoraige.mcp` 注册服务 + 按能力划分的 MCP 能力插件 + Cordis `ctx.effect` disposer，stdio 与 Streamable HTTP 共用同一份工具／资源映射；MCP 层没有 PDF／模型分支，入口只做协议映射；缺席路径（`createApp({mcp:false})`、`serve mcp:false`、`--no-mcp`）可用且有测试；错误／异步任务／长轮询取消／artifact 读取语义与 03 §1.3／§6 基本一致，并把 §6 同步更新。主要问题是一处入口层私有结构判断和可选能力工具的测试缺口。

**范围与流程**：7 个 commit（计划 → 功能 → 4 轮 review 修复 → 收尾），最终 commit 3524f96 是合并 main 的 merge commit，PR diff（merge-base..head）不含无关 CSS 改动，范围干净。标题中的“冻结导出”在本 PR 中没有改变导出实现（`src/export.mjs` 未改），只是经 MCP 读取既有冻结产物并补验收脚本；标题略大于 diff，建议在 PR body 说明。`[确认]`

**Cordis/架构**（逐条判断）：
1. **注册服务与 disposer**：`src/mcp-registry.mjs:2-28` 定义 `Service('ivoraige.mcp')`，`registerTool`／`registerResource` 返回注销函数，`changed` 通知监听器；`src/mcp-tools.mjs:4-11` 与 `src/operation-mcp.mjs:36,48` 全部通过 `ctx.effect()` 注册，插件卸载即注销。`test/mcp.test.mjs:188-233` 用运行时插件验证动态装载／卸载与 listChanged 通知。`[确认]`
2. **双 transport 共用映射**：`src/mcp.mjs:18-46` 的 `createMcpServer(app)` 是唯一构建入口；`createMcpHttp`（L50-64）与 `runMcpStdio`（L66-86）都复用它；HTTP 每次请求由 `createMcpHandler` 工厂创建实例（L52），stdio 每连接一个实例。两种 transport 的参数 schema 都是 `protocol.parameters` 的同一份 zod 定义（`src/mcp-tools.mjs:8`），业务结果走 `operations.invoke`。`[确认]`
3. **无 PDF／模型分支**：`src/mcp.mjs`／`mcp-registry`／`mcp-tools` 全文无 babeldoc／pdf 逻辑；`operation-mcp` 只有 translate/export 的业务描述；PDF 仍由既有 `Pdf` 适配器与输出适配器提供（`test/mcp.test.mjs:279-311` 验证未装 PDF 时 capabilities 不含 pdf、PDF 导入任务失败而文本功能正常）。`[确认]`
4. **MCP 缺席不影响 CLI/HTTP**：`src/app.mjs:100-105` 仅在 `mcp` 为真时装配能力插件；`src/http.mjs:126` 仅在 `app.mcp` 存在时挂载 `/mcp`；`src/cli.mjs` 增加 `--no-mcp`；`test/mcp.test.mjs:313-345` 覆盖 `serve(...,{mcp:false})` 404 与 `createApp({mcp:false})` 后文本操作可用。`[确认]`
5. **入口零业务逻辑**：CLI 仅在 `mcp --stdio` 时把 stdout 交给 MCP runtime（`src/cli.mjs` 的 `mcpStdio` 分支），HTTP 只做路径分发；工具注册由独立的能力插件承担。唯一例外见 M18-1。`[确认]`
6. **生命周期／关闭顺序**：HTTP 关闭先释放 MCP 订阅与 handler，再结束 SSE、关闭监听；启动失败也释放订阅（`src/http.mjs:126,195-215`）；CLI finally 与 launcher catch 逐项释放且传播首个错误（`src/cli.mjs`、`src/launch.mjs:60-62`）；stdio 在 stdin EOF／关闭、传输关闭、SIGINT/SIGTERM 时结束并关闭内核（`src/mcp.mjs:66-86`），`test/mcp.test.mjs:347-379,399-446` 与 `test/entries.test.mjs` 故障注入覆盖。`[确认]`
7. **权限与监听面如实**：HTTP 只允许回环监听；Host 与同源 Origin 在 `/mcp` 之前校验（`src/http.mjs:130-142`，测试 L313-329 对 evil Host/Origin 返回 403）；MCP 无独立鉴权，文档明确“同机可访问该端口的客户端拥有内核编辑、设置、组件管理权限”（mcp-guide；“capabilities.md”在 PR #19 中同样写明）。`[确认]`

**设计一致性**：与 03 §6 的当前实现描述一致，且同 PR 更新了规范（`03_API-protocol_v2.0.md:291-312` 工具／资源表、`-32002/-32602/-32603` 资源错误映射、`createApp({mcp:false})` 语义）；§1.1 把“参数与返回复用 zod”修正为“参数复用 zod、结果复用 apiVersion 结构”，与实际实现一致。§5 未补 `mcp --stdio` 的 stdout 纪律（仅在 §6 出现），见 M18-9。与 AGENTS 不变式 1、7 及 ADR-0002（PR #19）方向一致；M18-1 与 PR #19 新写入的“不解释引擎私有结构”存在张力。

**代码/逻辑/结构**：
- 参数校验复用 `validate()`（`src/protocol.mjs:55-62`），31 个工具映射的 operations 均有对应 schema；错误统一 `errorEnvelope`（不含凭据、INTERNAL 只回通用消息 + traceId）。`[确认]`
- 长轮询：`src/operations.mjs:49-65` 新增可选 `signal`，断开只结束等待不取消任务；`src/mcp.mjs:36` 用 `AbortSignal.any([请求信号, mcpReq.signal])`，与 §6 一致且有测试（`test/mcp.test.mjs:235-277`）。`[确认]`
- artifact 资源：`src/operation-mcp.mjs:48-57` 只读已有字节、从不重建；`ENOENT/ENOTDIR → NOT_FOUND`；测试 L135-140,153-154 校验冻结快照内容。`[确认]`
- 可选能力工具定义在各自插件中并声明 `inject`（`model-settings-mcp.mjs:9`、`component-mcp.mjs:12`），注册失败不会静默。`[确认]`

**文档/风格**：
- README 与 mcp-guide／mcp.md 基本如实：区分 “official SDK 双 transport 验证” 与 “真实 DSH HTTP 客户端验证”，并声明其他客户端需单独验证。M18-8 的措辞仍可更精确。
- `docs/plan/0.1.0/README.md:197` 仍以 229/229 作为 MCP 阶段结论，落后于 `mcp.md` 的 240/240（M18-7）。
- `THIRD_PARTY.md:89-92` 记录 MCP 依赖与许可；生产依赖为精确版本（`@modelcontextprotocol/server` 2.3.1、`@modelcontextprotocol/node` 2.1.1，client 仅 devDependency），`package-lock` 完整。`[确认]`

**测试与证据**：新增 `test/mcp.test.mjs`（11 个测试）与 entries 中 2 个故障注入测试；覆盖现代／旧协议 listChanged、动态插件装卸、Host/Origin、stdio EOF 释放 SQLite、abort 长轮询、缺失 PDF、清理失败继续释放等，断言总体有效（`test/mcp.test.mjs:116-119` 的 malformed 断言偏弱：`malformed instanceof Error || malformed.isError` 实际几乎恒真）。PDF 端到端依赖 `scripts/smoke-mcp-pdf.mjs`（需 BabelDOC + Poppler，非默认测试），记录中的真实 PDF／真实 DSH 客户端证据只能标 `[待验证]`。可选能力（settings/component）工具从未被调用测试（M18-2）。

**问题清单**：

| ID | 严重度 | 位置 | 问题与证据 | 建议 |
|---|---|---|---|---|
| M18-1 | **P2** | `src/operation-mcp.mjs:44` | `if (!unitId.startsWith(\`${docId}.\`)) throw ...`：入口层解析内部 unit ID 结构（`src/records.mjs:124-127` 的 `locateUnit` 以 `unitId.split('.')[0]` 取 docId；records 内部 ID 即 `${docId}.…`）。`/docs/A/units/B.x` 的归属规则被写在 MCP 层，而非内核；该分支也没有测试（测试只覆盖缺失文档、缺/空/非法 targetLang）。与 PR #19 同批写入的 `01_design_v2.0.md:117`“通用入口不解释引擎私有结构”、ADR-0002 §2“入口…不复制业务规则”冲突。不构成 P0：未复制翻译／复用／快照等业务规则，仅做资源身份校验。`[确认]` | 在内核增加带 docId 的 unit 读取（如 `getUnit(unitId,{docId})` 校验归属），或删除该分支由内核保证；补一条不匹配 docId 的负例测试。`[main 仍存在]` |
| M18-2 | **P2** | `test/mcp.test.mjs:91-93` | 只断言 settings/component 工具“不存在”，从未以 `settingsDir`／`components` 组装后调用 `ivoraige_settings_get`、`ivoraige_settings_update`、`ivoraige_credential_set`、`ivoraige_component_*`；`model-settings-mcp`／`component-mcp` 的 inject 与注册映射若写错不会被测试发现（grep 全部 test/scripts 无这些工具名调用）。`[确认]` | 增加一个带 settingsDir/components 的 fixture，校验工具出现、schema、一次只读调用（如 settings_get/component_status），避免写凭据／安装。`[main 仅新增 credential_clear 一个测试，仍有缺口]` |
| M18-3 | P3 | `src/mcp.mjs:21` | `new McpServer({ name:'ivoraige', version:'0.1.0-dev.0' })` 手写版本，与 `package.json` 重复。PR head 时两者一致，但版本升级会静默让 MCP 握手报错版本（PR #25 已改为 `import packageInfo`）。`[确认]` | 直接从 package.json 导入（已修）；可加测试断言 server version 等于包版本。`[main 已修]` |
| M18-4 | P3 | `src/http.mjs:126` | `serve` 默认路径在 `app.mcp` 存在时动态 `import('./mcp.mjs')`；如果可选 MCP SDK 包缺失／损坏，HTTP/WebUI 也启动失败，与“MCP 是可选入口插件、缺席不影响 CLI/HTTP”的模块级语义不完全一致（当前 `mcp:false`／`--no-mcp` 路径确实不受影响；MCP 依赖是生产依赖）。`[推断]` | 把 import 失败降级为“/mcp 不可用 + 明确日志/COMPONENT_MISSING”，不要在 HTTP 启动阶段抛出；或明确声明 MCP 依赖为必装。 |
| M18-5 | P3 | `src/component-mcp.mjs:6-7` | 工具描述写死 “official PDF component”，而组件服务是通用安装器；入口能力描述嵌入了具体格式名（无分支逻辑，故仅 P3）。与 ADR-0002“入口不解释格式专属实现”的措辞不完全一致。`[确认]` | 改为 “official component supported by this build” 或从组件服务读取描述。 |
| M18-6 | P3 | `src/operation-mcp.mjs:1,48-56` | 入口重新实现了 artifact 字节读取与 ENOENT→NOT_FOUND 映射，`src/http.mjs:149-176` 已有一份同类实现；两处输出读取逻辑各自维护、无统一大小上限。`[确认]` | 在内核 `operations` 增加 `readArtifact(id)`（含大小上限），HTTP 与 MCP 共用。 |
| M18-7 | P3 | `docs/plan/0.1.0/README.md:197` | MCP 阶段结论写 “Windows 本机完整测试 229/229”，而 `docs/plan/0.1.0/mcp.md:71,76` 的最终记录是 240/240、239/239；同一 PR 内两处口径不一致。`[确认]` | 更新计划页结论或明确“截至 2026-10-13”；PR #19 已加历史语境说明。`[main 已部分说明]` |
| M18-8 | P3 | `README.md:7` | “MCP 已在 Windows 通过正式 SDK 双传输和 DSH 真实 HTTP 客户端验证”易被读成真实客户端验证了两种传输；`docs/plan/0.1.0/mcp.md:34` 明确“真实 AI 客户端 stdio 未单独运行，stdio 使用正式 SDK 客户端和独立进程验证”。`[确认]` | 改为“官方 SDK 客户端覆盖 stdio/HTTP；真实 AI 客户端目前只验证 HTTP”。 |
| M18-9 | P3 | `docs/requirements/v2.0/03_API-protocol_v2.0.md:283-295` | §5 CLI 输出协议没有写 `mcp --stdio` 的 stdout 仅承载协议、诊断只写 stderr、EOF 退出码等纪律；该规则只出现在 §6 第 295 行，而 §5 是 CLI 输出的规范位置。`[确认]` | 在 §5 增加一行 `mcp --stdio` 例外与退出语义。 |

**跨 PR 关联**：#18 是 #19 的 base（#19 merge-base=3524f96，#19 分支内含 `Merge MCP PR 18` commit），合入顺序 `b0afd55(#18) → 3421ba5(#19) → cb7e4a4(#25) → dde75f5(#27)` 已确认，无 stack 风险。行为回归：#25 只改了 MCP 版本来源与组件凭据操作，`mcp-registry`／`mcp-tools`／`operation-mcp` 在 main 未变，M18-1/M18-2 仍存在；M18-3 已修。

---

<a id="pr-19"></a>

## PR #19 — docs(0.1.0): 双语项目介绍、用户文档与插件组合约束（MERGED，base=3524f96，head=e61c90a，+556/-189，24 files）

**结论**：**A-**（无 P0/P1/P2）。文档整理质量高：中英文 README 结构、链接、能力表、平台边界一一对应；ADR-0002 把组合根／契约依赖／缺件隔离／生命周期／宿主边界讲清楚，并与 AGENTS、01_design §2.2 同步；能力与权限描述与代码一致（尤其明确 MCP 连接即拥有该内核编辑、设置和组件管理权限）；历史记录被重新框定为“历史证据”。仅存少量版本／日期口径可更精确的问题。

**范围与流程**：8 个 commit（含一个仅为本地合流验证的 `Merge MCP PR 18` commit，属堆叠关系的正常合入，不构成产品代码变更）。PR diff 只包含文档、`package.json` 打包清单、`build-distribution.mjs` 复制清单，无业务代码；范围单一。`[确认]`

**Cordis/架构**（文档层）：
- ADR-0002 `docs/decisions/0002-plugin-composition-0.1.0.md`：背景陈述现状（`src/app.mjs` 组合根、parse/outputs 注册表、operations 给入口）准确；决策 1–5 覆盖“按可选能力划分插件、组合根选择实现、依赖与不可用状态是契约、声明并完成生命周期、宿主边界不另写权限体系”，与 v2.0 §0 C1–C8、AGENTS 不变式 6／7 一致；并明确“不承诺任意热卸载”“MCP 缺席不影响 CLI/HTTP”。`[确认]`
- AGENTS.md 重写保留全部硬不变式与版本命名规则（“Version-based naming, always” 仍在 L63）；新增“Composition and capability ownership”与“Keep user guidance in sync”，与 v2.0 §2.2 的入口无逻辑修订互相引用。`[确认]`
- 01_design §2.2 L117 把“入口无逻辑、三入口各加一行注册”改为“能力由所属服务/适配器实现，组合根可选择具体插件，通用入口不解释引擎私有结构”——方向正确，但正是这条新规与 PR #18 的 M18-1 形成冲突（应在后续修复 M18-1 时同步回写）。`[确认]`

**设计一致性**：能力表（capabilities.md）逐项与代码／既有实现一致：TXT/Markdown、可选 PDF、语言隔离修订、冻结导出、持久任务、四入口、DSH 模型／组件；边界如实（无 OCR／双语 PDF／术语库／RAG／非回环认证；PDF 导入可取消不可暂停续传；导出不调用模型）。MCP 权限描述（L12）与本组重点一致，无“连接即安全”式虚报。`[确认]`

**代码/逻辑/结构**：无代码改动。`package.json` 从交付包移除开发用 `pdf.md`、加入 `README.zh-CN.md`／`capabilities.md`／截图；`build-distribution.mjs` 同步复制并与 PR #18 的 mcp-guide 清单合并。`[确认]`

**文档/风格**：双语同构（各 5 个二级标题；按 PR #19 head 实测各 18 个链接目标，除语言切换与锚点外逐一对应，能力表行数/内容对应）；中文 TOC 使用中文锚点，GitHub 生成规则可解析（本地 CommonMark 预览未能实机验证，`[推断]`）。`docs/README.md` 重写为按使用/方向/架构/历史分组，符合“用户入口优先”。MCP 指南从“自己跑 npm ci/build”改为指向开发指南，避免重复维护命令。`[确认]`

**测试与证据**：无代码测试；文档自述证据中，我复核了可静态验证的部分：交付包内 33 条相对链接全部可解析（与 L42 自述一致）、变更文档 141 条相对链接无断链、截图文件有效且内容与说明相符、“HEAD 无 0.1.0-dev.0 混用”（README/capabilities/mcp-guide/settings-guide 与 package.json 一致）。**未能复核**：130 条链接扫描、59/54/58/53/60 文件数、macOS 239 通过等依赖被忽略目录日志与本机环境，标 `[待验证]`。`documentation.md:46` 已如实记录当前 PR CI 因账户付款/额度失败，未冒充三平台回归通过，这点值得肯定。`[确认]`

**问题清单**：

| ID | 严重度 | 位置 | 问题与证据 | 建议 |
|---|---|---|---|---|
| M19-1 | P3 | `README.md:34` | “**Windows preview** — See Releases … extract it and open `ivaraige.cmd`” 未标版本；当时 Releases 上唯一 Windows 包是旧 `v0.1.0-dev.0`（缺少 MCP 与可选令牌安装）。L46／L54／L56 有澄清，故不构成矛盾，但首屏取得路径易与 0.1.0 源码能力混淆。`[确认]` | 在该行直接写 `v0.1.0-dev.0` 或“旧预览包”，与 L56 一致；PR #27 发布后已改为指向 v0.1.0 Release。 |
| M19-2 | P3 | `docs/plan/0.1.0/capabilities.md:14` | “三平台 Node 24 内核 CI”作为当前能力列出，但未注明日期/commit；`documentation.md:15` 的三平台 CI 对应更早的 head，`:46` 说明最终 PR CI 因付款在测试前失败；合流后仅 Windows+macOS 本地跑过（含 MCP），Linux 未跑。`[确认]` | 写“历史上三平台 Node 24 CI（<commit/日期>）；0.1.0 合流后仅 Windows/macOS 本地验证，Linux 待回归”。 |
| M19-3 | P3 | `docs/plan/0.1.0/documentation.md:13,15,35,42` | 链接扫描 130 条、59/54/58/53/60 文件数、macOS 239 通过等“已验证”数字只存在于被忽略目录与本机，无法从仓库复核；文件数随 npm 版本变化虽有解释，但多个数字并列仍易误读。`[待验证]` | 记录具体命令与 npm 版本已部分做到；建议把可复现清单（pack --dry-run 结果指纹）提交到 `docs/plan/0.1.0/` 或 Release 附件并链接。 |

**跨 PR 关联**：#19 堆叠在 #18 之上并在 #18 合入后合并，diff 干净；其新增的 §2.2／ADR-0002 规则反过来暴露 #18 的入口层私有结构问题（M18-1），属“文档先立规矩、代码待跟进”，不算 #19 缺陷。#19 的部分文档（README／capabilities）在 #25 版本切换时已更新；`mcp-guide` 未更新，见 M27-1。

---

<a id="pr-27"></a>

## PR #27 — docs(0.1.0): record verified private release（MERGED，base=cb7e4a4，head=ef597b2，+25/-6，7 files）

**结论**：**C**（1 个 P1、1 个 P2、1 个 P3）。发行记录本身与本地 git 状态一致（tag、提交、合并顺序、旧 tag 分离均核对通过），文档明确保留 Windows／CI／公开切换／F-A／F-B 未完成，态度诚实；但 **v0.1.0 已发布工件（tag 源码树与 npm tarball）内的 `mcp-guide.md` 仍写着软件版本 `0.1.0-dev.0` 并要求“更新发行包发布前请使用源码构建”**，与本版本、capabilities、README 及“release-documentation-binding 已解决”直接矛盾；发布证据也不可从仓库追溯。这正是本 PR 的职责范围，故判 P1。

**范围与流程**：单 commit、仅 7 个文档文件，范围单一；PR 标题 “record verified private release” 与 diff 一致。`[确认]`

**Cordis/架构**：无代码/架构改动。

**设计一致性／版本口径**：
- 本地可核对项全部通过：`v0.1.0` 为 annotated tag（tagger 2026-10-17），解引用 `cb7e4a4`；`cb7e4a4` 树与 PR #25 head `4d36624` 完全相同；main 首父链为 `dde75f5(#27) → cb7e4a4(#25) → 3421ba5(#19) → b0afd55(#18)`；tag 内 `package.json` 为 `0.1.0`；`src/mcp.mjs` 已改为 `packageInfo.version`；旧 `v0.1.0-dev.0` 是另一个 commit `a6dcc2b`。`[确认]`
- 版本命名口径在 main 文档层一致：README／README.zh-CN、capabilities、settings-guide、installation-guide 均把 `0.1.0` 与旧 `v0.1.0-dev.0` 分开表述；`public-readiness.md:351` 明确发布不等于 Windows／CI／公开切换／F-A／F-B 完成。`[确认]`

**代码/逻辑/结构**：无代码改动；文档内部数字自洽（69 文件、229→253 通过/1 跳过、50 项许可通知，均与 `public-installation.md:47,76,91` 的前序记录一致）。

**文档/风格**：
- M27-1 是核心问题：`docs/plan/0.1.0/mcp-guide.md` 属于 `package.json` `files`（随 npm 包分发）且存在于 tag `cb7e4a4` 树（源码归档）。第 3 行“软件版本为 `0.1.0-dev.0`”，第 7 行“现有 Windows `v0.1.0-dev.0` Release 附件尚未包含 MCP。更新发行包发布前，请使用源码构建”。在 0.1.0 包内，这同时与 `package.json` 的 `0.1.0`、`capabilities.md:3`“本页描述正式软件版本 `0.1.0`”、README“Source and npm package”矛盾，用户会误判版本并获得错误的安装路径。`[确认]`；`[main 仍存在]`（origin/main 同一文本）。
- `THIRD_PARTY.md:6` 仍写 “The current CLI and WebUI are new implementations for `0.1.0-dev.0`.”，同样随包分发，属同根因的残留旧版本串。`[确认]` `[main 仍存在]`
- 发布前 tag 内 README/installation-guide 仍是“自行构建本地 tarball”的发布前措辞（README 在 cb7e4a4 第 34 行、installation-guide 第 3 行），下载/安装路径只在 PR #27 合入后的 main 文档中才写明；若 Release 正文没有单独说明，下载源码归档的用户会得到“如何自己打包”的说明而非“从 Release 下载”。`[确认]`（Release 正文不可见，`[待验证]`）。

**测试与证据**：
- 可追溯：tag／commit／合并顺序／旧 tag 分离／包版本。`[确认]`
- 不可追溯：Release 非 draft/prerelease 状态、两个附件字节数与 SHA-256、69 文件、253 通过、50 项许可、远端下载摘要复核；文档称日志/证据在 `release-verification.log`、`final-tarball-smoke.log`、`final-license-check.json`、`ivoraige-0.1.0.acceptance.json` 等被忽略目录或 Release 附件中，仓库内没有副本或链接。`[待验证]`
- 结论层面：“随包指南固定在此提交、不随 main 更新”在版本号上是真的，但固定下来的指南恰是发布前文本，这正是 M27-1 的原因。`[确认]`

**问题清单**：

| ID | 严重度 | 位置 | 问题与证据 | 建议 |
|---|---|---|---|---|
| M27-1 | **P1** | `docs/plan/0.1.0/mcp-guide.md:3,7`（另 `THIRD_PARTY.md:6`） | 已发布工件内版本口径错误：mcp-guide 声称“软件版本为 `0.1.0-dev.0`”并要求“更新发行包发布前，请使用源码构建”。该文件在 `package.json` `files` 与 tag `cb7e4a4` 树中；与同包 `package.json` 0.1.0、`capabilities.md:3`、README 及 `release-documentation-binding`（`docs/plan/follow-ups/release-documentation-binding.md:4,38` 已关闭，其验收条件 1 为“发行包中的文档入口对应实际发布的功能和源码版本”）冲突。根因是 PR #25 版本切换未同步该文件，PR #27 的字节/许可/冒烟校验未包含版本串一致性检查。`[确认]`；`[main 仍存在]` | 修正两处文本；已发布的 0.1.0 附件无法就地修改时，发布 0.1.1（或在 Release 正文加勘误并更新 0.1.0 说明）；在打包/发布校验中加入“交付文件禁止出现 `0.1.0-dev.0`（除明确标注旧包处）”的自动检查。 |
| M27-2 | **P2** | `docs/plan/0.1.0/public-installation.md:82-93`；`docs/plan/follow-ups/release-documentation-binding.md:38` | 发布记录的关键证据（非 draft/prerelease、附件大小与 SHA-256、69 文件、253 通过、50 项许可、下载复核）只存在于被忽略目录与私有 Release，仓库无 acceptance JSON／SHA256SUMS 副本、无附件 URL；外部审阅者无法复核，却据此关闭 follow-up。可核对的部分（tag/提交/合并顺序）我已确认。`[待验证]` | 在仓库提交不含敏感数据的 `acceptance.json`＋`SHA256SUMS`（或链接到具体 Release 附件 URL），并在 follow-up 处理记录里写明复核日期与产物 URL。 |
| M27-3 | P3 | tag `cb7e4a4` 的 `README.md:34`、`docs/plan/0.1.0/installation-guide.md:3` | 已发布源码归档内的 README/安装指南仍是发布前措辞（“从开发指南自行构建本地 npm tarball”），未提及该 tag 自身的 Release 下载路径；PR #27 只更新了发布后的 main。`[确认]`（Release 正文未知，`[待验证]`） | 在下一次发布前，让 tag 内容或 Release 正文明确“源码/GitHub tag + 附件下载 + 私有仓库访问条件”；或发布 0.1.1 修正包内文案。 |

**跨 PR 关联**：#27 基于 #25 的 merge commit，无 stack 问题；带出的 P1 根因在 #25（版本切换遗漏）与本 PR（发布校验未覆盖文档版本串）。M27-1 修复会同时修正 tag 内工件需重新发版，故优先级为本组最高。

---

## 跨 PR 综合（本组）

**重复出现的问题与根因**
1. **版本字符串多处手工维护导致漂移**：#18 在 `src/mcp.mjs:21` 手写版本（#25 改为读 package.json）；#25 切换 0.1.0 时漏掉 `mcp-guide.md` 与 `THIRD_PARTY.md`；#27 的发布校验只查字节/许可/冒烟，未查文档版本串，最终让 `0.1.0-dev.0` 进入已发布工件（M27-1，P1）。这是本组唯一 P1，根因是缺少“打包/发布前扫描交付文本中的旧版本串”的机械门禁。
2. **入口层偶发私有结构判断／重复实现**：#18 的 `unitId.startsWith(docId+'.')`（M18-1）与 artifact 读取重复（M18-6），被 #19 同批写入的 §2.2／ADR-0002 规则明确禁止；说明“入口零业务逻辑”需要更明确的检查项（例如入口禁止出现 ID 解析与 file I/O）。
3. **验证证据的边界**：#18/#19/#27 都诚实标注了平台/预算/权限限制，但真实客户端、PDF 回放、Release 附件、三平台 CI 等关键证据都只在本机或私有 Release；文档层面无法区分“已观察”与“自述”，建议统一把 acceptance JSON/SHA256SUMS 纳入仓库或 Release 附件并在记录中给出 URL。
4. **可选能力测试不均衡**：operation 工具测试充分，settings/component 工具只测“缺席”，未测“存在”（M18-2），可选插件的 inject 写错不会被发现。
5. **PR 标题／阶段记录与 diff 的颗粒度**：#18 标题含“冻结导出”但未改导出代码（M18-7 相关的口径问题亦属此类）；#19/#27 范围则很干净。

**架构演进评价**
- #18 整体走对了方向：MCP 不是又一套 server，而是 Cordis 服务 + 能力插件 + 统一注册契约；注册全程可注销、双 transport 共用一个映射、无 PDF/模型分支、错误/任务/取消语义复用内核；这比“在入口里堆 if/else”明显更符合 v2.0 §5、ADR-0002 与 AGENTS 不变式。
- #19 把“插件按可选能力与生命周期划分、组合根认识具体实现、通用层只依赖契约、缺件必须明确不可用”写成 ADR，并同步 AGENTS/01_design，属于把 #18 的实践固化为规则的正向演进。
- 尚存的偏离是“资源身份校验写在 MCP 层”和“artifact 读取两处实现”，属局部而非路线上走偏；按 M18-1/M18-6 修复后与 ADR-0002 完全一致。
- #27 暴露出“架构与文档都对了，但发布工程化门禁不足”的风险：版本一致性应作为打包/发布脚本的一等公民。

**本组 Top 5 优先修复项**
1. **P1 M27-1**：修正已发布工件内 `mcp-guide.md:3,7` 与 `THIRD_PARTY.md:6` 的 `0.1.0-dev.0` 文本，并发布更正说明/0.1.1；在打包/发布校验中加入交付文本的旧版本串扫描。
2. **P2 M27-2**：把发布验收证据（acceptance JSON、SHA256SUMS、附件 URL）纳入可追溯位置，再关闭 release-documentation-binding。
3. **P2 M18-1**：把 unit↔document 归属校验移入内核（`getUnit(unitId,{docId})` 或等价契约），入口只做 URI→参数映射；补负例测试。
4. **P2 M18-2**：新增带 settingsDir/components 的 MCP 测试，覆盖 settings/component 工具的注册、schema 与只读调用。
5. **P3 M18-4/M18-6/M19-2**：HTTP 启动对 MCP SDK 缺失降级而非失败；artifact 读取收敛到内核并加大小上限；能力表补 CI 日期/commit 口径。

---
*本报告仅基于静态审查与本机 git/依赖包证据；未运行全量测试、未访问私有 Release 附件。*
