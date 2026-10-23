# 0.1.x 基线审计：去重组与 136 条映射

基线 `43d3f1fadc4930baa445aeb0cb832b3647aa08d7`。136 条历史发现归并为 75 个审计主题；主题包含已修、建议、风险和历史证据，不是当前缺陷计数。逐历史 ID 的完整字段见 `mapping-136.csv` / `mapping-136.json`。

状态为本次静态核对；除主报告另列的远端 CI 元数据外，本次未执行业务测试、模型或真实引擎。优先级是规划建议，不机械继承原报告等级。每个组内的历史条目可能只覆盖主题的一部分，以原始行和校正备注判断。

## C01 导出隔离机制

- 历史 ID：PR1-01
- 当前状态：已修正文；保留既有实现；优先级：保留
- 事项：#29 / design-v3
- 契约：输出适配器只接收冻结数据，不获得 ctx、服务或绑定 this
- 当前证据：[src/export.mjs:65](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/src/export.mjs#L65)；[test/export.test.mjs:52](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/test/export.test.mjs#L52)；[AGENTS.md:22](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/AGENTS.md#L22)
- 验收：保留现有 data-only、this===undefined、冻结不可写、无 LLM 服务测试；另补异步取消 options.signal 和恶意闭包能力边界。
- 校正：不是沙箱安全保证：不传 ctx 不阻止第三方模块主动 import/环境访问。#29 的“补负向测试”应改为保留并增强，不能说完全缺失。

## C02 格式、引擎身份与导入归属

- 历史 ID：PR1-03、PR4-02、P7-2、P7-11
- 当前状态：部分已补；核心耦合仍存在；优先级：P1 规划门槛
- 事项：#14 #29 / design-v3
- 契约：format、adapterId、输入介质、导入耗时、资源、可读视图分开；Records 保留原子持久化职责
- 当前证据：[src/records.mjs:89](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/src/records.mjs#L89)；[src/records.mjs:183](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/src/records.mjs#L183)；[src/operations.mjs:86](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/src/operations.mjs#L86)；[src/operations.mjs:100](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/src/operations.mjs#L100)；[src/tasks.mjs:95](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/src/tasks.mjs#L95)；[src/adapters/text-output.mjs:7](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/src/adapters/text-output.mjs#L7)；[src/parse.mjs:29](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/src/parse.mjs#L29)
- 验收：用不同 adapterId 的二进制且耗时的合成插件，经现有入口完成导入、排队、取消、持久化、MD/JSON 与匹配重建；新增插件不改共享业务分支。
- 校正：ADR-0002 已存在，不能沿用历史“没有 ADR”；7 MiB 前端/10 MiB HTTP 上限仍需统一说明。

## C03 入口装配与可选传输

- 历史 ID：PR1-02、PR4-03、M18-4
- 当前状态：部分实现；目标契约有漂移；优先级：P1 规划门槛
- 事项：#29 / design-v3
- 契约：明确 HTTP/CLI 是协议模块还是插件；注册、依赖、缺件与 disposer 统一
- 当前证据：[src/operations.mjs:70](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/src/operations.mjs#L70)；[src/http.mjs:1](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/src/http.mjs#L1)；[src/http.mjs:127](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/src/http.mjs#L127)；[src/app.mjs:100](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/src/app.mjs#L100)；[docs/requirements/v2.0/01_design_v2.0.md:62](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/docs/requirements/v2.0/01_design_v2.0.md#L62)
- 验收：同一能力三入口一致；mcp:false 可运行；缺 SDK 的支持范围明确；启动失败释放 server/ctx；不要为兑现旧模块表而强制改 HTTP 框架。
- 校正：MCP 贡献已是插件，不能称所有入口均未插件化。默认 MCP SDK 是生产依赖；损坏依赖的降级属于待决策略。

## C04 资源 ID 与归属校验

- 历史 ID：PR4-12、M18-1
- 当前状态：静态仍存在；优先级：P2
- 事项：#29 / design-v3
- 契约：入口使用不透明 ID；docId/unitId 归属由内核负责
- 当前证据：[src/operation-mcp.mjs:44](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/src/operation-mcp.mjs#L44)；[src/records.mjs:127](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/src/records.mjs#L127)；[src/operations.mjs:41](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/src/operations.mjs#L41)
- 验收：用非前缀式 ID 与跨文档 ID 负例检查内核归属；HTTP/CLI/MCP 错误相同。

## C05 产物读取重复

- 历史 ID：M18-6
- 当前状态：静态仍存在；优先级：P2
- 事项：#29 / design-v3
- 契约：统一 Artifact 内容读取、错误映射与尺寸限制
- 当前证据：[src/operation-mcp.mjs:1](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/src/operation-mcp.mjs#L1)；[src/http.mjs:2](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/src/http.mjs#L2)；[src/operations.mjs:40](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/src/operations.mjs#L40)
- 验收：同一缺失/过大/合法产物经 HTTP 和 MCP 得到一致业务结果；协议编码可不同。

## C06 设置事件依赖任务总线

- 历史 ID：F9-2
- 当前状态：静态仍存在；优先级：P2
- 事项：#29 / design-v3
- 契约：跨域事件显式定义，首次发现与变更订阅有清楚边界
- 当前证据：[src/settings-pages.mjs:20](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/src/settings-pages.mjs#L20)；[src/settings-pages.mjs:27](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/src/settings-pages.mjs#L27)；[src/app.mjs:97](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/src/app.mjs#L97)
- 验收：任务插件缺席、页面先挂载、后注册与卸载场景，客户端能力清单正确且订阅可释放。

## C07 导出受理失败留下快照

- 历史 ID：PR4-01
- 当前状态：静态仍存在；未运行复现；优先级：P1
- 事项：#29（相关，未有精确事项）
- 契约：任务受理与冻结快照创建需要原子性或补偿
- 当前证据：[src/tasks.mjs:181](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/src/tasks.mjs#L181)；[src/tasks.mjs:185](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/src/tasks.mjs#L185)；[src/records.mjs:339](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/src/records.mjs#L339)
- 验收：阻塞首个导出并发提交第二个，CONFLICT 后快照数量不增长；重启及取消也不遗留孤儿；确保受理时冻结仍成立。

## C08 产物与失败导出快照释放

- 历史 ID：PR1-08、PR4-04、PR4-11
- 当前状态：静态仍存在；优先级：P1 规划门槛
- 事项：#29（相关，未有精确事项）
- 契约：定义 Artifact 删除与文件清理、快照引用、失败任务放弃和保留策略
- 当前证据：[src/records.mjs:723](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/src/records.mjs#L723)；[src/records.mjs:667](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/src/records.mjs#L667)；[src/tasks.mjs:426](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/src/tasks.mjs#L426)；[src/protocol.mjs:34](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/src/protocol.mjs#L34)
- 验收：通过三个入口删除产物后可释放无引用快照；失败任务能明确放弃；活动租约与其他产物引用仍拒删；外部 out 文件是否删除需先定契约。

## C09 输出结果、诊断与二进制类型

- 历史 ID：P12-2、P12-5
- 当前状态：静态缺口与改进建议；优先级：P2
- 事项：#14 #29
- 契约：规定 content 类型、warnings 上限/去重、质量警告与完整性失败
- 当前证据：[src/export.mjs:70](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/src/export.mjs#L70)；[src/outputs.mjs:10](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/src/outputs.mjs#L10)；[src/records.mjs:697](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/src/records.mjs#L697)；[src/sidecar.mjs:44](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/src/sidecar.mjs#L44)
- 验收：覆盖 string、Buffer、显式对象、无效对象和 Uint8Array 的允许或拒绝；警告可定位且有界；文档写明取消/关停时限。
- 校正：Uint8Array 不一定必须支持，但必须明确拒绝语义；不可把宽泛 duck typing 当已定义的插件契约。

## C10 模型设置强制组件配置

- 历史 ID：R17-01、R17-14
- 当前状态：静态仍存在；优先级：P2
- 事项：#29 #16
- 契约：可选组件只在组合根选择后贡献配置/页面
- 当前证据：[src/model-settings.mjs:292](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/src/model-settings.mjs#L292)；[src/model-settings.mjs:314](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/src/model-settings.mjs#L314)；[src/cli.mjs:240](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/src/cli.mjs#L240)
- 验收：settings-only 组合不注入组件命名空间；只读 CLI 的首次初始化副作用有契约；安装能力启用时保留已有配置。

## C11 安装与业务任务共用 unowned 槽

- 历史 ID：R17-04
- 当前状态：静态仍存在；运行交错未重跑；优先级：P1 规划门槛
- 事项：#29 #16
- 契约：明确任务配额、饱和处理与独立 owner 的真实类型
- 当前证据：[src/app.mjs:67](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/src/app.mjs#L67)；[src/tasks.mjs:247](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/src/tasks.mjs#L247)；[src/components.mjs:142](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/src/components.mjs#L142)；[src/components.mjs:149](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/src/components.mjs#L149)
- 验收：安装中提交 import/translate/export 以及反向交错，必须排队或清楚 CONFLICT，不能记录为模型失败；不能假定 DSH owner 接受任意字符串。

## C12 组件 close 无总截止期

- 历史 ID：R17-10
- 当前状态：静态仍存在；挂死场景未运行；优先级：P2
- 事项：#29（生命周期）
- 契约：作业 wait 单次超时返回当前视图；关停总时限另行定义
- 当前证据：[src/components.mjs:301](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/src/components.mjs#L301)
- 验收：不响应 abort 的模拟下载与配置提交，关闭在约定上限内给出明确残留状态；保留提交阶段一致性。

## C13 任务进度缓存与长轮询收尾

- 历史 ID：PR4-13
- 当前状态：静态仍存在；范围需区分；优先级：P2
- 事项：#29
- 契约：任务终结清理进度缓存；Operations 长轮询与 Tasks.wait 分开收尾
- 当前证据：[src/tasks.mjs:29](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/src/tasks.mjs#L29)；[src/tasks.mjs:366](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/src/tasks.mjs#L366)；[src/operations.mjs:49](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/src/operations.mjs#L49)；[src/tasks.mjs:30](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/src/tasks.mjs#L30)
- 验收：多轮任务完成后缓存有界；关闭时各 wait API 及时返回或取消；不能声称 Tasks 自有 waiter 完全未管理。

## C14 sidecar 清理错误传播

- 历史 ID：P12-4
- 当前状态：静态存在；行为策略待定；优先级：P2
- 事项：#29 / pdf-sidecar-work-cleanup
- 契约：请求失败、子进程终止失败和残留目录警告需区分
- 当前证据：[src/sidecar.mjs:124](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/src/sidecar.mjs#L124)；[src/sidecar.mjs:129](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/src/sidecar.mjs#L129)
- 验收：模拟目录占用，验证进程已退出时如何报告残留；不能把真实终止失败一概降级。

## C15 设置值 schema 和缺件错误

- 历史 ID：F6-3、F9-4、PR4-14
- 当前状态：部分已修；值与缺件仍有缺口；优先级：P2
- 事项：#23 评论 6236437301 / 6267013673；#29 错误契约
- 契约：未知字段入口 strict 已有；compat/reasoningEfforts 值形状和 DSH 错误转换仍需补
- 当前证据：[src/protocol.mjs:46](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/src/protocol.mjs#L46)；[src/protocol.mjs:65](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/src/protocol.mjs#L65)；[src/model-settings.mjs:77](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/src/model-settings.mjs#L77)；[src/protocol.mjs:12](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/src/protocol.mjs#L12)
- 验收：compat 字符串、reasoningEfforts 数字和 forms 缺席分别返回 INVALID_ARGUMENT/COMPONENT_MISSING；HTTP、CLI、MCP 同构。
- 校正：F6-3 与 F9-4 是同一错误映射问题；#23 正文是远期组合构想，但其后续评论已精确记录该缺陷。修复无需等待完整服务配置重规划。PR4-14 同时含已修的未知字段入口和仍需核对的缺件错误。

## C16 CLI set 非法 JSON 归类

- 历史 ID：PR4-06
- 当前状态：静态仍存在；优先级：P2
- 事项：#29（错误契约；未有精确事项）
- 契约：用户语法错误应 INVALID_ARGUMENT / exit 2
- 当前证据：[src/cli.mjs:103](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/src/cli.mjs#L103)
- 验收：settings --set 非法 JSON 输出安全参数错误、exit 2；不生成 INTERNAL 诊断。

## C17 PDF 词法写入全局提示

- 历史 ID：P7-3
- 当前状态：静态仍存在；优先级：P2
- 事项：#14 #29
- 契约：格式约束由适配器提供；basis/promptVersion 仍可追溯
- 当前证据：[src/translation-model.mjs:9](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/src/translation-model.mjs#L9)；[src/translation-model.mjs:9](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/src/translation-model.mjs#L9)
- 验收：TXT/MD 无 PDF 专用约束；PDF token 完整性仍验证；改变约束不错误复用旧修订。

## C18 聚合记录写放大

- 历史 ID：PR4-05
- 当前状态：静态仍存在；性能未重测；优先级：P2
- 事项：records-update-validation
- 契约：保留每文档原子单元，再优化校验/索引；不以性能为由破坏冻结和 checkpoint
- 当前证据：[src/records.mjs:118](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/src/records.mjs#L118)；[src/records.mjs:102](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/src/records.mjs#L102)
- 验收：1k/10k 单元受控基准、每次更新工作量与内存；并发接受和 checkpoint 原子性不回退。

## C19 sidecar 环境与网络边界

- 历史 ID：P7-4
- 当前状态：静态风险；未证明凭据泄漏；优先级：P2
- 事项：#14（进程契约）
- 契约：不传模型 API 不等于环境隔离；明确可信本地进程边界
- 当前证据：[src/sidecar.mjs:32](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/src/sidecar.mjs#L32)；[sidecars/babeldoc/server.py:7](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/sidecars/babeldoc/server.py#L7)；[sidecars/babeldoc/server.py:593](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/sidecars/babeldoc/server.py#L593)
- 验收：放置假的敏感环境变量，检查白名单/显式配置；验证资源离线路径及 loopback 放行；禁止真实密钥探针。

## C20 来源校验到打开竞态

- 历史 ID：P7-5、P10-3
- 当前状态：主体已修；TOCTOU 未闭环；优先级：P2
- 事项：pdf-managed-source-containment（已解决主体） / pdf-source-open-race
- 契约：固定来源摘要、路径归属、引擎打开必须共享清楚信任边界
- 当前证据：[src/adapters/pdf.mjs:42](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/src/adapters/pdf.mjs#L42)；[src/adapters/pdf.mjs:65](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/src/adapters/pdf.mjs#L65)；[src/adapters/pdf.mjs:198](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/src/adapters/pdf.mjs#L198)
- 验收：在校验后替换文件的受控夹具，验证选定策略；明确本地可信目录还是强对抗模型；不重开已解决的路径逃逸主体。

## C21 parse-only 原件发布无记录引用

- 历史 ID：P7-8
- 当前状态：静态仍存在；未运行复现；优先级：P2
- 事项：#14（来源生命周期）
- 契约：临时解析和持久导入资源所有权分开
- 当前证据：[src/adapters/pdf.mjs:160](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/src/adapters/pdf.mjs#L160)；[src/adapters/pdf.mjs:169](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/src/adapters/pdf.mjs#L169)；[src/parse.mjs:90](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/src/parse.mjs#L90)
- 验收：parse-only 返回后原件可释放或持有显式 lease；多 store 引用不误删；失败和取消清理可验证。

## C22 PDF 状态缓存与重复路径

- 历史 ID：P7-9
- 当前状态：建议；部分问题仍存在；优先级：P3
- 事项：#14
- 契约：状态、缓存和源锁生命周期
- 当前证据：[src/adapters/pdf.mjs:26](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/src/adapters/pdf.mjs#L26)；[src/adapters/pdf.mjs:28](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/src/adapters/pdf.mjs#L28)；[src/adapters/pdf.mjs:92](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/src/adapters/pdf.mjs#L92)；[src/adapters/pdf.mjs:160](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/src/adapters/pdf.mjs#L160)
- 验收：卸载后缓存可释放；恢复可用状态可观察；capture/publish 已提取共用逻辑，避免仅按旧报告重做重构。

## C23 损坏 owned 不回退合法副本

- 历史 ID：P10-1
- 当前状态：静态仍存在；低频恢复建议；优先级：P3
- 事项：pdf-source-restoration（相关，主体已解决）
- 契约：恢复可用来源时仍强制摘要和所有权
- 当前证据：[src/adapters/pdf.mjs:83](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/src/adapters/pdf.mjs#L83)；[src/adapters/pdf.mjs:88](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/src/adapters/pdf.mjs#L88)
- 验收：损坏 owned+合法 legacy 组合，以及两者损坏组合；明确自动回退还是要求重导入。

## C24 原件修复与导出交错

- 历史 ID：P10-2
- 当前状态：待 Windows 场景验证；优先级：P2
- 事项：pdf-source-restoration / pdf-source-open-race
- 契约：来源修复不破坏在途重建
- 当前证据：[src/adapters/pdf.mjs:140](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/src/adapters/pdf.mjs#L140)
- 验收：Windows 文件占用交错，错误明确且原件可恢复；测试不得删用户原始 PDF。

## C25 组件崩溃恢复与残留

- 历史 ID：R17-02、R17-13
- 当前状态：静态仍存在；未杀进程复现；优先级：P2
- 事项：#16（安装生命周期；精确项待规划）
- 契约：publish/配置提交的崩溃恢复与安全回收
- 当前证据：[src/components.mjs:235](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/src/components.mjs#L235)；[src/components.mjs:245](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/src/components.mjs#L245)；[src/components.mjs:249](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/src/components.mjs#L249)
- 验收：在两次 rename 与设置提交前后故障注入，重启恢复唯一有效组件；仅清理自己拥有的临时项。

## C26 组件 canonical path 判断

- 历史 ID：R17-03
- 当前状态：待 junction/symlink 复现；静态条件存在；优先级：P2
- 事项：#16
- 契约：目录包含关系与合法路径别名必须兼容
- 当前证据：[src/components.mjs:77](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/src/components.mjs#L77)；[src/cli.mjs:240](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/src/cli.mjs#L240)
- 验收：合法 junction 数据目录重启可用；逃逸 symlink 仍拒绝；跨平台路径测试。

## C27 多 store 共享组件目录竞争

- 历史 ID：R17-05
- 当前状态：静态风险；未并发复现；优先级：P2
- 事项：#16
- 契约：组件目录的跨进程所有权独立于 SQLite store 锁
- 当前证据：[src/components.mjs:38](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/src/components.mjs#L38)；[src/components.mjs:205](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/src/components.mjs#L205)；[src/cli.mjs:240](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/src/cli.mjs#L240)
- 验收：两个不同 store 同父目录并发安装/回滚，有全目录排他或明确不支持策略；不复用单数据库锁假设。

## C28 关键负向与入口矩阵覆盖

- 历史 ID：PR4-07、M18-2、P12-6、R17-09
- 当前状态：部分覆盖；专项缺口待补；优先级：P2
- 事项：#29 #14
- 契约：验证现有边界并补真实缺失分支，测试数量不等于契约正确
- 当前证据：[test/export.test.mjs:52](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/test/export.test.mjs#L52)；[test/mcp.test.mjs:171](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/test/mcp.test.mjs#L171)；[test/components.test.mjs:47](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/test/components.test.mjs#L47)；[src/component-package.mjs:212](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/src/component-package.mjs#L212)
- 验收：导出冲突、产物删除、非法 JSON、真实 SSE 形状；settings/component MCP 装载调用；tar links/device/assetsOnly/redirect/rename；零调用用未挂载模型或显式 spy。
- 校正：不同历史行仅是同一验收矩阵的子项。当前 MCP credential_clear 用例同时实际调用 component_status，不能说组件工具从未调用；仍缺完整 settings get/update、组件装载/schema 与其失败矩阵。本次未运行这些专项。PDF 的局部计数断言偏弱，不等于整个 export data-only 测试缺失。

## D01 记录原子布局缺位

- 历史 ID：PR1-04
- 当前状态：已修；必须保留；优先级：保留
- 事项：#29
- 契约：per-document 聚合原子更新与冻结
- 当前证据：[src/records.mjs:85](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/src/records.mjs#L85)；[docs/requirements/v2.0/01_design_v2.0.md:152](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/docs/requirements/v2.0/01_design_v2.0.md#L152)
- 验收：重构后修订、accepted、checkpoint 原子提交；快照读取一致。

## D02 AGENTS 现状、命令与冻结时机

- 历史 ID：PR2-01、PR2-03、PR2-04
- 当前状态：已修；优先级：保留
- 事项：#29；AGENTS 任务接手
- 契约：受理导出时冻结，测试构建前提明确
- 当前证据：[AGENTS.md:23](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/AGENTS.md#L23)；[AGENTS.md:57](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/AGENTS.md#L57)；[AGENTS.md:37](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/AGENTS.md#L37)
- 验收：另一规划任务保留这些纠正；本任务不改 AGENTS。

## D03 原文与工具输出安全约束

- 历史 ID：PR2-02
- 当前状态：已修；优先级：保留
- 事项：AGENTS 任务
- 契约：输入是数据；联网与凭据按用户范围
- 当前证据：[AGENTS.md:69](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/AGENTS.md#L69)
- 验收：规划重写时保留，不把输入文档当执行指令。

## D04 虚构版本与设计当交付

- 历史 ID：PR3-01、PR3-02
- 当前状态：已修主体；优先级：保留
- 事项：#28
- 契约：软件版本、设计版本、已实现行为区分
- 当前证据：[CHANGELOG.md:22](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/CHANGELOG.md#L22)；[CHANGELOG.md:13](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/CHANGELOG.md#L13)
- 验收：保留归档 0.0.0 与设计 v2.0 的区分；当前发行条目另由 L01 追踪。

## D05 44 项需求追踪

- 历史 ID：PR1-05
- 当前状态：设计缺口仍在；优先级：P2
- 事项：#29 #16
- 契约：v1.0 编号不改；逐项映射到阶段、延期和验收
- 当前证据：[docs/requirements/v2.0/01_design_v2.0.md:444](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/docs/requirements/v2.0/01_design_v2.0.md#L444)；[docs/requirements/v2.0/01_design_v2.0.md:448](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/docs/requirements/v2.0/01_design_v2.0.md#L448)
- 验收：F-01～F-44 完整覆盖，无按 grep 缺编号就断言功能缺失；每项注明当前/目标/非本轮。

## D06 页面身份与术语导航

- 历史 ID：PR1-06、PR1-10
- 当前状态：目标设计待决；优先级：P2
- 事项：#16 #29
- 契约：页面不是后端服务一一映射；项目/术语资产独立
- 当前证据：[docs/requirements/v2.0/02_UI-design_v2.0.md:110](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/docs/requirements/v2.0/02_UI-design_v2.0.md#L110)；[docs/requirements/v2.0/03_API-protocol_v2.0.md:209](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/docs/requirements/v2.0/03_API-protocol_v2.0.md#L209)
- 验收：明确 feature/route/capability 关系，工作台进入路径和词库列表接口/延期边界。

## D07 API/UI/CLI 细节漂移

- 历史 ID：PR1-07、PR1-09、PR4-09、M18-9
- 当前状态：部分已修；目标与现状需对齐；优先级：P2
- 事项：#29 #16
- 契约：usage/range、列表 envelope、wait、detach、SSE 与 stdio 语义
- 当前证据：[src/protocol.mjs:38](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/src/protocol.mjs#L38)；[src/cli.mjs:18](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/src/cli.mjs#L18)；[src/tasks.mjs:80](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/src/tasks.mjs#L80)；[docs/requirements/v2.0/03_API-protocol_v2.0.md:294](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/docs/requirements/v2.0/03_API-protocol_v2.0.md#L294)
- 验收：逐字段差异表；settings/download 和列表 apiVersion 已有；未实现能力明确后置；stdio stdout 只承载协议。

## D08 SQLite 所有权锁例外

- 历史 ID：PR4-10
- 当前状态：文档澄清建议；优先级：P3
- 事项：#29
- 契约：协调锁不等于另造业务存储
- 当前证据：[src/store-lock.mjs:3](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/src/store-lock.mjs#L3)；[AGENTS.md:42](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/AGENTS.md#L42)
- 验收：ADR 说明 OS 崩溃释放和一库一内核；仍由 DSH 保存业务数据。

## D09 模型切换、字段与锁文件修复

- 历史 ID：F6-1、F6-2、F6-4、F9-1
- 当前状态：已修主体；优先级：保留
- 事项：#23（相关）
- 契约：按目标身份重建表单、入口 strict、可信锁定源
- 当前证据：[web/model-settings-state.mjs:33](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/web/model-settings-state.mjs#L33)；[src/protocol.mjs:12](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/src/protocol.mjs#L12)；[package-lock.json:44](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/package-lock.json#L44)
- 验收：保留旧端点/凭据不串用、新身份默认超时、未知键拒绝；服务直接调用的未知键是另一个边界选择。

## D10 当前版本/分支规则矛盾

- 历史 ID：F8-1、F8-2
- 当前状态：已修历史冲突；优先级：保留
- 事项：AGENTS 任务
- 契约：版本规则不把历史分支当当前分支
- 当前证据：[AGENTS.md:14](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/AGENTS.md#L14)；[AGENTS.md:66](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/AGENTS.md#L66)
- 验收：新规划不复活 restart 分支作为新实施命名。

## D11 版本命名的历史例外

- 历史 ID：F6-6、F8-3
- 当前状态：文档策略待澄清；优先级：P3
- 事项：AGENTS 任务
- 契约：历史证据路径稳定性与新命名规则分开
- 当前证据：[AGENTS.md:66](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/AGENTS.md#L66)；[docs/plan/0.1.0/README.md:57](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/docs/plan/0.1.0/README.md#L57)
- 验收：明确规则生效时间和历史豁免，避免批量重命名破坏证据；本任务报告用 audit-0.1.x。

## D12 已合入事项未收口

- 历史 ID：F9-3
- 当前状态：跟踪状态陈旧；需核验后更新；优先级：P2
- 事项：plugin-settings-window / model-settings-partial-save
- 契约：resolved 要与目标分支集成及全部验收对应
- 当前证据：[docs/plan/follow-ups/plugin-settings-window.md:4](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/docs/plan/follow-ups/plugin-settings-window.md#L4)；[docs/plan/follow-ups/model-settings-partial-save.md:4](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/docs/plan/follow-ups/model-settings-partial-save.md#L4)
- 验收：核验各自全部验收及历史浏览器证据再由规划/维护任务更新；不仅凭 PR 合入就关闭。

## D13 历史计数和时间表达

- 历史 ID：F6-5、F6-9、F9-5、F9-7、PR4-08、M18-7
- 当前状态：历史文档整理建议；部分已说明；优先级：P3
- 事项：对应阶段记录
- 契约：计数绑定提交/命令，历史阶段不冒充当前测试总数
- 当前证据：[docs/plan/0.1.0/README.md:57](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/docs/plan/0.1.0/README.md#L57)；[docs/plan/0.1.0/settings-dsh.md:19](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/docs/plan/0.1.0/settings-dsh.md#L19)；[docs/plan/0.1.0/mcp.md:71](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/docs/plan/0.1.0/mcp.md#L71)
- 验收：历史结果保留时点；当前状态链接 main CI；不为计数漂移重跑整套历史实验。

## D14 PR 拆分与堆叠流程

- 历史 ID：F6-8、F9-10、P7-12、P10-4、P12-3、P24-7
- 当前状态：历史流程建议；非当前缺陷；优先级：P3
- 事项：无新增事项
- 契约：评审粒度与依赖顺序；不能通过改当前代码修复历史 PR 范围
- 当前证据：[docs/plan/0.1.0/pr-review/report-features.md:82](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/docs/plan/0.1.0/pr-review/report-features.md#L82)；[docs/plan/0.1.0/pr-review/report-pdf.md:94](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/docs/plan/0.1.0/pr-review/report-pdf.md#L94)
- 验收：新任务按契约/适配器/入口拆边界并记录依赖；#10 路径修正在当前 PdfRuntime 已具备。

## D15 Windows followup fixture 清理

- 历史 ID：F5-1
- 当前状态：静态仍存在；当前 CI 不代表永不复发；优先级：P2
- 事项：windows-followups-fixture-cleanup
- 契约：测试临时目录不污染工作区
- 当前证据：[test/followups.test.mjs:15](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/test/followups.test.mjs#L15)；[test/followups.test.mjs:23](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/test/followups.test.mjs#L23)
- 验收：Windows 有界重试/临时根夹具清理；失败报告明确；不运行可能污染用户检出的历史测试。

## D16 followup 汇总健壮性与成本

- 历史 ID：F5-2、F5-3、F5-4
- 当前状态：建议；重复 ref 行为静态存在；优先级：P3
- 事项：follow-up 工具（无精确项）
- 契约：声明只读字段与纳入范围，不把模板建议等同强制 schema
- 当前证据：[scripts/followups.mjs:20](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/scripts/followups.mjs#L20)；[scripts/followups.mjs:46](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/scripts/followups.mjs#L46)；[test/followups.test.mjs:17](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/test/followups.test.mjs#L17)
- 验收：重复 ref 保序去重；不支持路径/缺字段提示策略；运行成本先量测再优化。

## D17 Markdown YAML 诊断

- 历史 ID：F6-7
- 当前状态：静态仍存在；优先级：P3
- 事项：quarto-qmd-support 仅相关
- 契约：无效输入给安全定位，不回显整份原文
- 当前证据：[src/adapters/markdown-source.mjs:154](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/src/adapters/markdown-source.mjs#L154)
- 验收：非法 mapping 返回行列/原因；指令和前导空格策略文档化。

## D18 未用 ignore/prop

- 历史 ID：F9-6、F9-8
- 当前状态：低影响建议；优先级：P3
- 事项：无精确项
- 契约：减少误导；非业务契约阻塞
- 当前证据：[.gitignore:40](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/.gitignore#L40)；[web/model-settings.jsx:9](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/web/model-settings.jsx#L9)
- 验收：删除前静态确认无引用；不为此增加镜像实现测试。

## D19 浏览器/PDF/打包历史实测证据

- 历史 ID：F9-9、F20-1、M19-3、P7-6
- 当前状态：证据待补；未否定历史运行；优先级：P2 真实引擎验收前
- 事项：#13 #14
- 契约：受许可控制的样本与脱敏报告；不可用历史断言代替当前实测
- 当前证据：[docs/plan/0.1.0/pdf.md:53](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/docs/plan/0.1.0/pdf.md#L53)；[docs/plan/0.1.0/documentation.md:15](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/docs/plan/0.1.0/documentation.md#L15)；[docs/plan/0.1.0/README.md:57](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/docs/plan/0.1.0/README.md#L57)
- 验收：提供提交、命令、环境、样本授权/摘要和输出摘要；视觉检查需人工或图像证据；本轮不运行真实 PDF/模型。

## D20 主题缺省兜底

- 历史 ID：F20-2
- 当前状态：条件建议；当前非确认缺陷；优先级：P3
- 事项：#16
- 契约：当前 SPA 二值主题与未来系统主题契约
- 当前证据：[web/app.css:1](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/web/app.css#L1)；[web/app.jsx:144](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/web/app.jsx#L144)
- 验收：仅在增加系统主题/新壳时测试首帧与原生控件。

## D21 PDF 映射与质量门槛

- 历史 ID：P7-1、P7-10、P12-1
- 当前状态：已修主体及文档口径；优先级：保留
- 事项：#14 / pdf-formula-replay
- 契约：完整性失败与可恢复质量警告分开
- 当前证据：[sidecars/babeldoc/server.py:710](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/sidecars/babeldoc/server.py#L710)；[docs/plan/0.1.0/pdf.md:17](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/docs/plan/0.1.0/pdf.md#L17)；[docs/requirements/v2.0/03_API-protocol_v2.0.md:45](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/docs/requirements/v2.0/03_API-protocol_v2.0.md#L45)
- 验收：保留歧义映射可回放、位置警告、三格式输出，以及损坏 payload/绑定必须失败；勿退回拒绝可用原文。

## D22 PDF 历史阶段措辞

- 历史 ID：P10-5、P12-7
- 当前状态：文档建议仍有残留；优先级：P3
- 事项：#14
- 契约：历史 merge 状态与通用 warnings 契约说明
- 当前证据：[docs/plan/0.1.0/pdf.md:89](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/docs/plan/0.1.0/pdf.md#L89)；[docs/plan/0.1.0/pdf.md:131](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/docs/plan/0.1.0/pdf.md#L131)
- 验收：标为当时状态；不把当前实现误写成完全无输出契约变更。

## D23 写文件后落库失败恢复

- 历史 ID：PR4-15
- 当前状态：原历史结论对当前不成立；已存在补偿；优先级：保留
- 事项：#29（输出持久化）
- 契约：落库失败删除本次新写文件；保留已有产物
- 当前证据：[src/export.mjs:95](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/src/export.mjs#L95)
- 验收：注入 addArtifact 失败验证清理和重试；另测 unlink 本身失败并报告残留，不宣称崩溃一致性完全解决。

## D24 握手版本、启动清理及本地指南

- 历史 ID：M18-3、R17-11、R17-15、M19-1
- 当前状态：已修或被源码分发替代；优先级：保留
- 事项：#28 / release-documentation-binding
- 契约：版本读 package；清理不遮蔽原错误；指南绑定产物
- 当前证据：[src/mcp.mjs:6](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/src/mcp.mjs#L6)；[src/launch.mjs:61](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/src/launch.mjs#L61)；[web/pdf-settings.jsx:6](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/web/pdf-settings.jsx#L6)；[README.md:34](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/README.md#L34)
- 验收：保留包版本握手断言、本地指南和启动冲突；不再把旧下载路径当当前安装入口。

## D25 MCP PDF 组件描述

- 历史 ID：M18-5
- 当前状态：低优先建议；现实现仍 PDF 专用；优先级：P3
- 事项：#16 #29
- 契约：能力描述与实际可安装范围一致
- 当前证据：[src/component-mcp.mjs:7](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/src/component-mcp.mjs#L7)；[src/components.mjs:121](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/src/components.mjs#L121)
- 验收：组件注册泛化时才动态生成描述；当前说 PDF 并非用户行为错误，不能照原报告称已有通用安装器。

## D26 真实 MCP 客户端措辞

- 历史 ID：M18-8
- 当前状态：文档需限定验证范围；优先级：P3
- 事项：#29
- 契约：正式 SDK 双传输与真实 DSH HTTP 客户端证据分开
- 当前证据：[README.md:30](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/README.md#L30)；[docs/plan/0.1.0/mcp.md:10](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/docs/plan/0.1.0/mcp.md#L10)
- 验收：明确真实客户端 stdio 尚未单独跑；不由 SDK 测试外推所有客户端。

## L01 CHANGELOG 发行条目

- 历史 ID：PR3-03、R25-01
- 当前状态：静态仍存在；优先级：P2
- 事项：#28
- 契约：正式 0.1.0 历史与当前源码状态可追溯
- 当前证据：[CHANGELOG.md:8](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/CHANGELOG.md#L8)；[CHANGELOG.md:37](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/CHANGELOG.md#L37)
- 验收：记录实际 0.1.0 发布/撤下，修正链接与版本；不制造未发布 0.1.1。

## L02 tar 许可表错误

- 历史 ID：R17-06、R25-03
- 当前状态：静态仍存在；优先级：P2
- 事项：#28
- 契约：文档与锁文件事实一致
- 当前证据：[THIRD_PARTY.md:35](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/THIRD_PARTY.md#L35)；[package-lock.json:1445](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/package-lock.json#L1445)
- 验收：改为固定版本实际声明并检查通知关联；本审计不作法律合规认证。

## L03 旧附件来源互斥叙述

- 历史 ID：R17-07
- 当前状态：历史问题仍需对账；当前无下载；优先级：P2 恢复二进制前
- 事项：#28
- 契约：一个工件一个构建来源表；撤下不修复旧包
- 当前证据：[docs/plan/0.1.0/installation.md:75](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/docs/plan/0.1.0/installation.md#L75)；[docs/plan/0.1.0/installation.md:105](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/docs/plan/0.1.0/installation.md#L105)；[docs/plan/0.1.0/pdf-license-audit.md:13](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/docs/plan/0.1.0/pdf-license-audit.md#L13)
- 验收：旧包来源对账；新包提供唯一 commit/tag/hash/大小/run 表；不能把 API 已无 Releases 当已修复。

## L04 构建运行时和 Python 完整性

- 历史 ID：R17-08、P7-7
- 当前状态：静态缺口；分发前门槛；优先级：P2 恢复二进制前
- 事项：#28
- 契约：固定版本还需来源和摘要闭包
- 当前证据：[scripts/build-distribution.mjs:34](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/scripts/build-distribution.mjs#L34)；[scripts/setup-pdf.ps1:11](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/scripts/setup-pdf.ps1#L11)；[sidecars/babeldoc/requirements.lock:3](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/sidecars/babeldoc/requirements.lock#L3)
- 验收：固定 Node 官方发行摘要和 wheel/hash；离线可复核；不在本轮安装或下载大包。

## L05 随包许可引用路径

- 历史 ID：R17-16、R25-06
- 当前状态：静态仍存在；未重新打包；优先级：P2 恢复分发前
- 事项：#28
- 契约：files/复制清单与第三方通知指针一致
- 当前证据：[package.json:13](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/package.json#L13)；[scripts/release-docs.mjs:91](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/scripts/release-docs.mjs#L91)；[THIRD_PARTY.md:100](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/THIRD_PARTY.md#L100)；[THIRD_PARTY.md:20](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/THIRD_PARTY.md#L20)
- 验收：实际最终 tarball 内每个代码形式的许可路径可访问，或改为正确包内位置；不能仅检查 Markdown 链接。

## L06 旧发行验收证据可获得性

- 历史 ID：R17-17、R25-12、M27-2
- 当前状态：历史证据不完备；Release 已撤下；优先级：P2 恢复分发前
- 事项：#28
- 契约：小体积可公开验收摘要不依赖撤下附件
- 当前证据：[docs/plan/0.1.0/public-installation.md:38](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/docs/plan/0.1.0/public-installation.md#L38)；[docs/plan/0.1.0/pdf-license-audit.md:9](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/docs/plan/0.1.0/pdf-license-audit.md#L9)
- 验收：脱敏 acceptance/hash/source 表可独立保存；三份许可 JSON 只证明其具体审计范围，不能补全安装功能证据。

## L07 项目许可证缺失

- 历史 ID：R25-02
- 当前状态：已修源码许可；旧二进制不据此闭环；优先级：保留
- 事项：#28
- 契约：源码分组件许可与对应源材料边界
- 当前证据：[LICENSE:7](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/LICENSE#L7)；[package.json:73](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/package.json#L73)；[sidecars/babeldoc/LICENSE:3](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/sidecars/babeldoc/LICENSE#L3)
- 验收：保留 LGPL/MIT/AGPL 边界、COPYING 与贡献规则；重新分发旧包仍需实物核验。

## L08 无 Git 源码包 smoke 断言

- 历史 ID：R25-04
- 当前状态：静态仍存在；未运行该模式；优先级：P2
- 事项：#28
- 契约：来源未知可表示为 null，不伪造提交身份
- 当前证据：[scripts/release-docs.mjs:25](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/scripts/release-docs.mjs#L25)；[scripts/smoke-package.mjs:182](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/scripts/smoke-package.mjs#L182)
- 验收：无 .git 源码包构建 smoke 按声明的支持策略通过或清楚拒绝；Git checkout 继续要求真实提交。

## L09 dirty 打包与发布校验分离

- 历史 ID：R25-05
- 当前状态：机制存在；策略建议；优先级：P2 恢复分发前
- 事项：#28
- 契约：开发打包与可发布产物分开，来源状态不能伪称 clean
- 当前证据：[scripts/pack-npm.mjs:43](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/scripts/pack-npm.mjs#L43)；[scripts/verify-release.mjs:112](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/scripts/verify-release.mjs#L112)
- 验收：dirty 开发包明确标记；发布路径强制 verify 或直接拒绝；检查不能只依赖操作者记忆。

## L10 应用与组件版本来源分开

- 历史 ID：R25-07
- 当前状态：静态风险；当前组件下载已撤下；优先级：P2 恢复二进制前
- 事项：#28 #16
- 契约：组件 manifest/tag/protocol 与应用版本独立兼容
- 当前证据：[src/app.mjs:71](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/src/app.mjs#L71)；[docs/plan/0.1.0/release-template.md:11](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/docs/plan/0.1.0/release-template.md#L11)
- 验收：新组件证据包含自身 tag/hash/protocol；缺下载返回清楚不可用；不能默认应用 0.1.0 与组件同源。

## L11 三平台 CI 不可用

- 历史 ID：R25-08、M19-2
- 当前状态：当前 main 已有成功证据；历史限制保留；优先级：保留
- 事项：#28
- 契约：CI 证据绑定精确 SHA
- 当前证据：[.github/workflows/kernel-smoke.yml:16](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/.github/workflows/kernel-smoke.yml#L16)
- 验收：当前 run 39255702238 三平台全部成功；旧 tag 的历史未跑不自动被当前 run 补齐。

## L12 运行包保留不可运行开发脚本

- 历史 ID：R25-09
- 当前状态：静态仍存在；低影响分发建议；优先级：P3
- 事项：#28
- 契约：运行时包与源码包用途区分
- 当前证据：[package.json:38](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/package.json#L38)；[scripts/pack-npm.mjs:11](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/scripts/pack-npm.mjs#L11)
- 验收：最终包中公开的开发命令可运行或清楚移除/文档区分。

## L13 private:true

- 历史 ID：R25-10
- 当前状态：符合当前意图；非缺陷；优先级：保留
- 事项：#28
- 契约：本地 tarball 不等于 npm registry 发布
- 当前证据：[package.json:4](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/package.json#L4)；[README.md:28](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/README.md#L28)
- 验收：无需为下一轮自动去掉 private；未来发布独立决定。

## L14 安全报告渠道

- 历史 ID：R25-11
- 当前状态：文档已补备用途径；设置状态未核验；优先级：P3
- 事项：#28
- 契约：公开 issue 不披露漏洞细节，建立私密联系
- 当前证据：[SECURITY.md:10](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/SECURITY.md#L10)
- 验收：维护者核验私密报告开关；本任务不创建 issue 验证渠道。

## L15 MCP 指南版本残留

- 历史 ID：M27-1
- 当前状态：部分已修；dev.0 版本仍残留；优先级：P2
- 事项：#28
- 契约：当前软件版本与旧安装组件版本分开
- 当前证据：[docs/plan/0.1.0/mcp-guide.md:3](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/docs/plan/0.1.0/mcp-guide.md#L3)；[THIRD_PARTY.md:3](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/THIRD_PARTY.md#L3)
- 验收：扫描交付文档中非历史上下文的 dev.0；恢复发行前检查包内实际字节；MCP 实际握手已读 package。

## L16 旧 tag 的发行前措辞

- 历史 ID：M27-3
- 当前状态：历史工件问题；当前已源码优先；优先级：P3
- 事项：#28
- 契约：旧 tag 不追改；下一工件在打 tag 前定稿
- 当前证据：[README.md:34](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/README.md#L34)；[docs/plan/0.1.0/installation-guide.md:3](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/docs/plan/0.1.0/installation-guide.md#L3)
- 验收：下一发行前检查源码归档/运行包/Release 说明一致；不覆盖历史 tag。

## L17 许可审计集成与 CI 接线

- 历史 ID：P24-1、P24-2、P24-3、P24-4
- 当前状态：已集成并修正文档主体；优先级：保留
- 事项：#28
- 契约：审计记录保存历史范围；新 Node bundle 与旧实物区分
- 当前证据：[docs/plan/0.1.0/pdf-license-audit.md:65](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/docs/plan/0.1.0/pdf-license-audit.md#L65)；[THIRD_PARTY.md:30](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/THIRD_PARTY.md#L30)；[.github/workflows/kernel-smoke.yml:27](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/.github/workflows/kernel-smoke.yml#L27)
- 验收：保留 CI 审计夹具和三份清单；PR #31/#32 已合入，不能继续当 open 阻塞。

## L18 许可清单 113 包描述

- 历史 ID：P24-5
- 当前状态：文档精确性待整理；优先级：P3
- 事项：#28
- 契约：安装实例数不等于去重包名数
- 当前证据：[docs/plan/0.1.0/pdf-license-audit.md:51](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/docs/plan/0.1.0/pdf-license-audit.md#L51)；[docs/plan/0.1.0/pdf-license-packages.json:108](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/docs/plan/0.1.0/pdf-license-packages.json#L108)
- 验收：由已保存 JSON 重新统计实例/名称/多版本并写清；不重跑大归档。

## L19 归档审计 Windows 非法名

- 历史 ID：P24-6
- 当前状态：待构造夹具；静态风险；优先级：P3
- 事项：#28
- 契约：不可写文本副本不得令完整清单审计中断
- 当前证据：[scripts/audit-release-archives.py:36](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/scripts/audit-release-archives.py#L36)；[scripts/audit-release-archives.py:87](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/scripts/audit-release-archives.py#L87)
- 验收：CON/NUL/尾点/尾空格等成员返回诊断并继续；路径越界仍拒绝。

## L20 旧许可审计复现环境

- 历史 ID：P24-8
- 当前状态：部分补证据；工具清单仍有边界；优先级：P3
- 事项：#28
- 契约：命令平台、固定工具与历史产物明确
- 当前证据：[docs/plan/0.1.0/pdf-license-audit.md:24](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/docs/plan/0.1.0/pdf-license-audit.md#L24)；[docs/plan/0.1.0/pdf-license-audit.md:99](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/docs/plan/0.1.0/pdf-license-audit.md#L99)
- 验收：保留计数/版本/命令摘要，明确附件撤下与授权要求；本轮未运行 PyInstaller。

## C29 启动器与 CLI 数据位置

- 历史 ID：R17-12
- 当前状态：静态仍存在；桌面方案需接入；优先级：P2
- 事项：#16（桌面与工作区契约）
- 契约：统一 --store、IVORAIGE_STORE、--data-dir 优先级或明确不同入口的选择规则
- 当前证据：[src/launch.mjs:47](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/src/launch.mjs#L47)；[src/cli.mjs:111](https://github.com/KongouAirlines/ivoraige/blob/43d3f1fadc4930baa445aeb0cb832b3647aa08d7/src/cli.mjs#L111)
- 验收：设置自定义 store 后 GUI 与 CLI 指向同一预期数据库，或明确提示不同范围；旧用户数据不搬移或覆盖。

## 历史 ID 一览

| 历史 ID | 去重组 | 当前状态 |
| --- | --- | --- |
| F5-1 | D15 | 静态仍存在；当前 CI 不代表永不复发 |
| F5-2 | D16 | 建议；重复 ref 行为静态存在 |
| F5-3 | D16 | 建议；重复 ref 行为静态存在 |
| F5-4 | D16 | 建议；重复 ref 行为静态存在 |
| F6-1 | D09 | 已修主体 |
| F6-2 | D09 | 已修主体 |
| F6-3 | C15 | 部分已修；值与缺件仍有缺口 |
| F6-4 | D09 | 已修主体 |
| F6-5 | D13 | 历史文档整理建议；部分已说明 |
| F6-6 | D11 | 文档策略待澄清 |
| F6-7 | D17 | 静态仍存在 |
| F6-8 | D14 | 历史流程建议；非当前缺陷 |
| F6-9 | D13 | 历史文档整理建议；部分已说明 |
| F8-1 | D10 | 已修历史冲突 |
| F8-2 | D10 | 已修历史冲突 |
| F8-3 | D11 | 文档策略待澄清 |
| F9-1 | D09 | 已修主体 |
| F9-2 | C06 | 静态仍存在 |
| F9-3 | D12 | 跟踪状态陈旧；需核验后更新 |
| F9-4 | C15 | 部分已修；值与缺件仍有缺口 |
| F9-5 | D13 | 历史文档整理建议；部分已说明 |
| F9-6 | D18 | 低影响建议 |
| F9-7 | D13 | 历史文档整理建议；部分已说明 |
| F9-8 | D18 | 低影响建议 |
| F9-9 | D19 | 证据待补；未否定历史运行 |
| F9-10 | D14 | 历史流程建议；非当前缺陷 |
| F20-1 | D19 | 证据待补；未否定历史运行 |
| F20-2 | D20 | 条件建议；当前非确认缺陷 |
| PR1-01 | C01 | 已修正文；保留既有实现 |
| PR1-02 | C03 | 部分实现；目标契约有漂移 |
| PR1-03 | C02 | 部分已补；核心耦合仍存在 |
| PR1-04 | D01 | 已修；必须保留 |
| PR1-05 | D05 | 设计缺口仍在 |
| PR1-06 | D06 | 目标设计待决 |
| PR1-07 | D07 | 部分已修；目标与现状需对齐 |
| PR1-08 | C08 | 静态仍存在 |
| PR1-09 | D07 | 部分已修；目标与现状需对齐 |
| PR1-10 | D06 | 目标设计待决 |
| PR2-01 | D02 | 已修 |
| PR2-02 | D03 | 已修 |
| PR2-03 | D02 | 已修 |
| PR2-04 | D02 | 已修 |
| PR3-01 | D04 | 已修主体 |
| PR3-02 | D04 | 已修主体 |
| PR3-03 | L01 | 静态仍存在 |
| PR4-01 | C07 | 静态仍存在；未运行复现 |
| PR4-02 | C02 | 部分已补；核心耦合仍存在 |
| PR4-03 | C03 | 部分实现；目标契约有漂移 |
| PR4-04 | C08 | 静态仍存在 |
| PR4-05 | C18 | 静态仍存在；性能未重测 |
| PR4-06 | C16 | 静态仍存在 |
| PR4-07 | C28 | 部分覆盖；专项缺口待补 |
| PR4-08 | D13 | 历史文档整理建议；部分已说明 |
| PR4-09 | D07 | 部分已修；目标与现状需对齐 |
| PR4-10 | D08 | 文档澄清建议 |
| PR4-11 | C08 | 静态仍存在 |
| PR4-12 | C04 | 静态仍存在 |
| PR4-13 | C13 | 静态仍存在；范围需区分 |
| PR4-14 | C15 | 部分已修；值与缺件仍有缺口 |
| PR4-15 | D23 | 原历史结论对当前不成立；已存在补偿 |
| M18-1 | C04 | 静态仍存在 |
| M18-2 | C28 | 部分覆盖；专项缺口待补 |
| M18-3 | D24 | 已修或被源码分发替代 |
| M18-4 | C03 | 部分实现；目标契约有漂移 |
| M18-5 | D25 | 低优先建议；现实现仍 PDF 专用 |
| M18-6 | C05 | 静态仍存在 |
| M18-7 | D13 | 历史文档整理建议；部分已说明 |
| M18-8 | D26 | 文档需限定验证范围 |
| M18-9 | D07 | 部分已修；目标与现状需对齐 |
| M19-1 | D24 | 已修或被源码分发替代 |
| M19-2 | L11 | 当前 main 已有成功证据；历史限制保留 |
| M19-3 | D19 | 证据待补；未否定历史运行 |
| M27-1 | L15 | 部分已修；dev.0 版本仍残留 |
| M27-2 | L06 | 历史证据不完备；Release 已撤下 |
| M27-3 | L16 | 历史工件问题；当前已源码优先 |
| P7-1 | D21 | 已修主体及文档口径 |
| P7-2 | C02 | 部分已补；核心耦合仍存在 |
| P7-3 | C17 | 静态仍存在 |
| P7-4 | C19 | 静态风险；未证明凭据泄漏 |
| P7-5 | C20 | 主体已修；TOCTOU 未闭环 |
| P7-6 | D19 | 证据待补；未否定历史运行 |
| P7-7 | L04 | 静态缺口；分发前门槛 |
| P7-8 | C21 | 静态仍存在；未运行复现 |
| P7-9 | C22 | 建议；部分问题仍存在 |
| P7-10 | D21 | 已修主体及文档口径 |
| P7-11 | C02 | 部分已补；核心耦合仍存在 |
| P7-12 | D14 | 历史流程建议；非当前缺陷 |
| P10-1 | C23 | 静态仍存在；低频恢复建议 |
| P10-2 | C24 | 待 Windows 场景验证 |
| P10-3 | C20 | 主体已修；TOCTOU 未闭环 |
| P10-4 | D14 | 历史流程建议；非当前缺陷 |
| P10-5 | D22 | 文档建议仍有残留 |
| P12-1 | D21 | 已修主体及文档口径 |
| P12-2 | C09 | 静态缺口与改进建议 |
| P12-3 | D14 | 历史流程建议；非当前缺陷 |
| P12-4 | C14 | 静态存在；行为策略待定 |
| P12-5 | C09 | 静态缺口与改进建议 |
| P12-6 | C28 | 部分覆盖；专项缺口待补 |
| P12-7 | D22 | 文档建议仍有残留 |
| P24-1 | L17 | 已集成并修正文档主体 |
| P24-2 | L17 | 已集成并修正文档主体 |
| P24-3 | L17 | 已集成并修正文档主体 |
| P24-4 | L17 | 已集成并修正文档主体 |
| P24-5 | L18 | 文档精确性待整理 |
| P24-6 | L19 | 待构造夹具；静态风险 |
| P24-7 | D14 | 历史流程建议；非当前缺陷 |
| P24-8 | L20 | 部分补证据；工具清单仍有边界 |
| R17-01 | C10 | 静态仍存在 |
| R17-02 | C25 | 静态仍存在；未杀进程复现 |
| R17-03 | C26 | 待 junction/symlink 复现；静态条件存在 |
| R17-04 | C11 | 静态仍存在；运行交错未重跑 |
| R17-05 | C27 | 静态风险；未并发复现 |
| R17-06 | L02 | 静态仍存在 |
| R17-07 | L03 | 历史问题仍需对账；当前无下载 |
| R17-08 | L04 | 静态缺口；分发前门槛 |
| R17-09 | C28 | 部分覆盖；专项缺口待补 |
| R17-10 | C12 | 静态仍存在；挂死场景未运行 |
| R17-11 | D24 | 已修或被源码分发替代 |
| R17-12 | C29 | 静态仍存在；桌面方案需接入 |
| R17-13 | C25 | 静态仍存在；未杀进程复现 |
| R17-14 | C10 | 静态仍存在 |
| R17-15 | D24 | 已修或被源码分发替代 |
| R17-16 | L05 | 静态仍存在；未重新打包 |
| R17-17 | L06 | 历史证据不完备；Release 已撤下 |
| R25-01 | L01 | 静态仍存在 |
| R25-02 | L07 | 已修源码许可；旧二进制不据此闭环 |
| R25-03 | L02 | 静态仍存在 |
| R25-04 | L08 | 静态仍存在；未运行该模式 |
| R25-05 | L09 | 机制存在；策略建议 |
| R25-06 | L05 | 静态仍存在；未重新打包 |
| R25-07 | L10 | 静态风险；当前组件下载已撤下 |
| R25-08 | L11 | 当前 main 已有成功证据；历史限制保留 |
| R25-09 | L12 | 静态仍存在；低影响分发建议 |
| R25-10 | L13 | 符合当前意图；非缺陷 |
| R25-11 | L14 | 文档已补备用途径；设置状态未核验 |
| R25-12 | L06 | 历史证据不完备；Release 已撤下 |
