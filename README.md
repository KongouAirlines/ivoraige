# ivoraige

面向科研英汉翻译的可组装中间层。核心目标是译文和术语跨任务复用，各输出消费同一份已选定译文。

当前在 `codex/restart-v2` 分支按 [v2.0 设计](docs/requirements/v2.0/01_design_v2.0.md)从头重建，软件版本为 `0.1.0-dev.0`（未发布）。旧 MVP（M0～M4）已弃用，完整实现及实验代码归档在独立分支 `codex/archive-mvp-0.0.0`，版本／本地标签为 `0.0.0`／`v0.0.0`，提交 `27eec14`。设计文档的 v2.0 不等于软件发布版本。

当前已实现 TXT 导入、DSH SQLite 持久化、按语言隔离的译文修订和接受版本、适用性检查，以及冻结快照驱动的 Markdown／JSON 导出。模型翻译、任务服务与 CLI／HTTP／MCP／WebUI 仍待接入；此阶段可以录入已有译文并验证持久化与复用。范围与进度见 [重启实施记录](docs/plan/restart/README.md)。

## 开发验证

Node.js >=24；保留已验证的固定 DSH 源码桥接与构建方法，不另写模型、凭据、设置、存储或任务基础设施。

```powershell
npm ci
npm run setup:dsh
npm test
node examples/text-records.mjs
npm run smoke:package
```

示例使用原创文本和明确录入的译文，数据库与输出写到 `evaluation/runs/text-records/`。再次运行复用已有文档和接受版本，生成新的输出文件；不调用模型。可以传一个目录参数更换存放位置。

以库方式使用时，`createApp({ store: 'records.sqlite', exportDir: 'exports' })` 开启持久化与导出；无参数仍仅加载解析。文件导出不覆盖已存在的路径。显式传 `snapshotId` 可从原清单追加格式；省略时按当前适用版本冻结新清单。无适用译文默认失败，`onMissingAccepted: 'skip'` 明确保留原文。快照默认保留，被产物或正在运行的导出引用时禁止删除。

数据服务目前供单个内核进程使用；源文档导入后不可变，原文变化形成新文档。相关上下文、实际目标或术语约束集合变化会使旧译文失去当前复用资格，历史修订与已有快照仍保留。词库结构尚未实现；当前只接收其约束集合标识。

安装包冒烟会在临时目录安装本地 tarball，并验证运行时文件及第三方许可齐全；不发布 npm 包。三端 Node 24 的 CI 矩阵见 `.github/workflows/kernel-smoke.yml`，结果以实际 CI 运行为准。

旧实验的查阅方式见 [归档说明](experiments/README.md)。版权材料及既有解析缓存仍放在已忽略的 `evaluation/private/`，输出放在 `evaluation/runs/`，无需重新解析或迁移。第三方版本与许可见 [THIRD_PARTY.md](THIRD_PARTY.md)。

- [文档导航](docs/README.md)
- [v2.0 UI 设计](docs/requirements/v2.0/02_UI-design_v2.0.md)
- [v2.0 API 协议](docs/requirements/v2.0/03_API-protocol_v2.0.md)
- [历史复盘](docs/plan/mvp/retrospective.md)
