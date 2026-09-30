# ivoraige

可按需组装的通用翻译中间层，以科研英汉为首个应用。M0～M3 工程阶段已完成：CLI 支持翻译、术语管理、接受译文及 Markdown／JSON 导出；固定 BabelDOC 适配器已在真实 MuMax3 PDF 第 1／2／4 页验证同一接受修订生成 PDF／Markdown／JSON 与零正文模型重导出。PDF 处理限于已核代表页和固定配置，科研译文仍待用户专业签认。

核心目标：不同输出共用同一份已接受译文，术语知识能够跨任务复用。

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
