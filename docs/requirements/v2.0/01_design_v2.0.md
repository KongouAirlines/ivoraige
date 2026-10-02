# ivoraige 设计与验收基线 v2.0

版本：v2.0｜2026-10-02｜状态：设计方案，承接需求基线 v1.0 与 MVP（M0～M4）已完成实现。

审阅修订：2026-10-03。保留产品方向，补齐复用适用性、解析／重建边界与冻结导出契约；本文新增能力仍是设计，不追认为 MVP 已实现。

## 0. 文档定位与依据

本文是 ivoraige 的**设计与验收文档**：在 [需求基线 v1.0](../v1.0/01_功能需求概览_v1.0.md)（44 项功能期望，不改编号、不改优先级）之上，落实用户本次给出的产品形态约束与验收口径，并结合以下既有成果：

- [ADR-0001 运行时选择](../../decisions/0001-runtime-selection.md)：Cordis 组织服务 + DSH vendor 模型模块（固定提交 `639ed015397290b3745d163aafe02ffee4aa3f84`）。
- [选型 v1.1](../../research/tool-selection-v1.1.md)、[DSH 插件候选](../../research/dsh-plugin-candidates.md)、[Cordis 生态候选](../../research/cordis-ecosystem-candidates.md)。
- MVP 已验证：文本翻译闭环、术语建库与组合、译文持久化复用、BabelDOC 译文回放生成 PDF、简化 CLI（详见 [MVP 计划](../../plan/mvp/plan.md) 及各阶段记录）。
- [术语范围补充 0001](../amendments/0001-term-applicability.md)：沿用其维度定义；词库结构本次仍标注为后续研判（见 §12）。

### 用户本次给定的约束（作为设计前提，不再开放）

| 编号 | 约束 |
|---|---|
| C1 | 三端：Linux、Windows、macOS。 |
| C2 | 三种交互：CLI（供 AI 与批量脚本）、MCP、Desktop（WebUI）。 |
| C3 | 一次部署，不依赖用户环境；也允许 npm 部署。 |
| C4 | 验收口径：主要需求可以通过上述交互方法达成。 |
| C5 | 三条主用例：Zotero 右键四模式；手动导入按格式输出；精翻工作台逐段／范围／全文翻译并双语对照。 |
| C6 | API 与安全部分照搬 DeepSeek Harness（DSH），按对应模块以插件复用。 |
| C7 | 词库（术语库结构）后续研判，本文不锁定。 |
| C8 | AI 基础设施（模型接入、凭据、设置、存储、任务等）按对应 DSH 模块插件化复用，不另写已有能力的平行实现；MVP 已验证的具体范围见 §2.2，不等于全部候选均已接入。 |

---

## 1. 产品形态

### 1.1 单内核、三入口

**一个内核进程，三种入口。** CLI、MCP、WebUI 不是三个程序，而是同一个 Cordis 应用上的三个插件，调用同一组内核服务。这直接保证 C4：任何入口能做到的事，其余入口都能做到，因为它们走同一服务层。

```mermaid
flowchart TB
    subgraph Entries[入口层]
        CLI[CLI 插件<br/>commander 风格子命令<br/>stdout JSON 供 AI／脚本]
        MCP[MCP 插件<br/>@modelcontextprotocol/sdk<br/>stdio + Streamable HTTP]
        WEB[WebUI 插件<br/>HTTP + SSE 进度<br/>浏览器即桌面端]
    end
    subgraph Core[内核服务层 Cordis 上下文]
        TASK[textTask<br/>任务、进度、取消、恢复]
        TRANS[translation<br/>翻译管线]
        TERMS[terms<br/>术语库]
        REC[records<br/>文档/单位/译文修订]
        PARSE[parse<br/>格式适配器注册表]
        EXPORT[export<br/>同源输出]
        RAG[rag<br/>切块/嵌入/检索]
    end
    subgraph Infra[基础设施层 复用 DSH/Cordis]
        LLM[dsh-llm + llm-pi-ai]
        CRED[dsh-credentials-local]
        STORE[dsh-storage-domain<br/>+ storage-sqlite]
        JOBS[dsh-jobs-local]
        HTTP[@cordisjs/plugin-server]
    end
    Entries --> Core
    Core --> Infra
    PARSE --> PY[Python sidecar<br/>BabelDOC／MinerU<br/>PyInstaller 单文件]
```

### 1.2 三端与“不依赖用户环境”的实现

内核是 Node.js/TypeScript（沿用 ADR-0001 的 DSH vendor Cordis）。不依赖用户环境的含义是：用户不需要自行安装 Node、Python 或任何模型运行环境。三个组成部分分别解决：

