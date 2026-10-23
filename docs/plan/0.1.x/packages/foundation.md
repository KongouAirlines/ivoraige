# 基础契约与正确性工作包

[执行索引](../work-packages.md) · [领域契约](../../../requirements/0.1.x/contracts.md) · [验证索引](../validation.md)

## Q01

先复现 createSnapshot 后任务受理 CONFLICT 的无引用快照，再做事务或精确补偿。

- 不做：不改冻结时点、不删除别的任务快照、不等待重构。
- 验收：[Q01 专项](../validation/foundation.md#q01)。
- 回退：独立补丁可回退；补偿只操作本次未被引用的快照，不批量清理用户历史。

## Q02

定义 artifact 删除/文件保留、失败任务显式放弃、快照引用/lease，再暴露公共操作。

- 不做：不把 failed cancel 当普通取消、不默认删除外部 out 文件、不删活动产物。
- 验收：[Q02 专项](../validation/foundation.md#q02)。
- 回退：关闭新删除入口并保留记录；删除属于不可逆数据操作，不能以代码回滚声称数据恢复。

## Q03

compat/reasoningEfforts 值校验、DSH ValidationError/缺 forms 映射，CLI set JSON 解析错误。

- 不做：不重设计模型/连接/凭据体系、不放宽入口 strict。
- 验收：[Q03 专项](../validation/foundation.md#q03)。
- 回退：独立错误映射补丁回退；不迁移已存设置。

## Q04

F-01–F-44 到当前/目标/非本轮的追踪，API/UI/CLI 字段差异、活跃说明的状态时态、CHANGELOG/版本/许可计数和改名路径核验。

- 不做：不全局换号、不把历史测试改成新测试、不因 PR 合入直接关闭事项、不发布版本。
- 验收：[Q04 专项](../validation/foundation.md#q04)。
- 回退：文档独立提交可回退，稳定链接/历史编号保留。

## P01

固定现有 DSH 服务名/inject/ready/dispose、jobs owner/配额/wait、错误/能力版本；盘点依赖闭包和补丁；保留输出与冻结护栏；候选迁移单独评估。

- 不做：基线探针不顺带升级；不替换业务、不建市场/沙箱，不将追新版本作为统一前置。
- 验收：[P01 专项](../validation/foundation.md#p01)，并通过 [V01](../validation.md#v01)。
- 回退：保留旧 pin/装配/构建路径；独立提交撤回契约接线，不动数据。

## P02

source 产物/快照模式与 accepted-translation 分开；通用 IR 版本、旧读兼容、资源身份/地址边界。

- 不做：不重算旧 fingerprint、不跨引擎迁移修订、不建完整项目/词库。
- 验收：[P02 专项](../validation/foundation.md#p02)，并通过 [V02](../validation.md#v02) / [V05](../validation.md#v05)。
- 回退：写入新 schema 前备份；未知 schema 拒绝写；已升级库回滚用完整备份，禁止旧程序强读。

## P03

format/adapterId 分离；移出 Records 导入；输入类型、排队、可读投影与输出返回契约。

- 不做：不换默认引擎、不移除适用性/来源私有校验、不自行解析 BabelDOC 内部格式。
- 验收：[P03 专项](../validation/foundation.md#p03)，并通过 [V02](../validation.md#v02)。
- 回退：旧 adapter 映射保留在兼容层；禁用新注册路径，旧快照按旧 binding 读。

定向阅读：[解析/翻译/输出契约](../../../requirements/0.1.x/contracts.md#解析翻译输出三份独立契约)、[来源兼容矩阵](../migration-distribution.md#兼容矩阵)与 V02。

## P04

注册 operation/schema/handler；旧 facade 委托；可选 CLI/HTTP/MCP 插件及 disposer；业务事件与 ctx.emit/on 边界；入口 ID/资源归属查询统一。区分内部注册与[稳定对外投影](../../../requirements/0.1.x/contracts.md#稳定对外接口与可调用方案)，I01 复用注册和调用边界；P04 不等待全部外部协议交付。

- 不做：不强制更换 HTTP 库、不改所有 UI、不提供未实现的事件重放。
- 验收：[P04 专项](../validation/foundation.md#p04)，并通过 [V03](../validation.md#v03)。
- 回退：保留既有方法名和协议映射；按入口开关回退，不回写历史事件。

## P05

AppBoot/Loader 上的受控包交付薄层：同仓分包、版本/依赖检查、安装事务、禁用/重启恢复；兼容范围定案前复评运行时元组。

- 不做：不拆仓、不建第二加载器/DI、第三方市场、热更新、全插件签名系统；不强制升级 Cordis。
- 验收：[P05 专项](../validation/foundation.md#p05)，并通过 [V04](../validation.md#v04) / [V04a](../validation.md#v04a)。
- 回退：清单/包目录与运行时成套切回上个兼容完整版本；保留运行版本至退出；变更配置先验证旧读或备份恢复。
