# sidecar 错误响应与 stderr 诊断的关联顺序

- ID: pdf-sidecar-stderr-diagnostic-order
- 状态: 待评估
- 实施分支／PR: 未安排；发现记录随 codex/0.1.x-operation-entries / PR #52
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
