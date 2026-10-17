# design v3：Cordis 组合契约与模块边界重规划

- ID: design-v3
- 状态: 已安排
- 实施分支／PR: 未安排；2026-10-18 仅完成 v2.0 的导出隔离表述与 PDF 验证口径热修
- 类型: 改进
- 发现依据: 2026-10-17 全部 18 个 PR 审查，main `dde75f5`；[issue #29](https://github.com/KongouAirlines/ivaraige/issues/29)，相关讨论 [#14](https://github.com/KongouAirlines/ivaraige/issues/14)、[#16](https://github.com/KongouAirlines/ivaraige/issues/16)、[#23](https://github.com/KongouAirlines/ivaraige/issues/23)
- 目标分支: main

## 问题与影响

v2.0 的 Cordis 组合契约在实现中出现了可观察的漂移：

- 设计用“Cordis `inject` 不提供 LLM”解释导出隔离，但 `inject` 只是依赖声明，不是访问控制；实现实际靠 `Exporter` 不传 ctx、适配器只收冻结数据。
- 设计写“新增格式 = 新增适配器”，实现仍在 `records`、`protocol`、`operations`、`tasks`、通用输出适配器和共享提示词里写死 `txt`/`md`/`pdf` 或 `babeldoc`。
- 设计写“入口是插件、每入口一行注册”，实现仍有单一 `Operations.invoke` switch、普通函数 `serve()` 与非插件 transport。
- `records` 反向依赖 `parse`/`outputs` 并承担 import 编排；MCP 入口解析 unitId 内部结构；`SettingsPages.changed` 借道 tasks 事件总线。

这些不是单个 bug，而是 v3 设计需要重新定义的契约；在当前阶段复制现有模式会扩大后续迁移成本。

## 处理条件与范围

等公开仓库准备与许可决定落定后启动；本事项只记录范围，不授权实施。v2.0 仍是当前参考，v3 文档与迁移清单确定后再切换基线。与 #14（引擎/格式边界与 MinerU）、#16（项目制/插件管理界面）、#23（模型/提供商/凭据组合）分工，不重复讨论。

建议范围：

1. 服务名、必需/可选 `inject`、组合根职责、缺件语义与生命周期顺序。
2. 解析/输出适配器元数据：`format`、输入类型、同步/异步导入、可选 `renderReadable()`、返回形状；`records` 只存通用 IR。
3. 入口注册模型：入口插件或协议适配模块；能力注册、错误映射、取消语义；入口不得解析内部 ID、做文件 I/O 或格式分支。
4. 跨域事件契约（含设置页变化）与可选能力装载/卸载测试矩阵。
5. 导出隔离的负向测试；不同 `adapterId` 的最小二进制/耗时来源夹具。
6. v2.0 → v3 差异、兼容边界、API/UI/AGENTS 同步要求。

## 验收条件

- [ ] v3 文档包含服务名/`inject`/组合根/可选能力/生命周期契约表。
- [ ] 适配器与入口契约可通过代码检查或最小夹具验证，不依赖“约定”。
- [ ] 导出隔离有负向测试，文档不再用 `inject` 解释机制。
- [ ] 新格式只增加适配器与配置即可经现有入口完成导入、翻译、审校、冻结导出，不修改共享 operations/tasks 的格式分支。
- [ ] v2.0 → v3 迁移清单明确，旧设计中的已知错误有替代说明。

## 处理记录

- 2026-10-18：登记。同日热修只修正 v2.0 §3.3.4/§4.1 的导出隔离表述、AGENTS 的安全/机制表述和 `docs/plan/0.1.0/pdf.md` 的验证口径；重规划留待 v3。
