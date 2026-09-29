# M2 原创文本示例

`scientific-en.txt` 和 `scientific-zh.txt` 是工程控制文本，不是质量评估参考答案。先执行 `npm run build`；真实端点和模型名在 `model.local.json` 中由使用者替换。只运行 `translate`／`build` 时加载模型；其他命令只需 `--store`。

示例的 `LM_API_TOKEN` 是凭据环境变量引用，配置中不保存令牌。需要该变量可在启动 CLI 的进程环境中提供；CLI 不读取 `.env`。无认证的 loopback 端点可删除 `apiKeyEnv` 字段。远程端点须显式 `network:true` 并配置对应引用，例如 `DeepSeek_API_TOKEN`；网络关闭时不会转用远程服务。`terms:false` 和 `builder:false` 可关闭相应能力；纯翻译不要求先建库，明确选择不可用能力时会报错。

```powershell
node src/cli.mjs import examples/scientific-en.txt --store evaluation/runs/m2/manual/store --id sample --title "原创磁学小样"
node src/cli.mjs terms create magnetism --store evaluation/runs/m2/manual/store
node src/cli.mjs terms add magnetism examples/term-entry.json --store evaluation/runs/m2/manual/store
node src/cli.mjs terms list magnetism --store evaluation/runs/m2/manual/store
```

将上一条输出的术语 ID 用在 `terms confirm magnetism <entry-id>`，然后运行 `libraries sample magnetism`。候选条目必须显式确认才进入正文约束。

```powershell
node src/cli.mjs translate sample --config examples/model.local.json
node src/cli.mjs show sample --store evaluation/runs/m2/manual/store
```

按输出的单位 ID 和草稿修订 ID，逐条 `confirm sample <unit-id> <revision-id> --store ...`。人工修改使用 `edit sample <unit-id> <revision-id> <translation-file> --store ...`。确认完成后：

```powershell
node src/cli.mjs export sample --store evaluation/runs/m2/manual/store --md evaluation/runs/m2/manual/sample.md --json evaluation/runs/m2/manual/sample.json
node src/cli.mjs translate sample --config examples/model.local.json
```

第二次翻译应返回 reused 且调用增量为零。更改源文、目标或所选词库后先 `check` 查看适用性；导出只读取当前适用的已接受修订，不自动复核或翻译。中译英导入时使用 `--source zh --target en`。可选审校须在 model.roles 中显式配置 review，然后使用 `translate --review`。运行中 Ctrl-C 取消在途请求并停止后续单位派发；未完成任务不在重启后自动恢复。

## 可选 DeepSeek 配置

`model.deepseek.json` 使用用户指定的 `DeepSeek_API_TOKEN` 引用，显式开启联网。端点与 `deepseek-flash` 名称依据 2026-09-29 查阅的[官方接入说明](https://api-docs.deepseek.com/guides/harness)；本轮没有执行该远程配置，实际兼容性与用量另行验证。只有在命令中显式选择这份配置时才使用，不作为本地失败后的自动兜底。

Windows 已运行的终端尚未继承新用户变量时，可以在运行命令的同一个 PowerShell 窗口加载指定变量，不要打印变量值：

```powershell
$env:LM_API_TOKEN = [Environment]::GetEnvironmentVariable('LM_API_TOKEN', 'User')
# 仅准备使用远程配置时：
$env:DeepSeek_API_TOKEN = [Environment]::GetEnvironmentVariable('DeepSeek_API_TOKEN', 'User')
```