| 组成部分 | 平台无关性方案 |
|---|---|
| Node 内核 | 按平台打包**单文件可执行**。Node v25.5+ 已内置 `node --build-sea`，无需 postject 手工流程；每平台产出 `ivoraige-linux-x64` / `ivoraige-win-x64.exe` / `ivoraige-macos-arm64` 等。Bun `--compile --target` 跨编译作为备选路线，但与 DSH vendor 的兼容性未验证，**不作为默认**。 |
| Python 侧车（BabelDOC／MinerU） | PyInstaller 按平台构建可选组件，单文件形式待实际依赖闭包验证。内核通过子进程 + JSON-RPC over stdio 调用；仅所选实现需要对应 sidecar，纯文本使用无需安装 Python 组件。 |
| 原生依赖 | `node:sqlite` 为 Node 内置，无原生编译负担；其余依赖选纯 JS 实现。这是选 storage-sqlite / node:sqlite 而非 better-sqlite3 的原因。 |

macOS 分发需代码签名与公证，否则 Gatekeeper 拦截；签名属发布流程事项，在 CI 中完成，见 §10 里程碑。

### 1.3 分发形态（两种，同一构建产物）

1. **npm 部署**：`npm install -g ivoraige`。包本体为 JS（内核与可选 WebUI 资源）；默认安装不自动下载 Python sidecar 或模型权重，用户启用对应组件时再按平台安装。沿用当前 Node `>=24` 要求，降低最低版本需另行验证所选依赖，不仅依据 `node:sqlite` 是否存在。用户已有 Node 环境时用此路径。
2. **独立发行包**：每平台提供内核与默认配置；PDF 完整包可附带对应 sidecar，组件也可单独安装。纯文本最小组合不依赖 PDF／MinerU，完整包解压后无需用户手动配置语言运行时。

两种形态运行同一份代码，行为一致性由同一构建管线保证（构建一次，分别封装）。

### 1.4 “Desktop（WebUI）”的界定

桌面端 = 内核进程启动本地 HTTP 服务并打开浏览器到 `http://127.0.0.1:<port>`。**不引入 Electron/Tauri**：WebUI 已满足 C2 的 desktop 形态，壳程序只增加打包体积与三端签名成本，不增加能力。若未来需要系统托盘、开机自启，再评估壳程序，届时内核不变。

`ivoraige serve`（或双击可执行文件的默认动作）= 启动服务 + 打开浏览器。`ivoraige serve --no-open` 供远程/无头使用。

---

## 2. 总体架构

### 2.1 模块清单与边界

模块名沿用 M3.1 整理后的边界与 amendment 0001 的实施位置约定，新增部分标 ★。每个模块是一个 Cordis 插件，通过 `inject` 声明依赖，通过服务名对外暴露。

| 模块 | 职责 | 不做的事 |
|---|---|---|
| `records` | 文档登记、来源标识、翻译单位（unit）、译文修订（revision）、输出工件（artifact）的持久化与查询 | 不理解任何文件格式 |
| `parse` | 格式适配器注册表；把输入文件解析为**规范化文档 IR**；记录每个 unit 的来源定位（页、段、XPath、字节区间等） | 不调用模型、不翻译 |
| `termBuilder` | 从指定语料发现术语候选，保留出处与适用范围依据 | 不确认术语（确认走 terms） |
| `terms` | 术语条目、义项、确认状态、库组合、范围筛选后再词形匹配（规则见 amendment 0001） | 不决定哪些库生效（由任务配置决定） |
| `translation` | 翻译管线：复用检查 → 术语装配 → 模型调用 → 写草稿修订；幂等与断点 | 不决定输出格式 |
| `textTask` | 任务生命周期：提交、进度、取消、暂停/恢复、失败定位；包装 dsh-jobs | 不含具体业务步骤 |
| `export` | 同源输出：按已接受译文生成各格式，正文模型调用恒为零 | 不触发初译 |
| `rag` ★ | 从 IR 切块、调用嵌入模型、写入向量索引、检索 | 不代替术语库与已接受译文（见 §4.4 边界） |
| `serve` ★ | HTTP API + 静态 WebUI + SSE 进度；基于 `@cordisjs/plugin-server` | 不含业务逻辑，只做协议转换 |
| `mcpServer` ★ | 对外 MCP server，把内核能力注册为 MCP tools/resources | 与 DSH 的 mcp-client（消费端）是两件事 |
| `cli` ★ | 子命令解析、输出格式化、退出码 | 薄壳，直接调内核服务 |
| `zoteroBridge` ★ | 供 Zotero 插件调用的 HTTP 端点组（属 serve 的子路由） | 不实现 Zotero 侧 UI |

### 2.2 关键架构规则

1. **入口无逻辑**：CLI/MCP/WebUI 任何一处不含业务分支，全部转发到内核服务。新能力先加内核服务，再在三入口各加一行注册。
2. **翻译只发生一次**：初译只由 `translation` 执行；`export` 只消费 `records` 中状态为 `accepted` 的修订。M3 已验证此规则（离线重导出模型调用为零），v2.0 把它升级为对所有格式适配器的硬性契约。
3. **Python 只通过 sidecar 协议接触**：内核不 import 任何 Python 库；sidecar 协议版本化，输入为 IR + 已接受译文，输出为重建文件。
4. **模型调用只走 DSH LLM 层**：任何模块不直接 `fetch` 模型端点。凭据、取消、超时、流式、usage 记录全部沿用已验证路径。

   **AI 基础设施复用 DSH 插件（C8）**：按所需能力挂载对应插件，不自写已有能力的平行实现。MVP 已验证模型与 JSON/domain 存储组合；credentials-local、settings、jobs、SQLite 等仍需在各自接入阶段验证。插件未提供的能力应明确缺口并优先寻找可复用实现，不能因为名称相近就标为已具备；业务 checkpoint、来源关联等仍由本项目负责。
