# Cordis 周边生态复用候选

日期：2026-09-29｜范围：DSH 以外的 Cordis 官方、Koishi、Satori、ChatLuna 组件｜状态：官方文档／源码定向核实，未安装、未运行新实验。

本表补充早期选型；候选可以依赖宿主的数据库、配置、控制台或模型服务。完全独立不是准入条件。阶段沿用 [MVP 计划](../plans/mvp-startup.md)：M2 文本闭环、M3 PDF 闭环、M4 个人使用完善。现有 [ADR-0001](../decisions/0001-runtime-selection.md) 中已验证的 DSH 模型路线继续作为起点。

## 推荐

优先保留 **Cordis 官方 database＋SQLite** 为 M2 译文／术语存储的适配候选；HTTP、server 按实际需要加入。它们比从完整聊天程序中拆数据库更贴近当前结构。当前源码已将旧 Minato 仓库迁移到 `cordiverse/database`，包名也已改变，不能照旧教程直接选包。

若需要现成配置页面，**Koishi console＋config＋Koishi 宿主** 是有明确价值的组合；若以后需要更广的模型接入和语义检索，**ChatLuna＋模型适配器＋向量服务＋数据库宿主** 也应保留为完整组合候选。是否采用取决于它节省的界面／模型／检索工作量，无需先证明每个插件都能独立运行。

