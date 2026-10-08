# ivoraige API 协议规格 v2.0

版本：v2.0｜2026-10-03 审阅修订｜状态：协议设计，三入口（CLI/MCP/WebUI）与外部插件（Zotero）共同遵守；不代表已实现。

上位文档：[01_设计与验收基线 v2.0](01_design_v2.0.md)（下称《设计》）。本文只定义协议：端点、schema、错误码、SSE 事件、sidecar 协议、认证与安全。业务规则以《设计》为准；词库字段随词库结构研判调整，本文术语部分只锁定传输形状。

当前工作台只实现本文的一部分；下文明确标注“当前实现”的规则为该阶段的线上协议，其余仍是后续目标，不因当前尚未装配而删除。当前入口为 CLI、HTTP 与 WebUI；可选 BabelDOC sidecar 已支持原生文本英文 PDF 导入和中文单语 PDF 回放。MCP、EPUB、OCR、双语 PDF、跨引擎映射、RAG、Zotero 桥及非回环认证仍待实现。

**0.1.0 实现边界**：翻译入口当前从 DSH 已保存的模型选择取路由，不接受请求级 `profileId`；§3.2 中携带 `profileId` 的字段属于后续协议。非 `none` 的术语约束集合没有可用的词库写入或组装 API；内部 `setConstraints` 只支持保存约束标识并做修订适用性检查，尚未实现按术语 scope 筛选、匹配和组装。下文完整术语 schema 与算法仍是 v2.0 设计目标。

## 1. 总约定

### 1.1 传输与版本

- HTTP API 前缀 `/api`，当前版本 `"apiVersion": "2.0"`。所有响应 JSON 顶层含 `apiVersion` 字段；CLI `--json` 输出与 REST 响应**同一份序列化结构**（schema 共用 zod 定义，CLI 只是换 stdout）。
- 破坏性变更升级 `apiVersion` 并保留旧版本端点至少一个次版本；新增可选字段不算破坏。
- MCP tools 的参数与返回复用同一份 zod schema（`@modelcontextprotocol/sdk` 支持 zod 注册），命名 `ivoraige_<verb>`，见 §6。

### 1.2 认证与安全（照搬 DSH 凭据体系）

- 默认绑定 `127.0.0.1`，此模式下**不要求 token**（回环即边界）。
- `--host` 放开非回环监听时：首次启动由 `dsh-credentials-local` 生成命名凭据 `ivoraige.local-token`（32 字节随机，hex）；客户端必须携带 `Authorization: Bearer <token>`，缺失或错误一律 `401`。
- WebUI 同源部署：页面引导时经 `/api/auth/bootstrap`（仅回环可访问）取 token 注入内存，不落 localStorage。
- **DNS rebinding 防护**：校验 `Host` 头，只接受 `127.0.0.1`、`localhost`、`[::1]` 或显式配置的主机名；不匹配返回 `403`。
- **CORS**：默认 `Access-Control-Allow-Origin` 不下发（即拒绝一切跨域页面调用）；仅当用户显式配置允许来源时才输出对应白名单。
- SSE 走同一认证；`EventSource` 不支持自定义头，故 SSE 端点额外接受 `?token=` 查询参数（仅非回环模式需要）。

**当前实现限制**：`serve` 只允许回环地址，传入非回环 `--host` 直接返回 `INVALID_ARGUMENT`；命名 token、`/api/auth/bootstrap` 与非回环 SSE 认证尚未装配。当前 HTTP 校验 Host 与同源 Origin，不下发跨域许可。上面的非回环规则保留为目标协议，不能据此宣称当前可安全对外监听。

### 1.3 错误信封与错误码

所有非 2xx 响应：

```json
{ "apiVersion": "2.0", "error": { "code": "NOT_FOUND", "message": "...", "details": { } } }
```

| HTTP | code | 含义 | CLI 退出码映射 |
|---|---|---|---|
| 400 | `INVALID_ARGUMENT` | 参数/用法错误（zod 校验失败在 details 给出路径） | 2 |
| 401 | `UNAUTHORIZED` | token 缺失或错误 | 2 |
| 403 | `FORBIDDEN_HOST` | Host 头不合法 | 2 |
| 404 | `NOT_FOUND` | docId/taskId/unitId 不存在 | 3 |
| 409 | `CONFLICT` | 并发写冲突（修订版本过期、同类任务在跑） | 3 |
| 412 | `PRECONDITION_FAILED` | 前置不满足（如无 accepted 译文而导出） | 3 |
| 502 | `UPSTREAM_FAILURE` | 模型/解析 sidecar 失败，details 含 stage 与上游摘要 | 4 |
| 503 | `COMPONENT_MISSING` | sidecar/权重等组件缺失，details 含安装指引 | 3 |
| 500 | `INTERNAL` | 未预期错误，details 含 traceId（对应日志行） | 4 |

