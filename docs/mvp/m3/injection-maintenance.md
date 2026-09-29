# M3：PDF 注入维护方案

日期：2026-09-29｜状态：仅规划；未新增实现、运行实验、建立 fork 或向上游提交 issue／PR。

本文单独回答 pdf2zh-next／BabelDOC 注入的维护方式、版本适配和未来上游贡献问题。证据来自 [M1 注入实验](../m1/pdf-translation-injection.md)；本阶段具体目标、插件关系和验收步骤见 [M3 实施规划](plan.md)。长期维护讨论不增加本轮 MVP 的交付前置条件。

## 1. 建议采用的维护方式

最小 MVP 采用 **官方固定版本 BabelDOC＋项目自有 Python 适配插件**：Cordis 侧负责启动、取消、传递明确输入及接受清单；Python 侧在专用子进程中创建自定义 `BaseTranslator`，并封装当前必要的位置 hook。初期可在本仓库保留一个小型适配目录，不先拆独立发行包。

使用项目选定的 Python 环境与官方依赖，不改用户的 pdf2zh／Zotero 全局安装，不在启动时自动升级或给安装文件打补丁。位置 hook 仅替换该子进程内的方法；进程退出结束它的影响。它依然是对内部实现的适配，不能因此称为零侵入、跨版本稳定或正式插件 API。

| 方式 | 能获得什么 | 成本与边界 | M3 判断 |
|---|---|---|---|
| 自维护“注入版”完整 fork | 能直接修改段落定位、IL 和输出流程；必要时增加接口 | 持续承担上游合并、依赖与安装发布、内部结构变化；可能与用户既有客户端安装冲突 | 不预先建长期 fork。若公开接口及有限 hook 均无法可靠捕获／覆盖／回放，再针对固定提交建立短期、最小改动 fork，并记录退出条件 |
| 插件加载官方固定版本，在专用进程内适配 | 复用正常 BabelDOC 引擎、公开 translator 对象注入；保留小段位置／覆盖适配代码 | 内部 hook 有版本耦合；官方升级需重跑受影响代表页，不能默认兼容；依赖打包仍需单独解决 | **MVP 首选**。维护的是项目适配器和明确支持的引擎版本，用户全局安装不参与 patch |
| 先做上述一种，再贡献公开接口 | 先取得真实数据与缺口证据，再争取上游维护正式入口 | 上游可能不接受或需要改设计，合入时间不可作为交付前提 | 从首选适配路线开始；定位／IL／已有译文接口主要向 BabelDOC 提议；只有需要 pdf2zh-next 的配置或 CLI／GUI入口时，再向其上层提交集成 |

“先选一种，以后贡献上游”是实施顺序，不是现在就 fork 或提 PR 的要求。即使上游暂不接收，固定版本局部适配仍可满足 MVP；若后续合入正式接口，再迁移适配器并移除对应 hook。


## 2. 实际接口所在层次与已知证据

固定证据为 **BabelDOC 0.6.4／`38d3896dcde9b5a940c62cf5563cadea673a64d3`** 和 **PDFMathTranslate-next 2.9.0／`f8dffcf4c3a33b254391d43514439b975ce8d966`**。这是已读源码与 M1 的版本，不是“最新版本”声明，也不是已完成可分发安装包。

| 入口或行为 | 固定源码实际提供 | 对本项目的含义 |
|---|---|---|
| BabelDOC `TranslationConfig(translator=...)` | 接受 `BaseTranslator` 对象、输入 PDF、pages、布局模型、工作目录等 | 可以直接接项目翻译器，先不经过完整 pdf2zh-next 应用；`skip_translation=True` 只是跳过阶段，不是导入已有译文 |
| BabelDOC `BaseTranslator` | `translate`／`llm_translate`，子类 `do_translate`／`do_llm_translate`，占位符方法及缓存 | 公开自定义翻译器路线可消费已有译文；普通回调只有文本与限速信息，无页码／bbox／段落对象 |
| `ILTranslator.translate_paragraph` | 内部接收 paragraph 和 page，经预处理生成真实请求，再后处理译文与 composition | M1 临时包裹此方法把来源放入线程局部上下文；这是内部 hook，不是官方 locator callback |
| BabelDOC high-level pipeline | 自己做解析、布局、ParagraphFinder、StylesAndFormulas，然后翻译与排版 | 它的段落与 MinerU 块不是同一 ID；IL 调试 JSON 可辅助核查，但不等于稳定的“载入修改后 IL 再重建”公开 API |
| pdf2zh-next `create_babeldoc_config` | `get_translator(settings)` 创建翻译器，再交给 BabelDOCConfig 与 BabelDOC async_translate | pdf2zh-next 是引擎选择、配置和客户端的上层封装；本版未发现直接导入 ivoraige 接受译文 JSON 的公开入口 |

