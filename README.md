# ivoraige — MVP 0.0.0 归档

旧 MVP（M0～M4）已弃用，完整代码保留在独立分支 `codex/archive-mvp-0.0.0`，本地标签为 `v0.0.0`。2026-10-03 按用户决定将旧 MVP 统一标为 `0.0.0`，替代此前的 `0.2.0` 标记；不改写历史提交。后续开发在 `codex/restart-v2` 按新设计从头进行。

下文为历史功能及复现说明，不代表当前重建分支的能力。

可按需组装的通用翻译中间层，以科研英汉为首个应用。CLI 支持翻译、术语管理、选择译文版本及 Markdown／JSON 导出；固定 BabelDOC 适配器已在真实 MuMax3 PDF 第 1／2／4 页验证同一接受修订生成 PDF／Markdown／JSON 与零正文模型重导出。M3.1 的另一篇论文快速试译已由用户验收通过；PDF 仍限于固定引擎与配置，尚非任意 PDF 的全自动成品工具。

核心目标：不同输出共用同一份已接受译文，术语知识能够跨任务复用。

后续以[阶段总结与实施原则](docs/plan/mvp/retrospective.md)为准：算法与通用接口优先，不额外降低接入工具的质量，不将人工二次审阅或逐篇版面精修设为默认流程。[M3.1 模块边界整理](docs/plan/mvp/m3.1/README.md)已拆分核心记录、来源处理和 PDF 输出适配，R03 专用修复默认关闭。当前仍需显式接受修订，自动版本选定及第二个真实解析器接入尚待实现。

按用户选择，跳过拟议的 M3.2，[M4 已完成](docs/plan/mvp/m4/completion.md)：新增 `list`／`status`、`accept-drafts` 批量版本选择及配置默认值，以简化 CLI 和使用说明收尾 MVP。自动质量策略、占位符合理重排、排版、Web UI 和外部词典保留为后续改进；[pdf2zh-next 实现参考](docs/research/pdf2zh-next-mvp-reference.md)已保存。

- [文档导航](docs/README.md)
- [代理协作与模型分工规则](AGENTS.md)
- [功能需求与优先级 v1.0](docs/requirements/v1.0/01_功能需求概览_v1.0.md)
- [术语分类与适用范围需求补充](docs/requirements/amendments/0001-term-applicability.md)
- [当前工具与插件选型 v1.1](docs/research/tool-selection-v1.1.md)
- [项目启动与 MVP 计划（建议稿）](docs/plan/mvp/plan.md)

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

已有 M1 固定源码和局部依赖时可直接 build。固定版本与许可见 [第三方说明](THIRD_PARTY.md)，原创文本和具体导入、翻译、确认、双出口命令见 [示例](examples/README.md)，PDF 代表页路线见 [M3 完成记录](docs/plan/mvp/m3/README.md)。只在执行翻译／建库时需要模型；接受后重导出可独立运行。默认联网关闭，端点和模型名由配置显式指定；无隐式远程兜底。运行记录建议保存到已忽略的 `evaluation/runs/`。
