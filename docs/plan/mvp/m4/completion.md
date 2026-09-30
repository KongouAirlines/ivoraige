# M4：CLI 使用完善与 MVP 收尾

日期：2026-09-30。按用户选择，以简化 CLI 交付个人使用入口，跳过拟议的 M3.2 自动质量／占位符改造。

## 交付范围

- `list`／`status` 提供文档摘要、草稿和接受版本 ID、可导出状态，减少读取完整记录的操作。
- JSON 配置的 `defaults` 保存文本导入语言、默认词库和 Markdown／JSON 输出路径，命令行参数优先。模型继续复用现有 DSH 接口，配置仅保存密钥环境变量名。
- `accept-drafts` 显式批量选择当前适用草稿；过期或缺少草稿的单位报告跳过，已有接受版本不覆盖。它是版本选择操作，不要求逐段审阅，也不声称自动保证科学语义正确。
- 保留导入、翻译、选择、导出的简单分步流程。同一 ID 与内容复用记录，已接受且适用的译文直接复用；没有新增一套任务状态机或重复翻译核心。

配置和完整命令见[使用示例](../../../../examples/README.md)。在项目根目录、模型配置好后，最短文本流程为：

```powershell
node src/cli.mjs import examples/scientific-en.txt --id sample --config examples/model.local.json
node src/cli.mjs translate sample --config examples/model.local.json
node src/cli.mjs accept-drafts sample --config examples/model.local.json
node src/cli.mjs export sample --config examples/model.local.json
```

用 `status sample` 查看待处理单位，`show sample` 查看具体草稿。若已有接受版本因源文或约束变化而过期，用 `confirm` 显式选择新的修订；批量操作不替换已有版本。部分失败后可先选定成功草稿，再运行翻译以复用已选结果；未选择的草稿重跑仍可能再次调用模型，当前不是持久任务恢复系统。

## MVP 的实际边界

文本入口可日常使用；PDF 仍采用固定 BabelDOC 来源快照、接受清单与回放出口，安装和捕获步骤见 [M3 环境与完成记录](../m3/README.md)。`import-pdf` 接收快照 JSON，不是直接接收任意 PDF；M4 没有新增一键 PDF 导入器。三出口同修订与零正文模型重导出沿用 M3／M3.1 证据。

本阶段完成的是既定核心闭环加 CLI 使用完善，不等于 v1.0 全部 44 项需求完成。Web UI、外部词典、库结构、自动选定策略、占位符合理重排和排版提升见[后续建议](../retrospective.md)。pdf2zh-next 的[固定源码参考](../../../research/pdf2zh-next-mvp-reference.md)已保存，本轮没有为了对照重复翻译论文。

## 验证

`npm test` 完成固定 DSH 构建及 **16/16** 测试。新增 CLI 集成测试使用原创文本与本机模拟模型，核对配置、持久记录、版本选择、导出、重复运行零新增调用、已有接受版本保护及过期草稿跳过。既有文本、来源结构、模型取消和失败处理测试保持通过；未新增真实模型调用或重跑论文排版。

M4 最小范围已完成，MVP 按上述实际边界收尾。下一步优先在日常使用中积累具体问题，再从总结中的建议选择独立改进，不立即追加新的 MVP 前置阶段。
