# 文档导航

ivoraige 是供人和 AI 共用、可自由组合的翻译与文件处理基础设施。详细指南目前以中文为主。请按用途阅读下列三层文档；规划与历史验收均不能代替当前能力说明。

| 文档层次 | 入口与适用边界 |
| --- | --- |
| 当前使用与实现参考 | 软件 `0.1.0` 的[能力与限制](plan/0.1.0/capabilities.md)、各项用户指南，以及 [v2.0 API 协议](requirements/v2.0/03_API-protocol_v2.0.md)中明确标注的当前实现子集 |
| 拟议改造与后续规划 | [0.1.x 首轮计划](plan/0.1.x/README.md)与[契约草案](requirements/0.1.x/contracts.md)：逐项实现和验收前，不视为已启用行为或发布承诺 |
| 历史证据与冻结需求 | [0.1.0 阶段记录](plan/0.1.0/README.md)、历史审查与审计报告、[0.0.0 MVP 归档](plan/mvp/README.md)及冻结的 [v1.0 需求](requirements/v1.0/01_功能需求概览_v1.0.md)；按各自日期和提交阅读 |

## 使用 ivoraige

面向日常使用、模型配置与客户端接入的操作说明：

- [能力与限制](plan/0.1.0/capabilities.md)：当前已合入能力、支持范围与平台边界总览。
- [安装与首次启动](plan/0.1.0/installation-guide.md)：公开源码启动、可选 PDF、本地 npm 包、数据备份与离线独立来源插件安装（旧 Release 附件已撤下）。
- [文本与 Markdown 工作台](plan/0.1.0/workbench-guide.md)：导入、模型翻译、人工审校、快捷键与冻结输出。
- [PDF 工作台](plan/0.1.0/pdf-guide.md)：组件准备后的导入、来源覆盖检查、审校、冻结导出与可选 MinerU 实验插件说明。
- [设置指南](plan/0.1.0/settings-guide.md)：模型、提供商、凭据、参数校验与 PDF 组件状态管理。
- [提示词库](plan/0.1.0/prompt-library-guide.md)：逐单位翻译提示词模板、连接绑定、单次覆盖与修订追溯。
- [MCP 客户端接入](plan/0.1.0/mcp-guide.md)：stdio／Streamable HTTP 接入、共享内核、工具映射与任务／产物管理。

<a id="方向与参与"></a>

## 开发与后续规划

面向源码开发、组件构建与 `0.1.x` 演进路线：

- **源码开发与维护**：[开发与源码运行指南](plan/0.1.0/development-guide.md)、[PDF 开发参考](plan/0.1.0/pdf-development.md)、[发行与验收维护指南](plan/0.1.0/installation-maintenance.md)。
- **0.1.x 组合改造规划**：[0.1.x 首轮计划](plan/0.1.x/README.md)（工作包、依赖总图、迁移分发、桌面子方案和验收链）与[统一任务提示词](plan/0.1.x/prompts.md)。
- **版本范围与基础准备**：[0.1.0 基础优先缘由](plan/0.1.0/foundation-plan.md)、[npm 就绪准备](plan/0.1.0/npm-readiness.md)与[候选版本范围](plan/0.1.x/releases.md)（待实施内容，不是上架排期）。
- **UI、工作流与格式协作草案**：[UI 与设置设计](requirements/0.1.x/ui.md)、[可组合工作流与内容工作台](requirements/0.1.x/workflows.md)、[格式与软件协作路线](plan/0.1.x/formats-integrations.md)（均待实施）。
- **后续事项与代理规则**：[后续事项规则与记录](plan/follow-ups/README.md)（稳定 ID 与单项状态的唯一来源）、[代理工作规则](../AGENTS.md)（开发操作约束，不替代用户指南或进度表）。

<a id="架构与协议"></a>

## 设计与规范

- [需求、设计与协议导航](requirements/README.md)：区分 v1.0 冻结需求、v2.0 现行子集与 0.1.x 拟议替代关系。
- [插件组合契约 ADR-0002](decisions/0002-plugin-composition-0.1.0.md)：已采纳的组合与能力归属原则；[ADR-0001](decisions/0001-runtime-selection.md) 保留早期运行时选型依据。
- [术语适用范围补充 0001](requirements/amendments/0001-term-applicability.md)：保持术语适用性范围约束（不表示术语库已交付）。
- [选型调研](research/tool-selection-v1.1.md)：按调研时点参考，接入前仍需核验实际版本与契约。

## 实施证据与历史

- [0.1.0 实施记录](plan/0.1.0/README.md)：历史阶段、分支与验证结论；此前产品方向见 [0.1.0 路线图](plan/0.1.0/roadmap.md)。
- [历史 PR 审查归档](plan/0.1.0/pr-review/README.md)与[136 条历史发现 → 75 个主题的来源映射](plan/0.1.x/audit/README.md)：保留原发现和固定基线，不是实时缺陷计数。
- [公开准备记录](plan/0.1.0/public-readiness.md)、[PDF 实际包审计](plan/0.1.0/pdf-license-audit.md)：前者保存阶段快照，后者的剩余分发条件仍须验收。
- [MVP 历史归档](plan/mvp/README.md)：旧软件 `0.0.0` 已归档，旧任务表不再驱动开发。
- [v1.0 需求归档来源](requirements/v1.0/IMPORT.md)：原件、需求 ID 和导入记录保留。

---

**版本标识约定**：`0.1.0` 是当前软件源码版本，`0.1.0-dev.0` 仅标识旧安装组件与历史验收；`v1.0`／`v2.0` 是设计文档基线版本，`0.1.x` 是拟议改造的目标软件系列。插件、持久化 schema 与外部引擎版本独立演进。发版时仍须将指南绑定到实际源码和产物，见[发行维护指南](plan/0.1.0/installation-maintenance.md)。
