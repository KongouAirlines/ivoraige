# PDF 子进程取消后的临时目录回收

- ID: pdf-sidecar-work-cleanup
- 状态: 已解决
- 实施分支／PR: [codex/0.1.0-pdf-formula-replay](https://github.com/KongouAirlines/ivaraige/tree/codex/0.1.0-pdf-formula-replay)，依赖 PR #10
- 类型: 改进
- 发现依据: 2026-10-08，[Issue #11](https://github.com/KongouAirlines/ivaraige/issues/11) 及 PR #7 的清理限制；强杀 Python 无法执行其 finally。
- 目标分支: main

## 问题与影响

原有 Python 清理只覆盖能正常收尾的调用。取消或进程崩溃可能留下本次 session 的解析中间文件与缓存；这不等于存在远程数据读取漏洞。

## 处理条件与范围

父进程为每次 sidecar 启动创建专属目录，在 child close 后回收。只删除父进程自己创建的目录；保留用户配置的工作根及无关文件。不扫描或回收历史目录，不处理父进程被强杀或整机断电后的残留。

## 验收条件

- 正常关闭、启动失败、崩溃重试、取消均等待 child close 后清理。
- 工作根、无关 sibling 和最终产物保留；清理失败明确可见。
- 真实 BabelDOC 运行完成后验证当前 session 清理；父进程不可执行清理的限制保留。

## 处理记录

- 2026-10-08：Node 为每次 spawn 创建目录，并通过 configure.options.workDir 传给 Python；模拟 sidecar 生命周期测试 13/13 通过。待真实引擎验收及合入 main。

- 2026-10-08：Windows 真实 BabelDOC 两页、14 单位验收完成，模型调用 0；完整 Node 190/190、Python 13/13 与 package smoke 通过。证据及限制见 [PDF 实施记录](../0.1.0/pdf.md)，待合入 main。

- 2026-10-11：已核对修复随 PR #10／#12 合入 main/4df1d72；最终三平台 Node24 CI（Python、Node、package smoke）通过：[run 38077245588](https://github.com/KongouAirlines/ivaraige/actions/runs/38077245588)。真实 Windows PDF 证据见 [实施记录](../0.1.0/pdf.md)。按本事项范围关闭；不扩大为上游解析质量或三平台原生 PDF 发行保证。