5. **存储只走 storage-domain**：业务 schema 用 zod/Schemastery 定义在 domain 层，后端默认 SQLite medium（`node:sqlite`），JSON medium 保留给小规模配置。已知限制（无跨表事务、无二级索引）按 §3 的建模方式规避。

### 2.3 技术选型汇总

| 层 | 选定 | 依据 |
|---|---|---|
| 运行时 | Node.js ≥24，TypeScript | 沿用当前工程最低版本；独立包的 SEA 构建版本单独固定 |
| 插件框架 | DSH vendor Cordis（固定提交） | 已验证；不与上游 Cordis 4 RC 混装 |
| 模型接入 | `dsh-llm` + `dsh-llm-pi-ai`；OpenAI 兼容端点覆盖 Ollama/LM Studio | M1 十项检查通过 |
| 凭据 | `dsh-credentials` + `dsh-credentials-local` | C6：照搬 DSH |
| 存储 | `dsh-storage-domain` + `dsh-storage-sqlite` | MVP 已验证 domain + JSON；SQLite 是后续替换方案，尚未实跑 |
| 任务 | `dsh-jobs` + `dsh-jobs-local` + 业务落库 | 进程内任务 + 自写持久状态（§8.3 说明组合边界） |
| HTTP/WebUI | `@cordisjs/plugin-server` + 静态 SPA（构建期打包进单文件） | 调研候选；同源服务 CLI/MCP/WebUI |
| MCP server | `@modelcontextprotocol/sdk`（官方 TS SDK） | DSH 只有消费端；server 需自建 |
| PDF | BabelDOC（Python sidecar，沿用 M1/M3 回放路线） | 已验证译文注入 |
| 解析（富格式） | MinerU（Python sidecar 第二入口，按需） | v1.0 主候选 |
| EPUB | JS 适配器（zip + XHTML 解析，详见 §4.3） | 免新增运行时；Okapi 留作备选 |
| 嵌入/向量 | 嵌入优先复用 DSH 生态现成能力，具体接口待 M8 核验；向量候选为 SQLite + `sqlite-vec`，不可用时可用 JSONL + JS 余弦 | 当前固定 `dsh-llm` 已验证的是生成接口，不能据此视为已支持 embeddings；扩展分发与小规模退化路线均待验证 |

**明确不引入**：Electron/Tauri（§1.4）、LiteLLM（模型层已由 DSH 覆盖）、vLLM/Xinference（个人部署过重）、LangGraph/Dify（不另造编排层）。

---

## 3. 核心数据模型

以下 domain schema 是逻辑定义；字段类型用 zod 表达，落库为 storage-domain 记录。命名沿用 MVP 已有记录结构，新增字段以迁移追加。

### 3.1 实体清单

| 实体 | 关键字段 | 说明 |
|---|---|---|
| `Document` | `id`、`sourceId`（业务来源标识，见 amendment 0001）、`format`、`language`、`title`、`importedAt`、`origin`（manual/zotero/cli/...）、`externalRef`（如 Zotero item key） | `sourceId` 是业务标识，不靠文件哈希 |
| `Unit` | `id`、`docId`、`order`、`kind`（heading/body/caption/formula/code/reference...）、`sourceText`、`context`（前后文摘要）、`locator`（来源定位）、`translatable` | 解析产物；`translatable=false` 的单位（公式、代码、参考文献等）跳过翻译、原样进输出 |
| `Revision` | `id`、`unitId`、`targetLang`、`text`、`origin`（machine/human/imported）、`status`（draft/accepted/superseded）、`modelId`、`promptVersion`、`reuseKey`、`createdAt` | 译文修订；一个 unit 同一目标语言下多条修订，只有一条 `accepted` |
| `TermEntry` / `TermSense` | 沿用 MVP 与 amendment 0001：义项、别名、类别（通用/专用）、适用范围、来源、确认状态 | 结构后续研判（§12），现有字段不迁移 |
| `Task` | `id`、`kind`（parse/translate/export/rag/...）、`docId`、`config`、`state`（queued/running/paused/succeeded/failed/canceled）、`progress`、`cursor`、`error` | `cursor` 记录断点位置供恢复 |
| `Artifact` | `id`、`docId`、`targetLang`、`format`、`path`、`snapshotId`、`revisionSetHash`、`createdAt` | 输出工件；引用本次冻结清单，而非完成时的最新译文集合 |
| `RagIndex` | `id`、`docId`、`chunker`、`embedModel`、`chunkCount`、`createdAt` | 索引元数据；chunk 本体见 §4.4 |

### 3.2 译文复用键（F-13 的机制）

