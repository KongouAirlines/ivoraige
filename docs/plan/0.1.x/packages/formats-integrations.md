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

受约束来源/交接/方案/任务/产物/幂等/权限契约，共用 API 与可调用方案发布，OpenAI/MCP 等薄投影。按下列子交付分别认领和验收；Zotero 与 KT 同级高优先，互不作为完成前置。

- 不做：不将 origin 枚举当实现，不自动取首附件，不要求旧四模式全交付，不开宽权限端口。
- 验收：[I01 专项](../validation/formats-integrations.md#i01)，并通过 [I-V01](../validation.md#i-v01)。
- 回退：禁用桥接保留本地数据；外部写入有收据，撤回另作明确动作。

切片顺序与 issue 分工见[共用外部 API 路线](../external-api.md#依赖与可审阅切片)。

### 共享子交付

下面的 @1 是首个候选契约修订，固定责任、输入输出和拒绝语义；不是软件版本或已有 wire API 版本。实现 PR 固定具体 schema 与兼容范围，破坏性变更升子契约版本并更新所有消费边；证据记录实际版本，不能用未通过的 mock 替代端到端前置。责任按现有父包的实现者角色认领，不预指派个人。

| 子交付 / 责任 | 交付边界及技术前置 | 验收 ID |
| --- | --- | --- |
| I01.shared@1 / I01 公共接口实现者 | P04 上的受限公共 facade、客户端凭据与授权、operation/scope 描述、任务/资源归属与取消/错误；不包含 Zotero、OpenAI 或方案管理 UI | [I-V01.shared](../validation/formats-integrations.md#i-v01-shared) |
| I01.callable@1 / I01 方案实现者，与 W02/U03 后端协作 | I01.shared@1 + W02 保存冻结 + U03.terms@1；方案发布/描述、逐运行绑定、允许覆盖及术语版本。本机受控 CLI 调用同一发布服务完成管理；不要求 W03 UI | [I-V01.callable](../validation/formats-integrations.md#i-v01-callable) |
| I01.zotero@1 / I01 Zotero 适配实现者 | I01.shared@1 + P02/P03 的导入/来源/产物能力；只读导入与显式写回分别验收。若调用翻译方案再接 I01.callable@1，不因基本文件交接强依赖方案/术语 UI | [I-V01.zotero](../validation/formats-integrations.md#i-v01-zotero) |

OpenAI 包装消费 I01.shared@1/I01.callable@1，协议适配另验；它不是上述子交付的组成前置。包交付仍接 P05。只完成共享子交付时，I01 父行保持未完成并列出已通过子 ID 与未完切片；I02 的证据可引用这些已通过子交付，不等待父包整体结束。

## I02

支持 provider 插件的固定版本 Kiss Translator 与 Zotero 同为高优先集成，可并行联调和验证；Pot 选文、Umi-OCR 独立识别保留后续候选。KT 页面提取/分段/渲染归客户端，端到端所需子交付明确为 I01.shared@1、I01.callable@1（包含 U03.terms@1）；不依赖 I01.zotero@1、OpenAI 或 W03.publish-ui@1。

- 不做：不重写客户端，不默认外发/付费，不宣称全部平台/三个软件全支持。
- 验收：[I02 专项](../validation/formats-integrations.md#i02)，并通过 [I-V02](../validation.md#i-v02)。
- 回退：禁用入口，保留公共操作与结果；未知远端执行不自动重试。

## I03

Obsidian Markdown/资源及 calibre 文件级候选，其他知识库保留协议边界。

- 不做：不默认双向同步、远程上传或额外软件名单，不依赖专用插件才交付文件交换。
- 验收：[I03 专项](../validation/formats-integrations.md#i03)，并通过 [I-V03](../validation.md#i-v03)。
- 回退：停自动交接，保留文件和映射；不删除外部用户编辑或伪称撤销已写内容。
