# 多提供商与模型配置：本轮实现和后续边界

2026-10-06。当前软件 `0.1.0-dev.0`，固定 DSH 提交 `639ed015397290b3745d163aafe02ffee4aa3f84`，pi-ai `0.87.1`。本文记录配置复用方案，不宣称已完成全部供应商真实调用或科学质量评估。

## 实现依据

固定 [DSH llm-pi-ai 配置](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/llm/llm-pi-ai/src/config.ts) 已将 providers 表示为多路由字典。路由可继承内置目录，或自定义 API、端点、凭据引用与 models。`ctx.llm.listProviders()`／`listModels(provider)` 只返回已装配的服务能力；pi-ai `getBuiltinModels(provider)` 可取得安装版本的目录。现有设置页只展示当前选择，底层并非只允许一个路由。

[OpenCode](https://opencode.ai/docs/providers/) 将提供商、端点与多个模型配置并列保存，再选择实际使用的模型；[Aider](https://aider.chat/docs/troubleshooting/models-and-keys.html) 将模型选择与提供商密钥配置分开。这里借用其配置组织方式，存储、凭据解析及请求仍全部由 DSH 提供，不引入它们的 SDK 或另一个模型注册表。

本轮增加 DSH volatile `savedModels`，只保存 provider／model／timeoutMs 的配置引用；完整端点和模型参数继续保留在 llm-pi-ai 路由。列表与当前翻译选择分开保存；旧的显式模型和当前选择可读回。保存并选中保持原 API 默认行为，界面另提供仅保存和仅切换。配置修改仍要求暂停排队／运行中的翻译任务，避免在单位之间静默换模型。

## 本轮预设

| 服务 | 端点／协议来源 | 当前方式 |
|---|---|---|
| DeepSeek、Anthropic、OpenRouter、Kimi 国内／国际、OpenAI | 固定 pi-ai 内置目录 | 选择一个示例模型，协议与端点按各模型继承目录默认，输入框显示提示 |
| 硅基流动 | [官方 OpenAI 兼容快速上手](https://docs.siliconflow.cn/docs/userguide/quickstart) | `https://api.siliconflow.cn/v1`，填写账号可用的模型 ID |
| Ollama | [官方 OpenAI 兼容说明](https://docs.ollama.com/api/openai-compatibility) | `http://127.0.0.1:11434/v1`，示例 llama3.2，须在本机实际加载 |
| llama.cpp、LM Studio | [OpenCode 本地提供商配置](https://opencode.ai/docs/providers/) | OpenAI 兼容本地端点 `8080/v1`／`1234/v1`，填写已加载模型 ID |

Anthropic 使用 `anthropic-messages`，不是强制改成 OpenAI 协议；[Anthropic 官方概述](https://platform.claude.com/docs/en/api/overview)、[OpenRouter 快速上手](https://openrouter.ai/docs/quickstart) 与 [Kimi 快速上手](https://platform.kimi.ai/docs/overview) 用于核对端点和接入方式。示例模型和安装目录不代表当前账号可调用，预设也不会自动保存密钥或发出模型请求。

Llama 是模型家族；本地调用的提供商是 Ollama／llama.cpp／LM Studio 等服务。当前 pi-ai OpenAI 协议要求 API key 或授权头，即使本地服务不需要认证；界面提供非秘密占位值 `local`，仍经 DSH credentials 保存。需要认证的本地端点使用真实密钥。自定义模型预填的 8192／2048 是待用户修改的容量配置，不是检测结果或实际模型规格。

同一提供商标识共享端点、凭据及路由级推理配置；不同账号、网关或路由级设置应使用不同标识。内置模型容量调整采用 `modelOverrides`，保持内置目录可见；历史显式 `models` 列表保留其收窄语义。

OpenRouter 的内置目录同时包含不同协议／端点，不能把其中一个模型的值覆盖到整个路由；预设因此只选择模型和凭据引用。未收录的新模型应通过自定义提供商标识及完整声明保存，原生目录路由不接受目录外的选择。空表单字段显式请求删除路由覆盖、恢复目录默认；容量清空只用于可继承目录的模型，未知自定义模型仍须保留实际容量。

## 后续

完整多模型编排、任务级角色分配及标签未在本轮实现。[D-002 模型标签](../plan/deferred.md#d-002-多模型协作的模型标签与角色设计) 按用户决定暂缓到协作阶段。在线目录、自动发现和连接／删除管理记录在 [D-003](../plan/deferred.md#d-003-提供商在线目录与连接管理)。OAuth／订阅登录、新推理协议和自动备用路由等需求应另行核对上游能力及任务语义，不作为本轮预设的隐含承诺。

体验步骤：设置 → 选择提供商预设 → 核对模型 ID 与端点 → 保存到模型列表 → 在凭据区保存密钥（无认证本地服务可填占位值）→ 列表中“用于翻译”。可先保存多组模型，再切换；配置不自动触发重新翻译。
