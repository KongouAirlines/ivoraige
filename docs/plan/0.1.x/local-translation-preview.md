# 0.1.x 本地即时翻译预览候选

本页为 [U01](packages/ui.md#u01) 的候选选型依据，交互以 [UI 草案](../../requirements/0.1.x/ui.md#可选本地即时预览)为准，质量/性能与离线边界按 [U-V01](validation/ui.md#本地预览验收)实测。尚未选定、集成或运行这些模型，不承诺具体版本交付；候选范围见 [releases](releases.md)。

## 模型候选

先从项目已有的中英双向需求评估专用翻译模型，并用一个通用小模型作对照。下表按 2026-10-22 官方模型卡及文件页核对；许可名称是资料记录，发行前仍需核对实际固定版本、转换/量化产物及随包文件的许可与通知，不构成法律或性能保证。

| 模型 | 适用方向与候选价值 | 官方许可与体积依据 | 取舍与待验证项 |
| --- | --- | --- | --- |
| [OPUS-MT en-zh](https://huggingface.co/Helsinki-NLP/opus-mt-en-zh) | 专用英译中 Marian 模型，优先评估普通文本预览 | 模型卡 **Apache-2.0**；[文件页](https://huggingface.co/Helsinki-NLP/opus-mt-en-zh/tree/main)的 `pytorch_model.bin` 约 **312 MB** | 只覆盖该方向；术语、数字、否定句、混排和段落质量需实测，不能由“专用”推定质量达标 |
| [OPUS-MT zh-en](https://huggingface.co/Helsinki-NLP/opus-mt-zh-en) | 专用中译英 Marian 模型，与 en-zh 配成双向候选语言包 | 模型卡 **CC-BY-4.0**；[文件页](https://huggingface.co/Helsinki-NLP/opus-mt-zh-en/tree/main)的 `pytorch_model.bin` 约 **312 MB** | 与 en-zh 分别下载、核对许可及署名要求，不能把 OPUS-MT 系列统称为 MIT；量化质量与速度另测 |
| [Qwen3-0.6B](https://huggingface.co/Qwen/Qwen3-0.6B) | 通用生成模型备选；可评估翻译，也可作为已有改写/解释需求的模型候选，不据此扩大本切片 | 模型卡及[官方 GGUF](https://huggingface.co/Qwen/Qwen3-0.6B-GGUF)均为 **Apache-2.0**；[文件页](https://huggingface.co/Qwen/Qwen3-0.6B-GGUF/tree/main)的 `Qwen3-0.6B-Q8_0.gguf` 约 **639 MB** | 搭配 llama.cpp 评估，关闭思考并限制只输出译文；必须与专用模型对照质量、时延和内存，不默认通用模型更好或更快 |

312 MB 是各单方向原始未量化权重文件大小，639 MB 是指定 Q8 GGUF 文件大小，均不是完整语言包、应用安装体积或峰值内存。语言包还需分词器/配置等资源；OPUS-MT 转换与量化后的体积以及所有候选的实际占用须测量，不能按参数量或量化位数直接承诺下载大小。

[NLLB-200-distilled-600M](https://huggingface.co/facebook/nllb-200-distilled-600M)只列作多语种研究对照，**不建议默认发行**。官方模型卡为 **CC-BY-NC-4.0**，定位机器翻译研究，明确不面向生产部署或文档翻译；不因语种多就推荐为默认离线语言包。

## 运行与集成路线

运行引擎与模型分别选型。优先验证应用内置引擎、首用下载所需语言包、准备后离线工作的路线；复用既有 DSH 模型/任务服务、能力插件及资源生命周期，不能把下列上游支持表写成本项目已经接通。

| 路线 | 官方依据与项目评估边界 |
| --- | --- |
| OPUS-MT / MarianMT → CTranslate2 | CTranslate2 运行库为 [MIT](https://github.com/OpenNMT/CTranslate2/blob/master/LICENSE)，[转换文档](https://opennmt.net/CTranslate2/guides/transformers.html)列出 MarianMT 支持；[安装文档](https://opennmt.net/CTranslate2/installation.html)覆盖 Windows x64、macOS Intel 与 Apple Silicon 的预编译包，[硬件文档](https://opennmt.net/CTranslate2/hardware_support.html)提供 x86-64/ARM64 CPU 路线。官方 GPU 路线为 NVIDIA/CUDA，不能声称 Mac 默认使用 Metal。需验证模型转换、分词、量化、原生运行依赖及取消/释放 |
| 兼容模型 → ONNX Runtime / Transformers.js | 属于另一组运行/集成路线，不是额外模型候选。[Transformers.js 官方文档](https://huggingface.co/docs/transformers.js/index)说明使用 ONNX Runtime 并支持翻译/MarianMT；具体模型导出、分词器、量化及桌面宿主兼容性需验证，不能把任意原始权重直接视为可运行包 |
| Qwen3-0.6B GGUF → llama.cpp | [官方 GGUF 模型卡](https://huggingface.co/Qwen/Qwen3-0.6B-GGUF)提供 llama.cpp 用法。按[思考模式说明](https://huggingface.co/Qwen/Qwen3-0.6B#switching-between-thinking-and-non-thinking-mode)关闭思考；其中 `enable_thinking=False` 是聊天模板接口示例，不能直接当作 llama.cpp 通用开关。固定实际运行时/模板，验证关闭方式及只输出译文，不能只凭 `/no_think` 提示视为通过 |

最终选择需同时满足目标设备资源预算、所需语种、质量、离线/隐私与实际分发条件。初期可只准备一个方向，另一方向另行确认下载；缺包或不支持的语种明确不可预览，不能自动下载无关模型或回退云端。
