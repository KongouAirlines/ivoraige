# ivoraige

可按需组装的通用翻译中间层，以科研英汉为首个应用。M0、M1 与 M2 基本文本闭环已实现；现在可用 CLI 翻译、管理术语、确认译文并同源导出 Markdown／JSON。科研质量完整验收与 PDF 闭环仍待后续。

核心目标：不同输出共用同一份已接受译文，术语知识能够跨任务复用。

- [文档导航](docs/README.md)
- [代理协作与模型分工规则](AGENTS.md)
- [功能需求与优先级 v1.0](docs/requirements/v1.0/01_功能需求概览_v1.0.md)
- [术语分类与适用范围需求补充](docs/requirements/amendments/0001-term-applicability.md)
- [当前工具与插件选型 v1.1](docs/research/tool-selection-v1.1.md)
- [项目启动与 MVP 计划（建议稿）](docs/plans/mvp-startup.md)
- [M0：范围、样本与验收准备](docs/plans/m0-scope-and-evaluation.md)
- [M0 任务分工与进度](docs/plans/m0-tasks.md)
- [M0 交付报告](docs/plans/m0-completion-report.md)：002已落实用户反馈，001出版摘录快照保留。
- [M1 技术验证结论](docs/plans/m1-completion-report.md)
- [M2 文本闭环与插件关系规划](docs/plans/m2-text-workflow.md)
- [M3 PDF 闭环与注入维护规划](docs/plans/m3-pdf-workflow.md)
- [M2 工程验收与真实本地小样](docs/plans/m2-completion-report.md)
- [M2 真实业务验收与质量问题](docs/plans/m2-real-acceptance.md)
- [Cordis 与 DeepSeek Harness 模块复用实验](docs/research/cordis-harness.md)
- [PDF 已有译文注入实验](docs/research/pdf-translation-injection.md)

需求版本 v1.0 不等于软件版本或首批交付范围。后续实施以需求基线为依据，通过小规模验证收敛技术方案。

## 运行文本 CLI

需要 Node.js 24 或更新版本。干净 checkout 首次准备固定第三方源码与依赖：

```powershell
npm ci
npm run setup:dsh
npm run build
npm test
node src/cli.mjs --help
```

已有 M1 固定源码和局部依赖时可直接 build。固定版本与许可见 [第三方说明](THIRD_PARTY.md)，原创文本和具体导入、翻译、确认、双出口命令见 [示例](examples/README.md)。只在执行翻译／建库时需要模型；其他操作可以独立运行。默认联网关闭，端点和模型名由配置显式指定；无隐式远程兜底。运行记录建议保存到已忽略的 `evaluation/runs/`。
