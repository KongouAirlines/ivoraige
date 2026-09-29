# 项目文档

## 目录约定

| 目录 | 用途 | 当前内容 |
|---|---|---|
| `requirements/v1.0/` | 已有需求与候选工具的版本基线 | 四份原始 Markdown、归档说明和校验清单 |
| `plans/` | 实施范围、里程碑与验收标准 | MVP 启动建议稿、M0 范围与评审方案 |
| `research/` | 技术调查、资料入口与实验结果 | Cordis／DSH、PDF 注入实验与 M0 样本来源 |
| `decisions/` | 重要架构决策及理由 | M2 运行时选择决策记录 |

阅读顺序：需求基线 → MVP 计划 → 调研与验证 → 架构决策。原始文件保持原样；后续范围建议写入计划，技术结论写入决策记录。

## 当前规划

- [代理协作规则](../AGENTS.md)：轻量子代理优先、任务边界、模型升级与私有语料处理。
- [功能需求概览 v1.0](requirements/v1.0/01_功能需求概览_v1.0.md)：44 项需求及当前优先级。
- [候选工具与初步选型 v1.0](requirements/v1.0/02_候选工具与初步选型_v1.0.md)：16 组、83 个候选条目，非最终选型。
- [当前选型 v1.1](research/tool-selection-v1.1.md)：承接原候选池，补充 DSH／Cordis 生态插件、组件依赖与接入顺序；需求版本仍为 v1.0。
- [v1.0 更新记录](requirements/v1.0/CHANGELOG.v1.0.md)。
- [历史来源记录](requirements/v1.0/sources.v1.0.md)：其中能力结论仍以原查阅日期为准。
- [归档来源与完整性](requirements/v1.0/IMPORT.md)。
- [启动与 MVP 计划](plans/mvp-startup.md)：本次新增，状态为建议稿。
- [M0 范围、样本与验收准备](plans/m0-scope-and-evaluation.md)：002已落实用户反馈，001出版摘录快照保留。
- [M0 交付报告](plans/m0-completion-report.md)：24 个对齐单位、12／12 划分、16 个术语义项及实际 PDF 版面样本。
- [M0 任务分工与进度](plans/m0-tasks.md)：每项任务的依赖、执行模型、文件所有权和验收要求。
- [M0 样本目录与来源](research/m0-sample-catalog.md)：核心材料与后备池，分别记录核实／取得状态。
- [评估材料与原创控制样本](../evaluation/README.md)：六个原创例子与运行评审模板，尚未执行。
- [M1 技术验证结论](plans/m1-completion-report.md)：模块复用与 PDF 译文回放已验证，M2 下一步。
- [Cordis／Harness 调研](research/cordis-harness.md)：固定源码与真实模块接入实验，10 项检查通过。
- [PDF 译文注入实验](research/pdf-translation-injection.md)：两页原创样本、7 条记录、三出口与重跑复用。
- [ADR-0001 运行时选择](decisions/0001-runtime-selection.md)：M2 采用 Cordis＋DSH 模型模块。
