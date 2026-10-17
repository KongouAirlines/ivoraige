# 0.1.0 能力与限制

本页描述正式软件版本 `0.1.0` 的源码及由它构建的本地 npm 包；设计文档 v2.0 是架构版本，不是软件版本。新版 Windows 便携包尚未构建或验收。现有 Windows `v0.1.0-dev.0` Release 附件仍属旧预览版，尚未包含 MCP 和可选令牌安装，不能重标为 `0.1.0`；其能力以该 Release 说明为准。历史测试次数与试验结果见源码中的 [实施记录](https://github.com/KongouAirlines/ivaraige/blob/main/docs/plan/0.1.0/README.md)。

| 能力 | 当前可用范围 | 主要边界 |
| --- | --- | --- |
| TXT / Markdown | 导入、翻译、人工编辑、接受修订、MD / JSON 输出 | Markdown 是已验证子集；完整科学或文学翻译质量未做系统评价 |
| PDF（可选） | BabelDOC 自身捕获、受管理原件、来源页码与坐标、单语 PDF / MD / JSON 导出 | 实测原生文本英文 PDF → 中文；没有扫描件 OCR、双语 PDF、跨引擎重建保证 |
| 修订与复用 | 按语言保存草稿与接受版本，满足适用条件时复用 | 模型调用后、落库前崩溃不能保证供应商没有执行请求 |
| 冻结导出 | 同任务多格式共用快照，编辑不改变已有快照，导出不调用翻译模型 | 不覆盖同名文件；格式可用性取决于已装插件与文档来源 |
| 任务 | 持久状态、进度、取消；翻译／导出按既有规则暂停与恢复 | PDF 导入可取消但不支持暂停续传；安装任务不续传下载 |
| 入口 | 浏览器工作台、CLI、HTTP/SSE、MCP stdio／Streamable HTTP 共享内核 | HTTP 本机回环监听；同一 SQLite 由单个内核进程持有；MCP 客户端具有该内核的编辑、设置和组件管理权限 |
| 模型与组件 | DSH 设置、凭据及模型访问；按需安装 BabelDOC | 公开组件源可匿名读取，私有源仍需显式令牌；在线模型会收到待译内容并可能计费；免费 Index-Translate 尚未专门接入 |
| 平台 | Node 24 内核曾在三平台 CI 运行；旧 `v0.1.0-dev.0` Windows x64 便携包与 PDF 组件曾在 Windows Sandbox 实测 | 新版 `0.1.0` Windows 包尚未构建或验收；Linux/macOS 独立 PDF 包、完整桌面安装器仍未交付 |

术语库结构与装配、EPUB、Zotero、RAG、基础文件处理扩展仍为规划。当前术语适用性字段不等于可供用户使用的术语库。

使用入口：[安装](installation-guide.md) · [文本与 Markdown](workbench-guide.md) · [PDF](pdf-guide.md) · [设置](settings-guide.md) · [MCP](mcp-guide.md)。
