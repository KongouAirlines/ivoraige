# 官方来源与后续访问入口

版本：v1.0｜整理日期：2026-09-29。

本版配合用户修改后的需求与优先级基线整理，**没有新增联网核查，也没有改写既有来源的能力结论**。C01～C83 及参考标准的正文、链接和历史日期原样保留。当前需求优先级以 [功能需求概览 v1.0](01_功能需求概览_v1.0.md) 为准；历史记录中的“高优先级”或“本轮”指其当时版本，不覆盖本次调整。

## 历史来源记录（以下沿用 v0.5）

版本：v0.5｜整理日期：2026-09-29。保留 C01～C77 的既有记录，新增 C78～C83；本轮仅为高优先级词典接入查阅这些新增对象的官方资料，未重查全部旧候选。旧记录中的日期与判断仍是原版本记录，不能当成本轮重新验证。需求优先级是规划建议，不是由项目官网或性能榜单给出的结论。

原始记录说明（v0.3.2）：原条目查阅日期为 2026-09-21；v0.3.1 于 2026-09-22 补查 C05～C07 并新增 C64～C67。本轮 v0.3.2 同日补查 C26、C45，新增 C68～C77，聚焦视觉小说与漫画的输入／输出往返；其余条目沿用，未全面重查。官方能力描述用于候选筛选，不代表已部署或联调。

## C01 · Cordis
- https://github.com/cordiverse/cordis

## C02 · MCP 官方 TypeScript / Python SDK
- https://github.com/modelcontextprotocol/typescript-sdk
- https://github.com/modelcontextprotocol/python-sdk

## C03 · FastMCP
- https://gofastmcp.com/servers/composition

## C04 · LiteLLM
- https://docs.litellm.ai/docs/

## C05 · Ollama
- https://docs.ollama.com/api/openai-compatibility
- https://docs.ollama.com/faq
- https://docs.ollama.com/api/generate

2026-09-22 增补：空请求预加载、keep_alive／stop、原生响应 load_duration，以及并发加载的资源条件。

## C06 · LM Studio
- https://lmstudio.ai/docs/developer
- https://lmstudio.ai/docs/developer/rest/load
- https://lmstudio.ai/docs/developer/rest/unload
- https://lmstudio.ai/docs/developer/core/ttl-and-auto-evict

2026-09-22 增补：原生加载／卸载、load_time_seconds、JIT、TTL 与 Auto-Evict。

## C07 · llama.cpp / llama-server
- https://github.com/ggml-org/llama.cpp
- https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md

2026-09-22 增补：空闲休眠、权重／缓存卸载和新任务唤醒；并非已内置本项目的流程预测。

## C08 · vLLM
- https://docs.vllm.ai/en/latest/serving/online_serving/openai_compatible_server/

## C09 · Xinference
- https://github.com/xorbitsai/inference

## C10 · 腾讯 HY-MT 系列
- https://github.com/Tencent-Hunyuan/Hy-MT
- https://github.com/Tencent-Hunyuan/Hy-MT2

## C11 · Qwen-MT
- https://www.alibabacloud.com/help/en/model-studio/machine-translation

## C12 · SakuraLLM
- https://github.com/SakuraLLM/SakuraLLM

## C13 · DeepL API
- https://support.deepl.com/hc/en-us/articles/4405021321746-Use-a-glossary-with-DeepL-API
- https://support.deepl.com/hc/en-us/articles/4411401630226-Apply-a-glossary-to-file-translation

## C14 · MinerU
- https://github.com/opendatalab/MinerU

## C15 · Docling
- https://github.com/docling-project/docling

## C16 · Marker
- https://github.com/datalab-to/marker

## C17 · MinerU-Popo
- https://github.com/opendatalab/MinerU-Popo

## C18 · Unstructured
- https://github.com/Unstructured-IO/unstructured

## C19 · GROBID
- https://grobid.readthedocs.io/en/latest/

## C20 · LlamaParse / LlamaCloud Parse
- https://developers.llamaindex.ai/llamaparse/parse/

## C21 · Azure Document Intelligence
- https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/overview

