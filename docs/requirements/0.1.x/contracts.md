# 0.1.x 组合与生命周期契约草案

这是 [首轮规划](../../plan/0.1.x/README.md) 的目标契约，尚未整体实现。产品不变量继续来自 [AGENTS](../../../AGENTS.md) 和 [ADR-0002](../../decisions/0002-plugin-composition-0.1.0.md)。以下新服务名、描述字段和错误 details 是候选 API；工作包 P01 验证固定 DSH/Cordis 后收口，不能当作已存在接口调用。

## 当前事实与目标替代

基线：`43d3f1f`。本表记录定向源码阅读中的当前/目标差异。

| 现在的实现证据 | 0.1.x 目标 | 承接工作包 |
| --- | --- | --- |
| [app](../../../src/app.mjs) 静态装配，已有 parse-only 模式；`settingsDir` 路径启动模型设置与翻译服务 | 最小宿主不安装翻译也能启动、发现能力、恢复配置；业务能力按清单选装 | P01/P05/P06 |
| [records](../../../src/records.mjs) inject parse/outputs，承担导入且格式限定 txt/md/pdf | Records 保留事务、修订、适用性和快照；导入编排移到独立能力，存通用 IR | P02/P03 |
| [parse](../../../src/parse.mjs) 按 match 选择；[outputs](../../../src/outputs.mjs) 用 adapter id 作为 format | format 与实现身份分离，同类多实现可选择、可追踪 | P03 |
| [protocol](../../../src/protocol.mjs)、[operations](../../../src/operations.mjs)、[tasks](../../../src/tasks.mjs) 有格式/组件特判 | 以描述符决定输入、调度、操作和可用性 | P03/P04 |
| [settings-pages](../../../src/settings-pages.mjs) 通过 tasks 发设置事件；[operation-mcp](../../../src/operation-mcp.mjs) 解析 unitId | 独立事件契约，ID 当不透明值；归属查询交给 Records | P04 |
| [export](../../../src/export.mjs) 注入 records/outputs；[现有负向测试](../../../test/export.test.mjs)已验证不传 ctx、this 未绑定、冻结不可写及无 LLM | 保留并增强异步/新插件负例；隔离不归因于 Cordis inject | P01/P03 |
| [tasks](../../../src/tasks.mjs) 先冻结后建任务，冲突可能留快照；Records 有删除产物方法但入口未完整暴露 | 受理冻结原子性/精确补偿，明确失败任务放弃、产物与快照释放 | Q01/Q02 |
| 正式导出要求 targetLang/accepted；缺译 skip 不等于仅原文输出 | 独立原文产物与冻结快照模式，不伪造 accepted，不混入已有译文 | P02/P06 |

## 宿主与服务

最小宿主负责组合、插件清单/兼容检查、生命周期、能力/操作/事件发现、最小恢复入口，以及对 DSH 设置、凭据、存储、jobs 的装配。最小启动不等于每次都启动数据库、模型和 Python。持久工作组合启用 Records/资源/任务能力；解析、翻译、术语、上下文、重建、各入口可以独立选用。按能力与生命周期划分，不把每个函数做成插件。

DSH 固定提交目前为 `639ed015397290b3745d163aafe02ffee4aa3f84`（[setup-dsh](../../../scripts/setup-dsh.mjs)）；该提交内 [Cordis package](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/vendor/cordis/package.json) 的 **4.0.4 是 Harness 发布版本**，上游基线仍是 Core RC.7 / Loader RC.5，通过 [bridge](../../../src/dsh-bridge.ts)使用。P01 先验证现有 pin，不把升级设为主链硬前置；候选升级与组件依赖变化遵循[执行顺序及门禁](../../plan/0.1.x/runtime-sequence.md)，不自行造 credentials/settings/storage/jobs/权限的平行实现。P01 需核对实际服务名、依赖失活、`ctx.effect` disposer、启动失败回滚和异步 dispose；只有探针证明的语义才可称为固定契约。`inject` 是依赖声明，不能形成恶意第三方插件的沙箱。

| 服务/所有者（目标） | 必需依赖 | 可选依赖与缺席行为 | 所有资源与退出责任 |
| --- | --- | --- | --- |
| 组合根 / 插件装配 | Cordis Context；插件兼容清单 | 各业务能力；缺席仍有状态及恢复入口 | 装配顺序、激活失败回滚、反向释放；不实现领域算法 |
| `ivoraige.capabilities`（新增） | 无业务依赖 | 插件状态贡献 | 描述符/注销句柄；不执行业务 |
| `ivoraige.operations`（改造） | 注册表、边界校验 | handler 所声明的服务；缺件返回明确错误 | operation 注册与调用取消；旧方法名兼容映射 |
| `ivoraige.events`（新增） | 无 tasks 依赖 | settings/tasks/components 等生产者 | 订阅、流连接、序号；订阅方 disposer |
| `ivoraige.parse` / `ivoraige.outputs` | 各自注册表 | 具体 source/output 插件；缺席报告不可用 | 注册及精确注销；parse 不反向依赖 outputs |
| `ivoraige.records`（保留，去编排） | DSH `storageDomain` | 无具体适配器依赖 | 原子记录、修订/接受、快照；存储关闭前完成事务 |
| 导入能力（拟 `ivoraige.import`） | parse、records、受管理资源契约 | jobs 用于排队路径 | 获取/暂存/校验/提交，失败撤销未引用资源 |
| `ivoraige.tasks`（渐进拆 handler） | DSH `jobs`、持久状态 | parse/translation/export 按 task kind 声明 | 控制器、检查点、等待/取消；禁止关闭底层存储后继续写 |
| `ivoraige.translationModel`（已有）及翻译能力 | 已装翻译组合中的 DSH `llm`、records/jobs | 凭据按 provider 要求；缺凭据不影响解析 | 模型请求、usage、检查点；不承诺供应商调用 exactly-once |
| `ivoraige.export` | records、outputs、产物存储 | 兼容 renderer；不依赖 translation/llm | 接纳时一次冻结，输出临时文件与原子登记 |
| settings / credentials / storage / jobs | 对应 DSH 插件及其实际 inject | 无需相应能力时不强制装配 | 由 DSH 管理；ivoraige 只保留适配及关闭边界 |
| CLI / HTTP-SSE / MCP / WebUI / 桌面桥 | operations、capabilities；流入口依赖 events | UI/协议贡献按安装状态发现 | 路由、socket、进程或监听归所属入口，关闭后不再接单 |
| PDF/MinerU 插件 | 对应 parse/output/资源契约，插件声明的运行时 | 翻译不是解析前置；renderer 独立选择 | sidecar 进程、临时文件、引擎资源及私有校验 |

