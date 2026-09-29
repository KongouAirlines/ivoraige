# 项目文档

## 目录约定

| 目录 | 用途 | 当前内容 |
|---|---|---|
| `requirements/v1.0/` | 已有需求与候选工具的版本基线 | 四份原始 Markdown、归档说明和校验清单 |
| `plans/` | 实施范围、里程碑与验收标准 | MVP 启动建议稿、M0 范围与评审方案 |
| `research/` | 技术调查、资料入口与验证问题 | Cordis／Harness 调研提纲、M0 样本来源 |
| `decisions/` | 重要架构决策及理由 | 待填写的运行时选择决策记录 |

阅读顺序：需求基线 → MVP 计划 → 调研与验证 → 架构决策。原始文件保持原样；后续范围建议写入计划，技术结论写入决策记录。

## 当前规划

- [代理协作规则](../AGENTS.md)：轻量子代理优先、任务边界、模型升级与私有语料处理。
- [功能需求概览 v1.0](requirements/v1.0/01_功能需求概览_v1.0.md)：44 项需求及当前优先级。
- [候选工具与初步选型 v1.0](requirements/v1.0/02_候选工具与初步选型_v1.0.md)：16 组、83 个候选条目，非最终选型。
- [v1.0 更新记录](requirements/v1.0/CHANGELOG.v1.0.md)。
- [历史来源记录](requirements/v1.0/sources.v1.0.md)：其中能力结论仍以原查阅日期为准。
- [归档来源与完整性](requirements/v1.0/IMPORT.md)。
- [启动与 MVP 计划](plans/mvp-startup.md)：本次新增，状态为建议稿。
- [M0 范围、样本与验收准备](plans/m0-scope-and-evaluation.md)：范围与评审方案已补齐，9 份候选材料已归档，正文与对齐待校核。
- [M0 任务分工与进度](plans/m0-tasks.md)：每项任务的依赖、执行模型、文件所有权和验收要求。
- [M0 样本目录与来源](research/m0-sample-catalog.md)：核心材料与后备池，分别记录核实／取得状态。
- [评估材料与原创控制样本](../evaluation/README.md)：六个原创例子与运行评审模板，尚未执行。
- [Cordis／Harness 调研](research/cordis-harness.md)：本次官方资料初查与待执行实验。
- [ADR-0001 运行时选择](decisions/0001-runtime-selection.md)：尚未决策。
