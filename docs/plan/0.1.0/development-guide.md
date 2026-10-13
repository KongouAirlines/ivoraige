# 0.1.0 开发与源码运行

安装版用户从[安装指南](installation-guide.md)开始。本页供源码运行和贡献代码使用；架构约束见 [AGENTS.md](../../../AGENTS.md) 与 [插件组合决策](../../decisions/0002-plugin-composition-0.1.0.md)。

## 准备与启动

需要 Node.js ≥24，在仓库根目录执行：

```powershell
npm ci
npm run setup:dsh
npm run build
npm start
```

启动器打开浏览器，默认数据目录为 Windows 的 `%LOCALAPPDATA%\ivoraige`，与源码分开。需要隔离开发数据时：

```powershell
node src/cli.mjs serve --store ./evaluation/runs/workbench/store.sqlite
```

打开打印的本机地址。一个数据库只运行一个内核；服务运行时其他 CLI 命令使用 `--url http://127.0.0.1:8787`。所有 CLI 参数以 `node src/cli.mjs help` 为准。源码启动需要环境代理时自行启用 `NODE_USE_ENV_PROXY=1`，本机服务应绕过代理。

VS Code 首次完成依赖准备后，选择“ivoraige: 启动文本工作台”按 F5，构建任务会先执行。PDF 调试需要先按 [PDF 开发参考](pdf-development.md)准备组件；两个启动配置使用同一数据库和端口，不同时运行。

## 验证

```powershell
npm test
npm run smoke:package
```

默认测试使用本地 mock，不调用付费模型。修改后按受影响路径验证；文档修改检查链接、版本和打包内容，不为纯文案增加业务测试。发行构建与 Sandbox 验收见[维护者指南](installation-maintenance.md)。

## 内核与持久化

`createApp({store})` 提供持久化及导出；增加 `settingsDir` 装配 DSH 设置、凭据与模型。无参数保持纯解析。显式 `translation` 配置供示例和测试使用，不能与 `settingsDir` 同时提供。

- [人工译文与冻结输出示例](../../../examples/text-records.mjs)：原创文本，无模型调用。
- [显式翻译示例](../../../examples/translate-text.mjs)与[配置模板](../../../examples/translation-config.example.json)：实际使用时可能调用模型。
- 数据库及 `.owner.sqlite` 所有权文件放在支持 SQLite 文件锁的本地文件系统，NFS/SMB 不在保证范围内。库调用方先创建父目录。
- 原文内容变化产生新文档；不同目标语言隔离修订，`zh` 与 `zh-CN` 也不同。
- 导出指定 `snapshotId` 可重放原接受版本；默认从当前接受内容冻结。缺失接受译文默认失败，显式 skip 保留原文，不补调模型。
- 真实模型试验须有单独授权及调用预算。不能把未知 token 用量记为零；API Key 不提交或写入示例。

## 贡献与文档

优先通过所属插件接入功能，复用 DSH 基础设施；设计时说明能力归属、依赖、缺失行为与生命周期，验证实际边界。具体契约见 [ADR-0002](../../decisions/0002-plugin-composition-0.1.0.md)。

`README.md` / `README.zh-CN.md` 同步更新；用户操作写到用户指南，历史验证写到实施记录，未完成事项进入 [follow-ups](../follow-ups/README.md)。新的文档路径按软件版本组织，保留既有历史链接。

本分支与 MCP [PR #18](https://github.com/KongouAirlines/ivaraige/pull/18) 平行，不包含其代码或本地指南。合并时按实际主线能力更新双语 README、能力表和导航，保留 MCP 的验证记录与协议修复。
