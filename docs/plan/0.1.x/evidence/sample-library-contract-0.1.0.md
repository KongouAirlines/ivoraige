# 0.1.0：样本库冻结导出衔接

2026-11-09，ivoraige main 基线 `6a5e1df20437c6c3c2cfa9c10aeff17ad4724d94`，样本库 PR #13 代码 `0473e60da9040684b1d49035048d13a05e803091`。关联 [#13](https://github.com/KongouAirlines/ivoraige/issues/13)，接口与操作见[样本库分工](../sample-library.md#冻结导出库存的跨仓库-smoke)。

## 实现

新增 `scripts/smoke-sample-library.mjs`。在新目录内创建真实 SQLite 存储，导入原创 Markdown 的标题、正文与代码块；人工接受标题的 zh-CN 修订，正文显式 skip，代码按原文保留。通过真实任务分别冻结导出原文／译文 JSON，重启内核后重放同一快照，逐字节比较两份结果，然后调用指定样本库的离线检查命令。内核未配置 LLM，四次导出的 `llmCalls` 均为 0。

脚本拒绝既有输出目录，保留失败诊断，外部命令失败不创建合并成功摘要。外部进程使用参数数组、禁用 shell，有 30 秒超时和输出上限。无自动私库拉取、安装、模型调用或 observations 接口。样本库仍独立维护输入校验和库存判断，本仓库不复制其实现。

## 已运行

- Linux、Node 24.22.1、Python 3.12.14。
- 改动前的 main 完整 `npm test`（含构建）：561 通过、2 条件跳过、0 失败。
- 新增定向测试：5/5。覆盖真实记录和重启、既有目录不覆盖、外部解释器缺失时无成功摘要、参数校验、嵌套源码不冒用上级仓库身份。
- 最终代码完整 `npm test`（含构建）：566 通过、2 条件跳过、0 失败；隔离 npm 包 smoke 通过，归档 83 文件。首次包 smoke 因当前环境默认 npm cache 目录不可写而中止；改用显式可写临时 cache 后原命令通过，未修改测试或产品逻辑。
- 跨仓库命令实际退出 0，3 个单位对应 1 个 revision、1 个 skip、1 个 keepOriginal；8 项库存检查通过，原文及译文冻结重放字节一致。

此次云端无法用 Git 认证克隆私库，因此经已授权 GitHub 连接读取该固定提交的 `src/samplelib` Python 模块，在忽略的本地目录运行。未复制语料或依赖私库目录数据。无 Git 元数据的这份源码在摘要中正确记录为 `commit: null`；上述固定来源由读取记录确定，不能把它描述为完整私库检出或完整样本库测试。

## 验证范围

输入是原创合成 Markdown。没有真实 PDF、OCR、MinerU、外部模型、人工语义评价或视觉验收。samplelib 的 `model_calls: not_observed` 只表示工具未观察模型；内核的零调用证据独立来自未装 LLM 与任务统计。`explicit_skips: true` 保留在成功库存报告中，不能报告为全文翻译完成。

本次推进跨仓库冻结导出衔接，不关闭长期 #13。真实材料仍需固定哈希、版本、使用许可、引擎/语言路线和逐阶段结果；完整语料目录的语言预期没有改写。样本库 PR #13 的代码审查与合并状态由其 PR 记录，本地 smoke 不替代审查或集成。

## 2026-11-09 外部审查修正验证

此前只靠 `PYTHONPATH` 选择样本库入口，可能误用其他目录或全局安装的同名包；Git 命令失败和正常未知来源均只记为 `null`；外部失败的标准输出、错误输出和信号未保留。修正后的调用以 Python `-I` 启动，核对实际 `samplelib` 包及 `samplelib.cli` 文件均来自给定根目录的 `src/samplelib`，成功摘要记录模块文件。Git 标记区分 `git`、正常 `unknown` 与执行 `error`，外部执行的退出码、信号、错误及有限大小的两路输出留在运行目录，失败仍不创建 `summary.json`。样本库源码与语料均未复制进本仓库。

