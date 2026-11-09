# 0.1.x HostControl@1：首个接口设计切片

状态：**候选契约 1.0，部分实现分支待集成，未发布 API**。日期：2026-11-09。

A1 域/会话基础、A2 生命周期协调及 A3 owner 入口已有草稿实现；当前支持和未完成门禁见[入口证据](../../plan/0.1.x/evidence/host-owner-entries.md)。下文候选要求不是全部已验收行为，尤其 Windows 原生 pipe 身份、强退、完整恢复和持久 MCP 开关。

依据：[四接口 RFC](control-admission-rfc.md)、[D01](../../plan/0.1.x/packages/desktop.md#d01) 与 P04。源码核对固定在 [PR #70 合并提交 978d947](https://github.com/KongouAirlines/ivoraige/commit/978d9471fcc87857f4ca84da1ece6d169ee60a2b)。本切片固定 A 的候选方法、数据形状、所有权和验收顺序，供后续实现 PR 逐项启用。B 的安装和 C 的文本受理仅声明接点，不顺带实现；ADR-0003 的运行时迁移门禁继续有效。

## 1. 首轮设计结论

1. 所有能打开持久 store 的路径先走同一个本机 bootstrap。客户端 attach 不持有数据库锁，不拥有宿主退出权。
2. HostControl 与 P04 共用一个 generation；drain 关业务受理，不关管理通道；退出分阶段推进，超时/失败可以继续原操作。
3. 域登记和本地 owner 会话先于管理页上线。未完成授权收口前不能开放组件安装、匿名 MCP、私有事件或产物旁路。
4. 本次交付机器 schema、正反例和实现拆分。schema 只验证数据形状，不能证明锁、授权、持久化或退出正确。

## 2. 当前源码与最小改动边界

| 当前证据 | 设计要求与落点 |
| --- | --- |
| `src/launch.mjs:23–50` 用 instance.json 的 id 探测；`src/cli.mjs:275–288,307–313` 独立 createApp | 新 `host-bootstrap.mjs` 统一发现、域核对、锁和启动；launch/CLI/serve/stdio 仅适配参数与输出 |
| `src/store-lock.mjs:24–64` 对规范路径的 `.owner.sqlite` 执行 BEGIN IMMEDIATE；拒绝硬链接，排除网络文件系统保证 | 复用该独占机制，不把 PID/登记/HTTP 成功当锁。保留本地磁盘限制和硬链接拒绝 |
| `src/entry-events.mjs:145` 与 launch 各自生成 ID | bootstrap 生成一次 generation，作为内部构造参数交给 EntryEvents；附加客户端不换代 |
| `launch.close()` 先关 HTTP、删发现记录，再 dispose；失败 promise 被记住 | 由 HostControl 管理关闭阶段；只缓存进行中的尝试，失败后允许同一 operation 重试 |
| `src/app.mjs:155–175` 先关入口；后段收尾异常仍可尝试释锁并标 disposed | 分开停止业务、等待持有者、存储销毁、最终释锁；必要阶段未完成不能推进到释锁 |
| `src/operation-catalog.mjs:150–174` 每次创建固定 30 秒预算；`src/tasks.mjs:610–675` 无传入 deadline | 向现有服务传同一个单调时钟剩余预算；收尾失败保留必要 job 观察与重试能力 |
| `src/http.mjs:189–208,321–340` close 使所有路由失效；Host/Origin 不是身份 | 管理路由由 bootstrap/control owner 持有，生命周期长于业务路由及 DSH；owner 会话与旧旁路一起迁移 |

保留 Records、Tasks、DSH storage/jobs、P04 catalog 和事件桥。增加的协调代码不执行翻译、不调度第二任务队列、不复制 DSH 配置解析。`createApp({store})` 的嵌入式调用也必须走统一持锁路径；内部已取得锁的组合函数不向公共参数暴露 `skipLock`/任意 lease。无 store 的能力探针继续可用。

bootstrap 只取得一次 store lease，并将它交给同一长寿命 host 组合对象，不能再调用会自行取锁的公共 createApp。元数据阶段使用最小 DSH storage context，首选继续扩装同一 context；若固定 pin 必须另建 context，须在仍持该 lease 时先确认元数据 context 完全关闭，再装业务 context，不能双开写者。阶段失败保留可核验的登记意图；关闭失败时保留 lease 与诊断，不用新 context 越过失败。

## 3. 边界、身份与版本

### 3.1 三层所有者

| 层 | 负责 | 不负责 |
| --- | --- | --- |
| 本机启动控制器 | 将用户本机选项解析为域引用；验证本机 owner；启动/附加、离线诊断恢复、平台退出确认 | 不代理业务模型调用、不按 PID 猜测身份 |
| host 内 HostControl | 生命周期状态、业务受理闸门、同一退出操作、残留资源、受保护管理会话 | 不自我重启、不自行确认强退、不替代任务持久状态 |
| 入口/客户端 | 协议映射、同源 WebUI 会话、视图同步、断线提示 | 不能凭 JSON 声明 owner、不能因关窗退出 host |

常驻 `resident` 与一次性 `ephemeral` 是 owner lifetime。只有创建临时 owner 的本地调用会话可用它执行本次 CLI；其他 CLI、托盘、WebUI 和 stdio 均拒绝 attach 临时 owner，返回 `CONFLICT/temporary-owner`。临时 owner 不升级常驻、不签发浏览器会话。CLI attach 常驻 owner 后结束只关闭自身连接。

### 3.2 版本和 JSON 边界

- 候选标识为 `interfaceVersion: "HostControl@1"`、`minor: 0`。不修改 `API_VERSION: "2.0"`、external.v1、Record/Snapshot 或 sidecar 版本。
- v1.0 只接受 minor 0；未来 minor 通过 start/attach 返回的 `supportedMinors` 显式选择。未知 major/minor 在副作用前以 `PRECONDITION_FAILED/interface-version-unsupported` 拒绝，不能冒充参数已成功忽略。
- 请求字段严格；响应容忍新增字段。未知状态显示“状态未知”，不能推断 ready。`requestId` 仅关联诊断，不是幂等键。
- 连接后所有动作含 `expectedGeneration`。认证和归属先于对象存在性/状态披露；generation 不符返回 `CONFLICT/stale-generation`，不自动切到新宿主。
- `dataDomainRef` 是持久域 ID，不能传路径。首次新库先由本机 `resolveLocalSelection(startupOptions)` 完成安全初始化，得到域 ID；路径只存在于本机 CLI 参数与受保护诊断中。在线写入不能改绑数据域。
- 请求不包含 principal、grant、owner 标志或秘密；这些从受保护控制连接/浏览器会话带外提供。

候选 [JSON Schema](schemas/host-control-v1.schema.json) 的 `$defs` 分别提供 Request、State、Accepted、Attached、ControlOperation 与 RecoveryRequest。使用请求 schema 的前提是已通过版本和传输大小检查；实现以同一 schema 生成/对照 zod，不把文档 fixture 当服务器。

传输响应共用 `apiVersion, interfaceVersion, minor, requestId`；state/operation 查询分别包为 `{ ..., state: State }` 和 `{ ..., operation: ControlOperation }`，Accepted 返回 `accepted, generation, operationId`，Attached 返回 `reused, dataDomainRef, generation, supportedMinors, state`。Attached 的外层与 State 的域/generation 必须相同，这类跨字段关系由语义测试补验。ownerBootstrap 与强退 challenge 的秘密响应在传输实现时单列内存-only schema，本轮 fixture 不包含它们；这三个管理动作的请求已定候选形状，不表示其响应/OS 接线已冻结。

## 4. 方法与传输映射

| 动作 | 参数与输出 | 允许的边界 |
| --- | --- | --- |
| `start` | 域 ID、resident/ephemeral；返回 Attached（reused、generation、支持版本、state） | 受信本机控制器；只由 launch/serve 创建常驻，业务 CLI 可创建临时 |
| `attach` | 域 ID、所需 lifetime；不启动进程；返回 Attached | 受信本机控制器；stdio 首版只 attach 常驻，缺席提示先运行 launch/serve |
| `state` | expectedGeneration；返回 State | OS owner 控制通道或已配对浏览器；业务令牌不允许 |
| `drain` | expectedGeneration、budgetMs；返回 Accepted | 同上；拒绝新业务并等待安全边界，不自动退出 |
| `exit` | expectedGeneration、budgetMs；返回 Accepted | 同上；复用/推进原 drain 到退出 |
| `operation` | expectedGeneration、operationId；返回 ControlOperation | 同上；不读取已销毁的任务服务 |
| `ownerBootstrap` | expectedGeneration；返回内存中的一次性凭证与已绑定 WebUI origin | 仅受信本机常驻连接；不可从 HTTP 自签发 |
| `prepareForceExit` | expectedGeneration、operationId；返回短时 challenge 和风险摘要 | 仅受信本机控制器 |
| `forceExit` | expectedGeneration、operationId、challengeId、acknowledgeUnknownOutcome=true | 仅受信本机控制器在显示风险并得到明确确认后 |

`start` 与 `attach` 都须核对域登记、实际 store/owner 配置和已认证握手。锁忙且握手不可核实时返回 `CONFLICT/owner-unreachable`，不删除锁或发现记录。start 竞争失败者释放登记锁后有界等待、重查；等待耗尽返回冲突。`attach` 没有已验证 owner 且锁空闲时为 NOT_FOUND。

只有握手中的 storeOwnership=held 才可作为当前 owner 返回。released 的旧 generation 只接受原操作的查询/最终清理，不签发 ownerBootstrap/新会话、不接业务、不代新 host 执行动作；unknown 保持诊断阻塞。新控制器在取得已释放的锁后可创建下一 generation，旧地址还存活不能阻止或冒充新 owner；整个核验同时受 generation 和实际锁结果约束。

最小传输候选：Unix 使用用户私有目录内的 socket，目录 0700、socket 0600 并核验实际 peer；Windows 使用仅当前用户 SID 可连接的 named pipe，验证 DACL、客户端身份与远程连接拒绝。不能用随机管道名替代权限验证。具体跨平台绑定/API 必须由 A1 原生探针选择，Node API 无法保证时不能宣称已支持，不能退回匿名 loopback。

Windows 实现采用独立原生传输 helper，保留 `HostControl@1` minor 0、generation、capability 与帧语义；权限与双向身份校验由实际 pipe handle/token 提供。实现、依赖、原生探针和仍待验收项目见[Windows pipe 边界](../../plan/0.1.x/evidence/host-windows-pipe.md)，不能用编写了探针代替运行结果。

浏览器候选映射是同源 `POST /api/host-control`，仅允许 state/drain/exit/operation；start/attach/ownerBootstrap/force 动作不经 HTTP 暴露。复用同一请求/响应 DTO，不把 HostControl 管理方法注册成可枚举的公共 MCP 工具或通用 `call` 后门。WebUI/CLI 的业务操作仍调用现有 P04 操作；本节路径和命令均为待实现设计，当前版本不可调用。

## 5. 状态、P04 投影与退出操作

### 5.1 State

State 包含 `dataDomainRef, generation, lifetime, state, storeOwnership, acceptingBusiness, stateRevision, synchronization, operationId, blockers`。state 只取 starting/ready/draining/stopping/failed；storeOwnership 为 held/released/unknown。`ready` 必须 held，表示必要 owner/storage 已就绪，不表示所有可选 PDF/模型能力就绪。

- `starting → ready`：登记一致、锁已持有、必要服务可用；ready 才可打开业务闸门。
- `starting → failed`：启动失败；保留能够安全运行的最小诊断通道，回收已取得资源后才释放锁。不能开始业务。
- `ready → draining`：在同一串行临界区关闭闸门，确认在闸门前已取得的 admission lease。进入后不能取消 drain 或重新接单。
- `draining → stopping`：持有者已到安全边界，且退出意图为 exit；只有 drain 意图则仍为 draining、operation.status=drained。
- 任何收尾故障：保留原 phase，operation.status=blocked 和 reason；状态不能跳回 ready。不可继续的基础设施故障可标 failed，但仍显示持锁/残留诊断。
- stopped 不由活 host 的 State 返回。仅本机控制器以进程退出事实、代际核对和锁可重新取得确认；断开只能显示 disconnected/unknown。不能用 HTTP 连接关闭或文件消失代替退出证据。

P04 只增加 owner 专用同步投影 `host` 和 `host.changed` 失效通知。投影读取已提交的控制内存状态，不在同步 reader 中做 I/O。业务主体的 reader/订阅不包含 host 私有残留信息。generation 由 bootstrap 传入 EntryEvents，服务不得单独热重建并换代；要更换必须重启 host。

P04 存活时 `stateRevision` 来自现有 bridge。尚未装配或最终销毁期间 `stateRevision=null, synchronization="control-only"`，通过管理通道直接查询，不能伪造新的事件序号或声称 barrier 已同步。保留现有嵌入式 `events=false`：允许 ready/control-only，但不提供 P04 订阅或声称满足管理 UI 的同步门槛；以后激活 EntryEvents 仍须注入 bootstrap 的同一 generation，不能默认再生成。launch/serve 的管理 UI 路径要求 P04 开启。EntryEvents 销毁前终结订阅；bootstrap 的末段状态继续可查。`stateRevision` 与任何配置修订、entryRevision、域登记条件都不可混用。

### 5.2 同目标幂等与剩余预算

每个 generation 最多一个收尾 operation。第一次 drain/exit 原子创建 operationId 并关闭闸门；重复请求返回同一个 ID。exit 可将 drain 意图单向升级为 exit，drain 不会降级正在退出的目标。已完成阶段不重复执行，进行中的阶段只加入等待。

operation 是 bootstrap 持有的生命周期记录，不是新的任务调度器，也不占 DSH 执行槽。它引用已有 taskId/安装操作/worker lease，残留列表由这些 owner 提供。进程重启不恢复旧 operation 执行；旧 generation 失效，实际任务按持久 checkpoint 恢复。没有持久结果证据的旧操作保持 unknown。

`budgetMs` 候选范围 1–120000，UI 默认 15000；这是一次尝试的等待预算，不是数据安全上限。服务接收时转换为单调时钟 deadline，并扣除该进程内后续等待；HTTP、catalog、Tasks、worker 不各自续出一份预算。运行中的重复请求不刷新/缩短现有期限；超时进入 blocked/deadline-exceeded 后，下一次 drain/exit 用新 budget 继续同一 operation 的未完成阶段。断开请求只结束客户端等待，不撤销已受理退出意图。

### 5.3 必须按顺序完成的阶段

1. **gate**：关闭新的业务操作、任务/恢复、安装、run 受理以及翻译后续片段派发。授权检查与闸门检查在提交/派发点重做。拒绝 `PRECONDITION_FAILED/host-draining`。
2. **admissions**：等闸门关闭前的 admission lease 完成事务或明确回滚，不能出现“漏过关门检查”的孤儿任务。管理查询/退出不走已关闭的 business catalog。
3. **work**：翻译/导出按已有安全 checkpoint 暂停；导入取消且不承诺续传；安装按自身事务完成或回滚。已发往上游但结果未知的调用保留 unknown，不伪报撤回/零用量。暂停不能只改数据库状态而留下仍在写的 worker。
4. **resources**：等在途操作、文件/快照 lease、worker 树全部完成或受控回收。继续沿用既有 owner 范围；不得杀共享模型服务。失败保留锁、实例记录及管理通道。
5. **storage**：关闭业务消费者，确认不再有写入者，再销毁 Records/DSH storage。部分 dispose 成功要逐阶段记录；失败重试只调用尚存对象，不重新创建已销毁对象。
6. **release**：全部潜在写入资源已销毁后，先释放 store lock，随后条件删除“仍属于本 generation”的发现记录，最后关闭 bootstrap 管理通道并结束进程。管理 IPC 使用绑定 generation 的地址；控制器在 attach 时保留该地址及进程身份，不依赖后续 instance.json 仍存在。清理异常不得通过 `finally` 无条件跳到这一阶段。释放阶段与客户端的最终响应可竞态，客户端需用可信控制器确认，不把 accepted 当 stopped。

drain-only 完成第 4 步后停在 `phase=quiescent,status=drained,safeToExit=true`，保留必要服务与管理通道；只有 exit 意图进入 storage/release。safeToExit 表示现阶段没有已知业务写入者，不授权绕过后续存储销毁步骤。

释放是单向边界：释锁失败/结果不明时仍保留发现记录和管理通道，storeOwnership 为 held/unknown，不报告退出完成；释锁成功后为 released，旧 host 不再访问 store，也不能为重试抢回锁。此后删除记录失败仅重试本 generation 的发现清理；新 host 已替换记录则跳过，绝不删除新记录。此阶段仍可查询旧 generation 的管理 IPC，但旧进程不再是数据库 owner。管理通道最后关闭失败同样不伪报进程已退出。管理服务器对最终清理的投影不依赖已销毁的 DSH 服务；通道自身损坏时只能本机诊断，不能说“已可查询”。

控制器单独产生 ExitObservation，含原 dataDomainRef/generation/operationId、`observation=stopped|unknown`、processExited、ownerReleased 与 cleanupOutcome。它在 attach/start 的可信握手中保存实际进程身份/句柄与控制地址，不能事后仅查 PID。只有该进程已退出，且规范 store 锁可取得后立即释放，或同 store 的新 generation 已通过可信握手，才可判原 owner 已释放并显示 stopped。旧进程死亡不能证明正常收尾：未收到可核实的完成事实时 cleanupOutcome=unknown，后续任务以持久记录恢复。锁/身份无法核实时 observation=unknown，停止等待可以返回未知但不得改为成功。该 DTO 不加入活 host 的 State、不创建第二生命周期或事件计数。

“可核实的完成事实”具体是释放锁且发现清理完成/因新 generation 而安全跳过后，在尚存的已认证本机控制连接上发送 FinalizationReceipt（域、generation、operationId、storeOwnership=released）。它是一次管理响应，不是 P04 事件；控制器将其与原操作及进程身份匹配，之后才可填 cleanupOutcome=confirmed。通知丢失或仅见进程退出仍是 unknown，不补造收据。纯浏览器无本机进程/锁证据时只能显示退出已受理或连接已断开，提示用本机入口确认。

强退是另一条有确认的恢复路径。challenge 有效期候选 60 秒，单次、绑定域/generation/operation 与残留工作摘要；状态发生实质变化须重新展示并取 challenge。收到 forceExit 时再次验证 OS 身份、代际与 worker 归属，再终止本实例拥有的进程树；不能先删锁。平台不能可靠证明归属时返回 `PRECONDITION_FAILED/force-unavailable`，交由用户处理，不按名称/复用 PID 猜杀。正常超时绝不自动走强退。

## 6. 数据域登记与离线恢复

### 6.1 位置、最小持久字段和事务

登记位于 RFC 固定 OS 用户状态根的 `ivoraige-host/domains.json`，不是现有 data-directory 默认值：Windows LOCALAPPDATA、macOS `~/Library/Application Support`、Linux XDG_STATE_HOME 或 `~/.local/state`。目录/文件只允许当前用户，未验证 ACL 时不写入或启动。

候选登记 schemaVersion=1，每条含 domainId、registrationId、canonicalStore、fileIdentity（平台可核实元组）、ownerConfigBinding 和完成状态；秘密、浏览器会话与一次性凭证不进入该文件。ownerConfigBinding 比较影响宿主装配的 settings/组件根、显式 PDF 配置来源等，不把模型密钥或端口当域 ID。仅配置冲突不能选择“副本”绕过原 store。

store 内建议单独使用 DSH StorageDomain 的 `ivoraige_host` v1 元数据域，保存 domainId、registrationId、bindingVersion。具体 DSH schema 升级/双读由 A1 fixture 核对后定案；不写 DSH 私有表，不借改 Records 文档 ID 表示域迁移。旧程序未知该域元数据的写入风险必须由版本门禁/完整备份回退控制。

锁顺序固定为 **OS 用户登记写锁 → 规范路径排序的目标 store 独占锁**。仅在初始化/恢复时短持登记锁，锁忙立即释放已取得锁再有界重试；不拿登记锁等待活跃 host 退出/网络/用户输入。普通 attach 在可验证的活 owner 路径只做受保护登记读取与握手，不另开应用数据库。恢复需要多个本机 store 时按相同排序非阻塞取得，避免倒序死锁。

在受保护登记目录写入已刷盘的恢复意图（随机 transactionId、前置登记条件、目标身份、拟写域 ID）→ 通过 DSH 提交 store 元数据 → 原子替换并刷盘登记 → 标记/回收意图。每个故障点重启都以精确 store 身份和前置条件核验后续接；不能再生成 ID。意图路径不随数据目录迁移，业务闸门在两边一致前一直关闭。fsync/rename 与 Windows 文件替换行为需平台实测，不能用一次 writeFile 当耐崩溃事务。

无 ID、已知 schema 且登记无冲突的存量 store 静默初始化一次，保留全部文档/修订/task/snapshot ID。元数据不可读、未知版本或登记损坏不等于“无 ID”。已有域 ID 而登记不匹配时，serve/CLI/stdio 及时非零返回，既不读 stdin 等选择，也不自动开浏览器/调用模型。

### 6.2 候选本机恢复命令

以下是设计命令，不是当前发行版用法：

```text
ivoraige host domain inspect --store <本机路径> --json
ivoraige host domain recover --store <本机路径> --mode migrate|copy|repair-registration --expected-diagnostic <诊断摘要> --confirm
```

inspect 不启动业务 host；返回观察条件的 diagnosticRevision、域/位置差异、锁状态与可行恢复模式。它不能把一次锁空闲读当作提交时证明。recover 缺少任何前置条件/confirm 时只报参数错误，不弹交互等待；取得锁后重读条件，变化返回 CONFLICT，绝不抢活库。RecoveryRequest schema 表示本机解析后的命令参数，不允许 HTTP/公共 MCP 调用。

- **migrate**：必须核实旧 owner 已退出、旧位置不再作为活动域；保留 domainId 和幂等历史，转移登记，重新建立本机会话。本机原位置存在时锁定并核实；跨机器/不可访问原位置没有可核实退役依据则拒绝，不能把 `--confirm` 当旧 owner 已退出的证据。
- **copy**：仅确认是不同 store 的副本后分配新 domainId/registrationId；保留内容/task/snapshot 身份与来源，旧幂等仅供历史，清除继承的授权/会话可用性，未完任务不自动恢复。原文件的配置冲突拒绝 copy。
- **repair-registration**：只重建已明确核实的目标记录，保留原损坏文件与其他域内容。无法可靠解析/合并其他记录时要求可信备份恢复，不“修复”为一个覆盖全文件的新条目；无依据仍阻塞。

首版不支持任意整机克隆检测、跨机器分布式锁或网络文件系统共享。新登记格式不可被旧实现忽略后继续写库；回退先停全部 owner，恢复成套备份，而非删除域元数据降级。

## 7. 管理会话与旧入口迁移

常驻启动器通过已认证本机通道获取一次性 bootstrap 凭证，候选 TTL 60 秒，绑定域/generation/真实 origin，重放原子拒绝。WebUI 只从 fragment 接收、立即清除 fragment，再同源 POST 交换；不放 query/日志/Referer/连接地址或长期存储。浏览器仅持有 HttpOnly、SameSite=Strict 的 host-only 会话 cookie，HTTPS 加 Secure；写操作另有 CSRF 校验与完整 Origin/Host 验证。会话在重启、owner 撤销时失效；网络断连本身不升级身份。

交换端点只消费已有凭证，不能匿名签发；其成功/失败都不返回密钥。生产日志、导出诊断及 schema fixtures 不含真实 credential/token。无配对页面仅显示本机授权步骤，不提供私有快照。临时 CLI owner 无管理页会话。

启用 A 管理页时必须同步鉴权/关闭 componentInstall、组件本地导入、通用 call 管理操作、HTTP 管理、`/api/events`/state 与产物下载。旧匿名 HTTP-MCP 默认关闭；持久 enabled 与本次 `--no-mcp` 强制关闭分开，后者最高优先且不擦除前者。EntryControl@1 另细化路由开关，不能调用共享 HttpEntry.close。未实现的入站 OpenAI 一直 unavailable、地址 null。

这是旧匿名客户端的行为破坏性迁移，实施 PR 要同步 v2 协议的实际支持说明、双语 README 和升级提示；保留业务 JSON/错误/ID，不保留匿名管理回退开关。I01.shared 的业务主体隔离/限额仍是外部开放前置。

## 8. 错误与查询规则

| code / reason | 行为 |
| --- | --- |
| INVALID_ARGUMENT / invalid-request | 未知字段、错误类型、非法 budget；无副作用 |
| PRECONDITION_FAILED / interface-version-unsupported | 未协商版本；返回支持版本，不执行动作 |
| CONFLICT / stale-generation、temporary-owner、owner-unreachable | 重取/等待/从受信本机恢复，不能自动创建另一 owner |
| CONFLICT / domain-registration-mismatch、owner-config-mismatch | 保留现状，输出受保护恢复诊断 |
| PRECONDITION_FAILED / registry-corrupt、registry-unavailable、domain-schema-unsupported | 不清空登记、不静默初始化；非交互拒绝 |
| PRECONDITION_FAILED / host-draining、force-unavailable | 业务不受理或强退不可安全执行 |
| NOT_FOUND / owner-absent、operation-absent | 只向已授权 owner 披露；已知 generation 的失效先报冲突 |

认证沿用外部 AUTHENTICATION_REQUIRED/PERMISSION_DENIED 的语义；旧内核线上的 UNAUTHORIZED/FORBIDDEN_HOST 不擅自新增/混用为“owner 不匹配”。首个传输实现须给出明确映射并验证 HTTP 状态、CLI 退出码与旧协议，不能借返回 200 掩盖拒绝。

已受理操作的超时/阻塞首先由 ControlOperation 的 status/reason 表达，而不是报无操作发生的参数错误。传输结果未知时按 generation 查询 state/operation；requestId 不保证重放安全，禁止盲目重发强退或恢复写入。CLI 保留既有退出码：输入/认证 2，缺席/冲突/前置 3，上游/内部 4，明确取消 5；stdio stdout 只放 MCP 协议，诊断去 stderr。

## 9. 分步实施与验收

| 切片 | 允许修改与完成门槛 |
| --- | --- |
| A1：统一 bootstrap 与数据域 | store-lock、app 组合入口、launch/CLI 适配、DSH host 元数据、登记意图/恢复；先证明所有启动路径互斥与三系统本机 IPC/权限。没有原生平台证据的格保持未验收 |
| A2：可重试 drain/exit | HostControl、现有 catalog/Tasks/resources/components 的 deadline/收尾接点；管理通道留存，失败阶段重试、同 ID 幂等、仅自己 worker 强退；不实现新调度器 |
| A3：owner WebUI 与入口收口 | 配对/会话/CSRF、所有旧管理/事件/产物旁路；MCP 开关接线另挂 EntryControl；通过后再接真实托盘/管理页 |

A1/A2 的测试可并行设计，合入需保持现有入口可用且不暴露半接线的管理 API。A3 是安装管理页真实开放的前置。B 复用 admission lease、退出安装事务与版本引用；C 复用 gate/generation/owner resume，但其配置冻结、幂等输入和真实 DSH 跨重启门禁独立验收。

以下测试 ID 承接 D01 与 RFC A，不新建平行工作包：

- **D01.H01**：launch/serve/本地 CLI/stdio/嵌入式持久 createApp 竞争，最多一 owner；两个 attach generation 相同；路径别名一致，硬链接/网络盘限制明确。
- **D01.H02**：不同 settings/组件根/PDF 配置冲突拒绝；临时 owner 拒绝全部外来 attach；CLI 不退出所附加的常驻 owner。
- **D01.H03**：无 ID 存量升级、登记锁竞争和每个意图写入故障点；全部既有对象 ID 保留且只产生一个域 ID。
- **D01.H04**：登记缺失/损坏/不可写、文件替换、迁移/副本/跨机首次带入；无 TTY 及时退出，零业务受理/模型调用；恢复条件变化拒绝，活 owner 不被抢占。
- **D01.H05**：旧 generation 写请求拒绝；P04 handshake/stateRevision 一致；bridge 未启/退出后不伪造 barrier；断线不显示 stopped；释锁后仍存活的旧 IPC 不被当 owner、不签新会话，下一 generation 可安全启动。
- **D01.H06**：drain 与任务受理/安装提交/下一模型片段竞争；关门后零新增受理/派发，已入场事务可解释提交或回滚。
- **D01.H07**：catalog、task、worker、storage、释锁和发现清理各阶段超时/失败；同预算传递，管理可查。释锁前 instance/锁保持；释锁后的失败不重开库、不删新 generation 记录，控制器正确区分 stopped 与 cleanup unknown。重复 exit 原 ID 且只推进未完成阶段。
- **D01.H08**：翻译/导出 checkpoint 与导入取消、安装回滚；上游已发未知结果不自动重发；任务服务 drain 失败不提前撤销必需观察者。
- **D01.H09**：强退确认过期/重放/残留变化/复用 PID；不误杀共享进程，不早释锁；正常超时从不触发 force。
- **D01.H10**：bootstrap 过期/重放/跨源/错域/重启与撤销；匿名/业务令牌不能安装、退出、读私有事件或产物；所有兼容别名/通用 call 无旁路。
- **D01.H11**：关窗任务继续；重复 launch/重开视图；未配对页面只提示配对；纯 serve 提示手动重启。
- **D01.H12**：授权后的旧业务 fixture 与新路径对照，Record/Snapshot 不漂移，导出零模型调用；旧匿名升级提示、MCP 保存开关和 --no-mcp 优先级。

## 10. 这次检查与尚待定案

本次只做静态源码核对、机器 schema/正反例、文档链接与 diff 检查，未运行新的宿主代码、真实跨进程/DSH/Windows 安装测试。执行结果见[设计检查记录](../../plan/0.1.x/evidence/host-control-design.md)。不据此标 D01、D05、P04 或 A 已完成。

A1 必须定案的仅有：三系统可验证的 IPC/peer 身份 API；DSH 元数据域及旧版拒写策略；文件身份、刷盘与恢复证据的具体实现。15 秒等待/60 秒凭证是候选值，平台测试可调整但不能减弱上述语义。桌面框架、外部业务授权全套、插件第二包与单文本冻结仍在各自工作包，不阻塞当前设计评审。
