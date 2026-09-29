# PDF 已有译文注入：M1 源码与实际实验

日期：2026-09-29。结论：**BabelDOC 可以通过记录回放翻译器消费已有译文并真实重建 PDF，无需再调用正文模型；pdf2zh-next 可作为其上层参考，但未发现直接导入 ivoraige 译文 JSON 的现成公开接口。** 当前证据覆盖两页原创控制样本，验证同源 PDF／Markdown／JSON 复用；尚不证明 MinerU 与 BabelDOC 自动对齐，也未完成真实科研代表页验收。控制样本存在一个英文短词 `We` 被分离保留的解析缺陷，不能称为完整翻译质量通过。

## 版本与许可证

| 官方来源 | 克隆路径 | 版本／commit | 许可证 |
|---|---|---|---|
| [PDFMathTranslate-next](https://github.com/PDFMathTranslate-next/PDFMathTranslate-next) | `experiments/vendor/pdf2zh-next` | 2.9.0／`f8dffcf4c3a33b254391d43514439b975ce8d966` | AGPL-3.0 |
| [BabelDOC](https://github.com/funstory-ai/BabelDOC) | `experiments/vendor/babeldoc` | 0.6.4／`38d3896dcde9b5a940c62cf5563cadea673a64d3` | AGPL-3.0 |

官方 `pyproject.toml` 与 LICENSE 均已查看。pdf2zh-next 声明 `babeldoc>=0.6.2,<0.7.0`；其 PyMuPDF 上限与当前 BabelDOC 源码下限存在冲突，因此此次不安装两者的完整依赖组合。复用本机 pdf2zh 的 0.6.2 依赖环境，经 `sys.path` 导入克隆的 BabelDOC 0.6.4；真实重建执行的是该源码。两份 vendor 无源码修改。接入／分发时须另行核对 AGPL 的适用方式，本实验不作法律判断。

## 实际注入入口与分块

1. [pdf2zh-next high_level.py](https://github.com/PDFMathTranslate-next/PDFMathTranslate-next/blob/f8dffcf4c3a33b254391d43514439b975ce8d966/pdf2zh_next/high_level.py#L534) 用 `get_translator(settings)` 建翻译器，约 L581–631 把它装进 `BabelDOCConfig(translator=...)`，L172 调 BabelDOC。设置层主要是已有引擎选择，未见可直接把已接受段落记录交给其 CLI 的入口。实验直接使用下层 API，未假装跑过完整 pdf2zh-next CLI。
2. [TranslationConfig](https://github.com/funstory-ai/BabelDOC/blob/38d3896dcde9b5a940c62cf5563cadea673a64d3/babeldoc/format/pdf/translation_config.py#L156) 构造函数接受 `BaseTranslator`、输入 PDF、语言、布局模型、工作目录及关闭自动术语提取等选项。`skip_translation=True` 是跳过翻译阶段，不是已有译文载入接口。
3. [high_level.py L967–1003](https://github.com/funstory-ai/BabelDOC/blob/38d3896dcde9b5a940c62cf5563cadea673a64d3/babeldoc/format/pdf/high_level.py#L967) 在自身 PDF 解析、布局识别、ParagraphFinder、StylesAndFormulas 后调用翻译器。它会重新分段并提取公式／样式占位符；不能直接假定 MinerU 原有块 ID 相同。
4. [ILTranslator L959–1017](https://github.com/funstory-ai/BabelDOC/blob/38d3896dcde9b5a940c62cf5563cadea673a64d3/babeldoc/format/pdf/document_il/midend/il_translator.py#L959) 将段落变为实际请求文本，再用译文更新 `paragraph.unicode` 与 composition；正文回调约 L1257 只得到文本和 token 数，**不携带页码或段落对象**。实验在 `translate_paragraph` 附加一个小型线程局部位置上下文，再严格回放记录。生产接入可做同样的局部适配，或在其翻译阶段前后处理 IL；后者本轮没有执行验证。
5. [paragraph_finder.py L46](https://github.com/funstory-ai/BabelDOC/blob/38d3896dcde9b5a940c62cf5563cadea673a64d3/babeldoc/format/pdf/document_il/midend/paragraph_finder.py#L46) 的 `debug_id` 是随机 base58；实际重跑也发生变化。不能把它当持久复用键。此次使用零基页码＋bbox 三位小数，再对 `request_text` 完全相等校验。坐标采用 PDF 左下原点。仅保证此次相同 PDF、相同版本和配置；跨版本或改版后必须重建映射。

实验特意在两页放入相同英文句子，并给两处不同中文译文。回放按来源位置取不同 `record_id`，因此证明了位置绑定，超出“任意请求都返回固定字符串”的演示。`accepted.json` 保存真实请求、来源位置、`source_unicode`、目标中文、record_id 和 revision=1；固定译文为 agent 编写控制材料，不是人工确认数据。

公式的实际请求为 `E <b1>- m H`，已有记录把占位符保持到 PDF 重建，Markdown／JSON 使用人可读的 `E = - m H`。这属于结构化公式还原，未调用语言模型改写。若改用其 LLM 路线，还需处理批量 JSON 与 rich-text 提示、占位符失败后的 fallback；本轮主动选择非 LLM 的段落路线。

## 额外调用与排版

- [BaseTranslator L139–193](https://github.com/funstory-ai/BabelDOC/blob/38d3896dcde9b5a940c62cf5563cadea673a64d3/babeldoc/translator/translator.py#L139) 具有普通 `translate` 和 `llm_translate` 两条路线及内置 SQLite 缓存。实验 `ignore_cache=True`，所以成功不依赖隐藏缓存。
- BabelDOC 会用 `do_llm_translate(None)` 探测能力；适配器明确抛 `NotImplementedError`，使其走 `ILTranslator` 而非 `ILTranslatorLLMOnly`，无真实 LLM 请求。
- 自动术语提取默认开启，会调用 `term_extraction_translator.llm_translate`。此次 `auto_extract_glossary=False`，OCR 自动开启也关闭。默认行为必须在产品配置中显式控制，不能仅替换正文引擎就宣称所有步骤零模型调用。
- [typesetting.py L948–1076](https://github.com/funstory-ai/BabelDOC/blob/38d3896dcde9b5a940c62cf5563cadea673a64d3/babeldoc/format/pdf/document_il/midend/typesetting.py#L948) 尝试缩放、空间扩展与重排，最小缩放可至 0.1；它提供排版策略而不是长文可读性的保证。

实际运行不建立模型客户端，不提供 API 密钥；非环回 socket 连接被阻断。允许 Windows asyncio 自身环回 socket pair，不能把这项拦截单独当成所有本地端点调用的证明；零真实模型请求同时由纯记录适配器、无 HTTP 模型实现及禁用 LLM 分支支持。ONNX 布局模型在 CPU 本地执行，属于解析计算，不能叫“零模型推理”。

## 可复跑产物与证据

脚本与命令在 [experiments/pdf-injection/README.md](../../experiments/pdf-injection/README.md)，实现为 [run.py](../../experiments/pdf-injection/run.py)。所有输入与运行输出在已忽略的 `evaluation/runs/m1-pdf-injection/`，无版权原件新增、无全文重解析或通用哈希关卡。

| 产物 | 作用 |
|---|---|
| `original-control.pdf` | 两页原创英文原件；含重复句、长译文段、公式与矢量示意图 |
| `accepted.json`／`capture-calls.json` | 7 条真实请求与位置；6 条中文文本记录＋1 条公式记录 |
| `replay/` | 首次已有译文回放的 PDF、translations.md、translations.json 与两页 PNG |
| `repeat/` | 无变更重跑的同类输出 |
| `replay-calls.json`／`repeat-calls.json` | 请求到 record_id／revision 的映射日志 |
| `replay-evidence.json`／`repeat-evidence.json` | 逐记录 PDF 文本检查、真实模型请求与缓存计数 |
| `capture.log`／`replay.log`／`repeat.log` | BabelDOC 实际运行、耗时与本机环境警告 |

计数定义：每次 PDF 回放会发生 7 次记录适配器回调；正文／LLM 实际模型请求 0，内置缓存命中 0。Markdown／JSON 导出是同份 records 的直接序列化，没有翻译调用。逐记录 PDF 抽取检查忽略空白与公式中的控制字符 U+0003；它只验证内容存在，排版另行看 PNG。

实际 `replay` 与 `repeat` 均 exit=0：每次 7 次回调、0 真实模型请求、0 LLM 请求、0 缓存命中、0 非环回网络尝试、0 位置／原文失配，7／7 记录 PDF 文本在各自预期页存在；JSON 的 record_id／revision／target 与 accepted store 一致。两次 PDF 重建分别约 28.03／29.80 秒；峰值内存约 2.29／2.56 GB（BabelDOC 日志）。日志中 `gpt-4o` 的 56 个有效文本 token 是本地 tokenizer 统计，不是模型调用或付费用量。

失败尝试已修复而未掩盖：位置 box 是 slots dataclass，初次 `vars()` 无效，改成 `asdict()`；初版使用随机 ID 不适合重放，改为位置；禁止所有 socket 时 Windows asyncio 的本机环回也被阻断，改为允许其环回；公式 PDF 抽取带 U+0003，标准化后再检查。未知译文块即使上游 `ILTranslator` 吞异常，本脚本仍在汇总时拒绝成功。首次错误产生的 debug PDF 仅属诊断，不能拿作验收产物。

## 排版抽检与剩余限制

对真正注入中文后的两页 PNG进行了 agent 目视检查：中文标题、正文与长译文清晰，未见裁切、互相覆盖或越界；图的矩形与蓝色线保留；公式可见为 `E = - m H`；两处相同英文对应各自不同中文。目视检查不是用户人工确认。

第一页面的 `We` 被 BabelDOC 识别为独立非翻译内容，PDF 中仍有 `We`，而回调原文仅为 `retain ...`。这说明“所有进入翻译器的记录都映射成功”与“原文全部正确进入翻译器”不同。后续 M3 需增加解析覆盖检查与公式误判修正，不应把此控制例子称为完整翻译验收通过。

此次没有扫描件、双栏正文、表格、真实科研 dev 代表页或跨页段落的重建验收；也没有验证跨 MinerU 块映射。M1 已得到可运行的注入路线及代价证据，M3 仍需把规范化块与 BabelDOC IL 之间的对应持久化，固定解析器／布局模型配置，验证代表页、覆盖与可读性，并在失配时向用户集中展示实际疑点。