表中“可选”不表示调用时可以忽略缺件。依赖可用前不注册可执行 handler，或描述符标为 unavailable；执行前再次检查，防止状态快照过期。一个插件失败只回滚它和依赖它的能力；无关能力继续运行。缺失公共必需基础设施导致启动失败时，恢复入口仍能读清单/诊断并禁用故障插件。

### Cordis 服务、插件与资源所有权对照

下列提供插件名称是候选职责名，不是已发布包名，也不要求每一行独占一个 npm 包。P01 要把它们映射到所选固定 Cordis/DSH 的真实 Service/plugin、必需/可选 `inject` 和 effect 语法；这些机制由 Cordis 提供，不在领域服务中重新实现 DI、依赖调度或生命周期。capabilities/operations 的注册表只索引领域描述和 handler，不创建、加载或监督插件。

| 服务 / 边界 | 提供插件（候选） | 必需 / 可选 inject | 注册与 disposer 所有者 | 清理依赖顺序 | 缺席结果 |
| --- | --- | --- | --- | --- | --- |
| `ivoraige.capabilities` | CapabilityCatalog | 必需：无业务服务；可选：各能力贡献 | 目录插件拥有索引；每个贡献插件以自身 effect 注册并撤销自己的描述 | 先停消费入口，再撤销贡献，最后销毁目录 | 缺目录则业务发现不可用；bootstrap 仍读静态清单/启动诊断 |
| `ivoraige.operations` | OperationCatalog | 必需：capabilities；可选：handler 所需业务服务由所属插件声明 | 目录拥有调用路由；handler 由业务插件注册并持有 disposer，不能替业务插件创建依赖 | 停入口接单 → 停 handler/等待在途调用 → 释放业务依赖及目录 | 目录缺席不开放业务入口；已知能力缺件返回 `COMPONENT_MISSING`，未知 operation 仍按现行协议映射 |
| `ivoraige.events` | EntryEventBridge | 必需：Cordis context；可选：tasks/settings/components 生产者，各自声明依赖 | bridge 拥有 envelope/scope/barrier 和连接投影；生产者/订阅者各自以 effect 持有通知监听或订阅 disposer | 停连接接入与发送 → 释放 session 订阅 → 释放生产者/bridge；不依赖 tasks 维持设置通知 | 流能力 unavailable；按配置明确降级为权威查询，不假装可实时同步 |
| `ivoraige.parse` / `ivoraige.outputs` | ParseCatalog / OutputCatalog | 必需：无具体引擎；可选：source/output 贡献 | 目录拥有选择逻辑，具体适配器插件拥有注册、sidecar/资源及精确注销 | 停新调用 → 在途调用取消/完成 → 注销适配器 → 关闭其资源与目录 | 无匹配实现时明确缺组件/不支持；不暗选另一引擎 |
| `ivoraige.records` | Records | 必需：DSH storageDomain；无 parse/outputs 必需注入（目标） | Records 自身拥有 service provision 与 domain lease，保留同一 effect 的顺序约束 | 撤销 provision 时等待注入 Records 的消费者清理完成，再关 domain；具体 await 顺序由 P01 探针证明 | 依赖业务保持 pending/unavailable；旧数据不被“空库”替代 |
| `ivoraige.import` / translation / export | 各业务能力插件 | 必需：所属 records/parse/outputs 等契约；翻译需 llm，纯解析不需；jobs 仅排队路径 | 能力插件拥有 handler/任务取消与资源 lease；output adapter 始终只得冻结数据 | 先停入口/新任务 → drain/取消 → 释放适配器与 records；export 不取得 llm | 只禁用受影响 operation，返回缺件原因；其他能力可用 |
| `ivoraige.tasks` | DocumentTasks | 必需：DSH jobs、持久状态；可选：按 task kind 声明的执行能力 | 文档任务插件拥有 checkpoint/任务控制器；DSH jobs 拥有调度资源 | 完成/暂停/取消和持久化先于 records/storage 关闭 | 任务操作不可用；仍可执行无 tasks 依赖的查询/设置 |
| settings / credentials / storage / jobs | 对应现有 DSH 插件 | 按所选 DSH 的真实 inject，不从包 peer 名称猜服务 | DSH 拥有基础设施；ivoraige 的配置/界面贡献由自己的 effect 撤销 | 先移除消费方，最后 dispose DSH 基础服务 | 相应能力 unavailable；诊断不泄露凭据，不建立平行后端 |
| CLI 业务入口 | CliEntry | 必需：operations/capabilities；可选：events 用于流式显示 | 插件拥有业务命令贡献、stdio 监听和中断处理；进程退出只由 bootstrap 协调 | 停命令分派 → 等待/取消调用 → 移除监听；不在普通命令 disposer 中擅自关闭共享 host | 未装 CLI 插件仍可 help/修复；业务命令明确缺组件 |
| HTTP-SSE 入口 | HttpEntry | 必需：operations/capabilities；可选：events，未装时不提供 SSE | 插件通过 effect 拥有 server/routes/socket/会话；保留 Host/Origin 约束；对外模式另满足单机客户端授权 | 停 listen/接单 → 收尾在途请求和 SSE → 关闭 socket/监听 | 未装即不监听端口；由其他入口/修复通道报告，不能期待不存在的 HTTP 端点返回错误 |
| MCP 入口 | McpEntry | 必需：operations/capabilities；可选：events/具体工具贡献 | 插件拥有 server/transport/tool 贡献与取消、关闭句柄 | 停 transport 接入 → drain/取消 → 注销工具及监听 | 未装不启动 MCP transport；其他入口仍可用 |

