# 0.1.0 MCP 接入计划

## 基线与目标

基于 main `0a185d4`（PR #17 已合入），实施分支 `codex/0.1.0-mcp`。安装阶段已完成；本阶段补齐 v2.0 M6 的 MCP 入口，让 AI 客户端使用现有持久化内核。实现与实际验证结果见下方记录；尚待 PR 审阅及合入。

## 实施顺序

1. **工具契约**：核对现有 operations、协议 schema 与 v2.0 §6，列出已实现能力的工具及资源映射。参数、业务结果、错误码复用现有协议；未实现的 RAG、词库等不注册为可用工具。必要的协议调整与实现同步提交。
2. **stdio 入口**：支持 `ivoraige mcp --stdio`，标准输出仅用于 MCP 协议，日志写标准错误。拥有内核的进程遵守既有单库占用和释放规则，不绕过锁。
3. **Streamable HTTP**：常驻服务挂载 `/mcp`，与 WebUI/CLI HTTP 共享同一内核及任务。复用现有回环访问边界；明确会话释放与持久任务生命周期。使用官方 MCP SDK，不自造协议栈。
4. **端到端与分发体验**：补齐客户端配置、启动、连接常驻实例、任务轮询、结果读取与故障恢复说明，验证发行入口可用。

## 验收条件

- 两种 transport 使用正式 MCP 客户端完成初始化、工具发现与调用；至少一个真实 AI 客户端跑通导入、翻译、人工修订/接受、冻结导出。真实客户端不可用时如实记录阻塞，不能以 SDK 测试冒充真实客户端验收。
- TXT/Markdown 跑通完整流程；安装 PDF 时复用既有 BabelDOC 来源绑定、任务及输出，缺失 PDF 组件时文本功能和 MCP 启动正常。
- 长任务返回 taskId，支持状态查询及现有暂停/恢复/取消语义；字段与 CLI/HTTP 一致。覆盖并发编辑冲突、错误返回、断开连接、进程退出及重启读回。
- PDF/MD/JSON 读取同一冻结快照；编辑后重导出保持原快照结果且模型调用为零。默认自动测试使用本地 mock，真实模型验收沿用已授权剩余预算并记录新增调用与用量，不扩大预算。
- 验证双 transport 不另建翻译、凭据、设置或任务实现；MCP 未启用时已有入口正常。
- 对受影响路径运行回归、隔离安装 smoke 与三平台 CI；记录真实验收平台和限制。

## 范围与停止节点

不扩展 Issue #14 的 MinerU/引擎重构或 Issue #16 的完整安装器、项目与界面重设计，不实现未完成的 RAG/词库。完成实现与验收后提交面向 main 的 PR，说明结果及限制，等待 review，不自行合并。

[release-documentation-binding](../follow-ups/release-documentation-binding.md) 仍安排为 MCP 等内容完成后的发版前收尾；本阶段不提前发布正式版本。[pdf-store-relocation](../follow-ups/pdf-store-relocation.md) 只推进本阶段实际完成的 MCP 验证，保留其余未完成范围。

## 实施与验证（2026-10-13，待合入 main）