保留 MVP 的适用性检查；`reuseKey` 只作为候选检索索引，不代替检查：

```
reuseKey = hash(sourceText_normalized, sourceLang, targetLang,
                effectiveContext, effectiveTarget, termConstraintSetId)
```

- `effectiveContext` 为实际影响翻译的上下文；`effectiveTarget` 包含用途、风格与预设展开后的实际约束，不能只用 `stylePresetId`。前后文变化或同名预设内容变化时重新判断适用性。
- 命中后仍检查当前来源修订、上下文、目标约束和来源绑定；同文字但不同公式／结构载荷不能直接复用。文本规范化不能抹掉有意义的符号、大小写或结构差异。
- `termConstraintSetId`：本次翻译实际装配的术语约束集合的稳定标识，**不是全库哈希**——词库中无关条目的增删不使旧译文失效；约束集合内容变化（相关术语改译名、范围变化）则生成新 id，旧修订保留但新任务不复用。先装配当前约束再计算索引。
- 索引在相关输入变化时计算并保存即可，不为常规文件读取、传递或重导出新增哈希关卡。
- 术语范围修改后的复核语义沿用 amendment 0001：相关单位需复核，无关单位不重翻。
- 模型更换**不改变** reuseKey，不触发自动重译；重译是显式操作（`translation.retranslate`，生成新修订，旧 accepted 不受影响直到用户接受新修订）。
- 存储限制规避：storage-domain 无二级索引，复用查询以 `reuseKey` 作为记录键的一部分（domain 按主键取），不做全表扫描。

### 3.3 同源输出契约（F-07/F-13）

`export` 的每个格式适配器必须满足：

1. 对外请求指定 `docId`、`targetLang` 与输出选项；输出服务启动任务时从 `records` 一次取得适用的 accepted 修订、来源修订／绑定和必要资源引用，保存为冻结清单 `snapshotId`。所有格式适配器消费该清单，不分别读取可变的当前记录，沿用 M3.1 的 manifest 边界。
2. 可译 unit 缺少适用 accepted 修订时，在冻结清单中按配置记录 `skip`（保留该版本原文）或 `fail`（默认）；`translatable=false` 的内容直接保留，不要求虚构译文修订。
3. 一次多格式导出共用同一 `snapshotId`；后续增加格式可显式复用它。完成后的 `Artifact` 记录实际清单及其 `revisionSetHash`，摘要仅在创建清单时计算一次。期间新编辑不影响该次输出，也不因“当前 accepted 已变化”否定正常产物。若冻结来源资源已不可用，应明确失败，不能改用最新资源。
4. **禁止**任何形式调用翻译模型。适配器无法取得 LLM 服务引用（Cordis `inject` 层面不提供），从机制上而非纪律上保证。

---

## 4. 处理管线

### 4.1 解析 → 规范化 IR

格式适配器接口：

```ts
interface SourceAdapter {
  match(file: FileRef): number;              // 0 表示不支持；置信度供多适配器排序
  parse(file: FileRef, ctx): Promise<ParsedDoc>; // 结构化 + 单位化 + locator
}
interface OutputAdapter {
  supports(sourceBinding): boolean;       // 检查所需来源绑定，不假定解析器能重建
  rebuild(snapshot: ExportSnapshot, options, ctx): Promise<Artifact>;
}
```

`ParsedDoc` = 文档元数据 + 有序 `Unit[]` + 可选章节树 + 资源清单（图片等）+ 不透明的来源绑定。下游共享已需要的通用字段，核心保存并传递工具私有结构，不解释其坐标／占位符。解析与输出独立注册，可用输出由已装输出实现与来源绑定共同决定，不要求解析器提供 rebuild。

| 格式 | 解析 | rebuild |
|---|---|---|
| PDF | 首条路线继续用 BabelDOC 自身捕获与来源绑定；MinerU 为可选解析实现 | BabelDOC sidecar 消费对应的冻结清单；译文 PDF 沿用既有验证，双语 PDF 另验 |
| Markdown/TXT | 内置 JS 适配器 | 内置：MD、JSON、双语对照 MD |
| EPUB | 内置 JS：解 zip → 按 spine 遍历 XHTML → 段落级 unit，locator 为 `spine路径#元素序号` | 内置：回填 XHTML 重打包 EPUB |
| DOCX/PPTX | 第一阶段走 Office→PDF（`dsh-office-to-pdf`）进 PDF 管线出预览；原生回填列 P1 扩展，候选 Okapi | 同左 |

M3 没有验证 MinerU 与 BabelDOC 的跨引擎分段关联。采用 MinerU 解析再用 BabelDOC 重建时，需单独建立并验证多对多来源关联，保留公式／结构绑定；未具备关联能力时不宣称可直接重建 PDF，也不让该路线成为已有 BabelDOC 路线的前置。

### 4.2 翻译管线

```
for unit in doc.units where translatable:
  1. terms.assemble(doc.sourceId, unit)        // 先范围筛选，再词形匹配
  2. 计算当前 basis/reuseKey；accepted 命中且适用性检查通过 → reused，跳过
  3. llm.stream(prompt(unit, terms, context))  // 取消信号贯穿
  4. records.writeRevision(status: draft | accepted)
```

