# 保留的实践样本

当前可执行示例：`node examples/text-records.mjs [输出目录]`。先按根 README 完成构建；示例展示 TXT 持久化、录入译文、接受和同快照 MD／JSON 导出，默认输出到已忽略的 `evaluation/runs/text-records/`。没有模型请求。

`pdf-windows.json` 是可选 PDF sidecar 配置示例。先按 [PDF 工作台试用指南](../docs/plan/0.1.0/pdf-guide.md)准备 Python 组件；配置中的相对路径从此 JSON 文件所在目录解析。模型资产使用 BabelDOC 默认缓存。

本目录保留原创英汉文本，供重建时参考。旧 CLI 的模型配置与术语条目示例已移至 `codex/archive-mvp-0.0.0`（标签 `v0.0.0`）；新配置应由接入的 DSH 插件与 v2.0 协议确定。

旧使用说明和命令可用 `git show v0.0.0:examples/README.md` 查看。旧命令与测试报告仅属于归档实现。当前开发入口见 [根 README](../README.md)，进度见 [0.1.0 实施记录](../docs/plan/0.1.0/README.md)。