本地定向测试 9/9：除原有冻结重放及失败路径，还覆盖真实临时 Git 仓库的干净/有改动状态、非仓库、嵌套提取目录、注入的 Git 启动失败及超时、带冲突 `PYTHONPATH` 的指定 CLI 成功、错误根目录拒绝借用其他包，以及外部 CLI 失败的退出码和两路输出。最终完整 `npm test`（含构建）570 通过、2 条件跳过、0 失败；运行环境为 Linux、Node 24.22.1、Python 3.12.14。

使用已有的忽略目录 `evaluation/runs/first-tier-0.1.x/samplelib-source-0473e60`（只含已读取固定提交的模块，无语料）执行真实 `ivoraige-exports`，最终新输出目录 `evaluation/runs/first-tier-0.1.x/frozen-contract-dsh-fix-2-0.1.x`。运行退出 0，冻结导出库存及逐字节重放通过。模块记录指向所给源码的 `src/samplelib/cli.py`；由于它是 ivoraige 仓库下的材料化目录而非自身 Git 根目录，Git 归属为 `unknown: nested_source_tree`，不能将父仓库提交归给样本库。运行时 ivoraige 工作区有本次未提交改动，因此其 Git 标记为有改动。这些结果不扩大上节所述合成输入、质量及完整私库测试的验证范围。

### 后续审查修正

脚本直连入口改用原生真实路径比较，避免软链接或 Windows 路径别名使程序静默退出。Git 元数据调用只从子进程环境移除可覆盖仓库、HEAD 或索引来源的 `GIT_*` 变量，不改调用者环境。`ivoraige` 和 `samplelib` Git 状态在创建运行目录前采集，成功摘要另记执行后的 `samplelibAfter`；这两个时点不是源码文件哈希或执行全程不变的证明。临时 Git 测试仓库隔离全局配置和模板，提交禁用签名与钩子。缺少 Python 3.9+ 时，普通 `npm test` 条件跳过外部合成 CLI 测试；显式运行脚本仍失败并留下诊断。

Linux、Node 24.22.1、Python 3.12.14 下，定向测试 11/11，完整 `npm test`（含构建）572 通过、2 条件跳过、0 失败。用同一份仅含源码的忽略目录执行真实 `ivoraige-exports`，最终新输出为 `evaluation/runs/first-tier-0.1.x/frozen-contract-dsh-fix-4-0.1.x`，退出 0，库存及冻结重放通过；包与 CLI 路径仍绑定所给源码，前后 Git 归属均为 `unknown: nested_source_tree`。本地结果不能替代修改后 Windows/macOS CI 的再次运行，也不扩大合成材料的质量结论。

再次复核发现外部 CLI 测试只查找 `python`，在只有 `python3` 的环境会误跳过；Git 元数据子进程继承 `GIT_CONFIG_GLOBAL`/`GIT_CONFIG_SYSTEM` 时，全局 `core.excludesFile` 可使真实未跟踪文件被误记为干净。新增回归模拟 `python` 不合格而 `python3` 合格，并在临时真实仓库注入系统/全局排除规则，仍要求记录未跟踪变更。元数据调用现在隔离系统/全局配置，保留仓库本地配置；不改用户配置，Git 状态仍只是采样元数据而非源码哈希。

Linux、Node 24.22.1、Python 3.12.14 下，定向测试 12/12；显式离线 `npm test`（含构建）573 通过、2 条件跳过、0 失败。相同材料化源码的新合成 smoke 输出在 `evaluation/runs/first-tier-0.1.x/frozen-contract-dsh-fix-5-0.1.x`，退出 0，内核与 samplelib 冻结重放通过；实际包和 CLI 路径仍来自给定源码，前后 Git 归属均为 `unknown: nested_source_tree`。此本地结果不替代 Windows/macOS CI，也不扩大到私有语料或翻译质量验证。