- **接受策略可配**：批量快速模式自动 accepted；精翻模式先 draft，工作台逐条 accept。两种模式共用管线，仅接受策略与提示词档位不同（F-10）。
- **幂等**：每个 unit 的翻译结果落库后才推进 `Task.cursor`；任务中断后从 cursor 恢复，已完成 unit 靠复用检查直接跳过，不产生重复调用。
- **模型分工**（F-11）：`termBuilder`/`translation`/审校各自配置模型；审校步骤可整体关闭。
- **中译学术英**：同一管线换语言方向与提示词预设（F-05），不设独立模块。

### 4.3 同源输出

`ivoraige export <docId> --target <language> --format pdf|md|json|epub|bilingual-pdf`。可重复指定格式或一次传输出列表；`--snapshot <id>` 对应 API 的 snapshotId，用于从同一清单增加出口。

- PDF 回放沿用 M3 验证的 BabelDOC 注入路线；占位符规则沿用本项目严格顺序校验 + 记录原因的顺序修正，不照搬上游的异常放行（见 [pdf2zh-next 参考](../../research/pdf2zh-next-mvp-reference.md)）。
- 新增输出格式 = 新增 export 适配器，**不新增翻译路径**。

### 4.4 RAG 管线与边界

RAG 构建：`IR → chunker（按章节/段落，保留 unit locator 作为引用锚点）→ 嵌入模型 → 向量记录`。检索输入查询文本，输出 chunk + 来源定位（文档、页、段落）。

明确边界（沿用调研结论）：RAG 索引是**检索辅助**，不是知识库；检索结果只能作为参考展示，不能充当已确认术语或已接受译文。RAG 构建与翻译是独立任务，可组合（用例 1 的四模式即此组合）。

向量存储：`sqlite-vec` 扩展不可用（如 sidecar 未装）时自动退化到 JSONL + 启动期加载做余弦检索，并在任务结果中标注退化状态。个人单机语料规模（数百篇论文）下退化路线性能可接受；此判断待首个真实语料验证后修正。

---

## 5. 三入口详细设计

### 5.1 CLI

目标用户：AI agent 与批量脚本。因此输出纪律是硬要求：**机器可读输出走 stdout（JSON），人类提示走 stderr，进度走 stderr 或 `--json-events` 的 NDJSON 流。**

```
ivoraige serve [--port N] [--no-open]          # 启动内核 + WebUI + MCP HTTP
ivoraige import <file> [--source-id X]         # 解析 → 返回 docId
ivoraige translate <docId> --target zh [--profile P] [--range 1.2-1.4|unitIds] [--mode fast|careful]
ivoraige export <docId> --target zh --format pdf [--out path] [--snapshot id]
ivoraige rag build <docId> / query <docId> "..."
ivoraige terms list|confirm|edit ...           # 沿用 MVP
ivoraige task list|show|cancel|pause|resume
```

约定：

- 所有命令 `--json` 可用；默认人类可读摘要仍在 stdout 但保证单行可解析字段。AI 使用场景一律建议 `--json`。
- 退出码：`0` 成功；`2` 参数/用法错误；`3` 前置条件不满足（如无 accepted 译文而导出）；`4` 上游失败（模型/解析）；`5` 已取消。脚本可据此分支。
- 长任务默认前台跟随进度，`--detach` 返回 taskId 供 `task show` 轮询；两种形态与 MCP 的异步调用对应同一任务模型。
- 配置解析顺序：命令行 > 环境变量 > profile 文件 > 默认，沿用 DSH credentials/launch-environment 约定。

### 5.2 MCP server

官方 `@modelcontextprotocol/sdk`（TS）。双 transport：

- **stdio**：由 harness 直接拉起 `ivoraige mcp --stdio`，适合本地 AI 客户端。
- **Streamable HTTP**：`serve` 时挂载 `/mcp`，适合常驻服务被多个客户端共享。

tools 与内核服务一一对应（命名 `ivoraige_<verb>`）：

| tool | 参数要点 | 返回 |
|---|---|---|
| `ivoraige_import` | 文件路径或 base64 + format 提示 | `docId`、unit 统计、警告 |
| `ivoraige_translate` | docId、profile、range、mode | taskId（长任务异步） |
| `ivoraige_export` | docId、targetLang、输出格式／路径、可选 snapshotId | taskId；产物携带 snapshotId、revisionSetHash |
| `ivoraige_task_status` / `ivoraige_task_cancel` | taskId | 状态、进度、cursor |
| `ivoraige_rag_build` / `ivoraige_rag_query` | docId / 查询 | taskId / chunk+locator 列表 |
| `ivoraige_terms_*` | 列表/确认/编辑 | 沿用 MVP 术语操作 |
| `ivoraige_units_list` / `ivoraige_unit_update` | docId、unitId、新译文 | 供 AI 直接精翻单个 unit |

