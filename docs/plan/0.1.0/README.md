# 0.1.0 从头重建实施记录

## 安装与首次启动体验（2026-10-11）

PR #10／#12 已合入 main/4df1d72。`codex/0.1.0-installation` 实施 Windows 基础程序、自带运行时、首次启动引导及按需 PDF 组件，发行源固定为现有私有仓库 Releases；不要求公开源码，不首次下载全部插件。操作见 [安装指南](installation-guide.md)，I0～I4 的实测证据和剩余条件见 [安装记录](installation.md)。2026-10-12 Windows Sandbox 离线文本／PDF 闭环通过，PR #17 待 review；完整安装程序留到 Issue #16，MCP 和双语 PDF 保留后续。

## 下一阶段：PDF（2026-10-06）

按用户指定，以本地 `main` 的 `4702943` 新建 `codex/0.1.0-pdf`，优先推进 PDF 导入、翻译审校与冻结回放导出。Windows 原生文本英译中单语 PDF 的内核闭环、浏览器审校与三格式导出下载均有实际运行证据；两页编辑后 PDF 已目检。范围、阶段、证据与限制见 [PDF 实施计划](pdf.md)，操作见 [PDF 工作台指南](pdf-guide.md)。MCP 仍为待办，旧 MVP 验收不计入本分支。

## PR #6 优化评估（2026-10-07）

在 `f1d9840` 基础上检查模型设置读取与保存实现，仅做局部简化：一次保存复用已取得的提供商目录进行模型匹配，避免第二次 `getBuiltinModels()` 的 `Object.values()` 数组构建；一次已保存模型读取复用同一份 DSH 配置值。没有新增跨请求缓存或持久化层，模型目录默认、旧配置补入列表、保存／切换、超时与 revision 行为保持原设计。未做性能基准，不声称有可感知的提速。

受影响路径的 `node --test test/model-settings.test.mjs test/model-presets.test.mjs` **15/15** 通过，覆盖预设 DSH 校验、多模型保存／切换、真实本机 mock 路由、旧配置读回、重启及复用后无追加调用；未调用真实云端模型。设置窗口改造仍在独立分支规划；[model-settings-partial-save](../follow-ups/model-settings-partial-save.md) 继续待评估，[quarto-qmd-support](../follow-ups/quarto-qmd-support.md) 继续暂缓，本轮未推进或关闭后续事项。优化验证待合入 `main`。

## PR #6 审阅修正（2026-10-07）

修正体验指南的 YAML 表述：头部原样保留、不翻译，含有效头部的文件可正常导入；头部现校验有效 YAML 映射或空文档，拒绝无效／歧义标量及列表，保留完整原文。不可译单位的 sourceText 不再 trim，保持与 locator 范围一致。模型表单手改提供商／模型后撤销旧预设提示，编辑及添加入口清理旧错误；容量字段在发请求前校验配对。Kimi 国内／国际共用凭据引用的影响已写入预设说明。

后续规则页统一为 `docs/plan/follow-ups/README.md`，汇总工具跳过索引页；旧 `deferred.md` 路径仍用于检测其他分支历史格式。两次 DSH mutate 不改为跨插件事务，后续反馈改进见 [model-settings-partial-save](../follow-ups/model-settings-partial-save.md)。本机完整 `npm test` **109/109**，含歧义头部、原文范围、客户端配对和索引页汇总回归；32 文件独立安装包冒烟通过；独立数据库的浏览器检查确认手改提供商撤销旧提示、容量缺项反馈、添加模型清理错误及 Kimi 共享凭据说明，控制台无错误／警告。未调用真实模型。指定 YAML 字段翻译补入 [QMD 后续范围](../follow-ups/quarto-qmd-support.md)，当前头部仍不翻译。代码验证仍待 PR 合入，不代表后续事项已解决。

## 多提供商／多模型设置体验修复（2026-10-06）

固定 DSH 原本已有多提供商路由／多模型声明，本轮补齐保存配置与当前选择的区分。模型列表通过 DSH volatile Config 持久化 provider／model／timeoutMs，端点、模型覆盖、凭据仍由 DSH 原插件管理。设置页支持仅保存、保存并选择、编辑与从列表切换；旧的显式模型和当前选择可读回。切换仅写选择，不改路由；保存活跃模型的新超时不隐式改变当前调用选择。