任务被取消时，任务状态接口返回 `state: "canceled"`（200）；直接请求中的操作被取消返回 499 语义以 `UPSTREAM_FAILURE` + `details.canceled: true` 表达，CLI 映射退出码 5。

### 1.4 并发与写冲突规则（落实《设计》遗留缺口）

- **修订乐观锁**：写新译文带 `baseRevisionId: Id | null`，指该 `(unitId, targetLang)` 当前最新修订，无修订时为 null；不一致返回 `409 CONFLICT`，details 携带最新修订，由调用方决定合并或重试。
- **accepted 翻转**：接受／回退／取消接受带 `expectedAcceptedRevisionId: Id | null`，与当前 accepted 比较；要接受的版本由 URL 的 revisionId 指定，不能与乐观锁字段混用。两个入口同时改变同一 `(unitId, targetLang)` 的接受版本，后到者 409。接受旧修订仍须检查当前来源、上下文及目标约束，失效时返回 412，不因它曾被接受就绕过适用性检查。
- **同类任务互斥**：同一 docId 上 `translate`/`export`/`rag` 各允许一个在跑任务；重复提交返回 `409 CONFLICT`，details 含在跑 taskId，调用方可选择 `attach`（订阅已有任务）或取消后重提。
- **import 幂等**：`sourceId + 内容指纹` 命中已有 Document 时返回既有 docId 并置 `deduplicated: true`，不新建。
- **当前模型设置写入互斥**：有 `queued`／`running` 翻译任务时，模型路由／选择或命名凭据写入返回 `409 CONFLICT`；先暂停任务，再修改设置。翻译任务的提交／恢复与设置写入经过同一入场串行化，避免任务开始期间切换模型。

## 2. 核心 schema（zod 逻辑定义，字段名为线上形状）

```ts
// 公共
type Id = string;                       // nanoid，URL 安全
type ISODate = string;

interface Document {
  id: Id; sourceId: string; format: "pdf" | "epub" | "md" | "txt" | "docx";
  language: string;                     // BCP-47
  title: string; origin: "manual" | "zotero" | "cli" | "mcp";
  externalRef?: string;                 // Zotero item key 等
  unitCount: number; translatableCount: number;
  availableOutputs: string[];           // 已装输出实现与来源绑定共同决定
  warnings?: string[]; sourceCoverage?: Record<string, unknown>; // PDF 捕获覆盖与人工核对提示
  importedAt: ISODate;
}

interface Unit {
  id: Id; docId: Id; order: number;
  kind: "heading" | "body" | "caption" | "formula" | "code" | "reference" | "other";
  sourceText: string; context?: string;
  locator?: Record<string, unknown>;    // 适配器自定义：{page, block} / {spinePath, elementIndex} ...
  translatable: boolean;
  targetLang: string;                   // 本次查询的译文视图，不是原文属性
  acceptedRevisionId?: Id; draftRevisionId?: Id;
}

interface Revision {
  id: Id; unitId: Id; targetLang: string; text: string;
  origin: "machine" | "human" | "imported";
  status: "draft" | "accepted" | "superseded";
  modelId?: string; promptVersion?: string; reuseKey: string;
  createdAt: ISODate;
}

type TaskKind = "import" | "parse" | "translate" | "export" | "rag";
type TaskState = "queued" | "running" | "paused" | "succeeded" | "failed" | "canceled";

interface Task {
  id: Id; kind: TaskKind; docId?: Id; targetLang?: string; state: TaskState;
  progress: { stage: string; done: number; total: number };
  cursor?: unknown;                     // 断点位置，种类自定义
  error?: { stage: string; unitId?: Id; message: string };
  stats: TaskStats;                     // 见下
  artifacts: Artifact[];
  label?: string;                        // 导入完成前标识来源
  result?: { document: Document; deduplicated: boolean; warnings: string[] }; // 成功的导入任务
  createdAt: ISODate; updatedAt: ISODate;
}

interface TaskStats {
  stageDurationsMs: Record<string, number>;
  llmCalls: number; reusedUnits: number; reuseRatio: number;   // reuseRatio = reused/(reused+llmCalls 对应单位数)
  tokens: Record<string, { input: number | null; output: number | null }>; // 按模型角色分；未知在线上传输为 null
}

interface Artifact {
  id: Id; docId: Id; targetLang: string; format: string; path: string;
  snapshotId: Id; revisionSetHash: string; createdAt: ISODate;
}

interface ExportSnapshot {
  id: Id; docId: Id; targetLang: string;
  sourceBindingRef: string;             // 来源绑定标识（适配器私有）
  resourceVersions: Record<string, string>; // 输出所需资源的版本引用
  items: { unitId: Id; decision: { type: "revision"; revisionId: Id } | { type: "skip" | "keepOriginal" } }[];
  revisionSetHash: string;              // 创建时计算一次
  createdAt: ISODate;
}

interface RagChunk {
  id: Id; docId: Id; order: number; text: string;
  locator?: Record<string, unknown>;    // 与 Unit.locator 同形状，供"跳到原文"
  score?: number;                       // 仅检索结果携带
}
```