resources：`ivoraige://docs/{docId}`（IR 摘要）、`ivoraige://docs/{docId}/units/{id}`（双语对照单条）、`ivoraige://tasks/{id}`。

MCP 层不实现第二套权限：能连上 server 即拥有内核能力，鉴权与绑定策略见 §7。

### 5.3 WebUI（Desktop）

技术：静态 SPA（构建期打进单文件/发行包，`serve` 直接吐字节），服务端渲染一律不做。通信：REST + SSE（任务进度），不做 WebSocket（单向推送足够）。

页面清单（首版）：

1. **文档列表**：导入按钮（拖拽/选择文件）、状态、各格式导出入口。
2. **工作台**：左侧单位列表（可筛选未译/草稿/已接受），中间双语对照编辑，右侧术语与上下文面板；支持逐段翻译、框选范围翻译、全文翻译三个触发粒度；接受/回退修订。
3. **任务页**：进度、取消、暂停/恢复、失败定位与重试。
4. **设置页**：模型端点与分工、词库组合、方案（profile）管理；照搬 DSH settings/config-editor 的 profile 与热更新约定（C6）。
5. **术语页**：候选确认、编辑、适用范围查看——字段随 §12 研判调整。

---

## 6. 用例走查

### 6.1 Zotero 右键四模式

**Zotero 侧**：一个薄插件（Zotero 7+ 插件机制），在条目右键菜单加四项：翻译为 PDF／构建 RAG／构建 RAG 并翻译／双语构建并翻译。插件只负责：取条目首个 PDF 附件路径（或临时导出）、调用 `http://127.0.0.1:<port>/zotero/...`、轮询任务、完成后用 Zotero API 把输出文件作为**附件挂回原条目**，并在条目 note 写入 docId 与各 artifact 路径。插件内零翻译逻辑；内核未运行时菜单项提示并给出启动命令。

**内核侧**（`zoteroBridge` 路由组）：

| 端点 | 行为 |
|---|---|
| `POST /zotero/translate` | import → translate(mode 由参数) → export pdf/bilingual-pdf；返回 taskId |
| `POST /zotero/rag` | import → rag build；返回 taskId |
| `POST /zotero/rag-translate` | import → rag build → translate → export；翻译不依赖 RAG 结果，二者并行后汇合 |
| `GET /zotero/task/{id}` | 状态、进度、产物路径列表 |

`externalRef` 记录 Zotero item key：同一文献再次触发时命中已有 `Document` 与已接受译文，四模式任意组合重跑均不重复初译（F-13 在此用例的直接兑现）。

### 6.2 手动导入按格式输出

`import` 时 `parse` 注册表按 `match` 置信度选适配器；任务结果返回**可用的输出清单**（由已注册输出实现与该文档来源绑定共同决定）。用户随后 `export --format <其一>`，多格式请求共用冻结清单。跨入口一致：WebUI 文档页的导出按钮、CLI 的 `export`、MCP 的 `ivoraige_export` 读同一份可用清单。

未识别格式：明确报错并列出已注册适配器，不做静默降级。

### 6.3 精翻工作台

流程：`import`（解析入库）→ WebUI 打开工作台 → 三种翻译粒度（单段/框选范围/全文）→ 逐段双语对照 → 编辑、接受、回退 → 导出。

- 粒度实现统一为 `translation.translate(docId, unitIds[])`；全文 = 全部 translatable unit 的列表。三个按钮一个服务方法。
- 对照视图的数据源是 `records` 的 unit + 所选目标语言的 accepted/draft 修订，不是导出文件；编辑写 human 草稿，接受后纳入下次新建的导出清单，无需“保存到 PDF”之类的二次同步。已经启动或显式复用旧快照的输出保留原版本。
- 回退：修订历史全保留，选择仍适用的旧修订并 accept 即回退；接受状态的乐观锁与草稿编辑锁分开，见 [API 协议](03_API-protocol_v2.0.md)。

### 6.4 其他格式链路

视觉小说、漫画、字幕等维持 v1.0 的 P2 定位：其接入方式是新增 `parse`/`export` 适配器与入口薄壳，不改动本文内核设计。届时按同一适配器契约逐个补设计。

---

## 7. 安全与凭据

按 C6 照搬 DSH，对应模块以插件复用，不自写：

| 关注点 | 复用 | 说明 |
|---|---|---|
| 凭据存储 | `dsh-credentials` + `dsh-credentials-local` | 命名凭据，配置中只存引用；环境 > 管理文件 > 项目/home `.env` 的分层沿用 DSH 约定。已知边界：文件内保存秘密，非 OS keyring；发行版需验证各平台目录权限。 |
| 联网与模型选择 | DSH launch-environment + 本项目 profile | 用户显式配置，系统不做自动敏感性判断（F-03）。 |
| HTTP 服务暴露面 | 自建薄层 | 默认仅绑定 `127.0.0.1`；`--host` 显式放开时要求同时设置访问 token（凭据系统签发），无 token 不监听非回环地址。 |
| MCP stdio | 无网络面 | 进程隔离即边界。 |
| 用量与审计 | DSH LLM 层 + records | 每次模型调用落 task 事件；usage 未知记 unknown 不填零（沿用 ADR-0001 边界）。 |

