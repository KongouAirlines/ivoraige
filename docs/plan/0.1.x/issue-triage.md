# Issue 自动分类与重复初筛

工作流 `.github/workflows/issue-triage.yml` 使用官方 `openai/codex-action`，经 OpenAI Platform API 分析 issue。它是仓库维护工具，不接入 ivoraige 翻译内核，不改变软件、插件或数据协议。

## 行为

- 有仓库写权限的成员新建 issue 时自动分析；其他人的 issue 由维护者手动运行，避免陌生人直接消耗 API 额度。
- 自动分类只使用仓库已有的 `bug`、`enhancement`、`documentation`、`question`，最多补一个。已有此类标签时保留人工选择；不删除标签、不设优先级。
- 从最近两页 issue/PR 列表中筛出最多 100 条 issue，比较标题和截取的正文。仅对同一个具体问题给出最多 5 条重复候选，中文固定模板评论请维护者核实。规划、子任务、依赖和后续扩展不应判作重复。
- 不关闭 issue，不添加 `duplicate`、`invalid`、`wontfix`。同一 issue 已有机器人重复提示时不再发一次。
- issue 在分析期间改写或关闭时跳过写入。候选范围和文本长度有限，未发现候选不代表整个仓库没有重复。

## 配置与操作

1. 在仓库 Settings → Secrets and variables → Actions 添加 Secret `OPENAI_API_KEY`。这是 Platform API 密钥，按 API 账户计费；不要提交密钥到仓库。
2. 工作流合入默认分支后，在 Actions → **Codex issue triage** → **Run workflow** 填 issue 编号。`dry_run` 默认勾选，只在运行 Summary 展示建议，不打标签或评论。
3. 检查建议后，取消勾选 `dry_run` 再运行即可实际应用。自动新建事件直接应用。
4. 可用仓库 Actions Variable `CODEX_TRIAGE_MODEL` 指定账户可用的 Codex 模型；留空沿用 Codex CLI 默认模型。API 权限、模型可用性和余额由 Platform 账户决定。
5. 停用时，在 Actions 中禁用本工作流。删除 API Secret 会使后续分析明确失败，不会退回其他账户或凭据。

每次只启动一次 Codex 分析，分析 job 限时 10 分钟；同一 issue 的运行串行排队。上下文最多含目标正文 8,000 字符、候选各 2,000 字符。限时和输入限制不是硬性金额上限；费用可在 Platform 查看，账户预算/限额也应在 Platform 设置。

## 权限与验证

分析 job 只有 contents/issues 读取权限，Codex 使用 `read-only` 与 `drop-sudo`。写入发生在另一个干净 job，由固定脚本校验 JSON、标签白名单、候选编号和目标快照；模型生成的理由只进入运行 Summary，不直接成为公开评论。checkout 不保存 GitHub 凭据，各 Action 固定到提交 SHA。

相关本地检查：`node --test test/issue-triage.test.mjs`。覆盖非法标签/编号、只预览、保留人工分类、防重复评论、目标被改写/关闭及 PR 排除。真实 API 和 Actions 联调需要 Secret、默认分支安装及实际运行记录；本地测试不证明它们已可用。

参考：[官方 Codex Action 文档](https://learn.chatgpt.com/docs/github-action)、[官方自动分类](https://github.com/openai/codex/blob/main/.github/workflows/issue-labeler.yml)、[官方重复初筛](https://github.com/openai/codex/blob/main/.github/workflows/issue-deduplicator.yml)。
