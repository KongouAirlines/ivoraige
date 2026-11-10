# HostControl@1 接口设计检查

日期：2026-11-09；2026-11-10 按 #87 复审补正。范围：D01 的设计草稿，不是生产实现或运行验收。

## 基线与设计交付

[PR #70](https://github.com/KongouAirlines/ivoraige/pull/70) 已按仓库近期惯例 squash 合入 main，合并提交为 [978d9471fcc87857f4ca84da1ece6d169ee60a2b](https://github.com/KongouAirlines/ivoraige/commit/978d9471fcc87857f4ca84da1ece6d169ee60a2b)。合并前 head 为 dfde926，moewell 与 OBG-tech 最新 review 均批准，三条行内线程已解决，head 的八个检查成功。合并提交的 [Kernel distribution smoke](https://github.com/KongouAirlines/ivoraige/actions/runs/42548352608) 随后在 Ubuntu/macOS/Windows、Node 26.13.0 三个矩阵任务全部成功。这些 CI 验证的是合并内容，不包含本设计草稿的运行实现。

本次在该提交的选定源码/文档快照上进行设计，未改 src、依赖或生产入口。交付如下：

- [候选契约](../../../requirements/0.1.x/host-control-contract.md)：9 个管理/启动动作、单 owner/generation、受控本地会话、数据域恢复、重试退出和 A1/A2/A3 实施顺序。
- [机器 schema](../../../requirements/0.1.x/schemas/host-control-v1.schema.json)：通用请求、独立 OwnerIPC 请求/帧、错误信封、状态/操作投影、启动结果、恢复参数及控制器退出观察/最终收据。
- [108 个正反例](../../../requirements/0.1.x/fixtures/host-control-v1.cases.json)、[Python 检查器](../../../requirements/0.1.x/fixtures/check-host-control-v1.py)及 [Node 测试](../../../../test/host-contract.test.mjs)：55 个合法、53 个应拒绝形状。
- D01 工作包导航与设计状态、RFC 后续设计链接、design-v3 处理记录、依据合并事实将 ADR-0003 标为采纳；未标任何运行能力完成。

## 实际检查

1. Python 3 + jsonschema：`python3 docs/requirements/0.1.x/fixtures/check-host-control-v1.py` 通过。Draft 2020-12 schema 自检及 108 个案例全部符合预期；附加验证 Attached 外层与 state 的域/generation 一致。
2. Node + Ajv：`node --test test/host-contract.test.mjs` 通过，读取同一 schema 与 fixture。该测试由现有 `npm test` 的 `test/*.test.mjs` 自动纳入，无需修改 package.json。
3. 原设计检查的 15 个新增本地链接与 2 个已物化锚点检查通过，目标与固定 main 文件清单或本设计文件核对；未扫描所有未改历史文档，也未声称复查全部外链。
4. `git diff --check` 通过；改动仅文档、JSON 设计例与文档示例检查器，没有生产代码改动。
5. 静态复核后补明：单 store lease 与 DSH context 交接；管理通道保持至最终清理；释锁后旧 generation 的权限收口；控制器退出观察区别于正常收尾证明；events=false 的 control-only 兼容。

2026-11-10 补正了错误 `details.reason`/`details.supportedMinors`、独立 OwnerIPC 帧、跨字段规则、字段/枚举说明、完成态与本机恢复模式。OwnerIPC 运行 zod 对照需由启用它的实现分支单独执行；此处 Node 测试只检验 JSON Schema 自身，不声称已验证运行时。

schema 的拒绝案例仅证明形状，不证明调用者身份；权限、锁、并发和持久化条件不可用 JSON 校验代替。一次性凭证/强退 challenge 的秘密响应 schema 与实际 OS 接线留给实现切片定案，不将这部分称为已冻结。

## 未运行与下一步

未运行新的 HostControl、进程/IPC/ACL/锁竞争、崩溃恢复、真实 DSH 跨重启、真实 OwnerIPC 实现对照、全套 npm test 或 Windows PDF 安装验收；纯文档切片不以旧 CI 冒充这些结果。

下一步是 A1：先实现/探测统一 bootstrap、固定用户登记位置、DSH 域元数据及可验证的本机控制通道，以 D01.H01–H05 的正反例证明再接 A2；不要求先选桌面框架、不迁移 Cordis/DSH、不扩为全四接口实现。相关范围继续归 D01 与 design-v3；未新增跟踪事项，也未关闭原事项。

## 初始化恢复的二次核对

在 2026-11-10 已有 100 例合同修正上继续核对 #88：缺失文件不等于从未写入。补明 v3 prepared/writing 持久屏障、非空目标身份、旧版拒写标记及 v1/v2 保守恢复边界；不允许借撤回意图或重建同 ID 库掩盖可能已完成的写入。应答大小/格式错误也属于提交后的结果未知，不能误报 invalid-request 的“无副作用”。本次不改变既有 OwnerIPC 帧、恢复模式命名或 completed 投影选择。

同一 100 例在 Node/AJV 与 Python 检查均通过。本段描述合同要求，运行实现及其回归证据归 #88，不把 schema 检查算作持久化或原生平台验收。

## 错误类别与已定义 reason 的一致性

同日复核发现原 schema 接受 `INVALID_ARGUMENT/interface-version-unsupported`，与契约表中的 `PRECONDITION_FAILED` 不符；OwnerIPC 失败帧也接受相同组合。现将两个边界的错误对象共用同一 schema，只限制表中已有明确类别的 reason；未知 reason 与仅用于 ControlOperation 的阶段原因不额外绑定 code。新增五个反例和三个正例后，Python jsonschema 与 Node/Ajv 检查 108 例通过，`git diff --check` 通过。此检查不证明运行时错误分类正确；实际 OwnerIPC formatter 对照仍属 A1 实施验证。