证据：[TranslationConfig](https://github.com/funstory-ai/BabelDOC/blob/38d3896dcde9b5a940c62cf5563cadea673a64d3/babeldoc/format/pdf/translation_config.py#L153)、[BaseTranslator](https://github.com/funstory-ai/BabelDOC/blob/38d3896dcde9b5a940c62cf5563cadea673a64d3/babeldoc/translator/translator.py#L79)、[段落内部方法](https://github.com/funstory-ai/BabelDOC/blob/38d3896dcde9b5a940c62cf5563cadea673a64d3/babeldoc/format/pdf/document_il/midend/il_translator.py#L1214)、[解析到翻译阶段](https://github.com/funstory-ai/BabelDOC/blob/38d3896dcde9b5a940c62cf5563cadea673a64d3/babeldoc/format/pdf/high_level.py#L971)、[pdf2zh-next 配置封装](https://github.com/PDFMathTranslate-next/PDFMathTranslate-next/blob/f8dffcf4c3a33b254391d43514439b975ce8d966/pdf2zh_next/high_level.py#L531)。

M1 的 [run.py](../../../experiments/pdf-injection/run.py) 用两页原创 PDF 跑了捕获、回放、重复回放：每次回放7次记录回调、0正文／LLM实际请求、0缓存命中，记录内容出现在预期页。公式请求形态为 `E <b1>- m H`，人读输出为 `E = - m H`；重复英文句在不同位置绑定了不同译文。它证明该固定组合的已有译文回填可行，没有证明实际科研页、跨解析器映射或整页输入完整。

M1 还有明确缺口：`paragraph.debug_id` 是随机 base58，重跑不稳定；页码＋三位小数 bbox＋请求原文只在同原件、固定解析版本与配置下工作；`We` 被分离成未进入回调的内容而漏译，说明“回调全匹配”不等于“原文全覆盖”。源码还会跳过过短／不可处理段落，并在某些翻译异常后记录日志继续执行，适配层不能仅以进程退出0或PDF文件存在判断成功。[随机 ID](https://github.com/funstory-ai/BabelDOC/blob/38d3896dcde9b5a940c62cf5563cadea673a64d3/babeldoc/format/pdf/document_il/midend/paragraph_finder.py#L46)、[预处理跳过](https://github.com/funstory-ai/BabelDOC/blob/38d3896dcde9b5a940c62cf5563cadea673a64d3/babeldoc/format/pdf/document_il/midend/il_translator.py#L954)、[异常继续](https://github.com/funstory-ai/BabelDOC/blob/38d3896dcde9b5a940c62cf5563cadea673a64d3/babeldoc/format/pdf/document_il/midend/il_translator.py#L1273)。

M1 通过已有0.6.2依赖环境载入0.6.4源码，属于本机实验做法，不能原样当作产品依赖方案。固定源码中 pdf2zh-next 声明 `babeldoc>=0.6.2,<0.7.0`、`pymupdf<1.25.3`，而 BabelDOC 0.6.4 声明 `pymupdf>=1.26.7`，存在组合冲突。M3 先验证直接 BabelDOC 独立环境，不要求装完整上层；如以后整合 pdf2zh-next，再确认那个组合的依赖兼容。两者源码许可均 AGPL-3.0，实际分发方式与通知随打包方案确认，不把子进程边界等同许可结论。[上层包清单](https://github.com/PDFMathTranslate-next/PDFMathTranslate-next/blob/f8dffcf4c3a33b254391d43514439b975ce8d966/pyproject.toml)、[BabelDOC 包清单](https://github.com/funstory-ai/BabelDOC/blob/38d3896dcde9b5a940c62cf5563cadea673a64d3/pyproject.toml)。


## 3. 将来向上游贡献什么

目前最明确缺口是公开翻译器回调缺少定位信息，以及没有本项目已验证的稳定“外部接受译文／IL输入后重建”接口。**以下只是拟议方向，不是声称上游已有功能：**

- 向 BabelDOC 提议可选来源上下文／locator callback，让适配器得到页、来源块与必要结构，且说明ID在哪些源／版本边界内稳定；不是要求上游承诺任意改版永久ID。
- 或提议公开的IL导出／校验／导入或已有译文映射入口，能让外部系统先核覆盖、接受与绑定，再确定性重建；明确缺项与占位符错误应对外报告失败。
- 若后续用户需要保留 pdf2zh-next 的CLI／GUI，向其贡献选择外部译文提供方、清单路径或入口传递；定位和排版结构接口仍主要由BabelDOC解决。

先由M3代表页证明哪个接口最小、确实能减少内部hook，再决定提案。需要短期fork的条件是：普通公开注入和限于专用进程的局部适配无法可靠完成必要覆盖／结构回填，或内部异常处理无法被外层汇总可靠观察；届时只维护必要改动与固定基线，同时保留上游贡献／退出路线。本轮不提前建立fork、不修改官方源码，也不预先提交提案。
