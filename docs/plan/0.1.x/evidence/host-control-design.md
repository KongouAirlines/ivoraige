# HostControl@1 接口设计检查

日期：2026-11-09。范围：D01 的设计草稿，不是生产实现或运行验收。

## 基线与设计交付

[PR #70](https://github.com/KongouAirlines/ivoraige/pull/70) 已按仓库近期惯例 squash 合入 main，合并提交为 [978d9471fcc87857f4ca84da1ece6d169ee60a2b](https://github.com/KongouAirlines/ivoraige/commit/978d9471fcc87857f4ca84da1ece6d169ee60a2b)。合并前 head 为 dfde926，moewell 与 OBG-tech 最新 review 均批准，三条行内线程已解决，head 的八个检查成功。合并提交的 [Kernel distribution smoke](https://github.com/KongouAirlines/ivoraige/actions/runs/42548352608) 随后在 Ubuntu/macOS/Windows、Node 26.13.0 三个矩阵任务全部成功。这些 CI 验证的是合并内容，不包含本设计草稿的运行实现。

本次在该提交的选定源码/文档快照上进行设计，未改 src、依赖或生产入口。交付如下：

- [候选契约](../../../requirements/0.1.x/host-control-contract.md)：9 个管理/启动动作、单 owner/generation、受控本地会话、数据域恢复、重试退出和 A1/A2/A3 实施顺序。
- [机器 schema](../../../requirements/0.1.x/schemas/host-control-v1.schema.json)：请求、状态/操作投影、启动结果、恢复参数及控制器退出观察/最终收据。
- [50 个正反例](../../../requirements/0.1.x/fixtures/host-control-v1.cases.json)和[检查器](../../../requirements/0.1.x/fixtures/check-host-control-v1.py)：24 个合法、26 个应拒绝形状。
- D01 工作包导航与设计状态、RFC 后续设计链接、design-v3 处理记录、依据合并事实将 ADR-0003 标为采纳；未标任何运行能力完成。

## 实际检查

1. Python 3 + jsonschema 4.26.0：`python docs/requirements/0.1.x/fixtures/check-host-control-v1.py` 通过。Draft 2020-12 schema 自检及 50 个案例全部符合预期；附加验证 Attached 外层与 state 的域/generation 一致。
2. 本轮 15 个新增本地链接与 2 个已物化锚点检查通过，目标与固定 main 文件清单或本设计文件核对；未扫描所有未改历史文档，也未声称复查全部外链。
3. `git diff --check` 通过；改动仅文档、JSON 设计例与文档示例检查器，没有生产代码改动。
4. 静态复核后补明：单 store lease 与 DSH context 交接；管理通道保持至最终清理；释锁后旧 generation 的权限收口；控制器退出观察区别于正常收尾证明；events=false 的 control-only 兼容。

schema 的拒绝案例仅证明形状，不证明调用者身份；权限、锁、并发和持久化条件不可用 JSON 校验代替。一次性凭证/强退 challenge 的秘密响应 schema 与实际 OS 接线留给实现切片定案，不将这部分称为已冻结。

## 未运行与下一步

未运行新的 HostControl、进程/IPC/ACL/锁竞争、崩溃恢复、真实 DSH 跨重启、全套 npm test 或 Windows PDF 安装验收；纯文档切片不以旧 CI 冒充这些结果。

下一步是 A1：先实现/探测统一 bootstrap、固定用户登记位置、DSH 域元数据及可验证的本机控制通道，以 D01.H01–H05 的正反例证明再接 A2；不要求先选桌面框架、不迁移 Cordis/DSH、不扩为全四接口实现。相关范围继续归 D01 与 design-v3；未新增跟踪事项，也未关闭原事项。
