# PDF 阶段实施计划

2026-10-06：用户指定 PDF 为下一阶段重点，另建 `codex/0.1.0-pdf`，起点为本地 `main` 的 `4702943`。原下一阶段分支已另作他用，本分支不修改或合并其中的工作。软件版本仍为 `0.1.0-dev.0`。

## 交付目标

在重建后的内核中跑通原生文本 PDF 的导入、持久化、翻译、人工审校与 PDF 回放导出。用户能通过 CLI 和现有 WebUI 完成一次完整流程，并在审校后重新导出。PDF、Markdown、JSON 消费同一任务冻结的接受修订；重新导出不调用翻译模型。达到下列验收节点后交付用户体验与 PR，等待用户决定合并。

这是 PDF 子阶段，不代表 M7 全部完成。按用户本次优先级先推进 PDF；MCP 双 transport 仍保留在既有规划中。扫描件 OCR、MinerU 到 BabelDOC 的跨引擎来源映射、EPUB、Zotero 和 RAG 不纳入本次首个 PDF 闭环。双语 PDF 单列验证，通过后才公布该输出能力。

## 实现路线与边界

- 使用 BabelDOC 自身捕获段落与来源绑定，再通过已有译文回放重建。当前 Python 环境锁定 BabelDOC 0.6.4、PyMuPDF 1.26.7 与 Python 3.13；旧实验的 `38d3896dcde9b5a940c62cf5563cadea673a64d3` 仅作方法参考，没有恢复旧业务代码。
- Node 内核只通过 [sidecar 协议 §7](../../requirements/v2.0/03_API-protocol_v2.0.md#7-python-sidecar-协议) 调用 Python：NDJSON JSON-RPC、握手、配置、解析、重建、进度及关闭。PDF 是可选插件；缺少组件或权重时明确报错，纯文本功能继续可用。
- 来源绑定保存页码、坐标、实际请求文本、原文和引擎／配置身份；不能使用随机 `debug_id` 作为稳定键。保留原始 PDF 的受管理副本，避免外部文件修改影响后续冻结导出。
- 模型、凭据、设置、任务和记录继续使用现有 DSH／Cordis 服务。PDF 输出适配器只获得冻结数据与重建能力，不能获得模型服务；关闭 BabelDOC 自动术语抽取等隐含翻译路径。
- 同时检查回调匹配和解析覆盖。回放中失配、缺失、重复、占位符错误或被上游吞掉的异常必须使任务失败；未进入翻译回调的内容应可检查，不能仅凭回调全部成功宣称全文无遗漏。
- 源文件、布局权重和字体复用既有资产与校验结果；不在每次处理时重复下载或扫描整份资产。具体配置和缺失提示在实现时与协议同步。

## 阶段与退出条件

| 阶段 | 工作 | 退出条件 | 当前状态 |
|---|---|---|---|
| P0 路线与范围 | 核对设计、历史证据、依赖与新内核接点 | 明确绑定、覆盖、零模型导出及体验范围 | 已完成；仍按此范围约束后续工作 |
| P1 sidecar 与捕获 | 固定依赖、可选组件装配、子进程生命周期、PDF → 通用 IR | 握手／缺失权重／崩溃错误可识别；原创 PDF 捕获与绑定可重启读回；stdout 只含协议 | 已实现并在 Windows 原生样本中运行；三系统未验证 |
| P2 修订与回放 | PDF 译文约束、冻结来源与接受修订、PDF／MD／JSON 输出 | 重复文本不同位置正确绑定；缺失／错配／占位符失败可见；重导出零模型请求；旧快照内容不随编辑变化 | 内核与 Windows 实际单语回放通过；两页视觉检查见 P4 |
| P3 入口体验 | CLI／HTTP 导入与任务接入、WebUI PDF 导入／页码定位／审校／下载 | 同一内核任务贯穿导入到导出；失败与取消可见；重启后继续使用文档和修订 | Windows 浏览器已完成新 PDF 上传、任务、zh-CN 审校接受、三格式导出及 PDF 下载；重启后同一 store 读回文档、接受修订和三产物 |
| P4 用户验收 | 真实 BabelDOC 样本、视觉检查、运行指南与可审查提交 | 原创样本覆盖重复段落、公式、图注与多栏；实际输出逐页可打开且抽检无错序／裁切／溢出；模型调用数有记录 | Windows 原创样本与浏览器流程已人工验收；两页编辑后 PDF 目检无裁切、溢出或错列，打包分发另属 P5 |
| P5 双语与分发 | 双语 PDF 独立验证、Python sidecar 打包与三系统验证 | 每个公布的格式和平台有实际运行证据；依赖和许可通知随包保留 | 待实施，不能用本机开发环境替代分发验收 |

P1～P4 的 Windows 原生 PDF 流程已走通。P5 的验证结果单独报告，未完成部分明确保留在计划中。

## 验证原则

1. 协议和故障测试使用可控 sidecar；实际捕获、排版和输出必须另跑真实 BabelDOC，不能以模拟测试替代。
2. 原创少页样本先行；需要科研代表页时复用既有材料和解析证据，原件只读，不批量重扫私有文献，也不提交私有内容与运行产物。
3. 验证持久化、并发接受锁、来源变化拒绝、取消与进程退出、快照冻结、同源多输出及导出模型请求为零。只增加能检出实际风险的测试。
4. 真实翻译走现有模型配置，采用少量可区分样本并记录请求与用量；未知用量保持 unknown/null。未经实际检查不声称科学翻译质量通过。
5. 本阶段只在 PDF 分支提交和审查；主目录 `main` 不自动跟随开发中间态。

## 历史证据与当前缺口

- [M1 注入实验](../mvp/m1/pdf-translation-injection.md)：同位置回放和零模型导出已有实验依据；独立短词未进入回调的案例说明必须补充覆盖检查。
- [注入维护方案](../mvp/m3/injection-maintenance.md)：固定官方依赖＋专用进程内薄适配；内部位置 hook 需要版本适配验证。
- [v2.0 设计](../../requirements/v2.0/01_design_v2.0.md)：BabelDOC 自身来源路线、可选 sidecar 与冻结输出约束。

旧实验为方法参考，不计入本分支验收。当前 sidecar 源码位于 `sidecars/babeldoc/`，依赖锁和 Windows 准备脚本分别位于 `requirements.lock` 与 `scripts/setup-pdf.ps1`；使用步骤见 [PDF 工作台指南](pdf-guide.md)。

## Windows 本机实际验证（2026-10-06）

原创原生文本 PDF 经 BabelDOC 捕获、DSH 模型翻译、人工编辑、冻结回放和重启复用；详细记录位于已忽略的 `evaluation/runs/pdf-acceptance/report.json`。首轮捕获 **13 个单位，其中 12 个可译**；PDF 来源覆盖清单揭示一个未进回调的公式。之后的来源审计保留 `E = m c²` 为原文 passthrough，并保留原始抽取文本供核对。重复源句在不同位置绑定，不靠随机 `debug_id`。

真实模型仅在初次翻译调用 **12 次**，DSH 记录输入 **1,798**、输出 **198** tokens；PDF／MD／JSON 同源导出、人工编辑后的新快照、重启后旧快照重放均新增模型调用 **0**。同源 12 单位再提交时全部复用，新增调用 **0**。这些是本机任务与产物记录的结果；不代表科学译文质量或独立发行包通过。

Windows 浏览器另从新上传的 PDF 导入 13 个单位，在工作台选择 `zh-CN` 后快速翻译复用 12 个单位、**0 次**新增模型调用；人工将标题改为“受控测量：浏览器审校”，保存并接受。PDF／MD／JSON 三格式导出成功，共用快照 `4c4fb25994d3dd39e1927f5e520ac1f0.6c2647ed359e4069820682103840d503`；PDF 下载成功。两页编辑后输出经目检没有裁切、溢出或错列，重复句的不同编辑、`E = m c²` 公式和蓝图／图注得到保留。此浏览器验收不覆盖 OCR、其他 OS 或独立安装包。

服务使用同一 store 与 `examples/pdf-windows.json` 重启后，浏览器在 `zh-CN` 作用域读回人工接受标题、12 段已接受修订及三份产物。本分支最终完整 `npm test` **120/120**；该数字不替代尚未运行的三系统 PDF 发行验证。

当前只支持英文原生文本输入到中文**单语** PDF。OCR、双语输出、MinerU 跨引擎绑定、EPUB、Zotero、RAG、资产下载 API、macOS/Linux PDF 运行及三系统打包留在后续阶段。开发配置使用本机 Python 虚拟环境；npm tarball 包含 sidecar 源码、锁文件、准备脚本、示例配置和指南，尚未提供无需 Python 的独立可执行分发包。

## PR #7 审查修正（2026-10-07）

三项反馈均需要处理：公开的 `skip` 决策不应导致 PDF 回放失败；无文档引用的失败导入原件和逐次生成的 BabelDOC 中间目录也不应在常驻工作台中累积。

- PDF 回放接受 `skip`，要求其投影与原始请求完全一致，并保留原文。补充部分接受、多格式共享快照及之后接受译文仍不改变旧快照的回归测试。
- 捕获先使用独立临时文件，验证后在同内容锁下发布与提交；提交失败仅清理本次新增且无持久文档引用的原件。测试覆盖失败、取消、并发共享及已提交后抛错的边界。来源引用检查只发生在失败清理路径，没有新增后台扫描或定期 GC。
- 每次引擎处理的 `run-N` 目录在成功或异常后释放，共享缓存和已复制出去的产物保留。强杀或断电遗留文件的自动回收仍未实现，不能据此宣称任意崩溃下磁盘无残留。

完整 Node 测试 124/124 通过，Python 回归测试 4/4 通过。Windows 真实 BabelDOC 对原创样本执行捕获和 `skip` 回放：13 个单位、12 个回调，12/12 文本检查通过，模型请求为 0；捕获与回放的两个 `run-N` 目录均已清除。本次修正不新增真实模型请求。

## 2026-10-08：同目录多数据库源文件清理修复（PR #10，待合入）

PR #7 已合并，修复基于 `main` 的 `a683f9b308fedc6de19068d11a32e43a7d4dc793`，本地分支 `codex/0.1.0-pdf-source-ownership`。此前 runtime 内的内容锁及本库引用检查不能保护其他数据库：受控测试先让 A 发布并暂停持久化，再让 B 提交相同内容，最后令 A 抛错；修复前读取 B 的来源得到 `ENOENT`。

新来源文件名包含持有独占 store lock 的规范数据库路径摘要，清理所有权因此与引用检查范围一致；同库内容锁及去重继续使用。历史来源和快照按保存的绝对路径读取。具体行为和兼容边界见 [PDF 指南](pdf-guide.md)。

本次 macOS、Node `v24.20.0` 本地验证：

- 原主线新增复现测试：1 个失败，原因是另一数据库已提交的 PDF 源文件被删除（预期红灯）。
- `node --test test/pdf-import-tasks.test.mjs test/pdf.test.mjs`：21/21 通过。
- `npm test`：构建成功，148/148 通过，0 失败、0 跳过。
- `npm run smoke:package`：通过；本地 tarball 的隔离安装、SQLite 重启、CLI/HTTP 设置、Markdown 导出和静态 UI 检查通过。
- 新回归覆盖跨库交错后 B 重启并导出、同库重启后重复导入，以及旧内容命名来源的冻结快照在失败清理和重启后导出。

上述为首次本地验证，PDF 测试使用仓库模拟 sidecar。随后经用户授权推送并创建[草稿 PR #10](https://github.com/KongouAirlines/ivaraige/pull/10)。首轮 Windows CI 暴露测试清理顺序问题：第二数据库未关闭时删除目录触发 `EBUSY`；`f1e6baa` 将关闭操作移入测试的 `finally`，确保先释放句柄再清理目录，本地完整测试仍为 148/148 通过。

`f1e6baa` 的 [PR CI](https://github.com/KongouAirlines/ivaraige/actions/runs/37741893034) 与 [push CI](https://github.com/KongouAirlines/ivaraige/actions/runs/37741887425) 均已成功：Windows、Ubuntu、macOS / Node 24 上的完整 Node 测试和 package smoke 全部通过。旧提交的两轮 CI 已取消。三平台 Node CI 不代表真实 BabelDOC、模型或浏览器视觉验收；这些实测本次未运行。PR 保持草稿，未合并或部署。未新增、推进或解决 follow-up ID。

发布后审查核对了 `createApp` 对配置中 `directory`／`storePath` 的覆盖、规范 store 路径与独占锁的一致性、历史冻结来源路径和失败清理边界。macOS 额外实测不存在数据库的目录软链接、已有数据库文件软链接、相对路径及大小写别名：重开后同源文档和来源路径保持去重，活跃所有者冲突被拒绝，不同数据库仍隔离来源。大小写测试先确认本机两种拼写指向同一 inode，且 `realpath` 返回相同规范拼写；不据此推断所有文件系统行为。定向 store-lock/PDF 套件 29/29 通过。此次未发现需改动运行时代码的新缺陷；来源损坏恢复和公式问题属于既有 Issue #11，不计作本 PR 新引入的问题。

## PR #10 接续修复与 PR #9 兼容（2026-10-08，待合入）

`codex/0.1.0-pdf-source-ownership` 合并了含 PR #9 的 `origin/main`（`fde5ec8`，合并提交 `1044dc4`）。来源恢复、路径边界及搬迁在此分支接续，跟踪 [pdf-source-restoration](../follow-ups/pdf-source-restoration.md)、[pdf-managed-source-containment](../follow-ups/pdf-managed-source-containment.md) 和 [pdf-store-relocation](../follow-ups/pdf-store-relocation.md)。

重新导入通过内容摘要选择本库副本，损坏副本用同目录暂存及 rename 替换。冻结导出在当前受管理根内解析来源，可读取恢复后的本库副本或随数据库迁移的旧副本；持久绑定、修订及快照不改写，其他数据库的旧共享文件不被覆盖。来源 realpath 检查保留原有摘要缓存。仅挂载 PDF 设置页不再要求数据库标识，实际导入仍须有 store 所有者。

Windows / Node 26.7.0：完整 `npm test` 185/185 通过；最终 PDF 导入、回放及设置注册定向测试 31/31 通过；`npm run smoke:package` 通过。以 `1044dc4` 的修复前适配器运行新增恢复／旧快照／搬迁测试，3 项均出现预期失败。测试使用模拟 sidecar；本段不构成真实 BabelDOC 或三平台发行验收。新增真实模型调用为 0，恢复后的冻结导出任务调用为 0。

公式映射和 tracker payload 属于不同的捕获／回放问题，见 [Issue #11](https://github.com/KongouAirlines/ivaraige/issues/11)，另建分支处理。

## Issue #11：公式与回放接续（2026-10-08，待合入）

分支 `codex/0.1.0-pdf-formula-replay` 基于 PR #10 的 `26087a4`，该基线已合并 PR #9 后的 main/fde5ec8。跟踪 [pdf-formula-replay](../follow-ups/pdf-formula-replay.md) 与 [pdf-sidecar-work-cleanup](../follow-ups/pdf-sidecar-work-cleanup.md)。

- 完成后的 tracker 数据按来源位置关联到回调，公式 payload 约束显示映射。相邻公式、重复锚点及富文本 token 的单元测试覆盖可解析和无法唯一解析两种结果；后者在导入前失败。旧无效绑定也在整个翻译任务调用模型前失败。
- 冻结回放在 BabelDOC 排版前恢复原始接受投影，避免上游缩短连续标点。文本核对覆盖公式展开文本，保留页级核对不能证明位置正确的限制。
- Node 为每次 sidecar 启动管理专属工作目录；Windows 取消时终止进程树并等待退出，随后清理。真实测试还发现 BabelDOC 的原件句柄会留在对象循环中；在单次调用边界显式关闭该次通过 high_level.Document 打开的原件，避免全局强制垃圾回收及 Windows EBUSY。

验证结果：Windows / Node 26.7.0 完整 Node 测试 **190/190**，Python 标准库测试 **13/13**，package smoke 通过。Python 回归已加入三平台 CI（不安装 BabelDOC 权重）。

真实 BabelDOC 0.6.4／PyMuPDF 1.26.7 原创两页样本：**14 个单位、12 个可译、2 个带 formula payload 的记录**；包含行内公式、同页重复句及双栏。人工接受修订后完成 skip、PDF／MD／JSON 同快照输出、SQLite 重启及后续编辑后的旧快照重放。新增真实模型调用 **0**，三个导出任务各为 **0**；本轮没有配置翻译提供方。MD／JSON 重放字节一致；PDF 提取文本一致，两页渲染 PNG 分别与重放逐字节一致。四个重复句用不同人工文字标记，其实际输出坐标与对应来源位置相符；连续 20 个句点保留。两页已目检，未见裁切、错列或遮挡，长译文完整。常驻进程关闭后 engine 与 pdf/work 目录为空。

本机证据：`evaluation/runs/pdf-formula-0.1.0/run-6/report.json`、`captured.json`、`text-layout-checks.json` 及相邻 PDF/PNG。复现脚本是 `scripts/pdf-formula-sample.py`（开发依赖 ReportLab）、`scripts/pdf-formula-acceptance.mjs` 和 `scripts/pdf-formula-verify.py`；运行产物保持忽略。

真实采样另外发现部分源行拆分的覆盖问题，已登记 [pdf-partial-line-coverage](../follow-ups/pdf-partial-line-coverage.md)。上述公式验收不代表所有 PDF 结构、富文本真实排版、OCR、双语或三平台原生 PDF 打包通过。
