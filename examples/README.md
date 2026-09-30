# CLI 使用示例（M4）

`scientific-en.txt` 和 `scientific-zh.txt` 是工程控制文本，不是质量评估参考答案。先执行 `npm run build`；真实端点和模型名在 `model.local.json` 中由使用者替换。只运行 `translate`／`build` 时加载模型；其他命令只需 `--store` 或含 `store` 的配置。

`model.local.json` 的 `defaults` 可复用文本导入方向、默认术语库 ID 和导出路径；命令行 `--source`、`--target`、`--md`、`--json` 优先。导入默认值不作用于 `import-pdf`。默认词库须先创建，且只用于新导入，已有文档用 `libraries <document> <library-id>...` 调整。导出路径在配置中是具体文件名，同一配置处理多个文档时请用命令行覆盖。无需模型即可执行 `list` 查看文档摘要、`status <document>` 查看各单位草稿、采纳和导出状态。

示例的 `LM_API_TOKEN` 是凭据环境变量引用，配置中不保存令牌。需要该变量可在启动 CLI 的进程环境中提供；CLI 不读取 `.env`。无认证的 loopback 端点可删除 `apiKeyEnv` 字段。远程端点须显式 `network:true` 并配置对应引用，例如 `DeepSeek_API_TOKEN`；网络关闭时不会转用远程服务。`terms:false` 和 `builder:false` 可关闭相应能力；纯翻译不要求先建库，明确选择不可用能力时会报错。

```powershell
node src/cli.mjs import examples/scientific-en.txt --config examples/model.local.json --id sample --title "原创磁学小样"
node src/cli.mjs terms create magnetism --store evaluation/runs/m2/manual/store
node src/cli.mjs terms add magnetism examples/term-entry.json --store evaluation/runs/m2/manual/store
node src/cli.mjs terms list magnetism --store evaluation/runs/m2/manual/store
```

将上一条输出的术语 ID 用在 `terms confirm magnetism <entry-id>`，然后运行 `libraries sample magnetism`。候选条目必须显式确认才进入正文约束。

```powershell
node src/cli.mjs translate sample --config examples/model.local.json
node src/cli.mjs status sample --config examples/model.local.json
```

可对当前没有已采纳译文的单位执行 `accept-drafts sample --config examples/model.local.json`，批量采纳当前适用草稿。该命令是用户显式选定，并不表示人工逐条审阅或自动质量合格；它会报告跳过的单位。已有采纳译文（包括变更后已过期的译文）不会被批量替换。逐条处理时按 `show` 输出的单位 ID 和草稿修订 ID 运行 `confirm sample <unit-id> <revision-id> --store ...`；人工修改使用 `edit sample <unit-id> <revision-id> <translation-file> --store ...`。确认完成后：

```powershell
node src/cli.mjs export sample --config examples/model.local.json
node src/cli.mjs translate sample --config examples/model.local.json
```

同一 ID、同一内容的重复导入复用现有文档。第二次翻译应返回 reused 且调用增量为零。更改源文、目标或所选词库后先 `check` 查看适用性；导出只读取当前适用的已接受修订，不自动复核或翻译。中译英导入时使用 `--source zh --target en`。可选审校须在 model.roles 中显式配置 review，然后使用 `translate --review`。运行中 Ctrl-C 取消在途请求并停止后续单位派发；未完成任务不在重启后自动恢复。

`model.hy-deepseek.json` 展示已实际验证的角色组合：已有本机 HY-MT2 正文，DeepSeek 建库与审校；联网明确开启，DeepSeek 采用官方 `deepseek-flash` 端点，禁推理通过 DSH 的 `reasoningEfforts`／`compat` 配置传递。配置仅保存凭据变量名，不保存值。审校会产生草稿，仍须显式确认。该配置涉及远程请求，使用前应确认输入在已授权的发送范围内。

## 可选 DeepSeek 配置

`model.deepseek.json` 使用用户指定的 `DeepSeek_API_TOKEN` 引用，显式开启联网。端点与 `deepseek-flash` 名称依据 2026-09-29 查阅的[官方接入说明](https://api-docs.deepseek.com/guides/harness)；本轮没有执行该远程配置，实际兼容性与用量另行验证。只有在命令中显式选择这份配置时才使用，不作为本地失败后的自动兜底。

Windows 已运行的终端尚未继承新用户变量时，可以在运行命令的同一个 PowerShell 窗口加载指定变量，不要打印变量值：

```powershell
$env:LM_API_TOKEN = [Environment]::GetEnvironmentVariable('LM_API_TOKEN', 'User')
# 仅准备使用远程配置时：
$env:DeepSeek_API_TOKEN = [Environment]::GetEnvironmentVariable('DeepSeek_API_TOKEN', 'User')
```
