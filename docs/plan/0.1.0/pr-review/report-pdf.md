# ivoraige PDF 管线 PR 审查报告（PR #7 / #10 / #12 / #24）

> 2026-10-19 归档。以下评分、发现与验证结果来自原审查；“main”指 `dde75f5`，行号对应各节 PR head。后续变化与查阅方式见[归档说明](README.md)。


原报告署名：review-pdf（PDF 管线）。基准：当时的统一审查提纲（见[阅读说明](README.md#reading)）。日期：2026-10-17。
对照 main：`dde75f5`（审查时的只读 main 检出）。
PR head 文件树：临时 worktree，按需 `git checkout --detach <headOid>`；PR #24 用 `git show 3d3f9fc:<path>` 读取。

## 0. 方法与可复核证据

已实际执行（[确认] 含义）：

| 动作 | 命令/方式 | 结果 |
|---|---|---|
| PR #12 Python sidecar 回归测试 | 在 head `e7ce115` worktree 内 `python -m unittest discover -s sidecars/babeldoc -p test_server.py`（Python 3.13.12） | `Ran 12 tests ... OK`，与 PR #12 文档“Python 12/12”一致 |
| PR #24 归档审计测试 | 提取 `3d3f9fc:scripts/audit-release-archives.py` 与 `test/audit_release_archives_test.py` 到临时目录后 `python test/audit_release_archives_test.py` | `Ran 3 tests ... OK`（含 duplicate name warning），与“三个夹具测试通过”一致 |
| PR #24 三份 JSON 映射自洽性 | PowerShell `ConvertFrom-Json` 统计 | 182 资源 / 85 Python / 113 npm / 324 原生；assets 无重复 path、无缺失 notice、`upstream_match` 全 true、sha256 全合法；native 27 项有 RECORD owner；与报告数字一致 |
| PR #24 base 分支交付风险 | `git merge-tree --write-tree HEAD 3d3f9fc…`（只读） | `CONFLICT (add/add): docs/plan/0.1.0/public-readiness.md`，退出码 1 |
| PR #24 是否已过时 | `git log` / `git show 4d36624 -- scripts/build.mjs THIRD_PARTY.md` | main 的 `4d36624`（PR #25，2026-10-17 23:14）已修复 `build.mjs` 空许可段并新增 `test/license-notices.test.mjs`，晚于 PR #24 head（18:41） |
| PR #7/#12 Node 测试、“124/124/190/192/254”数字 | 未运行 | worktree 无 `node_modules`/`dist`，当次审查未安装依赖、未构建共享 worktree → **[待验证]** |
| 真实 BabelDOC / Windows / 零模型调用记录 | 未运行（无组件、无权重、无模型） | 全部为 **[待验证]**，只能核对文档与脚本是否存在可复现路径 |

严重度沿用当时的 P0–P3 分级；`[main 已修]/[main 仍存在]` 按当时快照标注（对照 `dde75f5`）。
“可核对”的 path:line 均相对该 PR head 树。

---

<a id="pr-7"></a>

## PR #7 — feat(pdf): complete BabelDOC PDF workflow P1–P4（MERGED，base=`47fa42d`，head=`4e0537e`，+3437/-105，45 files）

**结论**：**A-/B**。Cordis 边界总体成立：PDF 只在组合根按配置挂载为可选插件（`src/app.mjs:57`），只经 `ivoraige.parse` / `ivoraige.outputs` 注册表接入（`src/adapters/pdf.mjs:155-173`），sidecar 客户端封装在独立模块且仅被 PDF 适配器引用，内核不 import Python；未安装 PDF 时文本路径不受影响（`test/pdf.test.mjs:178-188`）；导出机制上拿不到 LLM（`src/export.mjs:60-66` 不传 ctx，`Pdf` 只 inject `parse/outputs`）。
主要问题：①存在一个 **P1 级确定的失败路径**——占位符显示映射无法唯一确定时被持久化为 `null`，此后 PDF／MD／JSON 三种导出全部失败（后被 PR #12 修复，`[main 已修]`）；②格式知识泄漏进通用层（通用输出适配器 import PDF 模块并按适配器 id 分支、操作门面硬编码 id→format、共享翻译 prompt 写入 PDF 占位符约定、记录 schema 枚举写死 `pdf`），与“适配器只通过契约接入、不污染通用 parse/export 层”的目标有差距 `[main 仍存在]`；③真实 BabelDOC/Windows/零模型结论只存在于 git-ignored 本地产物，仓库内不可复核。价值：把一条完整 PDF 管线（捕获→绑定→持久化→审校→冻结回放）落入既有内核契约，并用 mock sidecar 覆盖了生命周期/取消/失败清理的大部分路径。

**范围与流程**：45 files、+3437 行，同时包含内核服务、WebUI、sidecar Python、测试、脚本、AGENTS/README/THIRD_PARTY/协议规范，属“功能+文档+协议+UI”大 PR；PR head 是 `merge: resolve main integration conflicts for PDF workflow`（把 main 合入 feature 分支），diff 以 merge-base 生成故可审。PDF 能力在合入前没有独立 CI（`npm test` 会用 mock fixture 跑到，但真实 sidecar 不在 CI）。PR body 与 `docs/plan/0.1.0/pdf.md` 对限制的表述较诚实（明确“三系统未验证”“不能用 mock 替代真实引擎”）。

**Cordis/架构**：
- 可选能力与失败语义：`Pdf` 仅在 `createApp({pdf})` 时挂载；未挂载时 `match` 不到 PDF → `INVALID_ARGUMENT`（`src/parse.mjs:75-82`），文本能力照常（有测试）。组件缺失映射 `COMPONENT_MISSING`（`src/sidecar.mjs:19-28`），`status()` 供 capabilities 展示（`src/adapters/pdf.mjs:19,159-161,168-169`）。基本满足“可选插件 + 明确不可用”。
- disposer/生命周期：`ctx.effect(() => () => runtime.client.close())`（`src/adapters/pdf.mjs:157`），注册返回清理函数（`src/parse.mjs:29-40`、`src/outputs.mjs:10-21`），`app.dispose()` 先关 tasks 再 `fiber.dispose()`（`src/app.mjs:93-99`），关闭顺序正确。
- 导出不翻译：`Exporter` 只把冻结数据与 `{format, signal}` 交给 `rebuild`，注释明确“Deliberately unbound”（`src/export.mjs:60-66`）；`Pdf` 插件 inject 只有 `parse/outputs`（`src/adapters/pdf.mjs:173`）。机制成立。
- **通用层耦合（P2，见 P7-2）**：`src/adapters/text-output.mjs:3-6` 通用 md/json 输出适配器 `import { readablePdfText }` 并对 `binding.adapterId === 'babeldoc'` 分支；`src/operations.mjs:66` 用三元式把解析适配器 id 映射成格式（`markdown→md`、`babeldoc→pdf`），`:79` 只对 `format==='pdf'` 走二进制、`:89` 用 `format==='pdf' || /\.pdf$/i` 决定是否异步；`src/tasks.mjs:92` 通用任务服务同样嗅探 `.pdf` 扩展名；`src/records.mjs:53`、`src/protocol.mjs:15` 写死格式枚举。新增一种格式（EPUB 等）必须改内核 4 处以上，说明“注册表化”只做了一半：解析适配器没有 `format` 元数据契约，输出适配器没有渲染钩子契约。
- sidecar 客户端位置：`src/sidecar.mjs` 在 `src/` 顶层的通用目录（P3，见 P7-11），文案与参数全是 PDF 专用（`modelDirs`、`PDF sidecar ...`），目前仅被 `src/adapters/pdf.mjs:5` 引用，未泄漏进其他服务。

**设计一致性**：
- 与 v2.0 §0 C 系列/AGENTS 不变式 7（Python 只经 sidecar）一致；§7 sidecar 表（handshake/configure/parse/rebuild/shutdown、progress 通知、崩溃重启一次）与实现一致（`src/sidecar.mjs:107-181,203-206`；`03_API-protocol_v2.0.md` 也在本 PR 同步更新）。
- 规范同步：本 PR 更新 `03_API-protocol_v2.0.md`（Document.warnings/sourceCoverage、Task.label/result、import 异步语义、capabilities.components、sidecar 错误映射），值得肯定。
- 但规范/实现有一处不一致：PR #7 的规范只写 `-32001`/`-32003 → UPSTREAM_FAILURE`，实现已把 `data.code=PRECONDITION_FAILED` 映射为内核 `PRECONDITION_FAILED`（`src/sidecar.mjs:24-26`），该偏差到 PR #12 才补进规范（P3，P7-10 `[main 已修]`）。
- 不变式 9（跨引擎映射未验证）被正确保留：文档反复声明 MinerU→BabelDOC 未验证，没有虚报。

**代码/逻辑/结构**：
1. **P1：占位符显示映射 `null` 时三种导出全失败。** 捕获侧 `display_mapping()` 在“原文不以首段开头 / 相邻占位符无唯一边界 / 解不唯一”时返回 `{"token": ..., "text": None}`（`sidecars/babeldoc/server.py:74-107`，尤其 `:80-81,:103-104`），并持久化进 `sourceBinding.records[*].placeholders`（`:618-620`）。回放侧 `rebuild()` 要求所有显示值都是字符串，否则 `require(all(isinstance(...)))` 抛 `-32001`（`:802-812`）；MD/JSON 侧 `readablePdfText` 直接抛 `PRECONDITION_FAILED`（`src/adapters/pdf-text.mjs:18-29`，`:25`）。结果：这类记录导入成功、可翻译、可接受，但 PDF、MD、JSON 全部无法导出；人工改译文也救不回来（绑定不可编辑）。这正是 Issue #11 的原始缺陷，PR #12 用 payload/字面 token 回退修复 `[main 已修]`。PR #7 的 fixture 已经预留 `unresolved-mapping` 模式（`test/fixtures/pdf-engine.mjs:16`）却没有任何测试使用（`git grep unresolved-mapping` 在 `test/` 无命中），所以该失败路径未被回归覆盖。
2. **P2：来源路径没有归属/真实路径校验。** `verifySource` 只 `stat` + 读文件 hash（`src/adapters/pdf.mjs:33-41`，PR #7 head），`rebuild` 把 `sourceBinding.sourcePath` 原样写进 docRef 交给 Python（`:144-146`），未校验路径在受管理根内；`sourcePath` 来自可改写的数据库记录。PR #10 修复为 realpath/受管理根/文件名摘要校验 `[main 已修]`，但“校验 → Python 打开”的 TOCTOU 仍未闭环（PR #12 登记 `pdf-source-open-race`，main 状态“待评估”）`[main 仍存在]`。
3. **P2：sidecar 继承主进程环境，与“无凭据”表述不符。** `spawn(this.command, this.args, { stdio: [...], windowsHide: true })` 未指定 `env`（`src/sidecar.mjs:143`），子进程继承内核进程全部环境变量（DSH 凭据可用环境引用）；`server.py:1-5` 与 `src/adapters/pdf.mjs:12` 声称 sidecar “has no translation model, credentials”；`requirements.lock` 实际安装了 `openai`、`httpx`；`server.py:475-491` 的网络隔离只拦非 loopback 的 `socket.connect`，仍允许 `127.0.0.1`/`::1`。内核“输出适配器拿不到 LLM”的机制不受影响（P0 不成立），但“sidecar 无凭据/无模型”的防御纵深与文档强度不足 `[推断；main 仍存在]`。
4. **P2：通用翻译 prompt 写入 PDF 占位符约定。** `src/translation-model.mjs:6` 把 `Preserve any structural placeholders such as <b1> exactly, with the same count and order.` 加入共享 SYSTEM_PROMPT，并把 `PROMPT_VERSION` 升为 v2（`:4`），对所有 TXT/MD 文档生效；`basis` 不包含 promptVersion，所以不会破坏复用，但格式细节应由适配器后置校验（已有 `validatePdfTranslation`）而不应进入全局提示 `[main 仍存在]`。
5. **P2：`parse` 路径产生不可回收的受管理原件。** `PdfRuntime.parse()` 会 `publish()` 到 `pdf/sources/` 但不创建记录（`src/adapters/pdf.mjs:97-109`）；该路径仅能由 `app.parse.parse()` 程序化调用（CLI/HTTP 无 parse-only 入口），属低频但确实的孤儿文件来源，文档只把残留归因于崩溃/强杀（`docs/plan/0.1.0/pdf-guide.md:48`）`[推断]`。
6. **P2：依赖完整性只锁版本不锁哈希。** `sidecars/babeldoc/requirements.lock` 为 `name==version`；`scripts/setup-pdf.ps1:20` `uv pip install -r $lock` 未使用 `--require-hashes`；PR #24 的实包审计也独立指出“锁文件没有 wheel 身份／摘要”（`docs/plan/0.1.0/pdf-license-audit.md:99`）。开发环境供应链完整性弱于“pinned”表述。
7. **P3：** `parse()` 与 `import()` 代码近乎重复（`src/adapters/pdf.mjs:97-131`）；`status` 一旦 `unavailable` 无复位路径（`:19,24-30`）；`verified` 缓存 Map 无上限（`:17,40`）；`sidecar.mjs` 的错误文案/`modelDirs` 使模块不可被其他格式复用（`:9-17,31-49`）；7 MiB 上传限制只在前端（`web/app.jsx:61`）而服务端是 10 MiB body（`src/http.mjs:50`），口径靠 base64 膨胀率间接对齐，文档未写清。

**文档/风格**：
- 中英文一致、术语正确、限制写得很具体（三系统/OCR/双语/跨引擎都在“未验证”栏），未发现“把 mock 当真实引擎”的表述：`docs/plan/0.1.0/pdf.md:57` 明确 “该数字不替代尚未运行的三系统 PDF 发行验证”。
- **P2：可核对性不足（P7-6）。** 多个“实测”结论的唯一证据是 git-ignored 的 `evaluation/runs/pdf-acceptance/report.json`（`docs/plan/0.1.0/pdf.md:51-57`、`docs/plan/0.1.0/pdf-guide.md:50`；`.gitignore:3` 忽略 `/evaluation/runs/`）。仓库内可复核的只有 `scripts/smoke-pdf.mjs`（能真正拦截 `llm/stream` 计数，`:25-30`）与 `scripts/pdf-sample.py`，需要本机组件与（若翻译）模型授权；CI 不跑 PDF 真实路径。按 AGENTS “Evidence over assertion”，建议提交脱敏的 evidence JSON（单位数、回调数、模型调用计数、run 时间、文件哈希）或在文档里给出可粘贴的日志摘要。
- P3：AGENTS/README 以分支名 `codex/0.1.0-pdf` 描述“当前”能力（`AGENTS.md` Current state 段），合入 main 后成为历史分支名；本次 main 对照仍可见。（PR #7 同时更新 AGENTS/README/THIRD_PARTY，使 feature PR 范围偏大。）

**测试与证据**：`test/pdf.test.mjs`（绑定持久化、三格式同快照、旧快照不变、占位符校验失败、无 PDF 文本可用、取消重建）、`test/pdf-import-tasks.test.mjs`（进行中可见/取消/排队/失败清理）、`test/sidecar.test.mjs`（握手、崩溃重试、取消、协议非法）、`test/pdf-entries.test.mjs`（配置解析、二进制边界、状态、HTTP、CLI mock）覆盖了主要分支，断言是行为级的（不是只断言“函数被调用”）。缺口：无“显示映射歧义 → 导出失败”回归（对应 P1）；“零模型调用”在单测中以 `task.stats.llmCalls === 0` 断言（如 `test/pdf.test.mjs:113,131`），而导出任务本就不递增该计数，断言近乎恒真，真正保证来自“未挂载模型插件”的结构性事实与 `scripts/smoke-pdf.mjs` 的 hook（P3）。文档中的 124/124、Python 4/4 均为本机数字 **[待验证]**。

**问题清单**：

| ID | 严重度 | 位置 | 问题与证据 | 建议 |
|---|---|---|---|---|
| P7-1 | **P1** | `sidecars/babeldoc/server.py:74-107,618-620,802-812`；`src/adapters/pdf-text.mjs:18-29`；`test/fixtures/pdf-engine.mjs:16` | 占位符显示映射歧义/无解时持久化 `text: null`，回放侧要求全为字符串、MD/JSON 侧直接抛错 → 该记录 PDF/MD/JSON 全部导出失败，且不可通过编辑修复。fixture 早有 `unresolved-mapping` 模式但无测试。(PR #12 修复，`[main 已修]`) | 保留 PR #12 的回退策略外，补一条“歧义映射仍可三格式导出并带位置警告”的回归；把“完整性门槛 vs 质量诊断”写进协议 |
| P7-2 | P2 | `src/adapters/text-output.mjs:3-6`；`src/operations.mjs:66,79,89`；`src/tasks.mjs:92`；`src/records.mjs:53,177`；`src/protocol.mjs:15` | 格式/适配器 id 硬编码散落通用层：通用 md/json 输出 import `pdf-text` 并按 `babeldoc` 分支；门面用三元式 id→format、只对 pdf 走二进制/异步；任务服务嗅探 `.pdf`；schema 与协议枚举写死。新增格式需改内核多处，违反“适配器只经契约接入”。`[main 仍存在]` | 解析适配器契约增加 `format`/`outputFormats` 元数据与可选 `renderReadable()` 钩子；输出适配器契约增加渲染钩子；operations/tasks 只消费契约 |
| P7-3 | P2 | `src/translation-model.mjs:4,6` | PDF 占位符约定 `<b1>` 写入全局 SYSTEM_PROMPT，并全局升 `PROMPT_VERSION` v2；对所有 TXT/MD 翻译可见。`[main 仍存在]` | 提示补齐由适配器通过 basis/constraints 注入（或后置校验足够时不写进全局 prompt）；避免格式细节污染通用模型层 |
| P7-4 | P2 | `src/sidecar.mjs:143`；`sidecars/babeldoc/server.py:1-5,475-491`；`sidecars/babeldoc/requirements.lock` | 子进程未指定 `env` → 继承内核环境（可能含凭据）；sidecar 文档声称“no credentials”，但依赖含 `openai`/`httpx`，网络隔离放行 loopback。防御纵深与文档措辞不符 `[推断]` `[main 仍存在]` | spawn 时传最小环境（白名单 PATH/TEMP/资产目录）；README 改为“不注入凭据，但继承宿主环境”并说明本地代理风险 |
| P7-5 | P2 | `src/adapters/pdf.mjs:33-41,144-146` | 无路径归属/realpath 校验，`sourcePath` 来自可改写记录；校验与 Python 打开之间仍有 TOCTOU（PR #12 只登记 follow-up）。`[main 已修主体 / main 仍存在竞态]` | 把 `pdf-source-open-race` 从“待评估”升级为带信任边界说明的实现项（打开后按 fd 哈希或约束目录权限并文档化） |
| P7-6 | P2 | `docs/plan/0.1.0/pdf.md:51-57`；`docs/plan/0.1.0/pdf-guide.md:50`；`.gitignore:3` | “真实 BabelDOC 12 次模型调用/重放 0 次/两页目检”等结论唯一证据是 git-ignored 本地目录；仓库内只能手工跑 `scripts/smoke-pdf.mjs`。`[确认]` | 提交脱敏 evidence 摘要（或 CI 可选 job 跑 mock+真实件哈希）；文档链接指向可读摘要而非忽略路径 |
| P7-7 | P2 | `sidecars/babeldoc/requirements.lock`；`scripts/setup-pdf.ps1:20` | 只锁版本、不锁哈希，`uv pip install -r` 无 `--require-hashes`；“pinned Python runtime”完整性弱。`[确认]` | 生成带哈希锁（uv/pip compile --generate-hashes）或记录 wheel 名+sha256 并在 setup 校验 |
| P7-8 | P2 | `src/adapters/pdf.mjs:97-109` | parse-only 路径把原件写入 store `pdf/sources/` 却无记录引用，形成无法回收的孤儿；文档只提崩溃残留。`[推断]` | 非持久化 parse 不 publish（或发布到临时目录） |
| P7-9 | P3 | `src/adapters/pdf.mjs:97-131,19,24-30` | `parse()`/`import()` 重复；`status` 无复位；`verified` 缓存无上限 | 合并两条路径；状态机显式化 |
| P7-10 | P3 | `docs/requirements/v2.0/03_API-protocol_v2.0.md`（PR #7 版 §7）；`src/sidecar.mjs:24-26` | 规范只写 -32001→UPSTREAM_FAILURE，实现已映射 `PRECONDITION_FAILED`，到 PR #12 才补规范。`[main 已修]` | 协议变更与实现同 PR 同步（本项已在 #12 补） |
| P7-11 | P3 | `src/sidecar.mjs:1-17`；`src/records.mjs:53`；`web/app.jsx:61` | sidecar 模块位于 src 顶层且文案/参数 PDF 专用；schema 枚举硬编码；7 MiB 仅前端口径 | 移到 `src/adapters/` 或参数化；文档写清 base64 与 10 MiB 的关系 |
| P7-12 | P3 | PR 范围（45 files） | 功能+协议+文档+UI+Python 一个大 PR，评审与回滚粒度差 | 后续把协议/文档拆出 |

**跨 PR 关联**：P7-1 是 Issue #11 的根因，PR #12 修复并在 follow-up `pdf-formula-replay` 关闭；P7-2/P7-3 在 #10/#12 与 main 均未改（`[main 仍存在]`）；P7-5 的部分边界检查由 #10 补、竞态由 #12 登记 `pdf-source-open-race`（main 仍“待评估”）；P7-7 与 #24 的审计结论（锁文件无摘要）互相印证。

---

<a id="pr-10"></a>

## PR #10 — fix(pdf): isolate and restore store-owned PDF sources（MERGED，base=`fde5ec8`，head=`26087a4`，+370/-20，8 files）

**结论**：**A/B**。范围极小、问题真实、修复方向正确：把受管理原件命名为“规范 store 路径 SHA-256 + 内容 SHA-256”，使“清理所有权”与“引用检查范围”一致，避免两个数据库共享目录时 A 的失败清理删掉 B 的已提交来源；新增 `realpath`/受管理根/文件名摘要校验（`src/adapters/pdf.mjs:39-86`）、同目录临时文件 + `rename` 原子修复（`:125-140`）、旧 digest-only 绑定与“数据库+pdf/ 一起搬迁”的兼容回退（`:69-84`）。测试用可控交错复现了修复前红灯（跨库删除）、修复后重启导出、恢复、并发修复、搬迁与 junction 拒绝，且明确声明使用模拟 sidecar。遗留问题都是边界/可信度级别（P2/P3），没有 P0/P1。

**范围与流程**：8 files：适配器 + app 装配 + 6 条新回归 + 3 个 follow-up + 2 份文档记录，单一职责，好。文档与 follow-up 的“处理中/待合入”表述与 PR 状态一致（当时）。**但**：#10 单独看仍有两处路径契约缺陷（`exportSource` 硬编码父目录名 `pdf`、`this.directory` 未 `resolve`，见 `src/adapters/pdf.mjs:14,66`），它们被移到堆叠 PR #12 修复（`src/adapters/pdf.mjs:15,67`），而 #10 与 #12 的 `mergedAt` 相差 1 秒（`2026-10-11T02:10:56Z` / `02:10:57Z`）——合入时点的 #10 内容并非最终形态，说明“先合 #10 再合 #12”的评审顺序实际被同秒合并掩盖（P3，P10-4；stack 层面见 #12 的 P12-3）。

**Cordis/架构**：没有新增服务/插件；`app.mjs` 只把 `storePath` 作为配置传给 PDF 插件（`src/app.mjs:57-58`），符合“组合根只装配”。PDF 适配器仍是纯注册表接入，未侵入 parse/export 通用层（本 PR 未加新耦合）。`sourceOwner` 只在 PDF runtime 内部使用（`src/adapters/pdf.mjs:14-20`），没有跨服务状态。

**设计一致性**：与 AGENTS“单一内核持有 SQLite”“可重建派生数据”方向一致——受管理原件按 store 归属，跨库不共享新文件，旧文件不被删除/覆盖；与 v2.0 §3.3 冻结快照一致：`resolveSnapshot` 的绑定不被改写，导出时在当前受管理根解析（`:62-86`），搬迁后仍可重放。文档新增的迁移/恢复/兼容边界（`docs/plan/0.1.0/pdf-guide.md` 与 `pdf.md:71-99`）与代码一致。

**代码/逻辑/结构**：
1. `exportSource()` 先做“形状校验”（绝对路径、父目录 `sources`、祖父目录 `pdf`、文件名必须 `<digest>.pdf` 或 `<64hex>-<digest>.pdf`），再 `managedRoot()` 校验 `realpath(storeDir)===resolve(storeDir)` 且 `realpath(sources)===realpath(storeDir)/sources`，最后 `verifySource` 校验 `isFile` 与 `realpath(path)===resolve(path)` + 内容摘要。对手工篡改绑定、目录外 junction、伪造绝对路径都有明确拒绝测试（`test/pdf-import-tasks.test.mjs` 新增块）。逻辑正确。
2. **P3：** 优先选 `owned` 副本时用 `stat(owned)` 判断存在，只要存在（哪怕损坏/0 字节）就不再回退到合法的 `local` 副本（`src/adapters/pdf.mjs:79-84`）；损坏的 owned 副本会让导出失败，而 legacy 副本本可正常重放。建议 `verifySource` 失败且 `local !== owned` 时回退一次。
3. **P3：** 修复路径 `rename(replacement, sourcePath)` 在 Windows 上若另一导出正持有 `sourcePath` 句柄可能 `EBUSY`；抛出的是原始 fs 错误（非 KernelError），经 `safeMessage` 落到通用“Import failed …”文案，且没有覆盖“并发导出+修复重写”的交错测试 `[推断]`。
4. **P3：** `verifySource` 的 stat 先于 readFile，identity 缓存存在极窄的“stat→read 变更”窗口（实际受写权限约束，风险低）；`sourceOwner` 取 `storeLock.path`，若同一路径的 store 被删除重建会复用命名空间（内容摘要保证不会串内容，仅旧副本继续可读）。

**文档/风格**：新文档非常重视“未验证边界”，明确“PDF 测试使用仓库模拟 sidecar；本段不构成真实 BabelDOC 或三平台发行验收”（`docs/plan/0.1.0/pdf.md:97`），符合 AGENTS。**P3 时效问题**：`pdf.md:87` 写“PR 保持草稿，未合并或部署”、`pdf.md:71,91` 标题含“待合入”，而该 PR 早已 MERGED；main 上这些文字仍在（`[main 仍存在]`），读者会误判状态。建议合入后由后续文档 PR 统一改为“已合入（commit）”。

**测试与证据**：新增 6 条测试（`test/pdf-import-tasks.test.mjs` 新增块，diff 位置约 `:177-410`）覆盖：跨库交错失败清理、重启后同源去重、缺失/损坏恢复且绑定不变、并发修复单一副本、旧 digest-only 快照在失败清理与重启后导出、搬迁后新根解析、伪造路径/逃逸 junction 拒绝。断言直接读取磁盘字节（`readFile(binding.sourcePath)`），是有效断言而非只测 mock 行为。缺口：无“修复与并发导出”交错；无真实 Windows 之外的 rename 语义验证（文档已声明）。本机未跑 Node 测试 **[待验证]**。

**问题清单**：

| ID | 严重度 | 位置 | 问题与证据 | 建议 |
|---|---|---|---|---|
| P10-1 | P3 | `src/adapters/pdf.mjs:79-84` | owned 副本存在但损坏时不回退合法 local 副本 → 导出失败（本可成功）；仅在“损坏的 owned + 完好 legacy”同时存在时触发 | `verifySource` 失败且 `local!==owned` 时回退 local 一次，并保持摘要校验 |
| P10-2 | P3 | `src/adapters/pdf.mjs:125-140` | 并发导出持有 `sourcePath` 时 Windows `rename` 可能 EBUSY，错误未分类；无交错回归 | 捕获 EBUSY 映射为 CONFLICT/PRECONDITION_FAILED 并重试或提示；补交错测试（Windows 限定） |
| P10-3 | P2 | `src/adapters/pdf.mjs:33-49` + `pdf-source-open-race` | realpath+摘要校验与 sidecar 打开之间仍有 TOCTOU；PR 文字中的“来源不可变”应限定为“本地可信文件系统内的意外修改防护” `[确认代码/推断威胁模型]` `[main 仍存在]` | 在文档与 follow-up 中写清信任边界；如需闭环，打开后按句柄校验或改用只读副本策略 |
| P10-4 | P3 | `src/adapters/pdf.mjs:15,66` | #10 自身仍硬编码 `pdf` 目录名且未 `resolve(directory)`，靠堆叠 PR #12 修正；#10 单独合入时内容不完整 | 本应由 #10 自带这两处（评审意见应留在原 PR），或明确 stack 合入顺序与依赖说明 |
| P10-5 | P3 | `docs/plan/0.1.0/pdf.md:87`；`:71,:91` | 已合并文档仍称“草稿、未合并/部署”“待合入”，main 仍在 `[main 仍存在]` | 合入后统一状态措辞，保留“当时结论”作为历史段 |

**跨 PR 关联**：#12 基于 #10（同一分支叠加）并吸收 #10 的两条路径契约修正；#12 的 `pdf-source-open-race` 承接 P10-3；`pdf-source-restoration`/`pdf-managed-source-containment` 在 main 已由 PR #17 记录关闭（main follow-up 状态“已解决”），`pdf-store-relocation` 仍“处理中”。

---

<a id="pr-12"></a>

## PR #12 — fix(pdf): preserve formula payloads and frozen replay（MERGED，base=`26087a4`（#10），head=`e7ce115`，+1031/-97，28 files）

**结论**：**A-/B**。这是本组工程质量最高的一笔：按来源位置在 tracker 完成后关联 payload（`complete_callbacks`）、公式/富文本/未知 token 的显示回退（`payload_displays`、`display_mapping`）、在单次调用边界显式关闭 BabelDOC 打开的原件句柄（`source_document_factory`/`close_source_documents`）、Node 为每次 sidecar 启动分配独占工作目录并在进程退出后回收（`src/sidecar.mjs:22-46,178-185,314-334`）、Windows 取消用 `taskkill /T /F` 终止进程树、导出诊断（`evidence.warnings`）经输出适配器持久化到 Artifact/Task/事件/WebUI/CLI/HTTP。它修复了 P7-1 与 #7 的工作目录泄漏，并新增 Python 标准库回归进三平台 CI。
主要问题：①把“回放 PDF 文本提取未匹配”从**硬失败**降级为**非阻断警告**，与计划文档仍保留的“缺失…必须使任务失败”直接矛盾，且未更新该不变式（P12-1，`[main 仍存在]`）；②通用输出层引入隐式的“对象结果”契约（`{content,warnings}` 靠 duck-typing 识别），契约没有落到 Outputs 服务与适配器文档里（P12-2）；③堆叠与同秒合并的交付节奏（P12-3）。没有 P0/P1。

**范围与流程**：28 files，含 sidecar Python 173+ 行、Node sidecar 生命周期、Exports/Records/Tasks 契约、CI、两份验收脚本、5 个 follow-up、协议规范与 WebUI。堆叠在 #10 上：`docs/plan/0.1.0/pdf.md:125-131` 说明“PR #10 保持原提交，两个路径契约问题转入 PR #12”，`#12` 的 diff（merge-base=`26087a4`）独立可审，但没有包含 #10 的改动，因此审阅 #12 必须同时信 #10；两 PR `mergedAt` 均在同一秒，等于一次合入两个互相依赖的 PR（P2 交付风险，P12-3）。头提交 `test(pdf): canonicalize temporary roots for direct mounts` 是测试收尾提交，PR head 包含后续小修，符合“按合入时 head 审查”。

**Cordis/架构**：
- `src/sidecar.mjs` 仍只被 PDF 适配器引用，未进入其他服务；workDir 通过 `configure.options.workDir` 传给 Python（`:232`），是协议内的显式参数，不是共享状态。
- **通用层变更**：`src/export.mjs:67-75,85-97` 现在接受适配器返回 `{content,warnings}` 并把 warnings 写入 Artifact/Task；`src/records.mjs` 的 `taskSchema`/`artifactSchema` 增加可选 `warnings`（`:26,75`）；`src/tasks.mjs:343-344` 完成事件携带 warnings。这些是“数据形状扩展”，没有引入 LLM/格式分支，方向可接受；但“Output adapter 返回类型”的契约由一个 if 判断隐式定义（详见 P12-2）。
- `web/app.jsx` 新增 `ArtifactItem` 与任务提示展示（React 转义，无 XSS）；`.github/workflows/kernel-smoke.yml:23-26` 新增 Python 3.13 + sidecar unittest，值得肯定（此前 Python 回归不在 CI）。

**设计一致性**：
- 协议规范同步得好：`03_API-protocol_v2.0.md` 增补 `Task.warnings`/`Artifact.warnings`/`task.succeeded.warnings`、`evidence.warnings` 流转、`workDir` 语义、`-32001/-32003 + data.code=PRECONDITION_FAILED` 映射、payload 关联/回退策略、`skip` 语义（diff 位于 §2/§4/§7）。
- **P12-1（P2）**：`docs/plan/0.1.0/pdf.md:17` 仍是“回放中失配、缺失、重复、占位符错误或被上游吞掉的异常必须使任务失败”，而 `server.py:168-183` 的 `pdf_text_checks` 只产生 `present=false` 警告，`:953-961` 把它们写进 `evidence.warnings`，README 也改称 “informational”（`sidecars/babeldoc/README.md:51-53`）。PR 文档解释为用户要求“只修接入时机/来源关联/生命周期，不修补上游解析/排版”（`pdf.md:117-123`），理由成立，但计划不变式与验收口径未同步 → 读计划的人会以为导出被文本提取结果否决。main 上 `pdf.md:17` 未改 `[main 仍存在]`。建议把该行改成“完整性门槛（来源/请求/token 顺序/决策/未消费记录）必须失败；页级文本提取/排版差异属于质量诊断，必须出现在 warnings 中并要求目检”，并在测试里固定两侧边界。
- 来源/占位符/决策校验仍严格：`rebuild()` 逐项校验 `unit.sourceText===requestText`、决策类型、`skip` 字面一致、token 序列一致、回调计数一致（`server.py:820-920`）；`complete_callbacks` 要求每个回调都有唯一位置、`preparedInput` 变化只降级 payload（`:74-94`）——这些与不变式一致。

**代码/逻辑/结构**：
1. 生命周期修复质量高：`#start` 先建工作目录、`closed/cancelRequested` 检查后清理并退出（`src/sidecar.mjs:178-193`）；`session.closed = childClosed.then(termination → cleanup)`（`:200-207`）；`#stopSession` 在 Windows 用进程树终止并保留 fallback（`:314-334`）；`close()` 等待 active 清理并在清理失败时抛出（`:112-131`）。测试覆盖正常关闭/崩溃重试/启动失败/取消/无子进程，含 Windows descendant 专项（`test/sidecar.test.mjs:160-260` 新增）。
2. `display_mapping` 的回退策略（`server.py:124-166`）：先唯一字面对齐 → 否则公式 `formula_chars` / 富文本成对 token 空显示 / 字面 token，并在 `uncertain` 中记录 `payload` 或 `literal token`；Node 侧 `readablePdfText` 增加 `placeholderPayloads` 回退与字面 token（`src/adapters/pdf-text.mjs:21-29`）。行为与文档一致（`pdf-guide.md:48`）。
3. **P12-2（P2）**：`src/export.mjs:67-69` 用 `rendered !== null && typeof rendered === 'object' && !Buffer.isBuffer(rendered)` 识别包装对象；`Outputs.register` 只校验“有 supports/rebuild”（`src/outputs.mjs:10-21`），没有记录返回值形状。第三方/未来输出适配器返回对象（例如 `Uint8Array`、流、元数据对象）会被误判为 `{content}` 包装并报 “invalid content”；协议只在 sidecar 段落写了这个形状。建议在 `Outputs` 契约/注释与 `03_API-protocol` 的“输出适配器”处固化 `string | Buffer | {content, warnings?}`，或在 `supports` 之外增加 `resultShape`/校验函数。
4. **P3**：清理失败会让 `client.close()` 抛错，进而 `ctx.effect` 的 disposer 在 `app.dispose()` 中报错——可见性是对的，但“一个被占用的临时目录”会让正常关停变成失败；文档只承诺“清理失败明确可见”。建议区分“请求级清理失败（任务失败）”与“关闭级清理失败（记录诊断、不否决关停）”。
5. **P3**：`terminateWindowsTree` 超时 10 s（`src/sidecar.mjs:40-45`），`close()` 期间最长可阻塞 ~10 s + `rm`；`taskkill` 在极简 Windows 容器可能不存在（有 fallback，但会多等一次失败）。可接受，建议文档写清关停时延。
6. **P3**：`pdf_text_checks` 对每个回调单位做页级文本搜索，长文档可能产生大量 warnings，且会被持久化到每个 Artifact/Task 上（`records.addArtifact` 合并 warnings，`src/records.mjs:702-720`），没有去重/条数上限；`evidence.warnings` 无 schema 上限。对超大 PDF 的存储/UI 噪声需要观察。
7. **P3**：`test/pdf.test.mjs` 与 `scripts/pdf-formula-acceptance.mjs` 的“零模型调用”断言用 `task.stats.llmCalls===0` / 无 translation 插件结构保证，其中前者近乎恒真；`pdf-formula-acceptance.mjs` 的 `captured.records.every(...typeof p.text==='string')` 在 #12 后也恒真（`display_mapping` 总返回字符串）。真正的零调用证据是 `scripts/smoke-pdf.mjs:25-30` 的 `llm/stream` 计数（需真实模型授权）和“未挂载模型插件”。

**文档/风格**：PR #12 文档非常克制、区分“历史证据/现行策略/不构成验收”（`pdf.md:101-143`），并主动登记了 4 个 follow-up（formula-replay、sidecar-work-cleanup、source-open-race、partial-line-coverage），符合仓库流程。main 上后续拆分出的 `docs/plan/0.1.0/pdf-development.md`（本 PR 尚未有该文件）逐字继承了“回放仍核对来源请求和 token 顺序；BabelDOC 可能缩写连续标点，PDF 文本提取未匹配时会在导出证据中提示目检，不据此判定导出失败”的描述——即**用户可见文档已按新策略写，只有计划不变式 `pdf.md:17` 仍是旧口径**，进一步印证 P12-1 是文档同步遗漏而非设计分歧。P3：main 上这些段仍标“待合入”（`pdf.md:103,117,125`），合入后未改（`[main 仍存在]`）。P3：`pdf.md:129` 声称“没有引入模型访问或 PDF 专用任务逻辑”，但 `records.mjs`/`tasks.mjs`/`export.mjs` 确实新增了 warnings 字段与形状判断（非 PDF 专属，但属通用契约变更）——措辞可更精确。

**测试与证据**：[确认] 我在 PR #12 head 上用 Python 3.13.12 跑 `python -m unittest discover -s sidecars/babeldoc -p test_server.py` → 12/12 OK，与 PR 文档“Python 12/12”一致（注意本机 `pymupdf` 为 1.27.2.3，测试不触发版本校验）。测试覆盖：相邻公式、重复锚点、富文本、歧义回退、位置关联 payload、文本核对、`-32001/-32003` 保留、来源句柄归属、workDir 清理（Node 侧 102 行新测试 + Windows descendant 专项）。缺口：真实 BabelDOC 的 14 单位/坐标/目检证据仍只在 `evaluation/runs/pdf-formula-0.1.0/run-*`（ignored）**[待验证]**；3 张“Windows/Python 13/13、12/12、190/192”数字为本地 **[待验证]**。

**问题清单**：

| ID | 严重度 | 位置 | 问题与证据 | 建议 |
|---|---|---|---|---|
| P12-1 | P2 | `docs/plan/0.1.0/pdf.md:17`；`sidecars/babeldoc/server.py:168-183,953-961`；`sidecars/babeldoc/README.md:51-53` | “页级文本提取未匹配”从硬失败改为警告，计划不变式行未同步；读计划与读实现/指南会得到相反结论。`[确认]` `[main 仍存在]` | 更新 `pdf.md:17`/P2 退出条件为“完整性门槛 vs 质量诊断”两分；加回归固定两侧边界；保留用户授权的理由链接 |
| P12-2 | P2 | `src/export.mjs:67-75`；`src/outputs.mjs:10-21`；`03_API-protocol_v2.0.md`（§7 之外的输出适配器未写） | 通用层用 duck-typing 识别 `{content,warnings}`，契约未落在 Outputs/适配器文档；非 Buffer 对象/`Uint8Array` 会被误判。`[确认]` | 把返回形状写进 Outputs 契约并在 register 时声明；或显式 `unwrap` 字段名 |
| P12-3 | P2 | 交付节奏（meta：`mergedAt 02:10:56/02:10:57`）；`docs/plan/0.1.0/pdf.md:125-131` | #12 依赖 #10 且吸收 #10 的两条路径契约修正（`src/adapters/pdf.mjs:15,67`），两 PR 同秒合入 → 依据 #10 单独 review 会漏掉这些缺陷，违反“stack 后一 PR 独立可审”的初衷 | 后续 stack 明确“依赖 PR 的修正必须留在依赖 PR”或合并为一个 PR；GitHub 上记录 stack 合并顺序 |
| P12-4 | P3 | `src/sidecar.mjs:22-25,112-131` | 清理失败使 `close()`/`app.dispose()` 抛错；一个被占用的临时目录会让正常关停失败 | 关闭级清理失败降级为诊断（记录到日志/状态），请求级清理失败才否决任务 |
| P12-5 | P3 | `src/sidecar.mjs:28-46`；`src/adapters/pdf-text.mjs:21-29`；`src/records.mjs:702-720` | taskkill 10 s 上限；富文本 token 回退为字面 token 可能进入 MD/JSON（文档已说明）；warnings 无上限/去重 | 文档写关停时延；warnings 去重与条数上限；富文本回退给显式提示 |
| P12-6 | P3 | `test/pdf.test.mjs`（零调用断言）；`scripts/pdf-formula-acceptance.mjs` | “0 模型调用”部分断言近乎恒真（导出不递增 llmCalls；placeholder 断言在回退后恒真） | 用 `app.ctx.on('llm/stream')` 计数（像 `scripts/smoke-pdf.mjs:25-30`）或断言未挂载 model 服务 |
| P12-7 | P3 | `docs/plan/0.1.0/pdf.md:129` | “没有引入 PDF 专用任务逻辑”与实际 warnings 字段/形状变更不完全一致 | 措辞改成“未引入 PDF 专用任务分支；通用输出契约新增可选 warnings” |

**跨 PR 关联**：#12 修复 #7 的 P7-1 与工作目录泄漏、承接 #10 的路径契约与 TOCTOU 登记；其 warnings 契约被 `03_API-protocol` 与 WebUI/CLI/HTTP 消费，PR #17 之后的安装/发行未再改 `src/adapters/pdf.mjs`（main `git log -- src/adapters/pdf.mjs` 停在 `4df1d72`），故 `[main 仍存在]` 的结论对 main 直接成立。

---

<a id="pr-24"></a>

## PR #24 — docs(0.1.0): 核验 PDF 实际发行包许可与对应源码缺口（**OPEN**，base=`codex/0.1.0-public-readiness`（未合入 main），head=`3d3f9fc`，+1222，8 files）

**结论**：**内容 B / 交付 C**（合起来 B-/C）。内容质量高：它没有把“读到了包”写成“许可合规”，明确“未通过发行许可闭环、F-B 未关闭”，逐项列出资源包 182 项的来源/通知、基础 ZIP 的空许可段与六项无独立通知包、PDF EXE 内锁外 setuptools、FFmpeg/PyMuPDF 等原生库与对应源码材料缺口，并给出可复现的只读审计脚本；三份 JSON 映射自洽（我用脚本核对：182/85/113/324、27 项 RECORD 对上、assets 全部 upstream_match），新增的 3 个夹具测试我也实跑通过。交付层面问题严重：base 分支从未合入 main，PR head 含 2 个不在 main 的提交，改为 base=main 会与 main 上同文件的另一实现点产生 add/add 冲突（我用 `git merge-tree` 复现）；PR 长期 OPEN 且内容已被 main 的同日发布（PR #25/#27，`4d36624`）部分超越——`build.mjs` 空段问题已在 main 修复并补了 `test/license-notices.test.mjs`，而本报告仍按修复前叙述。

**范围与流程**：8 files：1 份审计报告、3 份 JSON 映射、2 处文档指针（README/public-readiness）、1 个只读审计脚本（236 行）、1 个测试（121 行）。“docs”标题下带脚本+测试，范围标注略不准（P3）。base 是 `codex/0.1.0-public-readiness`（`fca3c61`，基于 `c8a146d`），而 main 的 public-readiness 内容来自另一条分支（`3936a0c`，PR #19/#25 链）——同一文档的两次落地，导致 PR 无法直接合入（P24-1）。文档自述“本轮不代替 F-A 授权，不改变远端附件、tag、可见性”（`docs/plan/0.1.0/pdf-license-audit.md:3-5`），边界诚实。

**Cordis/架构**：本 PR 不触碰运行时；审计脚本只用 Python 标准库、不解压执行、不跟随归档链接、输出目录原子替换（`scripts/audit-release-archives.py` 的 `inventory_archive()`/`audit()`），与仓库“只读证据”约束一致。没有引入新的构建/运行时依赖。

**设计一致性**：
- 与 `docs/plan/0.1.0/public-readiness.md` 的 F-B（PDF 发行物许可未闭环）一致：报告明确“完成实际读取不等于验收通过，F-B／P2 仍未关闭”，与 main 上 PR #27 的“旧 `v0.1.0-dev.0` tag 和四个附件未修改；F-A 许可与 F-B 旧附件问题仍属原工作包，没有由本次发布代为关闭”一致 `[确认]`。
- 与 `THIRD_PARTY.md` 的关系：main 的 `THIRD_PARTY.md:8-20` 说明 PDF sidecar 单独分发、Windows 安装阶段单独打包 PyInstaller 运行时与资产归档；`:16-19` 声称“Runtime distribution metadata and license files accompany the component”；本报告进一步指出实包缺口（PDF EXE 内 setuptools 130 模块无许可条目、FFmpeg DLL 源码/notices 未闭环、基础 ZIP 3 段空正文）。二者不矛盾，但 **PR #24 没有修改 `THIRD_PARTY.md`**，main 上的 `THIRD_PARTY.md:17-18` “Runtime distribution metadata and license files accompany the component” 在审计结论下属于过度承诺（PDF 运行时许可材料并未闭环）——F-B 未关闭期间应在其上加限制说明/指针（P24-4）。
- 与发行包事实一致：我无法下载 200 MB+ 附件核对远端摘要 **[待验证]**，但报告表格的资产 SHA-256 与 assets JSON 的 `archive` 字段一致（`4b9dc761…`），且审计脚本要求 Release API 的 size/digest 与本地文件逐项一致才继续。

**代码/逻辑/结构**（脚本与测试）：
1. `safe_name()` 拒绝 `\`、绝对路径、盘符、空/`.`/`..` 段、含 `:` 段；重复成员、`declared size` 与实际字节不符、归档根非目录都会失败；symlink/hardlink 只记录、不跟随，`link_review.required` 提示人工复核；文本副本有单文件 1 MiB / 总量 20 MiB 上限且只复制 UTF-8；`audit()` 先写 staging 再 `os.replace`，任何失败删除 staging，不留半成品；「output already exists」拒绝覆盖。设计稳健。
2. **P3**：`safe_name` 未处理 Windows 保留设备名（`CON`/`NUL` 等）与尾随点/空格；文本副本写到 `destination/text/<name>` 时在 Windows 可能 OSError（fail-closed，不影响正确性，但会中断整个审计而非跳过该项）。
3. **P3**：`inventory_archive` 对 `declared` 巨大的成员会完整流式哈希（有“超过声明即失败”保护，但没有总大小/压缩比上限；Release 资产本身可信，风险低）。
4. **P3**：报告中“113 个实际 npm 包根……另有示例／子目录 manifest，未将后者重复算为独立安装包”与 JSON 不符：JSON 的 113 项里含 3 个同名不同版本的真实安装（`@aws-sdk/token-providers` 3.1127/3.1138、`agent-base` 7.1.4/9.0.0、`https-proxy-agent` 9.1.0/7.0.6），不是“示例/子目录 manifest”；JSON 是对的，文档描述应改。

**文档/风格**：
- 报告结构完整（对象/方法、资源包、基础 ZIP、PDF 运行时、对应源码、关闭 F-B 的具体后续、可复现命令），大量使用“内部一致性检查 ≠ 独立上游证明”“候选归属 ≠ 已证明版本/源码”这类限定，符合“evidence over assertion”。
- 链接可核对：`public-readiness.md` 的 F-B 标题锚点存在，`../../../sidecars/babeldoc/asset-licenses/ASSET-LICENSE-STATUS.md`、`scripts/audit-release-archives.py`、`test/audit_release_archives_test.py` 在 PR head 树均存在 `[确认]`。
- **P2（P24-2）：结论已部分过时。** main 的 `4d36624`（PR #25，2026-10-17 23:14，晚于 PR #24 head 18:41）已：为 `@earendil-works/pi-ai@0.87.1` / `standardwebhooks@1.1.1` 落固定 MIT 全文（`scripts/licenses/0.1.0/pi-MIT.txt`、`standardwebhooks-MIT.txt`）、从 `data-uri-to-buffer` README 提取 MIT、无通知即 `throw`（`scripts/build.mjs:65-95`），并新增 `test/license-notices.test.mjs`、在 `THIRD_PARTY.md` 说明“只对新 Node bundle 关闭空段，不改变旧 Windows/PDF 归档”。因此报告的 `pdf-license-audit.md:49-59`（“build.mjs 仍生成空段”）与 `:103`（后续 1）关于“新 Node 包”的部分已不成立；仍成立的是“旧 `v0.1.0-dev.0` ZIP 未重发、PDF EXE setuptools/FFmpeg 材料未闭环”。rebase 时必须更新这一节，否则审计结论会误导读者以为修复尚未发生。
- **P2（P24-3）：新增测试未进 CI。** `.github/workflows/kernel-smoke.yml` 只跑 `sidecars/babeldoc/test_server.py`（`:26`），没有 `test/audit_release_archives_test.py`；报告 §7 给的是手工命令。建议加一行 CI step（纯标准库，秒级）。[确认：我本机实跑 3/3 通过]

**测试与证据**：[确认] `test/audit_release_archives_test.py` 3/3 通过（正常 zip+tar 索引与 license/native 分类、link_review、缺失/摘要失配不留部分目录、越界与重复成员失败）；[确认] 三份 JSON 自洽；[待验证] 四个真实附件的逐文件摘要/`upstream_match`（需联网下载 ~500 MB，本环境不联网）、`evaluation/runs/pdf-license-audit-0.1.0/` 下的 CArchive/PYZ 清点结果。

**问题清单**：

| ID | 严重度 | 位置 | 问题与证据 | 建议 |
|---|---|---|---|---|
| P24-1 | **P1** | PR 元数据 base=`codex/0.1.0-public-readiness`；`docs/plan/0.1.0/public-readiness.md`；`3d3f9fc` 含 2 个不在 main 的提交 | base 分支从未合入 main（`merge-base --is-ancestor` 失败），且 main 的同一文档来自另一提交（`3936a0c`）；`git merge-tree HEAD 3d3f9fc` → `CONFLICT (add/add) docs/plan/0.1.0/public-readiness.md`。长期 OPEN 无法交付本次审计，冲突需人工裁决 `[确认]` | 不建议直接关闭（审计结论对旧附件仍有效且无替代记录）：改 base=main、rebase，把 public-readiness 新增段落重放到 main 版本；或拆成“新增独立审计文件 + main 版本上一行指针”，避免整篇重复落地 |
| P24-2 | P2 | `docs/plan/0.1.0/pdf-license-audit.md:49-59,103` | main `4d36624` 已修复 `build.mjs` 空段、补固定 MIT 文本与 `test/license-notices.test.mjs`、在 `THIRD_PARTY.md` 说明只关闭新 bundle；报告仍写“会为没有许可文件的包生成空段”，对“新 Node 包”已过时 `[确认]` | rebase 时更新 §3/§6.1：新 Node 包已闭环；剩余为旧 `v0.1.0-dev.0` 附件、PDF 运行时 setuptools/FFmpeg/原生源码材料 |
| P24-3 | P2 | `.github/workflows/kernel-smoke.yml:26`；`test/audit_release_archives_test.py` | 新增审计测试没有 CI 接线，只有文档手工命令；回归退化不会被发现（我本机 3/3 通过）`[确认]` | 加 `python test/audit_release_archives_test.py`（或 discover）到 CI；与 sidecar unittest 合并为“python tests” step |
| P24-4 | P2 | `THIRD_PARTY.md:16-19`（main）；未在 PR #24 修改 | main 的第三方声明仍称元数据/许可文件随组件提供，而本审计结论是 PDF 运行时许可/源码材料未闭环；F-B 未关闭期间缺少指向审计的限制说明，读者可能高估合规性 `[确认]` | 在 `THIRD_PARTY.md` 增补“PDF 发行物许可闭环未完成，见 F-B/审计报告”的限制段（可在本 PR 或紧随的文档 PR） |
| P24-5 | P3 | `docs/plan/0.1.0/pdf-license-audit.md`（§3）vs `pdf-license-packages.json` | “另有示例/子目录 manifest，未重复算独立安装包”不准确：113 项含 3 个同名不同版本的真实安装；JSON 正确 | 改描述为“113 个安装实例（含 3 个同名多版本嵌套安装）”，或同时给出去重后的包名数 |
| P24-6 | P3 | `scripts/audit-release-archives.py`（`safe_name`/文本副本） | 未处理 Windows 保留设备名/尾点尾空格；`text/` 副本写入遇到非法名会 OSError 中断整个审计 | 跳过并记录非法/不可写成员（或 sanitize 目标名 + 映射回原名） |
| P24-7 | P3 | PR 标题/规模 | 标为 docs 但含 236 行脚本 + 121 行测试 | 标题/说明写“docs+审计脚本”，或在描述里点明可执行部分 |
| P24-8 | P3 | `docs/plan/0.1.0/pdf-license-audit.md:1-11,111-127` | 复现命令用 `python3`（Windows 文档里应为 `python`）；`gh api` 需要 token，未说明最小权限；CArchive/PYZ 清点依赖 PyInstaller 6.22.3 独立工具环境，但清点产物未提交（只在 ignored 目录）`[待验证]` | 补 Windows 命令与工具环境固定方式；把清点摘要（计数、版本、命令）以 JSON 形式提交 |

**跨 PR 关联**：审计对象是 PR #17 产出的 Windows/PDF 附件，结论直接约束 PR #17/#25/#27 的发行范围；其“锁文件无 wheel 摘要”与 PR #7 的 requirements.lock 问题（P7-7）同根；其“基础 ZIP 空段”已被 main 的 PR #25 修复脚本，但 PR #25 未重发旧附件（PR #27 确认），所以 F-B 仍开；本 PR 与 main 的 public-readiness 落地冲突，属“堆叠/未合入 base”典型。

---

## 跨 PR 综合（本组）

**重复出现的问题与根因**：
1. **“可选插件”做成了“条件分支”，没有做成契约。** PR #7 把 PDF 接进 `parse/outputs` 两个注册表，但同时把 `babeldoc`/`pdf` 写进通用层：`src/adapters/text-output.mjs:3-6`、`src/operations.mjs:66,79,89`、`src/tasks.mjs:92`、`src/records.mjs:53,177`、`src/protocol.mjs:15`，以及 `src/translation-model.mjs:6` 的共享 prompt。根因是解析适配器只有 `id/match/parse`，没有“格式名/输出渲染/提示约束”契约，于是调用方只能硬编码。后续 PR #10/#12 修了 PDF 的内部正确性，但没人回头收拾这层耦合（`[main 仍存在]`）。
2. **验证口径随真实引擎行为漂移，但不变式文档没跟上。** #7 用“占位符显示映射必须完整”导致所有导出失败（P7-1）；#12 按用户要求改成回退+警告并弱化页级文本校验（P12-1），协议规范更新了，`docs/plan/0.1.0/pdf.md:17` 的“缺失必须使任务失败”却没改。后果是“完整性门槛 vs 质量诊断”只存在于实现与 PR 描述里，没有单一权威表述。
3. **“已验证”证据在仓库外。** #7/#10/#12 的真实 BabelDOC、Windows、零模型调用证据全部落在 `evaluation/runs/`（ignored），#24 的实包清单也落在 ignored 目录；仓库内可复核的只有 mock sidecar 测试与需本机组件的手工脚本。文档大多如实标注“模拟/本地”，但结论强度依赖 PR 描述，不符合“evidence over assertion”的可复核要求。
4. **路径/进程安全逐步收敛，但每一步都晚一个 PR。** #7 无路径归属校验（P7-5）→ #10 realpath/受管理根/摘要（好）→ #12 TOCTOU 只登记不修（P10-3）→ #12 工作目录/进程树生命周期（好）。收敛方向正确，剩余风险（校验-打开窗口、子进程环境继承）都有记录但未定信任边界。
5. **堆叠/交付纪律。** #10+#12 同一秒合入且 #12 吸收 #10 的评审修正（P12-3），意味着“按 PR 逐个评审”的假设不成立；#24 挂在未合入的 base 上且已与 main 分叉出 add/add 冲突（P24-1）。历史 PR 的状态文字（“待合入/草稿”）在 main 上大量残留（P10-5；#12 的 `pdf.md:103,117,125`）。
6. **依赖/发行证据缺口相互印证。** `requirements.lock` 无哈希（P7-7）与 #24 的“锁文件没有 wheel 身份/摘要、构建闭包未固定”是同一问题在开发环境与发行包两端的表现。

**架构演进评价**：总体是**向 Cordis 模块化收敛**，没有走偏到 P0：PDF 是真正的可选插件，sidecar 是独立进程协议，文本能力在缺组件时不受影响（有测试），导出拿不到 LLM（机制成立），PDF 输出只消费冻结快照，来源绑定/记录/快照留在共享内核，跨引擎映射始终声明未验证（不变式 9 守住）。演进轨迹：#7 建立了可用的壳与协议，但内部契约粗糙；#10 把“存储所有权”做对；#12 把“引擎生命周期/来源关联/诊断可观测性”做对，工程质量明显上升（Python 回归进 CI、Windows 进程树、workdir 归属都是可复用的模式）。
扣分点集中在维度 A 的“契约化程度”：内核仍在多处知道 `babeldoc`/`pdf` 字符串与“binary = pdf”这一事实，一旦加第二种格式就会暴露为跨层修改；#12 又给通用输出层加了隐式对象返回契约（P12-2），属于“为了诊断信息而在通用层做特例”的苗头。**判断：没有走偏到平行实现或绕过 DSH 的程度，但“可选能力只经契约接入”这一目标尚未达成**，是本组最值得投入的后续工作。

**本组 Top 5 优先修复项**：
1. **PR #24 交付修复**：改 base=main 并 rebase、重放 `public-readiness.md` 段、更新 §3/§6.1（`build.mjs`/新 Node 包已闭环，仅旧附件与 PDF 运行时材料未闭环）、把 `test/audit_release_archives_test.py` 接进 CI（P24-1/P24-2/P24-3）。
2. **把格式契约补进注册表**：解析适配器声明 `format`（及可选 `renderReadable()`），输出适配器声明返回形状与渲染钩子；删除 `src/operations.mjs:66,79,89`、`src/adapters/text-output.mjs:3-6`、`src/tasks.mjs:92` 的 id/格式硬编码（P7-2/P12-2）。
3. **统一验证不变式**：更新 `docs/plan/0.1.0/pdf.md:17` 与 P2 退出条件为“完整性门槛（来源/请求/token 顺序/决策/未消费回调）失败，质量诊断（页级文本/排版/公式显示回退）warning + 目检”，并用测试固定两侧（P7-1/P12-1）。
4. **来源与进程信任边界**：对 `pdf-source-open-race` 给出结论（打开后按句柄校验，或书面限定本地可信目录），sidecar spawn 使用最小环境变量，把“sidecar 无凭据”的文档改为可执行事实（P7-4/P10-3）。
5. **可复核证据**：为真实 BabelDOC/零模型/发行许可三类结论提交脱敏 evidence 摘要（单位数、回调数、模型调用计数、命令、文件哈希），或提供不依赖模型/权重的最小 CI job（P7-6/P12-6/P24-8）。

---

### 附：未完成/待验证清单（不计入 finding）

- 所有 Node 测试数字（#7 124/124、#10 148/185/192、#12 190/192、main 253/254）：本环境无 `node_modules`/`dist` 且当次未安装依赖或构建共享 worktree → **[待验证]**。
- 真实 BabelDOC 0.6.4 / PyMuPDF 1.26.7（本机全局为 1.27.2.3）/ 权重、Windows 实际排版与目检、模型授权调用记录 → **[待验证]**（证据在 ignored 目录）。
- PR #24 四个 Release 附件的远端大小/摘要与逐成员清点（需联网 ~500 MB）→ **[待验证]**；我仅核对了 JSON 自洽性与测试通过。
- #7/#10/#12 的 Windows 专属行为（rename 覆盖持句柄文件、taskkill/taskkill 缺失 fallback）→ 静态推断，未在 Windows 上跑 Node 测试。
