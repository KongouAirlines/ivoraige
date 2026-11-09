# 0.1.0 PDF 使用指南

配套源码 sidecar 提供原生文本英文→中文、简体中文→英文单语 PDF 路由，可从同一份接受译文导出 PDF、Markdown 和 JSON。中文→英文的真实引擎排版尚待实机核验。PDF 能力由可选 BabelDOC 组件提供，未安装时仍可使用文本与 Markdown。

## 开始前

目前不提供 PDF 组件下载。新用户按 [PDF 开发参考](pdf-development.md)准备 Windows x64 环境并启动；已有本机组件可继续使用，但旧组件可能仅支持英文来源；中文→英文须使用与此代码匹配的源码 sidecar。持有完整离线包时，安装方法见[安装指南](installation-guide.md)。组件“已配置”表示已找到配置，首次实际处理时才验证运行环境与资产。

需要机器翻译时，在[模型设置](settings-guide.md)中保存模型与凭据。源码开发者的 Python 准备、配置文件及回归脚本另见源码仓库的 [PDF 开发参考](pdf-development.md)。

## 导入、审校与导出

1. 在首页或文档页上传不超过 7 MiB 的原生文本 PDF，按实际原文选择 English（`en`）或中文（`zh`）；CLI/API 还可声明 `zh-CN` 或 `zh-Hans`。程序不自动识别 PDF 语言；`zh-TW` 等未列出的标签会在解析前被拒绝。
2. 在任务页查看解析进度，完成后打开文档；不需要继续时可以取消。导入不支持暂停续传。
3. 英文来源选择“简体中文（zh-CN）”或“中文（zh）”；中文来源选择 English（`en`）。精细模式保留草稿，快速模式自动接受结果；两种模式都需要按内容质量人工检查。
4. 对照来源页码、原文与译文，保存修改并接受所需修订。`zh` 与 `zh-CN` 分别保存译文；已有中文任务要选择一致的目标语言。
5. 勾选 PDF、MD、JSON 中需要的格式，导出后从“已生成文件”下载。译文 PDF 仅接受 `en`→`zh`／`zh-CN`／`zh-Hans` 或 `zh`／`zh-CN`／`zh-Hans`→`en`；来源标签须与捕获绑定一致，其他组合会在创建快照与任务前被拒绝。原件 PDF 可通过 CLI/API 的 `contentMode: source` 独立导出，不需要目标语言或已接受译文。其他目标的文本格式导出仍按其各自规则处理。

所选格式共享同一冻结快照。导出不再次调用模型；修改后再次从当前接受译文导出会生成新快照，已有快照保持原内容。通过 API/CLI 指定旧 `snapshotId` 可重放旧快照。

## 检查输出

- 查看来源覆盖与导出警告，并核对公式、图注、多栏和未进入翻译单元的文字。新导入文档的 `sourceCoverage.summary` 列出捕获单位、翻译回调、未进入回调但保留的单位、行审计补录和空文本单位；后两项可能与未进入回调的单位重叠，不能相加。旧导入记录缺少的统计显示为未知。回调数量只表示 BabelDOC 发起的请求，不表示已接受译文、需要翻译的内容或原件全文覆盖。任务成功不等于全文已译，也不等于每一处内容和布局都已正确。
- 特别核对短表格标签与有前后文的段落：译文应只对应当前单元，不应包含内部请求字段或重复相邻正文。新请求的提示词已明确这条边界；旧的接受译文及冻结产物不会自动修复，需要人工修订后重新导出。
- 公式等不可译内容通常保留原文。编辑时保留占位符及原有顺序；BabelDOC 的解析、字体或排版限制可能导致不完美的显示。
- 默认要求可译单元均有接受译文。CLI/API 的显式 skip 允许缺失部分保留原文，所有格式共享同一决定，不临时补译。
- 扫描件 OCR、双语 PDF、MinerU 跨引擎映射仍未提供；当前独立组件验收范围为 Windows x64。

## 继续工作与恢复

正常退出后重新启动，可继续使用已有文档与修订。取消导出不删除此前已经完成的格式产物。组件修复或更改配置后先重启再处理。

