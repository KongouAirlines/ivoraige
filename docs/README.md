# 文档导航

ivoraige 是供人和 AI 共用、可自由组合的翻译与文件处理基础设施。详细指南目前以中文为主。按用途阅读下列三层文档；规划与历史验收均不能代替当前能力说明。

| 层次 | 入口与适用边界 |
| --- | --- |
| 当前使用与实现参考 | 软件 `0.1.0` 的[能力表](plan/0.1.0/capabilities.md)、使用指南，以及 v2 API 中明确标注的当前实现子集 |
| 拟议改造 | [0.1.x 计划](plan/0.1.x/README.md)与[契约草案](requirements/0.1.x/contracts.md)：逐项实现和验收前，不视为已启用行为或发布承诺 |
| 历史证据 | [0.1.0 阶段记录](plan/0.1.0/README.md)、历史报告、[0.0.0 MVP 归档](plan/mvp/README.md)与冻结的 v1 需求；按各自日期和提交阅读 |

## 使用 ivoraige

- [安装与首次启动](plan/0.1.0/installation-guide.md)：公开源码启动、可选 PDF、本地 npm 包与用户数据；旧 Release 附件已撤下。
- [文本与 Markdown 工作台](plan/0.1.0/workbench-guide.md)：模型配置、翻译、人工审校与输出。
- [PDF 工作台](plan/0.1.0/pdf-guide.md)：组件准备后的导入、来源检查、审校及导出。
- [设置指南](plan/0.1.0/settings-guide.md)：模型、提供商、凭据和组件。
- [能力与限制](plan/0.1.0/capabilities.md)：当前已合入能力与平台边界。
- [MCP 客户端接入](plan/0.1.0/mcp-guide.md)：stdio／Streamable HTTP、共享内核与客户端权限。

<a id="方向与参与"></a>

## 开发与后续规划

- [源码运行与贡献](plan/0.1.0/development-guide.md)、[PDF 开发参考](plan/0.1.0/pdf-development.md)、[发行与验收维护指南](plan/0.1.0/installation-maintenance.md)。
- [0.1.x 首轮计划](plan/0.1.x/README.md)：工作包、依赖、迁移分发、桌面子方案和验收链；[统一提示词](plan/0.1.x/prompts.md)引用共同开发约束。
- [0.1.0 基础候选](plan/0.1.0/foundation-plan.md)、[npm 就绪准备](plan/0.1.0/npm-readiness.md)与[后续候选范围](plan/0.1.x/releases.md)：待实施内容，不是上架排期。
- [UI 与设置设计](requirements/0.1.x/ui.md)：独立普通翻译、导航、模型/连接与管理职责。
- [可组合工作流与内容工作台](requirements/0.1.x/workflows.md)、[格式与软件协作路线](plan/0.1.x/formats-integrations.md)：默认链组合化、保存/版本/追溯、DOCX/EPUB/Office 分级与客户端支线；均待实施。
- [后续事项规则与记录](plan/follow-ups/README.md)：稳定 ID 与单项状态的来源；规划拆分不自动关闭旧事项。
- [代理工作规则](../AGENTS.md)：开发操作约束，不替代用户指南或进度表。

<a id="架构与协议"></a>

## 设计与规范

- [需求、设计与协议导航](requirements/README.md)：区分冻结需求、v2 现行子集与拟议替代关系。
- [插件组合契约 ADR-0002](decisions/0002-plugin-composition-0.1.0.md)：已采纳原则；[ADR-0001](decisions/0001-runtime-selection.md)保留早期运行时决策依据。
- [术语适用范围补充](requirements/amendments/0001-term-applicability.md)：保持原范围约束；不表示术语库已交付。
- [选型调研](research/tool-selection-v1.1.md)：按调研时点使用，接入前仍需核验实际版本与契约。

## 实施证据与历史

- [0.1.0 实施记录](plan/0.1.0/README.md)：历史阶段、分支与验证；此前产品方向见[0.1.0 路线图](plan/0.1.0/roadmap.md)。
- [历史 PR 审查归档](plan/0.1.0/pr-review/README.md)与[136 条历史发现 → 75 个主题的来源映射](plan/0.1.x/audit/README.md)：保留原发现和固定基线，不是实时缺陷计数。
- [公开准备记录](plan/0.1.0/public-readiness.md)、[PDF 实际包审计](plan/0.1.0/pdf-license-audit.md)：前者保存阶段快照，后者的剩余分发条件仍须验收。
- [MVP 历史](plan/mvp/README.md)：旧软件 `0.0.0` 已归档，旧任务表不再驱动开发。
- [v1.0 需求归档来源](requirements/v1.0/IMPORT.md)：原件、需求 ID 和导入记录保留。

`0.1.0` 是当前软件源码版本，`0.1.0-dev.0` 只标识旧安装组件与历史验收；`v1.0`／`v2.0` 是文档基线版本，`0.1.x` 是拟议改造的目标软件系列。插件、schema 与外部引擎版本独立表达。发版时仍须将指南绑定到实际源码和产物，见[发行维护指南](plan/0.1.0/installation-maintenance.md)。