字段级规则：

- `tokens.*` 未知时 JSON 保留 `null`，界面显示“未知”，**绝不填 0**（沿用 ADR-0001 边界）。
- 单位查询与翻译／编辑／导出明确传 `targetLang`；accepted/draft ID 仅属于该语言视图，不在其他语言之间共用。按 revisionId 操作时从修订记录取得语言。快照引用不可变来源／译文清单，Artifact 的摘要不与任务结束时的最新记录比较。
- `locator` 是适配器自定义对象，但**必须**至少能回答"第几页/第几段"；协议不约束内部字段。
- 列表端点统一分页：`?cursor=<opaque>&limit=<n≤500>`，响应 `{ items: [], nextCursor?: string }`。万级 unit 列表不依赖全量拉取。
- 当前 HTTP 与 CLI 的列表响应在顶层另含 `apiVersion`，即 `{ apiVersion: "2.0", items: [], nextCursor?: string }`；适用于文档、单位、修订、任务、产物及快照列表。`nextCursor` 省略表示列表结束。

## 3. REST 端点

### 3.1 文档与单位

| 方法 | 路径 | 请求 | 响应 |
|---|---|---|---|
| POST | `/api/documents/import` | `{ path?: string, contentBase64?: string, format?: string, language: string, sourceId?: string, externalRef?: string, title?: string, origin?: string }`（path 与 contentBase64 二选一；当前 `language` 必填且不得为 `auto`） | TXT/MD：`{ document: Document, taskId: Id, deduplicated: boolean, warnings: string[] }`；PDF：立即返回 `{ taskId: Id }`，完成后从 Task.result 读取同一导入结果 |
| GET | `/api/documents` | `?origin=&format=&cursor=&limit=` | 分页 Document[] |
| GET | `/api/documents/{docId}` | — | `{ document: Document }` |
| GET | `/api/documents/{docId}/units` | `?targetLang=<必填>&filter=all\|untranslated\|draft\|accepted&cursor=&limit=` | 分页 Unit[]（含该语言 accepted/draft 修订 id，不内嵌全文） |
| GET | `/api/units/{unitId}` | `?targetLang=<必填>` | `{ unit: Unit, accepted?: Revision, draft?: Revision }` |
| GET | `/api/units/{unitId}/revisions` | `?targetLang=<必填>` | 该语言 Revision[]（版本翻看数据源） |

当前导入接受 UTF-8 TXT／Markdown，以及在装配 PDF 组件时接受二进制 PDF（`format: "txt" | "md" | "pdf"`，或由路径识别）。`contentBase64` 保留原始字节，PDF 不作 UTF-8 解码；HTTP 请求体最多 10 MiB。TXT/MD 有界解析在请求内完成，返回已持久化的完成态 import Task。PDF 解析异步执行，Task 在完成前无 docId，成功时 `result` 包含 document、deduplicated、warnings；可取消，失败后重新提交来源，不提供续跑。调用方须明确原文语言，当前没有自动检测。`path` 是服务端可访问的路径；浏览器上传使用 `contentBase64`。原始 PDF 的受管理副本随 store 保留，供冻结快照重放。

### 3.2 翻译与编辑

