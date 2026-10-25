# 模型设置跨插件部分保存体验

- ID: model-settings-partial-save
- 状态: 处理中
- 实施分支／PR: codex/0.1.0-settings 的 S2（[PR #9](https://github.com/KongouAirlines/ivoraige/pull/9)）；codex/0.1.x-foundation-qfix 的 Q03（[PR #46](https://github.com/KongouAirlines/ivoraige/pull/46)）
- 类型: 改进
- 发现依据: 2026-10-07，[PR #6 审阅意见](https://github.com/KongouAirlines/ivaraige/pull/6#discussion_r4198373353)，代码基线 `e9c785f`；登记时为既有已记录行为；实施探针与结果见处理记录。
- 目标分支: main

## 问题与影响

模型路由和模型列表／当前选择由 DSH 两个插件条目持久化。路由保存成功后，第二次写入若冲突或失败，路由已经落盘；现有 [API 协议](../../requirements/v2.0/03_API-protocol_v2.0.md#37-当前工作台能力与模型设置) 明确声明不是跨条目原子事务。不能把错误响应误认为两次保存都未发生。

## 处理条件与范围

PR #6 审阅允许保留此设计，不另造跨插件事务。2026-10-07 设置窗口重新规划时，将反馈与恢复纳入 [S2](../0.1.0/settings-goal.md)：明确提示可能部分保存，提供重读并保留非秘密输入供核对，不自动覆盖新 revision；凭据保存成功与后续读取失败分别反馈。若接口无法确定哪些字段已保存，不推测具体成功字段。跨插件原子性不属于本事项验收；需另行评估上游能力。

## 验收条件

- 用可控的第二步失败验证已保存和未保存部分的实际状态。
- 用户得到准确反馈，重读／重试不覆盖他人的新配置。
- 继续使用 DSH 存储、revision 检查及运行任务互斥，不承诺未实现的原子性。

## 处理记录

- 2026-10-07：内核在路由保存后、第二次写入失败时返回 partialSave 信息，保留原错误语义；模型表单保留输入并要求显式重读。第二次写入失败探针验证真实持久化状态，浏览器 revision 冲突检查确认旧草稿不覆盖新配置、重读须确认。凭据写入成功与刷新失败分别反馈。实现提交 87de41b 三系统 Node 24 CI 通过，PR #9 待人工验收及合入 main，未实现跨插件原子事务。
- 2026-10-07：随用户要求重做设置规划，反馈／重读／安全恢复由 codex/0.1.0-settings S2 认领，状态“已安排”；尚未修改运行时代码或运行失败探针。
- 2026-10-07：登记审阅指出的已知边界，尚未安排实施；本 PR 用 comment 说明而不改动持久化机制。

- 2026-10-08：PR #9 审阅补充未知错误码的公开分类与显式更新字段契约；保持部分保存边界与重读反馈，未引入跨插件事务，待主线合入。
- 2026-10-25：PR #46 分支在 `4e929478` 补上第二次设置写入失败后的 `partialSave` 与已持久化路由 revision；`76758b9` 将 DSH 原生 CAS 冲突映射为 `CONFLICT`，第二次写入冲突仍报告部分保存；`a2d1fd1` 补齐协议特定 compat 校验。实现与回归结果见 [Q03 证据](../0.1.x/evidence/foundation-qfix.md#q03--settings-and-cli-errors)、[第二次写入证据](../0.1.x/evidence/foundation-qfix.md#46-review-correction--retain-failure-and-second-settings-write)及 [CAS 证据](../0.1.x/evidence/foundation-qfix.md#46-cas-review-correction--native-dsh-settings-conflicts)。这些是分支验证，尚待目标分支集成；跨插件原子事务仍不属于本事项验收。

- 2026-10-25 文档追溯复验：Node 26.12.1 上 	est/model-settings.test.mjs 15/15，以及 MCP 套件中的设置错误、原生 CAS、API compat 三项实际 HTTP/CLI/MCP 回归 3/3 通过。完整代码基线 2d1fd19ef055846805beda90afe6a343432a185 的 [CI](https://github.com/KongouAirlines/ivoraige/actions/runs/40057038484) 已通过；分支通过不等于已集成，状态仍为处理中。
