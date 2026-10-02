# ivoraige API 协议规格 v2.0

版本：v2.0｜2026-10-02｜状态：协议基线，三入口（CLI/MCP/WebUI）与外部插件（Zotero）共同遵守。

上位文档：[01_设计与验收基线 v2.0](01_design_v2.0.md)（下称《设计》）。本文只定义协议：端点、schema、错误码、SSE 事件、sidecar 协议、认证与安全。业务规则以《设计》为准；词库字段随词库结构研判调整，本文术语部分只锁定传输形状。

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

- **修订乐观锁**：所有写译文/接受/回退的请求必须带 `baseRevisionId`（客户端当前看到的修订 id）。服务端比对当前最新修订，不一致返回 `409 CONFLICT`，details 携带最新修订全文，由调用方决定合并或重试。WebUI 工作台收到 409 时提示"该段已被其他入口修改"并展示两个版本。
- **accepted 翻转**：同一 (unitId, targetLang) 的 accept 操作是同一乐观锁域；两个入口同时 accept 不同修订，后到者 409。
- **同类任务互斥**：同一 docId 上 `translate`/`export`/`rag` 各允许一个在跑任务；重复提交返回 `409 CONFLICT`，details 含在跑 taskId，调用方可选择 `attach`（订阅已有任务）或取消后重提。
- **import 幂等**：`sourceId + 内容指纹` 命中已有 Document 时返回既有 docId 并置 `deduplicated: true`，不新建。

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
  availableOutputs: string[];           // 由适配器 rebuild 能力决定
  importedAt: ISODate;
}

interface Unit {
  id: Id; docId: Id; order: number;
  kind: "heading" | "body" | "caption" | "formula" | "code" | "reference" | "other";
  sourceText: string; context?: string;
  locator?: Record<string, unknown>;    // 适配器自定义：{page, block} / {spinePath, elementIndex} ...
  translatable: boolean;
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
  id: Id; kind: TaskKind; docId?: Id; state: TaskState;
  progress: { stage: string; done: number; total: number };
  cursor?: unknown;                     // 断点位置，种类自定义
  error?: { stage: string; unitId?: Id; message: string };
  stats: TaskStats;                     // 见下
  artifacts: Artifact[];
  createdAt: ISODate; updatedAt: ISODate;
}

interface TaskStats {
  stageDurationsMs: Record<string, number>;
  llmCalls: number; reusedUnits: number; reuseRatio: number;   // reuseRatio = reused/(reused+llmCalls 对应单位数)
  tokens: Record<string, { input: number | null; output: number | null }>; // 按模型角色分；未知为 null，序列化为 "unknown"
}

interface Artifact {
  id: Id; docId: Id; format: string; path: string;
  revisionSetHash: string; createdAt: ISODate;
}