| 方法 | 路径 | 请求 | 响应 |
|---|---|---|---|
| POST | `/api/documents/{docId}/translate` | `{ targetLang: string, profileId?: string, unitIds?: Id[], mode?: "fast" \| "careful" }`；unitIds 缺省=全部 translatable | `{ taskId: Id }` |
| POST | `/api/translate-text` | `{ text: string, sourceLang?: "auto" \| string, targetLang: string, profileId?: string }` | `{ documentId: Id, unitId: Id, revision: Revision }`（文本翻译页首轮） |
| POST | `/api/translate-text/regenerate` | `{ unitId: Id, targetLang: string, profileId?: string, previousRevisionId: Id }` | `{ documentId: Id, unitId: Id, revision: Revision }`（同一原文生成新修订，不改旧） |
| PATCH | `/api/units/{unitId}` | `{ targetLang: string, baseRevisionId: Id \| null, text: string }`；写 human 草稿修订，不自动接受 | `{ revision: Revision }`；baseRevisionId 过期→409 |
| POST | `/api/revisions/{revisionId}/accept` | `{ expectedAcceptedRevisionId: Id \| null }`（无 accepted 时为 null） | `{ accepted: Revision }` |
| POST | `/api/units/{unitId}/unaccept` | `{ targetLang: string, expectedAcceptedRevisionId: Id \| null }` | `{ accepted: null }`；保留修订历史 |

**当前实现**：只有 `/api/documents/{docId}/translate` 已作为翻译入口装配，使用请求中的 `targetLang`、`unitIds`、`mode`；请求级 `profileId` 尚未装配。`/api/translate-text` 及其 regenerate 路径是后续文本翻译页目标。当前自动翻译遇到非 `none` 术语约束集合会显式失败，不能把约束标识的存储与适用性检查解释为术语装配能力。

文本入口首轮即建立持久 Document 和一个承载当前输入的 Unit，修订引用该 unitId；语言检测先解析为实际语言再落库。重新生成从已有 Unit 取原文，校验 previousRevisionId 属于该单位／语言；输入原文改变时走新的文本导入，不把不同原文混入同一版本组。版本翻看、接受和进入工作台复用上表接口及 documentId，无需二次搬迁临时状态。

### 3.3 输出与 RAG

| 方法 | 路径 | 请求 | 响应 |
|---|---|---|---|
| POST | `/api/documents/{docId}/export` | `{ targetLang: string, outputs: { format: string, out?: string }[], snapshotId?: Id, onMissingAccepted?: "fail" \| "skip" }`（默认 fail，《设计》§3.3） | `{ taskId: Id, snapshotId: Id }`；任务产物在 Task.artifacts |
| GET | `/api/documents/{docId}/artifacts` | — | Artifact[] |
| GET | `/api/documents/{docId}/snapshots` | `?targetLang=` | ExportSnapshot[]（发现可用快照；CLI `--snapshot` 的 id 来源） |
| GET | `/api/documents/{docId}/snapshots/{snapshotId}` | — | `{ snapshot: ExportSnapshot }` |
| DELETE | `/api/documents/{docId}/snapshots/{snapshotId}` | — | 无引用时 200；有引用 409 |
| POST | `/api/documents/{docId}/rag/build` | `{ chunker?: string, embedModel?: string }` | `{ taskId: Id }` |
| POST | `/api/documents/{docId}/rag/query` | `{ q: string, k?: number ≤ 50 }` | `{ chunks: RagChunk[], degraded: boolean }`（degraded=向量扩展不可用走退化路线） |

首次导出在受理时生成冻结清单，outputs 内所有格式共用它；单格式也是长度为 1 的 outputs。传 snapshotId 时复用原清单，并检查它属于该 docId／targetLang；缺项策略沿用该清单，不允许覆盖。省略 snapshotId 则按当前适用版本创建新清单。清单保存来源绑定、原文与资源版本以及各 unit 的选定 revision／保留原文决定，之后编辑不会改变它。

快照生命周期：只存引用与逐 unit 决定，默认永久保留，不自动过期。删除语义：`DELETE /api/documents/{docId}/snapshots/{snapshotId}` 在无 Artifact 引用时允许；有引用返回 `409 CONFLICT`，details 列出引用方 artifactId。来源资源由 import 记录钉住，快照删除不影响资源存续。

