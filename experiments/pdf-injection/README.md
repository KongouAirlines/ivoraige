# BabelDOC 已有译文重放实验

本实验直接执行官方 BabelDOC 克隆源码；pdf2zh-next 是其上层配置与翻译器参考实现。仅验证原创两页控制 PDF，不读取留出答案，不使用 MinerU，不连接真实模型。

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

产物与完整研究结论见 `evaluation/runs/m1-pdf-injection/` 及 `docs/research/pdf-translation-injection.md`。这不是跨解析器对齐方案，也未完成真实科研代表页验收。
