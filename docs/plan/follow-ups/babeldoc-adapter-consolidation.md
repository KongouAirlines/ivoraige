# BabelDOC 适配器双实现收口

- ID: babeldoc-adapter-consolidation
- 状态: 待评估
- 实施分支／PR: 未安排
- 类型: 改进
- 发现依据: 2026-11-10，PR #98 审查；`src/adapters/pdf.mjs` 与 `plugins/babeldoc/index.mjs` 同时提供 BabelDOC 来源/输出实现
- 目标分支: main

## 问题与影响

内置与独立包都注册 `babeldoc`／`pdf`，不能同时挂载。两处验证、回放与资源处理独立维护，容易产生兼容和诊断漂移；本次已将独立包版本区分，但未合并代码。

## 处理条件与范围

待 P05/P07 独立安装和现有内置路径的迁移方案稳定后评估。保留旧快照和冻结产物的读取能力；先确认安装配置、来源版本与资源迁移，不在 PR #98 更换默认路径或删除内置实现。

## 验收条件

确定一个明确的维护主线及内置路径退役或共享实现方案；已固定版本的文档和任务有可操作的兼容/迁移说明；独立和旧路径的必要回归与三平台安装检查通过。

## 处理记录

2026-11-10：登记待评估；PR #98 的局部错误边界修复及版本区分不能替代完整收口。
2026-11-14：已将 `plugins/babeldoc/index.mjs` 与 `plugins/babeldoc/pdf-text.mjs` 的 `cleanupPath`、`recordCleanupError`、`isReferenced` 异常保护、`exportSource` 引擎标识校验及 `renderPdfMarkdown` 占位符渲染同步回 `src/adapters/pdf.mjs` 与 `src/adapters/pdf-text.mjs`；因独立插件打包（`npm pack`）严禁跨越 `../src/` 导入私有宿主模块，故保留双入口文件并维持行为与错误边界对齐，待内置路径正式退役时再移除 `src/adapters/pdf.mjs`。