### 3.4 任务

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/tasks?state=&kind=&cursor=` | 分页 Task[] |
| GET | `/api/tasks/{taskId}` | `{ task: Task }` |
| POST | `/api/tasks/{taskId}/cancel` | 取消信号贯穿到在途模型调用 |
| POST | `/api/tasks/{taskId}/pause` / `/resume` | 暂停在 unit 边界生效；恢复从 cursor 续跑，校验持久化完成记录的适用性后跳过（包括尚未接受的精翻草稿）；未完成 unit 再做复用检查 |
| GET | `/api/tasks/{taskId}/events` | SSE，事件见 §4 |
| GET | `/api/events` | 全局 SSE（任务列表页用），事件同 §4 |

翻译修订、接受指针（快速模式）与 unit 完成记录／cursor 必须原子提交。启动恢复将遗留 `queued`／`running` 任务转为 `paused`，由用户显式续跑；`failed` 任务也可从已提交断点重试。完成记录失去当前适用性时，恢复返回 `PRECONDITION_FAILED`，不静默重译已完成段落。仅已提交结果具备不重复调用保证；请求已被供应商执行但本地尚未落库时崩溃，恢复可能再次请求该 unit。模型调用计数在调用前持久化，表示内核已登记的调用尝试；重试或未完成请求无法确认的 token 用量继续为 `null`。

上述断点恢复适用于翻译任务。PDF 导入任务独立于文档运行，完成前以 `label` 标识来源；`result.document` 只在成功后存在。导入失败或进程中断须重交来源，暂停／恢复不适用。

### 3.5 术语（形状锁定，字段随词库研判扩展）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/terms?library=&status=&q=` | 分页条目 |
| POST | `/api/terms/{entryId}/confirm` | 候选→已确认 |
| PATCH | `/api/terms/{entryId}` | 编辑；`baseRevision` 乐观锁同上 |

### 3.6 Zotero 桥（落实"RAG 构建挂什么附件"）

| 方法 | 路径 | 行为 |
|---|---|---|
| POST | `/api/zotero/translate` | `{ zoteroItemKey, pdfPath, targetLang, mode?, bilingual? }` → import(externalRef=zoteroItemKey) → translate → export；`{ taskId }` |
| POST | `/api/zotero/rag` | 同上前缀 → rag build → **额外产出两个可附文件**：`<title>.rag-manifest.json`（chunk 清单：文本、locator、嵌入模型、向量维度、构建时间；**不含向量本体**）与 `<title>.rag-report.md`（人类可读摘要：文档结构、chunk 数、检索入口说明）。RAG 索引本体留在内核存储，附件是"索引的可搬运描述"。 |
| POST | `/api/zotero/rag-translate` | rag 与 translate 并行，汇合后 export；附件 = manifest + report + 译文文件 |
| GET | `/api/zotero/task/{taskId}` | `{ task: Task, attachments: { path: string, suggestedName: string }[] }`（Zotero 插件按此挂附件） |

### 3.7 当前工作台能力与模型设置

下列端点已用于 TXT/Markdown 工作台，返回 JSON 时均遵循 §1 的 `apiVersion`／错误信封。它们补充当前实施子集，不改变后续 profile、词库及资产管理的目标协议。

| 方法 | 路径 | 请求 | 响应 |
|---|---|---|---|
| GET | `/api/capabilities` | — | `{ features: string[], settingsPages: { id, label, order }[], inputFormats: string[], outputFormats: string[], components?: object }`；`settingsPages` 是已装配插件通过生命周期注册的有序纯数据描述，按 `order`、`id` 排序；非空时 `features` 才含 `settings`，卸载插件后页面消失。PDF 组件状态 `components.babeldoc` 为 `unchecked`／`ready`／`unavailable`，可带 `message`；已装配但不可用仍注册 PDF 设置页。配置只表示可尝试，首次操作前不能声称已就绪 |
| GET | `/api/settings/modelconfig` | — | `{ settings: { selected: { provider, model, timeoutMs } \| null, savedModels: { provider, model, timeoutMs }[], presets, routes, credentials, revisions: { routes, selected } } }`；凭据只返回状态，不返回值；presets 是提供商模板及固定版本模型候选，不是账号实时可用性声明 |
| PATCH | `/api/settings/modelconfig` | `{ provider, model, api?, baseURL?, credentialRef?, contextWindow?, maxTokens?, reasoning?, compat?, reasoningEfforts?, timeoutMs?, select?, selectOnly?, routesRevision?, selectedRevision? }` | `{ settings: ... }`；`select: false` 只保存到模型列表，默认 `select: true` 保持旧版保存并选择行为；`selectOnly: true` 仅切换已保存模型，此时只接受 provider、model、selectOnly 和两个 revision 字段；DSH schema 校验，显式 revision 过期返回 409。修改路由及模型选择分两次 DSH 写入；若路由已持久化而第二次失败，错误 `details.partialSave` 为 `{ persisted: "routes", failed: "selected", revisions: { routes: number|null } }`；其中 `selected` 指第二次 DSH 写入（保存模型列表及可选的当前选择）。`savedModels` 读取时也会从已保存路由推导模型，因此失败后仍可能显示新模型，不能把列表显示视为第二次写入成功。已知内核错误码及冲突详情保留，其他第二次写入错误映射为 `UPSTREAM_FAILURE`。客户端须重新 GET 后核对，不能假设事务或自动重试旧 revision |
| PUT | `/api/settings/credentials` | `{ ref, value }` | `{ configured, source?, writable }` 等 DSH 凭据状态字段；秘密仅写入 `dsh-credentials-local`，响应不回显 `value` |
| GET | `/api/artifacts/{artifactId}/download` | — | 产物文件流；文件下载是 §1.1 JSON 规则的二进制例外 |

