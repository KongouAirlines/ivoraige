# 格式与软件协作工作包

[执行索引](../work-packages.md) · [领域契约](../formats-integrations.md) · [验证索引](../validation.md)

## F01

DOCX 正文/标题/列表/普通表格三层能力，run/字段边界与原生新副本。

- 不做：不默认支持宏、所有域/脚注/修订/嵌入对象，不以 PDF 代替 DOCX。
- 验收：[F01 专项](../validation/formats-integrations.md#f01)，并通过 [F-V01](../validation.md#f-v01)。
- 回退：禁用该 adapter，保留旧来源/修订/成品；未知 binding 阻止回写，不批量改旧记录。

## F02

无 DRM 可重排 EPUB 的 spine/资源/导航/锚点与新成品。

- 不做：不绕过 DRM，不将字体混淆一律判 DRM，不承诺固定版式/漫画/音频同步。
- 验收：[F02 专项](../validation/formats-integrations.md#f02)，并通过 [F-V02](../validation.md#f-v02)。
- 回退：禁用新读取/回写，保留来源和历史成品；不静默转换引擎。

## F03

PPTX 文字定位和原生回填、关系保留、长译文警告。

- 不做：不默认无限缩字，不承诺 SmartArt/图表/动画完美重排。
- 验收：[F03 专项](../validation/formats-integrations.md#f03)，并通过 [F-V03](../validation.md#f-v03)。
- 回退：暂停回写，保留已读草稿；旧源和新成品分别保留，人工选择继续路径。

## F04

XLSX 选区字符串及 shared-string 上下文、文本类型保护。

- 不做：不翻译公式/工作表名，不运行宏/外链/计算，不全局替换共享字符串。
- 验收：[F04 专项](../validation/formats-integrations.md#f04)，并通过 [F-V04](../validation.md#f-v04)。
- 回退：禁用回写保留草稿和原件；不以改公式或自动重算修复导出。

## I01

受约束来源/交接/方案/任务/产物/幂等/权限契约，共用 API 与可调用方案发布，OpenAI/MCP 等薄投影；复用 W02 保存冻结、W03 管线管理及术语后端。Zotero 选择附件导入及新产物回挂是本包独立高优先切片，与 KT 同级、可并行验证；公共契约不绑定某个客户端率先完成。

- 不做：不将 origin 枚举当实现，不自动取首附件，不要求旧四模式全交付，不开宽权限端口。
切片顺序与 issue 分工见[共用外部 API 路线](../external-api.md#依赖与可审阅切片)。

- 验收：[I01 专项](../validation/formats-integrations.md#i01)，并通过 [I-V01](../validation.md#i-v01)。
- 回退：禁用桥接保留本地数据；外部写入有收据，撤回另作明确动作。

## I02

支持 provider 插件的固定版本 Kiss Translator 与 Zotero 同为高优先集成，可并行联调和验证；Pot 选文、Umi-OCR 独立识别保留后续候选。KT 页面提取/分段/渲染归客户端，桥接复用 I01 与中央术语配置。

- 不做：不重写客户端，不默认外发/付费，不宣称全部平台/三个软件全支持。
- 验收：[I02 专项](../validation/formats-integrations.md#i02)，并通过 [I-V02](../validation.md#i-v02)。
- 回退：禁用入口，保留公共操作与结果；未知远端执行不自动重试。

## I03

Obsidian Markdown/资源及 calibre 文件级候选，其他知识库保留协议边界。

- 不做：不默认双向同步、远程上传或额外软件名单，不依赖专用插件才交付文件交换。
- 验收：[I03 专项](../validation/formats-integrations.md#i03)，并通过 [I-V03](../validation.md#i-v03)。
- 回退：停自动交接，保留文件和映射；不删除外部用户编辑或伪称撤销已写内容。
