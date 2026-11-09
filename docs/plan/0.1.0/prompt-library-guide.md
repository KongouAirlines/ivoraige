# 0.1.0 提示词库

本地提示词库目前接入逐单位翻译，功能标识为 `ivoraige.translationModel` / `translate-unit`。无需配置提示词即可使用内置 `builtin:scientific-translation` 版本 3。审校、改写、术语提取尚无运行时功能，不会借用翻译提示词。项目对象尚未交付；当前可选全局、文档及单次任务范围，没有项目设置或工作台编辑页。

从 CLI 查看当前模型连接标识和模板：

```sh
ivoraige prompts
ivoraige prompts copy --set '{"name":"My translation style"}'
ivoraige prompts update --set '{"id":"<copied-id>","expectedVersion":"1","style":"Use concise academic prose."}'
ivoraige prompts bind --set '{"pluginId":"ivoraige.translationModel","featureId":"translate-unit","configurationId":"<selectedModel.configurationId>","templateId":"<copied-id>"}'
ivoraige prompts resolve --set '{"pluginId":"ivoraige.translationModel","featureId":"translate-unit","configurationId":"<selectedModel.configurationId>"}'
ivoraige translate <document-id> --target-lang zh-CN --prompt <copied-id>
ivoraige prompts restore --set '{"pluginId":"ivoraige.translationModel","featureId":"translate-unit","configurationId":"<selectedModel.configurationId>"}'
```

`prompts` 的 `selectedModel.configurationId` 由提供商、模型 ID、端点／路由和该模型配置计算，不是显示名称；连接改变后旧绑定不会被误用。`bind` 可以另加 `docId` 将选择限定到现有文档。优先级为单次 `--prompt`、文档绑定、全局绑定、兼容内置默认。普通翻译命令无需新增参数；未给 `--prompt` 时仍会采用适用的文档或全局绑定，只有没有自定义绑定时才直接采用内置默认。`restore` 删除对应范围的绑定；若只恢复文档绑定，全局绑定仍适用。复制内置模板后才能编辑；`update` 需要当前 `expectedVersion`，每次保存产生新版本，不覆盖旧版。提示词库与文档记录同存在受管 SQLite 存储中，可跨文档显式复用。

`resolve` 显示实际模板、来源、内容摘要和可用时的回退原因。已绑定模板丢失或不兼容时，仅回退到同一插件功能的兼容内置默认并记录原因；单次显式选择丢失或不兼容会报错。插件功能缺失直接报 `COMPONENT_MISSING`。可调整的 `style` 作为请求 `effectiveTarget` 中的数据传给模型，不能替换翻译功能持有的必要输入／输出协议；正文与上下文仍是数据。当前翻译预设包含 v3 请求边界和完整内部请求回显拒绝规则。模板 `variables` 说明插件提供的输入字段，`output` 描述输出约定；自定义副本不能改动它们。

翻译修订记录 `promptVersion` 与 `promptTrace`（模板 ID、版本、有效内容摘要、来源、连接标识和协议版本）。任务从第一个单位起保存本次实际提示词内容；暂停／恢复不改用后来编辑的版本。样式或连接变化不会复用旧机器译文；仅修改模板名称或复制相同样式不会增加模型调用。已有人工译文仍按原适用性规则复用；即使设置了尚不支持模型装配的术语约束，完整适用的人工修订也能零调用复用。没有适用修订而需要调用模型时，该术语约束仍会使任务在发送请求前失败。已接受修订与冻结导出不因模板编辑而变化。模型连接在运行期间发生变化时任务失败并可在核对后重试，不会默默改用另一连接。

首次创建带单次模板选择的翻译任务，或首次保存任务的实际模板选择／修订追溯，会把现有 SQLite 中 Records 存储域版本提升到 3。旧版程序会拒绝打开，以防重写记录时丢失追溯字段。操作前请备份完整 SQLite 文件及相关导出文件；若要回退程序，须恢复升级前备份。没有新字段的旧库仍按原存储版本使用。

CLI 的 `prompts` 子命令也支持 `--url` 连接正在运行的服务。所有操作亦可通过 `call OPERATION --set JSON` 和现有 HTTP 动态操作入口使用。提示词库不含凭据，`style` 不应放入秘密或未授权的个人资料。
