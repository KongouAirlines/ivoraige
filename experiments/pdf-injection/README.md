# BabelDOC 已有译文重放实验

本实验直接执行官方 BabelDOC 克隆源码；pdf2zh-next 是其上层配置与翻译器参考实现。仅验证原创两页控制 PDF，不读取留出答案，不使用 MinerU，不连接真实模型。

## M3-1 独立环境与入口

固定组合为 Python 3.13、官方 BabelDOC 0.6.4、PyMuPDF 1.26.7，以及 [requirements.lock](requirements.lock) 中的其余已解析依赖。PowerShell 从仓库根目录运行：

```powershell
./experiments/pdf-injection/m3.ps1 setup
./experiments/pdf-injection/m3.ps1 capture -RunDir evaluation/runs/m3-1/my-capture
./experiments/pdf-injection/m3.ps1 replay -RunDir evaluation/runs/m3-1/my-replay
./experiments/pdf-injection/m3.ps1 capture -InputPdf 'evaluation/private/originals/mumax3/Vansteenkiste 等 - 2014 - The design and verification of MuMax3.pdf' -Pages 1 -RunDir evaluation/runs/m3-2/page1-detail
```

入口为 [adapter.py](adapter.py)。默认输入沿用 M1 原创 PDF；回放默认读取 M1 的 `accepted.json`，可通过 `-InputPdf`、`-Records` 指定其他输入。每次选择新的 `-RunDir`。`setup` 只安装到 `evaluation/runs/m3-1/.venv`，不修改全局 Python；运行时要求本机已有 BabelDOC 布局模型、字体与 tiktoken 资产，默认复用用户目录 `.cache/babeldoc`，可直接调用 Python 入口用 `--assets` 改路径。布局模型仍在本地执行。私有运行文件及 uv 缓存留在已忽略的 `evaluation/runs/`。

M3-2 使用 `-Pages 1`、`-Pages 2`、`-Pages 4` 分别捕获；`-MinTextLength` 仅供有记录的阈值诊断，改值会改变来源快照。三页捕获后运行 `evaluation/runs/m3-1/.venv/Scripts/python.exe experiments/pdf-injection/m3_snapshot.py`，重建固定单位及来源绑定清单。私有结果在 `evaluation/runs/m3-2/`；[M3-2 记录](../../docs/plan/mvp/m3/m3-2-completion.md)列出实际覆盖缺项。

`capture.json` 是引擎真实请求的页码、明确顺序的 bbox（x、y、x2、y2，PDF 左下原点）、原文、请求文本与诊断 ID；capture 生成的 PDF 只是诊断物。`replay` 对每次请求严格核对位置和 `request_text`，拒绝重复回调与未消费记录。BabelDOC 即使吞掉回调异常，也会由适配器汇总为失败。输出先在 `staging/` 重建，只有全部记录消费且 PDF 各页含对应目标文本时才改名为 `published/`；失败只留诊断数据。调用者还须核对完整源文覆盖，尤其 M1 样本中未进入翻译器的 `We`；此处的七条回放成功不是整页译文质量验收。

M3-1 证据及限制见 [完成记录](../../docs/plan/mvp/m3/m3-1-completion.md)。下方 M1 命令保留为历史实验复现方式。

PowerShell，从仓库根目录执行（复用本机已有依赖）：

```powershell
$pdfPython = 'D:/Program Files/zotero-pdf2zh/server/zotero-pdf2zh-next-venv/Scripts/python.exe'
& $pdfPython experiments/pdf-injection/run.py capture
& $pdfPython experiments/pdf-injection/run.py replay
& $pdfPython experiments/pdf-injection/run.py repeat
```

`capture` 创建原创原件，收集 BabelDOC 实际调用前的页码、位置、诊断 ID、实际请求原文与占位符，再为已列明的控制原文写入固定中文 `accepted.json`。这是 agent 编写的测试译文，不是人工认可科研译文。`replay` 和 `repeat` 均只读这份记录；PDF、Markdown、JSON 共用 record_id 与 revision=1。实际源码未修改。

映射键为零基页码与三位小数 bbox（PDF 左下原点），对实际请求文本做完全相等校验。重放附带 `ILTranslator.translate_paragraph` 的线程局部位置上下文，因为公开 `BaseTranslator.translate(text)` 本身不传页码或段落对象。诊断 ID 随机，只作证据。未知键或不同文本即使被上游吞掉异常，实验末尾也会判失败，不输出成功证据。

运行环境预先安装 BabelDOC 0.6.2 的依赖，脚本通过 `sys.path` 使用 vendor 中 0.6.4 源码。已有 `.cache/babeldoc` 字体、CMAP、tiktoken、ONNX 资产只读复用；实验 DB 与工作文件写入 `evaluation/runs/m1-pdf-injection/`。环境特定路径需按另一台机器安装情况调整。未新建完整环境或安装大型模型。

脚本禁用缓存、关闭自动术语提取和 OCR，拒绝 LLM 能力探测；非环回 socket 连接会被阻断。Windows asyncio 的本机环回 socket pair 保留，实验无 HTTP 模型客户。`adapter_requests` 是消费已保存译文的回调次数，不是模型请求次数。`real_model_requests=0` 的依据是纯记录适配器、无模型客户端、无 LLM 路线及网络拦截，不能把回调次数也填成零。

产物与完整研究结论见 `evaluation/runs/m1-pdf-injection/` 及 `docs/plan/mvp/m1/pdf-translation-injection.md`。这不是跨解析器对齐方案，也未完成真实科研代表页验收。