## C22 · Umi-OCR
- https://github.com/hiroi-sora/Umi-OCR
- https://github.com/hiroi-sora/Umi-OCR/blob/main/docs/http/api_ocr.md
- https://github.com/hiroi-sora/Umi-OCR/blob/main/docs/http/api_doc.md

## C23 · RapidOCR
- https://github.com/RapidAI/RapidOCR

## C24 · PaddleOCR / PP-Structure
- https://github.com/PaddlePaddle/PaddleOCR

## C25 · OCRmyPDF
- https://github.com/ocrmypdf/OCRmyPDF

## C26 · manga-ocr
- https://github.com/kha-white/manga-ocr

2026-09-22 v0.3.2 补查：针对日语漫画文字的 OCR；其职责不含完整气泡定位、抹字和嵌字。

## C27 · Mathpix
- https://docs.mathpix.com/

## C28 · ABBYY FineReader Engine
- https://www.abbyy.cn/ocr-sdk/

## C29 · BabelDOC / PDFMathTranslate Next
- https://github.com/funstory-ai/BabelDOC
- https://github.com/PDFMathTranslate-next/PDFMathTranslate-next

## C30 · pypdf / qpdf
- https://pypdf.readthedocs.io/en/stable/user/handling-outlines.html
- https://qpdf.readthedocs.io/en/stable/cli.html

## C31 · PyMuPDF
- https://pymupdf.readthedocs.io/en/latest/

## C32 · Stirling-PDF
- https://github.com/Stirling-Tools/Stirling-PDF

## C33 · Adobe PDF Services / Extract
- https://developer.adobe.com/document-services/apis/pdf-services/

## C34 · Okapi Framework / Tikal
- https://okapiframework.org/wiki/index.php/Filters
- https://okapiframework.org/wiki/index.php/Tikal

## C35 · Terminologue
- https://www.terminologue.org/docs/intro.en/

## C36 · VocBench 3 / Semantic Turkey
- https://vocbench.uniroma2.it/doc/user/

## C37 · TemaTres
- https://github.com/tematres/TemaTres-Vocabulary-Server

## C38 · Skosmos
- https://github.com/NatLibFi/Skosmos

## C39 · Annif
- https://github.com/NatLibFi/Annif

## C40 · KeyBERT / YAKE
- https://github.com/MaartenGr/KeyBERT
- https://github.com/INESCTEC/yake

## C41 · DocuTranslate
- https://github.com/xunbu/docutranslate

## C42 · translation-agent
- https://github.com/andrewyng/translation-agent

## C43 · AiNiee
- https://github.com/NEKOparapa/AiNiee

## C44 · LinguaGacha
- https://github.com/neavo/LinguaGacha

## C45 · GalTransl
- https://github.com/GalTransl/GalTransl

2026-09-22 v0.3.2 补查：name-message JSON、项目词典及提取—翻译—回填的分工；官方同时引用 SExtractor、VNTextPatch 等引擎工具。作为专项工作流或译文交换候选，不声明仅导出 JSON 就生成了可运行补丁。

## C46 · Ebook Translator（calibre 插件）
- https://github.com/bookfere/Ebook-Translator-Calibre-Plugin

## C47 · OmegaT
- https://omegat.org/

## C48 · translate5
- https://www.translate5.net/

## C49 · Trados Studio / MultiTerm
- https://developers.rws.com/

## C50 · memoQ / memoQ TMS
- https://docs.memoq.com/11-3/api-docs/wsapi/memoqservices/index.html

## C51 · Phrase TMS
- https://developers.phrase.com/en/api/tms/latest/introduction

## C52 · Tiptap / PDF.js
- https://tiptap.dev/docs/editor/getting-started/overview
- https://mozilla.github.io/pdf.js/

## C53 · KISS Translator
- https://github.com/fishjar/kiss-translator

## C54 · 沉浸式翻译
- https://immersivetranslate.com/docs/services/openai/

## C55 · Pot
- https://github.com/pot-app/pot-desktop

## C56 · Easydict
- https://github.com/tisfeng/Easydict

## C57 · Bob
- https://bobtranslate.com/plugin/quickstart/translate.html
- https://bobtranslate.com/guide/advance/plugin.html

## C58 · GoldenDict-ng
- https://github.com/xiaoyifang/goldendict-ng

