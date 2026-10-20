# 0.1.x Cordis 演进与 DSH 组件边界顺序评估

核对日期：2026-10-20。这是源码与上游记录的评估，不是升级、组件安装或生命周期探针的通过记录。执行状态仍只在[工作包表](work-packages.md)维护；这里细化 P01/P05 的决策门禁，不增加第二份进度表。

## 结论与当前边界

保持 P01 → P02 → P03 → P04 → P05 → P06 → P07 主链，但把 P01 的**现有基线行为固定**与**候选运行时迁移验证**分开。先在现有 pin 上盘点依赖闭包、补生命周期探针并推进领域接口；Cordis 升级不成为整条链的硬前置。同 SHA、可证明行为不变的获取/构建缩减可以单独交付。升级和公共组件包替换必须分别有证据，不能与 Records 改造、独立插件分包混成一个难以归因的 PR。

| 已核对事实 | 影响 |
| --- | --- |
| ivoraige main 为 `43d3f1fadc4930baa445aeb0cb832b3647aa08d7`；[setup-dsh](../../../scripts/setup-dsh.mjs)固定 DSH `639ed015397290b3745d163aafe02ffee4aa3f84`并拒绝已修改的受跟踪源码 | 以完整提交和补丁来源识别基线，不能只记录一个 npm 版本 |
| DSH [vendor manifest](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/vendor/README.md)记录 Core `4.0.0-rc.7`、Loader `1.0.0-rc.5`，上游提交 `56b3d4f725681cf4556c1a8695a709cc3b6eed74`；[包清单](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/vendor/cordis/package.json)中 `@deepseek-ai/cordis` 为 `4.0.4` | 4.0.4 是 Harness 发布版本，不能解释为上游 Cordis 已正式稳定，也不能与 rc.11 直接按版本数字比较 |
| [bridge](../../../src/dsh-bridge.ts)已选择性导出 Cordis、LLM/provider、credentials、jobs、AppBoot、settings、storage 等；[build](../../../scripts/build.mjs)扫描 DSH packages/vendor 别名并从 bridge 用 esbuild 生成 `dist/dsh.mjs` | 获取/扫描完整源码不等于启动完整 DSH 应用，也不能未经 metafile/发行包核查就声称全部源码进入运行产物 |
| [根 package.json](../../../package.json)与 [package-lock](../../../package-lock.json)没有直接锁定 Cordis；实际来源由上述源码 pin、别名和打包路径确定 | 只改根 lock 不能完成升级；改为公共包需重新验证解析、传递依赖和实际 tarball |
| 固定 DSH 的 vendor 记录了生命周期、Loader/Include 配置、Node 兼容和 volatile config 等本地修改；[Records](../../../src/records.mjs)把 `reflect.provide` 与关库 disposer 放在同一个生成器 effect 中 | 上游版本更高不保证包含这些语义；升级须逐项保留、由上游等价替代或明确退出，并用实际消费者证明 |

2026-10-20 查询到 DSH master 为 `687f282e8625c6b8d11ff58211a90524be2e4317`；该提交的 [vendor 清单](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/vendor/README.md)仍记录上述 Core/Loader 上游基线，[RC.11 升级计划](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/vendor/cordis-rc11-upgrade-plan.md)明确为 **proposed**。计划先准备有效配置和消费者契约，再做 Core 与必要 Loader/Include/HMR 调用者的兼容切片；这不证明升级已实施。RC.11 也没有替代全部 DSH volatile 扩展；本项目 [model-settings](../../../src/model-settings.mjs)实际使用 AppBoot/profile、ConfigEditor、SettingsForms 与 volatile 引用，需要保留消费者回归。