新增 DeepSeek、Anthropic、OpenRouter、Kimi 国内／国际、OpenAI、硅基流动、Ollama、llama.cpp 与 LM Studio 预设。内置候选来自固定 pi-ai 目录；协议／端点按每个模型继承默认，避免 OpenRouter 混合目录被统一协议覆盖。目录模型容量变更使用 modelOverrides，支持清空覆盖恢复默认；未收录模型通过完整声明的独立自定义路由配置，错误声明在写入前拒绝。自定义模型容量须核对服务实际规格。无认证本地端点可经 DSH 保存非秘密占位凭据 `local`；不自动下载／加载模型。路由级参数仍由同一提供商下各模型共享，修改设置／凭据仍须先暂停排队／运行中的翻译任务。

调研与体验步骤见 [模型设置方案](../../research/model-settings.md)；模型标签与在线目录的后续范围分别见 [model-collaboration-labels](../follow-ups/model-collaboration-labels.md) 和 [provider-catalog-connections](../follow-ups/provider-catalog-connections.md)，当前状态统一在事项文件维护。本轮未新增标签、多模型调度或任务级模型角色。

验证：本机完整 `npm test` **103/103**；32 文件安装包隔离安装、CLI／HTTP 设置、SQLite 重启、Markdown 导出与静态 UI 冒烟通过。新增多提供商／同提供商多模型、仅保存不切换、选择不改路由、旧设置补入列表、超时更新、配置并发锁、恢复目录默认、未知模型拒绝、全部预设 DSH 校验，以及两个本机 mock 端点实际路由切换；重启复用和导出没有追加请求。独立浏览器数据库保存 DeepSeek 与两个 Anthropic 模型，切换、刷新和服务重启读回通过；最终 OpenRouter 预设只保存也通过，控制台无错误／警告。截图保存在忽略目录 `evaluation/runs/model-settings-browser/settings.png`。未调用真实云端模型，不能把配置校验等同于所有供应商真实接入验收；跨系统 CI 本轮尚未运行。

## Markdown YAML 头部兼容（2026-10-06）

分支改名为 `codex/0.1.0-markdown-compat`，从 `fad44c5` 开始处理当前工作台的兼容性问题。Markdown 文件开头的 YAML front matter 不再一律拒绝：识别首行 `---` 与结束行 `---`／`...`，支持 BOM、LF／CRLF，将头部保存为不可译 `other` 单位。头部保持不透明，不执行配置，不翻译其中标题或摘要；正文偏移继续指向原文，冻结导出逐字保留头部。未闭合头部仍明确拒绝。

验证：本机完整 `npm test` **91/91**，新增头部与正文重建、未闭合拒绝、持久化／不可译编辑保护和重启后冻结导出回归。用户提供的论文仅作只读检查，实际 YAML 头部配原创正文的解析／翻译重建通过；整篇按 Markdown 解析仍因 Quarto 引用语法返回 `reference or malformed link/image`，`.qmd` 扩展名及完整 Quarto 支持尚未实现。未修改论文原件、未调用模型。

## 审查线程收尾（2026-10-06）

修正计划导航的旧目录链接、README 的过期 CI 语句、实验归档的远端标签状态及 AGENTS 中的本地标签措辞。存储锁保证限定为支持 SQLite 文件锁的本地文件系统，NFS／SMB 不在保证范围内；没有增加网络挂载探测或分布式锁。锁竞争优先按 SQLite BUSY／LOCKED 数值结果码识别，无数值时兼容原文案；库调用缺失父目录返回带目录信息的 `INVALID_ARGUMENT`。

验证：本机完整 `npm test` **88/88**；新增真实竞争错误文案变更、父目录缺失及退出码检查通过。相关旧链接和矛盾措辞搜索无残留，未调用真实模型。

## Cordis 动态依赖与卸载修正（2026-10-06）

任务执行逐单位解析可选模型服务，启动后挂载或替换模型无需重启任务服务；导出服务缺失时返回明确组件错误，导入与已接受译文复用仍可独立运行。任务插件卸载时中止在途调用、等待收尾、释放 jobs controller，并拒绝尚在等待的调用。Records 使用 Cordis 同一 effect 内的有序清理，先注销服务并等待依赖方卸载，再关闭文档 domain，不反向依赖 Tasks。

