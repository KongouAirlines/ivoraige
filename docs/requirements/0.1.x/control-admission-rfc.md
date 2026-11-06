# 0.1.x 四接口 RFC：宿主、入口、插件交付与运行受理

状态：**接口设计待评审，未实现、未冻结 API；运行时暂缓迁移的顺序已定**。修订日期：2026-11-06；源码基线：`7e60dda61e22f9b85aa0b4da97b5f84dacbaa4a3`。本文的方法名、状态和 JSON 是讨论用伪接口，不可直接调用，不代表新的 HTTP 路径、MCP 工具或已发布 SDK。实现时逐项提交机器 schema、兼容映射和验收证据。

目标是让最小托盘、WebUI 插件管理页、MCP/OpenAI 入口和保存工作流共享清楚的边界。四接口属于 ivoraige；Cordis 提供插件/服务装配、依赖和 effect 生命周期，DSH 提供经验证的基础服务。本文不设计第二套 Loader、任务系统、凭据库或通用事件总线。

## 范围、依据与替代关系

- 延续[组合契约](contracts.md)、[工作流模型](workflows.md)、[外部 API](external-api.md)及其[协议附录](external-protocol.md)。HostControl 汇总既有 HostSession/退出语义；EntryControl 细化[首版最小托盘](../../plan/0.1.x/desktop.md#首版最小托盘子集)；PluginDelivery 细化 P05/P08；RunAdmission 细化 W02/I01.callable@1。它们不是四个强制独立 npm 包。
- 当前实现与兼容协议继续有效；下文明确列出的 owner/授权/冻结行为在对应实现切片通过迁移验收后才替换旧行为。本文不替换 P04 operation catalog、事件 barrier、Records 或 ExportSnapshot；已启用部分见 [P04 证据](../../plan/0.1.x/evidence/foundation-p04.md)。现有工作包表中的分支历史标签不能替代本次 main 源码核对，也不在本 RFC 中批量整理。
- **运行时迁移暂缓：只有 Cordis 上游正式稳定且 DSH 已完成对应迁移两个条件同时满足，才评估 ivoraige 的依赖迁移。** 两条件是必要条件，不自动批准升级；仍须固定精确版本元组并通过本项目兼容验证。决策记录见 [ADR-0003](../../decisions/0003-runtime-migration-gate-0.1.x.md)。该顺序取代[旧评估](../../plan/0.1.x/runtime-sequence.md)中“基础改造前段优先采用候选”的建议；旧源码证据和验证矩阵保留。当前功能设计、固定 pin 下的实现与测试可继续，不等待迁移。
- 不选择桌面框架，不增加远程控制、系统服务、自启、安装市场、任意插件热卸载或全新账号体系；不改当前发行版本号。首版目标仍是最小托盘和插件管理页可安装官方 PDF 能力，完整原生 UI 后置。发行物及平台支持必须另有实际证据。

### 已有基础与缺口

以下对照上述源码基线和评审指出的现状做静态核对，不是本次运行测试；更新实现时须重新核对实际 main。

| 已有基础 | 尚不能据此声称的能力 |
| --- | --- |
| [launch](../../../src/launch.mjs)探测 instance.json 并复用宿主，[store-lock](../../../src/store-lock.mjs)保护数据库 owner | 跨所有故障场景的 HostControl 协议、原生窗口/托盘和完整 drain API 已交付 |
| [operation catalog](../../../src/operation-catalog.mjs)、[entry events](../../../src/entry-events.mjs)、[event state](../../../src/event-state.mjs)已有 P04 接线 | 内部 operation 全部可以公开，或已有完整外部客户端授权 |
| [HTTP](../../../src/http.mjs)的 `/mcp` 与 API/WebUI 共用 server；HttpEntry.close 设置 closing，后续 listen 被拒绝 | close 是单个逻辑入口开关，或同一实例 close 后可重新 start |
| [components](../../../src/components.mjs)已有 BabelDOC 专用安装、检查及 restartRequired | 任意插件的通用交付；磁盘 installed 等于当前 host 已 active/ready |
| [tasks](../../../src/tasks.mjs)、[export](../../../src/export.mjs)已有受理、冻结快照、任务与恢复基础 | 已存在通用 plan/instance/run、冻结术语版本或本 RFC 的统一受理事务 |
| [Windows 打包](../../../scripts/build-distribution.mjs)生成 ivoraige.cmd，调用随包 runtime/node.exe | 单一独立 ivoraige.exe、原生壳或安装器已交付 |

### 首版只交付三个闭环

1. **唯一宿主与可重试退出**：托盘、WebUI、serve、CLI 与 stdio 使用同一数据域 owner；退出超时仍能查询和重试。
2. **PDF 安装与恢复**：受控包安装、重启激活、真实 ready、升级后精确版本恢复或明确阻塞；各界面展示同一事实。
3. **单文本受理**：持久保存输入、幂等提交、冻结有效非秘密配置、查询进度与显式恢复，复用现有 Records/Tasks/jobs。

完整工作流、任意插件热更新、多版本同时运行、导入续传和新调度器都不是首版门槛。下面的通用 plan/instance/run 保留为后续扩展边界，不能反过来阻塞托盘、安装和单文本切片。

## 共用约定与所有权

### 接口版本、请求与响应

建议四接口分别协商 major/minor，草案示例使用 `HostControl@1` 等占位标识；不修改内核 API_VERSION、既有 `external.v1`、插件版本或数据 schema。major 不兼容须在副作用前拒绝；minor 只增可选能力，未知请求字段按 schema 拒绝，不能悄悄忽略改变行为的参数。状态响应可添加字段，客户端须容忍未知字段；未知状态不能显示为 ready。真正启用的版本随实现 PR 固定。

调用包含 `interfaceVersion`、`requestId`（仅诊断）、动作及参数；已连接宿主的写操作另带 `expectedGeneration`；修改可变目标时带 `expectedRevision` 等并发条件，运行受理则使用选择器中的确切修订。start/attach 响应给出当前 host incarnation 的 generation 与支持的接口版本；两个客户端 attach 同一 host 得到同一 generation，连接或订阅本身不换代。setEnabled 用 expectedRevision，install 用 expectedCatalogRevision；drain/exit/cancel 是同目标幂等动作，不要求状态 revision，但每次复查 generation、归属和权限。下文方法签名省略这些共用字段。可信 principal/grant 由控制通道或入口认证产生，与用户参数分开，不能通过 JSON 自报 owner。`stateRevision` 沿用 P04 权威提交边界，作用域和 generation 不同的数字不可比较。

成功响应分为完成结果或 `{ accepted: true, operationId }`；后者只证明受理，必须查询权威状态确认完成。任务型操作复用 jobs/tasks 的状态查询、取消和错误投影，不新增独立任务内核。状态查询返回 generation、revision、状态及安全 reason/recovery；跨进程传递数据引用，不传 Cordis Context、Service、disposer、任意路径或密钥。订阅按[既有同步边界](contracts.md#状态快照与订阅的同步边界)握手、快照、失效重取；断线视图标记未同步。

| 冲突/故障 | 建议机器结果与恢复 |
| --- | --- |
| 参数/未知请求字段 | INVALID_ARGUMENT；调用者修正，不开始副作用 |
| 无效/撤销身份；有身份但无权限 | 外部边界沿用 AUTHENTICATION_REQUIRED / PERMISSION_DENIED；不泄露未授权对象，旧内核错误映射见[协议附录](external-protocol.md#外部错误映射) |
| 旧 generation/revision、并发修改、同键异请求 | CONFLICT，安全 reason 与重取指引；不能静默改用新目标 |
| 接口不兼容、未就绪、正 drain、缺资产 | PRECONDITION_FAILED 或既有 COMPONENT_MISSING，明确受影响能力；不自动换引擎 |
| 获准对象不存在、内部/上游失败 | 保留 NOT_FOUND / INTERNAL / UPSTREAM_FAILURE 含义；公开诊断脱敏，私有 cause 留在宿主 |

错误不等于无副作用：若已获得 operationId/runId，先查原操作；传输超时或进程崩溃导致结果未知时，不盲目重发。新增 reason 是本 RFC 建议，不向旧内核擅自增加顶层错误码。

### 数据域、状态权威与修订

`dataDomainRef` 与幂等域中的 `hostDataDomain` 指向同一持久数据域标识，绑定规范化后的实际 store 身份及其 owner 配置；不以端口、进程、调用入口或 settings 路径另分一份数据域。同一 store 的路径别名须归一；同一 store 搭配不同 settings-dir、组件根或显式 pdf-config 时，先核对已有域配置，冲突就拒绝 attach/start，不能以另一个配置身份抢占同一数据库。配置调整由 owner 显式执行，并记录是否需重启。路径和文件身份用于识别存储位置，不直接充当可随搬迁变化的数据域 ID。

域 ID 存在 store 内还不足以识别副本。统一 bootstrap 负责 store 内域元数据和 store 外的本机登记；所有 launch/serve/CLI/stdio 启动路径使用同一登记实现，托盘、WebUI 和 ComponentManager 不另写一份。本机登记按当前 OS 用户存放在独立的 `ivoraige-host/domains.json`：Windows 使用 `%LOCALAPPDATA%`（缺省为用户的 `AppData/Local`），macOS 使用 `~/Library/Application Support`，Linux 使用 `$XDG_STATE_HOME`（缺省为 `~/.local/state`）。此根不随 `--data-dir`、`IVORAIGE_DATA_DIR`、settings-dir 或组件根改变，不包含在普通数据域导出/复制中；仅当前 OS 用户可读写，不保存凭据。登记关联域 ID、本机登记身份、规范 store 位置、平台可取得的文件身份及 owner 配置绑定；文件身份不能确认时不猜测相同。此登记只负责本机识别，不能代替 store 独占锁或活跃 owner 握手。

检查在受理业务和 attach 前完成，不能只信复制来的 instance.json。初始化和变更在 store 独占锁与登记写锁保护下执行，所有入口使用相同锁顺序；登记文件原子替换。store 与登记是两个持久边界，实现须先保存可恢复的登记意图，再提交 store 域元数据并完成登记；崩溃后只续接能与该 store 身份精确对应的未完成操作，不因部分成功重新生成 ID。业务受理须等两边一致。

- **新库或无域 ID 的存量 store**：确认元数据确实缺席、版本可识别且登记没有冲突后，静默生成一次域 ID 并登记，不弹出“迁移/副本”选择。保留原 Records、修订、任务、快照及 owner 归属，不补造历史幂等结果。登记文件尚不存在时可为这次初始登记创建；并发首次启动只产生一个 ID。
- **已有域 ID 且登记匹配**：同一文件的路径别名归一后正常启动/attach。已有域 ID 却没有本机登记、位置/文件身份变化、owner 配置不符或同 ID 指向不同 store 时停止业务受理；元数据无法读取/版本未知不等于“无 ID”，不得静默初始化。
- **登记丢失或损坏**：已有 ID 的 store 按身份待核实处理，不自动重建成“已匹配”；登记损坏、不可读或不可写均保留原文件并给出诊断，不清空覆盖，也不影响其他记录的内容。可在旧 owner 安全退出后，从可信备份恢复并重新核对，或由本地 owner 显式重建目标登记；修复没有依据时仍保持阻塞。单纯 settings/组件配置冲突应先恢复匹配配置或走 owner 配置变更，不能借“副本”绕开同一 store 的锁。

需要重新确认存储身份时，本地 owner 明确选择：

- **迁移**：确认旧 owner 已退出、原位置不再作为活动域使用，再转移登记；保留域 ID、历史记录及幂等结果，重新建立本机会话。无法证明旧 owner 安全退出时不自动接管。
- **副本**：为副本分配新域 ID，保留内容、修订、任务/快照及来源关系；原域幂等记录只作为历史，不参与副本受理查重；不继承原域活跃会话、客户端授权或自动恢复未完成任务，owner 显式认领后再按恢复规则操作。

**无交互启动采用拒绝路径**：普通 `serve`、一次性 CLI 和 stdio 桥遇到上述待确认情况，返回非零退出码及可诊断的 CONFLICT/PRECONDITION_FAILED（reason 区分登记缺失、冲突或损坏），不读 stdin 等待、不自动开浏览器、不启动业务 owner 或调用模型，也不自动选择迁移/副本。诊断在本地 stderr/既有结构化错误边界提供目标 store、登记位置和恢复步骤，stdio stdout 仍只用于协议。首版须提供不依赖业务 host/WebUI 的本机 owner 恢复子命令：显式选定目标、迁移或副本意图，核对诊断中的原登记条件并重新检查锁/旧 owner 后提交；缺失/损坏登记的修复须显式确认，不允许无条件覆盖其他域。具体命令名/schema 随 A 实现 PR 固定，本文不提供伪称可执行的命令。完成恢复后重新运行原启动命令；没有安全退出依据时继续拒绝，不能用强制参数抢占活跃库。

验收覆盖无 ID 存量升级、登记写入中断、缺失/损坏/权限错误、无交互拒绝与显式恢复，以及同机改路径/文件替换、复制到另一目录、首次带入另一台机器及两份同时出现。整机克隆连本机登记也可能相同；首版不承诺离线识别任意位级克隆或提供跨机器锁，备份恢复/克隆必须显式走迁移或副本流程，不能把这项能力写成由 UUID 自动保障。

| 权威对象 | 写入者、恢复来源与派生投影 |
| --- | --- |
| 数据域及本地 owner | 统一 bootstrap 在 store/登记锁内维护 store 域元数据及 OS 用户本机登记；从一致登记或可核实的未完成登记恢复。旧 Records、任务和产物归该可信本地 owner，保留原 ID，不按访问者认领 |
| host 生命周期 | 唯一 host 控制服务；实例发现记录用于定位，锁与实例握手共同确认存活，记录/PID 单独不能证明 owner。重启创建新 incarnation |
| 入口 enabled 与 entryRevision | owner 管理操作写现有受控配置，持久化成功后递增，跨重启延续；路由状态、地址由运行中入口投影，不能反写为期望配置 |
| catalogRevision | 对已验证的目录 manifest 规范内容计算摘要，连同来源保留为此次 inspect 快照；远端无版本号时也不能用本地计数冒充。install 固定该快照并复核，变化返回冲突 |
| 包安装、选择与实际装配 | 首版 ComponentManager 的安装清单为唯一磁盘权威，原子提交并恢复；active 来自当前 host 实际解析的包/配置，ready 来自能力探针。未来采用 DSH inventory 时显式迁移权威，不能双写两套安装状态 |
| 运行、task、job 与引用 | Records 持久受理记录/输入/快照/任务及版本引用为恢复来源；Tasks 调度并维护 runId→taskId 映射，进程内 jobId 是一次执行尝试，不是持久队列或第二运行身份 |
| P04 stateRevision | 既有 event bridge 的 generation 内提交序号，仅作快照/barrier 同步；不要求跨重启递增，不代替 entryRevision、catalogRevision、配置修订或记录修订 |

host generation 应复用该 incarnation 的 P04 bridge generation 或提供固定的一对一映射，不能另造彼此独立的权威换代时钟。首版公开接口只保留 generation 作为 incarnation 身份，不再返回等价的 hostInstanceId；进程 PID/启动诊断标识若保留，仅用于定位而不参与并发校验。管理端和业务端的投影都保留各自 scope；旧 generation 的句柄必须失效。

### Cordis 生命周期映射

| 边界 | owner 与装配职责 | 撤销/释放顺序 |
| --- | --- | --- |
| HostControl | bootstrap 的最小 start/attach 负责找到唯一 host；host 内控制服务使用现有锁、tasks 和 storage 生命周期。控制客户端不拥有数据库 | 拒绝新受理 → drain → dispose 消费者/worker/存储 → 释放锁；客户端关闭只释放自身连接 |
| EntryControl | 入口插件拥有路由、会话、在途调用和授权投影；共享 HttpEntry 拥有监听器。operations 与授权服务为所需依赖 | 先关闭该入口接单，再收尾其会话/调用并撤销贡献；只有 host/共享 transport owner 可关监听器 |
| PluginDelivery | 交付服务拥有安装暂存、清单恢复和安装 jobs；AppBoot/Loader 与 Cordis 拥有实际装配 | 安装事务提交与激活分离；插件依赖失活时撤销能力/监听，先处理持有者再释放资源 |
| RunAdmission | 领域服务拥有有效定义、受理记录、引用和任务映射；调度仍属 tasks/DSH jobs | 停新受理/新片段 → 暂停或取消可处理任务 → 持久化结果 → 释放 lease，最后撤销服务 |

在固定运行时上通过 `inject` 声明依赖，通过 effect/disposer 持有监听、路由和资源；具体语法由 bridge 与基线探针确认。必要存储/owner 依赖失败时不得报告 host ready，也不得受理业务；最小 bootstrap 诊断入口不依赖完整业务装配。可选 PDF/模型服务缺席仅使依赖能力 unavailable，诊断/修复入口仍可用，host 是否另设 degraded 枚举留给实现。`inject` 不是鉴权或恶意插件沙箱；不得只依赖一次 ctx.emit 获得事务性。四接口稳定的数据边界不暴露 RC/Fiber 内部类型，未来迁移只在组合根/适配层收口。

## HostControl

最小动作：`start(dataDomainRef)`、`attach(dataDomainRef)`、`state()`、`drain(expectedGeneration, deadline)`、`exit(expectedGeneration, deadline)`，以及 owner 明确选择的强制退出动作（不由超时自动触发）。dataDomainRef 是本机配置选定的数据域引用，不允许远端调用者提交任意数据库路径。

| 动作/状态 | 请求与响应语义 |
| --- | --- |
| start / attach | start 取得锁后才装配；发现已运行 owner 则 attach，竞争失败者重查而非创建第二 SQLite owner。attach 只连接，不自动启动；不存在返回 NOT_FOUND，锁存在但 owner 状态未知返回可诊断冲突，不删锁抢占 |
| state | 返回 generation、starting/ready/draining/stopping/failed 状态和阻塞原因；客户端连接失败只能报告 disconnected/unknown，不能据此断言 stopped。stopped 由可信启动控制器确认退出后报告 |
| drain | 原子关闭新任务、安装、运行及后续片段受理；已受理工作按种类完成、暂停或取消，报告残留 task/operation 与 deadline。drain 完成是可安全退出，不是进程已退出 |
| exit | 内含 drain；只有全部必要清理完成才关库、释放锁并退出。超时返回未完成和可恢复诊断，保持 owner，不伪报成功。重复 exit 加入同一收尾操作；失败后重试只推进未完成阶段，不复用已销毁对象 |

窗口关闭仅断开/销毁 UI，按[桌面约定](../../plan/0.1.x/desktop.md#用户动作与故障语义)处理草稿，不能调用 exit；托盘退出显式调用 HostControl。attach 不改变 generation；只有 host 重启换代后才拒绝旧 host 的句柄。首版不承诺撤销 drain 或同一已 dispose 对象重启：重新启动必须创建新 host generation，并重新确认旧 owner 已退出。

### 启动路径和退出顺序

现状是 launch 写 instance.json，而 serve、mcp --stdio 和本地 CLI 还可直接 createApp 持锁；这不是已经统一的 HostControl。目标让所有可持锁路径先经过同一 bootstrap：已有 owner 时 attach，缺席时只有获准的启动路径能创建 owner 并登记；一次性 CLI 保留等待/最终退出语义，但只能释放自己创建的临时 owner，不能退出 attach 的常驻 host。首版明确区分临时与常驻生命周期：一次性 CLI 自建的临时 owner 不接受托盘、WebUI 或 stdio 的常驻 attach，也不因请求到来自动转为常驻；返回可诊断的 temporary-owner 冲突，提示 CLI 完成并退出后重新 start，不能并起第二 owner。CLI 结束后按相同 drain/exit 边界收尾；超时保留受保护的诊断/退出通道和锁，不能因 CLI 已结束就丢弃未完成工作。CLI attach 已有常驻 host 则只关闭自己的会话。stdio MCP 改为连接此常驻 owner 的受限客户端桥，断开只释放其会话；在该迁移完成前显示不受 EntryControl 管理，不能宣称托盘已经能控制独立 stdio 进程。

正常退出的顺序必须是：关闭新业务受理 → 保留 owner 管理查询/退出通道和实例记录 → 按 task kind 收尾、提交 checkpoint/安装事务 → 关闭 worker/业务消费者和存储 → 撤销管理通道/实例记录并释放锁 → 确认退出。共享 HTTP 不能在 drain 前整体 close；若管理走独立 IPC，也必须到最后保持可达。deadline 经控制层、operation 层、Tasks/worker 传递同一剩余预算，不能每层重置或被固定 30 秒覆盖。超时仍可查询残留工作并用新 deadline 继续等待/重试，不重新开放业务。

强制退出须展示未完成工作和未知上游执行风险，明确确认后只终止本实例拥有的 worker/host；不提前释放仍被活进程使用的 store 锁。重启按 interrupted/paused/failed 规则恢复，不静默重发模型调用。必要清理失败不能以移除 instance.json 冒充退出成功。原生托盘/启动控制器可执行 exit 后 start；纯 WebUI/serve 首版接受明确提示手动重新运行启动命令，不承诺 host 自我重启。

## EntryControl

最小动作：`list/state(entryId)`、`setEnabled(entryId, enabled, expectedGeneration, expectedRevision)`。entryId 表示入站 MCP 或入站 OpenAI 兼容逻辑入口，不是 Cordis Loader entry；开关仅改变该入口的路由/会话受理，不加载、卸载或启停底层插件。上游模型/provider 连接配置仍归模型设置，不能用入口开关替代。

建议状态分开表示：期望 `enabled`；实际 `disabled / starting / ready / draining / unavailable / failed`；运行时返回实际 transport 和 address。HTTP 地址只能来自成功绑定的监听器及已注册且就绪的路由，未知用 null 和 reason；完成桥接后的 stdio MCP 无 URL，展示 transport=stdio 和经过脱敏的连接方式，不编造端口；其开关只控制本域桥接接入/会话，不管理客户端进程。状态与复制操作不带 token、模型 key 或秘密参数。

启用时依次核查权限、host 状态、插件与所需能力、统一授权接线，再注册入口并报告 ready。禁用时先阻止该入口新会话/新调用，再关闭订阅与 transport 会话，在途请求按其既定取消政策收尾；已提交领域任务仍由任务服务拥有，禁用入口不是“取消所有任务”。无法在 deadline 内收尾时保留 draining 和阻塞原因，不能提前报 disabled。并发开关以 revision 串行化；重复相同期望值无额外副作用，过期 revision 仍返回 CONFLICT。

**HTTP-MCP 禁用不能调用共享 HttpEntry.close()，不能停止 WebUI、共享 HTTP listener 或 host；OpenAI 入口同理。** 重新启用必须建立新的入口会话/路由贡献，不能复用已终结的 transport。首个实现需证明这一边界；当前不可重启的 close 行为不是该接口的实现。

控制权限只授予可信本机 owner 或明确的管理权限；持有外部翻译令牌不能启停入口。实际业务请求使用[单机客户端授权](contracts.md#单机客户端授权)的同一 principal/grant、scope、资源归属和撤销检查，覆盖 HTTP、HTTP-MCP、受限 stdio 与薄适配；保留 Host/Origin 约束。启用开关不签发授权，不公开所有 P04 操作，也不留下旧匿名入口旁路。OpenAI 方案发现继续只返回获准发布方案。

### 首次启用、身份与旧入口迁移

首次安装及从匿名版本升级时，MCP/外部入口缺少显式已授权配置一律默认关闭，不把旧版默认开放推断为授权。owner 设置的 enabled 和 entryRevision 持久保存；`--no-mcp` 是本次启动的最高优先级关闭约束，不擦除保存值，UI 同时显示保存期望与本次阻断原因，不能通过菜单绕过。尚未实现的 OpenAI 入口显示 unavailable/未实现、不可开启和空地址；托盘不用等待整个 I01.callable 就能交付。

| 调用者 | 首版允许的边界 |
| --- | --- |
| 可信本地 owner | 经 OS 受控 IPC 或 bootstrap 配对建立的 owner 会话，才能启停入口、安装/修复包、退出、迁移与恢复；WebUI 通过同源受保护会话承接该身份 |
| 业务客户端 principal/grant | 仅可调用获准的业务操作、查看/取消自己的获准运行；业务令牌不能安装组件或取得 owner 权限；resume 另见运行恢复规则 |
| 匿名网页、普通 MCP 或未配对 WebUI | 不得调用管理动作、订阅全局事件或下载他人产物。loopback、Host/Origin 合法与 JSON 自报 owner 都不能替代身份 |

**本地管理页的 owner 会话是 A 的前置，不等待 I01.shared 完整交付，也不以是否启用外部接入为条件。** 普通用户安装 PDF 前同样需要 owner 身份，但受信启动器可以完成交接，无需先配置业务客户端令牌。首版采用本机 bootstrap 换取 WebUI 会话的最小路径：

1. launch/托盘通过 OS 权限保护的本地控制通道向常驻 host 取得短时、单次、绑定数据域与 generation 的 bootstrap 凭证，然后打开本机 WebUI。serve 无启动器时由受信本地终端取得同类一次性链接；不能让匿名 HTTP 请求自行签发凭证，也不能仅凭 loopback 或“第一个访问者”认定 owner。
2. 链接仅将一次性凭证放在 URL fragment，页面先清除地址栏历史中的 fragment，再向同源交换端点 POST；凭证不进入 query、日志、Referer、剪贴板连接地址或第三方资源。交换须校验 Host/Origin、有效期、单次消费、域与 generation，原子消费后建立受保护的 HttpOnly/SameSite 会话；HTTPS 时使用 Secure，并保留写操作 CSRF 防护。长期 owner 凭证不放 URL 或浏览器可读存储。
3. 无凭证直接打开的网页仅能显示未配对状态和取得本地授权的指引，不能安装/退出/读取私有事件或产物。过期、重放、错误域/generation、跨源交换均拒绝；host 重启或 owner 撤销使旧会话失效，受信启动入口可重新交接。

这是一条待实现的首版路径，不要求先做完整账号系统；OS 通道细节与会话 schema 随实现验证。临时 CLI owner 不签发常驻浏览器会话。**管理页上线前**先收口现有 component_install、组件 HTTP 管理、内部通用 operation 的管理动作、匿名 /mcp、/api/events 和产物读取；I01.shared 开放外部业务前再补齐主体隔离、scope/配额及撤销门禁：关闭旧旁路或接入同一 owner/业务授权检查，含查询、订阅快照、后续事件和断线重连。存量数据仅本地 owner 可见；新外部运行归已认证主体，owner 可管理恢复不意味着普通 WebUI 会话自动看见全部数据。跨主体共享只经显式授权；未通过门禁就不能开放新外部入口。身份迁移保持旧 ID 和数据，不把未知历史作者写成某个外部客户端。

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

安装提交与 host drain 共用受理边界：drain 后拒绝新安装，已提交/提交中的安装按其恢复事务收尾。目标安装幂等按包身份和摘要返回同一未完成安装 operationId；现状仍是有安装运行就 CONFLICT，不能据此宣称已实现合并。不同目标返回明确忙碌/冲突和原操作查询，不新建无限安装队列；任务持有旧版本时不删除其文件。失败清理仅针对本次暂存，不能删用户数据、旧输出或正在使用的资源。

首版 PDF 管理页须能发现官方包、检查兼容、发起安装、显示进度/失败/恢复动作和重启提示，并在新 host 实际 ready 后允许使用 PDF 能力。现有 BabelDOC 专用 ComponentManager 可作为首个适配路径，**不能冒充任意 PDF 引擎或通用 PluginDelivery 已完成**。P05 的通用性及 P08 的独立发行闭包须由另一个真实包和实际归档分别证明；管理页安装目标不能用开发机 setup 脚本或仅添加 manifest 替代。

### 首版 PDF 的身份、就绪与版本保留

首版包是 BabelDOC 侧车及运行时/资产，PDF adapter 仍内置于宿主，不能当成可由 Loader 热装卸的 Cordis 插件。hostApiRange 表示该组件与宿主 PDF bridge 的兼容范围；所需服务是 adapter 依赖的宿主服务/侧车能力。未来真正 Cordis 包另核对应 DSH 的 peerDependencies 规则，不假设固定 pin 已采用 engines.dsh。

精确执行身份至少包含：组件 packageId/version/内容摘要和 manifest 来源、内置 adapter 版本、实际 BabelDOC/依赖引擎版本、binding schema、sidecar 协议及所需能力集合。版本来自校验后的清单与可核验的实际装载内容，运行能力由握手/探测核对，来源不一致即不可用；硬编码 adapter 0.1.0 或协议数字 1 不能证明包未变化或具备新增语言路由。缺少证据记 unknown 并阻塞需要该能力的恢复，不填当前值冒充历史。

现有 protocolVersion=1 握手已返回 parse/rebuild 能力，但未返回实际 BabelDOC 版本和语言路由等细分能力；协议数字、内置 adapter 版本和粗粒度能力均不足以证明它们。实现可采用经验证的可选握手字段/独立探测，或将受控包清单绑定到经校验的实际内容作为身份来源，不能只信自报版本。新增可选结果字段不预设必须 bump 协议；保持 v1 需证明旧 host 忽略扩展、新 host 遇旧 sidecar 缺字段时仅开放有证据的既有能力，缺失证据不得伪报 ready。若改变必需字段、方法或既有语义而不兼容，才另定协议版本并做显式兼容/拒绝映射。旧/新两端组合与未知字段测试见[协议 §7](../v2.0/03_API-protocol_v2.0.md#71-握手与方法)的待实现扩展门禁；本 RFC 不修改现有版本号。

启动时主动进行有界的文件/配置、进程握手、协议/能力及必需资产检查，不等第一次导入/导出才从 unchecked 推测 ready；探针短暂进程及时退出，不初始化 GPU，不调用翻译模型或以昂贵 GPU 工作冒充状态查询。安装成功显示“已安装，待重启并验证”；旧版仍工作时同时显示 installedVersion、activeVersion 和旧版 ready。重启后探针通过才显示“可用”，失败显示保留的安装状态和具体修复动作，托盘/WebUI 使用同一投影。若显式 `--pdf-config` 覆盖安装指针，activeSource 必须标识该配置，安装不会覆盖它；只有解除覆盖或显式切换后才评估新包激活，不能一直提示“重启后必然可用”。

持久引用由已受理的 task/run/导出快照持有，并记录所需的精确组件内容；暂停、失败但仍可恢复和 host 重启都不释放它。启动在清理前重建引用，运行中的短期 lease 另防止在用资源撤销；终态及明确放弃按既有保留策略释放，历史快照仍有引用则继续保护。同版本修复也不得原地替换/删除被引用目录，应暂存为新的内容身份；不能安全替换时阻塞修复。清理缺乏可靠引用证据时保守拒绝，不把引用保护仅做成进程内计数。

首版只有一个 active 组件组合，不承诺旧新版并行或自动降级。**首版必验收的是“当前精确匹配则恢复，否则明确阻塞”，切回旧包不作为必交功能。** 对可恢复任务，若当前 active 精确匹配且 ready 则继续；若不匹配，显示所需/实际版本、摘要、能力差异和可用动作，重复 resume/重启均不能绕过阻塞。尚无切回实现时明确显示“当前不支持恢复旧包”，用户仍可选择取消/保留待恢复，或用新版新建运行，不静默换版或重写旧快照。

若某个交付版本另提供切回旧包，则该路径必须经兼容与数据安全校验、owner 显式选择、重启和 ready 复核，并以同一冻结快照零翻译导出证明精确恢复；旧包缺失、不兼容或切回失败须保留阻塞。此为提供恢复功能时的条件验收，不以目录尚存冒充执行能力。现有禁止降级的安装接口不能冒充这条恢复路径。PDF 文档的模型翻译循环不调用 PDF 侧车；精确侧车恢复重点是导出/回放，不能因升级无条件阻断不依赖它的文本翻译。导入仍不可续传。

安装和任务首版共享现有单执行槽（当前 maxConcurrentJobsPerOwner=1、Tasks 串行）。安装请求遇忙可明确返回忙碌，已受理任务可有界排队；显示等待对象/原因、取消和 deadline，不要求新调度器，也不再承诺无关业务永不等待。安装不得破坏已有任务、数据或关闭无关能力，二者与执行时段互斥须区别表达。

### 真实安装与发布门槛

2026-11-05 查询仓库 Releases 为空；源码默认的 v0.1.0-dev.0 不能用作有效下载承诺，已撤下的旧附件也不能恢复为本轮交付。P05/P08 实施前须提供可重复取得的受控官方候选包及 manifest、摘要、版本/平台/许可与源码构建来源，管理页发现的来源与实际验收包一致。没有可取得包时明确“安装验收受阻”，不以 fixture 或开发机 setup 代替。

首个 PDF 安装证据针对真实 Windows 环境：在无开发目录的干净 npm tarball/实际应用发行入口安装主体，通过管理页安装候选 PDF 包，重启并验证 ready、真实导入和同一冻结快照零翻译导出；覆盖下载断开、摘要/能力不符、磁盘失败、安装/激活中断、覆盖配置、升级后暂停任务及旧包缺失。现有 Windows 历史证据不等于本次已验证，Linux/macOS 和独立 exe 各需真实产物证据，不能由 Windows 或 cmd + node.exe 推定。

## RunAdmission

最小动作：`admit(selection, inputs, allowedOverrides, idempotencyKey?)`、`get(runId)`、`cancel(runId)`；首版显式恢复沿用 owner 的 task resume 操作，后续对外 resume 必须另声明 scope/schema，不能借 get/admit 隐式恢复。它们是既有业务操作的受理边界，不强制普通单操作先建项目或工作流。

- **plan**：本文沿用[可调用方案的发布投影](workflows.md#可调用方案与集中管理)，发布引用具体 WorkflowInstance 修订；从模板发布必须先实例化并保存，项目关联可为空，不能直接发布 TemplateVersion。RunDefinition 仍引用该实例修订，不新增一套工作流 schema。外部请求只能选择获准 plan/revision。owner 在工作台可选择明确的 instanceRevision；两种选择互斥，不能混用参数绕过发布约束。
- **instance**：可编辑的 WorkflowInstance，绑定资源与参数且可不关联项目。修改产生新修订，不改变已受理运行。
- **run**：一次受理的 RunDefinition 与可变 RunState、任务映射。冻结有效定义，不冻结执行状态；人工步骤只冻结已知事实，后续决定追加 ExecutionSegment，不能把未来结果伪装成初始已知输入。

### 单文本先行切片

单文本切片归 [**W02.admission-text@1**](../../plan/0.1.x/packages/workflows.md#w02-admission-text)（W02 的子交付，不新增顶层工作包，验证 ID 为 [W-V02.admission-text](../../plan/0.1.x/validation/workflows.md#w-v02-admission-text)）：基于已验证的 Records/Tasks/P04 与现有 TXT/翻译接点，持久保存文本输入、目标语言、有效配置及 run/task 映射。U01 提供用户入口，I01.shared 接主体/幂等/限额；第一步可由本地 owner 验收，不等待 W02 全部模板/项目 UI、I01.callable 或 U03.terms。术语仅允许明确 none，非空约束必须在 U03.terms@1 到位后才接受，不能忽略。文件导入、文档流水线和入站 OpenAI 另按原工作包门禁启用。

单文本受理记录沿用现有持久任务记录的版本化扩展，不另造持久任务系统；输入与配置先可恢复提交再派发。后续映射为 RunDefinition 时保留既有 runId/taskId、输入与冻结事实；未曾存在的 WorkflowInstance/plan 修订保持缺席，不能给历史补造模板来源。下节方案选择和拓扑检查仅适用于后续通用运行，单文本使用显式的内置文本操作版本。

### 受理时序与冻结内容

1. 验证身份、权限、输入 schema、资源归属及单次载荷上限；按既有[跨协议幂等](external-protocol.md#跨协议幂等)查首次记录。幂等重试也须重新核查授权，不能因找到键就返回未获准结果；合法同键重试返回首次运行，不重占新运行配额，也不因新运行限额已满而拒绝。
2. 解析确切 plan 修订及其绑定的 WorkflowInstance 修订，或 owner 直接选择的实例修订，按声明顺序合并默认、实例配置与允许 overrides；校验拓扑、输入类型与来源版本、所需能力及副作用用途。先形成可展示的有效配置再执行，不临时修改全局模型设置。预检结果不是预留，提交前需复核修订和能力。
3. 在唯一 host 的受理提交边界复核 generation、drain、授权及配置/插件版本；受理与授权撤销、drain 进入须有一致的先后顺序，先撤销/关闭受理则拒绝提交，先受理则按后续取消规则处理。仅首次受理检查新运行并发/速率限额，并在提交时重新查键，原子登记幂等键、有效定义、输入/版本引用、限流预留和 runId；任务入队用同事务或可恢复的持久交接，崩溃不能留下无运行的扣额、无引用快照或重排两次任务。响应 accepted 只在可恢复提交后发出，未提交不调用模型。
4. 调度前重新验证当前授权及已冻结版本可用，获取/确认执行 lease；只有能证明实际调用配置与冻结值一致才执行；按下述 DSH 首版门禁准备调用，不接受后来改变的全局默认。提供者失活、资源不兼容时明确阻塞/失败，不换模型、插件或输入。恢复也不得偷偷采用新版本；改配置须派生新运行。

通用 RunDefinition 最小保存：确切 WorkflowInstance 修订、来源 plan 修订（仅通过方案受理时记录）、确切输入资源/修订、归一化规则版本及有效非秘密配置、模型/连接引用及其配置修订、适用术语库/义项与抽取配置的有效版本、实际能力/插件/引擎/binding 版本、执行策略、principal/grant 引用。术语范围先于优先级，版本变更重新判断复用适用性；不是只记录一个插件名称。没有术语的运行明确空约束，不能用“当前库”补历史。

单文本和通用运行都必须冻结实际有效的非秘密值：provider/model、API 类型、endpoint/baseURL、compat、请求参数/超时、有效提示/语言/约束、来源/版本及 credentialRef；配置修订只做溯源，粗粒度 llm-pi-ai revision 变化或修改无关 provider 不自动阻塞。不能只存一个可变引用然后执行时读全局当前值。

密钥只存受控 credentialRef，执行时仍由 DSH 解析，不进入快照/模板/日志。密钥轮换可在同一获准 provider/端点/用途下解析新秘密；引用缺失、用途改变或冻结配置已无法通过当前能力兼容检查则停止。适配层须证明实际 DSH 调用使用冻结值；不能通过临时切换全局 provider 配置实现并发隔离，也不能把内存中的准备对象当成可持久恢复的配置。**冻结配置不冻结权限**：每次调用、调度、新片段与重连读当前 grant；撤销拒绝后续动作、关闭相关流并请求取消在途任务，按 best-effort 记录已发出供应商调用的未知结果，不声称能撤回费用或实现 exactly-once。结果继续按主体保护。

幂等域、摘要规范及期限完全沿用协议附录：`(hostDataDomain, principalId, operationKind, key)`，不按 transport/grantId 分桶；同键同业务输入返回首次 runId，同键异内容返回 CONFLICT。并发最多提交一个运行；省略方案修订的重试保持首次解析值。幂等记录跨重启，至少保留至终态后 24 小时，按既有 idempotencyExpiresAt 对外说明；无键或记录过期不能自动安全重试。运行冻结与导出 ExportSnapshot 各有职责：导出仍在其受理时冻结可输出的数据，输出端只消费快照，绝不翻译。

### 固定 DSH 下的冻结执行门禁

固定 pin `639ed015` 的 [GenerateOptions](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/llm/llm/src/types.ts#L511) 提供 provider/model 路由，但没有按调用传入 baseURL/compat 的字段；llm-pi-ai 的 [stream/prepareCall](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/llm/llm-pi-ai/src/adapter.ts#L318-L348) 从调用时 current() 取配置，prepareCall 只能固定本进程这次准备的调用；公共接口还是 [one-shot](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/llm/llm/src/index.ts#L928-L982)，不能直接序列化后跨重启重建，也不能复用作整段多次调用的运行句柄。这是当前公共接口的静态能力边界，不证明当前 pin 上所有适配方案均不可行，更不是已经通过的恢复测试。首版不以升级 DSH、维护私有分叉或重写模型服务为前置，采用以下保守契约：

- 冻结有效值用于执行一致性校验，不承诺任意历史配置可在当前环境继续执行。能按调用传入的 model/参数使用冻结值；依赖全局 current() 的 endpoint/API/compat 等，在每次准备调用前与所需冻结投影核对，不能仅比较整个设置 revision。无关 provider 变化不阻塞。
- 首版采用**应用侧配置协调边界内的前后核验，再消费同一个已准备调用**。固定 pin 的 PreparedAdapterCall 只公开 model 与 stream，不公开它捕获的 endpoint/compat，不能声称可以直接读回准备对象核验。协调只是现有设置/调用接线的薄层，继续由 DSH 解析配置、管理凭据和执行模型，不新增 provider 或复制一套解析规则。
  1. 进入当前 host 的准备临界区，读取实际传给该 DSH adapter 的完整有效配置来源，经同一 pinned resolver 得到所选 provider/model 的非秘密投影 A1，以及本进程协调序号。投影包含目录默认值、profile 合并和 model override 后的 endpoint/API/compat、credentialRef 等；只读用户覆盖或 UI 表单不充分。先比较冻结值，不一致即 config-mismatch；读取不完整或来源不能与当前 adapter 对应即 config-unverifiable。
  2. 在同一临界区以冻结的 model/请求参数调用真实 DSH prepareCall，随后重读同一有效来源及协调序号，得到 A2。仅当 A1、A2 都与冻结投影相等、序号与 adapter 实例未变且准备成功，才允许消费这一个 one-shot 调用。失败就丢弃准备结果，按 config-unverifiable 阻塞，零模型派发；不能改走普通 stream/generate 重新准备。
  3. 所有会改变该 adapter 实际配置的写入及重载/替换，必须先进入同一协调边界，覆盖 ModelSettings、DSH settings/config-editor、profile/Loader 更新和 adapter 重新注册；生效前后都受保护。协调序号在每次可能生效的变更开始前递增且在 host incarnation 内不复用，失败写入也不回退；重载/替换使旧准备结果失效。固定 pin 的 [settings revision](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/settings/settings/src/index.ts#L302-L337) 是 describe 观察到变化后递增的值，不能充当这个写入序号；前后值或 revision 相等不能排除 A→B→A。协调序号只验证本次准备窗口，不要求与受理时或重启前的数字相等。无法控制/观测的外部配置写入、原地对象修改或热重载路径须禁用在线生效、要求受控重启，或将受影响调用阻塞为 config-unverifiable，不能凭“两次读相同”宣称安全。
  4. 核验通过后仍须在临界区内绑定并开始消费该准备调用；开始消费指实际推进异步迭代器，仅调用 stream() 或取得 iterator 不算。保护释放点须由真实调用链的快照/晚读探针证明，已有兼容保护在证明前不得缩短。若流执行仍可能晚读可变配置/共享嵌套对象，就保持相关写入保护至调用结束或阻塞，不假定 prepareCall 名称本身提供深不可变保证。授权、drain 与 deadline 继续在派发边界核查；后续片段重新进入该流程。
- 上述有效来源和快照行为须核对 [llm-pi-ai profile 解析](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/llm/llm-pi-ai/src/index.ts#L149-L180)、[current 缓存](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/llm/llm-pi-ai/src/adapter.ts#L225-L242)和[注册更新](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/llm/llm-pi-ai/src/index.ts#L279-L316)；不能把 pi-ai 的快照语义推广到任意 adapter。其他 adapter 未证明同等边界时按 config-unverifiable 阻塞。凭据仍在消费时由 DSH 解析，允许的密钥轮换不属于冻结非秘密值的保证，也不能改变获准端点/用途。
- 暂停、排队后执行和重启恢复都重新准备并核验。endpoint/compat 等相关有效值不一致或无法核验时，保留 checkpoint/runId，返回可解释的 blocked/config-mismatch 或 config-unverifiable，禁止调用模型；明确展示所需/当前差异（脱敏），可恢复所需配置后再次显式 resume，或选择新配置新建运行。后者不等于重译。
- 首版允许编辑未来配置，但必须提示它可能阻塞已受理运行后续尚未准备的调用；不能写成“对既有运行完全无影响”。设置编辑锁只有在上述准备/比较竞态和阻塞恢复均验收后才可缩短或解除，旧执行路径仍保留必要保护。

W-V02.admission-text 必须给出真实 pinned DSH 证据：以配置 A 受理并暂停，修改相关配置为 B，销毁 host/准备对象后重启；resume 不调用 B 且报告阻塞，恢复 A 后仍用原 run/checkpoint 显式继续；另测无关 provider 修改、仅粗粒度 revision 变化、准备调用与配置写入竞态及未知配置。只做 mock、同进程 prepareCall 或只保存字段不能通过此门禁。将来若能直接从冻结值重建调用，必须另交跨重启在 B 全局配置下仍实际使用 A 的证据，再提升恢复承诺；运行时迁移仍遵守 ADR-0003，不自动升级。

### 恢复、存量任务、复用与排队

新运行只在冻结配置可执行时 resume；固定 pin 首版遵守上述“不一致即阻塞”语义，不能承诺改全局设置后旧运行一定可继续。对仍按单元读取全局配置的旧执行路径保留必要保护，不能先删锁后让新运行漂移。历史任务无冻结值时标为 legacy/config-unknown，保留旧 checkpoint 与实际已知来源；默认不自动恢复。owner 可明确选择兼容恢复：告知历史配置未知，把这次选定配置记录为后续执行段并重新核查授权/能力，而不是伪称整段历史被冻结；或派生新运行。不可证明旧版精确引用时同样标未知，不能补当前版本。

新建运行并不等于重译，默认保留按既有 content/方向/约束及适用性判定可复用的已接受译文；模型不是现有复用身份的一部分。要用新模型重新翻译已有内容，用户须明确选择重译范围/策略，产生新候选/修订，不覆盖旧接受版本。用新版重建 PDF 输出仍只消费冻结快照，绝不触发翻译。

程序重启将未完成运行按可恢复性暂停/失败；get 返回最后已提交 checkpoint、已知尝试、阻塞原因和可用动作。首版外部客户端查询/取消自己的运行，恢复需由可信 owner 经现有 task resume 入口明确执行，仍检查该运行当前 grant；没有对外 resume 不等于自动 resume。将来开放 resume 须补 scope 和负向测试。暂停运行不占执行槽，但按既有 C_host/C_principal 非终态额度继续计数，UI 显示原因并允许获准取消/放弃释放容量，不能重启清空额度或无限囤积暂停运行。

持久幂等只保证同一提交不创建两个运行，不保证模型 exactly-once。模型请求发送后、结果提交前崩溃时记录 outcome-unknown；恢复先核验可取得的上游证据，不能静默再发。无法确认时由用户明确选择继续等待、取消或承担可能重复调用的显式重试/新执行段，保留尝试关联与未知费用，不报零使用量。受理提交前、提交后尚未派发、调用后尚未落库这三个故障点分别验收。

沿用串行 Tasks 和共享执行槽；外部受理使用有界 C_host/C_principal/队列及请求 deadline，参数随首个实现固定。排队等待计入 deadline；满额未受理返回既有容量错误且不占幂等键。声明请求级取消策略的同步适配器（如 OpenAI）超时/断连时，按既有外部 API 政策提出取消；原生连接断开不抹去已受理任务，继续按 runId 查询或显式取消。到达已声明的执行 deadline 时，未启动的任务不得在期限后才调用模型，在途结果不确定则记录 stopping/unknown 并允许凭 runId 查询；不能伪报供应商调用已撤回，也不自动转为无限后台请求。单文本的输入持久化保证不涵盖当前只留内存、重启后失败的排队文件导入；旧导入 wire 保持兼容并明确其恢复限制。

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

完成后的状态示意为 `{ "generation": "g7", "entryRevision": 19, "stateRevision": 53, "entryId": "mcp-http", "enabled": false, "state": "disabled", "address": null }`；entryRevision 由 18 变为 19，P04 stateRevision 53 是独立示例；同一 host 的 WebUI 和已实现入口保持原状态。若返回 accepted/operationId，菜单继续显示 draining，直到查询确认完成。

PDF 闭环：启动控制器 start 得到 g7（或 attach 已有 g7）→ 插件页 install 官方 PDF 包得到安装 operationId → 磁盘完成时显示 installed、pendingRestart，尚无 activeVersion → 显式 host exit/drain 后重新 start 得到 g8 → 包装配和检查成功显示 active/ready 。单文本闭环可独立验收，不依赖 PDF 安装或方案发布。以下另展示后续通用方案的受理形态，不能作为首版单文本必须实现完整工作流的依据。示例中的 plan-demo/r3 已发布并绑定保存的 WorkflowInstance 修订 instance-demo/r2，受理时将两者记入 RunDefinition：

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

## 验收与实施顺序

下列均为待实施要求，不是本次通过的运行测试；证据回填[工作包索引](../../plan/0.1.x/work-packages.md)，子交付通过不能标记整个父工作包完成。

| 顺序 / 归属 | 最小可证实验收 |
| --- | --- |
| A：D01/D05、P04 | launch/serve/CLI/stdio 同域竞争仅一 owner；不同 data/settings/组件目录仍使用同一 OS 用户登记根；无 ID 存量 store 静默登记且保留原记录/任务身份，并发及写入中断重启不产生第二 ID；已有 ID 登记缺失/损坏/权限错误、路径别名/文件替换/配置冲突及迁移/副本分别验收，不清空登记或抢锁；无 TTY 的 serve/CLI/stdio 及时非零退出、无业务受理/模型调用且不污染协议 stdout，经显式本机恢复后才重试；临时 CLI owner 拒绝常驻 attach，结束仅收尾自己创建的 owner；两客户端 attach 常驻 host generation 相同、重启后旧句柄拒绝；关窗任务继续；drain 超时管理通道仍可查询和重试，强退不误杀/不早释锁；无托盘明确手动重启 |
| A：P04、D05、U02；外部另接 I01.shared | 未启用外部入口也须先通过本地 owner bootstrap 完成管理页安装；凭证过期/重放/跨源/错域/重启拒绝，旧会话失效；未配对 WebUI、匿名/业务令牌不能安装或退出；旧 component_install、HTTP、事件及产物无旁路；历史 owner 与新主体隔离；旧匿名配置升级默认关闭、保存 enabled/CLI 强制关闭优先级正确；MCP 关开不装卸 Loader 插件、不影响 WebUI，未实现 OpenAI 不可开启；entry/catalog/P04 修订不混用 |
| B：P05/P08、U02 | Windows 干净主体经管理页安装真实受控 PDF 候选包；清单/摘要/引擎/协议/能力匹配；断网、缺资产、磁盘失败和崩溃恢复不损坏旧包；installed/pendingRestart 与 active/ready 分离且各界面一致；重启探针与 pdf-config 覆盖不会伪报 ready |
| B：P05、Q02、Tasks | 暂停/重启后旧导出引用仍保护资源；升级和同版本修复不覆盖在用内容；首版必测当前精确匹配恢复与不匹配/缺旧包/未知版本持续阻塞；仅在提供切回功能时另测显式选择、重启验证及失败恢复，新版新运行需选择；不阻塞无侧车依赖翻译，不声称导入续传；共享槽可见忙碌/有界等待 |
| C：W02.admission-text@1、U01；外部另接 I01.shared | 一段文本跨协议/并发/重启重发仅一个 run/task；受理崩溃无丢输入、双重扣额或重复任务；按 [W-V02.admission-text](../../plan/0.1.x/validation/workflows.md#w-v02-admission-text) 证明真实 DSH 跨重启相关配置不一致阻塞且零误发、恢复匹配配置可继续、准备/写入竞态安全；可传入的 model/参数使用冻结值，无关 provider revision 变化不误阻塞；凭据只存引用，当前授权继续检查 |
| C：Tasks/Records、P04 | 未派发与上游已调用未知两类恢复可区分，未知不自动重发；legacy/config-unknown 明示，继续段不伪造历史；新运行默认复用，重译独立确认；暂停额度、串行排队、deadline/取消和 owner resume 可验证；文件导入保留不可续传限制 |
| 后续：W01/W02、I01.callable、U03.terms | 模板先实例化保存；plan 指向确切实例修订；非空术语有真实后端及版本；人工片段、局部重跑和通用插件引用按原工作包验收，不塞入单文本门槛 |
| 共用：P01/P04、P05/P08/D05 | 旧 wire/Records/快照兼容，依赖失败诊断和 barrier 收敛；干净 npm tarball/实际应用入口、冻结输出零翻译；三系统/独立 exe/第二真实包分别证明，fixture 与文档检查不能替代真实安装或通用性验收 |

先完成 A 的唯一 owner/控制及本地 owner 会话基础，再接真实托盘和管理页；外部入口另等 I01.shared，不能把本地管理鉴权推迟到外部开放时。B 的包清单/管理页状态和 C 的受理/冻结 fixture 可以与 A 并行，真实安装提交与恢复依赖 A 的退出边界，外部单文本开放依赖 I01.shared 防旁路门禁。B、C 不互为前置。固定 pin 下继续推进，运行时升级独立暂缓。

### 评审问题对应

本轮依据 [moewell 的三个场景](https://github.com/KongouAirlines/ivoraige/pull/70#issuecomment-6659902741)和 [OBG-tech 的 26 项静态核对](https://github.com/KongouAirlines/ivoraige/pull/70#issuecomment-6660669846)补充首版契约；以下对应便于复核，不表示评审者已经认可或实现已经通过。

| 反馈 | 本文落点 |
| --- | --- |
| moewell 1、3；OBG 11–16、25 | PDF 身份/就绪/版本保留、真实安装门槛及 B 验收 |
| moewell 2；OBG 17–22、24 | 单文本先行、有效配置、恢复/复用/排队及 C 验收 |
| OBG 1–6 | 数据域、HostControl 启动/退出及 A 验收 |
| OBG 7–10、23 | 权威/修订、身份与旧入口迁移及 A 验收 |
| OBG 26 | 范围中的已定迁移顺序及 [ADR-0003](../../decisions/0003-runtime-migration-gate-0.1.x.md) |

[2026-11-06 复核](https://github.com/KongouAirlines/ivoraige/pull/70#issuecomment-6676297679)对应：1→固定 DSH 冻结门禁及 W-V02.admission-text；2→PDF 必需阻塞/条件恢复验收；3→本地 owner bootstrap；4→迁移/副本登记；5→临时 owner 拒绝常驻 attach；6→W02 工作包与验证 ID；7→ADR-0003。次要项分别落在协议 §7 扩展门禁、迁移矩阵的匿名 MCP 变更、逻辑 entryId 与单一 generation。对应不表示实际实现或评审已经通过。

[正式 review 5802313934](https://github.com/KongouAirlines/ivoraige/pull/70#pullrequestreview-5802313934)对应：数据域登记补充固定位置/写入者、无 ID 升级、损坏恢复和无交互启动的 A 验收；冻结门禁明确实际有效来源、应用侧变更序号、前后核验及同一准备调用的消费边界，W-V02.admission-text 对应覆盖 ABA 与重载竞态；ADR-0003 标为提议并说明合并确认方式。均为契约修订，实际运行证据仍由实现 PR 提交。

## 待决问题

1. 四接口最终方法/字段、major/minor 协商与 IPC/HTTP 映射：在首个实现 PR 固定，是否能完全复用现有 P04 状态查询，避免重复 DTO？
2. HostControl 的平台启动控制器与 drain deadline：首版支持哪些平台、哪些任务可暂停、哪些只能取消？保留现有导入不可续传事实。
3. 入口停止的在途会话收尾与重新启用：具体协议状态码、deadline 数值及 stdio 桥接机制需要真实 transport fixture；遵守已定持久开关和共享 listener 边界。
4. PluginDelivery 首批包/资源清单、ready 探针成本和离线恢复路径：检查必需资产，不启动昂贵 GPU 工作冒充轻量状态查询；安装来源与发布包以 P05/P08 证据定案。
5. W02.admission-text@1 的原子落库/任务交接、冻结校验/调用准备一致性与引用保留：复用现有事务/任务恢复能力，选择最小可恢复方案；核验失败执行上述阻塞语义，不静默降级或要求运行时迁移。术语有效版本与 credentialRef 的轮换绑定规则须与 DSH 实际服务核验。

## 官方参考与采用边界

以下仅借鉴边界，不复制其 API 或声明本项目已有同等能力；查阅日期 2026-11-03。

- [Cordis 上游仓库](https://github.com/cordiverse/cordis)及其链接的 [DSH Cordis 入门](https://deepseek-harness.github.io/deepseek-harness/reference/cordis-primer)：服务依赖、插件与可撤销 effect；具体行为仍以本项目固定 pin 探针为准，不能据文档推断迁移完成。
- [VS Code Extension Manifest](https://code.visualstudio.com/api/references/extension-manifest)：包身份与宿主兼容声明分离；本文不引入 VS Code 扩展格式或市场。
- [Kubernetes readiness](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/)：存活与可接单就绪不同；本文不引入集群控制器或探针编排系统。
- [Docker Compose config](https://docs.docker.com/reference/cli/docker/compose/config/)：执行前解析合并后的有效模型；本文使用自己的冻结定义，不执行 Compose，也不把带秘密的解析结果公开。
- [LM Studio REST](https://lmstudio.ai/docs/developer/rest)：原生管理接口与 OpenAI 兼容推理接口有不同职责；仅作为 EntryControl/模型连接分离的参考，不采用其端点作为 ivoraige 承诺。