最小 bootstrap 只负责参数/help、定位清单与数据目录、创建唯一 Context、启动一个可诊断的安全组合，以及委托 AppBoot/Loader 激活所选插件。业务 CLI 命令属于可选入口插件；help、诊断、禁用故障插件、恢复上一完整清单不能依赖所有业务插件成功。恢复操作仍使用同一配置/交付服务的安全模式，不绕开兼容与完整性检查、不写另一套 loader。启动失败要可从终端得到缺件/失败阶段和恢复动作；无 HTTP/MCP/UI 时也不能失去这条通道。

P05 是 DSH AppBoot/Loader 之上的**包交付薄层**：拥有来源/完整性/兼容清单、暂存与安装事务、登记及重启回退，然后委托既有 loader 激活。它不创建第二套插件解析、依赖容器或热重载循环。Loader 本身不保证完整安装事务或失败后还原整个树，薄层仍须验证自身补偿和恢复，不能把“复用 Loader”当作安装可靠性证明。

固定 DSH 的 jobs owner 经 live session 解析成 Agent，不是任意业务字符串标签；当前安装和业务提交均无 owner，竞争同一个 `maxConcurrentJobsPerOwner: 1` 的 unowned 槽。P01 先决定共享排队/饱和 CONFLICT 策略，或用经验证的真实 owner 方案；禁止仅换字符串就宣称配额隔离。`jobs.wait` 单次超时返回当前视图，不表示已结束；关闭必须有总 deadline，调用 abort 与超时分别处理。

Records 去掉具体 parse 依赖不能丢掉现有 `validateTranslation` 保护。P03 需把来源插件校验接到明确的修订写入/接受契约，覆盖人工编辑、模型结果和接受旧 revision 三条路径；校验与提交使用同一来源/基修订版本，冲突重新验证。插件缺席时旧记录可读，但需要私有格式校验的编辑/接受应明确阻塞，不能绕过校验直接写入。

## 生命周期与恢复

1. 读取配置并检查清单兼容；建立唯一 store owner；装配 DSH 基础服务，再装业务服务、适配器和入口。先 ready 后广告可用，已注册但启动失败必须注销。
2. 对每个 listener/route/adapter/operation/job/subprocess/临时资源登记所有者与 disposer。部分启动失败，反向撤销已取得的资源并保留原始错误及清理错误的诊断。
3. 退出先停止入口接单，冻结新安装/新任务，向活动任务发暂停或取消并等待其可持久化结果；再关闭 sidecar/输出流/事件订阅，dispose 服务与 storage，最后释放 store 锁。等待必须有期限和明确的强制终止记录。
4. 首轮插件安装/更新/禁用默认重启生效，不承诺运行时热卸载。任务运行中卸载应拒绝或标为 pending-restart；不能删除仍被任务、记录或快照引用的数据。
5. 崩溃恢复区分任务状态与执行副作用：保留现有未完任务暂停、显式恢复规则；导入取消不等于可续传；安装中断回滚到上个完整版本；模型请求是否已执行不明时不得记作零调用。

导出受理与快照建立必须同事务或有精确补偿：冲突/失败不产生无引用快照，冻结时点仍是受理而非开始运行。产物引用、任务引用与活动 lease 分别跟踪；失败任务可显式放弃，只有无引用且无活动租约的快照可释放。删除产物记录与删除文件的策略分开，外部 out 路径默认保留，改变此建议需 Q02 明确用户动作与不可逆影响。现有 addArtifact 失败已清理本次新文件，回归应区分普通补偿、unlink 失败及硬崩溃窗口，不把所有失败都描述为永久文件冲突。

临时 parse-only 资源应由请求 lease 持有并可释放，持久导入成功才转交 Records/产物引用；不能发布无人持有的原件。sidecar 显式声明所需环境/网络/识别服务；不传 LLM API 不等于环境隔离。任务进度缓存、Operations 长轮询与 Tasks 自有 wait 分别完成收尾，清理残留警告不掩盖真正进程终止失败。

候选可用性状态：`not-installed / disabled / ready / unavailable / failed / pending-restart`。状态包括 componentId、version、reason、可采取的恢复动作；安装与执行任务状态使用各自状态机，不能混成一个枚举。缺组件保持既有 `COMPONENT_MISSING`；不兼容、缺资源、失败阶段使用安全的 details 表达，并在 P01 决定是否需要新错误码。不可用不能静默改用另一个引擎。

## 解析、翻译、输出三份独立契约