interface RagChunk {
  id: Id; docId: Id; order: number; text: string;
  locator?: Record<string, unknown>;    // 与 Unit.locator 同形状，供"跳到原文"
  score?: number;                       // 仅检索结果携带
}
```

字段级规则：

- `tokens.*` 为 `null` 时序列化为字符串 `"unknown"`，**绝不填 0**（沿用 ADR-0001 边界）。
- `locator` 是适配器自定义对象，但**必须**至少能回答"第几页/第几段"；协议不约束内部字段。
- 列表端点统一分页：`?cursor=<opaque>&limit=<n≤500>`，响应 `{ items: [], nextCursor?: string }`。万级 unit 列表不依赖全量拉取。

## 3. REST 端点

### 3.1 文档与单位

| 方法 | 路径 | 请求 | 响应 |
|---|---|---|---|
| POST | `/api/documents/import` | `{ path?: string, contentBase64?: string, format?: string, sourceId?: string, externalRef?: string }`（path 与 contentBase64 二选一） | `{ document: Document, taskId: Id, deduplicated: boolean, warnings: string[] }`；解析为异步任务 |
| GET | `/api/documents` | `?origin=&format=&cursor=&limit=` | 分页 Document[] |
| GET | `/api/documents/{docId}` | — | `{ document: Document }` |
| GET | `/api/documents/{docId}/units` | `?filter=all\|untranslated\|draft\|accepted&cursor=&limit=` | 分页 Unit[]（含 accepted/draft 修订 id，不内嵌全文） |
| GET | `/api/units/{unitId}` | — | `{ unit: Unit, accepted?: Revision, draft?: Revision }` |
| GET | `/api/units/{unitId}/revisions` | — | Revision[]（版本翻看数据源） |

### 3.2 翻译与编辑

| 方法 | 路径 | 请求 | 响应 |
|---|---|---|---|
| POST | `/api/documents/{docId}/translate` | `{ profileId?: string, unitIds?: Id[], mode?: "fast" \| "careful" }`；unitIds 缺省=全部 translatable | `{ taskId: Id }` |
| POST | `/api/translate-text` | `{ text: string, sourceLang?: "auto" \| string, targetLang: string, profileId?: string }` | `{ revision: Revision, regenerated?: false }`（文本翻译页首轮） |
| POST | `/api/translate-text/regenerate` | `{ originalText: string, targetLang: string, profileId?: string, previousRevisionId: Id }` | `{ revision: Revision }`（重新生成，写新 Revision 不改旧） |
| PATCH | `/api/units/{unitId}` | `{ baseRevisionId: Id, text?: string, action?: "accept" \| "unaccept" }`；text 存在即写 human 修订 | `{ revision: Revision }`；baseRevisionId 过期→409 |
| POST | `/api/revisions/{revisionId}/accept` | `{ baseRevisionId: Id }`（当前 accepted 的 id；无 accepted 时传 null） | `{ accepted: Revision }` |

### 3.3 输出与 RAG

| 方法 | 路径 | 请求 | 响应 |
|---|---|---|---|
| POST | `/api/documents/{docId}/export` | `{ format: string, out?: string, onMissingAccepted?: "fail" \| "skip" }`（默认 fail，《设计》§3.3） | `{ taskId: Id }`；任务产物在 Task.artifacts |
| GET | `/api/documents/{docId}/artifacts` | — | Artifact[] |
| POST | `/api/documents/{docId}/rag/build` | `{ chunker?: string, embedModel?: string }` | `{ taskId: Id }` |
| POST | `/api/documents/{docId}/rag/query` | `{ q: string, k?: number ≤ 50 }` | `{ chunks: RagChunk[], degraded: boolean }`（degraded=向量扩展不可用走退化路线） |

### 3.4 任务

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/tasks?state=&kind=&cursor=` | 分页 Task[] |
| GET | `/api/tasks/{taskId}` | `{ task: Task }` |
| POST | `/api/tasks/{taskId}/cancel` | 取消信号贯穿到在途模型调用 |
| POST | `/api/tasks/{taskId}/pause` / `/resume` | 暂停在 unit 边界生效；恢复从 cursor 续跑，已完成 unit 靠复用检查跳过 |
| GET | `/api/tasks/{taskId}/events` | SSE，事件见 §4 |
| GET | `/api/events` | 全局 SSE（任务列表页用），事件同 §4 |

### 3.5 术语（形状锁定，字段随词库研判扩展）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/terms?library=&status=&q=` | 分页条目 |
| POST | `/api/terms/{entryId}/confirm` | 候选→已确认 |
| PATCH | `/api/terms/{entryId}` | 编辑；`baseRevision` 乐观锁同上 |

### 3.6 Zotero 桥（落实"RAG 构建挂什么附件"）

| 方法 | 路径 | 行为 |
|---|---|---|
| POST | `/api/zotero/translate` | `{ zoteroItemKey, pdfPath, mode?, bilingual? }` → import(externalRef=zoteroItemKey) → translate → export；`{ taskId }` |
| POST | `/api/zotero/rag` | 同上前缀 → rag build → **额外产出两个可附文件**：`<title>.rag-manifest.json`（chunk 清单：文本、locator、嵌入模型、向量维度、构建时间；**不含向量本体**）与 `<title>.rag-report.md`（人类可读摘要：文档结构、chunk 数、检索入口说明）。RAG 索引本体留在内核存储，附件是"索引的可搬运描述"。 |
| POST | `/api/zotero/rag-translate` | rag 与 translate 并行，汇合后 export；附件 = manifest + report + 译文文件 |
| GET | `/api/zotero/task/{taskId}` | `{ task: Task, attachments: { path: string, suggestedName: string }[] }`（Zotero 插件按此挂附件） |

## 4. SSE 事件类型

`data:` 行为 JSON，`event:` 为类型名：

| event | data | 时机 |
|---|---|---|
| `task.queued` / `task.started` | `{ taskId, kind }` | 入队/开跑 |
| `task.progress` | `{ taskId, stage, done, total }` | 节流至 ≤2 次/秒；阶段切换必发 |
| `unit.completed` | `{ taskId, unitId, reused: boolean }` | 每单位；工作台实时刷新对照视图 |
| `task.paused` / `task.resumed` | `{ taskId, cursor? }` | — |
| `task.failed` | `{ taskId, stage, unitId?, message }` | 失败即终态 |
| `task.canceled` | `{ taskId }` | — |
| `task.succeeded` | `{ taskId, artifacts: Artifact[], stats: TaskStats }` | 摘要区持久展示的数据源 |

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
| `ivoraige_units_list` / `ivoraige_revisions_list` | §3.1 | — |
| `ivoraige_terms_list` / `ivoraige_terms_confirm` / `ivoraige_terms_edit` | §3.5 | — |

