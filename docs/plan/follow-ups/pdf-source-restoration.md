# PDF 受管理原件重新导入恢复

- ID: pdf-source-restoration
- 状态: 处理中
- 实施分支／PR: codex/0.1.0-pdf-source-ownership；[PR #10](https://github.com/KongouAirlines/ivaraige/pull/10)
- 类型: 缺陷
- 发现依据: 2026-10-08，[Issue #11](https://github.com/KongouAirlines/ivaraige/issues/11) 与 PR #10 的 `4789fcc`：损坏的受管理副本使正确原件重导入失败；升级后旧 digest-only 来源缺失时，新导入路径不能恢复旧快照。
- 目标分支: main

## 问题与影响

同一 store 的受管理原件损坏后，重导入会解析原始 PDF，但发布阶段仍校验旧副本并失败。旧版 digest-only 冻结绑定在共享原件缺失或损坏时也无法重放。任务不应因此改写冻结绑定或共享旧文件。

## 处理条件与范围

在 store 所属目录内验证重新导入字节并原子替换损坏的私有副本。冻结导出从当前 store 的私有副本解析有效本地来源；兼容旧版 digest-only 路径，保留原绑定及共享旧文件。导出不调用模型。

## 验收条件

- 私有副本缺失或损坏后，正确原件重导入可恢复，冻结绑定不变，重启后 PDF 可导出。
- 并发重导入保持单一正确副本；不同内容不能误修原件。
- 旧版 digest-only 绑定在共享文件损坏后可由私有副本重放，旧文件字节不变。
- Windows、Linux、macOS 的相关测试及打包路径按阶段验证。

## 处理记录

- 2026-10-08：`codex/0.1.0-pdf-source-ownership` 实施修复与回归测试；Windows 定向测试通过，待合入和其余平台验证。
