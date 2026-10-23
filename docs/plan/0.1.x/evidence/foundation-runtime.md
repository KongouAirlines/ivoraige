# P01：固定运行时护栏

2026-10-23，基于 main `8dc548d9b08d8d6374c66920efca24135d9ce86d`。

## 固定组合与实际边界

Node.js 26.12.1；DSH `639ed015397290b3745d163aafe02ffee4aa3f84`。
DSH vendor 记录的 Core 4.0.0-rc.7 / Loader 1.0.0-rc.5 上游来源为
`56b3d4f725681cf4556c1a8695a709cc3b6eed74`，Harness Cordis 包版本为 4.0.4。
保留 vendor 补丁，未更改 pin、存储 schema 或分发边界。
构建从 bridge 解析同一 Core，`dist/build-evidence.json` 记录 1003 个输入；
这不证明独立插件分包或最小发行闭包。

`test/foundation-runtime.test.mjs` 固定空 Context、无翻译纯解析组合、
真实 Records/Tasks/Components 组合、部分启动失败，以及异步注入消费者的退出顺序。
Records 的生成器 effect 先撤销服务并等待消费者，再关闭 domain；测试用可控屏障
证明消费者等待期间和最后一次读取时 domain 仍然打开，随后才关闭。
Operations 激活阶段故障必须关闭已启动 Tasks、释放 store 锁，并能重开同一路径。

## 配额与等待修复

DSH 的 owner 为 live Agent 生命周期，不可用任意字符串伪造业务 owner。
当前组合的安装和业务工作均处于未指定 owner 的桶，上限为 1。
安装先运行时，业务原来会在 `jobs.start()` 的配额拒绝后走 task failed/翻译失败路径。
用 main 原始 dispatch 的临时探针复现为 failed（期望 queued，1/1 失败）；现在保持 queued，监听 DSH settled 再尝试；没有启动生产者时不增加模型调用计数。
反向交错保留安装入口的 CONFLICT；业务结束后可再次安装。暂停、取消和关闭与配额拒绝及存储写入交错时，按最新控制意图提交 paused/canceled，不重新排队吞掉意图。
测试使用真实 jobs-local、可控安装与模型生产者，无网络和付费调用。

`waitForJob()` applies a fresh total deadline to each invocation, covering repeated nonterminal results and an unresponsive `jobs.wait()`; the default is 30 seconds. Components and Tasks each call the helper independently. This is not an application-wide shared shutdown budget. A timeout reports UPSTREAM_FAILURE rather than completed, and does not prove forced termination of an uncooperative producer or DSH disposal.

## 验证与范围

新增 13 个护栏（含暂停/取消/关闭在配额受理前及写入期间的屏障子例）通过；现有解析、冻结输出及任务生命周期基线 15 个测试通过。
完整 build 通过。首次默认全并发 suite 为 261/263：两个既有组件安装测试在 30 秒等待后仍非终态；定向组件 suite 通过。限制为四个测试进程后完整 suite 263/263 通过（65.9 秒）。干净 tarball smoke 通过（69 文件）：独立解析、同版本重装及完整数据备份、设置、冻结/原文输出、MCP 发现/调用和静态 UI。初始提交 1e71f23368c1f23087443ac138328d47c91fd5be 的远端 [CI 39908459393](https://github.com/KongouAirlines/ivoraige/actions/runs/39908459393) 四矩阵（Linux/macOS/Windows Node 24.22.1、Windows Node 26.12.1）均成功；控制竞态补强后本机完整 suite 271/271 通过（57.1 秒）；最新远端 CI 结果见 PR。
Python sidecar fixtures 14 个、归档 fixtures 4 个通过。
首次 Python 沙箱执行因临时目录权限失败，授权环境重跑通过，未改变系统安全配置。

已有 `export.test.mjs` 继续证明 frozen data-only、未绑定 this、不可写快照、
多格式/重启重放字节一致和无 LLM 服务；settings 的 AppBoot/Loader/volatile、
持久化失败及重启回归在完整 suite 中保留。候选迁移另按
[候选门禁](../runtime-sequence.md#候选兼容门禁与维护成本)核对，当前护栏通过不代表候选通过。
没有执行真实 PDF 引擎、真实桌面或原始用户库迁移验收。

## Review correction: buffered import cancellation (2026-10-23)

With the component installer holding the shared quota, an import canceled after its running-state write but before job admission became canceled and left the queue while retaining its complete 1 MiB source in `pendingImports`. Quota-deferral cancellation now drops that entry before notifying waiters. Regression coverage gates both the running-state write and the quota-deferral write, for explicit cancellation and service close; all four cases failed on the previous head and pass after the fix. No document is committed and `llmCalls` stays zero.

The original `review45/probe-quota-import.mjs` was preserved and a copy redirected to this checkout. Its output was checked, not just its exit status: `state: canceled`, `pendingImports: false`, `queued: false`, with no retained-content field. Local Node 26.12.1 validation passed: foundation guards 18/18, full suite 276/276 (four test processes), build, and isolated 69-file package smoke including HTTP/MCP. Logs are under ignored `evaluation/runs/foundation-review-0.1.x/`. Final remote SHA and CI are recorded in the PR description.