词库暴露设置（F-18）的安全语义依赖词库结构，随 §12 一并研判；本文只确立“配置存引用、秘密进 credentials、对外监听需 token”三条底线。

---

## 8. 非功能需求

### 8.1 性能基线（验收用相对口径，不承诺绝对值）

- 复用路径：无变更重跑、新增格式导出，正文翻译模型调用数 = 0（硬指标，M3 已达成）。
- RAG 构建与检索：单篇论文级文档，构建秒级到十秒级；检索 P95 < 1s（退化路线按 500 篇语料上界估算，首个真实语料后修正）。
- WebUI 交互：单位列表万级条目内滚动不阻塞（虚拟列表）；SSE 进度延迟 < 1s。
- 吞吐与耗时的绝对基线在首个真实模型运行后建立并记录，本文不预设。

### 8.2 并发

`dsh-jobs-local` 有并发上限且超限拒绝启动（不是排队）。业务层在其上加**排队语义**：任务先入 `Task` 表为 `queued`，调度器按上限派发，保证 CLI 批量脚本提交 100 个任务时行为是排队而非报错。模型侧 QPS 由 LLM 层配置控制。

### 8.3 任务与恢复的组合边界

`dsh-jobs` 提供进程内进度/取消；持久状态、断点 cursor、重启恢复由 `textTask` 在 `records` 上自写。职责划分：

- 进程内：取消信号传播、进度事件、输出环 → dsh-jobs。
- 跨进程：任务表落库、cursor、重启后 `resume` 重放 → textTask。
- 翻译单位幂等（§4.2）保证恢复不产生重复模型调用。

### 8.4 错误处理

- 失败定位到 unit：任务错误对象含 `unitId`、`stage`（parse/translate/export）、上游错误摘要；WebUI 任务页可跳到出错单位。
- 解析失败不污染 `records`：import 是写文档记录前的两阶段提交（先解析成功，再落库）。
- sidecar 缺失/崩溃：对应格式功能明确报“组件缺失”并给出安装命令；其他功能不受影响。
- 模型超时/限流：沿用 DSH 超时与取消；重试策略在 profile 中显式配置，默认不重试（失败可见优先于自动掩盖）。

### 8.5 日志与可观测

结构化日志（JSON lines）落用户数据目录；任务事件（开始/单位完成/失败/取消/产物）同时写 `Task` 记录与日志。日志不含 prompt 全文与译文全文（只含引用 id），避免词库与文献内容散落。

---

## 9. 验收标准

### 9.1 总则（C4 的落实）

**主要需求可通过三种交互方法达成**，操作化为：

1. §6 三条主用例的每一步，在 CLI、MCP、WebUI 任一入口均可完成；逐用例给出各入口的具体命令/调用/页面操作（§9.2 矩阵）。
2. 任何入口能力集合相同：以 CLI 子命令清单、MCP tools 清单、WebUI API 路由清单三者对照，除入口特有项（如 serve 本身）外一一对应。
3. 三端（Linux/Windows/macOS）上，两种分发形态（npm、独立包）均可完成上述用例。

### 9.2 用例 × 入口验收矩阵

**用例 1：Zotero 四模式**（前提：serve 运行中）

| 验收点 | 通过条件 |
|---|---|
| 右键四菜单 | Zotero 条目右键出现四项；内核未运行时有明确提示 |
| 翻译为 PDF | 完成后条目下出现译文 PDF 附件；note 记录 docId |
| 构建 RAG | `rag query`（CLI/MCP 均可）能命中该文献 chunk 并返回页/段定位 |
| RAG+翻译 / 双语+翻译 | 产物齐全；且第二次以另一模式触发同一文献时，正文翻译模型调用增量为 0 |
| 跨入口复核 | 同一 docId 在 CLI `export --format md` 与 WebUI 导出按钮产出的 Artifact 引用同一 accepted 集合 |

**用例 2：手动导入**

| 验收点 | 通过条件 |
|---|---|
| 格式分派 | PDF/EPUB/MD/TXT 各至少一个样本；import 返回的可用输出清单与该格式适配器一致 |
| 输出正确 | PDF 可打开且抽检无漏段/错序/溢出（沿用 MVP 口径）；EPUB 回填后阅读器可打开、译文在正确位置 |
| 未知格式 | 报错信息列出已注册适配器，退出码 3 |
| 跨入口 | CLI、MCP、WebUI 导入同一文件产生等价 Document（sourceId 一致时复用） |

**用例 3：精翻工作台**

| 验收点 | 通过条件 |
|---|---|
| 三粒度 | 单段、框选范围、全文三种触发各自只翻译对应 unit；任务进度与取消均可用 |
| 双语对照 | 按段显示原文/译文；编辑后写 human 修订且立即反映到对照视图 |
| 回退 | accept 旧修订后对照视图与后续导出均为旧译文 |
| 一致性 | 工作台编辑并接受后，新建清单导出 PDF/MD，内容与新 accepted 一致；已在运行的多出口任务仍对应原清单，两种导出均无翻译模型调用 |

