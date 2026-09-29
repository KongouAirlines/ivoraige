# 候选工具与插件选型 v1.1

日期：2026-09-29｜状态：早期选型更新，承接 M1 实验。需求基线仍为 v1.0；本版不是软件版本，也不增加需求编号或改变优先级。

## 本次变化

本版将选型从完整工具扩展到 **DSH 与 Cordis 生态的插件、组件和宿主组合**。只要能减少实际开发工作，即使需要一并采用 DSH 的 settings、storage、session、workspace、agent 或客户端，也可以进入候选。完全独立不是准入条件；是否立即引入由当前功能需求决定。

原 [v1.0 的 16 组、83 项候选](../requirements/v1.0/02_候选工具与初步选型_v1.0.md)保留为基础候选池，原始文档不覆盖。本轮补充 **14 组 DSH 组件、11 组周边生态组件**；其中有拆分或交叉，不将它们简单相加成独立产品总数。本轮只重新核查这些组件与 M1 涉及的路线，其他旧条目沿用历史状态。

使用本版时，先看下面的当前取向，再按两个明细表查看完整包名、关键依赖和证据：

- [DSH 插件候选明细](dsh-plugin-candidates.md)：14 组，固定 DSH 提交 `639ed015397290b3745d163aafe02ffee4aa3f84`。
- [Cordis 周边生态候选明细](cordis-ecosystem-candidates.md)：11 组，Cordiverse、Koishi、ChatLuna、Satori 的官方文档与源码快照。

## 当前取向与候选包

DSH 表中 `dsh-*` 均为 `@deepseek-ai/` 命名空间，完整名称及入口见明细。阶段指优先比较的时点，不等于必须安装。

| 用途／需求 | 候选包或组合 | 复用取向与组件依赖 | 当前安排 |
|---|---|---|---|
| 模型接入 F-01／F-05／F-11／F-27 | `@deepseek-ai/cordis` + `dsh-llm` + `dsh-llm-pi-ai`；可选 `dsh-llm-deepseek` 的 API-key／account provider | 基础组合已接入模拟兼容端点；专有 DeepSeek transport 与认证按需追加 | **M2 起步采用基础组合**；专有 provider 仅源码核实 |
| 凭据 F-03 | `dsh-credentials` + `dsh-credentials-local` | 接受其 home／环境配置约定，可免写本地凭据服务；不是系统 keyring | **近期优先比较**；未测持久化 |
| 设置／方案 F-03／F-37 | `dsh-settings` + `dsh-config-editor`；可选 `dsh-client-ui-settings`、`dsh-client-ui-settings-models` | 后端需要 Loader/profile；现成模型页面还需客户端 remote、slots、session 等。允许整体复用 | **P1 设置与界面组合候选**；CLI 先用必要部分 |
| 译文／术语存储 F-13／F-15／F-17 | `dsh-storage` + `dsh-storage-domain` + `dsh-storage-json` 或 `dsh-storage-sqlite` | 与已选 DSH 同一体系；schema 校验与持久 KV。SQLite 后端仍是 domain KV，不能据名称推断关系查询能力 | **M2 优先比较**；业务实体与复用规则由项目定义 |
| 关系查询存储 F-13／F-15／F-39 | `@cordisjs/plugin-database` + `@cordisjs/plugin-database-sqlite` | Cordiverse 原 Minato 的当前路线；表与查询能力值得比较。声明 Cordis 4 RC，仍需验证与 DSH vendor 的运行时身份和 API | **M2 并列适配候选**；不因同为 Cordis 就声称可直接混装 |
| 进度／取消 F-30 | `dsh-jobs` + `dsh-jobs-local`；可选 tool-jobs／UI | 接受 owner/controller 和必要 session 契约，可包装解析／导出长任务；业务 producer 仍需编写 | **M2／P1 候选**；进程内任务不等于暂停恢复或持久队列 |
| 重试／多步骤 F-10／F-22／F-30 | `dsh-llm-retry`；`dsh-workflow` + `dsh-workflow-ptc` + `dsh-tool-workflow` | retry 依赖 agent durable step；workflow 需要 subagent、PTC、sandbox 和父 agent/session。连同这些能力比较复用收益 | **后续组合候选**；直接 `llm.stream()` 不会自动获得重试 |
| 会话／工作区与自动触发 F-30／F-37 | session-persistence JSONL + workspace；`dsh-schedule` | 会话、存储和 Host Web 组件可支撑现成任务交互／定时投递 | **P1 产品组合、P2 自动触发**；会话恢复不直接代表翻译断点恢复 |
| 外部能力 F-29／F-40 | `dsh-mcp-client` + `dsh-mcp-resources` | 复用 tools 服务消费外部词典、解析或文献 MCP；图像结果按需依赖 attachment | **P1 候选**；是消费端，对外 MCP server 仍另选 |
| 文件与格式 F-07／F-09／F-24 | `dsh-attachment` + `dsh-attachment-local`；`dsh-office-to-pdf` | 附件可复用文件引用和派生图像；Office 转换可直接调用，remote 模式另需文件／工作区服务 | **按格式需要引入**；Office→PDF 不等于可编辑文档译文回填 |
| HTTP／本地入口 F-03／F-28／F-38 | `@cordisjs/plugin-http`、`@cordisjs/plugin-server`；可选 server-proxy、timer | 词典／解析 HTTP、本地页面路由与进度；按需适配 Cordis 版本。server 只是底座，兼容协议另实现 | **M2～M4 按需候选**；不为统一名义重写已验证 DSH 模型路径 |
| 现成配置 UI F-03／F-21／F-37 | `@koishijs/plugin-console` + `@koishijs/plugin-config` + Koishi 宿主 | 可使用插件页、Schema 表单和控制台；允许连宿主使用或适配所需界面 | **M4 组合候选**；Koishi 当前依赖 Cordis 3，与 DSH vendor 4 不默认兼容 |
| 模型与语义检索 F-12／F-16／F-39 | `koishi-plugin-chatluna` + OpenAI Like adapter；可选 vector-store-service | 连 Koishi 数据库、ChatLuna 与 embeddings／向量后端复用；可比较现有模型覆盖与检索能力 | **后续模型／检索组合候选**；向量服务包级依赖和许可仍待核，RAG 不代替已确认术语与译文记录 |
| 其他外部入口与定时 | `koishi-plugin-cron`、`@satorijs/plugin-server` | 已采用宿主时复用定时或消息入口，不为这两项单独引入完整聊天产品 | **条件候选**；不影响当前核心闭环 |