显式正常关闭仍持久化暂停状态。整个 Context 的清理由 Cordis 并行执行，DSH 存储也可能开始关闭，因此该路径不再追加任务状态写入；已提交的修订和断点保留，重新挂载／启动时把未完成任务恢复为暂停。未落库的模型响应不作为已完成翻译。性能校验优化见 [records-update-validation](../follow-ups/records-update-validation.md)，本轮未删减数据边界校验。

验证：本机完整 `npm test` **86/86**，独立安装包冒烟通过；新增模型晚挂载／替换与导出服务缺失检查，以及 Context 直接卸载、Tasks／Records 独立卸载、并发关闭和重复关闭回归。未调用真实模型。

## 文档更新校验性能观察（2026-10-06）

`Records.update()` 每次更新均对整个文档执行 `assertJson` 和 schema 校验，包括只更新任务进度的情况。2026-10-06 的本机隔离探针中，含 1,000／5,000 个单元和修订的记录，当前更新中位耗时约 11.6／66.7 ms；同一 DSH 写入但跳过业务校验的对照约 7.1／49.3 ms。这是合成数据的局部测量，不是端到端翻译性能承诺。

后续范围、处理条件、验收要求与状态统一见 [records-update-validation](../follow-ups/records-update-validation.md)。这里保留当时测量结果，不再维护独立待办状态。

## 编辑保护、修订体积与分页修正（2026-10-06）

- 工作台导出、翻译和事件刷新保留未保存文本及其原始修订锁；保存成功只确认仍处于同一单位／语言的那次编辑。旧操作返回不能覆盖切换后的编辑器。
- 新修订的 basis 保存来源绑定内容摘要和当前单位结构，不复制整篇 Markdown 与 spans；完整绑定仍由文档保存，快照引用不变。兼容已有完整绑定 basis 的接受、复用与断点校验；旧修订不做批量迁移，原有占用不会自动缩小。
- CLI 的 revisions、snapshots、artifacts 列表一致传递 `--cursor`／`--limit`，通过真实持久记录逐页读取验证。

本机完整 `npm test` **80/80**。增长回归采用约 92 KB、1,000 段 Markdown，1,000 个 basis 总序列化体积小于原文的 10 倍；另验证新旧修订重启后的复用与冻结快照。浏览器原创双段样本中，未保存文本经导出和其他选段翻译后保持原样，随后保存成功；未调用真实模型。

## PR #4 review 修正（2026-10-06）

- SQLite 启动前取得独占所有权；独立 `.owner.sqlite` 仅作进程协调，业务记录仍由 DSH 保存。第二个内核返回 `CONFLICT` 并提示使用 `--url`；正常退出、启动失败及进程崩溃均释放锁。规范化与符号链接路径共享锁；已有硬链接的数据库明确拒绝打开。不要删除使用中的锁文件。
- 远程 CLI 默认等待任务结果，失败／取消返回 4／5；`--no-wait` 显式返回任务句柄。多格式导出不接受单一 `--out`。输出能力来自已安装适配器。
- 内部错误与任务失败保留关联 traceId 和本地原因栈；响应不返回供应商原始错误。队列调度拒绝有终端处理。WebUI 容忍非法 hash，任务操作局部刷新，进度事件合并刷新。
- 实施记录按 `0.1.0` 命名，明确请求级 profile 与术语装配尚未实现；修正历史归档链接、版本说明及 DSH 构建依赖来源。远程 `v0.0.0` 标签已核对，解引用为 `27eec14`，与归档分支一致。