初次启动可无模型配置，`selected` 为 `null`；若发起翻译时仍无选择，`POST /translate` 仍先返回 taskId，执行时模型服务抛出 `COMPONENT_MISSING`，任务随后记为失败。模型配置只存命名凭据引用，例如 `DeepSeek_API_TOKEN`；密钥值走凭据端点。`GET` 的 `credentials` 以提供商路由名为键，值是 DSH 的存在性与可写性描述，不是密钥。

模型配置 `PATCH` 中字段省略表示保留原值；`api`／`baseURL`／`credentialRef`／`reasoning`／`compat` 显式 `null` 表示删除对应路由覆盖。`contextWindow` 与 `maxTokens` 必须成对提供正整数，或同时为 `null` 以移除该模型的目录容量覆盖；`reasoningEfforts: null` 移除该模型的推理档位覆盖。未知自定义模型须声明实际容量，不能用清空来制造无声明模型；目录路由没有显式 models 列表时仅允许选择已收录模型，未收录模型用独立自定义路由声明。不满足声明条件返回 `INVALID_ARGUMENT`，不写入路由或列表。

路由与模型列表／当前选择分别属于 DSH 的两个可编辑插件条目。`PATCH` 保存配置时先保存路由，再保存列表和（如需）选择；每步由 DSH config-editor 持久化并热更新，但这两个条目之间不是一个跨条目原子事务。若第二步失败，已成功的路由写入仍保留，客户端应重新 `GET` 后修正。纯切换只修改选择、不写路由。`PATCH` 只接受表中列出的字段，未知字段返回 `INVALID_ARGUMENT`。`routesRevision` 与 `selectedRevision` 在写前检查，后者也保护 savedModels 列表。旧配置的显式 route.models／modelOverrides 和当前选择在读取时补入列表，读取优先级为显式 savedModels、当前选择、推导路由；下次保存配置时随列表持久化。同一提供商标识下的模型共享路由级端点／凭据／推理设置；不同端点或账号使用不同提供商标识。内置目录模型的单项容量调整使用 modelOverrides，避免用显式 models 列表意外收窄目录；已存在显式 models 列表的语义不变。设置和凭据更新继续遵守 §1.4 的运行任务互斥，包括仅保存非当前模型的请求。

## 4. SSE 事件类型

`data:` 行为 JSON，`event:` 为类型名：

| event | data | 时机 |
|---|---|---|
| `task.queued` / `task.started` | `{ taskId, kind }` | 入队/开跑 |
| `task.progress` | `{ taskId, stage, done, total }` | 节流至 ≤2 次/秒；阶段切换必发 |
| `unit.completed` | `{ taskId, unitId, targetLang, reused: boolean }` | 每单位；工作台实时刷新对照视图 |
| `task.paused` / `task.resumed` | `{ taskId, cursor? }` | — |
| `task.failed` | `{ taskId, stage, unitId?, message }` | 失败即终态 |
| `task.canceled` | `{ taskId }` | — |
| `task.succeeded` | `{ taskId, artifacts: Artifact[], stats: TaskStats }` | 摘要区持久展示的数据源 |
| `settings.pages.changed` | `{ settingsPages: { id, label, order }[] }` | 设置插件页面挂载或卸载时发出；客户端重新读取 `/api/capabilities`，刷新可用导航和组件状态。新连接仍以 capabilities 为准 |

断线重连协议：客户端先 `GET /api/tasks/{id}` 拉快照，再续订 SSE；服务端不重放历史事件（快照即真相），只在响应头给 `X-Event-Id` 供日志对齐。

## 5. CLI 输出协议

- `--json` 时 stdout 输出与该操作对应的 REST 响应体**逐字节同构**（同一序列化函数）。
- 长任务：`ivoraige translate --json-events` 输出 NDJSON，每行一个 §4 事件对象；脚本可逐行消费。
- 退出码映射见 §1.3；stderr 只写人类可读提示，脚本不应解析。

