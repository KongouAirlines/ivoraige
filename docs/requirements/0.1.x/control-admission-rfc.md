# 0.1.x 四接口 RFC：宿主、入口、插件交付与运行受理

状态：**待讨论建议，未实现、未冻结 API**。核对日期：2026-11-03；源码基线：`a621437266b1e6889a1612a85470083a2fe23c9f`。本文的方法名、状态和 JSON 是讨论用伪接口，不可直接调用，不代表新的 HTTP 路径、MCP 工具或已发布 SDK。实现时逐项提交机器 schema、兼容映射和验收证据。

目标是让最小托盘、WebUI 插件管理页、MCP/OpenAI 入口和保存工作流共享清楚的边界。四接口属于 ivoraige；Cordis 提供插件/服务装配、依赖和 effect 生命周期，DSH 提供经验证的基础服务。本文不设计第二套 Loader、任务系统、凭据库或通用事件总线。

## 范围、依据与替代关系

- 延续[组合契约](contracts.md)、[工作流模型](workflows.md)、[外部 API](external-api.md)及其[协议附录](external-protocol.md)。HostControl 汇总既有 HostSession/退出语义；EntryControl 细化[首版最小托盘](../../plan/0.1.x/desktop.md#首版最小托盘子集)；PluginDelivery 细化 P05/P08；RunAdmission 细化 W02/I01.callable@1。它们不是四个强制独立 npm 包。
- 当前实现与兼容协议继续有效。本文不替换 P04 operation catalog、事件 barrier、Records 或 ExportSnapshot；已启用部分见 [P04 证据](../../plan/0.1.x/evidence/foundation-p04.md)。现有工作包表中的分支历史标签不能替代本次 main 源码核对，也不在本 RFC 中批量整理。
- **运行时迁移暂缓：只有 Cordis 上游稳定且 DSH 已完成对应迁移两个条件同时满足，才评估 ivoraige 的依赖迁移。** 两条件是必要条件，不自动批准升级；仍须固定精确版本元组并通过本项目兼容验证。该顺序取代[旧评估](../../plan/0.1.x/runtime-sequence.md)中“基础改造前段优先采用候选”的建议；旧源码证据和验证矩阵保留。当前功能设计、固定 pin 下的实现与测试可继续，不等待迁移。
- 不选择桌面框架，不增加远程控制、系统服务、自启、安装市场、任意插件热卸载或全新账号体系；不改当前发行版本号。首版目标仍是最小托盘和插件管理页可安装官方 PDF 能力，完整原生 UI 后置。发行物及平台支持必须另有实际证据。

### 已有基础与缺口

以下是静态源码核对，不是本次运行测试。

| 已有基础 | 尚不能据此声称的能力 |
| --- | --- |
| [launch](../../../src/launch.mjs)探测 instance.json 并复用宿主，[store-lock](../../../src/store-lock.mjs)保护数据库 owner | 跨所有故障场景的 HostControl 协议、原生窗口/托盘和完整 drain API 已交付 |
| [operation catalog](../../../src/operation-catalog.mjs)、[entry events](../../../src/entry-events.mjs)、[event state](../../../src/event-state.mjs)已有 P04 接线 | 内部 operation 全部可以公开，或已有完整外部客户端授权 |
| [HTTP](../../../src/http.mjs)的 `/mcp` 与 API/WebUI 共用 server；HttpEntry.close 设置 closing，后续 listen 被拒绝 | close 是单个逻辑入口开关，或同一实例 close 后可重新 start |
| [components](../../../src/components.mjs)已有 BabelDOC 专用安装、检查及 restartRequired | 任意插件的通用交付；磁盘 installed 等于当前 host 已 active/ready |
| [tasks](../../../src/tasks.mjs)、[export](../../../src/export.mjs)已有受理、冻结快照、任务与恢复基础 | 已存在通用 plan/instance/run、冻结术语版本或本 RFC 的统一受理事务 |
| [Windows 打包](../../../scripts/build-distribution.mjs)生成 ivoraige.cmd，调用随包 runtime/node.exe | 单一独立 ivoraige.exe、原生壳或安装器已交付 |

## 共用约定与所有权

### 接口版本、请求与响应

建议四接口分别协商 major/minor，草案示例使用 `HostControl@1` 等占位标识；不修改内核 API_VERSION、既有 `external.v1`、插件版本或数据 schema。major 不兼容须在副作用前拒绝；minor 只增可选能力，未知请求字段按 schema 拒绝，不能悄悄忽略改变行为的参数。状态响应可添加字段，客户端须容忍未知字段；未知状态不能显示为 ready。真正启用的版本随实现 PR 固定。

调用包含 `interfaceVersion`、`requestId`（仅诊断）、动作及参数；已连接宿主的写操作另带 `expectedGeneration`；修改可变目标时带 `expectedRevision` 等并发条件，运行受理则使用选择器中的确切修订。start/attach 响应给出新连接的 generation 与支持的接口版本。setEnabled 用 expectedRevision，install 用 expectedCatalogRevision；drain/exit/cancel 是同目标幂等动作，不要求状态 revision，但每次复查 generation、归属和权限。下文方法签名省略这些共用字段。可信 principal/grant 由控制通道或入口认证产生，与用户参数分开，不能通过 JSON 自报 owner。`stateRevision` 沿用 P04 权威提交边界，作用域和 generation 不同的数字不可比较。

成功响应分为完成结果或 `{ accepted: true, operationId }`；后者只证明受理，必须查询权威状态确认完成。任务型操作复用 jobs/tasks 的状态查询、取消和错误投影，不新增独立任务内核。状态查询返回 generation、revision、状态及安全 reason/recovery；跨进程传递数据引用，不传 Cordis Context、Service、disposer、任意路径或密钥。订阅按[既有同步边界](contracts.md#状态快照与订阅的同步边界)握手、快照、失效重取；断线视图标记未同步。

| 冲突/故障 | 建议机器结果与恢复 |
| --- | --- |
| 参数/未知请求字段 | INVALID_ARGUMENT；调用者修正，不开始副作用 |
| 无效/撤销身份；有身份但无权限 | 外部边界沿用 AUTHENTICATION_REQUIRED / PERMISSION_DENIED；不泄露未授权对象，旧内核错误映射见[协议附录](external-protocol.md#外部错误映射) |
| 旧 generation/revision、并发修改、同键异请求 | CONFLICT，安全 reason 与重取指引；不能静默改用新目标 |
| 接口不兼容、未就绪、正 drain、缺资产 | PRECONDITION_FAILED 或既有 COMPONENT_MISSING，明确受影响能力；不自动换引擎 |
| 获准对象不存在、内部/上游失败 | 保留 NOT_FOUND / INTERNAL / UPSTREAM_FAILURE 含义；公开诊断脱敏，私有 cause 留在宿主 |

错误不等于无副作用：若已获得 operationId/runId，先查原操作；传输超时或进程崩溃导致结果未知时，不盲目重发。新增 reason 是本 RFC 建议，不向旧内核擅自增加顶层错误码。

### Cordis 生命周期映射

| 边界 | owner 与装配职责 | 撤销/释放顺序 |
| --- | --- | --- |
| HostControl | bootstrap 的最小 start/attach 负责找到唯一 host；host 内控制服务使用现有锁、tasks 和 storage 生命周期。控制客户端不拥有数据库 | 拒绝新受理 → drain → dispose 消费者/worker/存储 → 释放锁；客户端关闭只释放自身连接 |
| EntryControl | 入口插件拥有路由、会话、在途调用和授权投影；共享 HttpEntry 拥有监听器。operations 与授权服务为所需依赖 | 先关闭该入口接单，再收尾其会话/调用并撤销贡献；只有 host/共享 transport owner 可关监听器 |
| PluginDelivery | 交付服务拥有安装暂存、清单恢复和安装 jobs；AppBoot/Loader 与 Cordis 拥有实际装配 | 安装事务提交与激活分离；插件依赖失活时撤销能力/监听，先处理持有者再释放资源 |
| RunAdmission | 领域服务拥有有效定义、受理记录、引用和任务映射；调度仍属 tasks/DSH jobs | 停新受理/新片段 → 暂停或取消可处理任务 → 持久化结果 → 释放 lease，最后撤销服务 |

在固定运行时上通过 `inject` 声明依赖，通过 effect/disposer 持有监听、路由和资源；具体语法由 bridge 与基线探针确认。可选服务缺席仅使依赖能力 unavailable，诊断/修复入口仍可用。`inject` 不是鉴权或恶意插件沙箱；不得只依赖一次 ctx.emit 获得事务性。四接口稳定的数据边界不暴露 RC/Fiber 内部类型，未来迁移只在组合根/适配层收口。

## HostControl

最小动作：`start(dataDomainRef)`、`attach(dataDomainRef)`、`state()`、`drain(expectedGeneration, deadline)`、`exit(expectedGeneration, deadline)`。dataDomainRef 是本机配置选定的数据域引用，不允许远端调用者提交任意数据库路径。

| 动作/状态 | 请求与响应语义 |
| --- | --- |
| start / attach | start 取得锁后才装配；发现已运行 owner 则 attach，竞争失败者重查而非创建第二 SQLite owner。attach 只连接，不自动启动；不存在返回 NOT_FOUND，锁存在但 owner 状态未知返回可诊断冲突，不删锁抢占 |
| state | 返回 hostInstanceId、generation、starting/ready/draining/stopping/failed 状态和阻塞原因；客户端连接失败只能报告 disconnected/unknown，不能据此断言 stopped。stopped 由可信启动控制器确认退出后报告 |
| drain | 原子关闭新任务、安装、运行及后续片段受理；已受理工作按种类完成、暂停或取消，报告残留 task/operation 与 deadline。drain 完成是可安全退出，不是进程已退出 |
| exit | 内含 drain；只有全部必要清理完成才关库、释放锁并退出。超时返回未完成和可恢复诊断，保持 owner，不伪报成功。重复 exit 加入同一收尾操作 |

窗口关闭仅断开/销毁 UI，按[桌面约定](../../plan/0.1.x/desktop.md#用户动作与故障语义)处理草稿，不能调用 exit；托盘退出显式调用 HostControl。attach 后取得的新 generation 不能继续使用旧 host 的句柄。首版不承诺撤销 drain 或同一已 dispose 对象重启：重新启动必须创建新 host generation，并重新确认旧 owner 已退出。

## EntryControl

最小动作：`list/state(entryId)`、`setEnabled(entryId, enabled, expectedGeneration, expectedRevision)`。entryId 表示入站 MCP 或入站 OpenAI 兼容入口；上游模型/provider 连接配置仍归模型设置，不能用入口开关替代。

建议状态分开表示：期望 `enabled`；实际 `disabled / starting / ready / draining / unavailable / failed`；运行时返回实际 transport 和 address。HTTP 地址只能来自成功绑定的监听器及已注册且就绪的路由，未知用 null 和 reason；stdio MCP 无 URL，展示 transport=stdio 和经过脱敏的连接方式，不编造端口。状态与复制操作不带 token、模型 key 或秘密参数。

启用时依次核查权限、host 状态、插件与所需能力、统一授权接线，再注册入口并报告 ready。禁用时先阻止该入口新会话/新调用，再关闭订阅与 transport 会话，在途请求按其既定取消政策收尾；已提交领域任务仍由任务服务拥有，禁用入口不是“取消所有任务”。无法在 deadline 内收尾时保留 draining 和阻塞原因，不能提前报 disabled。并发开关以 revision 串行化；重复相同期望值无额外副作用，过期 revision 仍返回 CONFLICT。

**HTTP-MCP 禁用不能调用共享 HttpEntry.close()，不能停止 WebUI、共享 HTTP listener 或 host；OpenAI 入口同理。** 重新启用必须建立新的入口会话/路由贡献，不能复用已终结的 transport。首个实现需证明这一边界；当前不可重启的 close 行为不是该接口的实现。

控制权限只授予可信本机 owner 或明确的管理权限；持有外部翻译令牌不能启停入口。实际业务请求使用[单机客户端授权](contracts.md#单机客户端授权)的同一 principal/grant、scope、资源归属和撤销检查，覆盖 HTTP、HTTP-MCP、受限 stdio 与薄适配；保留 Host/Origin 约束。启用开关不签发授权，不公开所有 P04 操作，也不留下旧匿名入口旁路。OpenAI 方案发现继续只返回获准发布方案。

## PluginDelivery

最小动作：`inspect(packageRef)`、`install(packageRef, expectedCatalogRevision)`、`state(packageId)`。首版先支持受控官方来源；恢复/禁用沿用 P05，自动更新、市场和通用热激活不在此范围。packageRef 引用批准目录或 owner 选定的本地包，不是任意远程安装 URL。

| 检查/状态维度 | 最小信息及含义 |
| --- | --- |
| 包身份与兼容 | packageId、pluginVersion、明确来源及内容摘要、hostApiRange、所需服务、OS/arch/runtime、配置/binding/sidecar 协议版本；不把宿主版本等同插件或引擎版本 |
| 资产完整性 | 清单列出运行时、模型/字体等所需资产的来源、版本、大小、摘要及许可/通知入口；校验下载/解包边界和完整闭包，不能用摘要代替来源信任。重用已有校验，不给日常文档读写加全量 hash |
| installed | 完整包已校验并原子登记在磁盘；记录 installedVersion，不证明被当前 host 装配 |
| active | 当前 generation 内已装配该版本并有活跃服务/贡献；记录 activeVersion，可与 installedVersion 不同 |
| ready | 当前 active 版本完成必需依赖、资源与能力检查；可按能力给出 ready/unavailable，不能以包目录存在或进程活着判定 |
| pendingRestart | 磁盘期望版本/启用配置尚未应用到当前 generation；独立于安装任务状态，可与旧版 active/ready 同时存在 |

`inspect` 返回兼容结果、所需资产与可解释诊断，不承诺安装成功。`install` 返回既有 jobs 形态的 operationId；流程沿用[安装契约](../../plan/0.1.x/migration-distribution.md#插件包与安装)：下载/导入 → 暂存校验 → 兼容复检 → 原子登记包与清单 → pendingRestart。首次支持重启激活；不为了“安装完成即可使用”的 UI 文案强行热卸载。重启后观察装配和能力检查，才报告 active/ready；失败保留 installed 和原因，保留上一可运行版本及恢复入口。

安装提交与 host drain 共用受理边界：drain 后拒绝新安装，已提交/提交中的安装按其恢复事务收尾。安装幂等按包身份和摘要合并相同目标，其他并发清单写入用 revision 冲突返回；任务持有旧版本时不删除其文件。失败清理仅针对本次暂存，不能删用户数据、旧输出或正在使用的资源。

首版 PDF 管理页须能发现官方包、检查兼容、发起安装、显示进度/失败/恢复动作和重启提示，并在新 host 实际 ready 后允许使用 PDF 能力。现有 BabelDOC 专用 ComponentManager 可作为首个适配路径，**不能冒充任意 PDF 引擎或通用 PluginDelivery 已完成**。P05 的通用性及 P08 的独立发行闭包须由另一个真实包和实际归档分别证明；管理页安装目标不能用开发机 setup 脚本或仅添加 manifest 替代。

## RunAdmission

最小动作：`admit(selection, inputs, allowedOverrides, idempotencyKey?)`、`get(runId)`、`cancel(runId)`；它们是既有业务操作的受理边界，不强制普通单操作先建项目或工作流。

- **plan**：本文沿用[可调用方案的发布投影](workflows.md#可调用方案与集中管理)，发布引用具体 WorkflowInstance 修订；从模板发布必须先实例化并保存，项目关联可为空，不能直接发布 TemplateVersion。RunDefinition 仍引用该实例修订，不新增一套工作流 schema。外部请求只能选择获准 plan/revision。owner 在工作台可选择明确的 instanceRevision；两种选择互斥，不能混用参数绕过发布约束。
- **instance**：可编辑的 WorkflowInstance，绑定资源与参数且可不关联项目。修改产生新修订，不改变已受理运行。
- **run**：一次受理的 RunDefinition 与可变 RunState、任务映射。冻结有效定义，不冻结执行状态；人工步骤只冻结已知事实，后续决定追加 ExecutionSegment，不能把未来结果伪装成初始已知输入。

### 受理时序与冻结内容

1. 验证身份、权限、输入 schema、资源归属及单次载荷上限；按既有[跨协议幂等](external-protocol.md#跨协议幂等)查首次记录。幂等重试也须重新核查授权，不能因找到键就返回未获准结果；合法同键重试返回首次运行，不重占新运行配额，也不因新运行限额已满而拒绝。
2. 解析确切 plan 修订及其绑定的 WorkflowInstance 修订，或 owner 直接选择的实例修订，按声明顺序合并默认、实例配置与允许 overrides；校验拓扑、输入类型与来源版本、所需能力及副作用用途。先形成可展示的有效配置再执行，不临时修改全局模型设置。预检结果不是预留，提交前需复核修订和能力。
3. 在唯一 host 的受理提交边界复核 generation、drain、授权及配置/插件版本；受理与授权撤销、drain 进入须有一致的先后顺序，先撤销/关闭受理则拒绝提交，先受理则按后续取消规则处理。仅首次受理检查新运行并发/速率限额，并在提交时重新查键，原子登记幂等键、有效定义、输入/版本引用、限流预留和 runId；任务入队用同事务或可恢复的持久交接，崩溃不能留下无运行的扣额、无引用快照或重排两次任务。响应 accepted 只在可恢复提交后发出，未提交不调用模型。
4. 调度前重新验证当前授权及已冻结版本可用，获取/确认执行 lease；执行使用冻结值，不读后来改变的全局默认。提供者失活、资源不兼容时明确阻塞/失败，不换模型、插件或输入。恢复也不得偷偷采用新版本；改配置须派生新运行。

RunDefinition 最小保存：确切 WorkflowInstance 修订、来源 plan 修订（仅通过方案受理时记录）、确切输入资源/修订、归一化规则版本及有效非秘密配置、模型/连接引用及其配置修订、适用术语库/义项与抽取配置的有效版本、实际能力/插件/引擎/binding 版本、执行策略、principal/grant 引用。术语范围先于优先级，版本变更重新判断复用适用性；不是只记录一个插件名称。没有术语的运行明确空约束，不能用“当前库”补历史。

密钥只存受控 credentialRef；执行时由 DSH 解析，不进入快照/模板/日志。密钥轮换不授权更换 provider、端点或用途；绑定配置修订不兼容则停止并要求新受理。**冻结配置不冻结权限**：每次调用、调度、新片段与重连读当前 grant；撤销拒绝后续动作、关闭相关流并请求取消在途任务，按 best-effort 记录已发出供应商调用的未知结果，不声称能撤回费用或实现 exactly-once。结果继续按主体保护。

幂等域、摘要规范及期限完全沿用协议附录：`(hostDataDomain, principalId, operationKind, key)`，不按 transport/grantId 分桶；同键同业务输入返回首次 runId，同键异内容返回 CONFLICT。并发最多提交一个运行；省略方案修订的重试保持首次解析值。幂等记录跨重启，至少保留至终态后 24 小时，按既有 idempotencyExpiresAt 对外说明；无键或记录过期不能自动安全重试。运行冻结与导出 ExportSnapshot 各有职责：导出仍在其受理时冻结可输出的数据，输出端只消费快照，绝不翻译。

## 最小交互实例

以下为伪接口数据；`g7`、修订和地址均为假定已获得的示例值，不是默认端口或可运行命令。

```json
{
  "interfaceVersion": "EntryControl@1",
  "requestId": "tray-click-12",
  "expectedGeneration": "g7",
  "expectedRevision": 18,
  "action": "setEnabled",
  "params": { "entryId": "mcp-http", "enabled": false }
}
```

完成后的状态示意为 `{ "generation": "g7", "stateRevision": 19, "entryId": "mcp-http", "enabled": false, "state": "disabled", "address": null }`；同一 host 的 WebUI 和 OpenAI 入口保持原状态。若返回 accepted/operationId，菜单继续显示 draining，直到查询确认完成。

一条完整最小路径：启动控制器 start 得到 g7（或 attach 已有 g7）→ 插件页 install 官方 PDF 包得到安装 operationId → 磁盘完成时显示 installed、pendingRestart，尚无 activeVersion → 显式 host exit/drain 后重新 start 得到 g8 → 包装配和检查成功显示 active/ready → EntryControl 开启获准入口 → 外部客户端选择获准 plan 并受理一次运行。示例中的 plan-demo/r3 已发布并绑定保存的 WorkflowInstance 修订 instance-demo/r2，受理时将两者记入 RunDefinition：

```json
{
  "interfaceVersion": "RunAdmission@1",
  "requestId": "client-attempt-1",
  "expectedGeneration": "g8",
  "action": "admit",
  "params": {
    "selection": { "planId": "plan-demo", "planRevision": "r3" },
    "inputs": { "resourceId": "resource-demo", "revision": "r2" },
    "allowedOverrides": {},
    "idempotencyKey": "demo-run-1"
  }
}
```

入站适配器已校验的身份在带外传入；响应 `{ "accepted": true, "runId": "run-demo", "state": "queued", "idempotencyExpiresAt": null }`。重试相同语义返回 run-demo；更换输入而沿用键返回冲突；撤销 grant 后相同重试也被拒绝。该示例不代表 OpenAI 支持资源输入或 PDF 流程；OpenAI 仍只投影其已声明的文本子集。

## 验收与并行推进

下列是待实施验收，不是本次通过的测试；沿用现有工作包编号，证据回填[工作包索引](../../plan/0.1.x/work-packages.md)。

| 边界 / 归属 | 最小可证实验收 |
| --- | --- |
| HostControl / D01、D05 | 同数据域并发 start 只有一个 SQLite owner；attach 不产生新 owner；关窗长任务继续；exit 在 drain 超时仍保留锁，重试不重复关闭；崩溃/陈旧实例记录可诊断；原生行为按平台分别验证 |
| EntryControl / P04、I01.shared、D05 | MCP 与 WebUI 共 listener 的真实测试中禁用/重启 MCP，WebUI 与 OpenAI 不受影响；会话/监听不泄漏；未知地址不显示 ready；过期 revision 冲突；跨入口授权、撤销及旧入口防旁路一致 |
| PluginDelivery / P05、P08、U02 | 干净主体从管理页安装官方 PDF 包；不兼容/摘要错误/缺资产不激活；断网/崩溃恢复不损坏旧版本；installed 与 active/ready 分离；重启失败可恢复；活跃 lease 阻止删除；实际归档与第二真实包另验通用性 |
| RunAdmission / W02、I01.callable、U03.terms | 模板先实例化保存，发布方案与运行可追到确切实例修订；并发不同配置互不污染；同键跨协议/重启只受理一次；配置/术语/插件变更不漂移已受理定义；撤权在排队和执行中均生效；受理各提交点崩溃无重复派发；旧快照零翻译回放；人工片段与未知远端结果不自动重做 |
| 共用兼容 / P01、P04 | 旧 CLI/HTTP/MCP wire 与 Records/快照继续工作；版本不兼容在副作用前拒绝；依赖消失/启动失败撤销贡献；重连 barrier 收敛；未知状态不伪装成功 |
| 发行关联 / P05、P08、D05 | 沿用[npm 就绪清单](../../plan/0.1.0/npm-readiness.md)与[分发边界](../../plan/0.1.x/migration-distribution.md#pdf-依赖与分发边界)，以干净 npm tarball 和实际应用发行入口在无开发目录环境启动；同一数据域复用唯一 host，各界面查询的插件状态一致。若交付目标包含独立应用 exe，须测试真实 exe，不能以现有 cmd + node.exe 代替；本 RFC 不新增发行渠道或承诺已交付 exe |

可并行开展固定 pin 下的 HostControl/EntryControl fixture 与托盘投影、P05 包交付/管理页状态模型、W02/I01 受理 fixture；先共享本文的数据样例和故障矩阵，再分别接线。入口和 UI 可以用明确标记的 mock 联调，不能据此宣称真实管理/安装/运行已交付。PluginDelivery 的 ready、RunAdmission 的 lease、HostControl 的 drain 在集成时用同一提交/所有权约定验证。运行时迁移独立且暂缓，不作为这些文档和当前 pin 实现的前置。

## 待决问题

1. 四接口最终方法/字段、major/minor 协商与 IPC/HTTP 映射：在首个实现 PR 固定，是否能完全复用现有 P04 状态查询，避免重复 DTO？
2. HostControl 的平台启动控制器与 drain deadline：首版支持哪些平台、哪些任务可暂停、哪些只能取消？保留现有导入不可续传事实。
3. 入口停止的在途会话收尾与重新启用：具体协议状态码、deadline 和 stdio 配置保存方式需要真实 transport fixture；不承诺关闭共享 listener。
4. PluginDelivery 首批包/资源清单、ready 探针成本和离线恢复路径：检查必需资产，不启动昂贵 GPU 工作冒充轻量状态查询；安装来源与发布包以 P05/P08 证据定案。
5. RunAdmission 的原子落库/任务交接实现及引用保留：复用现有事务/任务恢复能力，选择最小可恢复方案；术语有效版本与 credentialRef 的轮换绑定规则须与 DSH 实际服务核验。

## 官方参考与采用边界

以下仅借鉴边界，不复制其 API 或声明本项目已有同等能力；查阅日期 2026-11-03。

- [Cordis 上游仓库](https://github.com/cordiverse/cordis)及其链接的 [DSH Cordis 入门](https://deepseek-harness.github.io/deepseek-harness/reference/cordis-primer)：服务依赖、插件与可撤销 effect；具体行为仍以本项目固定 pin 探针为准，不能据文档推断迁移完成。
- [VS Code Extension Manifest](https://code.visualstudio.com/api/references/extension-manifest)：包身份与宿主兼容声明分离；本文不引入 VS Code 扩展格式或市场。
- [Kubernetes readiness](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/)：存活与可接单就绪不同；本文不引入集群控制器或探针编排系统。
- [Docker Compose config](https://docs.docker.com/reference/cli/docker/compose/config/)：执行前解析合并后的有效模型；本文使用自己的冻结定义，不执行 Compose，也不把带秘密的解析结果公开。
- [LM Studio REST](https://lmstudio.ai/docs/developer/rest)：原生管理接口与 OpenAI 兼容推理接口有不同职责；仅作为 EntryControl/模型连接分离的参考，不采用其端点作为 ivoraige 承诺。
