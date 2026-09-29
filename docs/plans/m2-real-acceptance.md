# M2 真实业务验收

日期：2026-09-29｜结论：**真实模型、术语、代理审阅修订和持久复用闭环通过；自动科学质量未全部通过，用户专业签认未完成。**

本次沿用 [M2 已实现服务](m2-completion-report.md)，没有另写翻译旁路或使用假模型回答。选 `m0-corpus-002` 开发集 R01-001／003／004、R02-D03／D05／D06 六单位，加两段原创中译英控制文本，共 8 个独立单单位文档、3232 个源字符。每单位没有邻段语境；不读取留出参考，也不把开发参考译文放进生成或建库。专业评审先根据源文判断，之后仅读对应六个开发参考进行对照，参考本身的问题另列。

用户明确授权本轮互联网来源测试集（含少量二次加工、不含个人或风险信息）发送至模型服务，并认可少量原创中译英、DeepSeek 建库／审校与本地正文组合。该授权限本次选样及其必要草稿、术语上下文，不扩大为整书或其他私有材料。只在内存读取 `LM_API_TOKEN`、`DeepSeek_API_TOKEN` 两个指定 User 变量；没有输出、保存或提交值。

## 实际模型与调用

正文使用已有 LM Studio `hy-mt2-1.8b`，地址 `http://127.0.0.1:1234/v1`；建库与审校使用官方 `https://api.deepseek.com` 的 `deepseek-flash`。模型名经实际 `/models` 查询和 [DeepSeek 官方文档](https://api-docs.deepseek.com/guides/harness)核对。调用由真实 DSH llm／pi-ai 服务完成；DeepSeek 禁推理通过 DSH `reasoningEfforts: {off:null,low:"low"}` 与 `compat.thinkingFormat:"deepseek"` 配置传递，不修改厂商 SDK。

| 阶段 | 本地正文请求 | DeepSeek 生成请求 | 结果 |
|---|---:|---:|---|
| 无词库基线 | 8 | 0 | 8 草稿 |
| 候选建库 | 0 | 2 | 首次字段类型不符合约定；明确 JSON 字段类型后重试，12 候选成功 |
| 代理核候选并组合共享／项目库 | 0 | 0 | 12 候选精确引文核对并显式代理确认；4 项目义项为代理手工补充，不冒称模型自动候选 |
| 带词库正文 | 8 | 0 | 8 草稿，实际选用的义项／库引用保存在 basis |
| 可选审校 | 0 | 8 | 8 新草稿，未自动接受 |
| 明确接受、5 单位代理人工修订及双出口 | 0 | 0 | 全部 8 单位持久保存和导出 |
| 无关术语更新 | 0 | 0 | 全部 8 单位复核后 reused |
| 相关术语更新 | 1 | 0 | 仅 R01-004 新草稿，其他 7 单位复用 |
| 新草稿代理修订、接受、重导出和再次运行 | 0 | 0 | 全部 8 单位 reused，双出口一致 |
| **合计** | **17** | **10** | 无其他模型下载、排行榜或额外远程扩样 |

模型目录只读查询不计入生成调用；配置前置失败和审批拒绝没有产生请求，不计入模型调用。所有调用用量仍记 `unknown/null`：SDK 归一化不能证明 provider usage 原始存在，不能据此计算费用。第一次建库字段类型失败的原始回答在旧错误路径中未保留；其调用与错误由执行记录证明。本轮已修复失败输出保留与分次调用日志，后续 schema 失败可定位，不把不合格候选写为已确认项。

## 科学质量：保留原始结果与修订区别

独立 Sol 代理检查含义、限定词、数量、符号和术语，未用字符串命中或模型自评分代替判断。下表是这个小样的必要修订判断，不是总体准确率：

| 单位 | HY 无词库 | HY 带词库 | DeepSeek 审校后 | 最终动作 |
|---|---|---|---|---|
| R01-001 | 漏垂直入射；速度选择的计数定义及角度边界不清 | 入射、计数改善，边界仍错误／不清 | 将观测截止误表达为极轴 20° 内区域 | 代理修订截止边界和坐标措辞 |
| R01-003 | 电子束成光束；漏反序；再经过 60°关系错误 | 词库修复电子束，仍漏反序和几何关系 | 恢复反序，但方位中点与纬度混联、法线被写成射线 | 代理修订几何关系及指代 |
| R01-004 | 两处余纬误为纬度 | 余纬修复，科学含义可保留 | 度数符号恢复，科学含义可保留 | 代理整理靶平面／电压／探测措辞；作为手工接受保护控制 |
| R02-D03 | 外部场误为外部区域 | 外部场修复，但 M 定义新增丢失“平均” | “平均”仍缺失 | 代理补回定义的限定 |
| R02-D05 | H′ 命名主语混淆 | 同样问题 | 同样问题 | 代理区分作者记 H′与使用者仍称 H |
| R02-D06 | 数量与量纲可保留 | 可保留 | 可保留 | 明确代理接受审校修订 |
| ZH-01 | 磁化强度错成 magnetic intensity | 反向词库修为 magnetization | 可保留 | 明确代理接受审校修订 |
| ZH-02 | 不确定性、否定、α=0.01 可保留 | 可保留 | 可保留 | 明确代理接受审校修订 |

必要修订单位从 **6/8 → 4/8 → 4/8**；词库和审校修复了不同问题，也出现了新的限定遗漏，不能写成全面质量提升。最终 5 单位代理手工修订（4 项必要修复、1 项措辞整理），3 单位直接接受审校草稿。后续术语变化生成的 R01-004 草稿又漏掉 `always`，独立代理补回“总能”并接受。最终修订均记录 `agent-engineering-review`，不冒充用户人工签认或自动模型全过。

开发参考存在措辞歧义和忠实度问题：R01-001 边界／计数定义不清，R02-D05 弱化 Most 并添加源文没有的时态／编号。评审以选定源文为准，没有照抄参考作为标准答案。仍建议用户专业复核 R01 坐标几何与晶面族，以及 R02 原书 H／H′约定；本轮未扩大为 M0 全量或留出质量验收。

## 真实复用与修改保护

- 同义项共享“threefold symmetry”与项目精确约定发生冲突，R01-003 实际选择项目条目并保存 `project-priority` 依据。义项、来源和共享／项目身份可从私有记录查看。
- 添加无关条目后直接导出先拒绝旧核对版本；重新核对的 8 单位全部 reused，没有生成请求。
- 项目 `co-latitude` 从“余纬”改为“余纬角”，直接导出仍拒绝需检查状态；仅 R01-004 受影响并产生 1 本地请求，其余 7 单位零请求沿用。
- R01-004 原代理手工接受修订在新草稿到来时仍为 accepted，acceptedId 没有被覆盖；只有独立评审后才明确接受新修订。
- 模型未加载时完成全部 8 单位的适用性检查与 Markdown／JSON 重导出，单位、修订 ID 与译文一致。随后用真实 task 再运行全部 8 单位，每单位 `calls:0`、状态 reused。

## 复跑与用户审阅入口

轻量脚本：[scripts/m2-acceptance.mjs](../../scripts/m2-acceptance.mjs)。模型／端点示例：[model.hy-deepseek.json](../../examples/model.hy-deepseek.json)。运行数据在忽略目录 `evaluation/runs/m2-acceptance/`；脚本固定六 dev 白名单，只拷贝源文与定位，生成步骤不载入参考。

```powershell
node scripts/m2-acceptance.mjs prepare
node scripts/m2-acceptance.mjs baseline
node scripts/m2-acceptance.mjs build
# 独立检查 candidates.json，显式填写 term-decisions.json
node scripts/m2-acceptance.mjs confirm-terms
node scripts/m2-acceptance.mjs terms
node scripts/m2-acceptance.mjs review
# 独立检查草稿，显式填写 quality-decisions.json
node scripts/m2-acceptance.mjs finalize
node scripts/m2-acceptance.mjs changed
# 只复核 affected 单位，填写 changed-decision.json
node scripts/m2-acceptance.mjs finalize-changed
node scripts/m2-acceptance.mjs reuse
node scripts/m2-acceptance.mjs terms
node scripts/m2-acceptance.mjs comparison
```

需要模型的步骤应在继承指定凭据变量的进程运行。脚本不会自动填决策文件：候选与草稿不会自动确认。已有建库结果会拒绝重复付费建库，已有未接受草稿／审校会跳过重复请求；当前已接受样本再执行 terms 是零调用。changed 完整证据存在时沿用，不再次重翻。若主动重新验收新样本，应先使用新的运行目录或明确管理已有记录；不要把旧决策文件静默应用到新源文。

用户可直接查看本机私有对照与证据：

- `evaluation/runs/m2-acceptance/comparison.md`／`comparison.json`：8 条源文、无词库／带词库／审校／最终修订并排分段，包含来源和明确修订 ID。
- `quality-review.md`／`quality-review.json`：逐单位 source-first 判断、参考疑点、修订原因和后续专业问题。
- `confirmed-libraries.json`、`change-evidence.json`、`changed-outputs.json`：真实库引用、变更时原接受保护与 7 单位沿用证据。
- `terms-result.json`、`reuse-result.json`、`exports/`：最终重跑零调用和同源 Markdown／JSON。
- `*-calls.json`／`*-attempts.json`：实际角色、模型、结束、未知用量和耗时；不含密钥。

本轮代码修复的建库类型／出处前置校验和 DSH 禁推理配置由新增针对性测试覆盖：两项受影响检查通过；既有工程验证沿用，不因追加质量评审重跑无关实验。M3 PDF 工作没有提前开始。
