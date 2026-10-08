# PDF 公式映射、payload 与冻结回放一致性

- ID: pdf-formula-replay
- 状态: 处理中
- 实施分支／PR: [codex/0.1.0-pdf-formula-replay](https://github.com/KongouAirlines/ivaraige/tree/codex/0.1.0-pdf-formula-replay)，依赖 PR #10
- 类型: 缺陷
- 发现依据: 2026-10-08，[Issue #11](https://github.com/KongouAirlines/ivaraige/issues/11)，PR #7 合并后的 `a683f9b`；回调在 tracker 完成前复制 position，丢失 payload；相邻公式映射可能持久化为 null。
- 目标分支: main

## 问题与影响

未解决的公式显示映射可以进入翻译，但 PDF、Markdown、JSON 导出随后失败。人工改译文不能修复来源绑定。旧回放检查把带公式的文本记为 `present=null`，没有检查其内容；BabelDOC 0.6.4 还会把连续 20 个或更多特定标点缩为一个句点，使已接受文本与 PDF 不一致。

## 处理条件与范围

用户已要求接续 Issue #11。来源恢复放 PR #10；本分支处理完成后的 tracker 与位置关联、可靠 payload 显示映射、无法映射时的导入／翻译前置失败、精确接受投影及真实 PDF 验证。不新增手工来源绑定编辑器，不扩展 OCR 或双语输出。

## 验收条件

- 同文字不同位置的 payload 不串位，经过 SQLite 持久化和重启保持不变。
- 相邻公式、重复锚点、富文本 token 能可靠映射或在调用模型前明确失败；不得把未知映射替换为空。
- 原创实际公式样本通过接受／skip／三格式冻结导出／编辑后旧快照重放；导出零模型调用，逐页检查布局。
- 连续标点保留；公式文本检查不再以 null 当作通过。页级文本检查不能替代位置和视觉验收。

## 处理记录

- 2026-10-08：开始实施。新 Node 回归先复现导入未拒绝和旧数据消耗模型请求；修复后在导入及翻译前检查显示映射。Python 新回归先失败后通过。真实引擎证据随本分支验收补充，待合入 main。

- 2026-10-08：Windows 真实 BabelDOC 两页、14 单位验收完成，模型调用 0；完整 Node 190/190、Python 13/13 与 package smoke 通过。证据及限制见 [PDF 实施记录](../0.1.0/pdf.md)，待合入 main。