### 9.3 承接 v1.0 的 P0 验收（沿用 MVP 口径并扩展入口维度）

F-01/03/05/06/07/11/13/14/15/17、F-27(P0 部分)、F-30(P0 部分) 的 MVP 验收条件继续有效；v2.0 新增统一要求：**每条至少在 CLI 与 MCP 两个入口各验证一次**，WebUI 覆盖三条主用例涉及的部分。

### 9.4 明确不属于本版验收的内容

词库结构 redesign（§12）、P2 载体（视觉小说/漫画/字幕）、多设备非回环部署的完整安全审计、自动调度（F-33）。这些不被本版验收，也不以本版文档阻塞其后续设计。

---

## 10. 分阶段实施（承接 M4）

| 阶段 | 内容 | 退出条件 |
|---|---|---|
| M5 服务化骨架 | serve（HTTP+静态页）、textTask 持久化改造、CLI 迁移到新内核服务层；最小 npm 打包管线，sidecar 按需安装 | 用例 2 的 MD/TXT 路径在 CLI 与 HTTP 双通；npm 包装出三端产物 |
| M6 工作台与 MCP | WebUI 工作台页 + 任务页；MCP stdio/HTTP 双 transport | 用例 3 全部验收点；MCP 在至少一个真实 harness 中跑通 import→translate→export |
| M7 PDF/EPUB 与 Zotero | BabelDOC sidecar 打包、可选 MinerU 解析组件、EPUB 适配器、Zotero 插件；跨引擎关联未验证时沿用 BabelDOC 自身来源 | 用例 1 的翻译／双语部分及用例 2 验收；RAG 部分留 M8；三端独立包冒烟 |
| M8 RAG | rag 模块、sqlite-vec 与退化路线、四模式汇合 | 用例 1 的 RAG 相关验收点；性能口径 §8.1 记录首个基线 |

发布工程（代码签名、公证、CI 矩阵构建）从 M5 起并行建设，M7 前必须可用——三端冒烟依赖它。

---

## 11. 风险登记

| 风险 | 等级 | 缓解 |
|---|---|---|
| DSH 为 developer preview，固定源码不等于可发布包；升级路径不明 | 高 | 沿用 ADR-0001：固定版本、只验证实际接入边界；npm 包将 DSH 模块 vendor 进构建产物 |
| Node SEA `node --build-sea` 较新（v25.5 引入），三端坑未踩 | 中 | M5 首个任务就是三端构建冒烟；备选 Bun `--compile`（需另验证 DSH 兼容）或退回 postject 手工流程 |
| Python sidecar 体积与启动耗时（PyInstaller onefile 含科学计算依赖，数百 MB 级） | 中 | sidecar 常驻 + stdio 复用；按格式拆 sidecar（PDF 一个、MinerU 一个）避免全量加载 |
| sqlite-vec 扩展在三端的分发 | 中 | 预编译扩展随发行包；不可用即退化 JSONL 路线，功能不阻塞 |
| Zotero 插件 API 版本耦合（Zotero 7 插件机制） | 中 | 插件做薄；协议只有 4 个端点，Zotero 侧适配面小 |
| storage-domain 无二级索引/跨表事务，查询模式受限 | 中 | reuseKey 入主键规避；工作台列表查询若成瓶颈再评估 cordis database 适配（调研已列为候选） |
| WebUI 单文件打包后静态资源体积与缓存 | 低 | SPA 构建产物 gzip 后量级 MB 内；SEA blob 支持内嵌资源，必要时改为旁置 assets 目录 |
| macOS 签名/公证流程成本 | 低 | CI 自动化；未签名时文档说明 Gatekeeper 绕行属用户选择 |

## 12. 未定项与后续研判

1. **词库结构（C7）**：术语条目、义项、适用范围（amendment 0001 的维度）与库组合的落地 schema 另行研判；本文只约束调用规则（先范围筛选后匹配、约束集合 id 参与复用键）。现有实验词库不自动迁移。
2. **DOCX/PPTX 原生回填**：第一阶段 Office→PDF 仅解决可读输出；原生往返按 v1.0 的 P1 另行评估 Okapi 路线。
3. **审校工作流**：F-22 的 AI 审校与全篇一致性检查在 translation 管线预留步骤位，具体设计随工作台使用反馈再定。
4. **多设备**：F-38 条件式推进；serve 已具备监听非回环地址的能力（§7 token 前提），不额外建设。
5. **P2 载体**（视觉小说/漫画/字幕）：适配器契约已就位，逐个补设计，见 §6.4。

---

## 附：与既有文档的关系

- 本文不修改 v1.0 需求基线编号与优先级；C1–C8 是用户给定约束的登记，不是新功能编号。
- MVP（M0～M4）产物与验收记录继续有效；本文 M5～M8 直接承接。
- 与本文冲突的旧表述以本文为准的范围仅限：产品形态（三端三入口）、分发（npm + 独立包）、RAG 管线边界。其余未提及内容沿用原状。
