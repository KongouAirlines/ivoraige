# 0.1.0 项目介绍与文档整理

2026-10-13，分支 `codex/0.1.0-documentation` 基于 `main/0a185d4`，与 MCP PR #18 平行。

## 实现范围

英文主 README 与完整中文版重写，面向学习者与兴趣翻译者，覆盖复合场景；使用真实工作台原创小说截图。项目短简介同步为 “Composable translation and file-processing infrastructure for people and AI.”。

AGENTS 精简过时阶段信息，新增插件能力归属、契约依赖、缺件隔离、生命周期和上游兼容要求；ADR-0002 记录理由与适用边界。用户指南优先安装版流程，PDF 开发准备和引擎细节保留在独立开发参考；修正设置指南的旧安装描述及未随包分发的相对链接。新增能力表、路线图和开发入口，历史证据保留日期语境。

## 验证

- 本次文档的本地链接扫描 130 条，无缺失；双语 README 结构和能力声明人工对照，独立代理只读复核。
- 两版 README 使用本地 CommonMark/表格渲染预览目检；工作台截图来自 main/0a185d4、隔离数据库和原创样本，人工录入译文，零模型调用；截图来源见 docs/assets/0.1.0/README.md。
- npm 隔离安装 smoke 通过。当前 PR 的 [Node 24 三平台 CI](https://github.com/KongouAirlines/ivaraige/actions/runs/38418369286) 均输出 **59 文件**，与审阅者结果一致。2026-10-15 本地 Windows Node 26.7.0/npm 12.0.2 在 `00ce405` 基线上修正文档、重新构建并复测为 **54 文件**，与 2026-10-13 本地清单逐项相同；两者不是同一环境的结果，不把 54 写成当前 PR 的统一文件数。数量差异来源未确定。已确认本地包包含中文版、工作台截图和能力表，未包含 evaluation 数据；日志和清单位于忽略目录 `evaluation/runs/documentation-review-0.1.0/`。
- Windows 分发构建通过，8 个文档／图像文件与工作区字节一致，本地文档链接可解析；沿用现有运行时／启动／SQLite 构建探针，不冒充新的 Sandbox 验收。
- 本轮没有业务功能变更，没有 Index-Translate 接入或 DSH 宿主实现，没有真实模型请求，没有更改 Release 附件、tag 或仓库可见性。

## 后续与合并

新增 `index-translate-provider`（待评估）与 `dsh-host-integration`（暂缓、低优先级）；`release-documentation-binding` 补充本轮入口整理证据，仍为已安排，发行物版本绑定未完成。没有关闭其他事项。

MCP 是否可用以 PR #18 的实际合并状态为准；合并时统一核对 README 两种语言、能力表和文档导航，保留双方的指南与打包条目。当前 README 将 MCP 明确标为独立 PR 待合入。
`git merge-tree` 模拟与 MCP 提交 87c7292 合并：仅根 README.md 冲突（本分支整页重写，MCP 分支在旧页末尾追加指南）。能力代码、package.json、Windows 打包脚本和阶段记录自动合并。届时保留双语首页结构，加入已合入的 MCP 指南并同步中文页、能力表与导航；本次不提前合并 MCP。


## 审阅修正（2026-10-15）

PDF 开发准备明确限于 Windows x64，其他平台尚无本项目已验证的对应准备与发行流程。通用源码指南补齐 Linux/macOS 的 XDG_DATA_HOME 与 ~/.local/share/ivoraige 路径，以及 IVORAIGE_DATA_DIR 覆盖方式。对照源码及打包清单检查，构建和隔离安装 smoke 通过；不重跑未涉及的业务验收。
