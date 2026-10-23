# 0.1.x Cordis 组合契约与模块边界重规划（原 design v3）

- ID: design-v3
- 状态: 处理中
- 实施分支／PR: codex/0.1.x-foundation-plan（规划）；[P01 PR #45](https://github.com/KongouAirlines/ivoraige/pull/45)、[Q01/Q03 PR #46](https://github.com/KongouAirlines/ivoraige/pull/46)、[P02 PR #48](https://github.com/KongouAirlines/ivoraige/pull/48)、P03 codex/0.1.x-foundation-adapters（待草稿 PR）；2026-10-18 热修证据保留
- 类型: 改进
- 发现依据: 2026-10-17 全部 18 个 PR 审查，main `dde75f5`；[issue #29](https://github.com/KongouAirlines/ivaraige/issues/29)，相关讨论 [#14](https://github.com/KongouAirlines/ivaraige/issues/14)、[#16](https://github.com/KongouAirlines/ivaraige/issues/16)、[#23](https://github.com/KongouAirlines/ivaraige/issues/23)
- 目标分支: main

## 问题与影响

v2.0 的 Cordis 组合契约在实现中出现了可观察的漂移：

- 设计用“Cordis `inject` 不提供 LLM”解释导出隔离，但 `inject` 只是依赖声明，不是访问控制；实现实际靠 `Exporter` 不传 ctx、适配器只收冻结数据。
- 设计写“新增格式 = 新增适配器”，实现仍在 `records`、`protocol`、`operations`、`tasks`、通用输出适配器和共享提示词里写死 `txt`/`md`/`pdf` 或 `babeldoc`。
- 设计写“入口是插件、每入口一行注册”，实现仍有单一 `Operations.invoke` switch、普通函数 `serve()` 与非插件 transport。
- `records` 反向依赖 `parse`/`outputs` 并承担 import 编排；MCP 入口解析 unitId 内部结构；`SettingsPages.changed` 借道 tasks 事件总线。

这些不是单个 bug，而是后续组合设计需要重新定义的契约；在当前阶段复制现有模式会扩大后续迁移成本。

## 处理条件与范围

2026-10-19 已启动首轮规划，目标按软件 [0.1.x](../0.1.x/README.md)组织，替代另起 v3 文档编号的方式；本事项 ID `design-v3` 保持稳定。当前与目标分别见[契约草案](../../requirements/0.1.x/contracts.md)，工作包及依赖见[唯一执行表](../0.1.x/work-packages.md)。本轮不改生产逻辑、不启动全面重构；对应实现 PR 明确启用范围后再替代现行契约。与 #14（引擎/格式边界与 MinerU）、#16（项目制/插件管理界面）、#23（模型/提供商/凭据组合）分工，不重复讨论。

建议范围：

1. 服务名、必需/可选 `inject`、组合根职责、缺件语义与生命周期顺序。
2. 解析/输出适配器元数据：`format`、输入类型、同步/异步导入、可选 `renderReadable()`、返回形状；`records` 只存通用 IR。
3. CLI/HTTP/MCP 可选入口插件与最小 bootstrap/help/修复通道分工；能力注册、错误映射、取消语义及 disposer 所有权；入口不做领域 ID 解析、领域文件读取或格式分支。
4. 跨域事件契约（含设置页变化）与可选能力装载/卸载测试矩阵。
5. 导出隔离的负向测试；不同 `adapterId` 的最小二进制/耗时来源夹具。
6. v2.0 参考 → 目标软件 0.1.x 的差异、兼容边界、API/UI/AGENTS 同步要求；旧文档和稳定编号保留。

## 验收条件

- [ ] 0.1.x 契约包含服务名/`inject`/组合根/可选能力/生命周期表并完成评审。
- [ ] 适配器与入口契约可通过代码检查或最小夹具验证，不依赖“约定”。
- [ ] 保留已有 data-only/未绑定 this/冻结不可写/无 LLM 负向测试，并为异步及新插件增强；文档不再用 `inject` 解释机制。
- [ ] 新格式只增加适配器与配置即可经现有入口完成导入、翻译、审校、冻结导出，不修改共享 operations/tasks 的格式分支。
- [ ] v2.0 参考 → 0.1.x 目标的迁移清单明确，旧设计中的已知错误有替代说明。

## 处理记录

- 2026-10-23：P01、Q01/Q03、P02 已在分支完成验证，P03 基础适配器切片在独立堆叠分支完成 291/291 本机回归、构建及 npm package smoke；证据见 [P01](../0.1.x/evidence/foundation-runtime.md)、[Q01/Q03](../0.1.x/evidence/foundation-qfix.md)、[P02](../0.1.x/evidence/foundation-p02.md)、[P03](../0.1.x/evidence/foundation-p03.md)。目前均待按依赖顺序集成，P04 入口/事件及其余验收未完成，本 follow-up 保持处理中。

- 2026-10-20：按 [PR #34 审阅](https://github.com/KongouAirlines/ivoraige/pull/34#discussion_r4323789541)修正规划状态为“已安排”；生产实施未开始，不扩展状态机。下方 2026-10-19 的“处理中”是当时误用，保留记录并由本条更正。基础范围见 [0.1.0 基础候选](../0.1.0/foundation-plan.md)，工作包状态仍只在原执行表维护。

- 2026-10-19：本地规划分支新增 0.1.x 契约、PR 工作包、迁移/分发、验证矩阵和提示词；状态为“处理中”，不代表实现或验收通过。旧报告保留，第二插件与跨引擎重建分别验收。

- 2026-10-18：登记。同日热修只修正 v2.0 §3.3.4/§4.1 的导出隔离表述、AGENTS 的安全/机制表述和 `docs/plan/0.1.0/pdf.md` 的验证口径；重规划留待 v3。
