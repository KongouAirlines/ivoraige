# 0.1.0 提示词库

本地提示词库目前接入逐单位机器翻译，功能标识为 `ivoraige.translationModel` / `translate-unit`。无需额外配置即可使用内置默认模板 `builtin:scientific-translation`（版本 3）。审校、改写、术语提取目前尚无运行时功能，不会借用翻译提示词；项目对象与工作台提示词编辑页尚未交付，当前支持全局、文档及单次任务三个范围。

## CLI 常用操作与优先级

可通过 CLI 查看当前模型连接标识（`selectedModel.configurationId`）并管理提示词模板：

```sh
ivoraige prompts
ivoraige prompts copy --set '{"name":"My translation style"}'
ivoraige prompts update --set '{"id":"<copied-id>","expectedVersion":"1","style":"Use concise academic prose."}'
ivoraige prompts bind --set '{"pluginId":"ivoraige.translationModel","featureId":"translate-unit","configurationId":"<selectedModel.configurationId>"}'
ivoraige prompts resolve --set '{"pluginId":"ivoraige.translationModel","featureId":"translate-unit","configurationId":"<selectedModel.configurationId>"}'
ivoraige translate <document-id> --target-lang zh-CN --prompt <copied-id>
ivoraige prompts restore --set '{"pluginId":"ivoraige.translationModel","featureId":"translate-unit","configurationId":"<selectedModel.configurationId>"}'
```

- **连接标识计算**：`selectedModel.configurationId` 由提供商、模型 ID、端点／路由和该模型配置共同计算，而非显示名称；模型连接改变后不会误用旧绑定。
- **作用范围与优先级**：`bind` 可额外传入 `docId` 将选择限定到指定文档。解析优先级从高到低依次为：**单次 `--prompt` 覆盖 → 文档绑定 → 全局绑定 → 兼容内置默认**。普通翻译命令无需新增参数；未指定 `--prompt` 时自动采用适用的文档或全局绑定，无自定义绑定时使用内置默认。
- **恢复与版本控制**：`restore` 删除对应范围的绑定（若只恢复文档绑定，全局绑定继续生效）。内置模板须先 `copy` 生成副本后才能编辑；`update` 需传入当前 `expectedVersion`，每次保存都会创建新版本而不覆盖旧版。提示词库与文档记录保存在同一受管 SQLite 存储中，可跨文档显式复用。
- **远程与通用调用**：`prompts` 子命令支持 `--url` 连接运行中的服务；所有操作也可通过 `call OPERATION --set JSON` 和 HTTP 动态操作入口调用。提示词库不含凭据，`style` 中请勿填入密钥或未授权的个人资料。

## 模板解析、修订追溯与复用规则

- **解析与回退（`resolve`）**：显示实际生效模板、来源、内容摘要及回退原因。已绑定模板丢失或不兼容时，仅回退到同一插件功能的兼容内置默认并记录原因；而单次显式指定的 `--prompt` 若丢失或不兼容则直接报错。插件功能缺失报 `COMPONENT_MISSING`。
- **请求边界保护**：可自定义的 `style` 作为请求 `effectiveTarget` 中的数据传给模型，不能替换翻译功能持有的必要输入／输出协议；原文与上下文始终作为数据处理。内置翻译预设包含 v3 请求边界和完整内部请求 JSON 回显拒绝规则。模板的 `variables`（输入字段说明）与 `output`（输出约定）在自定义副本中不可修改。
- **修订追溯与任务固定**：每次机器翻译修订均记录 `promptVersion` 与 `promptTrace`（含模板 ID、版本、有效内容摘要、来源、连接标识和协议版本）。翻译任务从处理第一个单元起即固定本次实际提示词内容；暂停后恢复不会改用后来编辑的新版本。若模型连接在任务运行期间发生变化，任务会报错停止，核对后可重试，不会静默改用其他连接。
- **复用判定**：修改 `style` 内容或切换模型连接后，不会复用旧机器译文；仅修改模板名称或复制相同 `style` 不会增加额外模型调用。已有人工修订仍按原适用性规则复用——即使尚未配置模型或设置了尚不支持模型装配的术语约束，完整适用的人工修订也能零调用复用（仅当无适用修订、确需调用模型时，未配置模型或不支持的术语约束才会使任务在发送请求前失败）。已接受修订与冻结导出不会因后续编辑模板而改变。

## 存储版本升级与备份

首次创建带单次模板选择的翻译任务，或首次保存任务的实际模板选择／修订追溯时，内核会将现有 SQLite 中 `ivoraige_records` 存储域版本提升到 **3**。旧版程序随后会拒绝打开该库，以防旧代码重写记录时丢失追溯字段（不含新字段的旧库仍保持原存储版本）。升级操作前请备份完整 SQLite 文件及相关导出文件；若需回退到旧版程序，必须恢复升级前的完整备份。
