# 0.1.x 外部调用协议附录

这是[外部 API 设计](external-api.md)的最小支持契约；字段与示例用于判断实现是否满足要求，尚非已交付接口。原生 API 版本标识为 `external.v1`，不改变当前内核 `API_VERSION`。机器 schema 和真实客户端 fixture 随首个实现 PR 提交；扩展支持不能静默改变以下默认行为。认证、scope 和限流分别引用[单机授权](contracts.md#单机客户端授权)、[共享调用限制](external-api.md#共享调用限制)。

## 输入与运行的数据归属

| 对象 | 归属及访问规则 |
| --- | --- |
| `items[].id` | 请求内唯一、大小受限的 opaque 关联键，只用于结果对齐；不作为 resourceId、owner、授权或幂等键 |
| 内联 `items[].text` | 受理时建立服务端 inputId 标识的 run-owned 输入，归可信调用上下文的 principalId 和宿主数据域；拒绝客户端伪造 owner/domain 字段，不继承方案作者的访问域 |
| 受管理输入 | 声明支持资源输入的原生 profile 使用 `{id,resourceId,resourceRevision}`，与 text 二选一；resourceId/revision 均为非空不透明字符串。先检查当前主体拥有资源或有明确共享读取授权，再冻结确切修订/取得 lease。原资源所有者不变，路径或 URL 不代替授权；未支持此 profile 时返回 INVALID_ARGUMENT |
| run / result / artifact | 服务端记录 ownerPrincipalId、宿主数据域、创建授权引用及来源依赖。结果与新产物归发起运行的主体；方案作者拥有配置不代表可以读取调用者正文、运行或结果。执行方案可使用其获准的模型/库绑定，但不向调用者暴露凭据 |
| 共享与撤权 | 默认不共享。只有可信 owner 管理入口可将确定的运行/资源及操作范围授权给另一主体；仍须同时满足操作 scope。轮换同主体凭据不转移所有权，新 grant 仍需明确覆盖旧运行。撤销当前 grant 后按基础契约拒绝读取/取消并收尾在途调用；撤销来源资源共享后，引用该资源的运行执行/结果/产物读取也须重新获准，冻结引用不延续权限 |
| 保留与清理 | 内联正文、结果、产物使用宿主同一保留/引用政策，向调用者显示适用期限及是否被活动引用保护；撤销不自动删除数据，删除方案也不连带删除调用者运行。到期清理可读数据后，仍获准的旧运行查询返回 NOT_FOUND（reason=RESULT_EXPIRED）；幂等记录独立按下节保留，不因此重做运行。可信本机 owner 的恢复权限不等于普通方案作者权限 |

所有权来自已认证主体，grantId 只记录本次授权依据。未关联项目的工作流实例与共享方案配置可以属于作者；由它们发起的运行数据仍按上表属于调用者。以后关联项目须显式授权并检查数据共享范围，不能以项目关联或共享模板自动公开历史正文。已有资源在受理与真正执行前均核查权限/修订，产物下载和事件订阅遵循同一对象检查。

## 跨协议幂等

键采用非空 ASCII 字符串 `[A-Za-z0-9._:-]{1,128}`，值区分大小写，推荐随机 UUID；不接受重复头或冲突的两处键。它是本服务扩展约定，不声称 OpenAI 官方或所有客户端原生提供幂等保证。

| 入口 | 承载及映射 |
| --- | --- |
| 原生 HTTP / OpenAI | 新运行请求的 `Idempotency-Key` header；HTTP 头名不区分大小写。无键只提供一次受理，网络未知时不得宣称可自动安全重试 |
| MCP | 创建运行/抽取任务工具的顶层 `idempotencyKey` 字符串映射同一键；不是 JSON-RPC id，不从用户正文提取 |
| KT | 桥接为一次逻辑 translate 调用生成并保存一个键，对该调用的传输重试复用原生 header；拆出的独立子批次各有稳定子键。跨 Worker 重启仅在键/runId 已可靠保存时恢复；SDK/客户端不能保留键或设置 header 时，明确标为不支持自动重试，不用 items[].id 猜键 |
| 诊断 | HTTP `X-Request-ID` / MCP `requestId` 仅关联一次网络尝试；不得用它替代幂等键或访问授权 |

跨协议去重只针对各入口能表达相同业务输入的交集；不能丢弃不支持的 context/glossary 后宣称等价。

存储域为 `(hostDataDomain, principalId, operationKind, key)`；原生、MCP、OpenAI、KT 的同一语义执行映射同一 operationKind，不按协议、grantId 或 clientId 分桶。授权/语法校验后先查该域中的记录；重试每次核查当前 grant 对首次方案修订、运行与资源的权限，不借旧凭据继续调用。

摘要覆盖协议映射后的 planId、显式修订或“使用发布版本”的选择符、输入/输出 profile、textFormat、有序 items（含关联 ID、原文或资源 ID/修订）、语言、context、glossary、instructions 及允许 overrides。对象键递归排序，数组顺序保留，数值按 JSON 有限数编码；文本不 trim、不改 Unicode 或 HTML。协议缺省值展开为同一业务表示，诊断 ID、凭据、stream/include_usage 等仅传输选项不参与摘要。首记录同时保存归一化规则版本、解析默认、请求摘要和实际 planRevision/运行绑定。

- 首次受理将键、摘要、实际修订和 runId 与限流预留原子登记；并发相同键最多创建一个运行。校验失败/429 未受理不占键。
- 同键同内容返回首次 runId；省略修订的重试使用首次记录的默认和已解析修订，不读取新发布版本再执行。显式修订与省略修订是不同选择符，换内容或选择符返回 409 CONFLICT（reason=IDEMPOTENCY_MISMATCH），不调用模型。
- 记录持久化跨宿主重启，至少保留到运行终态后 24 小时；运行未终态不能过期。原生受理/运行查询及 MCP 返回 `idempotencyExpiresAt`（未终态时 null，终态时 UTC 时间），OpenAI/KT 通过 runId 查询它，延长保留可公告但不得缩短已返回期限。数据先被清理时返回 RESULT_EXPIRED，不重建任务。
- 记录过期并清除后，相同键可能作为新请求执行；客户端必须先查已知 runId，无法确认时交用户决定，不自动再付费。读取当前状态不保证重复显示去重，也不保证供应商 exactly-once。
- 同一运行的非流式重试等待/读取原结果；流式重试可重新投影已经稳定的最终结果，不恢复模型调用或承诺续传到上次字符位置。原始请求断开后的取消政策仍适用。

## 公共 usage

原生 `GET /runs/{id}`、`/result` 均包含 `usage`；MCP 的 structuredContent 保留同一对象。它描述实际供应商尝试的计量覆盖，不是费用或预算账本。

| 字段 | 最小形状与含义 |
| --- | --- |
| activity | `not_started / none / attempted`；none 仅用于已确证没有供应商调用的完成运行（如复用命中），不能从未收到 usage 推断 |
| complete | boolean；只有所有实际尝试及其计量已收口才为 true，取消/断开后执行未知为 false |
| status | `known / partial / unknown`；complete 且每个应计量尝试的 input/output 已知为 known；有部分已知值但缺量或 complete=false 为 partial；无已知计量为 unknown。none 是确证零调用的 known 特例 |
| stages[] | 每次实际供应商尝试一条（本条 input/output 全知为 known、部分知为 partial、均未知为 unknown）：`stageId, attemptId, status, unit, aggregationKey, input, output`。重试以不同 attemptId 记录，不重复累计同一次报告；stageId/attemptId 是安全不透明 ID |
| unit / aggregationKey | unit 为 `token / character / byte / page / null`；aggregationKey 为公开安全的计量口径 ID 或 null，包含单位定义/分词口径兼容性，不暴露真实模型配置。仅单位名称相同不足以汇总 |
| input / output | 非负有限数或 null，未知方向保持 null；token/character/byte/page 为整数。零只能来自明确测得为零或确证无调用 |
| aggregate | null，或 `{unit,aggregationKey,input,output,total}`。只有 complete=true、全部应计量尝试为 known 且 unit/aggregationKey 同一可加口径时求和，total=input+output；混合或未知口径保持 null，不换算、不只报已知阶段小计冒充总量 |

未开始：activity=not_started、complete=false、status=unknown、stages=[]、aggregate=null。确证零调用：activity=none、complete=true、status=known、stages=[]、aggregate=null；零调用证据与计量单位分开。供应商请求一旦可能发出就记录 attempted；执行/usage 未知的尝试不能从 stages 中删掉。全部阶段值已知但口径不同可为 known，aggregate 仍为 null。

示例为虚构的“翻译已知、后续尝试取消且计量未知”状态：

```json
{
  "activity": "attempted",
  "complete": false,
  "status": "partial",
  "stages": [
    {"stageId":"s1","attemptId":"a1","status":"known","unit":"token","aggregationKey":"token-basis-1","input":120,"output":40},
    {"stageId":"s2","attemptId":"a2","status":"unknown","unit":null,"aggregationKey":null,"input":null,"output":null}
  ],
  "aggregate": null
}
```

| 投影 | 固定行为 |
| --- | --- |
| 原生 / MCP | 返回完整公共对象；取消、部分失败、流截断也可按权限查询最后证据，缺报告保持 null，不随协议改成 0 |
| OpenAI 非流式 | 仅已知可汇总 token aggregate 映射 `prompt_tokens=input, completion_tokens=output, total_tokens=total`；确证 none 映射三项 0。其余情况**省略 usage 字段**，不返回部分总量，不在 null/省略之间按客户端随意切换 |
| OpenAI 流式 | include_usage=false 时省略所有 usage 字段；true 时普通 chunk 的 usage=null，只有符合上述数字条件时在终止 choice 后增加 choices=[] 的 usage chunk。未知/混合口径时不发送统计 chunk；成功仍以 [DONE] 结束。中断/取消不保证收到统计，客户端不得视为零 |
| KT | 桥接保留 runId 并使用原生 usage；SDK 有明确诊断承载时传同一状态，否则不向译文 item 塞入自造统计字段，在宿主运行详情查询。客户端无计量显示能力不等于服务没有调用 |

未知时省略 OpenAI 统计是本兼容子集的明确限制；依赖每次必有 usage chunk/数字的客户端须记录为受限兼容。多个模型/阶段口径不同，不为凑 OpenAI 字段伪造统一 tokenizer。部分已知、取消与截断后补到的真实报告可更新运行计量证据，不修改冻结配置或已接受译文。

## OpenAI 文本子集

2026-10-23 核对官方 [Chat Completions](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create/) 与[流式事件](https://developers.openai.com/api/reference/resources/chat/subresources/completions/streaming-events/)。以下为本服务收窄后的 wire，不复制完整规范；业务、未知 usage 和错误流规则是本服务明确约定。

### 请求与默认值

`POST /v1/chat/completions` 接收 JSON 对象，下表外的字段、显式 null、非法类型或未声明能力均返回 400 INVALID_ARGUMENT；不静默忽略。认证/幂等通过 HTTP header，不能写进 messages。

| 字段 | 类型 / 默认 / 支持边界 |
| --- | --- |
| model | 必填非空 string，值为已发布且获准的 planId；不接受底层模型 ID |
| messages | 必填数组：一个 `{role:"user",content:string}`；user 内容非空。仅方案声明 instructions 能力时，可在它之前加一个 system **或** developer string 消息，不可两者并存；不是更高权限指令。拒绝多轮、assistant/tool、数组 content 和多模态 |
| stream / n | stream 为 boolean，默认 false；n 为整数，默认且只允许 1。stream=true 仅对声明流能力的方案开放，否则 400（reason=STREAMING_UNSUPPORTED） |
| stream_options | 仅 stream=true 时允许对象 `{include_usage:boolean}`，include_usage 默认 false；不接受其他子字段 |
| temperature | 可选有限 number，范围 0..2 且满足方案 override schema；省略继承已发布值，未开放覆盖则拒绝显式值 |
| max_completion_tokens | 可选正整数且在方案限制内；仅当已验证能映射包含推理在内的总生成 token 上限时开放，省略用已发布值。不声称仅限制可见字符也等价；首个子集拒绝旧 max_tokens |
| ivoraige | 可选的本服务扩展对象，仅接受 `profile,planRevision,sourceLanguage,targetLanguage`；后三项为非空 string 且须方案允许。profile 默认 text-v1；修订省略取首次受理时发布版本，语言省略取方案固定值，无有效目标语言拒绝 |
| ivoraige.profile 的内容形状（非顶层字段） | text-v1 将 user 内容整体当一个文本项（规范关联 ID 为 "0"）；batch-json-v1 仅在方案另行声明时可用，content 是 `[{"id":string,"text":string}]` 的 JSON 文本，输出同序 `[{"id":string,"text":string}]` JSON 文本且 ID 完整。默认不把形似 JSON 的原文解释为批次 |

tools、response_format、logprobs、stop、seed、任意透传参数等不在首个子集中；后续扩展要有独立 profile/字段兼容测试。`GET /v1/models` 固定返回 `{"object":"list","data":[...]}`，每项为 `{id:planId,object:"model",created:发布UTC秒,owned_by:"ivoraige"}`；只列调用者获准且文本/语言兼容的方案。

最小非流式请求（客户端凭据与幂等键分别在 Authorization / Idempotency-Key header 中）：

```json
{"model":"academic-zh","messages":[{"role":"user","content":"A source paragraph."}],"stream":false,"n":1}
```

### 成功响应与 SSE

非流式 HTTP 200，Content-Type 为 application/json。id 是不透明 `chatcmpl-` 标识，与首次 runId 稳定关联；created 是首次受理 UTC 整数秒，model 始终为 planId，重试不生成另一调用身份。choices 固定一项，index=0，message.role=assistant，content 为最终文本/声明批次的 JSON 文本，logprobs=null；完整成功的 finish_reason 只能是 stop。截断、过滤、部分失败和取消不能用 stop 伪装成功。响应头 `X-Ivoraige-Run-Id`、`X-Ivoraige-Plan-Revision` 提供受权限保护的查询关联，`X-Request-ID` 只用于诊断；浏览器可见性遵守既有精确 Origin 策略。

示例为已知同口径 token 计量，数值不表示真实模型调用：

```json
{
  "id":"chatcmpl-demo1",
  "object":"chat.completion",
  "created":1792713600,
  "model":"academic-zh",
  "choices":[{"index":0,"message":{"role":"assistant","content":"示例译文。"},"logprobs":null,"finish_reason":"stop"}],
  "usage":{"prompt_tokens":120,"completion_tokens":40,"total_tokens":160}
}
```

流式 HTTP 200，Content-Type 为 text/event-stream；每帧为一行 data: JSON 加空行。JSON chunk 都带同一 id/created/model 和 object=chat.completion.chunk，choices 内 index=0、logprobs=null。顺序固定如下（例为 include_usage=false；为便于阅读分为多帧）：

```text
data: {"id":"chatcmpl-demo1","object":"chat.completion.chunk","created":1792713600,"model":"academic-zh","choices":[{"index":0,"delta":{"role":"assistant","content":""},"logprobs":null,"finish_reason":null}]}

data: {"id":"chatcmpl-demo1","object":"chat.completion.chunk","created":1792713600,"model":"academic-zh","choices":[{"index":0,"delta":{"content":"示例译文。"},"logprobs":null,"finish_reason":null}]}

data: {"id":"chatcmpl-demo1","object":"chat.completion.chunk","created":1792713600,"model":"academic-zh","choices":[{"index":0,"delta":{},"logprobs":null,"finish_reason":"stop"}]}

data: [DONE]
```

role 首帧只发一次，随后一个或多个 content delta 只含已经稳定的最终内容；可先整体缓冲通过术语/结构检查。成功 terminal 之后，按[公共 usage](#公共-usage)规则可追加同样公共字段、choices=[] 的统计 chunk，然后才发 [DONE]。未开始发送头时失败按下节 HTTP 错误响应；开始 SSE 后若仍可写，发送单个 `data: {"error":{...}}`（同下节 OpenAI envelope）并关闭，不发成功 terminal/[DONE]。这条错误帧是本服务约定；网络已断时只能非成功关闭，结果以 run 查询为准。客户端即使收到部分内容也须检查成功终止；输出达到上限但未完成译文返回 OUTPUT_INCOMPLETE，不把 length 当完整翻译。

## 外部错误映射

复用基础业务错误含义；旧内核 v2 的 UNAUTHORIZED 仅在外部边界映射为 AUTHENTICATION_REQUIRED，FORBIDDEN_HOST 保留 Host/Origin 专义，不全局改旧协议枚举。以下顺序在查询对象存在性前执行 Host/Origin 与认证、scope 检查，不用 404 掩盖随机变化的鉴权行为。

| 场景 / 公共 code | 原生 HTTP / HTTP-MCP 建连拒绝 | OpenAI HTTP / error.type |
| --- | --- | --- |
| 参数 / INVALID_ARGUMENT | 400 | 400 / invalid_request_error |
| 缺失、无效、过期、撤销凭据 / AUTHENTICATION_REQUIRED | 401 | 401 / authentication_error |
| Host 或 Origin 拒绝 / FORBIDDEN_HOST | 403 | 403 / permission_error |
| 有效主体缺 operation/方案/资源范围 / PERMISSION_DENIED | 403，不透露对象存在性 | 403 / permission_error |
| 已获准范围内不存在或结果到期 / NOT_FOUND | 404 | 404 / invalid_request_error |
| 同键异内容或状态冲突 / CONFLICT | 409 | 409 / invalid_request_error |
| 输入大小 / PAYLOAD_TOO_LARGE | 413 | 413 / invalid_request_error |
| 本地受理限流 / RATE_LIMITED | 429，附 Retry-After | 429 / rate_limit_error，保留 Retry-After |
| 缺能力 / COMPONENT_MISSING 或 UNAVAILABLE | 503 | 503 / server_error |
| 上游失败、译文未完成 / UPSTREAM_ERROR 或 OUTPUT_INCOMPLETE | 502 | 502 / server_error |
| 超时 / TIMEOUT；已有运行取消 / CANCELLED | 504；409 | 504；409 / server_error |

原生错误对象为 `{apiVersion:"external.v1",error:{code,message,details}}`；details 为安全对象，可含 reason/traceId/retryAfterSeconds，不含凭据/正文/私有资源存在性。OpenAI 固定为 `{"error":{"message":string,"type":上表类型,"param":string或null,"code":公共code}}`，param 仅指出有问题的请求字段，其他情况为 null。相同 403 仍可用 code 区分网络入口拒绝和资源越权，例如：

```json
{"error":{"message":"Origin is not allowed","type":"permission_error","param":null,"code":"FORBIDDEN_HOST"}}
```

上游 429 保留 UPSTREAM_ERROR 与安全 reason=UPSTREAM_RATE_LIMITED，不冒充本地 RATE_LIMITED 或暗重试。

MCP 已进入工具调用时，业务拒绝返回 `isError:true`，structuredContent 为上述原生错误对象，content 的 text 是该对象的 JSON；传输可仍为 HTTP 200，不拿 HTTP 200 当业务成功。HTTP-MCP 初始化前的拒绝使用表中 HTTP 状态。stdio 无 HTTP 状态，已绑定客户端的工具拒绝使用同一 code/isError；宿主身份绑定失败时不能成功初始化，输出脱敏诊断并结束。MCP 资源读取沿用既有约定：NOT_FOUND → JSON-RPC -32002，INVALID_ARGUMENT → -32602，其他业务失败 → -32603，data 携相同原生错误对象；协议解析/schema 错误仍由 SDK 按 JSON-RPC 返回，不伪装成业务成功。

共享限流的恢复规则、撤销行为和任务终态仍以基础契约为准；错误投影只统一传输表示，不建立第二套错误源。所有失败样例须进入[专项验收](../../plan/0.1.x/validation/external-api.md#协议附录验收)。
