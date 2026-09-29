# 项目文档

## 目录约定

| 目录 | 用途 | 当前内容 |
|---|---|---|
| `requirements/v1.0/` | 已有需求与候选工具的版本基线 | 四份原始 Markdown、归档说明和校验清单 |
| `plan/mvp/` | MVP 总计划及 M0～M4 分阶段规划与记录 | 按阶段独立组织 |
| `research/` | 跨阶段技术调查与候选池 | 当前选型、DSH 插件候选、Cordis 生态候选 |
| `decisions/` | 重要架构决策及理由 | M2 运行时选择决策记录 |

阅读顺序：需求基线 → [MVP 分阶段规划](plan/mvp/README.md) → 跨阶段调研与决策。原始文件保持原样；后续范围建议写入计划，技术结论写入决策记录。

## 当前规划

- [代理协作规则](../AGENTS.md)：轻量子代理优先、任务边界、模型升级与私有语料处理。
- [功能需求概览 v1.0](requirements/v1.0/01_功能需求概览_v1.0.md)：44 项需求及当前优先级。
- [需求补充 01：术语分类与适用范围](requirements/amendments/0001-term-applicability.md)：补充 F-14／F-15／F-17，待库结构明确后实施，不作为 M3 前置。
- [候选工具与初步选型 v1.0](requirements/v1.0/02_候选工具与初步选型_v1.0.md)：16 组、83 个候选条目，非最终选型。
- [当前选型 v1.1](research/tool-selection-v1.1.md)：承接原候选池，补充 DSH／Cordis 生态插件、组件依赖与接入顺序；需求版本仍为 v1.0。
- [v1.0 更新记录](requirements/v1.0/CHANGELOG.v1.0.md)。
- [历史来源记录](requirements/v1.0/sources.v1.0.md)：其中能力结论仍以原查阅日期为准。
- [归档来源与完整性](requirements/v1.0/IMPORT.md)。
- [MVP 分阶段规划与记录](plan/mvp/README.md)：M0～M4 独立目录、总计划与阶段记录。
- [ADR-0001 运行时选择](decisions/0001-runtime-selection.md)：M2 采用 Cordis＋DSH 模型模块。