## 6. MCP tools 映射

tools 与 REST 一一对应，schema 共用；长任务型 tool 一律返回 `{ taskId }` 异步句柄，配 `ivoraige_task_status` 轮询（MCP 无 SSE，用轮询 + 可选 `waitSeconds≤60` 长轮询参数）。

| tool | 对应端点 | 备注 |
|---|---|---|
| `ivoraige_import` | POST /documents/import | contentBase64 路径支持无本地文件访问的 harness |
| `ivoraige_translate` | POST /documents/{id}/translate | — |
| `ivoraige_translate_text` | POST /translate-text(+regenerate) | `regenerate: true` 走重新生成 |
| `ivoraige_export` | POST /documents/{id}/export | — |
| `ivoraige_rag_build` / `ivoraige_rag_query` | §3.3 | — |
| `ivoraige_task_status` / `ivoraige_task_cancel` / `ivoraige_task_pause` / `ivoraige_task_resume` | §3.4 | status 支持 `waitSeconds` 长轮询 |
| `ivoraige_unit_update` | PATCH /units/{id} | 必须传 baseRevisionId；AI 客户端收到 409 应重读再改 |
| `ivoraige_revision_accept` / `ivoraige_unit_unaccept` | §3.2 接受／取消接受 | 使用 expectedAcceptedRevisionId，语言规则同 REST |
| `ivoraige_units_list` / `ivoraige_revisions_list` | §3.1 | — |
| `ivoraige_terms_list` / `ivoraige_terms_confirm` / `ivoraige_terms_edit` | §3.5 | — |

resources：`ivoraige://docs/{docId}`、`ivoraige://docs/{docId}/units/{unitId}?targetLang={language}`、`ivoraige://tasks/{taskId}`，内容为对应 JSON 的人类可读渲染（Markdown）。

## 7. Python sidecar 协议

进程管理沿用 DSH 的 subprocess 模式（同 dsh mcp-client 的 spawn + 超时 + 取消链路）。传输：**NDJSON 编码的 JSON-RPC 2.0 over stdio**，每行一个完整消息。

### 7.1 握手与方法

```
→ {"jsonrpc":"2.0","id":1,"method":"handshake","params":{"protocolVersion":1}}
← {"jsonrpc":"2.0","id":1,"result":{"protocolVersion":1,"capabilities":{"parse":["pdf"],"rebuild":["pdf"]}}}
```

| method | params | result | 说明 |
|---|---|---|---|
| `handshake` | `{ protocolVersion }` | capabilities | 版本不匹配 → 内核报 COMPONENT_MISSING 并提示升级 sidecar |
| `configure` | `{ modelDirs: Record<string,string>, options }` | `{}` | 权重目录在此注入（§8），sidecar 不自行下载 |
| `parse` | `{ path, options }` | `{ doc: ParsedDoc }` | 大文档通过 `progress` 通知报进度 |
| `rebuild` | `{ docRef, revisionsRef, out, format }` | `{ path }` | 输入为内核落盘的临时 JSON 文件路径（避免 stdio 传大对象），输出为文件路径 |
| `shutdown` | `{}` | — | 内核退出/释放时调用 |

通知：`{"method":"progress","params":{"stage","done","total"}}` → 映射为 `task.progress` 事件。

BabelDOC `rebuild` 的冻结单位中，进入翻译回调的单位接受 `revision` 或 `skip` 决策；`skip` 的 `text` 必须等于绑定的原始请求文本，回放保留原文而不补译。未进入回调的单位仍要求 `keepOriginal`。这些决策继续参与来源与占位符完整性检查。

BabelDOC `parse` 按来源位置关联回调与完成后的 tracker payload；tracker 缺失或请求不一致时不关联 payload，并记录警告。占位符显示优先采用可唯一确定的原文对齐；否则使用 BabelDOC 公式 `formula_chars`、富文本成对 token 的空显示，未知 token 保留其字面形式，并以页码、位置及 token 记录回退警告。映射不确定不阻止导入或翻译。`rebuild` 对照原始引擎请求校验占位符顺序，与持久化显示映射是否完整无关；旧记录的 null／缺失显示按字面 token 用于可读诊断。回放遵循 BabelDOC 自身的文本处理，包括连续标点缩写。输出文本核对包含公式展开文本；页级提取缺失只作为未验证证据和目检提示，不阻止 PDF 输出，也不能代替布局验收。来源位置、请求文本及冻结决策不匹配仍须拒绝。

