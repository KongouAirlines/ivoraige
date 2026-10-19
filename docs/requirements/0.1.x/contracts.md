# 0.1.x 组合与生命周期契约草案

这是 [首轮规划](../../plan/0.1.x/README.md) 的目标契约，尚未整体实现。产品不变量继续来自 [AGENTS](../../../AGENTS.md) 和 [ADR-0002](../../decisions/0002-plugin-composition-0.1.0.md)。以下新服务名、描述字段和错误 details 是候选 API；工作包 P01 验证固定 DSH/Cordis 后收口，不能当作已存在接口调用。

## 当前事实与目标替代

基线：`43d3f1f`。本表是定向源码阅读，不是 136 项审查的重跑。

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

DSH 固定提交目前为 `639ed015397290b3745d163aafe02ffee4aa3f84`（[setup-dsh](../../../scripts/setup-dsh.mjs)）；该提交内 [Cordis package](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/vendor/cordis/package.json) 为 **4.0.4**，通过 [bridge](../../../src/dsh-bridge.ts)使用。首轮不升级 DSH，也不自行造 credentials/settings/storage/jobs/权限的平行实现。P01 需核对实际服务名、依赖失活、`ctx.effect` disposer、启动失败回滚和异步 dispose；只有探针证明的语义才可称为固定契约。`inject` 是依赖声明，不能形成恶意第三方插件的沙箱。

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

## 入口与事件

业务插件注册 operationId、参数/结果 schema、所需能力、handler、是否长任务及取消语义。入口只做协议参数/上传流到公共输入契约的适配、错误映射和身份授权映射；领域文件读取与产物归属校验归资源服务。CLI/HTTP/MCP 不解析 unitId、不导入具体格式模块。旧 `Operations.invoke` 可先作为兼容 facade 委托注册表，不要求一次删除所有公共接口。

WebUI 使用 capability/settings descriptor 展示通用状态与动作；新引擎不追加前端引擎名单。专门 UI 可由插件贡献且须有版本/缺件降级，基础修复能力不依赖完整 UI 插件。桌面壳消费相同接口，不能另建业务流程。

事件候选 envelope：`eventVersion, eventId, type, sequence, occurredAt, scope, data`。scope 包含可选 docId/taskId/componentId，ID 不透明；只有需要长期恢复的任务状态持久化，普通设置通知不默认建第二套持久事件系统。任务进度、设置页变化、组件状态是不同命名域；P04 为旧 SSE 格式提供兼容映射。断线后读取权威状态并重建订阅，只有后端确有保留窗口时承诺事件重放；订阅取消/入口关闭必须释放监听，不把 WebUI 刷新当作事件一致性方案。

当前 MCP 贡献已经插件化，HTTP/CLI 仍是普通协议模块；P04 收口它们的生命周期与注册，不把“所有入口均未插件化”当现状。产物读取及大小限制由公共能力统一，上传大小上限由能力/传输约束共同声明；现有 UI 7 MiB 与 HTTP 10 MiB 差异需说明或统一。D01 同时固定 launcher/CLI 自定义数据目录及 store 参数的优先级，不能让两个入口静默指向不同用户库。

## 契约启用与验证

桌面扩展的 HostSession、TaskCapabilities、DraftJournal、WorkerLifecycle 及关闭/退出握手细节见[桌面契约表](../../plan/0.1.x/desktop.md#必须先有的基础契约)，作为本契约的候选补充。UI 销毁前必须持久化确认草稿；事件需 host generation/state revision 以识别重启和缺口；idle-stop 与 final-dispose 分开。D01 的探针与 P01/P04 共同收口后才启用正式桌面实现，不另建任务或存储内核。

P01 固定服务/错误/版本命名及兼容探针，P02 明确旧数据读取与写入迁移，P03/P04 收口适配器和入口事件，P05 安装契约冻结后再接 P06/P07。每次变更同步定向测试与 [验证矩阵](../../plan/0.1.x/validation.md)。当前读代码结论不能替代 DSH 生命周期探针、真实安装或引擎运行证据。
