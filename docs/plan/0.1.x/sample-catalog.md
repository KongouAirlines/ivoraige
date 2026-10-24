# 0.1.x 最小翻译样本库

对应 [#13](https://github.com/KongouAirlines/ivoraige/issues/13)、[首批验收建议](https://github.com/KongouAirlines/ivoraige/issues/13#issuecomment-6075372633)和[逐样本判据](https://github.com/KongouAirlines/ivoraige/issues/13#issuecomment-6231464197)。这是质量评测、模型比较和回归定位的材料接口，不是术语库或翻译记忆。实现不激活 P01–P10 的目标契约，不改变现有 API、Records/snapshot schema、DSH pin 或运行时配置。

## 本次验收切片

先完成一份清单、可重跑离线集和带人工备注的比较结果。公开部分只有原创合成输入：12 个短文本（10 dev、2 heldout）及 2 个单页原生 PDF（dev）。来源版本、语言方向、格式、用途、外发权限、哈希、审核状态、每例失败条件和可接受差异见 [manifest](../../../evaluation/catalog-0.1.x/manifest.json)，机器规则见 [schema](../../../evaluation/catalog.schema.json)。旧 [M0](../mvp/m0/completion.md) 和 6 个历史控制例保留为历史，不读取或迁移其真实材料。

| 范围 | 判定 |
| --- | --- |
| T01–T12 TXT/Markdown | 导入、按单位写入合成参考修订、MD/JSON 同快照输出、后续编辑与重启后旧快照重放；单位、来源绑定、已接受文本不漂移；保护字段不得丢失 |
| G01 既有 PDF 回归 | 复用 5 个已有 mock 用例：同文不同位置、坏公式占位符拒绝、私有副本修复、旧共享来源与旧快照恢复。失败导致非零退出 |
| P01/P02 实际 PDF 文件 | 文件完整性检查；原页涵盖相邻公式/单位、双栏/重复句/长译文观察位置。真实引擎解析、重建和最终 PDF 展示在报告中为 `not-run` |
| 译文质量 | 全部 `not-reviewed`。参考由 agent 编写，`agent-authored-pending-human`，reviewer=null；T09 故意长译文仅测保存，不充当忠实翻译答案 |

自动检查不比较不同格式的整文件字节。只要求**同一格式的同一冻结快照**在编辑/重启前后字节不变。跨独立运行的比较用 MD 去快照头、JSON 单位文本序列的摘要，避免随机 ID 引起伪差异。数字、单位、公式和术语的真实语义判断仍需人工，不能把此测试通过当作真实模型质量分数。

## 重跑与对比

按[开发指南](../0.1.0/development-guide.md)安装受支持 Node、锁定依赖并构建。以下命令不联网调用模型；不加载用户模型设置或凭据。输出目录必须不存在，父目录须已存在：

```sh
npm run build
mkdir -p evaluation/runs
npm run evaluate:samples -- run --out evaluation/runs/samples-0.1.x-a
npm run evaluate:samples -- run --out evaluation/runs/samples-0.1.x-b
npm run evaluate:samples -- compare --baseline evaluation/runs/samples-0.1.x-a/report.json --candidate evaluation/runs/samples-0.1.x-b/report.json --out evaluation/runs/comparison-0.1.x.json
npm run evaluate:samples -- run --split heldout --out evaluation/runs/heldout-0.1.x-a
```

默认只读取 dev 内容/参考；heldout 必须显式选取，输出分开，比较不同 split 会拒绝。工程留出样本已公开且由开发者可见，**不声称是盲测质量基准**。私有留出参考同样不能进入提示词、检索、TM 或自动建库；本工具仅在离线 seed/replay 内使用它们。没有实现任何在线执行器，`--mode external` 总是拒绝，即使清单写了 allowed。

每次 `report.json` 记录项目 commit、dirty 标志、Node/OS、锁文件摘要、依赖声明、DSH SHA、样本/参考摘要、文档与快照 ID、文件与语义摘要、具体检查、运行内输出路径；`report.md` 便于阅读，`regressions.tap` 保留 5 个 mock 回归结果。模型、提示词、参数为 null，文本回放调用数 0（模型服务缺席）；G01 坏占位符负例会调用本地无网络的无效输出 stub，stub 次数未汇总，真实提供商调用仍为 0，usage/费用为 null；它们不是零 token 的模型响应。只有全部要求的结构检查通过才返回 0；PDF/质量未测项保留为未测，不计入通过数。

比较结果保留 added/removed/input-changed/output-changed/regression/status-changed/unchanged 行以及两个 manifest/commit。删除或结构回归返回非零；输入/参考变化需人工审查，不能据此直接认定代码提升。比较不覆盖旧记录、不自动接受新基线。人工先在运行/比较的 `humanReview` 填写位置、类型、严重程度、理由、修正与 reviewer，再在 `baselineApproval` 记录确认人和理由；保存原比较文件及确认副本，提交通常代码审查。无人确认时保留 pending-human。未来真实模型评测沿用[人工记录模板](../../../evaluation/review-template.md)记录提供商/精确模型、提示与参数、上下文/术语版本及实际 usage，并逐项评审；此 PR 不执行该路径。

## 独立长期私有材料

私有库作为**主仓库外**的目录或独立私有 checkout 接入，不是主仓库子模块。入口只接 `--catalog <root>`（内含 manifest.json、相对 inputs/、references/、许可依据）；不扫描旧 `evaluation/private/`，不自动创建远端或修改权限。可先在仓库外创建空骨架：

```sh
npm run evaluate:samples -- init --root /absolute/outside-project/private-catalog-0.1.x
npm run evaluate:samples -- run --catalog /absolute/outside-project/private-catalog-0.1.x --out /absolute/outside-project/private-run-0.1.x
```

`init` 只创建新目录、空 private manifest、README 与运行输出/凭据忽略规则。按 schema 添加样本：稳定 ID、dev/heldout、独立格式与内容类别、双语方向、作者/原始链接/获取日期/版本、licenseEvidence 相对文件、allowedUses、externalModel、原件/参考 SHA-256、校验状态和 reviewer。pending 权利材料用 `kind=permission-pending`；没有 offline-regression 用途或 blocked 状态会在读任何样本内容前拒绝。人工签认必须对应实际人员，不能由工具推定。

路径只能指向 catalog 根以内的实际文件，拒绝绝对路径、`..` 与越界符号链接；ID 不重复、同一源摘要不能跨 split；原件和参考读后验摘要。private 输出与比较文件禁止进入主仓库。原文、参考、SQLite 和导出文件都可能包含私有数据，整份运行目录仅供有权限的本地评审，不能上传 CI 日志或产物。异常控制台仅输出错误码，不输出原文。此入口不是针对恶意本机文件系统并发改写的安全沙箱。

普通 CI 仅运行提交的合成夹具。完整私有仓库若要建立/共享，仍需明确仓库 owner/name、长期 private 设置及每位协作者的最小权限；本切片不需要这些批准即可独立工作。

## PDF 维护与剩余范围

两份 PDF 由 [生成脚本](../../../scripts/evaluation-pdfs.py)本地生成，reportlab 是可选开发依赖，不加入运行时。使用 `invariant=1` 固定元数据；变更脚本后重生成、更新 manifest 哈希并逐页渲染检查。默认离线测试不要求安装 Python/PDF 引擎。

OCR、多语种扩展、真实专业译文人工评审、完整文档、原生 BabelDOC 对这两份 PDF 的解析/重建和严格权限隔离的私有 CI 不在本切片。保留 [PDF 验证](validation/pdf.md)和[跨工作包质量判据](validation/cross-cutting.md)；运行证据见[本次记录](evidence/sample-catalog.md)。