- `ivoraige.mcp` 为可选 Cordis 注册服务；MCP runtime 只处理 SDK、连接、发现及统一结果包装。文档/任务、模型设置、组件安装分别通过独立的能力插件注册 schema 和操作；PDF 使用原有来源/输出适配器，经通用工具处理，不在 MCP 基础组件引入 BabelDOC 逻辑。新增示例插件在同一客户端动态出现/卸载的回归通过；`createApp({mcp:false})` 文本功能正常。
- 官方 SDK 固定 server 2.3.1、node 2.1.1，测试客户端 2.3.1。stdio stdout 只输出协议；EOF 释放数据库。HTTP 共用工作台内核、保留 Host/Origin 检查；实际连接断开释放长轮询订阅，不取消业务任务。旧协议只发送取消通知时，无状态 HTTP 不关联跨请求取消，等待有 60 秒上限；业务取消仍须 task_cancel。
- Windows 11 Pro x64、Node 26.7.0：完整 `npm test` **229/229**；MCP 专项 7/7；隔离 npm 安装包 smoke **57 文件通过**，包含 MCP 发现/调用。首轮全量运行与真实 PDF 并行时已有组件安装测试发生 30 秒等待超时；单独组件/MCP 回归 24/24、随后完整重跑通过，未改生产安装超时或掩盖失败。
- 真实 DSH 0.2.0-rc.2 headless 通过 HTTP 自动调用 import → translate → task_status → export；独立观察客户端确认导出任务 succeeded，MD/JSON 共用 snapshotId 且读取字节成功。原创一句英文经 DeepSeek Flash 翻译，内部模型 **1 次，108 输入/8 输出 tokens**；重建不调用模型。真实 AI 客户端 stdio 未单独运行，stdio 使用正式 SDK 客户端和独立进程验证。
- 预算审计：本阶段模型调度尝试共 **17**（9 次受限网络失败、2 次首次联网但 harness 上下文配置过小的调用、5 次成功 harness 推理、1 次内核翻译）。加先前 13，按保守口径达到原授权 **30/30**；失败是否实际计费未知，不将未知用量写零。2 次已返回用量为合计 14,210 输入/6 输出；成功 harness 5 次合计非缓存输入 5,413、缓存读取 65,408、输出 777（按 DSH 原始字段保留），内核翻译另外计数。不再调用真实模型。
- 真实 BabelDOC 0.6.4：经 MCP 导入原创两页样本，本轮识别 **13 单元**；人工以源文作为接受内容，导出 PDF/MD/JSON，关闭后移动完整数据目录，再启动、编辑草稿并重放同一快照。MD/JSON 字节完全相同；PDF 元数据导致文件摘要不同，但两页 Poppler 1200px 渲染摘要逐页相同：`020dc5e9380c02b57d8a00a4b06dcfabf9c39dbc4131ebd051ed6bd0bbc7976a`、`f0b7acc0f1ef985cdaaba32a5fe3141080df317d94a415332ee61e0921d39a03`。目检保留公式、图注、重复段落与双栏；源文重放不是翻译质量评价，个别英文断词仍按上游边界保留。Poppler 报 Symbol/ArialUnicode display font 提示，渲染成功且公式可见。新增模型调用 **0**。
- 可复现 PDF 入口：`node scripts/smoke-mcp-pdf.mjs SOURCE.pdf PDF_CONFIG.json evaluation/runs/mcp-pdf-0.1.0`（当前脚本在给定父目录内自动创建独立的 `run-*` 子目录）。忽略目录 `evaluation/runs/mcp-0.1.0/` 保存测试、DSH 调度/用量、真实客户端导出观察记录；`evaluation/runs/mcp-pdf-0.1.0/` 保存 PDF 报告与渲染。没有提交凭据、用户数据库或私有原文。
- 本次不更新现有私有 Release 附件，不宣称其他 OS 的独立 PDF 包或新的 Sandbox 验收。指南版本绑定仍按 `release-documentation-binding` 留在发版前处理。

- Windows 本地分发包构建通过；使用包内 `runtime/node.exe` 和生产依赖启动 stdio，正式 SDK 客户端发现 31 个已挂载工具，capabilities 调用成功。未安装 PDF 时仅报告 txt/md 输入和 md/json 输出。

### 独立审查修复：HTTP 插件通知

HTTP 注册表变化改接 SDK handler 的服务级通知通道，工具和资源分别通知；每个请求只读取注册定义，不创建长期注册表监听。服务关闭或端口绑定失败时撤销订阅。旧协议无状态 HTTP 显式报告 `listChanged: false`，现代协议客户端订阅后接收装载／卸载通知；stdio 保留原连接内通知。独立审查的示例参数 `versionNegotiation: "auto"` 实际仍走旧协议，本轮按 SDK 正式形状 `{ mode: "auto" }` 验证现代协议，并同时覆盖旧协议声明。没有改变 PDF／翻译业务插件，也未调用真实模型。
`node --test test/mcp.test.mjs test/entries.test.mjs`：23/23 通过，覆盖现代协议装载／卸载通知、旧协议声明、请求后订阅数量、启动失败与关闭清理，以及 HTTP／CLI／stdio 既有路径。

## PR #18 审阅修复（2026-10-14）

