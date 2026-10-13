# 0.1.0 产品定位与后续方向

## 定位

供人和 AI 共用、可自由组合的翻译与文件处理基础设施。主要服务学习者、学生、科研用户，以及为爱发电的翻译者；论文、小说、学习资料和日常阅读都是使用场景。开发者接口服务于共同的处理流程。

核心价值是把分散的成熟工具组合到一个工作空间，用户按需安装和选用。翻译、人工审校、格式保留和译文复用围绕这一目标持续整合优化；未来的文件处理也可以独立于翻译存在，不要求每个操作都配置模型或目标语言。当前实现范围见[能力表](capabilities.md)。

## 正在衔接的工作

- [MCP PR #18](https://github.com/KongouAirlines/ivaraige/pull/18)：共享内核入口，独立实现且待合入。本轮文档分支不依赖该代码。
- [Issue #14](https://github.com/KongouAirlines/ivaraige/issues/14)：插件接口解耦与 MinerU 调研，保留解析、翻译和重建的独立边界。
- [Issue #16](https://github.com/KongouAirlines/ivaraige/issues/16)：项目与资源管理、可选翻译的文档处理和界面体验；完整安装程序随该范围进一步设计。

这些事项各自确定实现范围，本页不把讨论方案当成已经完成的功能。

## 后续方向

| 方向 | 边界与跟踪 |
| --- | --- |
| 更多文档格式与基础文件处理 | 按需插件化；首批工具随 Issue #16 的独立文档处理流程确定，不在文档整理中选定或实现 |
| 持久术语与审校 | 沿用 v2.0 及术语适用范围补充，词库结构与权限仍需细化 |
| Zotero 等场景集成 | 沿用 v2.0 规划；科研是具体桥接场景，不作为所有功能的默认前提 |
| Index-Translate 官方 API | [接入评估](../follow-ups/index-translate-provider.md)；优先复用 DSH 模型层，独立实现与验收 |
| 作为 DSH 插件安装 | [宿主集成探索](../follow-ups/dsh-host-integration.md)；低优先级，前端复用或适配形式未定 |
| 发版文档与产物对应 | [release-documentation-binding](../follow-ups/release-documentation-binding.md)；本次整理入口，正式发布前仍需绑定实际源码与附件 |

## 这次文档交付

分支 `codex/0.1.0-documentation` 基于 `main/0a185d4`，与 MCP 并行。英文主 README、中文完整版本使用相同结构和能力声明；开发规则、源码操作及历史证据转入相应文档。项目短简介统一为：

> Composable translation and file-processing infrastructure for people and AI.

没有在本阶段实现新的提供商、文件处理功能或 DSH 宿主模式。合并本 PR 与 MCP PR 时，需要共同核对双语 README、能力表、文档导航、软件包中的指南，以及历史记录；不能用某一分支较新的文字覆盖另一分支的实现证据。
