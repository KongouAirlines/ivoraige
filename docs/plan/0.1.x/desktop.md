# ivoraige 0.1.x 桌面端子方案

核验日期：2026-10-19。D01–D05 的专项设计与测量协议；性能预算尚未实测。公共接口见[目标契约](../../requirements/0.1.x/contracts.md)，范围见[候选分期](releases.md)。

HostSession/TaskCapabilities/WorkerLifecycle 适配既有 ivoraige.tasks 和 DSH jobs。D04 当前宿主基线可并行开展；正式桌面实现依赖稳定的公共接口。

## 源码基线与证据

通过 GitHub 只读接口核对 main，为 `43d3f1fadc4930baa445aeb0cb832b3647aa08d7`，package.json 为 0.1.0。以下是源码检查，不代表本轮运行验证。

- [launch.mjs L13–62](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/src/launch.mjs#L13)：启动内核、回环 HTTP、默认浏览器；instance.json 加实例探测与 store lock 防止同库多实例。没有原生窗口或托盘。[settings-window.jsx L17–38](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/web/settings-window.jsx#L17) 是 HTML dialog/showModal。
- [tasks.mjs L39–50、435–524](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/src/tasks.mjs#L435)：恢复翻译/导出前验证 checkpoint/snapshot；仅 paused/failed 可 resume，canceled 不可。启动时未完任务暂停，导入另行恢复或失败；PDF 导入不能暂停续传。close 会阻止接收任务、abort 活动工作并等待收尾。
- [sidecar.mjs L142–173、306–340](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/src/sidecar.mjs#L142)：首次请求才启动 Python，会话在成功请求后保留，无空闲卸载计时。Windows 使用 taskkill /T；其他系统终止直接 child，不能据此保证孙进程回收。已写有崩溃一次重试和临时目录清理，但没有父 host 被强杀后的全树保证。
- [WebUI app.jsx L106–129、244](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/web/app.jsx#L106)：保存的业务草稿走 PATCH 与 baseRevisionId；未保存编辑在 React 内存，用 beforeunload 提醒，不是崩溃恢复日志。已使用 SSE，进度事件以 500 ms 合并后提升全局 epoch，多处查询随之重载。没有必要先把现状描述为持续轮询。
- [http.mjs L113–126](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/src/http.mjs#L113)：SSE 有实时订阅，没有逐条事件 id/游标重放；重连必须重新获取权威快照。host 仅允许回环并检查 Host/Origin。
- [v2.0 §1.4](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/docs/requirements/v2.0/01_design_v2.0.md#L90) 原决定是浏览器桌面形态、将托盘留待后续评估；本子方案是用户新需求下的增量设计，需在后续设计基线中明确替代这一决定，不将其说成已实现。三系统目标继续保留。

## 推荐责任划分

采用“独立 host + 轻量原生控制层 + 可销毁 UI”作为待测架构，暂不选择 Electron/Tauri。逻辑分层必须成立，托盘和 host 是否同进程由探针实测决定，避免仅为分层增加常驻进程。

| 部分 | 拥有的责任 | 生命周期要求 |
| --- | --- | --- |
| 后台 host | 唯一内核/SQLite 所有者；装配 DSH jobs、存储、凭据；任务编排、快照、进程监管、事件和资源策略 | UI 不存在时仍可运行任务；无任务时不加载 Python/GPU；复用现有服务，不新建另一套任务系统 |
| 托盘与右键菜单控制层 | 原生图标、摘要状态、打开工作台/任务/设置、退出；只调用命令契约 | 创建菜单不启动 renderer；菜单和图标不依赖隐藏网页；状态通过订阅更新，进度适度合并 |
| 按需 UI | 展示、编辑、导航、草稿日志、连接状态；复用 WebUI | 需要时启动，关闭后销毁拥有的 renderer/webview；不拥有长任务、SQLite 或 Python；重开靠快照恢复 |
| 可选能力 worker | Python/外部引擎及后代；插件声明 spawn、取消、回收、恢复能力 | 忙时持有任务 lease；空闲到期可停止会话，下次请求重启；回收 session 不能永久关闭整个可复用 client |

“右键菜单”第一阶段指托盘原生菜单；资源管理器/Finder 文件关联右键入口另列可选功能，不默认扩张范围。

### 首版最小托盘子集

以下为待实现范围：产品首版优先交付最小托盘及其原生右键菜单，完整原生 UI 后置。该子集沿用上表的基础菜单，打开现有 WebUI；无需等待可销毁原生 UI、完整草稿恢复等桌面能力全部交付。候选版本关系见[交付范围](releases.md#范围与放行条件)。

- 管理供外部客户端调用的入站 OpenAI 兼容入口和 MCP 入口：显示各自真实运行状态、查看/复制实际连接地址，并分别启停。入站 OpenAI 入口与上游模型连接配置是不同对象。
- 状态和地址取自当前 host 的实际运行信息；尚未就绪、启动失败或地址/端口未知时明确显示原因，不显示推测地址或伪报可用；菜单和复制内容不暴露凭据。
- 停止一个入口只停止该入口，不关闭共用 HTTP 监听、WebUI 或 host，也不影响另一个入口；所有操作复用唯一 host，不另启第二个 SQLite 所有者。

## 必须先有的基础契约

以下是拟新增/扩展的语义，不是现有 API 名称；落点与 0.1.x 操作注册、事件、生命周期契约对齐，不扩大单一 Operations switch。

| 契约 | 最小内容与依赖 |
| --- | --- |
| HostSession | protocolVersion、instanceId/generation、ready/stopping 状态、capabilities；复用真实数据目录与 store lock；二次启动只激活现有 UI |
| 命令 | 显式 requestId 与响应；openView(route)、getStatus、prepareShutdown、commitShutdown；任务命令复用现有服务。断线重试需幂等或查询原结果，避免重复导入/翻译 |
| TaskCapabilities | 每任务 allowedActions、取消结果、可恢复性、进度/收尾阶段；导入、安装、翻译、导出分别声明；UI 不按格式名猜按钮 |
| Snapshot + Events | 摘要查询与细节查询分开；跨域事件独立注册和 disposer；带 host generation/状态 revision。遵循[状态同步边界](../../requirements/0.1.x/contracts.md#状态快照与订阅的同步边界)：先完成原子 barrier 的订阅就绪握手并缓冲，再取一致快照；重取期间保留订阅，断线/换代/溢出重新握手。持久事件重放可以延后 |
| UI Session / DraftJournal | viewId、docId/unitId、语言、基修订 ID、编辑版本、日志版本与持久化确认；退出/销毁前 flush，冲突只提示合并，不覆盖已接受修订 |
| WorkerLifecycle | busy lease、idle/starting/stopping 状态、停止 deadline、所有权/后代记录、回收结果；协议区分可重新启动的 idle stop 与最终 dispose |
| 本机控制边界 | UI 不拿系统 shell/任意进程权限；特权控制使用受限本机 IPC 或经能力令牌保护的窄接口；WebUI 继续同源。不得简单放宽现有 Origin 为任意 webview 来源 |

业务边界继续保持：入口无业务编排，凭据复用 DSH，Python 仅经侧车协议，导出只用冻结快照且不能翻译。桌面 UI 关闭不能触发业务数据删除或重新执行模型请求。

## 用户动作与故障语义

| 情况 | 建议行为与验收重点 |
| --- | --- |
| 点窗口关闭 | 默认关闭 UI、保留托盘/host 和运行任务；先将编辑日志持久化并确认，再销毁 renderer。保存失败保持窗口并给出重试/放弃选择；首次明确展示“任务继续运行” |
| 最小化 | 先遵循系统最小化，停止不可见页面的图表/动画和细节订阅；可在配置的空闲时间后销毁 UI 并保存恢复位置。最小化本身不能暂停任务 |
| 托盘退出 | 先展示活动任务与退出影响；接受退出后停止接收新任务、保存日志、暂停翻译/导出、取消不可恢复导入/安装、等待 worker 回收、关闭数据层、移除实例记录与托盘。命令返回 accepted 不等于退出完成；保留收尾状态直至完成 |
| 退出超时 | 不伪报成功或先释放 store lock；显示阻塞阶段，允许继续等待或明确强制退出。先终止本实例拥有的 worker 树，再结束 host；下次按 interrupted 状态恢复 |
| 暂停/恢复/取消 | 暂停可等待安全 checkpoint；恢复从已提交 checkpoint/同一 export snapshot 继续。取消是终态，已保存修订和产物保留；“重新执行”是新任务。不得承诺供应商已经执行而尚未落库的模型请求绝不重复 |
| UI 崩溃/重开 | host/任务继续；UI 重启取快照并恢复日志/位置，基修订变化时显示冲突。保证最后确认持久化的日志可恢复，定义 debounce 窗口内的最大可能损失；不靠 beforeunload 保证 |
| host 崩溃 | 控制层显示离线，等待旧进程退出与锁可安全获取再重启；任务按现有恢复规则暂停/失败，不自动重发。检测并清理本实例拥有的 worker，不能凭 PID 杀进程，需校验启动时间/实例归属 |
| Python/GPU 回收 | 默认低资源模式：无任务且超过候选 TTL 后结束 worker 会话，释放其 GPU context；忙时禁止回收。UI 关闭不等于 worker 必须停。外部共享模型服务不归本实例所有，不能随 host 退出杀掉；显存不可读记 unknown |

现有临时目录清理只保证可运行父进程的当前 session；父进程强杀/断电恢复需另定带所有权清单的回收规则，不扫描删除任意历史目录。三系统分别验证进程组/监管机制，不能把 Windows 的现有 taskkill 测试推广为三系统保证。

## 可执行的低成本性能验证方案

先写/批准测量口径，后续实施阶段才做探针；本轮未运行或安装任何框架。第一轮只用既有内核和 fixture、独立临时数据目录，不调用付费模型。之后每个候选架构只实现托盘、打开/销毁同一 WebUI 和状态订阅，不做完整桌面产品。

**固定条件与样本：**记录 commit、release 构建/运行时/WebView 版本、OS/CPU/RAM/GPU/电源模式与显示环境；固定一个空库和一个 1,000 单位的合成文档、相同 PDF 样例。各配置随机顺序运行 5 次，稳定 2 分钟后采样 10 分钟；1 Hz 记录内存/CPU/进程，另做低频采样对照排除采样器开销；恢复动作重复 30 次报告 p50/p95/max。故障动作在隔离夹具执行 10 次，泄漏测试做 100 次 UI 开关及 1 小时后台浸泡。

| 场景 | 比较对象/动作 | 必须报告 |
| --- | --- | --- |
| B0/B1 | 应用未启动；现有 launch --no-open（相同数据/组件配置） | 系统基线、host 树成本、无任务是否启动 Python |
| B2/B3 | 现有浏览器 UI 打开/关闭；候选仅托盘+host | 托盘增量；UI 关闭回落到后台状态的时间与余留进程 |
| U1/U2/U3 | UI 可见/最小化/关闭；空库与 1,000 单位 | 私有内存/驻留量、CPU、应用归因唤醒、订阅数、恢复至可编辑耗时 |
| J1 | fixture 长任务，分别打开/关闭 UI，完成后闲置 | 吞吐及进度准确性、任务后回落；不能把正常计算成本算成 idle |
| P1 | 未装 PDF、已装未调用、首次调用后空闲 | Python/后代与 GPU 归属；TTL=0/30/120 秒的释放和下一次任务延迟，选择有数据支撑的默认值 |
| R1 | 重开 UI、二次启动、睡眠唤醒、host 断线重连 | 单实例、快照一致、草稿确认版本、p95 恢复时间和重连唤醒 |
| F1 | 分别杀 renderer、托盘、host、worker；worker 生成孙进程；退出超时 | 是否丢任务/草稿、重启循环、取消与恢复终态、孤儿进程、端口/锁/当前 session 临时目录 |
| Q1 | 空闲退出、任务中退出、100 次开关 | 退出到零拥有进程的耗时，内存/句柄/进程数是否持续增长 |

**归因方法：**整个应用拥有的进程集合包含 host、托盘、renderer、WebView broker/GPU helper、Python、其后代及被重托管的进程。持续记录 PID+启动时间、父子关系和实例归属，不能只在退出时递归查 PPID。浏览器可能复用既有进程：对照用独立 profile/实例，并另记共享 OS WebView 服务的系统增量；既不漏算，也不将用户全部浏览器算给应用。

- 内存：Windows 报告 private bytes 和 working set；Linux 汇总 PSS 并辅报 RSS；macOS 报告 physical footprint 与 RSS。共享页导致 RSS 求和重复，禁止跨 OS 把不同指标作同一数字排名。[Linux proc 文档](https://docs.kernel.org/filesystems/proc.html) 定义 smaps_rollup/PSS。
- CPU：sum(进程 CPU 时间差)/墙钟时间，以 100%=一个逻辑核记录，同时保存机器核数。按 10 秒窗口统计，避免不同工具的全机百分比混淆。
- 唤醒：记录应用归因的定时器/等待到可运行事件与每秒次数；context switches 另列为代理指标，不能直接称为唤醒。Windows 可用已有 WPR/WPA 的 CPU/线程事件追踪；[Microsoft CPU Analysis](https://learn.microsoft.com/en-us/windows-hardware/test/wpt/cpu-analysis) 区分线程状态与上下文切换。macOS 用已有 Instruments 能源/线程跟踪；Linux 用已有 perf/调度追踪。工具缺失时标记未测并阻止“已通过完整性能验收”，不临时安装或修改系统。
- GPU：有真实 GPU 路径才运行该格；分进程显存可得时记录释放时间，否则报告未知与仍存活 worker，不能报 0。资源回收以拥有进程退出为硬证据之一，实际 GPU 驱动回收单独观察。
- 产物：每轮输出 manifest.json、processes.csv、samples.csv、actions.jsonl、对应原始 trace 和汇总；记录不可测项、异常和测试数据版本，报告数值而非截图结论。

**建议初始门槛（待基线测量后固定；不是现有实测值）：**

1. 硬门槛：仅后台时没有本应用 renderer；从未调用 PDF 时没有 Python/GPU worker；菜单不启动 UI；退出或故障清理 deadline 后零拥有孤儿；关闭 UI 不改变任务语义；已确认日志可恢复。
2. 托盘+host 空闲相对同配置 host-only：增量私有内存预算 30 MiB，首次平台样本可调整一次并说明原因；没有意外的定时全量查询。全树空闲平均 CPU ≤0.2% 单核，10 秒窗口 p95 ≤1%；新增应用归因唤醒平均 ≤1 次/秒。跨 OS 使用各自规定内存口径验收，不假装数值等价。
3. UI 关闭后 5 秒内回到同阶段后台基线+10 MiB；100 次循环后不单调增长且末态仍在该范围。已触发 PDF 的状态须等到 TTL/回收结束再与“已回收 worker”基线比较。
4. 托盘菜单响应 p95 ≤100 ms；host 已运行的 UI 重开到恢复位置且能编辑 p95 ≤2 s，冷启动单列并以 ≤5 s 为初始目标。输入数据和参考硬件固定。
5. 正常退出目标 ≤5 s；忙任务/异常 worker 的收尾 deadline 初设 15 s，超时必须明确报告且进入受控强制流程，不把 15 s 当已经保证的数据安全上限。GPU 释放目标在 worker 退出后 5 s 内观测回落，平台无法归因则该格待验收。

## 任务拆分与三系统验收

本节保留桌面输入的拆分名称，映射为：D1 → D01、W1 → D02、W2 → D03、P1 测量 → D04、D2/D3 → D05。以下顺序表不是另一份执行状态表；P1 测量也不是基础链 P01。

| 顺序 | 工作包 | 完成条件/依赖 |
| --- | --- | --- |
| D1 基础依赖 | 和主规划统一 HostSession、操作注册、跨域事件、TaskCapabilities、shutdown/drain、WorkerLifecycle | 文档+契约 fixture，包含断线、缺件、任务取消恢复；先于桌面壳 |
| W1 可并行 | WebUI 草稿日志/恢复、路由与窗口位置、close/flush 握手、配置表单敏感字段处理 | 未保存正文可恢复；凭据不落草稿；并发修订不会静默覆盖 |
| W2 可并行 | 拆 API/session 客户端与页面；事件定向失效、列表分页/虚拟化、不可见订阅停止 | 同一 WebUI 可在浏览器及候选 UI 使用，关闭页面后无 listeners/timers 泄漏 |
| P1 测量 | host-only/browser 基线和上述统一采集格式、故障夹具 | 先得到数值再选 TTL/预算；采样器自身开销有对照 |
| D2 桌面探针 | 原生托盘/菜单、按需 UI、单实例、会话/worker 监管 | 两种可行候选按相同 WebUI 与测量协议比较，按结果选框架/进程形态 |
| D3 集成验收 | 关闭/退出/任务/草稿/崩溃矩阵，发布构建复测 | 三平台分别出证据；没有 native smoke 不称桌面支持已交付 |

分阶段可先在已有验证资源较多的 Windows 完成基线与探针，再做 macOS、Linux 原生验收；三平台共享内核契约测试从 D1 开始。Linux 验收需注明桌面环境、X11/Wayland、托盘宿主是否可用；托盘不可用时保留可访问窗口/退出入口，不能关闭后让用户找不到进程。macOS 要单测关闭最后窗口与 Quit 区别。三系统内核 CI 通过不能替代原生托盘、进程回收或 GPU 验收。

延后：开机自启、系统服务安装、自动升级/安装器签名、多窗口多实例、文件管理器右键集成、复杂通知、常驻 Python/GPU 预热、跨机控制，以及无证据的全插件热卸载。桌面新增入口要可选，不迫使 CLI/MCP 用户安装壳。

待测选择包括框架/托盘绑定、worker TTL、平台资源预算与真实 GPU 回收；命令、草稿和退出 API 仍由 D01 契约探针收口。没有性能实测数据，不能把建议门槛写成现有产品保证。