resources：`ivoraige://docs/{docId}`、`ivoraige://docs/{docId}/units/{unitId}`、`ivoraige://tasks/{taskId}`，内容为对应 JSON 的人类可读渲染（Markdown）。

## 7. Python sidecar 协议

进程管理沿用 DSH 的 subprocess 模式（同 dsh mcp-client 的 spawn + 超时 + 取消链路）。传输：**NDJSON 编码的 JSON-RPC 2.0 over stdio**，每行一个完整消息。

### 7.1 握手与方法

```
→ {"jsonrpc":"2.0","id":1,"method":"handshake","params":{"protocolVersion":1}}
← {"jsonrpc":"2.0","id":1,"result":{"protocolVersion":1,"capabilities":{"parse":["pdf"],"rebuild":["pdf","bilingual-pdf"]}}}
```

| method | params | result | 说明 |
|---|---|---|---|
| `handshake` | `{ protocolVersion }` | capabilities | 版本不匹配 → 内核报 COMPONENT_MISSING 并提示升级 sidecar |
| `configure` | `{ modelDirs: Record<string,string>, options }` | `{}` | 权重目录在此注入（§8），sidecar 不自行下载 |
| `parse` | `{ path, options }` | `{ doc: ParsedDoc }` | 大文档通过 `progress` 通知报进度 |
| `rebuild` | `{ docRef, revisionsRef, out, format }` | `{ path }` | 输入为内核落盘的临时 JSON 文件路径（避免 stdio 传大对象），输出为文件路径 |
| `shutdown` | `{}` | — | 内核退出/释放时调用 |

通知：`{"method":"progress","params":{"stage","done","total"}}` → 映射为 `task.progress` 事件。

错误：JSON-RPC error 对象的 `code` 自定义区间 `-32001` 解析失败、`-32002` 权重缺失、`-32003` 重建失败；内核映射为 `UPSTREAM_FAILURE`/`COMPONENT_MISSING`。

sidecar 常驻复用（不每任务重启）；崩溃后内核重启 sidecar 一次，再失败则任务 failed。MinerU 与 BabelDOC **分两个 sidecar 可执行文件**（解析与重建独立缺失、独立升级），共用同一协议。

### 7.2 与内核 IR 的对齐

`parse` 返回的 ParsedDoc 与内核 IR 同构（Unit + locator）；内核保留最终解释权：sidecar 只产候选结构，写库前内核做校验（unit 非空、order 单调、locator 齐备）。

## 8. 模型权重资产管理（照搬 DSH attachment 方案）

复用 `dsh-attachment` + `dsh-attachment-local` 的内容寻址存储作为权重资产库，不自写下载器：

1. **资产清单**：内核内置 `assets.json`（随版本发布），每项 `{ name, urls[], sha256, sizeBytes, requiredFor }`（如 `mineru-layout`、`mineru-ocr`、`doclayout-yolo`）。
2. **下载**：`POST /api/assets/{name}/pull` 建任务（复用任务系统，进度=字节数），下载落 attachment-local（按 sha256 内容寻址），校验 digest 一致才标记可用；不一致自动清残并 failed。断点续传用 HTTP Range。
3. **注入 sidecar**：任务启动时内核从 attachment 存储解析出目录路径，经 `configure` 注入；sidecar 路径不含权重时返回 `-32002` → `COMPONENT_MISSING`，details 给 `ivoraige assets pull <name>` 命令。
4. **CLI/界面**：`ivoraige assets list`（名称、大小、已就绪/缺失）、`assets pull/remove`；WebUI 设置页"组件与模型"区块展示同一清单，PDF 处理设置区对缺失权重直接给"下载"按钮。
5. 用户自备权重：资产清单允许 `path` 覆盖（settings 中配置），跳过下载与校验。

## 9. 验收口径（协议层）

1. 同一操作在 REST 响应、CLI `--json`、MCP tool 返回三者中字段名与值完全一致（用同一 fixture 做三入口快照比对）。
2. §1.3 每个错误码至少有一个可触发路径的测试（含 409 并发冲突：两个客户端同时 PATCH 同一 unit）。
3. SSE 断线重连后任务页进度与服务端一致（快照对齐测试）。
4. sidecar 握手版本不匹配、权重缺失、进程崩溃三类故障各映射为规定的错误码与提示。
5. 权重下载任务：断网中断后 Range 续传完成，digest 校验失败有明确 failed 状态。
