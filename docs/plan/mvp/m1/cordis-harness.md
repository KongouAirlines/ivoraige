# Cordis 与 DeepSeek Harness 定向调研和 M1 实验

日期：2026-09-29｜状态：官方源码核验；真实DSH模块接入本地HTTP实验10项通过；未调用真实模型。最终运行时选择由ADR记录。

## 结论

可以采用 **DSH所带Cordis + LLM注册服务 + 通用pi-ai模型插件**，由项目实现翻译单位、术语组合、接受译文存储与输出。这个组合已实际请求本地OpenAI-compatible SSE端点，不要求采用完整Harness agent、会话产品或界面。应将模块复用作为真实路线，不再仅比较“独立Cordis后全部接入重写”和“完整DSH”。

本结论只覆盖模型接入与生命周期。持久任务、复用键、断点恢复和译文PDF不由此获得证明。官方仍标注Harness为developer preview并会发生不兼容变化。[官方仓库](https://github.com/deepseek-ai/deepseek-harness)

## 固定版本和许可证

| 对象 | 固定值 |
|---|---|
| DSH源码 | `639ed015397290b3745d163aafe02ffee4aa3f84` |
| DSH LLM / pi-ai插件包清单 | `0.2.0-rc.2` |
| DSH所带Cordis | 发布包`@deepseek-ai/cordis@4.0.4`；vendor上游基线`4.0.0-rc.7` / `56b3d4f725681cf4556c1a8695a709cc3b6eed74` |
| 独立Cordis，仅源码对照 | `f8ea3cd50f1a5724e8e715995bcde131c9c12b2c` / `cordis@4.0.0-rc.10` |
| pi-ai SDK | npm `@earendil-works/pi-ai@0.87.1` |
| 实验运行环境 | Windows / PowerShell / Node v26.7.0 |

依据：[DSH固定提交](https://github.com/deepseek-ai/deepseek-harness/tree/639ed015397290b3745d163aafe02ffee4aa3f84)、[vendor清单与本地修改](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/vendor/README.md#manifest)、[上游Cordis清单](https://github.com/cordiverse/cordis/blob/f8ea3cd50f1a5724e8e715995bcde131c9c12b2c/packages/core/package.json)。DSH、Cordis vendor和pi-ai包清单均为MIT；vendor保留上游LICENSE。分发应保留MIT通知；传递依赖通知按实际发布闭包处理，不能笼统称全部依赖为同一许可证。

实验只用DSH vendor Context/Service，不混用上游身份。DSH已有生命周期修补和scope重命名，数字版本不可按上游直接互换；独立Cordis未运行同一实验，兼容性未获验证。

## 可复用模块与代价

| 模块 | 获得能力 | 成本与边界 |
|---|---|---|
| `@deepseek-ai/cordis` | Context、服务注入、事件、随fiber清理的effect | vendor Cosmokit；框架身份统一 |
| `dsh-llm` | 注册、模型解析、流协议、错误、调用冻结、BlockAssembler | Cordis、Typert协议基类、Schemastery、brand/values/crypto/timeout |
| `dsh-llm-pi-ai` | catalog多provider、自声明兼容端点、凭据解析、流转换和取消 | pi-ai SDK及配置/auth/catalog/discovery；强制inject仅llm |
| `dsh-llm-deepseek`及API-key/account提供方 | DeepSeek Messages transport与认证分离 | 专有能力需要时可复用；仅核验源码/README，未实跑 |
| `dsh-credentials` / `credentials-local` | 凭据接口及本地存储 | 实验用环境解析，未测持久化；不是操作系统keyring |
| settings / model UI | 模型配置、目录与发现 | 按需调查；M2 CLI无须提前引入完整客户端；未实跑 |

本次局部bundle含58个真实上游文件，npm安装91个包；pi-ai自身依赖OpenAI、Anthropic、Google、AWS等SDK。没有安装整个DSH工作区或构建全部应用。闭包比手写单一HTTP调用大，但复用了配置、注册、流规范化和取消；不是零成本插件。

依据：[插件inject](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/llm/llm-pi-ai/src/index.ts#L93)、[依赖清单](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/llm/llm-pi-ai/package.json)、[注册的effect归属](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/llm/llm/src/index.ts#L396)。

## Provider、配置与凭据

`providers`字典可以继承安装的catalog，也可完整声明私有/本地网关。手工协议覆盖目前限`openai-completions`、`openai-responses`、`anthropic-messages`；catalog路由保留provider自己的协议与认证能力。手工表不等于Azure/Bedrock/Vertex/OAuth全部配置能力。[协议表及边界](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/llm/llm-pi-ai/src/provider.ts#L41)

实跑路由`local`，协议`openai-completions`，`baseURL=http://127.0.0.1:<动态端口>/v1`；`mock-translator`模型与128输出预算进入`/v1/chat/completions`。服务器返回固定术语译文；未证明任何真实本地模型的推理方言或模型名正确。

`apiKeyEnv`实际为凭据引用：有credentials服务时经它解析，无该服务时读launch environment。命名引用缺失产生MISSING_CREDENTIAL，无HTTP且不偷偷用别的ambient key；省略引用才允许provider ambient发现。配置保存引用而非secret。无密钥兼容端点可能仍需SDK接受的dummy key，不默认所有协议可空认证。[解析逻辑](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/llm/llm-pi-ai/src/index.ts#L183)、[自声明认证](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/llm/llm-pi-ai/src/provider.ts#L65)

源码按调用捕获不可变snapshot，在途沿用旧配置；下次请求取新配置，route set或注册捕获的retry policy变更会重注册。本实验实际验证插件卸载与端点换装，没有验证settings热更新或在途配置冻结。[snapshot路径](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/llm/llm-pi-ai/src/adapter.ts#L318)

联网关闭、阶段模型分工和后续单位派发属于本项目业务设置，框架不会自行推断。

## 流、取消、用量与错误

caller signal与消费者signal合并，idle watchdog控制超时；停止消费时abort SDK并return内部iterator。LLM服务将adapter选择/派发/迭代失败转换为terminal finish，取消为aborted，其余为error；middleware、清理或消费者异常仍可能throw。调用方应检查finish并捕获异常。[取消路径](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/llm/llm-pi-ai/src/adapter.ts#L351)、[终止映射](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/llm/llm/src/index.ts#L1153)

pi-ai部分错误只保留message，DSH按文本分类AUTH/RATE_LIMIT/TIMEOUT/TRANSPORT等；不能承诺完整HTTP cause/request-id/Retry-After。SDK调用设置maxRetries=0，可见重试归另外的恢复层，本次未装llm-retry。[错误分类限制](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/llm/llm-pi-ai/src/stream.ts#L33)、[SDK单次调用](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/llm/llm-pi-ai/src/adapter.ts#L136)

**用量缺失是实测缺口**：mock省略usage，SDK仍交付0/0/0。局部pi-ai `dist/api/openai-completions.js:162`初始化零值，`:362`只有存在usage才更新；DSH [stream.ts:24](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/llm/llm-pi-ai/src/stream.ts#L24)直接映射且没有来源标志。M2应将未确认计数标未知，不能填实测零；精确区分要另保留wire证据/适配来源标志，仅公共计数字段不足。

Cordis清理服务/effect不等于持久任务取消。实跑信号关闭在途HTTP；下一单位未派发由业务guard保证，部分输出保存、接受状态与进程恢复仍属翻译业务。[fiber状态](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/vendor/cordis/src/fiber.ts#L142)、[服务生命周期](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/vendor/cordis/src/service.ts#L31)

## 实跑与重跑

见[实验README](../../../../experiments/cordis-dsh/README.md)与[run.mjs](../../../../experiments/cordis-dsh/run.mjs)。最终`node run.mjs`退出0，10项检查通过：

| 检查 | 结果 |
|---|---|
| LLM→pi-ai→HTTP→BlockAssembler | 译文、路径、模型、128预算及3/2/5用量吻合 |
| 卸载/重载B端点 | NO_ADAPTER后B译文，A无新增请求 |
| 命名凭据缺失 | MISSING_CREDENTIAL，无HTTP |
| 401 | terminal error / AUTH |
| 省略usage | 补零，记录为缺口 |
| caller取消 | ABORTED，服务端关闭连接，下一单位不派发 |
| iterator.return | 服务端关闭连接 |
| 40ms流空闲超时 | TIMEOUT，连接关闭 |
| terms缺失 | consumer PENDING、apply未执行 |
| 依赖卸载重载 | 活跃计数归0，无重复/残留监听 |

完整`results.json`、`build-evidence.json`和bundle在实验目录忽略，可重跑生成。构建仅保留attribution原module URL以正确读取上游package版本，vendor源码未改。初次沙箱spawnSync git EPERM经本地构建升级通过；npm默认离线ENOTCACHED通过官方registry与局部cache解决，是本机配置阻碍而非DSH失败。

## M2建议与未验证项

建议以此组合做M2骨架，CLI显式配置模型和步骤，逐步接term/store/export业务模块。首次发布应解决固定包/源码闭包构建与许可证通知，用薄项目调用边界隔离SDK细节；不要为了复用模型先搬完整agent/session产品。

未选择最终发布形式；未跑独立Cordis或完整DSH，未测OAuth、credentials-local持久化、settings热更新、真实模型、图片或tool-call。PDF注入为另一独立实验。此调研只证明小闭包可行性，不等于全库兼容性或完整MVP通过。