| 契约 | 最小目标形状与责任 |
| --- | --- |
| Source descriptor | 独立 `adapterId`、`formats[]`、输入种类 text/bytes/managed-resource、match、显式选择、调度/取消能力、依赖状态、来源绑定 schema 版本 |
| Parse request/result | request 给资源句柄、sourceLanguage（可 unknown）、options、signal；返回通用 units、顺序/定位、资源清单、结构及不透明私有 binding。不需要 targetLang 或翻译 provider |
| Translation request | 消费标准 units、有效上下文/目标/术语约束及格式插件贡献的安全约束；不在公共 SYSTEM_PROMPT 写 BabelDOC 标记。适用性与接受规则不变 |
| Output descriptor | 独立 `adapterId`、`formats[]`、binding/模式兼容声明、返回形状、输出资源及失败语义；同一个 format 可有多个实现 |
| Output invocation | 只接收冻结数据、受限资源访问句柄、signal、输出选项；不接收 Cordis ctx、服务定位器、LLM 或凭据。返回带 mediaType/资源引用的产物清单，文本/二进制一致封装 |
| 可读投影 | 来源插件负责公式/私有占位符解释；通用 MD/JSON 消费规范化可读视图。可选 `renderReadable()` 无法提供时返回明确限制，不向共享输出引入引擎分支 |

显式 adapterId 优先且必须匹配格式/依赖；未指定时使用确定的 match/配置优先级，平分不靠注册先后暗选。实际解析/输出实现及版本进入任务和产物来源。输出先匹配 format，再校验 sourceBinding/模式兼容，最后选择实现；拒绝把同为 PDF 当成跨引擎兼容。资源内容/语义身份与存放地址分开，新身份算法需要版本；不能简单删除整个 binding 的适用性校验。

纯解析产物拟使用 `contentMode: source`，保存原文结构与资源；翻译快照拟使用 `contentMode: accepted-translation` 并携带 targetLang。二者必须区分，旧快照按旧规则解读。原文导出不读取已有 accepted 译文，不创建假的修订。OCR/VLM、翻译和重建外部服务的用途/授权/usage 分开声明，禁用翻译不等于禁止已授权的识别模型。
P02 首次启用该区分：省略 `contentMode` 的旧快照按 `accepted-translation` 读取，`source` 快照没有 `targetLang`，所有 unit 均固定为原文决策。记录载荷按需由 v1 升至 v2，旧数据在只读操作中不改写；未知的更高记录版本拒绝写入。此阶段保留存储 domain v1 与现有来源 binding/适用性语义，真实用户库迁移不在此合同启用范围。

## 术语服务与翻译复用

沿用[补充 0001](../amendments/0001-term-applicability.md)的需求与职责；其中 M2/M3 及插件名称属于当时实现参考，不能推定当前宿主已有这些服务。这里把它接入 0.1.x 组合，具体 schema 随术语切片评审固定，不新增分类服务或平行术语规则引擎。

| 职责 | 当前目标边界 |
| --- | --- |
| terms | 持久库及义项的确认、编辑、导入导出；保留类别、范围、来源依据和版本，先筛范围，再匹配语言/词形/义项，最后处理库优先级及冲突 |
| termBuilder | 从获准来源产生带依据及适用对象的候选；未知通用性时限制在来源范围，不直接替用户确认或推广 |
| translation / textTask | 消费已解析的有效术语约束与版本；不自行推断书内定义。显式选库却缺装配能力时报告缺件，不静默忽略约束 |
| Records / 复用边界 | 保留文档/单元来源、有效约束身份和版本及修订依据；库实体由术语能力拥有，Records 不因接线变成第二术语库 |

最小数据需求包括库/义项身份、语言方向、候选/确认状态、来源定位、类别/适用对象及版本；它们是语义要求，不预定存储字段名。范围先于优先级，启用项目库不能使不适用义项生效。实际有效约束进入翻译/复用依据；范围、义项或有效版本变化须重核相关结果的适用性，不重写历史 accepted 或冻结快照，也不令无关单位重翻。旧数据不能仅因存于共享库就推断为通用。

