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
- 可复现 PDF 入口：`node scripts/smoke-mcp-pdf.mjs SOURCE.pdf PDF_CONFIG.json evaluation/runs/mcp-pdf-0.1.0`（输出目录应为新的验收目录）。忽略目录 `evaluation/runs/mcp-0.1.0/` 保存测试、DSH 调度/用量、真实客户端导出观察记录；`evaluation/runs/mcp-pdf-0.1.0/` 保存 PDF 报告与渲染。没有提交凭据、用户数据库或私有原文。
- 本次不更新现有私有 Release 附件，不宣称其他 OS 的独立 PDF 包或新的 Sandbox 验收。指南版本绑定仍按 `release-documentation-binding` 留在发版前处理。

- Windows 本地分发包构建通过；使用包内 `runtime/node.exe` 和生产依赖启动 stdio，正式 SDK 客户端发现 31 个已挂载工具，capabilities 调用成功。未安装 PDF 时仅报告 txt/md 输入和 md/json 输出。
