# M0 评估材料

本目录是评估准备，不是已经执行的测试结果。

- [M0 范围与验收](../docs/plans/m0-scope-and-evaluation.md)
- [真实材料目录](../docs/research/m0-sample-catalog.md)
- [原创工程控制样本](synthetic-cases.json)：6 个由本项目本次编写的例子，附期望；不是出版译文、人工认证金标准或模型运行结果。
- [评审记录模板](review-template.md)：运行与人工评审后填写。

`private/` 已收到用户提供的 9 份 PDF／EPUB／MOBI，按 `originals/nickel-scattering/`、`originals/nature-collections/`、`originals/feynman/`、`originals/mumax3/` 分类，原文件名保持不变；大小与 SHA-256 登记于该目录的 `import-manifest.json`。文件已到位，正文版本、章节与对齐尚未核实。

`private/` 同时保存后续解析缓存、图像、原文片段与对齐文本；执行后创建 `runs/` 保存配置快照、日志、输出及评审记录。两处均在根目录 `.gitignore` 中排除，根目录 PDF／EPUB／MOBI／AZW／AZW3／DJVU 暂存副本也被忽略。Git 仓库已初始化为 `main` 分支，已使用 `git check-ignore` 验证全部 9 份原件、私有清单及衍生文件路径；尚无解析或模型运行结果。

原创样本可先支持独立文本、保护内容、术语语境、复用与用户修订等程序行为的验证。它们不能代替真实 PDF 页面、正式译本对照或专业人工评审。
