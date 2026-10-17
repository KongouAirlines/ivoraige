# Windows 后续事项测试临时目录清理失败

- ID: windows-followups-fixture-cleanup
- 状态: 待评估
- 实施分支／PR: 未安排
- 类型: 缺陷
- 发现依据: 2026-10-14，codex/0.1.0-mcp（基线 87c7292）审阅修复验证；test/followups.test.mjs:23 的 rmSync 报 EPERM。
- 目标分支: main

## 问题与影响

Windows、Node 26.7.0 本地全量运行 235 项中 234 通过，唯一失败发生在 followups 临时 Git 仓库清理。随后单独复测时原失败用例通过，另一用例在相同清理处失败。尚未确认占用来源，不断言是产品回归或已确定的 Node 缺陷。日志在忽略目录 evaluation/runs/mcp-review-0.1.0/tests.log；可能留下 .followups-test-* 目录。

## 处理条件与范围

与 MCP 注册、传输和 PDF 重放业务无关，本次不修改测试清理策略。后续测试基础设施维护或 Windows CI 出现同类错误时，检查文件占用、Git 进程退出和受支持 Node 版本差异；确认原因后再决定是否需要有界清理重试。

## 验收条件

- 能说明触发原因，并在受影响 Windows 环境重复运行该测试通过。
- 不吞掉断言或最终清理错误，不把测试临时目录加入正式包。
- 清理始终限定在本次测试创建的目录内。

2026-10-15：PR #18 第二轮修复的 Windows 本地全量测试 239/239 通过，未复现 EPERM；清理实现未调整，原因仍未确认，保持待评估。