上游 [v4.0.0-rc.11](https://github.com/cordiverse/cordis/releases/tag/v4.0.0-rc.11) 指向 `0b96d9fd517b998e44e2209560c9e5f0671ce933`（10 月 14 日）；服务隔离修复 [#209](https://github.com/cordiverse/cordis/pull/209) 和 PENDING/FAILED dispose 终态修复 [#133](https://github.com/cordiverse/cordis/pull/133) 于 10 月 15 日合入，不在该标签中。候选需确认这些行为由目标提交、明确移植或等价补丁覆盖；是否影响本项目、迁移后是否修复仍需探针，不能从 PR 合入或标签存在推定已经通过。

### “按组件依赖”分别要交付什么

| 层次 | 可验收目标 | 不能由此推导 |
| --- | --- | --- |
| 源码获取与构建闭包 | 同一 DSH SHA 下，所需 packages/vendor、生成输入、动态加载、资源与许可证均可重建；减少 checkout/扫描范围并记录来源 | 不等于采用公共包，更不等于已摆脱 DSH |
| 发行与运行依赖闭包 | 从最终归档证明最小宿主、翻译、PDF 等各自实际依赖；未装能力不携带/启动其不必要运行时，保留必要共享依赖 | tree shaking、源码目录变小或选择性 export 本身不证明独立安装成立 |
| 公共组件包与 API 边界 | 以可重复获得的精确包版本/来源与完整传递依赖替换源码别名；公共导出、类型、资源、配置解析均通过干净安装 | 使用 `@deepseek-ai/*` 子包仍依赖 DSH 的契约、补丁和维护，不能自动宣称与 DSH 解耦 |

盘点从实际使用边出发：bridge 的静态导出、AppBoot/Loader 的配置或动态加载、服务 inject/可选 peer、跨包类型及运行时身份、原生依赖、资源/构建输入、许可证和包 exports。尤其是 [JobsLocal manifest](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/jobs/jobs-local/package.json) 的 agent/scope/jobs/timeout peers，要按[源码](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/jobs/jobs-local/src/index.ts)区分类型、运行时导入与实际服务注入，不能把 peer 名单直接当作强制服务注入或一律删除。源码依赖图、打包 metafile 和运行探针互相校验；仅静态 import 扫描会漏掉配置贡献和动态路径。公开包是否包含所需源码/构建输出和补丁，要对精确版本实际 tarball 验证，不依据 manifest 的发布意图推定已可用。

## 分阶段执行与决策点

| 阶段 / 归属 | 范围与可并行项 | 门禁 / 不通过时 |
| --- | --- | --- |
| 当前 pin 的行为基线，P01 | 固定 Context/Service、reflect/inject、ready/effect/dispose、AppBoot/Loader/settings 和 jobs 的消费者探针；列出现有 DSH 补丁使用面。Q01/Q03、D04 与 P08 清单核对可独立推进 | 得到可执行的当前语义；发现阻塞缺陷则单独修边界或评估最小上游修复，不以等正式版代替修复 |
| 同 pin 获取/构建缩减，P01 的独立小 PR | 闭包盘点完成后可先试验；不改变 Core/Loader 版本、公共契约或业务行为 | 来源、解析结果、产物依赖与许可证可重建；定向测试及干净包 smoke 等价。失败恢复完整源码获取和旧 build 路径 |
| 领域与入口契约，P02–P04 / D01 | 按已验证基线推进 Records、适配器、操作/事件；RC 相关内部调用集中在 bridge/组合根，领域契约不泄漏候选框架内部类型 | 不依赖尚未验证的新 API；生命周期或 barrier 无法满足时只阻塞受影响边界，不冻结无关修复 |
| 配套运行时候选，P01 的单独迁移 PR | 只读上游/补丁差异和隔离探针可与主链并行；选择确切 Core、Loader、相关 vendor 和 DSH 组合，不滚动追随 latest | 在首次使用新语义前通过候选门禁；没有升级必要性或不通过时留旧 pin。不得同时改变存储 schema、插件包装和领域编排 |
| 公共组件获取与独立分包，P05 / P08 | 可先用现有 pin 完成受控同仓插件包；公共 DSH 包替换另做交付，评估来源可复现性与维护成本 | 兼容清单定案前必须选择并测试明确运行时元组；候选升级未通过可正式选择旧元组。不能用等待 RC 定型延迟所有独立安装验收 |

现有基线契约可以先固定；候选迁移契约在采用候选前固定。这两件事不互相等待。若已有确定的近期升级需求，在 P05 兼容范围定案前完成旧/新组合比较以减少二次改包；否则先发布经测旧组合，未来升级通过新的兼容范围、迁移说明和独立门禁演进，不承诺跨所有 RC。

## 候选兼容门禁与维护成本

- **版本与补丁元组：**记录 DSH SHA、Harness 包版本、Core/Loader 各自上游 SHA、配套 vendor、Node 版本、构建配置和补丁集合。RC 标签、合并 PR、发布包是不同证据；确认所需提交实际被候选包含，不把较大的 RC 号当成补丁全集。升级收益须对应具体缺陷、所需能力或维护成本下降。
- **单一运行时：**同一宿主插件图只有一个实际解析的 Cordis Core 身份及配套 Loader；宿主与插件共享 Context/Service、服务键和类型契约。检查 metafile、模块解析和真实装包图，防止插件各自 bundle Core，或将 npm `cordis` 与 `@deepseek-ai/cordis` 同时带入一个图。manifest 的 peer 声明、同版本字符串或 TypeScript 编译成功都不是单实例证据。
- **服务与退出：**验证同步/异步/生成器 effect、重入 dispose、部分启动失败、provider 失活及替换、依赖消费者清理顺序；Records 的 `reflect.provide` 撤销必须先等待消费者完成，再关闭 storage domain。检查卸载失败诊断和 deadline，不能仅靠注释或 Core 单元测试证明本项目数据库安全。
- **装配与配置：**覆盖 AppBoot/Loader/Include、settings 的读写、禁用与重启、配置错误恢复、异步持久化失败、实际使用的动态表达式/volatile 行为及 Node 模块解析。固定 DSH 的 Loader eager/non-transactional 行为不能被规划中的“安装事务”误说成已由上游保障；P05 仍需自己的包/清单恢复边界。
- **业务和发行回归：**保留 Records 修订/接受/适用性、冻结输出零翻译、任务取消和恢复、三入口协议以及重连 barrier；无翻译组合、完整文本组合分别验证。三系统现有 suite 与干净 tarball smoke、旧数据只读/兼容、失败激活/禁用/回退均通过后，才扩大受支持组合；桌面 native 与 PDF 引擎仍独立验收。
- **补丁成本账：**按补丁记来源/用途、上游是否已等价覆盖、保留/移植/退出理由、受影响消费者与回归用例。Core、Loader、Include、Schemastery/Cosmokit 的跨包改动须成套评估；采用 DSH 新 pin 可复用其维护，但仍验证本项目；自行追上游或抽取包会承担合并、安全更新、发布重建、许可和故障定位成本。若尚无明确收益，保持可复现旧组合优于增加一个长期私有 fork。

回退以完整运行时/插件清单/构建来源为单位，保留上一可运行产物及兼容配置副本；失败候选不改写用户记录和冻结快照。若配置或持久状态已改变，先证明旧程序能读再回退，否则用备份/显式迁移恢复，不能只降包版本。单一运行时不妨碍在隔离测试进程中比较旧/新候选，但不允许在生产插件图中混用来掩盖不兼容。

本轮只调整规划，没有执行 Cordis 升级、依赖拆分或上述探针。实施者在依赖变更发生时重新核对上游，记录实际结果；本次静态核对和已有 CI 不替代候选验收。
