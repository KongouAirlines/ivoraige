# HostControl@1 A2 生命周期协调与服务接点

日期：2026-11-09。范围：D01 A2 的可重试 drain/exit 协调器、单调截止时间及既有服务的关闭接点。本切片不装配持久 host，也不开放管理入口；行为仍须由后续 bootstrap 接线启用。

## 本切片实现

- `HostControl` 在首次 drain/exit 时同步关闭自身业务 admission，并调用同步 gate。一次 generation 只保留一个收尾 operation；exit 可单向升级 drain，重复请求不改变进行中尝试的期限。已完成的 drain 保持 quiescent，直到升级为 exit。
- `HostDeadline` 把一次请求的 `budgetMs` 换算为单调时钟截止点。阶段按 gate、admissions、work、resources、storage、releaseStore、cleanupDiscovery、closeControl 顺序执行，共用同一截止点。超时不取消正在运行的阶段；下一次尝试先加入该阶段，完成后才进入后续阶段。资源或工作未收尾时不释锁；释锁结果不明时记录 `storeOwnership=unknown`，不继续发现清理。
- `OperationCatalog` 的 admission lease 覆盖参数校验和异步 preflight，提交 handler 前再次核对业务闸门。handler 开始后由 active-call 集合管理，使 admissions 阶段能够调用 `close()` 中止并等待运行中的 handler，而不会先等 handler 自行结束。Tasks、Components 和 ResourceAccess 提供同步停接单及可等待的收尾接点；关闭后的直接受理返回 `PRECONDITION_FAILED/host-draining`。
- `EntryEvents` 支持由调用方标记的 owner 专用状态 reader 和通知。普通 session 不取得该 reader 或 owner-only 通知；owner-only 通知不能通过 legacyData 旁路发送。该内部标记不是身份认证。

上述接点沿用 P04 的 operation、任务、组件和资源服务，不新建任务调度器。现有操作 facade 与业务数据格式不由本切片更改。

## 实际验证

在 Node 24.22.1 本地兼容环境运行 `node --test test/host-control.test.mjs`：14/14 通过。覆盖同步关门、跨 preflight 的 admission、运行中 handler 的中止与汇合、同 ID 重试和升级、未完成阶段不提前释锁、释锁后清理重试、单调预算及 owner-only P04 内部投影。`git diff --check` 对本切片文件通过。

在仅含本切片与 A1 修复的独立工作树运行完整 `npm test`（含构建）：597 项中 592 通过、5 条件跳过、0 失败。跳过包括本机不允许 Unix socket 的探针及平台限定测试。隔离 npm 包 smoke 通过，90 个文件，覆盖解析、成套备份后重装、冻结快照/原文导出与 MCP。Node 26.13.0 原生 CI 仍单独核验。

## 未覆盖与后续

本切片不包含生产 bootstrap 接管 store lease，也不包含经过认证的本机控制通道、管理 HTTP/WebUI、跨进程退出观察或强退实现。因此它只提供受测协调器与服务接点，不能声称 D01.H06–H08 端到端通过，不能声称 A1/A3、D01 或管理 UI 已交付。真实任务、安装事务、文件 lease 与 DSH storage 的全链路关停、三系统进程/锁竞争及 Node 26 CI 仍须在装配后验证。后续接线必须保持控制通道至最终清理，并由可信 owner 边界决定谁能请求 owner 投影与 drain/exit。

依据：[HostControl@1 契约](../../../requirements/0.1.x/host-control-contract.md) §5、§9；[D01 工作包](../packages/desktop.md#d01)。