本机 Windows／Node 26 完整 `npm test` **74/74**，包含子进程争锁、崩溃恢复、符号链接与硬链接验证；31 文件安装包的隔离安装、持久化、设置、CLI／HTTP 和静态 UI 冒烟通过。浏览器以非法 hash `#/%E0%A4%A` 打开独立测试服务，正常显示主页且无控制台错误。此轮未追加真实模型请求。macOS 首轮因测试未规范化临时路径而失败，修正后以 [Node 24 三系统 CI](https://github.com/KongouAirlines/ivaraige/actions/runs/37446841344) 为远程验证记录；该运行对应代码与测试提交 `66cc05f`。

日期：2026-10-03。用户要求新分支抛弃绝大多数旧代码、保留经验与部分实践方法，并先拉取最新版本。分支：`codex/restart-v2`；起点：最新 `origin/main` 的 `12b8f37`。

以 [v2.0 后端设计](../../requirements/v2.0/01_design_v2.0.md)、[UI 设计](../../requirements/v2.0/02_UI-design_v2.0.md)和 [API 协议](../../requirements/v2.0/03_API-protocol_v2.0.md)为实施基线，沿用 C1～C8，不另行制定替代产品规划。需求 v1.0 及术语范围补充继续有效。

## 重启范围

移除旧内核业务实现、旧 CLI 和对应测试，以及旧 M2 验收脚本；新业务从最小内核开始编写。保留 `src/dsh-bridge.ts`、固定源码准备与构建脚本、依赖锁和许可处理。这是已验证的基础设施接入实践，不是保留旧业务层继续修补。

历史文档与原创样本保留为参考；旧 `experiments/` 验证工具与示例模型配置移至独立归档分支，不装配为新生产功能。私有原件、解析结果、对齐集和运行结果保持原位。新内核不自动迁移旧业务记录或实验词库。历史文档中指向已删除源文件的链接，可在 `v0.0.0` 查看相应文件，历史验收结论不追改为新内核验收。

保留的实践：

- 基础设施复用固定 DSH 插件与 vendor Cordis，保留构建许可通知；不重写现成模型、凭据、设置、存储与任务功能。
- 解析与输出独立注册。核心只处理通用单位和不透明来源绑定；MinerU 到 BabelDOC 的跨引擎关联保持未验证状态。
- 译文复用要检查实际适用性；更换模型不静默覆盖已接受版本。输出只能消费冻结清单，不能取得模型服务。
- 术语先筛适用范围，后匹配义项，库优先级不越过范围。词库结构仍待研判。
- 快速模式与精翻模式区分版本选定策略，样本专用修补不进入默认装配。验证选有区分度的小样，复用已有解析缓存。

## 实施顺序与进度

| 阶段 | 工作 | 状态／退出条件 |
|---|---|---|
| R0 更新与重启 | 获取最新主线，创建新分支，移除旧业务路径，保留方法与资料 | 已完成；固定 DSH 构建及新测试通过 |
| M5 起步 | 最小 Cordis 装配、解析注册表、TXT → 通用 IR、未安装能力如实反映 | 已完成；段落定位、未知格式、通用 IR 校验、输出能力及释放检查通过；不等于 M5 完成 |
| M5 数据闭环 | DSH domain＋SQLite、TXT 导入、修订与适用性、冻结快照及 MD／JSON 导出 | 已完成；17 项测试通过；Windows/Linux/macOS 的 Node 24 构建、测试与临时安装包验证均通过 |
| M5 翻译任务 | 固定 DSH 模型／凭据／jobs，业务队列与持久化断点，快速接受与精翻草稿 | 已实现；模拟协议测试和 DeepSeek 原创双向小样通过；完整科学质量验收待完成 |
| M5 文本入口 | DSH 设置／profile、Markdown 解析、TXT/MD 的 CLI＋HTTP/SSE 路径 | 已实现；63 项测试与三系统安装包冒烟通过，真实 DeepSeek 小样已运行；完整科学质量验收待完成 |
| M6 工作台 | React 文档／任务／设置页与人工审校 | 已完成首次浏览器体验验收；MCP 双 transport 待实施 |
| M7～M8 | 依 v2.0 §10 接入其余主用例与分发验收 | 待实施；不提前宣称 PDF、RAG、Zotero 或三端交付 |

初始重启只完成解析基础阶段，不把旧 MVP 功能计入新实现进度。后续记录复用本表。

验证：Windows、本机 Node.js v26.7.0，复用已有固定 DSH 源码与依赖缓存；完整 `npm test` 构建成功，新套件 6/6 通过。构建沿用固定提交 `639ed015397290b3745d163aafe02ffee4aa3f84`，未改依赖版本、调用模型、解析私有材料或推送。该结果不代表 Node 24、Linux/macOS、三入口或独立发行包已完成验收。

## 旧 MVP 归档（2026-10-03）

按用户决定弃用 M0～M4 的实现，将完整旧代码与实验保留在独立分支 `codex/archive-mvp-0.0.0`，归档提交 `27eec14`，标签 `v0.0.0`。此前 `0.2.0` 只是未发布的标记；归档统一记为软件 `0.0.0`，以区别新开发线，不改写历史提交。当前重建分支的软件版本为 `0.1.0-dev.0`（未发布）；v2.0 仍指设计文档。后续实施分支按软件版本命名，现有 PR 继续使用 `codex/restart-v2`。

归档分支保留旧源码、测试、脚本、实验与配置。当前分支只保留历史文档、原创样本和已决定复用的 DSH 接入方法；旧计划／验收不再驱动新实现。Git 忽略的原件、输出和依赖缓存保持原位，不属于归档标签内容。

归档核对：`v0.0.0` 的 `src/`、`test/`、`scripts/`、`experiments/` 与旧基线 `12b8f37` 无差异；两个分支的包清单／锁文件版本一致。删除旧实验代码后，重建分支 `npm run build` 成功；本轮未改业务逻辑，沿用已通过的新内核测试。

## 文本持久化与冻结导出（2026-10-03）

- 通过固定 DSH `storage-domain + storage-sqlite` 保存记录；按文档聚合，单次 DSH 更新一起提交修订、接受指针、约束、快照或产物元数据，避免依赖跨表事务。一个数据文件由一个内核进程使用。原文导入后不可变，内容改变产生新文档；无外部资源的 TXT 为当前持久入口。
- `baseRevisionId` 校验最新修订，`expectedAcceptedRevisionId` 校验接受指针；不同目标语言独立。当前上下文、实际目标或术语约束集合变化时，旧修订保留但不被自动复用，也不能直接重新接受。
- 复用候选索引在启动时从接受指针重建，并在接受／取消接受后更新；查询按 reuseKey 命中候选后比较完整适用性。模型名称只作来源信息，不参与键。词库结构仍未实现，当前只接收有效约束集合标识。
- 快照保存不可变来源引用及逐单位修订／skip／keepOriginal 决定，摘要创建时计算。MD／JSON 渲染器仅获得冻结数据，无模型服务引用。导出期间的新编辑不改变旧清单，重启后重放旧快照字节一致。
- 缺少适用接受译文默认失败，显式 skip 保留原文；不可译单位保留原文。产物引用或在途导出阻止删除快照；删除产物记录不删除实际文件。输出文件以独占创建方式写入，已有文件不覆盖；多格式中途失败时，已成功的产物继续可查询。
- 内核方法直接异步执行，本阶段尚无 Task/HTTP/CLI 协议封装。示例 `node examples/text-records.mjs` 使用原创短文本和录入译文，产物位于 `evaluation/runs/text-records/`；没有模型调用或私有材料读取。

验证：Windows／Node v26.7.0，完整 `npm test` **17/17**；`npm run smoke:package` 从 tarball 临时安装后完成纯解析、SQLite 导入／接受／JSON 导出与重启读回。固定 DSH 构建闭包为 745 个源码输入，保留第三方许可。Node 24 的 Windows/Linux/macOS CI 矩阵已全部通过构建、17 项测试和临时安装包验证；对应代码提交 `1f7e627`，[运行记录](https://github.com/KongouAirlines/ivaraige/actions/runs/37045467951)。这是当前文本内核 npm 包的验证，不代表模型、三入口、Python sidecar 或独立可执行发行包已交付。

## 模型接入与持久化翻译任务（2026-10-05）

- 显式 `createApp({ store, translation })` 装配固定 DSH `llm + llm-pi-ai + credentials-local + jobs-local`，凭据只通过引用解析；未提供模型配置时保持此前的解析／记录能力。增加 `chokidar` 与 `yaml` 锁定依赖用于 DSH 凭据插件。业务代码只组装翻译请求，不另写供应商客户端、凭据存储或进程内 jobs。
- TXT 翻译按段执行，支持范围选择、快速自动接受与精翻草稿。当前单位自己的适用接受版本优先于跨文档候选，复用不隐藏已有人工草稿；跨文档候选还要验证其原文档中的当前适用性。术语集合装配仍未实现，自动翻译遇到非 `none` 集合时明确失败。
- Task 保存到原有文档聚合中，使用可选字段兼容上一阶段的重建数据库。译文、快速接受指针、完成记录与 cursor 原子提交；模型请求返回时再次检查 basis、最新修订和接受指针，拒绝覆盖并发编辑。一个文档同时只能有一个未结束翻译任务，当前运行队列串行。
- 进程内取消通过 DSH jobs 传入模型请求；暂停在段落边界生效。重启把遗留运行／排队任务转为暂停，显式恢复已提交断点，精翻草稿也不重复请求。完成段落约束改变时拒绝恢复。跨崩溃的未落库供应商请求不能承诺 exactly-once，协议已明确此边界。
- 模型调用尝试先持久化，结果缺失或部分用量未知时累计 token 保留 `null`。截断、超时、空响应不写成接受译文；推理内容不进入译文。任务失败记录保留阶段与单位标识，不保存供应商原始错误或凭据。
- 新示例 `examples/translate-text.mjs` 可使用显式配置运行／恢复任务并导出 MD／JSON；它是内核示例，不代表正式 CLI 已完成。当前只实现翻译 Task，导入与导出仍为直接异步内核方法；DSH 设置页、profile 管理、MD 解析和各入口留待后续阶段。

验证：本机完整构建与套件、临时 tarball 安装验证通过；固定 DSH 闭包为 833 个源码输入。最终套件共 39 项，Windows/Linux/macOS 的 Node 24 CI 均通过完整构建、测试和临时安装包验证；代码提交 `f1c4a0e`，[运行记录](https://github.com/KongouAirlines/ivaraige/actions/runs/37300377753)。模型集成测试只访问本地模拟 HTTP 供应商，已覆盖真实 DSH 适配、凭据引用、错误／取消／超时／截断、译文导出、重启与零追加请求复用，未使用私有材料或外部付费模型。

## DeepSeek 真实小样（2026-10-05）

用户授权使用 DeepSeek 测试后，通过已有 `DeepSeek_API_TOKEN` 用户环境变量向官方 `https://api.deepseek.com` 调用 `deepseek-flash`。模型名与端点核对 [官方文档](https://api-docs.deepseek.com/)。密钥只在启动进程内传递，DSH 通过凭据引用解析，未输出或落盘。`examples/translation-deepseek.json` 是无密钥配置，`scripts/smoke-deepseek.mjs` 是显式运行的真实调用测试，不加入默认测试或 CI。

- 原创英译中 2 段、中译英 1 段；不读取私有材料或旧实验参考译文。经新内核 TXT 导入、Task、DSH llm/pi-ai、快速接受，再导出 MD／JSON。
- 初次翻译 3 次模型调用，供应商经 DSH 返回的用量合计输入 **462**、输出 **140** tokens。两个翻译任务的阶段耗时合计 2577 ms，不含完整进程启动、导出与重启。
- 两个文档分别生成同一冻结快照上的 MD／JSON，共 4 个产物。导出未调用模型；关闭并重开 SQLite 后，两个新任务复用全部 3 段，新增模型调用 **0**。
- 对照检查保留了 300 K、10/20 mT、0.12/0.18、`y = a x + b`、`1.5 ± 0.2`、标准差与 95% 置信区间的区别，以及网格收敛结论的适用限制。未发现明显误译；仅是代理对原创短文本的逐句检查，不是独立专家签认或完整科学语料验收。

当次本地结果：`evaluation/runs/deepseek-restart/report.json`，SQLite 与 4 个产物同目录，全部按既有规则忽略。现脚本默认输出至 `evaluation/runs/deepseek-0.1.0/`；可在启动环境提供凭据后运行 `node scripts/smoke-deepseek.mjs [输出目录]`。已有接受版本会复用，指定新目录才会重新请求。仅增加配置、测试脚本和记录，未修改生产内核。

## TXT／Markdown 工作台集成（2026-10-05，首次体验验收完成）

本阶段在上述内核上装配 Markdown 来源绑定、DSH profile/settings/config-editor 持久模型配置、命名凭据、导入／导出任务，以及共用一套 kernel operations 的 CLI、HTTP/SSE 和 React WebUI。浏览器现有文档列表、双语工作台、任务页、设置页与明暗主题；文本导入、精翻草稿、人工编辑／接受、冻结 MD／JSON 导出走同一持久记录。Markdown 明确支持的子集和拒绝边界见 [阶段记录](markdown.md)；操作方法见 [工作台指南](workbench-guide.md)。MCP、PDF、RAG、Zotero 与词库结构不在本阶段交付范围。0.1.0 的翻译入口不接受 `profileId`；目前只用已保存的模型选择。非 `none` 术语约束集合尚无可用的词库写入或组装 API，内部 `setConstraints` 仅为适用性基础，不代表术语范围算法已实现。

本机初轮 `npm test` **61/61** 通过；独立安装包冒烟在临时目录验证 CLI、WebUI、设置、导出及重启读取。首轮 macOS CI 发现 CLI 符号链接路径判断问题，修复提交 `c28c583` 后，Windows/Linux/macOS 的 Node 24 均 **63/63** 测试及 29 文件安装包冒烟通过，见 [CI 记录](https://github.com/KongouAirlines/ivaraige/actions/runs/37314672867)。依赖锁更新到 esbuild 0.28.2、js-yaml 4.3.2、React 18.3.1／React DOM 18.3.1，加入 DSH profile boot 所需依赖；本阶段 npm audit 为 0 条告警。构建把浏览器资源与 React 许可清单放入 `dist/web/`。

真实浏览器记录在 [首次合并目标](workbench-goal.md)：用原创 Markdown 样本经 DeepSeek 精翻 4 个可译片段，4 次请求输入 368／输出 13 token；代码段未调用模型。随后在浏览器完成草稿人工编辑、接受、历史版本回退与恢复；快速重提同 4 个单位新增模型调用为 0，人工接受版本保持不变。MD 与 JSON 导出成功并共用冻结快照，导出新增模型调用为 0，产物保留原文代码和数学。重启后浏览器从“正在重连”恢复“已连接”，同一数据库与 DSH 模型设置读回，单单位再提交复用且新增模型调用为 0。短片段翻译仍需人工审校：一次 “The value of” 被译为“值”，已人工补成“参数”的正确上下文。完整科学质量验收仍待后续阶段；本次体验目标已通过，见 [PR #4](https://github.com/KongouAirlines/ivaraige/pull/4)，实际 Merge 等用户体验确认。

## 独立设置窗口（2026-10-07，分支验收）

基于主线 `a683f9b`，`codex/0.1.0-settings` 实现 [S0～S3 规划](settings-goal.md)。设置改为独立对话框，具有自己的侧边栏；模型列表进入模型、提供商、凭据的分组编辑。PDF 页面只读取组件状态与准备指引，打开和刷新不启动处理任务。使用方法见 [设置指南](settings-guide.md)。

导航来自内核插件注册，并通过 SSE 与重连刷新；浏览器复用固定 DSH SlotCore 和真实 Cordis plugin fiber，静态构建映射已打包页面，未引入另一套模型／凭据存储。完整 DSH SettingsRoot 的依赖边界与本地窗口适配理由见 [S0 记录](settings-dsh.md)。卸载保留非秘密草稿供核对，禁用提交并清空密钥输入；连续卸载的异步竞态有回归测试。

模型保存与选择分开。revision 冲突和第二步写入失败保留输入、提示实际持久化边界并要求重新读取；不自动覆盖或声称跨命名空间事务回滚。浏览器验收发现并修复新增模型保存后的表单清空、旧读取覆盖写入、取消返回破坏历史，以及确认框背景表单未 inert 的问题。焦点圈定和关闭恢复、重复 Back／取消／再 Back、直接进入／刷新／关闭、深色主题及 390×844 窄屏均已检查，设置内容无横向溢出。

本机 Windows／Node v26.7.0：最终 `npm test` **160/160**，后续旧配置升级及数值输入恢复的相关回归 **16/16**；安装包冒烟 **44 文件**通过，测试包含 PDF／MD／JSON 冻结导出及无追加模型请求。曾在并行全量测试中触发旧 sidecar 测试的 500ms 启动期限及失败清理问题；仅调整测试期限并补齐 cleanup，生产 sidecar 行为未改，随后常规并行全量通过。浏览器使用独立测试库验证两个提供商、同提供商两个模型、保存与选择、真实 revision 冲突重读，以及 TXT、Markdown 和 PDF 工作台的未保存译文、目标语言、选段和来源页码保留。PDF 使用协议夹具，不声称再次完成原生 PDF 排版或多系统 Python 打包验收；本轮未调用付费模型。

本地日志和明暗／窄屏截图保留在忽略目录 `evaluation/runs/settings-0.1.0/`。实现提交 `87de41b` 的 Windows／Linux／macOS Node 24 CI 均通过 161 项测试及安装包冒烟（CI 的 npm 打包清单为 48 文件），见 [运行记录](https://github.com/KongouAirlines/ivaraige/actions/runs/37638427976)。交付 [PR #9](https://github.com/KongouAirlines/ivaraige/pull/9) 等待人工 Merge。最终收尾补充排除禁用字段组内控件的焦点循环，构建和浏览器 Shift+Tab 复验通过，最终提交 CI 以 PR 检查为准。跟踪事项 [plugin-settings-window](../follow-ups/plugin-settings-window.md)、[model-settings-partial-save](../follow-ups/model-settings-partial-save.md) 均为处理中，待人工验收与主线合入后再标记解决。

## 设置 PR #9 审阅修正（2026-10-08）

审阅指出并修复设置浮层下工作台快捷键仍可保存／接受／翻译的回归：窗口打开时暂停 Workbench 的 window 监听，关闭后恢复，工作台不卸载。浏览器已检查设置内 Ctrl+Enter 不保存也不接受，关闭后恢复保存；普通文档链接、设置子页、重复 Back 取消及关闭返回也通过。站内 hash 链接与程序导航统一走历史写入入口；地址校验保留编码供 URLSearchParams 单次解码。

模型身份变更先读取目标提供商和模型配置，避免旧端点、凭据引用、兼容参数及容量跨对象写入；选择已有提供商预设也保留其共享路由。改名按现有添加／更新语义另存模型，原条目保留，界面说明该行为并跳转到实际保存对象。初始加载失败提供重试。部分保存沿用集中错误码映射，未知错误归入 UPSTREAM_FAILURE；updateSettings 改为显式字段契约，拒绝未知字段。

两条审阅意见经核对不属于原有缺陷：构建清理的是旧浏览器重复 bundle，dist/settings-runtime-test.mjs 是测试必需且不进入安装包的产物；旧 savedModels 已用当前选择覆盖推导条目的默认超时，本次仅简化优先级表达并补回归。另补充在途 sync/dispose 测试，重复 dispose 等待同一完整释放过程；保留页 ref 改在提交后的 effect 更新。

新增实际 React 构建产物的 DOM 集成回归，使用仅开发依赖 jsdom（不进入浏览器 bundle），覆盖后台快捷键、草稿保留、普通链接与设置历史、Back/Forward、保存中守卫、畸形地址及加载重试。DOM 环境只为 dialog 提供最小方法，不代替真实浏览器焦点、inert 与布局验收。首轮并行全量发现测试在 React 提交前发起返回；测试改为等待已启用的保存按钮，页面守卫同步到 layout effect，保证提交时即生效。最终本机全量测试 **173/173**、安装包冒烟 **44 文件**通过；三系统 CI 结果随 PR comment 记录。

本次推进 [plugin-settings-window](../follow-ups/plugin-settings-window.md) 与 [model-settings-partial-save](../follow-ups/model-settings-partial-save.md)，待主线合入。PDF 范围另登记 [pdf-managed-source-containment](../follow-ups/pdf-managed-source-containment.md) 与 [pdf-store-relocation](../follow-ups/pdf-store-relocation.md)，均待评估：前者是静态核实的路径归属检查缺口，未找到公开请求直接写入绑定的利用链；后者是绝对路径绑定的迁移限制。未更改 PDF 生产路径，也不把审阅中的其他 PDF 疑点当作已证实缺陷。

Windows CI 补充暴露详情页首次提交后的草稿初始化与输入竞争：将初始化移到 layout effect，使表单可交互前完成基线装载；DOM 测试等待表单实际挂载再输入，继续断言取消 Back 后原值保留。最终 CI 以补充提交后的 PR 检查为准。

### PR #9 未提交凭据保留（2026-10-08）

针对 [API Key 草稿被自动导航清空的评论](https://github.com/KongouAirlines/ivaraige/pull/9#issuecomment-6054894246)，模型保存成功后的详情地址更新保留当前分类和未提交凭据，并提示另行保存凭据。模型 PATCH 不提交 API Key；关闭设置仍触发未保存确认；只有凭据 PUT 成功后才清空该输入，普通离开和插件卸载沿用既有清理规则。实际 React bundle DOM 回归覆盖新增／更改模型身份 × 两种保存按钮，以及取消关闭、显式保存凭据，共四个新增用例。未使用真实凭据或请求模型。
