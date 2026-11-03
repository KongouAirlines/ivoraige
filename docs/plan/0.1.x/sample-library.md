# 独立样本库与验证分工

翻译样本库的开发移到需授权访问的私有仓库 [translate-source-lib](https://github.com/KongouAirlines/translate-source-lib)。ivoraige 负责实际处理流程及其回归验证，样本库负责材料、来源记录和样本检查工具。

这延续了 [#13](https://github.com/KongouAirlines/ivoraige/issues/13) 的独立样本库方向。[#53](https://github.com/KongouAirlines/ivoraige/pull/53) 已关闭且未合并；其中的样本、脚本和 `npm run evaluate:samples` 没有进入 ivoraige 主分支。本文说明后续分工，不恢复该 PR 的实现，也不结束 #13 的长期工作。

## 两个仓库各自维护什么

| 仓库 | 维护内容 |
| --- | --- |
| translate-source-lib | 样本原件与派生产物、来源和使用依据、固定哈希、分类与预期、私有故障收集、结构检查与报告比较工具。 |
| ivoraige | 导入、记录持久化、翻译和冻结导出的实际行为；针对缺陷的最小回归测试；实际引擎、平台和配置下的验证结论。 |

ivoraige 使用样本库中的指定版本和文件，不复制整套语料、清单或样本工具，也不把样本库设为默认安装或 CI 下载依赖。现有的小型单元测试夹具继续用于自己的回归测试。若某个缺陷确实需要新增夹具，应单独说明用途和使用依据，避免再维护一套样本库。

## 样本库 d2eae6f 基线的文档与命令

截至 2026-11-01，以下文档与命令以样本库 main 的固定提交 `d2eae6fb0f120124f04139248a8095beb4261c1c` 为准；固定链接便于复现，不表示今后的 main 始终与其相同：

- [安装与结构检查](https://github.com/KongouAirlines/translate-source-lib/blob/d2eae6fb0f120124f04139248a8095beb4261c1c/README.md)
- [样本与观察报告格式](https://github.com/KongouAirlines/translate-source-lib/blob/d2eae6fb0f120124f04139248a8095beb4261c1c/docs/formats.md)
- [真实 PDF 的交接说明](https://github.com/KongouAirlines/translate-source-lib/blob/d2eae6fb0f120124f04139248a8095beb4261c1c/docs/integration-real-pdfs.md)
- [私有故障收集与缩减](https://github.com/KongouAirlines/translate-source-lib/blob/d2eae6fb0f120124f04139248a8095beb4261c1c/docs/intake.md)
- [阶段验收记录与已知视觉问题](https://github.com/KongouAirlines/translate-source-lib/blob/d2eae6fb0f120124f04139248a8095beb4261c1c/docs/final-acceptance.md)
- [平台支持边界](https://github.com/KongouAirlines/translate-source-lib/blob/d2eae6fb0f120124f04139248a8095beb4261c1c/docs/platform-support.md)
- [D02 视觉证据与绑定图片复核](https://github.com/KongouAirlines/translate-source-lib/blob/d2eae6fb0f120124f04139248a8095beb4261c1c/docs/visual-evidence.md)

这些私库链接仅对获授权的成员可见。外部贡献者可先在 ivoraige issue 描述问题、公开来源和许可依据，不要上传私人正文。

以下示例使用 **POSIX shell**，在样本库上述提交根目录运行，先按其 README 准备 Python 3.11+ 虚拟环境与依赖。Windows 虚拟环境的解释器通常为 `.venv\Scripts\python.exe`，`PYTHONPATH` 的设置语法也随 PowerShell、cmd 或 POSIX shell 而异，不能原样复制下面的命令。样本库基线实际验收主机为 macOS；Windows 上结构命令的结果需在该主机实测并记录，不能据此认定不可运行。

```sh
PYTHONPATH=src .venv/bin/python -m samplelib.cli validate
PYTHONPATH=src .venv/bin/python -m samplelib.cli run --output reports/current.json
PYTHONPATH=src .venv/bin/python -m samplelib.cli compare baselines/structure.json reports/current.json --output reports/comparison.json
```

这些是样本库的命令，不在 ivoraige 目录执行。`run` 只运行本地结构检查，不调用 ivoraige、BabelDOC 或翻译模型。退出码 `0` 为检查通过，`1` 为检查未通过，`2` 为输入无效或操作失败。应同时检查退出码和本次报告，不能把旧报告仍然存在当作本次成功。

## 如何交接输入和结果

1. 选定样本库提交和样本编号，核对该版本记录的原始字节哈希、来源、使用限制和预期。保持原件只读；测试工作目录和输出放在版本控制之外。
2. PDF 组件准备目前仅验证 Windows x64；样本库 macOS 验收不代表 macOS 已验证 ivoraige PDF 路线。跨平台交接须保留原始字节哈希、主机与版本记录。在 ivoraige 的明确提交上，按已有入口运行需要验证的阶段。PDF 组件准备和当前支持范围见 [PDF 开发参考](../0.1.0/pdf-development.md)。目前的英文 PDF 路线不能因为样本库有中文、西班牙文或扫描件，就视为已支持这些输入。
3. 记录系统、引擎及适配器版本、配置标识、复现命令和各阶段结果。分别报告解析、导入、重启后的记录读取、翻译及导出；没有运行的阶段写明未运行。异常或崩溃属于失败，不应改写成正常拒绝。
4. 需要使用样本库的 `assess` 时，按上述格式文档整理**实际流程产生**的观察文件。ivoraige 没有内置的 samplelib 观察报告导出器，本轮不实施该接口；需要时沿开放的 #13 另立工作包，不取消长期事项。不能直接把 ivoraige 的普通 JSON 导出或样本库参考解析报告当作该接口的结果。

`assess` 要求 `--manifest` 指定的清单（默认 `catalog.json`）中每个样本 ID 恰好出现一次，不是扫描文件系统目录。观察记录须带匹配的来源哈希；实际适配器提交与配置标识一起写入 `adapter.version` 字符串，例如 `ivoraige:<完整提交>;config:<配置标识>`。顶层仅允许 `schema_version`、`adapter`、`results`，`adapter` 仅允许 `name`、`version`，不要另加配置字段。准备好完整且有效的观察文件后，在样本库根目录运行：

```sh
PYTHONPATH=src .venv/bin/python -m samplelib.cli assess \
  --observations .private/observations.json --output reports/translation.json
```

`assess` 检查已有观察，不执行翻译。它检查状态、语言标签、非空结果、数字和占位符等约束，不能证明语义、阅读顺序或排版正确。仅测试清单的部分样本时，不要直接运行 `assess`，应保留独立的逐文件验证日志。它不接受相对所选清单的子集，缺少 ID 会以退出码 2 拒绝；填入 `not_run` 也不能算翻译通过。即使观察齐全，也须先确认清单预期适用于所测路线；不要补造未测结果。

固定基线默认 `catalog.json` 有 28 项，目标语言为 20 项 `de`、8 项 `zh`，其中要求翻译 `complete` 的分别为 16、6 项，还包含 DOCX 和西班牙文、中文来源。`assess` 精确比较状态和语言标签，因此该默认全清单不能作为 ivoraige 当前原生文本英文 PDF → 简体中文（`zh-CN`）路线的通过门槛。此路线继续使用逐文件日志，不把预期不适用误判为翻译回归，也不得为通过检查把 `zh-CN` 改标成 `zh`。CLI 可独立选择 `zh`，但它与 `zh-CN` 是不同修订作用域，不能混用。需要路线匹配的清单与预期时，在样本库另立事项；`--manifest` 仍可选择合法且适用的清单，本文不修改样本预期。

## 怎样表述验证结论

| 证据 | 可以说明什么 | 仍需另行验证 |
| --- | --- | --- |
| 合成或 mock 回归 | 特定边界和程序分支符合预期 | 真实文档与实际引擎的兼容性。 |
| 真实原件的参考结构检查 | 指定解析器能读取所记录的结构 | BabelDOC、ivoraige 导入、翻译和导出。 |
| 实际 BabelDOC／ivoraige 执行 | 指定输入、版本与配置下，已运行阶段的结果 | 未运行阶段、其他文档与版本。 |
| 人工译文或本地替身驱动的导出 | 冻结数据和结构回放路径的结果 | 真实模型翻译与语义质量。 |
| 真实模型执行加人工审校 | 所测输入和模型配置下的翻译结果 | 更广的语言、领域与版式覆盖。 |

内容来源与生成软件分别记录：用真正的 Word 导出人为编写的测试文字，内容仍是合成样本；公开 PDF 自报的 Producer 不能独立证明使用了哪个软件版本。真实文档转换出的 PDF 要保留父原件和转换记录，结构通过后仍须查看页面是否裁字、错列或丢内容。

D02 的历史裁字观察与后续渲染存在差异；样本库 #12 已补充指定页渲染证据绑定与调查回归，仍需按其 [视觉证据调查](https://github.com/KongouAirlines/translate-source-lib/blob/d2eae6fb0f120124f04139248a8095beb4261c1c/docs/visual-evidence.md) 完成维护者对已绑定图片的复核，不能据此宣布排版已修复。绑定图片复核也不代表全部版面或完整流程验收通过。结构通过不会覆盖质量失败。样本库没有声称完成生产翻译、验证 ivoraige #56 或复现已丢失原件的故障。对下载受阻、资产缺失或未执行的测试，保留原因，不计入通过数量。

## 来源、隐私和外发

逐份核对来源、版本、许可依据、署名要求和允许用途；能够下载或存放在私有仓库，不等于可以再分发、公开译文或发送给外部模型。许可不明的材料保持待核实状态。

私人文档仅在支持的 POSIX 环境走样本库私有收集流程；Windows 的 `intake` 在创建私有目录前退出 2 时，应转交受支持的 POSIX 环境或暂不收集，不得改放受跟踪目录。观察文件可能包含原文和译文，应保留在受保护的本地目录；提交或分享前只保留经检查可公开的统计、版本和故障说明，避免正文、主机路径及凭据进入日志、CI 缓存和产物。Git 忽略规则不等于加密，缩减文件也不等于已脱敏。

常规回归保持离线；实际模型评测按材料权限和获准范围单独运行，并记录调用范围与成本。导出继续遵守 ivoraige 的冻结快照约定，不通过额外翻译补齐结果。
