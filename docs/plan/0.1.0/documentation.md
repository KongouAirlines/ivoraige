# 0.1.0 项目介绍与文档整理

**历史实施记录。** 下文保存 2026-10-13～17 的变更、合流和检查结果，含当时的安装优先级与待合入状态；不作为当前使用指引。当前入口见[文档导航](../../README.md)，后续规划见 [0.1.x](../0.1.x/README.md)。

2026-10-13，分支 `codex/0.1.0-documentation` 基于 `main/0a185d4`，与 MCP PR #18 平行。

## 实现范围

英文主 README 与完整中文版重写，面向学习者与兴趣翻译者，覆盖复合场景；使用真实工作台原创小说截图。项目短简介同步为 “Composable translation and file-processing infrastructure for people and AI.”。

AGENTS 精简过时阶段信息，新增插件能力归属、契约依赖、缺件隔离、生命周期和上游兼容要求；ADR-0002 记录理由与适用边界。用户指南优先安装版流程，PDF 开发准备和引擎细节保留在独立开发参考；修正设置指南的旧安装描述及未随包分发的相对链接。新增能力表、路线图和开发入口，历史证据保留日期语境。

## 验证

- 本次文档的本地链接扫描 130 条，无缺失；双语 README 结构和能力声明人工对照，独立代理只读复核。
- 两版 README 使用本地 CommonMark/表格渲染预览目检；工作台截图来自 main/0a185d4、隔离数据库和原创样本，人工录入译文，零模型调用；截图来源见 docs/assets/0.1.0/README.md。
- npm 隔离安装 smoke 通过。当前 PR 的 [Node 24 三平台 CI](https://github.com/KongouAirlines/ivaraige/actions/runs/38418369286) 均输出 **59 文件**。2026-10-15 本地 Windows Node 26.7.0/npm 12.0.2 在 `00ce405` 基线上修正文档、重新构建并复测为 **54 文件**。2026-10-16 用同一当前工作树分别运行 npm 10.9.4 和 12.0.2 的 `pack --dry-run --json`，得到 58 与 53 文件；两份清单的唯一差异是 npm 10 额外收录 `docs/README.md`、`docs/plan/README.md`、`docs/plan/0.1.0/README.md`、`docs/assets/0.1.0/README.md`、`examples/README.md`。本轮从包清单移除 `pdf.md` 阶段记录，故各比旧结果少一项。文件总数随打包工具变化；验收以必需文件、包内相对链接和排除内容为准。清单位于忽略目录 `evaluation/runs/documentation-review-0.1.0/`。
- Windows 分发构建通过，8 个文档／图像文件与工作区字节一致，本地文档链接可解析；沿用现有运行时／启动／SQLite 构建探针，不冒充新的 Sandbox 验收。
- 本轮没有业务功能变更，没有 Index-Translate 接入或 DSH 宿主实现，没有真实模型请求，没有更改 Release 附件、tag 或仓库可见性。

## 后续与合并

新增 `index-translate-provider`（待评估）与 `dsh-host-integration`（暂缓、低优先级）；`release-documentation-binding` 补充本轮入口整理证据，仍为已安排，发行物版本绑定未完成。没有关闭其他事项。

初版文档与 MCP 平行，README 当时将 MCP 标为独立 PR 待合入；下方 2026-10-17 记录更新后的依赖顺序和源码能力声明。
此前 `git merge-tree` 模拟与 MCP 提交 87c7292 合并：仅根 README.md 冲突（本分支整页重写，MCP 分支在旧页末尾追加指南）。能力代码、package.json、Windows 打包脚本和阶段记录自动合并。届时保留双语首页结构，加入已合入的 MCP 指南并同步中文页、能力表与导航；本次不提前合并 MCP。


## 审阅修正（2026-10-15）

PDF 开发准备明确限于 Windows x64，其他平台尚无本项目已验证的对应准备与发行流程。通用源码指南补齐 Linux/macOS 的 XDG_DATA_HOME 与 ~/.local/share/ivoraige 路径，以及 IVORAIGE_DATA_DIR 覆盖方式。对照源码及打包清单检查，构建和隔离安装 smoke 通过；不重跑未涉及的业务验收。

## 审阅修正（2026-10-16）

工作台截图文件头为 JPEG（`FF D8`），保留原始字节并改名为 `workbench.jpg`，同步两版 README、来源说明、npm 清单及 Windows 分发路径。修正 PDF 开发文档的根目录相对路径、工作台指南标题及 PDF 指南链接文本，并将分发脚本的新增文件并入原复制循环。npm 包不再包含只供开发维护查阅的 `pdf.md` 阶段记录；`pdf-guide.md` 指向该记录的链接已是 GitHub 源码地址。

本机 Windows Node 26.7.0/npm 12.0.2 的 npm dry-run 清单为 53 文件，包含两版 README、JPEG 截图、四份用户指南与能力表；不含 `pdf.md`、旧截图名或 evaluation 数据。包内 30 个相对文档链接均指向已收录路径。`npm run build:distribution` 通过运行时、启动器、设置与 SQLite 探针；分发目录中的上述 8 个文档／图像与工作树字节一致，30 个相对链接可解析，也不含 `pdf.md` 或旧截图名。此轮没有重跑模型或 Sandbox 验收。


## 两个 PR 合流复核（2026-10-17）

文档 PR 以 MCP PR #18 为前置，先集成 MCP 再合入文档。基于 MCP `334ec265`、文档 `30e38b7` 和 `main/c8a146d` 的实际合流发现 README 与 Windows 分发脚本两处冲突。保留双语新版首页，将 MCP 与能力表同时加入用户指南复制列表，并同步两版 README、能力表、文档导航、路线图和源码指南。随后纳入 MCP `3524f96` 的指南修正；双方历史记录与 follow-up 条目均保留。

macOS arm64、Node 24.20.0/npm 12.0.2：合流代码完整 `npm test` **239 通过、0 失败、1 跳过**（Windows 专用子进程取消测试）；Python sidecar 单元测试 **14/14**；隔离 npm 安装包 smoke **60 文件通过**，覆盖 MCP、文本持久化及冻结导出。包内 **33 个相对文档链接**全部可解析，双语 README、JPEG 截图、MCP 指南和能力表均在包中；不含 evaluation 数据、旧截图名或内部 `pdf.md` 阶段记录。Windows 分发指南列表经静态核对同时保留 MCP 与能力表，没有在 macOS 冒充运行 Windows 分发构建或 Sandbox。

MCP 指南中的阶段记录、协议和开发脚本指向源码地址，源码准备指向开发指南。当前源码已具备 MCP；现有 Windows `v0.1.0-dev.0` Release 附件尚未更新，两版首页与能力表明确区分。发行版本绑定仍由 `release-documentation-binding` 跟踪，保持已安排。

本次重跑的 [PR CI](https://github.com/KongouAirlines/ivaraige/actions/runs/38884962189) 仍因账户付款／支出额度限制在测试开始前失败；该结果不等于三平台回归已通过。本轮未调用真实模型，未改动现有 Release 附件。
