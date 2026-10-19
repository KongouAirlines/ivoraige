# 特性审查报告：PR #5 / #6 / #8 / #9 / #20

> 2026-10-19 归档。以下评分、发现与验证结果来自原审查；“main”指 `dde75f5`，行号对应各节 PR head。后续变化与查阅方式见[归档说明](README.md)。


原报告署名：review-features（特性审查）。基准：当时的统一审查提纲（见[阅读说明](README.md#reading)）。

## 审查方法与证据边界

- 所有行为验证在临时 worktree 内完成（junction 依赖与 DSH 源，仅在该 worktree 内构建）。
- 已实际运行并复现：PR #6 head `a1195dd` 完整 `node --test test/*.test.mjs` → **109/109 pass**（与文档声称 109/109 一致）；PR #9 head `5214028` 完整套件 → **177/177 pass**（文档所称“最终 173/173”之后另加 4 个凭据草稿 DOM 用例，能对上）；`test/markdown.test.mjs` 6/6、`test/model-settings.test.mjs`+`test/model-presets.test.mjs` 15/15（PR #6）、`test/settings-runtime.test.mjs`+`test/settings-navigation.test.mjs` 8/8（PR #9）；用一次性探针验证了模型设置非法输入的 HTTP 错误码映射、follow-up 汇总工具对 main `dde75f5` 快照的读取。
- 对照当前 `main`（本地 main 快照 `dde75f5`，只读）判断“是否已被后续 PR 修复/仍存在”。历史 PR 的结论以“合入当时 head 状态”为准。
- 证据标注：`[确认]` 有代码/实际运行证据；`[推断]` 基于静态推理（已写明前提）；`[待验证]` 需要浏览器/外部 CI 或不存在于本机仓库的提交才能确认。
- 局限：PR #5 head `94c2927`、PR #8 head `3e61548` 的部分对象作证依赖 diff 与 main 对照（本机仓库无该对象时可核对的内容已在文中标注）；PR #9 的“真实浏览器验收”“三系统 CI 计数”只能核对到外部链接和忽略目录描述，无法在仓库内复核。

---

<a id="pr-5"></a>

## PR #5 — 完善跨分支后续事项跟踪与 AGENTS 联动（MERGED，base=4702943，head=94c2927，+354/-12，9 files）

**结论**：B。机制设计合理且有实际价值：把“后续事项”从单文件清单改成“一项一文件 + 稳定 slug ID”，新增只读跨分支汇总脚本（先解析全部 ref 再读树、`--end-of-options`、只读本地已提交快照、不 fetch/不 checkout/不改工作区），并用真实 git 临时仓库测试覆盖了差异、缺失、未提交修改排除、legacy 标题不升格、非法元数据拒绝。与 AGENTS 的联动（“记录不等于授权实施”“合入后才标记已解决”）方向正确。主要问题在测试基础设施（临时 GitHub 仓库建在仓库工作区内，后确认为 Windows 清理失败根因）与汇总工具的两处静默遗漏。

**范围与流程**：单一主题（跟踪机制 + 脚本 + 两条事项迁移 + 文档规则），commit 粒度可读；`npm run followups` 只新增脚本入口，无生产代码影响。范围合适。

**Cordis/架构**：不涉及内核/插件，无架构风险；脚本是纯只读工具，符合“不扫描所有分支、不自动达成状态”的设计取向。

**设计一致性**：与 AGENTS 的“Follow-up tracking”章节、`docs/plan/deferred.md` 迁移、`docs/plan/README.md` 导航一致；把性能观察从“待完成”改成“观察（2026-10-06）”并把状态收敛到事项文件，符合“功能文档/实施记录/事项单一状态源”的约定。`docs/plan/follow-ups/quarto-qmd-support.md` 明确“来源分支合并时应移除旧正文”，PR #6 随后落实，未见双份状态。

**代码/逻辑/结构**：`scripts/followups.mjs` 逻辑清晰，元数据重复/缺失/ID 与文件名不符/非法状态均抛错，`escapeCell` 处理表格转义，dispose 无关。两处遗漏见 F5-2。

**文档/风格**：规则页把状态机（待评估/已安排/处理中/已解决/暂缓/无需处理/重复）与“部分完成保留验收项”“重复保留重定向”写清楚；AGENTS 与规则页存在规则复述，长期有漂移风险（AGENTS 未提状态词表），属可接受的分层引用。

**测试与证据**：新增 4 个测试（本机实测通过）。但 `test/followups.test.mjs:15` 把临时 git 仓库建在仓库根下，且 PR 未加忽略规则；main 中后来登记的 `windows-followups-fixture-cleanup` 记录了 Windows 上 `rmSync` EPERM、可能残留 `.followups-test-*`，与我读到的实现一致 [确认]（main 目前仍未修）。四个测试在另一审查流程的 main 快照中运行耗时约 15s（6.8/3.9/3.1/1.3s），占全套 53s 的约 28%，对文档工具偏重。

**问题清单**：

| ID | 严重度 | 位置 | 问题与证据 | 建议 |
|---|---|---|---|---|
| F5-1 | P2 | `test/followups.test.mjs:15`（另见 `:23`） | [确认] 临时 git 仓库用 `mkdtempSync(path.join(workspace, '.followups-test-'))` 建在仓库工作区内，`finally` 里 `rmSync` 清理；Windows 上目录被 git 进程短暂占用时 EPERM，会留下含嵌套 `.git` 的未跟踪目录并导致套件失败。main 的 `docs/plan/follow-ups/windows-followups-fixture-cleanup.md:7,12` 已把该现象登记为待评估缺陷（2026-10-14，未修）。`.gitignore` 至今无 `.followups-test-*`。 | 改用 `tmpdir()` 建临时仓库；或至少加入忽略规则并对清理做有界重试，失败时显式报错而非静默。 |
| F5-2 | P3 | `scripts/followups.mjs:73`（PR #5 head；main 行为同） | [确认] 汇总只接受 `docs/plan/follow-ups/` 下一层 `*.md`（`/^[^/]+\.md$/`），子目录/其他扩展名被静默跳过；`parseRecord`（`:20-40`）只强制 `ID/状态/实施分支／PR` 三个字段，模板中的 `类型/发现依据/目标分支` 缺失不会报错，也不会被输出。规则页虽声明“前三项供汇总命令读取”，但缺失时工具不提示模板不完整，读者可能误以为记录合规。 | 对子目录/其他文件输出“未纳入汇总”的显式提示；对缺失的模板必填字段给出警告（不必失败）。 |
| F5-3 | P3 | `scripts/followups.mjs:287-296`（ref 列表） | [确认] `--refs` 传入重复 ref 时不去重，输出同 ID 的重复行；`main()` 不做 ref 去重/排序校验。属可用性小瑕疵。 | 对 ref 去重并保持输入顺序。 |
| F5-4 | P3 | `test/followups.test.mjs:14-24,66-89` | [推断] 每个用例都 `git init` 一个新仓库并为每次记录单独 `git commit`，Windows 上 4 个用例约 15s；对“文档工具”而言测试成本偏高。 | 在同一 fixture 中复用仓库/批量提交，减少进程数。 |

**跨 PR 关联**：F5-1 的后果在 main 仍存在，并被后续 MCP/发行阶段的 Windows 测试再次观察到（`windows-followups-fixture-cleanup.md`）。PR #6 把规则页从 `deferred.md` 迁到 `follow-ups/README.md` 并让汇总跳过索引页，是正确续作；PR #9/#10 起的每条新事项都遵守了该结构（我用 PR #5 工具读取 main `dde75f5` 快照，16 条记录全部解析通过）。

---

<a id="pr-6"></a>

## PR #6 — 修复 YAML 头部导入与多模型配置管理（MERGED，base=1b9eca6，head=a1195dd，+934/-58，25 files）

**结论**：B。两件主功能都建立在既有契约上、没有平行实现：Markdown front matter 作为不透明 `other` 单位保留字节、偏移/locator 与原文一致、冻结快照逐字重放（含 BOM/LF/CRLF/`---`/`...`/空文档/未闭合/非映射拒绝），`.qmd` 边界如实说明并登记；多模型设置完全复用 DSH 的 `settings`/`credentials`/`llm-pi-ai` 路由与 revision，`model-presets` 明确只是候选建议而非第二注册表。主要问题是模型表单在“改身份”时把源提供商的端点/凭据引用/容量带到目标提供商（PR #9 已修）、HTTP 请求层对未知字段静默、以及 `compat/reasoningEfforts` 非法值被映射成 500 而非 400。

**范围与流程**：一个 PR 内混合三件事：YAML 修复、多模型设置、以及 follow-up 规则页从 `docs/plan/deferred.md` 迁到 `docs/plan/follow-ups/README.md`（rename + 链接 + 汇总工具跳过索引页）。虽然三者都服务于同期交付，但“跟踪机制迁移”本可独立成 PR，降低评审面 [P3]。文档对“观察到的/推断的/未验证的”区分总体诚实（明确“未调用真实模型”“跨系统 CI 尚未运行”“浏览器检查使用独立数据库”）。

**Cordis/架构**：`ModelSettings` 仍是 `Service`，`static inject=['settings','credentials']`（PR #9 才加 settingsPages）；路由写 `llm-pi-ai`、选择/列表写本项目 volatile Config、凭据写 DSH credentials-local，符合 AGENTS 不变式 6；没有自写 provider 客户端/凭据库/任务队列。设置页仍是 `web/model-settings.jsx` 的单页卡片（当时无插件页面注册），PR #9 再重构为插件贡献页面。`model-presets.mjs:3-4` 的注释“Suggestions only … not a second model registry”与实现一致。

**设计一致性**：`03_API-protocol_v2.0.md` 同步更新了 `savedModels`、`select/selectOnly`、容量/覆盖语义、两次 DSH 写入非原子、`savedModels` 从路由推导等，规范与实现基本一致；`docs/research/model-settings.md` 说明复用依据与边界。`docs/plan/0.1.0/markdown.md`/`workbench-guide.md` 同步了 YAML 行为与 `.qmd` 未支持，未夸大 Quarto。

**代码/逻辑/结构**：
- front matter 解析 `src/adapters/markdown-source.mjs:145-156`：只认首行、支持 `\uFEFF`、收尾 `---`/`...`（禁前导空格，保守但显式），头部进入 `unchanged(...,'other')`；`renderMarkdown` 只遍历可译 spans（`markdown-output.mjs:16-37`），非可译头部的字节由 raw 间隙原样复制，因此“冻结导出逐字保留”是机制而非约定；测试用 4 组换行×收尾符组合断言了 sourceText/偏移/重建 [确认，已运行]。
- 服务端 `src/model-settings.mjs` 的 `savedModels()` 合并“显式列表 + 路由声明 + modelOverrides + 当前选择”，并让当前选择的超时覆盖推导条目；`update()` 校验 timeout/revision/容量配对/目录内外模型，路由写失败后第二次写入失败不谎称事务。
- 表单侧存在跨对象状态泄漏与超时来源问题（F6-1、F6-4），PR #9 的 `formForProviderChange`/`formForModelChange` 修正。
- 请求层校验不足（F6-2、F6-3）。

**文档/风格**：三处新阶段记录（README 第 19/25 行起的 4 个 `##` 段）沿用“最新在前”的既有写法；`evaluation/runs/model-settings-browser/` 的运行目录名违反 PR #8 当天新加的版本命名规则（F6-6）；“新增…配置并发锁”把既有能力写成新增（F6-5）。

**测试与证据**：PR head 实测 **109/109**，与文档最终计数一致；新增 `test/model-presets.test.mjs` 覆盖“预设 → DSH 路由校验/不发起网络请求/不写凭据”、混合协议不覆盖、配对校验、本地占位凭据；`test/model-settings.test.mjs` 覆盖多提供商多模型、仅保存不切换、仅切换不改路由、旧配置补入、目录 modelOverrides、未知目录模型拒绝、容量清空限制、失败不残留 revision；`test/records.test.mjs` 覆盖 front matter 持久化为不可译 + 重启后冻结导出逐字保留，均为有效断言（非 mock 服务端行为，除纯函数测试）。中间阶段计数 91/91、103/103 指向分支上已不在合入树内的早期提交，无法从 head 复现（最终 109 可复现）[P3]。

**问题清单**：

| ID | 严重度 | 位置 | 问题与证据 | 建议 |
|---|---|---|---|---|
| F6-1 | P2 | `web/model-settings.jsx:24-31`（PR #6 head） | [确认] `update(field,value)` 在改 `provider`/`model` 时只清 presetId 与 `reasoningEfforts`，保留 `api/baseURL/credentialRef/contextWindow/maxTokens/reasoning`。用户把 提供商标识 从 A 改为 B（或手改模型 ID 到另一提供商）后保存，服务端会用这些旧值写 `providers[B]` 路由：B 的请求被发往 A 的端点，且 B 继承 A 的凭据引用（若用户又填了 B 的新端点，A 的密钥可能发到 B 端点）。PR #9 新增 `web/model-settings-state.mjs:formForProviderChange/formForModelChange`，先读目标 provider/model 配置再构造表单，并加回归测试；该修复对当时 PR 是正确方向。[main 已修] 由 PR #9。 | 已修：身份变更必须按目标作用域读取；保留“另存为新模型、原模型保留”的提示与测试。 |
| F6-2 | P2 | `src/protocol.mjs:35` + `src/model-settings.mjs:100-103`（PR #6 head） | [确认] `updateSettings` 参数是 `z.record(z.string(), z.unknown())`，`update(input)` 只解构已知字段；因此 HTTP/CLI 传入拼错的字段（如 `baseUrl`、`credentialref`、`contxtWindow`）会“保存成功”但不生效，无 `INVALID_ARGUMENT`。我在 PR #9 head 直接调用服务层探针复现“未知字段被忽略返回 OK”，说明忽略发生在 service 层；PR #6 时协议层也未拦截。[main 已修] 由 PR #9 改为 `.strict()` 显式字段契约并加断言。 | 已修：入口层显式字段契约；建议服务层也拒绝未知键，避免未来直连服务的测试/工具重犯。 |
| F6-3 | P2 | `src/protocol.mjs:41-42`、`src/model-settings.mjs:175-176`（PR #6/#9 head），`src/protocol.mjs:59`（`errorEnvelope`） | [确认] `compat` 与 `reasoningEfforts` 仍是 `z.unknown()`，服务端 `structuredClone` 后直接写路由。非法结构由 DSH schema 抛 `ValidationError`（非 KernelError），`errorEnvelope` 归为 `INTERNAL` → HTTP 500，并要求 `traceId`（同时把 DSH 栈打进失败日志）。实际探针（PR #9 head）：`compat:'nope'` → `httpCode=INTERNAL status=500`；`reasoningEfforts:5` → 同样 500。`03_API-protocol_v2.0.md` §1.3 要求客户端输入错误为 `INVALID_ARGUMENT`。PR #6 把这两个字段从“路由级/声明模型”扩展到客户端可写的覆盖路径，PR #9 的“显式字段契约”只校验字段名未校验值。 | 给 `compat`/`reasoningEfforts` 加结构 schema（或把 DSH ValidationError 统一映射为 `INVALID_ARGUMENT` 并附安全的 `issues`）。该问题在 main 仍存在，属协议偏差。 |
| F6-4 | P3 | `web/model-settings-state.mjs:12`（PR #6 head） | [确认] `modelForm` 的超时回退是 `saved?.timeoutMs ?? settings.selected?.timeoutMs ?? 120_000`：在表单里手改 provider/model 为“未保存的新身份”时，会继承**当前选择**的超时并随后持久化，而不是默认 120s（示例：当前选择 timeout=1000，新建模型被写成 1000ms，易触发请求超时）。PR #9 改为仅当 `provider/model` 与选择一致才用选择超时。[main 已修] | 已修：新身份回退默认超时，并补纯函数回归。 |
| F6-5 | P3 | `docs/plan/0.1.0/README.md:23`（PR #6 head；main:41） | [确认] “验证：…**新增**多提供商／同提供商多模型、仅保存不切换、…、**配置并发锁**…”：`operations.withModelAdmission/changeModel` 与其测试 `test/operations.test.mjs` 在 PR #6 base `1b9eca6` 已存在（`git show 1b9eca6:src/operations.mjs`、`test/operations.test.mjs` 均可见），本 PR 未新增并发锁代码或测试。属把既有能力写成新增。[main 仍存在] | 改为“既有并发/互斥在原有用例下继续通过”，或指明复用路径。 |
| F6-6 | P3 | `docs/plan/0.1.0/README.md:23`（PR #6 head；main:41） | [确认] 新引用的运行目录 `evaluation/runs/model-settings-browser/settings.png` 未带版本后缀，违反 PR #8 在 **同一天更早 4 小时**合入的 AGENTS 规则“run output directories likewise (`evaluation/runs/<name>-0.1.0/`)”；main 仍保留该引用。 | 改名或在规则生效前的历史引用上加注；后续新目录统一 `-0.1.0`。 |
| F6-7 | P3 | `src/adapters/markdown-source.mjs:148-152` | [确认] 拒绝信息只有 `unclosed YAML front matter` / `YAML front matter must be an empty document or valid mapping`，丢掉了 `yaml` 给出的行列与原因（`metadata.errors` 未使用）。实测同一段无效头部只返回这句，用户无法定位。另有未声明的边界：YAML 指令（`%YAML`）位于 `---` 之前时不会被识别为头部而被显式拒绝（可接受，但文档未提）。 | 在 `details` 中带首个错误的 `linePos`/`message`（不回显整段原文），文档补一句指令/前导空格的处理。 |
| F6-8 | P3 | 整个 PR（25 files） | [确认] 一个 PR 同时做 YAML、 多模型设置和 follow-up 规则页迁移（`docs/plan/deferred.md` → `docs/plan/follow-ups/README.md` rename）。评审面偏大，且 rename 会与其它分支的旧路径引用产生冲突风险。 | 后续把跟踪机制迁移单独成 PR；本 PR body 应显式列出三块范围。 |
| F6-9 | P3 | `docs/plan/0.1.0/README.md:29`（91/91）、`:23`（103/103） | [确认] 中间阶段计数指向的早期分支提交不在合入树内，无法从 head 复现；head 实测 109/109 与最终计数一致。同类问题还有可复制的命令计数随测试增加而漂移（如 main 上“PR #6 优化评估”段把 `node --test test/model-settings.test.mjs test/model-presets.test.mjs` 记为 15/15，当前同一命令实为 25 项）。 | 阶段记录明确标注“提交 X 时点的观察”，或只保留可复现的最终命令+计数。 |

**跨 PR 关联**：F6-1/F6-2/F6-4 均由 PR #9 修复（[main 已修]，并有新增回归）；F6-3 在 main 仍存在，与 PR #9 的 F9-4 是同一根因（DSH 形状值直通 + 错误归内）。front matter 部分未被后续 PR 回退（main 的 `markdown-source.mjs` 仍保留同一实现，`test/markdown.test.mjs` 仍通过）；PR #9 仅在其上把导入/导出路径扩展了 PDF，未改 Markdown 语义。

---

<a id="pr-8"></a>

## PR #8 — docs: 版本命名规范写入 AGENTS.md（MERGED，base=1b9eca6，head=3e61548，1 file +1）

**结论**：B。/C 之间。一句话规范本身是必要的（软件版本 vs 设计文档版本 vs 归档版本的分野，以及“目录/分支/产物路径按版本命名”），指向的是仓库已经反复踩到的命名漂移。但它作为“always / sole exception”式的硬规则，与**同一个文件当天的内容自相矛盾**（`codex/restart-v2`、`current 0.1.0-dev.0`），且全仓仍有明显未迁移的反例，也没有任何检查机制；这正是后续 PR #25 必须回来改这一行的原因。

**范围与流程**：单文件单行，范围极小；缺点是只改“规则”、不扫描现有违反项、不给出 grandfather/迁移口径。

**Cordis/架构**：不涉及。
**设计一致性**：与 PR #5 的“事项 ID 稳定”规则衔接（把 follow-up ID 作为唯一例外），方向正确；与“目录按版本命名”的既有实践（`docs/plan/0.1.0/`）一致。
**代码/逻辑/结构**：无代码。
**文档/风格**：规则用词清晰，但“never”“sole exception”过强（见 F8-3）。

**测试与证据**：无测试；纯文档。

**问题清单**：

| ID | 严重度 | 位置 | 问题与证据 | 建议 |
|---|---|---|---|---|
| F8-1 | P2 | `AGENTS.md:61` 新增规则 vs `AGENTS.md:14`（PR #8 head） | [确认] 同文件第 14 行原文：“…Name future implementation branches by software version; keep the current PR on `codex/restart-v2`.”；新规则却规定“branch names … must resolve to a version”，并明确把 `restart` 列为禁止的过程措辞。同一文档在同一提交里自相矛盾；PR 未更新第 14 行。[main 已修] 由 PR #25（`4d36624`）重写第 14 行、移除该分支名。 | 规则 PR 应同时清理同文件内的直接冲突；可保留“历史分支名”说明但标注为历史。 |
| F8-2 | P3 | `AGENTS.md:61`（PR #8 head） | [确认] 规范正文内嵌“current `0.1.0-dev.0`”。9 天后 PR #25 把软件版本定为 `0.1.0` 并再次修改这一行（main:63 已是 `current 0.1.0`）。不变式里写“当前值”会让规范随发版漂移。[main 已修] | 用“当前软件版本（以 package.json 为准）”这类可解析表述，示例值放在别处。 |
| F8-3 | P2 | `AGENTS.md:61`（PR #8 head；main:63 同） | [确认] 规则宣称“always”“sole exception: follow-up IDs”，但仓库仍存在按阶段/过程命名的版本记录目录与路径：归档 0.0.0 的记录在 `docs/plan/mvp/`（非 `0.0.0`）、`experiments/`、以及 `evaluation/runs/workbench/`、`pdf-acceptance/`、`deepseek-restart/` 等旧运行目录；同时没有任何忽略清单/CI 检查，规则生效当天 PR #6 又新增了 `evaluation/runs/model-settings-browser/` 反例。规则与仓库事实/执行力不匹配。[main 仍存在] | 明确“自本规则起新增内容适用；历史记录不改”并给出已知反例清单，或加一个轻量检查（如对 `evaluation/runs/<新目录>` 的命名 lint）。 |

**跨 PR 关联**：F8-1/F8-2 由 PR #25 修复；F8-3 的实例横跨 PR #6（新运行目录）与历史目录，main 仍存在。PR #8 的规则是后续 PR #9 把运行目录写成 `settings-0.1.0/` 的直接依据（该处合规），说明规则本身有价值，问题在落地范围与自洽性。

---

<a id="pr-9"></a>

## PR #9 — feat(0.1.0): 独立插件设置窗口与模型管理（MERGED，base=a683f9b，head=5214028，+2459/-173，38 files）

**结论**：A-/B+。这是本组设计含量最高的 PR：服务端新增可选的 `SettingsPages` 注册表（纯数据描述 `{id,label,order}`、由 `ctx.effect` 返回值注销、`/api/capabilities` 暴露、SSE `settings.pages.changed` 通知），`ModelSettings`/`Pdf` 通过 `inject` 声明依赖并在构造/插件体中注册页面；浏览器端真正复用固定 DSH 的 `ui-slots` `SlotCore` 与 Cordis fiber（每个页面注册由一个真实 fiber 拥有，dispose 撤销），窗口壳使用本地 `<dialog>` 并在 `settings-dsh.md` 说明为什么不嵌 `ui-settings-general`。模型/凭据持久化仍完全走 DSH，未复制注册表。旧 profile 的 bundle patch 有升级路径且测试覆盖。优点是大量失败路径被显式处理：revision 冲突、部分保存 `partialSave` 恢复标记、插件卸载后禁用提交并清空密钥、草稿/凭据草稿保留、保存中阻止退出、重复 Back 的取消回滚。问题集中在：设置事件借用任务事件总线（可选依赖未声明、无任务时静默丢失）、follow-up 自身状态在合入后未闭环、锁文件混入第三方镜像、两处 `z.unknown()` 非法值映射 500，以及若干文档计数/顺序/死配置项。

**范围与流程**：一个 PR 同时包含：设置窗口 + 模型页重写 + PDF 设置页 + `ERROR_STATUSES`/`isPublicErrorCode` 错误码表重构 + `updateSettings` 协议字段契约 + 新增 follow-up + 侧 car 测试超时/清理加固。主题仍可概括为“设置窗口及其必要支撑”，但错误码重构和 sidecar 测试加固属可分离变更，触到 AGENTS“No scope creep” [P3]。文档对验收边界总体诚实（DOM 测试不替代浏览器、PDF 用协议夹具、未调用付费模型）。

**Cordis/架构**：
- 服务端：`src/settings-pages.mjs` 是独立 `Service`（`ivoraige.settingsPages`），注册返回 disposer，重复 ID 抛 `INVALID_ARGUMENT`，排序 `order` + id 稳定；`src/app.mjs:54` 在无 settingsDir 时补挂插件，有 settingsDir 时由 DSH profile bundle（`cordis:settingsPages`）提供，且 `ensureProfile` 对旧 profile 做幂等升级（插入顺序在 `cordis:modelSettings` 之前），`test/settings-pages.test.mjs` 覆盖升级与“页面随插件挂载/卸载”“仅模型/仅 PDF/两者/都无”装配矩阵。
- 依赖声明：`ModelSettings.inject=['settings','credentials','ivoraige.settingsPages']`、`Pdf.inject=[...,'ivoraige.settingsPages']`，是必需的 `inject` 而非 optional；缺注册表时对应插件不会激活（而非降级），但组合根总会提供，实际风险低。可改进处：`SettingsPages` 反向用 `ctx.get('ivoraige.tasks')?.emit(...)` 广播（F9-2）。
- 浏览器：`web/settings-runtime.mjs` 用 DSH `SlotCore` 声明 `settings.section` root 列表，每个页面由 `cordis.plugin(...)` 创建真实 fiber + `ctx.effect` 注册；`sync` 串行化、generation 丢弃过期结果、`dispose` 幂等并等待在途 sync；测试覆盖 rapid updates、卸载与同位替换、包含“Cordis 注册进行中 dispose”的竞态。
- 无平行 AI 基础设施：端点/凭据/路由仍由 DSH；页面组件是静态构建产物，未知页面 id 被忽略（有文档说明）。
- 可选能力缺失：只装 PDF 时 `features.settings` 仍为真、只出现 PDF 页（测试覆盖）；settingsDir 缺失时 `/api/settings/modelconfig` 走 `operations.settings()` 的 `COMPONENT_MISSING`。

**设计一致性**：`02_UI-design_v2.0.md` §5.6 与 `03_API-protocol_v2.0.md`（`settingsPages`、SSE 事件、`partialSave`）同步更新；`settings-goal.md` 的 S0–S3 退出条件与实现/测试一一对应（除“浏览器验收”不可复核）。实现与规范的一处偏差是非法 `compat/reasoningEfforts` 的 500（F9-4）。

**代码/逻辑/结构**：
- 焦点/惰性：原生 `showModal()` + 手动 Tab 圈定（`web/settings-window.jsx` 的 `onKeyDown`）过滤 `:disabled` 与 `[inert]` 子树；确认层用 `inert` 包住 `settings-main`，关闭恢复 `previousFocus`，`documentElement.overflow` 保存/恢复；`onCancel` 与关闭按钮统一走 `closeSettings`（有挂起确认时不重复弹）。
- 历史/重复 Back：`settings-navigation.mjs` 把 background、origin index、replace/push 语义数据化；`app.jsx:161-...` 统一历史写入入口（全仓已无 `location.hash=` 直写，grep 确认），popstate/hashchange 共用 `handlingRef` 防重入，取消的 Back 通过 `history.go` 回滚且不新增历史项（DOM 测试断言 history.length 不变）。
- 保存/冲突/部分保存：`src/model-settings.mjs:212-246` 仅在路由已写入时抛出带 `partialSave {persisted:'routes', failed:'selected', revisions:{routes}}` 的错误，保留原错误码（CONFLICT 保留 expected/actual），未知码归 `UPSTREAM_FAILURE`；前端据此禁用保存并要求“重新读取设置”，重读需确认放弃草稿。
- 卸载竞态：`available=false` 时清空密钥、清零请求版本、禁用提交；保留非秘密草稿；重挂载重新同步页面。
- 观察（F9-2）：页面事件经任务服务广播，靠 `?.` 容错；task-less 组合（纯解析、PDF-only 无 store）下注册/卸载事件不会发出（客户端仍可首连 capabilities 兜底，但“事件式刷新”的契约在该装配下静默失效）。

**文档/风格**：`settings-guide.md` 与 `workbench-guide.md` 更新到位；`docs/plan/README.md` 增加规划入口。问题：`settings-dsh.md` 的“seven tests”与实测 8 不符；`0.1.0/README.md` 的两个新阶段段被追加到文件末尾，违背该文件“最新在前”的既有顺序；`.gitignore` 新增 `/.test-tmp/` 无任何使用；`README` 的“交付 PR #9 等待人工 Merge”在合入后未更新，且两个事项在 main 仍为“处理中”。

**测试与证据**：
- [确认] PR head 全量 **177/177 pass**（我在自建 worktree 构建后运行）。其中 `test/settings-ui.test.mjs` 是对**实际构建产物** `dist/web/app.js` 的 jsdom DOM 测试（mock fetch，不 mock UI），覆盖：设置打开时后台 Workbench 的 Ctrl+Enter/Ctrl+R 不再被拦截、关闭后恢复、草稿/编辑器节点保留、Back 取消与 Forward、普通 hash 链接建立 background、畸形直接 hash 回退、加载失败重试、保存中 Back 被回滚、以及 2×2（新/改身份 × 仅保存/保存并用于翻译）的凭据草稿保留与显式保存后清空。文档明确“DOM 环境只为 dialog 提供最小方法，不代替真实浏览器焦点、inert 与布局验收”，没有把 mock 测试冒充浏览器验收 [确认]。
- [待验证] 浏览器层声明（焦点圈定、inert、390×844 窄屏、深色主题、重复 Back/关闭、真实 revision 冲突）与三系统 CI 计数（161/173）只对应 `docs/plan/0.1.0/README.md:165,175` 的外部 CI 链接和忽略目录 `evaluation/runs/settings-0.1.0/`，仓库内无脱敏日志/截图可复核。文档自身已声明 PDF 用协议夹具、未调用付费模型，诚实度尚可。
- 协议/服务层：`test/settings-pages.test.mjs` 用真实 HTTP SSE 读 `settings.pages.changed`、断言 capabilities 失去页面；用注入 `settings.mutate` 失败验证 partialSave 与实际持久化状态；断言未知字段在协议层被拒绝。

**问题清单**：

| ID | 严重度 | 位置 | 问题与证据 | 建议 |
|---|---|---|---|---|
| F9-1 | P2 | `package-lock.json:37`（PR #9 head；共 41 处 `registry.npmmirror.com`） | [确认] 新增 jsdom 及其依赖的 `resolved` 指向第三方镜像 `registry.npmmirror.com`，而全仓其余依赖使用 `registry.npmjs.org`，仓库无 `.npmrc`；CI `npm ci` 需从该镜像拉包（可用性/可复现性风险；integrity 哈希可防篡改，但不解决镜像不可达或审查策略问题）。`git log -S npmmirror` 显示由 PR #9 的 `27cb7f8` 引入，PR #25 `bc3cea7` 重新生成锁文件时移除。[main 已修] | 已修：锁文件重生成只用公共 registry；建议 CI 加一条锁文件 registry 白名单检查。 |
| F9-2 | P2 | `src/settings-pages.mjs:26-28`（发射点）；`src/app.mjs:59,82`（装配顺序） | [确认] `changed()` 用 `this.ctx.get('ivoraige.tasks')?.emit('settings.pages.changed', …)` 广播：设置域事件借道任务服务（`operations.subscribe`→`tasks.subscribe`→SSE），且 `SettingsPages` 未声明对 `ivoraige.tasks` 的依赖（无 `inject`），任务服务尚未挂载时事件被 `?.` 静默吞掉——实际装配中 PDF 页面在 `app.mjs:59` 注册早于 `app.mjs:82` 挂载 Tasks、模型页在 `bootModelSettings` 内更早注册，因此页面首次注册的 `settings.pages.changed` 不会发出（客户端靠首连 capabilities 兜底，故当前无功能故障；但“事件驱动刷新”的契约在这些时点静默失效），且事件类型不属于 `task.*` 却混入任务事件流（CLI `--json-events`、SSE 订阅者会一并收到）。 | 把事件发射收敛到一个显式的事件/SSE 契约（或以 optional inject 声明 tasks 并在服务缺失时给出文档化降级）；至少不要在任务事件流里伪装非任务事件。 |
| F9-3 | P2 | main 侧：`docs/plan/follow-ups/plugin-settings-window.md:4`、`docs/plan/follow-ups/model-settings-partial-save.md:4`、`docs/plan/0.1.0/README.md:179`（PR #9 head 对应 `:165`） | [确认] PR #9 已于 2026-10-08 合入 main，其事项验收条件（挂载/卸载证据、窗口、模型主从流程、partialSave 反馈与重读、测试/CI）均已在合入代码与测试中满足；但 main 上这两个事项仍为“处理中”，`0.1.0/README.md` 仍写着“交付 PR #9 等待人工 Merge”。违反 `docs/plan/follow-ups/README.md` 的“满足验收且合入目标分支后才标记已解决”以及 PR #9 自己的“待主线合入后再标记解决”。[main 仍存在] | 在 main 上把两项标为“已解决”并附合入/验证链接；清理“等待 Merge”表述。 |
| F9-4 | P2 | `src/protocol.mjs:41-42,59`、`src/model-settings.mjs:175-176` | [确认] 见 F6-3：协议只约束字段名，`compat`/`reasoningEfforts` 任意 JSON 直通 DSH schema；非法值得到 500 `INTERNAL` 而非 400 `INVALID_ARGUMENT`（探针实测；PR #9 head）。与 `03_API-protocol_v2.0.md` §1.3 冲突。[main 仍存在] | 同 F6-3。 |
| F9-5 | P3 | `docs/plan/0.1.0/settings-dsh.md:19` | [确认] 文档称 `node --test test/settings-runtime.test.mjs test/settings-navigation.test.mjs` “passed seven tests”；在 PR #9 head 实跑为 **8 tests / 8 pass**（main 同为 5+3）。属后来新增用例后未更新的计数。[main 仍存在] | 更新计数或去掉易漂移的数字。 |
| F9-6 | P3 | `.gitignore:40` | [确认] 新增 `/.test-tmp/`，但 PR head 与 main 中无任何代码/脚本使用该路径（grep 无命中）。死配置项误导读者以为测试会写此目录。[main 仍存在] | 删除，或引入真正使用该目录的测试并注释用途。 |
| F9-7 | P3 | `docs/plan/0.1.0/README.md:155,167`（PR #9 head） | [确认] 两个新阶段段被追加到文件末尾（在“TXT／Markdown 工作台集成（2026-10-05）”等旧段之后），而该文件既有约定是最新在前（PR #6/#7 均插在标题下第 3 行）。main 仍保持这种乱序（169/181 段）。 | 把新增段移到顶部，或统一改成显式的“按时间升序/降序”声明。 |
| F9-8 | P3 | `web/model-settings.jsx:9` | [确认] 组件签名接收 `useRemote` 却从未使用（页面自建 `useState` + `api` 加载），SettingsWindow 仍向每个页面传该 prop；签名有误导性，也让“复用 App 数据层”的意图落空。 | 删除未用 prop，或真正接入 useRemote。 |
| F9-9 | P3 | `docs/plan/0.1.0/README.md:165,175` | [待验证] 浏览器焦点/inert/窄屏/深色主题/重复 Back 的“已检查”与 161/173 测试计数只存在于外部 CI 链接与忽略目录（截图/日志不入库），仓库内无可核对证据；文档已正确声明 DOM 测试不替代浏览器验收，但“observed”仍不可审计。 | 在忽略目录之外保留一份脱敏的运行记录（命令、时间、提交、结果摘要）或在 PR comment 固化。 |
| F9-10 | P3 | `test/sidecar.test.mjs:10-...`（PR #9 head） | [确认] 本 PR 顺带把 sidecar 测试默认超时 500ms→10s、轮询 deadline 1000→5000ms 并补 `t.after(close)`。文档说明是并行全量下的 flake，但这是与设置窗口无关的测试基础设施变更（AGENTS“No scope creep”）。 | 拆出独立测试修复 PR，或在 PR body 单列并说明不改生产行为（现已说明）。 |

**跨 PR 关联**：F9-1 由 PR #25 修；F9-2/F9-3/F9-4/F9-5/F9-6/F9-7/F9-8 在 main 仍存在。PR #10（PDF source ownership）与 PR #9 同时触及 `src/adapters/pdf.mjs`，但 PR #9 只加一次设置页注册（`ctx.effect`），未见与 #10 的语义冲突；PR #20 一周后把 PR #9 加的 `[data-theme="dark"] .settings-window{color-scheme:dark}` 移除并提升到 `:root`（正确，见 #20）。

---

<a id="pr-20"></a>

## PR #20 — fix(web): 原生滚动条跟随页面主题配色（MERGED，base=0a185d4，head=3d69645，1 file +1/-2）

**结论**：A。最小、正确的修复：`color-scheme` 从仅设置窗口的局部规则提升为标题元素上的主题级声明。静态推演与实现一致：`web/app.jsx` 在 `document.documentElement.dataset.theme` 上只写 `light`/`dark`（system 也解析成这两个值），因此 `:root[data-theme="light"]{color-scheme:light}` / `[dark]` 永远恰好命中一个；`color-scheme` 是继承属性，`<dialog>`、`.settings-content`、`textarea` 等原生滚动条都会跟随；移除 `.settings-window` 的局部 `color-scheme` 不会造成回归（该 dialog 是同文档子元素，继承自 root）。无安全/架构影响。

**范围与流程**：单文件 1 增 2 删，单一职责，符合“确认后一次小修”。
**Cordis/架构**：仅 CSS，不涉及。
**设计一致性**：与 `02_UI-design_v2.0.md` 的主题要求一致；不改变能力/协议。
**代码/逻辑/结构**：`color-scheme` 声明位置正确；暗色主题下同时使原生控件（select 弹层、number spinner、滚动条）变暗，属期望副作用。风险：该规则同时全局作用于所有原生控件，范围略大于标题“滚动条”，且没有自动化/截图证据（见 F20-1）。[推断] 若未来 `data-theme` 出现第三种值（如 `system`）或首帧尚未设置，则无 `color-scheme` 声明，回落到浏览器默认（通常 light），与页面其余变量同样首帧未定义，属既有问题而非本 PR 引入。
**文档/风格**：无文档变更；PR 标题与 body（不可见）应说明“顺带移除 #9 的局部规则”。
**测试与证据**：无测试；CSS 变更无法在 `node --test` 中验证。main 的全量测试（254/254）与本变更无因果，仅证明未破坏构建/打包（`dist/web/app.css` 由 `scripts/build-web.mjs` 重新生成，`web/app.css` 被拼接进产物）。

**问题清单**：

| ID | 严重度 | 位置 | 问题与证据 | 建议 |
|---|---|---|---|---|
| F20-1 | P3 | `web/app.css:1`（PR #20 head） | [确认] 无测试或截图证据；变更是全局 `color-scheme`，除滚动条外还会改变原生控件渲染，PR 仅 1 行 diff 无法体现影响面。 | 在 PR 描述附明暗两主题下设置窗口/工作台的滚动条与原生控件对比截图（或至少说明已检查范围）。 |
| F20-2 | P3 | `web/app.css:1` | [推断] 仅在 `:root[data-theme]` 两个取值下列出 `color-scheme`，没有默认值/`prefers-color-scheme` 兜底；当前 SPA 保证二值，故非缺陷，但把主题约束耦合到 CSS 选择器上。若未来支持“跟随系统”直出或嵌入其它壳，未匹配时原生控件回落到 light。 | 可加 `:root{color-scheme:light dark}` 或在 index.html 首帧前设置 `data-theme`，使契约显式。 |

**跨 PR 关联**：正确覆盖并移除 PR #9 的局部 `color-scheme` 规则（该规则在 #9 合入后仅一周）；与 #9 的设置窗口共存无回归。main 的 `web/app.css` 仍只有 root 级声明 [确认]。

---

## 跨 PR 综合（本组）

**重复出现的问题与根因**

1. **客户端可写字段的形状校验缺位 + 错误分类错误（F6-3/F9-4，main 仍存在）**：`compat`/`reasoningEfforts` 以 `z.unknown()` 直通 DSH schema，DSH 抛出的 `ValidationError` 非 KernelError，被 `errorEnvelope` 归为 `INTERNAL` 并触发失败上报。根因是“协议层只认字段名、信任 DSH 校验”，但 DSH 的错误类型没有接入 §1.3 的分类；这一模式在 PR #6 扩展覆盖字段时被放大，PR #9 收紧未知字段后仍未覆盖值形状。属于跨 PR 的真问题，建议优先修。
2. **“已验证/已合入”状态无人闭环（F9-3，F5-1 的影子）**：PR #9 把 follow-up 的“合入后标记已解决”写进验收条件，但合入 9 天后 main 上两项仍是“处理中”、文档仍写“等待人工 Merge”；同一机制下 PR #5 引入的 Windows 清理缺陷虽有登记，也长期停在“待评估”。根因是状态更新依赖人工作业，PR 合并动作没有对应的“关闭事项”步骤。
3. **“文档声称”与仓库内证据的落差（F9-9、F9-5、F6-9、F6-6、F8-3）**：浏览器验收、CI 计数、可复制命令的测试数、运行目录命名，多处依赖忽略目录/外部链接或不随代码更新的数字。整体上仓库有“observed/inferred/未验证”的良好意识（PR #6/#9 明确写出未调用真实模型、DOM 不替代浏览器），但缺少落地的证据落点与一致性检查。
4. **测试基础设施的局部债（F5-1、F9-10、F9-1）**：临时仓库建在工作区（Windows EPERM）、侧 car 超时在设置 PR 里被顺手放宽、jsdom 依赖把锁文件带到第三方镜像。根因都是“为让 CI 变绿”的局部改动没有单独收口。
5. **UI 表单跨对象状态（F6-1/F6-4）**：PR #6 的表单把“身份”和“共享路由字段/模型容量”混在同一组状态里，改身份不重读目标作用域；PR #9 用 `formForProviderChange/formForModelChange` + 纯函数测试系统性修复，是本组最清晰的一次“发现–修复”闭环。

**架构演进评价**

- Cordis/插件化方向是**逐步走对**的：PR #5 只是流程工具；PR #6 的模型设置仍是 `Service` + DSH 配置（合规但 UI 单页硬编码）；PR #9 把“设置页”变成可选能力注册表（`SettingsPages` + `inject` + `ctx.effect` disposer + capabilities 数据描述 + SSE 装卸通知），浏览器端复用固定 DSH `SlotCore`/Cordis fiber 而非自建状态库，窗口壳的本地化决定有书面理由与边界（`settings-dsh.md`），没有把模型/凭据复制成第二套实现。这是本组最重要的正向证据，也解释了为何 PR #9 虽然体量大、附带问题多，仍应评为 A-/B+。
- 未发现本组任何 P0：没有“导出拿到 LLM”、没有入口业务逻辑、没有平行 AI 基础设施、没有 Python 直连；Markdown 头部“不可译单位 + 原文偏移 + 冻结重放”是靠机制保证的。
- 走偏风险主要在“进程/文档层”而非“内核层”：事件总线借用、忽略目录证据、follow-up 状态漂移、命名规则缺执行。这些会侵蚀后续评审对“已验证”的信任，但可修。

**本组 Top 5 优先修复项**

1. **[P2] F6-3/F9-4**：给 `compat`/`reasoningEfforts` 加 schema 或把 DSH `ValidationError` 统一映射为 `INVALID_ARGUMENT`（`src/protocol.mjs:41-42,59`；影响 HTTP/CLI/未来 MCP）。
2. **[P2] F9-3**：在 main 关闭 `plugin-settings-window`、`model-settings-partial-save`（标“已解决”+合入/验证链接），并清理“PR #9 等待人工 Merge”表述；把“合并→关闭事项”写成合并清单的一项。
3. **[P2] F6-1（已修，防回归）**：确认 PR #9 的 `formForProviderChange/formForModelChange` 有浏览器级或 DOM 级回归（目前只有纯函数测试），避免后续重构把“身份变更读目标作用域”丢掉。
4. **[P2] F5-1**：`test/followups.test.mjs` 改用 `tmpdir()`（或加忽略+有界清理），这是唯一一个已被两次 Windows 运行观察到的真实 flake。
5. **[P2] F8-3/F9-1/F9-2**：给版本命名规则补“历史不追溯 + 已存反例清单”并加轻量检查；锁文件 registry 白名单检查已可顺手加；把 `settings.pages.changed` 从 tasks 事件总线迁到显式事件契约（或至少 optional inject + 文档化降级）。
