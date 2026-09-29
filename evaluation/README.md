# M0 评估材料

本目录是评估准备，不是已经执行的翻译测试结果。M0工程准备已交付，用户反馈已落实为002；见[M0交付报告](../docs/plans/m0-completion-report.md)。

- [M0 范围与验收](../docs/plans/m0-scope-and-evaluation.md)
- [真实材料目录](../docs/research/m0-sample-catalog.md)
- [原创工程控制样本](synthetic-cases.json)：6 个由本项目本次编写的例子，附期望；不是出版译文、人工认证金标准或模型运行结果。
- [评审记录模板](review-template.md)：运行与人工评审后填写。

`private/` 已收到用户提供的 9 份 PDF／EPUB／MOBI，按 `originals/nickel-scattering/`、`originals/nature-collections/`、`originals/feynman/`、`originals/mumax3/` 分类，原文件名保持不变；大小与 SHA-256 登记于该目录的 `import-manifest.json`。核心R01／R02版本及选段已核，当前清单在 `private/m0/m0-corpus-002/manifest.json`：24个真实对齐单位，12 dev／12 heldout；其中R01为12段对、R02为12句子／短语义单位。001出版摘录快照保留，002区分出版摘录与修订评审参考。16个术语义项／15个英文主词的当前入口为 `private/m0/terms/candidates.json`，各版本另存独立词库快照；用户大体认可旧候选，具体说明与变体是agent修订，逐条人工确认0项。R03实际PDF第1／2／4页及原图已固定。

`private/` 同时保存后续解析缓存、图像、原文片段与对齐文本；执行后创建 `runs/` 保存配置快照、日志、输出及评审记录。两处均在根目录 `.gitignore` 中排除，根目录 PDF／EPUB／MOBI／AZW／AZW3／DJVU 暂存副本也被忽略。Git 仓库已初始化为 `main` 分支，已使用 `git check-ignore` 验证全部 9 份原件、私有清单及衍生文件路径；已有MinerU解析及选页图像，工具限制记于版本记录；尚无模型翻译、PDF重建或M1运行结果。

原创样本可先支持独立文本、保护内容、术语语境、复用与用户修订等程序行为的验证。它们不能代替真实 PDF 页面、正式译本对照或专业人工评审。

留出输入和参考译文分别保存为 `heldout-input.json` 与 `heldout-reference.json`；后者只供评审，禁止进入提示词、检索、翻译记忆与自动建库。`alignment.json` 含参考文本，不能作为翻译请求的整文件输入。
