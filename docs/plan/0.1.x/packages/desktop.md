# 桌面生命周期工作包

[执行索引](../work-packages.md) · [领域契约](../desktop.md) · [验证索引](../validation.md)

## D01

HostSession、TaskCapabilities、shutdown/drain、worker lease/idle-stop/final-dispose、受限本机控制。

- 不做：不选桌面框架、不建平行 jobs、不先放宽 Origin。
- 验收：[D01 专项](../validation/desktop.md#d01)。
- 回退：保留现有 launch/browser；新宿主控制入口可禁用，store 锁仍唯一。

## D02

草稿日志、flush 确认、崩溃恢复和并发修订冲突。

- 不做：不把凭据存进日志、不自动覆盖 accepted、不靠 beforeunload 保证。
- 验收：[D02 专项](../validation/desktop.md#d02)。
- 回退：关闭自动销毁，保留现有窗口/人工保存；旧日志可导出恢复。

## D03

API/session 客户端、分页/必要虚拟化、定向事件失效、不可见订阅停止。

- 不做：不全面重写 UI，不先移除 SSE 另造轮询。
- 验收：[D03 专项](../validation/desktop.md#d03)。
- 回退：按页面回退已有查询逻辑；不回退 P04 的状态来源。

## D04

固定条件记录 host/browser 全进程树资源和故障基线，测量器开销对照。

- 不做：不调用付费模型、不装完整候选框架、不声称预测数据为实测。
- 验收：[D04 专项](../validation/desktop.md#d04)。
- 回退：无产品行为变更；校正测量方法后重测，保留旧原始数据。

## D05

轻托盘、可销毁 UI、两个可行候选对照，按数据选型后单独集成。

- 不做：不带文件管理器右键/自启/服务安装/自动升级/常驻 GPU。
- 验收：[D05 专项](../validation/desktop.md#d05)。
- 回退：桌面壳独立禁用/卸载，继续 CLI/MCP/browser；保留数据及草稿日志。
