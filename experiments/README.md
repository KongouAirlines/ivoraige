# 实验代码归档

旧 MVP 的 `cordis-dsh`、`pdf-injection` 实验及样本专用修复已随 `0.0.0` 归档到独立分支 `codex/archive-mvp-0.0.0`（标签 `v0.0.0`，提交 `27eec14`）。当前分支弃用这些代码。

需要查阅某个旧文件时，可用本地 `git show v0.0.0:experiments/<path>`，或切到归档分支复现旧实验。`v0.0.0` 仅在本地核实；远端标签状态尚未核实。归档不包含 Git 忽略的原件、运行输出、第三方源码和依赖缓存；本机已有缓存保留在原位。

当前保留的固定 DSH 源码准备与构建方法见根目录 `scripts/`。构建可读取 `experiments/vendor/deepseek-harness/` 固定源码；若项目 `node_modules/` 不存在，也可复用 `experiments/cordis-dsh/node_modules/`。这些 Git 忽略的路径只是构建输入或本地缓存，旧实验代码本身未装配到当前内核。
