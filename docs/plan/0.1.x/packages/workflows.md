# 可组合工作流工作包

[执行索引](../work-packages.md) · [领域契约](../../../requirements/0.1.x/workflows.md) · [验证索引](../validation.md)

## W01

类型/schema/单集合端口、能力控制与副作用声明；默认处理链用组合定义表达，任务/产物来源可追踪。

- 不做：不创建第二 Cordis/任务框架，不要求高级画布、循环或任意脚本。
- 验收：[W01 专项](../validation/workflows.md#w01)，并通过 [W-V01](../validation.md#w-v01)。
- 回退：兼容入口可切回旧调用，保留已有数据；新运行证据可读，不能抹除已发生副作用。

## W02

模板版本、工作流实例与可选项目绑定、保存/另存/增删替换/输入选择、目标输出、尝试/决定、局部重跑和恢复。I01 的[可调用方案](../../../requirements/0.1.x/workflows.md#可调用方案与集中管理)引用本包保存/冻结模型，不另造 schema。

- 不做：不建完整事件溯源/多人项目平台，不假定全部能力可缓存/恢复/暂停。
- 验收：[W02 专项](../validation/workflows.md#w02)，并通过 [W-V02](../validation.md#w-v02)。
- 回退：停新编排保留旧入口和历史；新持久 schema 按备份/双读回退，外部副作用不能靠降版撤销。

<a id="w02-admission-text"></a>

### W02.admission-text@1

W02 的先行子交付，状态为草案。复用 Records、Tasks、P04 和现有 TXT/翻译接点，交付单文本持久输入、幂等受理、有效非秘密配置冻结、run/task 映射、显式恢复及未知调用诊断。U01 接普通页，外部开放另需 I01.shared@1 的主体、限额和旧入口防旁路门禁；本地 owner 可先验收，不等待完整 W01/W02 模板/项目 UI、I01.callable@1 或 U03.terms。术语仅允许 none，非空仍须 U03.terms@1。

- 冻结配置首版按固定 DSH 的相关有效值核验：全部有效配置写入/重载纳入应用侧协调，在同一准备窗口前后比较有效投影与不可回退的变更序号，再消费同一 one-shot 调用。DSH settings revision 不能代替写入序号；无法证明实际调用一致则阻塞，不临时改全局设置、不假定必须升级 DSH。跨重启恢复是独立必验收项。
- 验收：[W-V02.admission-text](../validation/workflows.md#w-v02-admission-text)，边界与存量迁移见[四接口 RFC](../../../requirements/0.1.x/control-admission-rfc.md#固定-dsh-下的冻结执行门禁)。
- 后续映射为 RunDefinition 时保留 runId/taskId、输入与冻结事实，不补造未曾存在的实例/方案血缘。回退停新受理并保留旧记录，未知新 schema 不能交给旧程序写；按完整备份恢复。
- 子项通过不等于 W02 或 I01.callable 完成，不包含文件导入续传、通用工作流或多版本插件并行。

## W03

正文/原译文/预览主区、轻状态条、折叠步骤/参数/来源栏、卡片编辑与上下文恢复。

<a id="w03-publish-ui"></a>

**W03.publish-ui@1** 由 W03 管理界面实现者认领，依赖 I01.callable@1、W02/D03，交付集中保存/复制/配置/测试/发布的列表与表单，消费同一方案管理服务；验收 [W-V03.publish-ui](../validation/workflows.md#w-v03-publish-ui)。它是后置 UI 集成，不是 I01.callable@1 或 KT 原生端到端前置；无 UI 时本机受控 CLI 仍须能通过真实发布/撤回验收。子契约版本遵循[I01 同一规则](formats-integrations.md#共享子交付)。

- 不做：不让画布常驻占主区，不强迫普通用户建项目，不绑定桌面壳。
- 验收：[W03 专项](../validation/workflows.md#w03)，并通过 [W-V03](../validation.md#w-v03)。
- 回退：按界面入口回退，保留已存定义；复杂实例可只读，不降级删连接。

## W04

同一模型上的高级节点图编辑、分支/汇合诊断及无损切换。

- 不做：不另建图 schema/执行器，不承诺循环/动态脚本，不阻塞 W02。
- 验收：[W04 专项](../validation/workflows.md#w04)，并通过 [W-V04](../validation.md#w-v04)。
- 回退：禁用图视图，保留卡片/只读复杂图和定义文件，已存节点/连线不删除。
