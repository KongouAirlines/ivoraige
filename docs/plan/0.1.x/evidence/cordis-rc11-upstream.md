# Cordis rc.11 上游与 DSH 补丁审计

核对日期：2026-10-23。本文只记录 P01/P05 候选的来源、静态可达性和迁移义务；行为等价须由同一固定元组的构建与回归证明。

## 固定来源与配套

| 来源 | 固定标识 | 已核事实 |
| --- | --- | --- |
| ivoraige 生产 DSH | `639ed015397290b3745d163aafe02ffee4aa3f84` | [`scripts/setup-dsh.mjs`](../../../../scripts/setup-dsh.mjs) 校验该 SHA 和 tracked clean；`scripts/build.mjs` 从其 `packages/`、`vendor/` 扫描 `@deepseek-ai/*`，打成 `dist/dsh.mjs`。根 `package-lock.json` 不是 Cordis 的实际 pin。 |
| DSH 上游 HEAD | `687f282e8625c6b8d11ff58211a90524be2e4317` | 2026-10-23 `git ls-remote` 所见，与 2026-10-20 [顺序说明](../runtime-sequence.md)一致；其 [rc.11 升级计划](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/vendor/cordis-rc11-upgrade-plan.md)仍明确为 proposed，不是已迁移的 DSH 版本。 |
| Cordis rc.11 | annotated tag object `4f2cc93efb1f511872d74d8e552a219212fb315f`，剥离后 commit `0b96d9fd517b998e44e2209560c9e5f0671ce933` | 本地 `git rev-parse 'refs/tags/v4.0.0-rc.11^{}'` 与 [标签源码](https://github.com/cordiverse/cordis/tree/0b96d9fd517b998e44e2209560c9e5f0671ce933)一致。该标签**可用**的包版本为 Core `4.0.0-rc.11`、Loader `1.0.0-rc.8`、Include `1.1.1`、HMR `1.1.1`、Timer `1.1.4`；这不是本工程全部选用的包元组。版本来自各 `packages/*/package.json`，不是 npm 上的 `@deepseek-ai/*` 版本。 |
| Cordis HEAD | `35fdc969e4b6c48c48ed44717c7a018324e4dd88` | 2026-10-23 `git ls-remote` 所见；不是本次候选，不能用 HEAD 的修复推断 rc.11 标签行为。 |

生产 DSH 的 [vendor 清单](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/vendor/README.md)记录 Core rc.7、Loader rc.5 的来源同为 `56b3d4f725681cf4556c1a8695a709cc3b6eed74`；Include 1.0.4、Group 1.0.0、Timer 1.1.2、HMR 1.0.15、logger-console 1.0.0 来自 `abb0a307cb1d3b0947f455d590cf5ba922d4caa4`；Cosmokit 1.8.1 来自 `16f6fc058ade66e8ac5da0033d35a8d0f279f544`，Schemastery 3.18.0 来自 `e67cee00ad725bd1534aee930a979ea3eec6f698`。vendor `package.json` 的 Harness 发布号（如生产 Core `4.0.4`）与此上游基线版本不同。当前隔离实验选择 **DSH 生产消费者与 Include/Cosmokit/Schemastery/Group 639ed + rc.11 Core/Loader 0b96d9 + 可重放的本地兼容覆盖**；HMR/Timer 不入 bundle。固定覆盖内容哈希和真实 metafile 才构成完整候选元组；不能把同标签五包、DSH master 或 npm 包版本单独当成已选元组。

## 标签之后的两个 Core 修复

- [#209](https://github.com/cordiverse/cordis/pull/209) 于 2026-10-15 合入 `bc9a3449c4a307b68e046c92f999d882b18e009e`，比 rc.11 晚。它修改 `reflect.ts` 的 `locate()` 与 `service.ts`：服务查找在定义站点的隔离边界停止，fiber 自有 provision 不借用注入元数据；另有 Core/Loader 隔离测试。rc.11 不含这个实现。若保留项目的隔离语义，需在候选中有等价覆盖并测试，而不能只宣称标签已修复。
- [#133](https://github.com/cordiverse/cordis/pull/133) 于 2026-10-15 合入 `5dac6953d2d993d345d1de9fb0a5926f6d78a7e7`，也比 rc.11 晚。它在 `fiber.ts` 卸载结束时重新派生缓存状态，使从未 ACTIVE 的已处置 fiber 最终为 `DISPOSED`，并加了 pending/failed 场景测试。P01 的失败/中断处置探针应验证这一结果；若依赖该状态，候选须明确移植。两项均是源码差异，不应用简单的版本号比较替代探针。

## 生产 bundle 的实际边界

已有 `dist/build-evidence.json` 声称以生产 DSH SHA 构建，列有 Cordis 全部九个 `src` 文件、Loader 的 `index/internal` 与 `config/{diff,entry,group,isolate,tree,utils}`、Include `index`、Group `index`、Cosmokit（含 `volatile`）和 Schemastery `index`。没有 vendor HMR、Timer、logger-console 源码输入。该文件来自本轮生产 pin 重建的静态构建记录，尚不能单独证明新候选的 build 或运行结果。重建时须检查 metafile 和 tarball，确保只有一个 Core 类/服务图；同一 bundle 不可混入 npm `cordis` 与 DSH scoped Cordis。

下表逐项追踪生产 DSH vendor 清单的 22 项本地修改。`入包`表示上述静态输入可能触及，非行为已验证；`不入包`仅指这份 ivoraige bundle。处置依据为 [DSH rc.11 计划](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/vendor/cordis-rc11-upgrade-plan.md)和实际导入边界；计划中的“退休”仍须候选探针证明。

| DSH 项 | 当前用途与可达性 | rc.11 候选处置 / 退出成本 |
| --- | --- | --- |
| V1 HMR YAML 本地化移除 | vendor HMR 不入包。 | 本 bundle 不需迁；若日后引入 HMR，仍须处理 YAML loader 或保留移除。 |
| V2 全部 manifest/发布配置 | 来源别名扫描及许可证、打包边界相关。 | 保留 DSH scoped 名称、exports、files 与精确版本来源；构建和 tarball 校验。 |
| V3 tsconfig 项目引用 | 构建时 TypeScript 形状；esbuild 直取源码。 | 本 bundle 不一定需要 DSH 的声明输出，但不能把删除 tsconfig 当作运行时等价；单独验证类型/发布路径。 |
| V4 显式 `.ts` 相对导入和 type-only import | Core/Loader/Include 的源码构建可达。 | 随所选源码做可重复转换；构建输出、声明和 Node ESM 解析均须一致。 |
| V5 Schemastery/logger-console tsdown 覆盖 | Schemastery 入包，logger-console 不入包；本工程 esbuild 直取源码。 | 原 DSH 发布覆盖不应盲搬；如发布独立包另行核验双模块输出。 |
| V6 Core fiber lifecycle 加固 | `fiber.ts` 入包；包括重入 effect/dispose、异步清理、子 fiber 归属、observer 失败隔离。 | **部分保留**。rc.11 只替代旧 epoch 守卫等片段；保留 setup 中卸载、清理可见性、pending effect、失败隔离等探针。与 #133 为不同义务。 |
| V7 Core/Loader JSDoc | 注释随源码，运行时无差异。 | 可退出当前 bundle；若复用 DSH API 文档生成，仍有文档构建成本。 |
| V8 Include 文件刷新/patch 重放 | `include/index.ts` 入包，AppBoot profile 依赖 Include。 | 新 Include journal 可以替代旧刷新，但须验证非法文件保留运行树、patch 编辑、失败恢复；不能把旧 eager/non-transactional 装载说成事务回滚。 |
| V9 HMR watch/native path | vendor HMR 不入包。 | 本 bundle 无迁移义务；日后引入时仍需 readiness 和别名路径测试。 |
| V10 Node 可加载的 TypeScript/模块导出 | Core/Loader/Include/Schemastery 入包。 | 保留必要 type-only、ESM 导出适配，避免运行时取不存在的类型导出；独立包双入口须另验。 |
| V11 Include patch 纯函数、`entryListSchema`、insert 索引 | Include 入包，AppBoot/profile 组合需要 patch 语义。 | 新上游 patch 算法可替代旧算法，但保留公开导出并证明后续 patch 能命中同一列表先前插入项；dump 与实际 mount 相同。 |
| V12 Loader `Entry.init` 激活失败 observer | Loader `entry.ts` 入包。 | 上游 rc.11 计划认为可退休；仍须探针验证失败可审计且无 unhandled rejection。 |
| V13 Include `writeTask` 类型 | 旧 writer 类型，运行时无差异。 | 新 journal 替代旧 writer 后退出。 |
| V14 Include 持久化写队列 | Include 入包，P05 配置损坏/中断/恢复直接相关。 | 新 journal 只能在验证持久化结果后替代：临时 rename 失败重试、终局错误可见、dispose 前后 drain、初始文件落盘、Windows 占用。不能仅凭新 API 名称宣称等价。 |
| V15 lazy raw/effective config | Core、Loader、Include 均入包，ModelSettings 使用 volatile config。 | **部分保留/重接**。rc.11 改为 `Fiber.config`、`internal/config`/`commit`/`update`；需同时迁消费者，保证注入就绪后解析、provider 替换重解析、嵌套 `!!js` 由子 row 解析、活动实例引用不被候选验证覆盖。 |
| V16 Core 发布 `src` | 本工程取源码别名。 | 本地 bundle 需源文件存在；独立发布要保留 exports 指向真实文件。 |
| V17 `@deepseek-ai` 重命名 | `build.mjs` 只拦截该 scope；全部可达 vendor 包相关。 | 必保留统一 scope 或同步改整个来源映射；不能和上游无 scope 的第二份 Core 并存。 |
| V18 Loader `disabled: !!js` | Loader `entry.ts` 入包，profile patch 可使用。 | rc.11 上游已有 #179；以每次 mount 决策及写回仍为表达式的测试证实后退出。 |
| V19 Node 内部 loader API 形状检测 | Loader `internal.ts` 入包；本工程 Node 区间含 24.22.1/26.12.1。 | rc.11 上游已有对应检测；核验实际允许的 Node 版本和无 internal API 的退路后退出，避免基于 major 猜测。 |
| V20 Loader canonical fiber 身份 | Loader `entry.ts` 入包，配置/服务更新相关。 | rc.11 计划仅在全部直接生命周期字段改用 canonical fiber 后退休；provider+consumer 同改不能滞留 `PENDING`。 |
| V21 Core logger exporter disposal | Core `logger.ts` 入包，即使 logger-console 包不入包也可能影响导出者移除。 | rc.11 上游已有等价修复候选；用先注册者移除不删除后注册者的探针验证后退出。 |
| V22 volatile config 整套扩展 | Cosmokit、Schemastery、Core、Loader `diff/entry` 全部入包；`ModelSettings.Config` 四个字段调用 `.volatile()`，设置服务读写活引用。 | **必须保留且接到 rc.11 配置机制**。不可只保留类型：Reference identity、schema 元数据/验证、`equalExceptVolatile`、`_commitVolatile`、`loader/volatile-update`、`simplify` receiver、持久化和实例不重启均需同源测试。DSH 计划明确 rc.11 未上游化此扩展。 |

DSH HEAD 另外列出 V23 raw `moduleNamespace`（服务其 HMR）和 V24 Timer locale；两项**不在生产 DSH SHA 的 22 项日志内**，不能把新 HEAD 的改动误列为已用的生产补丁。当前 ivoraige bundle 无 vendor HMR/Timer，因此不把它们加入本轮运行时覆盖。

跨 Core 消费者的具体接缝：生产 DSH 的 `internal/config` 是 `waterfall(fiber, 'internal/config', raw, () => raw)`，随后单独 `resolveConfig(runtime, raw)`；rc.11 变为 `waterfall('internal/config', fiber, () => raw)`，默认 hook 自行解析。生产 `internal/update` listener 接收 `(config, noSave, next)`，rc.11 接收 `(resolvedConfig, next)` 且 `Fiber.update()` 返回可等待结果，并新增 `internal/commit(fiber, raw)`。对生产 SHA 的 `git grep` 定位到 `packages/boot/app-boot/src/index.ts:998`、`packages/boot/config-editor/src/index.ts:103`、`vendor/include/src/index.ts:190`、`vendor/loader/src/config/entry.ts:169`、`config/group.ts:81`、`loader/src/index.ts:104,115,123`；这些调用者须跟 Core 一起改，不能仅靠兼容旧 listener 的 wrapper 猜测时序。

## 候选门槛与结论

合理候选并非“只替换 Core”：同标签 Loader/Include 配套是明确的升级来源，但 DSH 消费者并不随标签自动适配。优先维持生产 DSH 639ed 消费者，按实际 bundle 限定 Core/Loader/Include、Cosmokit/Schemastery volatile 的可重放覆盖；Group 旧 pin 源码可保留，但其行为实现位于 Loader `config/group.ts`。若适配扩大为长期维护大面积私有 Core/Loader/Include 分叉，或需要改变产品配置/存储语义，应停止把它包装为一次普通 pin 升级，单列候选决策。

真正的最小可行路线先要统一两个 config 契约。其一，[rc.11 `Fiber.config`](https://github.com/cordiverse/cordis/blob/0b96d9fd517b998e44e2209560c9e5f0671ce933/packages/core/src/fiber.ts) 是 **raw**；Core 的 `_runner.execute()` 把 `this._resolve(this.config)` 放进局部 `config` 再传给插件构造器，并没有发布“当前运行实例所持有的已解析 config”。生产 [DSH V22 Loader `_commitVolatile()`](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/vendor/loader/src/config/entry.ts) 则从 `volatileEntries(fiber.config)` 获取这些活引用。照搬 V22 到 rc.11 会把 raw 当成活动对象，可能使 `ModelSettings` 仍读旧引用，或错误地决定无需重启。需要一个在**实际激活**时发布 active effective config 的可审查契约，候选校验不得覆盖它；再将 RC8 Loader 的 Entry/diff、`internal/config` 和 volatile 事件接上。其二，[rc.11 的 `Fiber.update()`](https://github.com/cordiverse/cordis/blob/0b96d9fd517b998e44e2209560c9e5f0671ce933/packages/core/src/fiber.ts) 与 [生产 DSH 旧 Include writer](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/vendor/include/src/index.ts)必须让 `internal/config` 解析、`internal/commit` 持久化、`internal/update` veto/await 的结果顺序一致；ConfigEditor/AppBoot 是实际消费者。先解决这两个已观察到的接口差异，再考虑撤 V15/V22，不能以“涉及几个包”单独判为阻断，也不能以编译通过判为等价。

V6 的最小补证范围也应由旧补丁原始保证限定：同步 setup 抛错时回滚已收集 cleanup；异步 setup 内发起 unload 等待 setup 和全部 cleanup；pending fiber 后加 effect 被 drain；`internal/plugin` 通知时增加的 inject 在启动前解析、通知时重入 dispose 阻止旧 epoch 首次执行；一个 teardown observer 抛错后其他 observer 与父 owner cleanup 仍运行。这些场景比普通 pending/failed→`DISPOSED` 更能发现 DSH 生命周期语义退化。已经存在的基础探针不自动覆盖它们。

候选的本地组件安装路径另给出 V22 缺失的直接证据：2026-10-23 在当前候选 bundle 下用无真实执行的 inert sidecar tar 和本地 manifest 重放安装。临时脚本 `evaluation/runs/probe-components-rc11.mjs` 创建隔离 store/settings/components 目录，调用 `createApp()`，捕获安装前两个 `ctx.get` 服务对象，通过 `app.components.installLocal()` 启动安装并 `jobs.wait(taskId)`，然后再捕获服务对象，比较实例、任务 Map、job 状态和选中路径；最后 dispose 并删除临时目录。候选 bundle 已构建时的最短重放命令为 `node evaluation/runs/probe-components-rc11.mjs`；要从源码重建候选，先在 PowerShell 中设置 `$env:IVORAIGE_RUNTIME='cordis-rc11'` 再运行 `npm run build`，且这会覆盖 `dist`，不可与 pinned 回退构建并行。脚本在忽略目录，不属于可发布测试证据；已有 `test/components-entries.test.mjs` 两个失败也稳定暴露入口结果。

该次脚本输出的关键值为 `sameSettings=false`、`sameComponents=false`、`appComponentsIsCurrent=false`、`oldTasksHasId=true`、`currentTasksHasId=false`、`oldJobStatus=currentJobStatus='completed'`。旧 Settings 的 `selected()` 为 null，新 Settings 指向已安装路径。因而两个组件入口的 `task not found` 不是 job 丢失，而是设置变更后依赖服务重建使实例级任务记录消失；这与未保留 V22 活引用原位更新的预测一致。该观测证明实例替换和任务丢失；具体重启触发链仍应由正式 volatile 回归固定。

最终候选的单一 Core/配套来源及 #209/#133 定向探针已有执行证据，但 V6 两项生命周期和配置/volatile 消费者门禁失败，干净 tarball 也未通过。Include 写入/中断恢复仍不能仅凭保留旧源码宣称与 RC11 等价。完整结果与采用建议见[候选执行记录](cordis-rc11-candidate.md)和[独立验证](cordis-rc11-validation.md)；本审计提供来源、补丁义务及上述隔离 trace，不把静态上游事实当作迁移通过。