内核为每次 sidecar 启动创建独占临时目录，通过 `configure.options.workDir` 传入。用户配置的 workDir 是这些目录的父目录。取消／关闭等待子进程退出后只清理该专属目录；不会删除工作根或扫描其他会话。父进程被强杀、断电后的历史残留回收不属于当前保证。

错误：JSON-RPC error 对象的 `code` 自定义区间 `-32001` 解析失败、`-32002` 权重缺失、`-32003` 重建失败；内核映射为 `UPSTREAM_FAILURE`/`COMPONENT_MISSING`。`-32001` 或 `-32003` 携带 `data.code=PRECONDITION_FAILED` 时映射为同名内核错误。

当前 BabelDOC sidecar 以单独 Python 3.13 环境运行，通过 `--pdf-config` 显式装配；PDF 组件首次操作时验证，缺失不妨碍文本工作台启动。进程常驻复用，崩溃后单个请求最多重新启动一次，仍失败则任务 failed。MinerU 与 BabelDOC **分两个 sidecar 可执行文件**（解析与重建独立缺失、独立升级）是后续目标。当前只开放 BabelDOC 原生文本捕获与单语 PDF 回放；双语格式不是已公布能力。

### 7.2 与内核 IR 的对齐

`parse` 返回的 ParsedDoc 包含通用原文单位、locator 与适配器私有来源绑定；API Unit 中的 targetLang 和译文 ID 是内核查询时附加的视图，不由解析器生成。核心校验通用结构，工具专用字段交来源适配器校验。`rebuild` 的 docRef／revisionsRef 必须来自同一冻结清单；MinerU 块不能直接当作 BabelDOC 回放绑定，跨引擎关联未实现时只开放该来源实际可用的出口。

## 8. 模型权重资产管理（复用边界）

`dsh-attachment` + `dsh-attachment-local` 可复用文件存储能力，但固定版本未提供 HTTP 下载／Range 续传管理器，也不自动产出工具需要的权重目录树。下载优先选已有实现，目录装配作为具体工具适配；本节是待验证方案，不声称已能直接照搬完整能力。

当前 PDF 子阶段使用 `scripts/setup-pdf.ps1` 调用 BabelDOC `--warmup` 准备默认缓存；下面的统一资产清单、`assets pull` 和设置页下载按钮仍是设计目标，不是现有命令或界面。当前资产缺失时提示执行 setup 脚本。

1. **资产清单**：内核内置 `assets.json`（随版本发布），每项 `{ name, urls[], sha256, sizeBytes, requiredFor }`（如 `mineru-layout`、`mineru-ocr`、`doclayout-yolo`）。
2. **下载**：`POST /api/assets/{name}/pull` 建任务（复用任务系统，进度=字节数），由所选下载实现处理 HTTP／Range，完成时校验 digest 后标记可用；不一致清理该次残留并 failed。内容寻址入库可复用附件组件，不将下载能力归给它。
3. **注入 sidecar**：适配器将资产装配为引擎需要的目录，并经 `configure` 注入。普通任务复用已就绪路径与已有校验结果，不逐次重新读取／哈希整个权重；附件组件的读取接口有 digest 校验，不能机械地放到每次模型加载的热路径。缺少权重时返回 `-32002` → `COMPONENT_MISSING`，提示 `ivoraige assets pull <name>`。
4. **CLI/界面**：`ivoraige assets list`（名称、大小、已就绪/缺失）、`assets pull/remove`；WebUI 设置页"组件与模型"区块展示同一清单，PDF 处理设置区对缺失权重直接给"下载"按钮。
5. 用户自备权重：资产清单允许 `path` 覆盖（settings 中配置），跳过下载与校验。

## 9. 验收口径（协议层）

1. 同一操作在 REST 响应、CLI `--json`、MCP tool 返回三者中字段名与值完全一致（用同一 fixture 做三入口快照比对）。
2. §1.3 每个错误码至少有一个可触发路径的测试（含 409 并发冲突：两个客户端同时 PATCH 同一 unit）。
3. SSE 断线重连后任务页进度与服务端一致（快照对齐测试）。
4. sidecar 握手版本不匹配、权重缺失、进程崩溃三类故障各映射为规定的错误码与提示。
5. 权重下载任务：断网中断后 Range 续传完成，digest 校验失败有明确 failed 状态。
6. 导出期间接受新译文，已有多格式任务仍输出同一 snapshotId 的内容；显式复用该快照增加格式不调用模型。上下文、同名风格预设或相关术语变更后，不得仅凭旧 reuseKey 复用不适用译文。
