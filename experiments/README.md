# 实验代码归档

旧 MVP 的 `cordis-dsh`、`pdf-injection` 实验及样本专用修复已随 `0.0.0` 归档到独立分支 `codex/archive-mvp-0.0.0`（本地标签 `v0.0.0`，提交 `27eec14`）。当前分支弃用这些代码。

需要查阅某个旧文件时，可用 `git show v0.0.0:experiments/<path>`，或在归档分支复现旧实验。归档不包含 Git 忽略的原件、运行输出、第三方源码和依赖缓存；本机已有缓存保留在原位。

当前保留的固定 DSH 源码准备与构建方法见根目录 `scripts/`。`experiments/vendor/` 和原实验下的 `node_modules/` 仍是可复用的本地缓存路径，不代表旧实验已接入当前内核。