- PDF 验收脚本在首次导出和重放时均断言 PDF/MD/JSON 恰好各一份，并校验快照归属。重启、迁移目录后接受一份不同的新修订，再重放旧快照；PDF 使用同一 Poppler 环境的 1200px 逐页 PPM 摘要比较（含页数），MD/JSON 比较字节。渲染工具仅为开发验收依赖。
- 注册表同步通知逐监听器隔离异常并记录 stderr，避免插件注册／注销状态与返回结果不一致；公共操作注册辅助函数独立于通用注册表，能力定义和 Cordis 依赖仍由各插件持有。
- stdio 带外错误只报告，实际传输关闭、stdin EOF／关闭及退出信号结束会话。保留 SDK 自身的关闭回调，避免损坏输出流时遗留内核。
- 脚本与测试拆卸在单步关闭失败后继续释放后续资源；脚本保证尝试写报告并保留原始失败。`readFile` 现在用于读取页面渲染产物，不再是未使用导入。
- MCP／入口及验收辅助回归 29/29 通过，涵盖通知异常、报错后继续请求、实际传输关闭、失败清理与缺失／重复格式。构建及隔离 npm 包 smoke 通过（58 文件）。
- Windows 真实 BabelDOC 原创两页样本导入 13 个单元；接受新修订后旧快照 PDF 两页渲染摘要相同，MD/JSON 字节相同，新增模型请求 0。报告保存在忽略目录 `evaluation/runs/mcp-pdf-review-0.1.0/report.json`。本次为回放一致性验证，不新增翻译质量或跨平台 PDF 验收声明。
- 上述修复待本 PR 合入 main；既有 follow-up 不标记完成。
- 全量 `npm test`：235 项中 234 通过；唯一失败为既有 `followups.test.mjs` 临时 Git 目录删除 EPERM。单独复测原失败用例通过、另一用例出现同类清理错误；未宣称全量通过。新增 [windows-followups-fixture-cleanup](../follow-ups/windows-followups-fixture-cleanup.md) 记录，未扩展本轮实现范围。

## 第二轮审阅修复（2026-10-15）

HTTP 关闭时即使 MCP endpoint 抛错，仍尝试结束 SSE 并关闭监听端口，最后传播首个清理错误；CLI finally 和启动器失败分支继续释放内核。MCP 订阅注销失败也不跳过 SDK handler 关闭。新增真实 CLI 故障注入，验证 SSE 结束、原端口重新绑定和 SQLite 重新打开。

`--stdio` 限于 `mcp` 命令，其他命令返回标准 INVALID_ARGUMENT JSON 错误。PDF 验收每次在父目录创建独立 run 子目录；报告写入失败时控制台结果为 passed:false，进程失败且保留验收与写入错误。

Windows 本地 `npm test` 239/239 通过（含构建）；针对性入口/MCP/启动器 33/33 通过。实际脚本连续两次使用缺失配置验证失败路径，创建不同 run 目录并分别留下 passed:false 报告；助手测试覆盖目录隔离、历史证据保留及报告写入失败。本轮未重跑未修改的 BabelDOC 渲染路径，沿用上一轮真实回放证据，新增模型请求 0。既有 windows-followups-fixture-cleanup 本轮未复现，不据此确认原因或关闭。

## PR #18 后续审阅修复（2026-10-16）

- HTTP MCP 工厂在订阅前检查可选入口是否安装，缺失时返回 `COMPONENT_MISSING`。Unit 资源发现元数据声明 `targetLang` 必填；SDK 2.3.1 对缺少或留空查询参数的 URI 在模板匹配阶段返回 `Resource not found`／`-32602`，非法语言标签进入内核校验，返回 `INVALID_ARGUMENT`／`-32602`，业务错误保留在 data。MCP 资源错误映射与协议文字同步。
- 真实 PDF 验收脚本在首次修订接受与重启后挑选编辑单元两处均遍历 `nextCursor`，覆盖超过默认 100 单元及首批无可翻译单元的情形。README 同步 MCP 已实现状态。stdio 去除不会收到错误值的等待分支，实际流错误仍沿用 SDK 错误处理和关闭路径。
- SDK 2.3.1 的 `registration.remove()` 同步调用 `update({ name: null })` 并删除内部注册项；其 HTTP handler 设置 `onclose` 时保存前一个回调并在关闭后恢复，当前无预设底层关闭回调。未添加掩盖注销失败的 catch 或重复关闭链。
- `npm test` 在本轮改动后的首次完整运行 240 项中 239 通过；失败是测试对缺失查询参数的 SDK 模板匹配预期错误。修正断言后最终完整运行 **240/240 通过**；针对缺失、空值及非法语言标签的 MCP 测试与 PDF 分页辅助测试 **16/16 通过**。隔离安装包 smoke **58 文件通过**，覆盖 MCP 发现和调用。未重跑真实 BabelDOC 渲染验收，既有原创两页实测证据仍见上文；新增模型调用为零。
