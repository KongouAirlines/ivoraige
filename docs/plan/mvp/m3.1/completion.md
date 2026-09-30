# M3.1：模块边界整理完成记录

日期：2026-09-30。状态：工程整理完成。本阶段编号为 M3.1，不同于 M3 内部的 M3-1。没有新增翻译调用、术语库改造或自动接受策略。

## 实际改动

- 核心 `Records` 通过 `importDocument` 接收通用单位及来源绑定，通过来源 provider 校验和生成投影；不再识别 BabelDOC token、PDF 坐标或 R03 ID。重复单位 ID 拒绝导入，已有修订与接受逻辑保留。
- `SourceProviders` 只管理已注册的来源处理实现；BabelDOC 的 snapshot 转换、占位符、结构提示和旧记录识别移到 `src/adapters/babeldoc-source.mjs`。`TextTask` 向翻译服务提供来源实现生成的提示，翻译服务不硬编码 `<bN>`。
- `PdfOutput` 是独立 Cordis 服务，向已注册的渲染实现传递同一份冻结 manifest；`src/adapters/babeldoc-output.mjs` 才知道 Python 入口、页码、固定引擎和进程取消。通过 `src/app.mjs` 显式装配默认 BabelDOC 实现。
- 新 `export-pdf` CLI 走上述服务。PDF 路线的 Markdown／JSON 使用 `TextExport.render` 预先生成，Python 正式入口只随成功 PDF 一起发布这些文件；旧的直接 Python 实验入口仍保留历史文本呈现兼容分支。
- R03 的固定区域、坐标与字段重绘移到 `experiments/pdf-injection/r03_repairs.py`，只在 `--experimental-r03-repairs` 时导入执行。默认路径不依赖这些修复；R03 清单中的相应实验元数据不等于已启用修复。

这些是职责拆分，不是全格式框架。当前解析入口是已有快照转换，尚未把 MinerU 或 Docling 注册成运行时解析实现；BabelDOC 的捕获仍由已有 Python 入口完成。

## 接口与兼容方式

通用来源 provider 提供 `id`、`project`（结构校验／投影）和 `readable`，可按需提供快照转换、结构提示、清单扩展与来源修正。记录保存来源工具的私有字段但不解释其内容。通用 PDF 输出注册单独的渲染函数；来源实现不要求附带 PDF 渲染器。选中但未注册的来源或渲染实现会明确报错。

旧 M3 `pdfSource` 记录由 BabelDOC provider 识别和投影，无需重写接受 revision 或重新翻译。新的结构化导入使用带 provider 标识的 `sourceBinding`。默认装配仍选择 BabelDOC，尚未提供动态插件发现或外部配置式安装；新增实现通过应用装配注册即可。

来源接口不是跨解析器自动对齐：其他解析器输出与 BabelDOC 的块仍需另行关联。当前语言范围及 draft→accepted 行为也未扩展；正常任务仍需显式选定修订，自动选定留待后续。

## 验证与产物

| 检查 | 实际结果 |
|---|---|
| 现有回归 | `npm test` 完整构建与测试 15/15 通过；最后接口微调后，受影响 PDF 测试 3/3 通过，Python 编译检查及 Git 空白检查通过 |
| 非 BabelDOC 来源结构 | 原创 `column-blocks` 两单位测试使用列／行定位，无 PDF 字段，经过同一导入、接受和清单路径；同时检查重复 ID。它是最小测试 provider，不代表已接入第二个真实解析器 |
| 既有真实页兼容 | 旧 R03 第 1 页 store 经新 `export-pdf` 路线只读回放，11/11 条、11 回调、0 正文模型请求；显式启用历史 R03 修复 |
| 默认 PDF 路线 | 复用与 R03 布局不同的 M1 原创控制 PDF 第 1 页，4/4 条、4 回调、0 正文模型请求；未启用实验修复。未把已知 `We` 上游分段／阈值缺陷写成解决 |
| 新输出入口取消 | 已启动的输出取消后不发布正式结果，运行证据保存在 `cancel-default/`；M3 已有回调中取消证据继续保留 |

产物沿用忽略目录：

- [真实页回放 PDF／MD／JSON](../../../../evaluation/runs/m3.1/replay-page1/published/)
- [原创默认路线 PDF／MD／JSON](../../../../evaluation/runs/m3.1/original-default-2/published/)
- [取消诊断](../../../../evaluation/runs/m3.1/cancel-default/)

首次原创临时输入缺少捕获配置字段，被适配器拒绝；补齐既有配置后通过，没有绕过适用性检查。未重跑全部 R03，也未新增逐页视觉精修。

## 使用与下一步

已完成 M3 环境准备时，新目录中复用已有真实页的命令为：

```powershell
node src/cli.mjs export-pdf R03-p1 --store evaluation/runs/m3-3/store --run-dir evaluation/runs/m3.1/my-replay --experimental-r03-repairs
```

正常 PDF 输出不加最后的实验开关。Python 默认仍使用 M3-1 专用环境；路径和 BabelDOC 版本约束在具体输出适配器内，不属于通用记录接口。

下一步优先规划算法检查后的自动版本选定，或按实际使用需要接入第二种来源；不要求先扩展所有格式。通用接口已有验证，但没有证明任意 PDF 的自动排版质量，上游固有缺陷仍按总结中的边界处理。
