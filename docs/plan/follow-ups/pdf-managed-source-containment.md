# PDF 受管理原件的路径边界

- ID: pdf-managed-source-containment
- 状态: 处理中
- 实施分支／PR: codex/0.1.0-pdf-source-ownership；[PR #10](https://github.com/KongouAirlines/ivaraige/pull/10)
- 类型: 改进
- 发现依据: 2026-10-08，审阅 [PDF PR #7](https://github.com/KongouAirlines/ivaraige/pull/7) 后检查本地 `src/adapters/pdf.mjs` 的 `verifySource()`／`rebuild()` 与 `sidecars/babeldoc/server.py` 的来源读取；以下为代码路径观察，未做篡改 SQLite 的运行探针。
- 目标分支: main

## 问题与影响

正常导入会把 `sourceBinding.sourcePath` 设为数据库旁 `pdf/sources/<digest>.pdf`。冻结导出随后直接使用记录中的绝对 `sourcePath`：内核 `verifySource()` 检查文件元数据与 SHA-256，但不检查该路径是否仍位于受管理 `sources` 根目录；sidecar 用 `Path(sourcePath).resolve(strict=True)` 读取，也未检查受管理根。若持久绑定被本地数据库修改或将来出现其他绑定写入入口，且外部文件内容与 `sourceDigest` 相同，PDF 重建可从受管理目录外读取。哈希校验能发现内容不符，不能证明路径归属。目前公开导入入口覆盖 sidecar 返回的路径，未见远程请求直接写入此字段的路径，因此不把它称为已证实的远程任意文件读取漏洞。

## 处理条件与范围

PR #9 只改设置，不修改 PDF 生产实现。重新评估触发条件：支持数据库迁移、导入外部绑定、备份恢复，或明确把持久数据库视为不可信输入。与 [PDF 数据库与受管理原件迁移](pdf-store-relocation.md) 协调路径格式，但分别验收边界校验和迁移行为。开始前核对现有 PDF 实现分支／PR 与安全信任边界。

## 验收条件

- 导出前确认来源真实路径属于当前受管理根，拒绝外部路径及指向外部的符号链接；继续校验内容摘要。
- 旧记录与合法受管理副本继续可重放；边界失败给出明确错误，不调用模型。
- 在支持的平台上覆盖正常路径、目录外路径和符号链接或等价重解析情况。

## 处理记录

- 2026-10-11：按用户要求，PR #10 的相对配置目录及硬编码 `pdf` 目录名两条审阅意见转入堆栈 PR #12；构造时统一绝对路径，保存路径的父目录名与配置目录一致，保留当前根内的 realpath／摘要检查。待合入 main；校验与打开之间的竞态另登记 [pdf-source-open-race](pdf-source-open-race.md)，不在本轮扩大实现。

- 2026-10-08：PR #9 审阅时登记路径归属缺少校验的静态证据；未改动 PDF 生产实现，未声称存在公开 API 的直接利用路径。
- 2026-10-08：当前实施分支导出只接受摘要格式匹配的受管理文件名，在当前 store 的 `pdf/sources/` 解析有效路径，并校验真实路径与摘要。Windows 定向测试拒绝伪造外部路径及指向目录外的 junction；待合入和其余平台验证。