术语、抽取和翻译能力可分别缺席，无术语组合仍成立。U03 的术语管理切片以这份后端契约接线及[双来源验收](../../plan/0.1.x/validation/cross-cutting.md#术语与复用)为前置；存储维护与预检切片不因此等待完整术语工程。

## 入口与事件

业务插件注册 operationId、参数/结果 schema、所需能力、handler、是否长任务及取消语义。入口只做协议参数/上传流到公共输入契约的适配、错误映射和身份授权映射；领域文件读取与产物归属校验归资源服务。CLI/HTTP/MCP 不解析 unitId、不导入具体格式模块。旧 `Operations.invoke` 可先作为兼容 facade 委托注册表，不要求一次删除所有公共接口。

WebUI 使用 capability/settings descriptor 展示通用状态与动作；新引擎不追加前端引擎名单。专门 UI 可由插件贡献且须有版本/缺件降级，基础修复能力不依赖完整 UI 插件。桌面壳消费相同接口，不能另建业务流程。

Cordis `ctx.emit/on` 承担进程内插件/服务通知，监听随所属 plugin effect 清理；`ivoraige.events` 仅把业务状态变化投影为跨入口可版本化的 envelope、scope、barrier 和受管理订阅，不替代 Cordis 的生命周期事件、依赖注入或另起一套全局插件总线。生产者在权威状态提交边界通知 bridge；单次 `ctx.emit` 本身不提供状态事务或跨连接可靠送达。对外只输出数据，不能把 Context、服务实例、内部事件对象或密钥透传给适配器/客户端。

事件候选 envelope：`eventVersion, eventId, type, sequence, occurredAt, scope, data`，状态同步另带下述 `generation/stateRevision`。scope 包含可选 docId/taskId/componentId，ID 不透明；只有需要长期恢复的任务状态持久化，普通设置通知不默认建第二套持久事件系统。任务进度、设置页变化、组件状态是不同命名域；P04 为旧 SSE 格式提供兼容映射。只有后端确有保留窗口时承诺事件重放；订阅取消/入口关闭必须释放监听，不把 WebUI 刷新当作事件一致性方案。

### 状态快照与订阅的同步边界

以下 `StateSnapshot` 是 UI/入口的权威状态视图，不是导出用的 `ExportSnapshot`。P04/D01 采用**先订阅并缓冲，再取状态快照**的候选流程，不依赖未来事件恰好到来才发现缺口：

1. 同一 host `generation`、同一授权查询 scope 的状态提交由后端分配单调 `stateRevision`。状态可见、revision 前进和将失效通知交给已生效订阅须有同一个串行化边界；不得先广告新 revision，随后才让对应状态可读。跨服务摘要也必须取得一致切面，不能拼出没有一致性保证的单个数字。它不同于业务 revisionId、事件 ID 或传输 sequence，过滤后不保证相邻数字连续。
2. 订阅就绪握手返回 `subscriptionId, generation, scope, barrierRevision`。服务端在同一串行化边界安装订阅并读取权威 barrier；握手前已提交的状态由随后快照覆盖，握手之后的相关提交进入该订阅。连接已建立不等于订阅已生效。客户端从就绪起缓冲失效通知，不等待首条业务事件才开始同步。
3. 保持该订阅有效，获取同一 generation/scope 的 `StateSnapshot { stateRevision, state }`；数据与 revision 必须来自同一一致切面，且 revision 不早于 barrier。应用快照 r 后丢弃缓冲中 revision ≤ r 的通知；任何 > r 的通知都使视图失效，触发在**仍生效的同一订阅**上重取。重取期间继续缓冲，不能先取消订阅再重新制造读取/订阅窗口。通知作为失效提示，不要求客户端按事件重演状态。
4. 连接断开、generation 改变、scope/授权改变、缓冲溢出或服务端不能保证通知完整性时，明确进入 resync-required，视图标为未同步；建立新订阅并重复上述握手和快照流程。不同 generation 的数字不可直接比较。失效重取允许合并和退避，持续变化时展示同步中，不声称已追平；在服务恢复且状态停止变化后，即使没有后续业务事件也必须收敛。

P04 可提出等价的原子 barrier 方案，但必须证明就绪、状态提交及重取期间不存在未覆盖窗口，并同步修改该契约与验收。首轮不要求持久事件日志；只保证连接有效期内的通知/显式失效，重启或断线恢复以权威状态为准。定时器、连接和有限缓冲归入口 session 所有，关闭后释放。以上是待实现契约澄清，不是当前 SSE 已满足此流程或已确认存在运行时缺陷的声明。

当前 MCP 贡献已经插件化，HTTP/CLI 仍是普通协议模块；目标 P04 将三者收口为可选入口插件，其资源归属与缺席行为见上表，不把当前实现误写成目标已完成。产物读取及大小限制由公共能力统一，上传大小上限由能力/传输约束共同声明；现有 UI 7 MiB 与 HTTP 10 MiB 差异需说明或统一。D01 同时固定 launcher/CLI 自定义数据目录及 store 参数的优先级，不能让两个入口静默指向不同用户库。

## 可组合工作流与外部协作

[工作流契约](workflows.md)补充能力端口的类型/schema/单集合基数、控制与副作用声明，以及模板版本、工作流实例（项目关联可选）、运行定义、人工后续片段和可变执行状态。默认链目标为组合定义，不再将 parse → translate → export 视为唯一业务模型；W01 的真实不同拓扑验证纳入基础阶段。节点引用能力，不创建新的 Cordis 插件框架；编排仅处理业务依赖，调度/取消复用 tasks/jobs。普通入口仍可直接执行单个公共操作。

格式/协作插件沿用本页的资源、来源绑定、数据-only 输出、生命周期及权限契约；[路线](../../plan/0.1.x/formats-integrations.md)区分读取/草稿/原生回写，并给出受约束的来源交接、状态取消、产物/幂等和错误接口。原生回写和外部写回分别声明副作用，不能让普通 export 隐式上传或调用模型。模板分享不含秘密/用户内容/机器路径；历史缺失血缘不按当前设置伪造。

### 稳定对外接口与可调用方案

内部 operation 注册不等于全部公开。复用现有 Operations HTTP/MCP 入口与 P04 注册契约，I01 收口少数稳定对外能力：授权范围内的方案发现/描述、分段批量输入、执行/结果/取消，以及有限术语能力。OpenAI 兼容入口、MCP 和软件专用桥接只做协议投影，复用同一业务调用，不另建翻译内核或透传内部操作、凭据。服务身份、版本、能力和客户端标识用于互认；自报名称不是鉴权，不启用未经授权的自动扫描或通配 CORS。

可调用翻译方案是[保存工作流的受约束发布投影](workflows.md#可调用方案与集中管理)，不新增 workflow schema。稳定方案 ID 对应已发布配置修订；每次受理冻结流程、模型/连接引用、术语库/抽取配置版本及允许覆盖的有效值，不靠切换全局模型处理并发请求。OpenAI `/v1/models` 仅展示调用者获准的已发布文本兼容方案，不列出真实模型；人工等待、二进制流程不伪装为普通聊天模型。基础交付按 [I01.shared@1 / I01.callable@1 / I01.zotero@1](../../plan/0.1.x/packages/formats-integrations.md#共享子交付)独立认领与验收；方案后端接 W02、U03.terms@1，W03.publish-ui@1 后置接入。具体 wire 字段和客户端适配在[外部 API 草案](external-api.md)收口，不成为 P04 基础注册交付的全部前置。

### 单机客户端授权

当前事实：本节补核主线 2009d8f6 的 [HTTP](../../../src/http.mjs) 只有回环监听与 Host/Origin 检查，[MCP](../../../src/operation-mcp.mjs) 共用内部 operations；尚无下述客户端凭据、principal 或逐调用 scope 校验。下列是 I01.shared@1 的目标，不能把现有本机端口视为已满足。

单机外部接入默认关闭，启用后仍限回环；不引入账号平台、OAuth 或多租户。可信本机 owner 通过受 OS 用户权限保护的 CLI 控制入口批准客户端、签发/撤销授权；后续 UI 调用同一管理器。外部客户端不能自行注册、领取 owner 权限或修改授权。宿主显式绑定本机 stdio 的 owner/客户端启动身份；自报 clientId 不改变身份。

| 项目 | 最小契约 |
| --- | --- |
| 凭据来源 | owner 批准后生成至少 256 bit CSPRNG 不透明 bearer，只展示一次；与上游模型 key、Zotero key 分离。验证材料及授权记录沿用经 P01 探针确认的 DSH credentials/storage 能力和 OS 文件权限；缺少的入站授权薄层由 I01 提供，不假定 DSH 已有签发服务，不另建通用凭据后端。秘密不放 URL、方案、模板、日志或公开诊断 |
| 主体及范围 | 服务端凭据记录映射不可由请求覆盖的 principalId、grantId、有效期/撤销状态；grant 绑定明确 operation 集、方案 ID 与允许的已发布修订策略、资源/术语库范围，以及浏览器客户端的准确 Origin。默认空集合是无权，不是通配。clientId/名称只作标记；loopback、Origin 也不是认证 |
| 调用检查 | transport 验证凭据后建立与用户参数分离的可信上下文；共用 facade 对每个 operation 再检查授权和资源归属。方案发现只返回获准项；受理及排队执行前复查方案修订/允许覆盖范围；任务、结果、产物、事件读取和取消检查主体所有权或显式共享授权；术语查询与候选/确认写库分别授权。HTTP、HTTP-MCP、受限 stdio MCP 和薄适配使用同一检查，不暴露通用内部 invoke |
| 错误 | 缺失、无效、过期、撤销凭据返回 HTTP 401 / AUTHENTICATION_REQUIRED；有效主体缺 operation、方案或资源权限返回 403 / PERMISSION_DENIED，不泄露对象是否存在。获准范围内确实不存在才返回 404。HTTP-MCP 连接遵守同一规则，连接后每次工具/资源调用仍校验；stdio 返回等价机器错误，工具错误标为 isError，不回退匿名调用 |
| 撤销与运行 | 每次调用、排队调度和流重连读当前 grant；撤销后拒绝新调用/调度、关闭相关流与订阅，并请求取消该授权的在途任务。取消按既有 best-effort 语义记录，已发出的供应商请求不保证撤回。结果仍按主体保护，由 owner 处置或重新授权后访问。配置冻结不冻结权限，幂等重试不能绕过撤销 |
| 浏览器及诊断 | 保留 Host 检查，浏览器 Origin 必须精确命中授权列表，不用通配 CORS；无 Origin 的原生客户端仍须凭据。预检不签发授权、不返回业务数据。诊断只记录安全的 principal/grant ID、operation、拒绝原因和 traceId，不记录 bearer 或正文 |

公开授权按操作拆分，下面的 scope 名是 I01.shared@1 的候选标识，首个实现固定映射；HTTP 路径或 MCP 工具名不同也不得合并掉检查。

| 操作 / scope | 额外范围检查 |
| --- | --- |
| 服务描述 / service.read | 已认证主体，只返回获准协议能力 |
| 方案发现与描述 / plans.read | 授权方案 ID / 发布修订过滤，不泄露未获准项 |
| 受理运行 / runs.create | 方案、修订、允许覆盖、输入资源和术语库均在范围内；排队执行前复查 |
| 状态/结果/事件 / runs.read | 本主体运行或明确共享的运行，事件也按对象过滤 |
| 产物读取 / artifacts.read | 获准运行产生且仍授权的产物，不因拿到路径/ID 扩权 |
| 取消 / runs.cancel | 独立于读权限，核查目标运行归属 |
| 术语查询 / terms.read | 指定方案/库/词项范围；可执行翻译不等于可导出全库 |
| 抽取候选 / terms.candidates.create | 另核输入来源、抽取能力和费用授权 |
| 确认写库 / terms.write | 目标库明确写权限及确认动作，普通翻译/候选令牌无此权限 |

来源导入/外部写回等新增公开 operation 必须在注册时声明自身 scope、资源检查与副作用确认；缺少授权映射不得发布。上表权限不会自动推导出 owner 管理权限。

启用门禁必须覆盖同一数据域的旧入口：匿名的旧 HTTP/MCP、宽权限内部工具、产物下载及事件流须关闭，或纳入 owner 会话/凭据与同一授权边界；仅另开新端口不能消除旁路。门禁未通过不得广告或启动对外接入。受 OS 用户权限控制的本机 CLI/stdio 管理通道可保留，但不能由远端参数选成 owner。该边界隔离经授权的客户端，不声称能隔离已经控制同一 OS 用户或进程内插件的攻击者。验收统一在 [I-V01.shared](../../plan/0.1.x/validation/formats-integrations.md#i-v01-shared)，各适配追加自身连接探针。

## 安全、隐私与诊断边界

这是既有约束的信任边界索引，适用于当前交付路径；完整远程/共享权限产品后置不推迟这些检查。部署或数据流变化时按[领域地图](../../plan/0.1.x/domains.md)重评，漏洞报告仍按 [SECURITY](../../../SECURITY.md)。

| 边界 | 信任与责任 | 既有约束入口 |
| --- | --- | --- |
| 本地 HTTP / MCP | 回环地址不等于任意网页或调用者可信；当前仅有 HTTP Host/Origin 检查及 MCP 内部能力暴露；目标外部模式按[单机客户端授权](#单机客户端授权)建立 principal/scope 和旧入口防旁路门禁，资源归属由公共操作核查 | [入口与事件](#入口与事件)、[v2 进程/入口协议](../v2.0/03_API-protocol_v2.0.md) |
| 插件 | 受控来源、版本及依赖检查；进程内插件属于宿主信任域，Cordis inject 不是沙箱，安装不能自动授予私有数据外发用途 | [服务所有权](#cordis-服务插件与资源所有权对照)、[安装契约](../../plan/0.1.x/migration-distribution.md#插件包与安装) |
| sidecar / 资源 | 文件/环境/网络范围及进程归属明确；不因 stdio 分进程就宣称隔离，来源文件只读，输出与临时资源按 lease 清理 | [生命周期](#生命周期与恢复)、[迁移矩阵](../../plan/0.1.x/migration-distribution.md#兼容矩阵) |
| 模型提供商 / 外部协作 | 用户内容和上下文按用途授权，实际连接及费用可见，秘密沿用 DSH 受控引用；未知执行结果不盲重试，返回内容视为数据 | [UI 外发交互](ui.md#独立普通文本翻译)、[工作流](workflows.md)、[外部协作](#可组合工作流与外部协作) |
| 日志 / 数据保留 | 事件、错误、诊断和公开评测不泄露凭据或私有正文；持久记录、缓存、备份及外部文件分别处理，按引用/恢复政策保留或清理 | [生命周期](#生命周期与恢复)、[数据管理](ui.md#术语知识库与数据管理)、[迁移矩阵](../../plan/0.1.x/migration-distribution.md#兼容矩阵) |

诊断复用现有 traceId、操作/任务/组件状态，至少能关联能力/插件版本、执行阶段、失败或等待原因、取消/超时及恢复动作。P04/P05 在对应协议中收口安全字段；公开错误与脱敏导出不返回原始凭据、私有请求或供应商栈。验收见[安全与诊断](../../plan/0.1.x/validation/cross-cutting.md#安全与诊断)，不引入新的 tracing 平台。

## 契约启用与验证

桌面扩展的 HostSession、TaskCapabilities、DraftJournal、WorkerLifecycle 及关闭/退出握手细节见[桌面契约表](../../plan/0.1.x/desktop.md#必须先有的基础契约)，作为入口/会话适配契约，不是第二内核。任务状态与调度继续归 `ivoraige.tasks`/DSH jobs，worker 控制复用所属插件/sidecar 的资源生命周期，不另建持久任务表、调度器或存储 owner。UI 销毁前必须持久化确认草稿；事件需 host generation/state revision 以识别重启和缺口；idle-stop 与 final-dispose 分开。共用退出/取消/状态安全纳入 0.1.0，原生壳与体验按[候选分期](../../plan/0.1.x/releases.md)后置。

P01 固定服务/错误/版本命名及兼容探针，P02 明确旧数据读取与写入迁移，P03/P04 收口适配器和入口事件，P05 安装契约冻结后再接 P06/P07。每次变更同步定向测试与 [验证矩阵](../../plan/0.1.x/validation.md)。当前读代码结论不能替代 DSH 生命周期探针、真实安装或引擎运行证据。

### P03 已激活的适配器边界

既有内容 `fingerprint` 算法和值保持不变；有版本来源描述符只在新文档 ID 命名空间加入 adapter id/version/binding schema。相同内容由同一 id 的不兼容新版解析时创建独立新文档，不覆写旧快照、修订或旧记录。无来源版本元数据的 pre-P03 文档沿用历史 ID 和去重路径；本次导入任务仍记录本次实际选择的来源实现及版本。

P03 将 `format` 与 `adapterId` 分开。来源描述符声明 `formats[]`、`inputKinds[]`（`text`、`bytes`、`managed-resource`）、`version`、`bindingSchemaVersion`、可选排队与取消能力；旧描述符缺少这些字段时沿用既有 match 路径。显式指定的适配器必须支持输入种类和格式；并列最高 match 返回 `CONFLICT`。来源插件必须返回属于自身的 `sourceBinding.adapterId`，导入编排由 Importer 承担，Records 只持久化规范化结果。来源资源清单以 `id/mediaType/contentDigest/version` 计算语义身份，不把位置放进 source IR；冻结快照保留资源版本，变更同一 id 的内容会拒绝旧快照重放。来源 binding 仍参与修订适用性检查。

输出描述符以 `formats[]` 声明所支持格式，可按 binding 和 contentMode 判定兼容，并以 `requiredViews[]` 按需索取来源插件的 `readable-text` 或 `native-markdown` 投影。`requiredViews: []` 的二进制输出只读取冻结快照，无须来源插件继续安装或保持原版本；需要来源投影的文本输出仍校验来源版本。受理时选中的输出 adapter id/version 冻结在任务中，执行和恢复必须再次匹配，产物记录实际 id/version；导入任务同样固定来源实现版本。旧记录无来源版本元数据时保留旧读取兼容路径；带版本元数据的记录在人工写入、模型 checkpoint、接受旧修订和需要来源投影的导出时，若插件缺席或同 id 不兼容替换则拒绝写入/导出，旧记录读取保持可用。直接 Exporter 调用的受理或执行失败会清除本调用新建且无引用的快照，已有快照不受影响。导入的同格式候选不让 `unavailable` 来源或不适合当前输入种类的来源改变文本/字节路线；同步或排队响应由实际选中的来源描述符决定，低分的排队候选不得改变高分同步来源的受理。来源处于 `unavailable`、`disabled` 或 `failed` 时，发现、自动／显式选择及排队执行复核均拒绝该来源；显式指定时返回缺件错误。

#### P03 输入准备与统一选择补充

公共 Base64 上传不在入口筛选来源或优先转成文本。Parse 准备自有 bytes 副本及严格 UTF-8 视图；路径仅作为 managed-resource，原始 string 输入仍仅为 text。每个来源的每个兼容视图只匹配一次，同一来源保留最高分视图；同一来源视图同分时优先原 bytes，不造成自身歧义。不同来源最高分并列返回 CONFLICT 且不写入任务或文档。未声明 inputKinds 的旧来源保留有效 UTF-8 文本优先的兼容行为。

Importer 将统一选择结果交给 Tasks，固定来源描述符、版本、调度模式、适配后输入和执行函数；执行时只核验注册身份、版本及可用性，不再重新评分。传入 Buffer 在准入时复制，调用方后续改写不影响排队上传；路径只固定 locator，实际文件由来源适配器的导入流程管理。来源替换、版本变化或缺件明确失败，不切换到后来新增的更高分来源。

TXT/Markdown 的严格 UTF-8 语义由各自来源适配器校验，不能据此限制其他二进制来源。原缺 PDF 组件的排队 wire 响应只作为 Importer 的单一版本兼容策略保留，不参与通用输入适配或评分；显式 adapter 仍保持明确的缺件/输入不兼容错误。

#### P03 可用性与投影能力补充

不可用来源不执行 matcher；缺件分类仅依据声明格式及兼容输入类型，没有格式提示时保守返回兼容来源的缺件信息。可用来源仍统一评分并固定选中输入，不受不可用来源干扰。输出声明需要 readable-text 时，来源必须显式实现 readableText；缺少实现返回 PRECONDITION_FAILED，返回值非字符串是 INTERNAL，不能退回内部 text。TXT/Markdown 显式采用原样投影，PDF 保留既有解码投影，零视图二进制输出保持独立。输出 availableFor/listAdapters/listFormats/get 使用同一可用性规则及可选 contentMode；disabled/failed 不允许执行，unavailable 仅能经 canRunUnavailable 明确允许某模式。输出注册显式 version 必须是非空字符串，省略保持 unversioned 兼容。

### Q02 active resource-retention contract

Q02 adds explicit `failed -> abandoned`, record-only artifact deletion, opt-in managed-file deletion, durable cleanup retry, and snapshot/artifact read leases. The current 0.1.x implementation guards shared paths and active/failed task references. New SQLite stores use DSH `ivoraige_records` unit version 2. Existing unit-version-1 stores remain readable and permit ordinary writes; before the first Q02 semantic row write, the new binary synchronously stamps the DSH unit version 2. Only the affected document or import task becomes schema 3; existing v1/v2 records are not bulk rewritten. DSH's SQLite unit-version check makes older version-1 binaries refuse to open the store after activation, including if the Q02 row write fails after the stamp. Back up the complete store and files before upgrading; a full backup restore is required to roll back. See the v2.0 protocol Q02 section and the 0.1.0 development guide for operation names and recovery. This does not activate P04 registration/event lifecycle work.

#### Q02 文件链接身份补充

共享引用以现存文件的完整 realpath 目标生成父目录身份和规范文件名，跨目录或不同文件名的文件符号链接与目标属于同一受保护身份；不按平台强制小写，遵循实际文件系统语义。目标无法确定的悬空链接在物理删除身份检查时保守拒绝。metadata-only 删除不依赖该检查，文件缺失仍可删除记录并保留路径信息。原有受管根目录、regular-file、摘要、任务及 lease 校验均保留；不扩大为任意恶意本机并发替换防御。

共享引用预检及事务内复检无法解析其他产物身份时，返回 `CONFLICT`，details 包含 `blockingDocId`、`blockingArtifactId` 和恢复指引；底层错误仅保存在私有 cause。拒绝时不删除记录、不生成清理标记、不删除文件。默认 retain 删除不依赖路径检查。

### P04 activated operation and synchronization contract

P04 uses one Cordis `ivoraige.operationCatalog` for operation ID, input/result schema, requirements, handler and long-running/cancel metadata. The existing Operations facade delegates to it. Registered contributions own their disposer; CLI/HTTP/MCP remain transport projections with owned controllers/transports/listeners. Optional entry switches do not mount a second runtime or configuration source. Bootstrap help remains independent of business activation. Shutdown stops entries and drains request handlers before Records/storage withdrawal; a missed drain deadline is an incomplete shutdown and retains the store owner for retry.

The facade fixes transport-owned `apiVersion` after validating the business payload. A self-owned local generic CLI invocation rejects long-running/task-cancellable operations before admission; existing local aliases retain waiting/final-exit behavior, while generic task calls require a persistent host. Import declares Records/Tasks/Parse/Importer requirements; missing import capabilities produce `COMPONENT_MISSING` without disabling unrelated reads. Invalid HTTP path encoding is `INVALID_ARGUMENT` at the entry boundary.

The event bridge adapts post-commit Cordis/DSH notifications. A session installs its subscription before advertising `{subscriptionId,generation,scope,barrierRevision}`. A stable synchronous state snapshot contains the same session identity and `stateRevision`; readers whose capture changes the revision are retried, and unstable/async readers require resynchronization. The client retains the subscription during refetch and snapshot application, discards revisions at or below the applied snapshot and refetches for newer notifications. Overflow, connection/generation/scope changes and notification integrity failure invalidate synchronization. Public snapshots contain metadata/status/revisions; they do not expose stored source bodies, credentials or framework objects. No durable event replay is enabled.

Entries treat IDs as opaque and delegate exact ownership to Records/resource access. HTTP and MCP artifact reads use the same optional read-size limit and lease; the 7 MiB browser file limit leaves room for Base64 and JSON inside the 10 MiB HTTP body limit. Internal generic operation projections are not the full I01 external/authenticated API. Detailed measured scope and limits are in [P04 evidence](../../plan/0.1.x/evidence/foundation-p04.md).

Records 的 opaque ID 归属索引在加载时构建，并随 DSH 成功落盘通知同步增量维护受影响文档；失败写入不改变索引。unit、revision、artifact 和统一 task 命名空间（含 import task）不再通过 ID 前缀或全库扫描定位。重复 ID 返回 `CONFLICT`，唯一 ID 的文档不匹配返回 `NOT_FOUND`。索引仅在内存中，不改变 SQLite 或 wire schema。