备份前退出程序，复制整个用户数据目录，保留数据库及旁边的 `pdf/` 目录。不要单独移动数据库或修改受管理原件。来源丢失或损坏时，可重新导入完全相同的原 PDF 以恢复本库副本；不需要重新翻译已有文档。跨版本升级和其他平台迁移需另行验证。

更多范围见[能力与限制](capabilities.md)。维护者的来源绑定、目录清理和真实样本证据保存在源码中的 [PDF 实施记录](pdf.md)。

## 可选 MinerU 纯解析源码插件（实验）

本源码还包含独立的 `plugins/mineru/` 来源插件，使用 MinerU **4.0.10 SDK**。它只导入 PDF 并保存原件、完整 MiddleJson、结构化视图、Markdown 和图片资源；可通过通用原文模式导出 MD/JSON。它不提供 PDF 译文重建，不借用 BabelDOC renderer，也不需要翻译模型。Linux CPU/flash 已用原创原生与纯图片扫描样本完成真实解析、重启和来源导出；这不代表任意 PDF 或 OCR 质量验收，也没有可下载的独立 MinerU 安装包。实测环境、样本与局限见 [MinerU 实施证据](../0.1.x/evidence/mineru-source-p05-p06.md)。

已自行准备本地 MinerU 4.0.10 Python 环境及所需模型资源的开发者，可以关闭程序后，将 `plugins/mineru/` 复制到本数据目录的 `settings/node_modules/@ivoraige/mineru-source/`（保留 `index.mjs`、`runner.py` 和 `package.json`）。在 `settings/cordis.patch.yml` 的现有补丁列表中加入一项，不要覆盖其他补丁：

```yaml
- insert:
    - id: mineru-source
      name: ./node_modules/@ivoraige/mineru-source/index.mjs
      config:
        directory: /absolute/data/mineru
        command: /absolute/python-environment/bin/python
        tier: flash
        ocrMode: auto
```

Windows 的 `command` 指向该环境的 `python.exe`。宿主把已锁定的 SQLite 路径传给插件作为资源归属身份，不需要在 profile 重复填写。重启后用 `ivoraige import FILE.pdf --format pdf --adapter mineru --source-lang en` 显式选择来源，再用 `ivoraige export DOC_ID --format md,json --content-mode source` 导出。若 BabelDOC 也在场，不指定 adapter 可能发生同分冲突，程序不会暗选。停用时将该 DSH profile 行设为 `disabled: true` 并重启；TXT/Markdown 与已有只读记录继续可用，MinerU 私有修订校验在插件缺席时不可用。

sidecar 在握手后核对 MinerU 4.0.10 和决定保存结构的 DocVortex 0.6.21 精确版本，设置 Hugging Face/Transformers 离线开关，并在该 Python 进程内拦截常用 socket 入口；这不能保证阻断全部网络路径，不是操作系统沙箱。需要严格离线时仍应使用隔离的本地环境。缺少本地运行时/资源会失败，不会由插件自动安装或下载。两个原创合成 PDF 的真实解析证明了窄范围 OCR 路径；图表块已捕获的 caption/footnote 会作为独立可读单元保留，但表格表头可能并入 caption，公式文本与 Markdown 标题格式仍有缺口，需逐页检查；未对任意扫描件证明质量。备份时需连同 SQLite 库与受管 `mineru/` 目录一起复制；目前不支持单独移动库或目录。完整资源仍在绑定对应目录中，MD/JSON 文本导出不等于 PDF 版面回放。MinerU 本体有附加许可条款，独立分发前需核对实际 Python、模型、字体与原生库闭包。

上游 MinerU 4.0.10 要求 Python `>=3.10,<3.15`。官方 [MinerU-4 ONNX 模型仓](https://huggingface.co/opendatalab/MinerU-4_models_onnx/tree/358310b4f64b95f9fefc372ad899356e4111f376)在该修订的文件合计 858,220,651 字节（约 858 MB），这不是完整 Python 安装或所有可能模型的大小。插件桥的 MIT 许可不覆盖 MinerU 本体或模型。上游[许可](https://github.com/opendatalab/MinerU/blob/mineru-4.0.10-released/LICENSE.md)包含商用规模门槛和第三方在线服务显著署名要求；模型及其他资源仍按各自来源许可核对。
