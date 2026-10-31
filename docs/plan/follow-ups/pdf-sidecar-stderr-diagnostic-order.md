# sidecar 错误响应与 stderr 诊断的关联顺序

- ID: pdf-sidecar-stderr-diagnostic-order
- 状态: 处理中
- 实施分支／PR: codex/0.1.x-operation-entries / [PR #52](https://github.com/KongouAirlines/ivoraige/pull/52)；本次诊断修复基于 77f8eb35bad076677c8b0838a6d254195bdb68ef
- 类型: 缺陷
- 发现依据: 2026-10-28，PR #52 review 5670662603；源码基线 510f6d703117228b74adc2a7b990e31f76ed87cb
- 目标分支: main

## 问题与影响

`src/sidecar.mjs` 收到 stdout JSON-RPC error 后立即拒绝请求，仅当此前已经收到 stderr 才添加 `error.cause`。Python 即使先向 stderr 写 traceback、再向 stdout 写响应，也不保证 Node 两条管道回调的处理顺序。晚到的诊断留在 session 缓冲中，本次错误的本地 cause 可能缺失；缓冲也没有逐请求关联。公开错误码、消息仍正确，现有测试在常规顺序通过不能证明可靠诊断。

复现：用下列最小 Node sidecar 作为 `SidecarClient({ command: process.execPath, args: [fixturePath] })` 的 fixture，调用 `request('rebuild')`，catch 时读取 `error.cause`，最后 `close()`。该探针模拟 stderr 在响应之后被父进程观察到，不声称 Python 必须以该顺序写入。

```js
import { createInterface } from 'node:readline'
for await (const line of createInterface({ input: process.stdin })) {
  const { id, method } = JSON.parse(line)
  const send = payload => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, ...payload }) + '\n')
  if (method === 'handshake') send({ result: { protocolVersion: 1 } })
  else if (method === 'configure') send({ result: {} })
  else if (method === 'rebuild') {
    send({ error: { code: -32003, message: 'rebuild failed' } })
    setTimeout(() => process.stderr.write('Python traceback: held PDF output\n'), 5)
  } else if (method === 'shutdown') { send({ result: {} }); process.exit(0) }
}
```

Linux Node 24.22.1 实测 `UPSTREAM_FAILURE / rebuild failed / cause: null`。原 sidecar 套件独立运行 14 通过、1 Windows 条件跳过；诊断 fixture 连续 200 次及并发 200 次未复现丢失。上述延迟探针仍可复现，因此不是以压力测试通过否定问题。无法据此还原审阅者每次子进程启动/握手失败的具体环境原因。

## 处理条件与范围

PR #52 当前来源能力检查不改变 sidecar 协议或诊断收集。可靠逐请求关联需要确定私有诊断载体／完成边界；现行 §7 的错误 data 没有该字段，`remoteError()` 会将 data 放入公开 details，不能直接塞入 traceback。任意延时只能改变概率，等待进程关闭会破坏可复用会话，不能作为确定修复。

重新评估条件：诊断可靠性进入实施范围，或再次影响 PDF 错误排查。实现前核对其他分支并明确兼容旧 sidecar 的行为；不修改来源导出语义、不升级运行时、不靠放宽原测试断言掩盖问题。

## 验收条件

- 错误响应先到／诊断先到均能取得属于本请求的本地诊断，不混入上一请求。
- 无诊断的旧 sidecar 仍及时返回；连续请求、取消、崩溃、关闭保持现有生命周期。
- traceback/私有路径不进入公开 RPC、任务或 HTTP/MCP 错误详情。
- 补确定性顺序回归，并验证 Python 实现及相容性；原诊断断言保留。

## 2026-10-28 研判与实施

值得修复：故障码和任务失败状态未错，但 cause 缺失或错配上一请求会直接误导排障。最小修复采用可选本地 `error.diagnostic`，与响应 id 一起传输；不改 data，不增加额外握手、等待或版本升级。旧 sidecar 错误保持及时响应，缺少关联诊断时不再猜测。成功路径无新增等待。异常退出／超时／协议故障只在原有 close/清理等待内收集会话 stderr；取消和主动关闭的错误形状不变。崩溃 stderr 从公开消息移至本地 cause。详见协议 §7。

确定性回归通过显式测试通知控制 stdout/stderr 的前后顺序，晚到 stderr 必须在错误与下一成功请求均结束后才能释放；验证相邻请求不串诊断、旧响应不等待、有界尾部与公开错误封装隔离。崩溃回归暂停 stderr，直到 exit 才恢复，验证 close 后收集及一次重试。超时使用测试时钟触发，取消／关闭检查完整收尾。Python 主循环测试验证相同 id、边界长度、错误 data 和成功返回不变；原诊断断言保留。

Linux / Node 24.22.1：定向 sidecar 套件 17 通过、1 Windows 条件跳过；完整 `npm test` 构建后 508 通过、2 条件跳过、0 失败；Python 3.12.14 协议／引擎边界 mock 测试 15 通过（非发行用 Python 3.13 环境）；真实隔离 tarball 安装／重装 smoke 83 文件通过。真实 BabelDOC 引擎、PDF 质量、Windows 桌面组件重新打包／安装不在这些 fixture 与协议测试的验收范围。待合入 main 后再关闭本跟进。