所有“适配候选”均未在本项目运行；源码中的 peer 范围、生态标签和 `inject` 声明只说明接入条件，不证明与本项目固定的 DSH vendor Cordis 兼容。Koishi 4.18.11 的 [`@koishijs/core` manifest](https://github.com/koishijs/koishi/blob/master/packages/core/package.json) 明确依赖 `cordis ^3.18.1`、`minato ^3.7.0`、`@satorijs/core ^4.6.0`；不能因为版本也写“4”就视为 Cordis 4。下表官方新插件则主要声明 Cordis 4 RC。宿主内复用、进程边界调用或源码适配均是可选路径，当前不预建两套运行时。

## 精选候选

版本是所读分支 manifest 的快照，不代表 npm 最新稳定版；MIT／AGPL 字符串仅在对应 manifest 或仓库许可中核实。未取得插件级许可时明确留空待核。来源中“源码”链接同时可用于复查依赖和 API。

| 包／组合与所属项目 | 可用于翻译的能力与复用方式 | 重要注入／宿主依赖 | 许可与所读版本 | 阶段与状态 | 官方来源 |
|---|---|---|---|---|---|
| `@cordisjs/plugin-database`＋`@cordisjs/plugin-database-sqlite`；Cordiverse database（原 Minato） | 表定义、查询、修订／任务／来源持久化；在翻译服务中定义自己的表，使用驱动提供的 `database`。可作为 TranslationStore／TermProvider 的基础 | core 提供 `model`；驱动基类 `@Inject('model')`，启动后提供 `database`；SQLite peer core `^4.1.1`、Cordis `^4.0.0-rc.7`。源码使用 `node:sqlite` 和 `ctx.baseUrl`，需要相应 Node API及路径上下文 | 两包 MIT；4.1.1／5.1.1 | **M2 首选适配候选**。源码核实；未验证 DSH vendor 兼容与存储行为 | [core manifest](https://github.com/cordiverse/database/blob/main/packages/core/package.json)、[SQLite manifest](https://github.com/cordiverse/database/blob/main/packages/sqlite/package.json)、[driver 注入](https://github.com/cordiverse/database/blob/main/packages/core/src/driver.ts)、[SQLite 实现](https://github.com/cordiverse/database/blob/main/packages/sqlite/src/index.ts) |
| `@cordisjs/plugin-http`；Cordiverse http | 模型外的解析服务、词典、元数据 HTTP；支持流、超时及请求 `AbortSignal`。直接注册 `http` 服务或适配源码；不替代现有 DSH 模型协议层 | 提供 `http`；peer Cordis `^4.0.0-rc.8`。`undici` peer 标可选，但实现的 fetch／代理路径需要可取得 undici；不能据可选标签认定所有请求无需它 | MIT；1.5.2 | **M2／M3 适配候选**；API及 manifest 核实 | [manifest](https://github.com/cordiverse/http/blob/main/packages/core/package.json)、[实现](https://github.com/cordiverse/http/blob/main/packages/core/src/index.ts) |
| `@cordisjs/plugin-server`；Cordiverse server | 本地任务／术语确认页面的 HTTP 路由及 WebSocket 进度入口；插件注册路由可随上下文释放。直接复用服务并添加翻译路由 | 提供 `server`；peer Cordis `^4.0.0-rc.6`；Node HTTP、`ws`。使用请求／响应类型及 `server/request` 等事件；不是 Koishi 同名旧服务的适配证明 | MIT；1.7.0 | **M2 最小页面或 M4 服务入口候选**；源码核实，未运行 | [manifest](https://github.com/cordiverse/server/blob/main/packages/core/package.json)、[实现](https://github.com/cordiverse/server/blob/main/packages/core/src/index.ts) |
| `@cordisjs/plugin-server-proxy`；Cordiverse server | 本地页面转发到配置好的解析／词典上游，支持 HTTP／WS；只在确需转发时启用。使用带 `baseUrl` 的局部 server 路径 | `inject = ['http', 'server']`；peer HTTP `^1.5.1`、server `^1.7.0`、Cordis `^4.0.0-rc.6`。这是入站服务器转发，不等同 HTTP 客户端出站代理 agent | MIT；1.2.1 | **M3／M4 按需适配候选**；源码核实 | [manifest](https://github.com/cordiverse/server/blob/main/packages/proxy/package.json)、[实现](https://github.com/cordiverse/server/blob/main/packages/proxy/src/index.ts) |
| `@cordisjs/plugin-timer`；Cordiverse cordis | 限速／延迟重试、进度节流、输入防抖；复用 `timeout`／`interval`／`throttle`／`debounce`，卸载时清理句柄 | 提供 `timer` 并 mixin 到 Context；peer Cordis `^4.0.0-rc.10`；实现用 `Promise.withResolvers`。固定 DSH vendor 已有配套 timer 时优先沿用配套版本 | MIT；1.1.3 | **M2 配套能力候选**；不引入持久任务／恢复语义 | [manifest](https://github.com/cordiverse/cordis/blob/main/packages/timer/package.json)、[实现](https://github.com/cordiverse/cordis/blob/main/packages/timer/src/index.ts) |
| `@koishijs/plugin-console`；Koishi webui | 复用插件扩展页、WebSocket 数据服务与页面骨架，承载术语确认、任务进度、译文修订 UI；可以接受 Koishi 宿主一起复用 | Node 实现 `static inject = { required: ['server'], optional: ['console'] }`；peer `koishi ^4.18.11`；开发扩展页用 `@koishijs/client`。依赖 Koishi 的 server、事件及控制台体系 | AGPL-3.0；5.30.11 | **M4 宿主内复用候选**；跨到 DSH vendor 的适配未验证 | [manifest](https://github.com/koishijs/webui/blob/main/plugins/console/package.json)、[Node 实现](https://github.com/koishijs/webui/blob/main/plugins/console/src/node/index.ts) |
| `@koishijs/plugin-config`；Koishi webui | 现成 Schema 配置表单及插件配置管理，可用于模型端点、库选择、方案配置；连同 console／loader 使用，业务参数另定义 | manifest required `console`；peer `@koishijs/loader ^4.6.11`、console `^5.30.11`、`koishi ^4.18.11`。不能仅挂一个 `console` 名称就宣称移植完成 | AGPL-3.0；2.8.6 | **M4 宿主内组合候选**；manifest 核实，未核完整交互 | [manifest](https://github.com/koishijs/webui/blob/main/plugins/config/package.json)、[Node 入口](https://github.com/koishijs/webui/blob/main/plugins/config/src/node/index.ts) |
| `koishi-plugin-chatluna`＋`koishi-plugin-chatluna-openai-like-adapter`；ChatLunaLab | 多模型注册与 OpenAI 兼容端点；可在 Koishi／ChatLuna 内编写翻译插件，或参考共享 adapter 请求层。需要扩展模型覆盖时与现有 DSH 路线比较 | core required `database`，提供 `chatluna`；可选 `chatluna_storage` 等。adapter required `chatluna`，peer `koishi ^4.18.9`、ChatLuna `^1.4.0-alpha.44`，依赖 `@chatluna/v1-shared-adapter` 与 LangChain。不能只导入 adapter 就当独立 SDK | 两包 AGPL-3.0；core 1.4.0／adapter 1.4.0-alpha.14（`v1-dev`） | **M2 后续模型扩展组合候选／代码参考**；当前不替换已验证模型模块 | [core manifest](https://github.com/ChatLunaLab/chatluna/blob/v1-dev/packages/core/package.json)、[adapter manifest](https://github.com/ChatLunaLab/chatluna/blob/v1-dev/packages/adapter-openai-like/package.json) |
| `koishi-plugin-chatluna-vector-store-service`；ChatLunaLab（仓库 `packages/service-vector-store`） | 向量库／RAG 底层，检索术语出处与论文背景候选；与 ChatLuna 的 embeddings 适配器和后端组合。优先保留来源元数据，检索结果作为建议，已确认译名仍由术语业务规则决定 | 官方开发文档要求 `ChatLunaPlugin` 注册，包装 `ChatLunaSaveableVectorStore`，可用 `DataBaseDocstore`；Koishi＋ChatLuna 宿主及具体后端（如 Redis 需 RediSearch）。本轮未取得该包 manifest，**具体 inject／peer 范围待核** | **插件级许可及版本待核**；不从网站 CC-BY-SA 或 core AGPL 推断 | **M4 宿主内候选／代码参考**；能力文档核实，包级接入待核 | [官方 Redis 指南](https://chatluna.chat/guide/configure-vector-database/redis.html)、[向量库开发接口](https://chatluna.chat/development/connect-to-core-services/vector-database.html)、[官方仓库目录](https://github.com/ChatLunaLab/chatluna/tree/v1-dev/packages) |
| `koishi-plugin-cron`；Koishijs | 定时刷新显式选择的术语来源、定时备份／导出触发器；在 Koishi 宿主调用 `ctx.cron(expression, callback)`，返回取消句柄 | 提供 `cron`；peer `koishi ^4.15.5`，依赖 `cron-parser ^4.9.0`；实现用 Koishi `ctx.collect` 清理。无独立数据库持久任务机制 | MIT；3.0.1 | **M4 按需宿主内复用／代码参考**；不能承担 F-30 进度取消及重启恢复 | [manifest](https://github.com/koishijs/koishi-plugin-cron/blob/main/package.json)、[实现](https://github.com/koishijs/koishi-plugin-cron/blob/master/src/index.ts) |
| `@satorijs/plugin-server`；Satori | 通过 Satori 协议将翻译入口／完成事件接到已有聊天宿主；适合未来消息入口，通用翻译 API 仍优先用普通 server | 源码 `@Inject('http', true)`、`@Inject('server', true, {path:'/satori'})`、`@Inject('logger', true)`；peer `@satorijs/core ^5.0.0-alpha.0`、HTTP `^1.3.0`、server `^1.4.0`。使用 bots、Session、satori 服务；此新分支不同于 Koishi 常见 Satori 4 | MIT；3.0.0-alpha.0（`main`） | **M4／P1 条件候选**；科研翻译核心不需要消息平台，此轮不采用 | [manifest](https://github.com/satorijs/satori/blob/main/packages/server/package.json)、[实现](https://github.com/satorijs/satori/blob/main/packages/server/src/index.ts) |

## 接入边界与实际缺口

1. **存储仍需业务表与规则。** 官方 database 提供基础设施，不自动提供“已接受译文”“共享库／项目库冲突”“适用目标”“来源定位”等科研语义。数据库修订写入和重跑复用应只验证本项目实际使用的操作。
2. **任务分成触发、取消与持久状态。** Timer／cron 能触发和清理回调；翻译请求取消仍要显式传递取消信号，任务状态和失败位置需落库。框架 dispose 不等于持久恢复。
3. **UI 可以连宿主复用。** Koishi 页面组合和 ChatLuna 组合不因依赖宿主而淘汰；应先确定要复用的页面／服务，再检查必要依赖闭包。相同服务名不能证明 API 或运行时一致。
4. **RAG 不替代术语与译文存储。** 向量检索、ChatLuna 长期记忆、聊天会话都不能直接当作经过确认的术语库或已接受译文仓库。官方向量库简介仍出现 `chatluna-vector-database-service`，而 Redis 指南与仓库目录使用 vector-store 名称；这里按后两者记录真实候选，下一次接入前核插件 manifest，不照文档别名安装。

后续有实际需求时，先对选中的一项做最小接入核对：固定版本／运行时身份，确认真正使用的 inject／宿主服务，验证启动、调用、释放和必要的持久化行为。当前未新增依赖、未克隆源码、未做性能或兼容实验，也未将这些候选标记为已采用。
