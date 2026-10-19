# 文档导航

ivoraige 是供人和 AI 共用、可自由组合的翻译与文件处理基础设施。先按你的目的选择入口；当前详细指南以中文为主。

## 使用 ivoraige

- [安装与首次启动](plan/0.1.0/installation-guide.md)：Windows 便携包、按需组件与用户数据。
- [文本与 Markdown 工作台](plan/0.1.0/workbench-guide.md)：模型配置、翻译、人工审校与输出。
- [PDF 工作台](plan/0.1.0/pdf-guide.md)：安装后的导入、来源检查、审校及导出。
- [设置指南](plan/0.1.0/settings-guide.md)：模型、提供商、凭据和组件。
- [能力与限制](plan/0.1.0/capabilities.md)：当前已合入能力与平台边界。
- [MCP 客户端接入](plan/0.1.0/mcp-guide.md)：stdio／Streamable HTTP、共享内核与客户端权限；目前从源码运行。

## 方向与参与

- [产品定位与路线图](plan/0.1.0/roadmap.md)：多场景、按需组合，以及未来方向。
- [源码运行与贡献](plan/0.1.0/development-guide.md)。
- [PDF 开发参考](plan/0.1.0/pdf-development.md)。
- [发行与验收维护指南](plan/0.1.0/installation-maintenance.md)。
- [后续事项规则与记录](plan/follow-ups/README.md)：未完成范围与实际状态。

## 架构与协议

- [插件组合契约 ADR-0002](decisions/0002-plugin-composition-0.1.0.md)与[代理工作规则](../AGENTS.md)。
- v2.0 [架构](requirements/v2.0/01_design_v2.0.md)、[UI 设计](requirements/v2.0/02_UI-design_v2.0.md)、[API 协议](requirements/v2.0/03_API-protocol_v2.0.md)。设计目标不等于当前可用功能。
- [术语适用范围补充](requirements/amendments/0001-term-applicability.md)。
- [运行时决策 ADR-0001](decisions/0001-runtime-selection.md)与[选型调研](research/tool-selection-v1.1.md)。

## 实施证据与历史

- [0.1.0 实施记录](plan/0.1.0/README.md)：按日期保留阶段范围、验证与当时状态。
- [PDF 记录](plan/0.1.0/pdf.md)、[安装记录](plan/0.1.0/installation.md)。
- [MVP 历史](plan/mvp/README.md)：旧 0.0.0 已归档，不作为当前能力证明。
- [v1.0 需求基线](requirements/v1.0/01_功能需求概览_v1.0.md)、[归档来源](requirements/v1.0/IMPORT.md)：保留原编号与历史范围。

软件版本为 0.1.0-dev.0；设计基线版本为 v2.0。发布前的文档与安装包版本对应由 [release-documentation-binding](plan/follow-ups/release-documentation-binding.md) 跟踪。