## C59 · Zotero
- https://www.zotero.org/support/dev/client_coding/plugin_development
- https://www.zotero.org/support/dev/web_api/

## C60 · Obsidian
- https://docs.obsidian.md/plugins/releasing/submit-plugin

## C61 · Joplin
- https://joplinapp.org/help/api/references/rest_api/

## C62 · Dify
- https://github.com/langgenius/dify

## C63 · LangGraph
- https://github.com/langchain-ai/langgraph

## C64 · Jev / TypeSafe System One
- https://typesafe.ai/blog/introducing-system-one-models-and-jev
- https://api.typesafe.ai/docs

2026-09-22 核查：官方将其定位为结构化决策模型，提供选项、评分及是／否类问题。这里只作为自动调度候选，不采纳“格式正确即决策正确”或自动保证翻译质量的推论，也不在本版承诺价格、性能或本地部署。

## C65 · Semantic Router（Aurelio）
- https://github.com/aurelio-labs/semantic-router
- https://raw.githubusercontent.com/aurelio-labs/semantic-router/main/README.md

2026-09-22 核查：语义向量与示例路由、本地执行路线；将路由连接到翻译配置是拟议适配。

## C66 · RouteLLM
- https://github.com/lm-sys/RouteLLM
- https://raw.githubusercontent.com/lm-sys/RouteLLM/main/README.md

2026-09-22 核查：强／弱模型路由、阈值校准及可扩展评估；不把其现有通用问答结果当作科研或文学翻译的实测结果。

## C67 · SetFit
- https://github.com/huggingface/setfit
- https://huggingface.co/docs/setfit

2026-09-22 核查：少样本分类、Sentence Transformers 与多语言选项；需要本项目类别及样本，并非现成翻译流程选择器。

## C68 · Ren’Py 原生翻译机制
- https://www.renpy.org/doc/html/translation.html

2026-09-22 核查：原生对白翻译单元、菜单／界面字符串、语言目录、图片与样式支持。适合有项目脚本或翻译模板的输入；本项目尚未实现导出适配，不承诺任意成品游戏可直接处理。

## C69 · SExtractor
- https://github.com/satan53x/SExtractor

2026-09-22 核查：脚本文字提取和导入、多引擎及 JSON／TXT 导出；官方说明同一引擎的不同游戏也可能格式不同。适合脚本往返，不是所有游戏的通用一键翻译器。

## C70 · VNTranslationTools / VNTextPatch
- https://github.com/arcusmaximus/VNTranslationTools

2026-09-22 核查：多引擎文本提取和回填、JSON／表格交换。原仓库于 2023-06-02 归档；列为兼容与代码复用候选，不声称仍持续维护。

## C71 · Translator++
- https://dreamsavior.net/
- https://dreamsavior.net/docs/
- https://dreamsavior.net/files/docs/tpp/index.html
- https://dreamsavior.net/docs/translator/translator-engine/

2026-09-22 核查：面向游戏的 CAT 应用、引擎／格式支持、扩展入口；官方文档目录列出译文导入、补丁、上下文和模型服务集成。不同发行和扩展的可用范围另定，不把成品应用当作任意嵌入的开源库。部分旧文档与新公告并存，候选表不据旧“不能 OCR”等表述限制当前功能。

## C72 · LunaTranslator
- https://github.com/HIllya51/LunaTranslator
- https://docs.lunatranslator.org/zh/
- https://docs.lunatranslator.org/ja/guochandamoxing.html

2026-09-22 核查：HOOK、OCR、部分游戏内嵌显示和大模型翻译服务配置；用于运行时客户端路线。不能据此推导所有游戏可回填或自动生成静态补丁。

## C73 · manga-image-translator
- https://github.com/zyddnys/manga-image-translator

2026-09-22 核查：文字检测、OCR、翻译、修复和渲染，批量模式的保存／载入文字及人工嵌字准备选项。具体格式和载入流程需要试接；不把格式参数清单当作全部输出已通过测试。

## C74 · manga-translator-ui
- https://github.com/hgmzhn/manga-translator-ui
- https://github.com/hgmzhn/manga-translator-ui/blob/main/doc/CLI_USAGE.md
- https://hgmzhn.github.io/manga-translator-ui/en/workflows/import-translation-and-render.html
- https://hgmzhn.github.io/manga-translator-ui/zh/developer/http-api/batch-export-import-process.html