## 保留的工具路线与分工

| 原候选分组 | v1.1 处理 |
|---|---|
| 插件载体（1.1） | 细化为上述模型、存储、设置、任务、界面等插件和组合；Cordis 是运行时，业务能力不必全部自写 |
| 本地推理／模型（1.2、2.1） | 保留 Ollama、LM Studio、llama.cpp 及翻译模型／服务等候选；DSH 负责接入，它不取代模型或本地运行器 |
| 自动调度／工作流（2.2、2.3） | 加入 DSH workflow／retry／schedule 的适用范围；原路由与工作流工具仍可比较 |
| 术语／精翻／词典（2.4～2.6） | 原候选保留；数据库、MCP、HTTP 或向量检索能提供基础能力，术语含义、确认状态与冲突规则仍需翻译业务层 |
| 解析／OCR／PDF（3.1～3.3） | MinerU 保留解析候选；BabelDOC 已验证已有译文回放，pdf2zh-next 提供上层集成参考；补 DSH 附件及 Office→PDF。详见 [M1 PDF 证据](../mvp/m1/pdf-translation-injection.md) |
| 场景、客户端、文献协同（3.4～3.7） | 原候选保留，本轮未重新调研，不因增加插件池改变需求先后 |
| MCP／兼容入口（3.8） | 区分 DSH 消费外部 MCP 与本项目对外提供接口；HTTP server 不自动具备 OpenAI 或 MCP 协议 |

## 实现时怎样使用这版选型

M2 继续用已跑通的 DSH 模型组合。存储实现前优先比较 DSH domain 后端与 Cordiverse database＋SQLite：如果当前操作只是单位记录和配置读写，前者更贴近已选体系；如果实际需求需要结构化查询，再验证后者的适配成本。不是同时引入两个后端，也无需先做完整数据库框架。

设置界面、任务与会话作为组合保留。接下来出现对应需求时，先检查复用组合能省下哪些代码；必要的 DSH／Koishi 宿主组件可以一并采用。早期候选不要求提前完成每个包的运行实验，不给每个候选单开任务。

模型调用、存储、任务状态和输出之间保持能看懂的业务边界即可。插件解决基础设施，项目仍需定义术语匹配、译文接受／修订、来源关联与同源输出；这些规则可以建立在现成组件上。

## 证据与版本说明

- **已有实验**：仅 Cordis／DSH 模型组合沿用 M1 的 10 项模拟端点检查，以及 BabelDOC 两页注入／重跑实验；没有新增真实模型评估。
- **本轮源码核实**：DSH 候选使用固定提交；周边生态记录所读官方分支包清单版本与来源，未运行兼容实验，也不代表 npm 最新稳定发布。
- **待核部分**：ChatLuna 向量服务的具体包清单、peer／inject 与插件许可；其能力已有官方文档依据，作为早期候选保留。
- **许可**：所核实 DSH 核心与多数 Cordiverse 组件为 MIT；Koishi webui、ChatLuna 已核实组件与 PDF 工具包含 AGPL。按实际采用组合保留对应许可信息，不以顶层许可推断所有依赖。

本轮同步文档导航与 ADR 的候选范围说明，原 v1.0 文件及 M1 实验结果保留。未安装这些新增候选、未扩大 M2 实现范围。后续若决定采用某组组件，在对应实现阶段补最小接入验证即可。
