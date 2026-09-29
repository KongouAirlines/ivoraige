# M1 技术验证结论

日期：2026-09-29｜状态：两条最小实验完成，可进入 M2；真实科研 PDF 质量验收留在 M3。

## 结论

1. **复用 DSH 模型模块可行。** Cordis + LlmRuntime + llm-pi-ai 的真实源码闭包已请求本地模拟 HTTP/SSE 服务，10 项检查通过；不需要启动完整 DSH 应用。M2 采用这条路线，详见 [ADR-0001](../../../decisions/0001-runtime-selection.md)。
2. **已有译文驱动 PDF 重建可行。** 注入点在 BabelDOC 的翻译器和段落适配层；MinerU 不负责翻译。两页原创样本的 7 条记录在首次及重复导出时均准确匹配，实际模型请求为零；PDF、Markdown、JSON 共用记录与修订。
3. **尚未完成科研 PDF 质量验收。** BabelDOC 将一个英文 We 误作非翻译内容留下；此次未验证双栏真实论文及 MinerU 块对齐。M1 验证的是接入机制，不是完整 MVP。

## 产物

| 内容 | 入口 |
|---|---|
| Cordis／DSH 固定源码、模块和限制 | [研究记录](cordis-harness.md) |
| 10 项真实模块实验与命令 | [实验 README](../../../../experiments/cordis-dsh/README.md) |
| pdf2zh-next／BabelDOC 注入、分块和排版证据 | [研究记录](pdf-translation-injection.md) |
| 两页控制样本和重放脚本 | [实验 README](../../../../experiments/pdf-injection/README.md) |
| PDF 与逐次运行证据（本地忽略） | `evaluation/runs/m1-pdf-injection/` |

第三方源码位于 `experiments/vendor/`；依赖、缓存和生成文件均忽略提交，保留项目实验代码及必要说明。未调用真实模型、未消耗翻译 API 额度、未读取留出参考答案。

## M2 的第一步

建立最小 CLI：读取文本和术语 → 调用已验证的 DSH 模型模块 → 保存译文记录 → 导出 Markdown／JSON → 无变更重跑复用记录。先用原创控制例子验证流程，再用 M0 开发集连接用户配置的实际模型。采用简单存储与显式配置，不提前建设完整 UI、通用工作流或额外框架。

持久译文使用项目自己的稳定 ID 和修订；BabelDOC 随机 debug_id 不可当作持久主键。实验采用页码＋位置并核对请求文本，只适用于相同 PDF、版本和配置。M3 再补 PDF 来源映射与解析覆盖检查。

M2 同时处理用量缺失被 SDK 补零的问题，未知用量不记为实测零。具体任务取消、术语组合和已接受译文保护属于项目业务逻辑，不能由框架生命周期代替。