2026-09-22 核查：基于 manga-image-translator 的应用；CLI／HTTP、JSON／文本交换、可视化编辑、PSD 分层输出。维护者工作流说明明确“导入译文并渲染”的常规路径跳过 OCR 与正文翻译；回填接口、编辑字段和版本匹配仍未实测。“导出译文”默认流程与纯读取已有结果的模式要区分。

## C75 · BallonsTranslator
- https://github.com/dmMaze/BallonsTranslator

2026-09-22 核查：漫画图像修复、文字／格式编辑、译文回填和翻译模块扩展。作为人工精修工作台及可复用组件，不声称已有适合本项目全部功能的稳定服务 API。仓库首页与旧分支 README 内容有差异，以拟采用版本进一步确认。

## C76 · Comic Translate
- https://github.com/ogkalu2/comic-translate
- https://raw.githubusercontent.com/ogkalu2/comic-translate/main/README.md

2026-09-22 核查：多语言漫画、不同漫画类型、自动与手动处理；仓库列出图片、PDF、EPUB、CBR／CBZ 等格式场景。将输入范围、输出能力、图层往返和后台接口分别看，不承诺全部等价支持。

## C77 · mokuro
- https://github.com/kha-white/mokuro
- https://raw.githubusercontent.com/kha-white/mokuro/master/README.md

2026-09-22 核查：漫画页文字检测与 OCR，.mokuro 数据和阅读器，以及兼容保留的 HTML 输出。核心是原图上的可选取日文文字，不是现成的目标语言翻译层；目标语言或双语显示属于本项目拟议适配。

## REF-SKOS · W3C SKOS Primer
- https://www.w3.org/TR/skos-primer/

## REF-PhySH · APS PhySH
- https://physh.org/about

## C78 · ECDICT
- https://github.com/skywind3000/ECDICT

2026-09-29 初查：维护者提供英汉／英文释义、CSV 数据、词形信息及 SQLite 等读写代码。作为本地通用词典数据候选，不把其词条数量或项目介绍当成领域翻译准确率保证。

## C79 · PyGlossary
- https://github.com/ilius/pyglossary

2026-09-29 初查：维护者列出离线词典格式转换与 CLI，支持格式分别标记读取、写入；并非所有格式双向等价支持。它是格式工具，不能替代词典内容来源或专业术语管理。

## C80 · FreeDict
- https://freedict.org/downloads/
- https://freedict.org/documentation/

2026-09-29 初查：TEI 源数据及 StarDict、Dictd 等下载格式；静态 API 给出词典元数据与文件下载地址，不是逐词查询 API。这里指 freedict.org 的开放词典项目，不与同名商业网站混用。

## C81 · Kaikki.org／Wiktextract
- https://kaikki.org/dictionary/
- https://github.com/tatuylonen/wiktextract

2026-09-29 初查：Kaikki 的机器可读多语言词典下载页及关联提取工具作为数据导入候选；本轮只查看资料，没有运行全量提取。具体义项、语言与领域覆盖需要按目标数据验证。

## C82 · Microsoft Translator Dictionary
- https://learn.microsoft.com/en-us/azure/ai-services/translator/text-translation/reference/v3/dictionary-lookup
- https://learn.microsoft.com/en-us/azure/ai-services/translator/text-translation/reference/v3/dictionary-examples

2026-09-29 初查：Lookup 提供词语与部分短语的备选译法、词性、回译；Examples 为词对例句接口。词典能力的支持范围独立于全文翻译范围；本轮未调用真实账户，未核算套餐费用。

## C83 · Oxford Dictionaries API
- https://developer.oxforddictionaries.com/
- https://developer.oxforddictionaries.com/documentation/languages
- https://developer.oxforddictionaries.com/faq

2026-09-29 初查：官方列出结构化释义、词级翻译、词形等接口，语言与端点支持不同；FAQ 说明缓存和离线使用有 Enterprise 授权条件。未采购或测试，不承诺通用免费访问、无限缓存或所有语言对可用。作为商业备选，由用户决定是否采用。

