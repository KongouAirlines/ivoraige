# 0.1.0 能力与限制

本页描述 `0.1.0` 源码及自行构建的本地 npm 包；v2.0 是设计文档版本。此前的 Release 附件已撤下，当前从源码运行，PDF 使用 Windows 开发准备路径或已有本机组件。历史测试与版本差异见[实施记录](README.md)。

| 能力 | 当前可用范围 | 主要边界 |
| --- | --- | --- |
| TXT / Markdown | 导入、翻译、人工编辑、接受修订、MD / JSON 输出 | Markdown 是已验证子集；完整科学或文学翻译质量未做系统评价 |
| PDF（可选） | BabelDOC 自身捕获、受管理原件、来源页码与坐标、单语 PDF / MD / JSON 导出 | 英文→中文曾实测；中文→英文路由已实现但尚无真实引擎／Mac 视觉验收；没有扫描件 OCR、双语 PDF、跨引擎重建保证 |
| MinerU 纯解析（实验源码包） | DSH profile 显式装配、本地 4.0.10 SDK 协议桥、完整 MiddleJson/资源保存、原文 MD/JSON 投影；Linux CPU/flash 上原创原生与扫描样本完成实际导入/重启/来源导出 | 两个合成 PDF 不代表任意 PDF 或 OCR 质量；表格/公式有分类和文本覆盖缺口；安装包闭包、译文 PDF 重建未验收；不自动下载权重 |
| 修订与复用 | 按语言保存草稿与接受版本，满足适用条件时复用 | 模型调用后、落库前崩溃不能保证供应商没有执行请求 |
| 冻结导出 | 同任务多格式共用快照，编辑不改变已有快照，导出不调用翻译模型 | 不覆盖同名文件；格式可用性取决于已装插件与文档来源 |
| 任务 | 持久状态、进度、取消；翻译／导出按既有规则暂停与恢复 | PDF 导入可取消但不支持暂停续传；安装任务不续传下载 |
| 入口 | 浏览器工作台、CLI、HTTP/SSE、MCP stdio／Streamable HTTP 共享内核 | HTTP 本机回环监听；同一 SQLite 由单个内核进程持有；MCP 客户端具有该内核的编辑、设置和组件管理权限 |
| 模型与组件 | DSH 设置、凭据及模型访问；按需安装 BabelDOC | 公开组件源可匿名读取，私有源仍需显式令牌；在线模型会收到待译内容并可能计费；免费 Index-Translate 尚未专门接入 |
| 逐单位翻译提示词 | 本地模板、按模型连接与功能绑定、文档及单次覆盖、修订追溯 | 仅 CLI／共享 operation 管理；无工作台编辑页、项目设置或其他模型功能；见[提示词库](prompt-library-guide.md) |
| 平台 | Node 24 内核曾在三平台 CI 运行；旧 `v0.1.0-dev.0` Windows x64 便携包与 PDF 组件曾在 Windows Sandbox 实测 | 新版 `0.1.0` Windows 包尚未构建或验收；Linux/macOS 独立 PDF 包、完整桌面安装器仍未交付 |

术语库结构与装配、EPUB、Zotero、RAG、基础文件处理扩展仍为规划。当前术语适用性字段不等于可供用户使用的术语库。[0.1.x 计划](../0.1.x/README.md)中的完整独立插件安装与回滚、MinerU 更广样本质量及依赖闭包验收、第二同类插件及桌面生命周期仍是待实施目标。

使用入口：[安装](installation-guide.md) · [文本与 Markdown](workbench-guide.md) · [PDF](pdf-guide.md) · [设置](settings-guide.md) · [提示词库](prompt-library-guide.md) · [MCP](mcp-guide.md)。
