# ivoraige

面向科研英汉翻译的可组装中间层。核心目标是译文和术语跨任务复用，各输出消费同一份已选定译文。

当前在 `codex/restart-v2` 分支按 [v2.0 设计](docs/requirements/v2.0/01_design_v2.0.md)从头重建，软件版本为 `0.1.0-dev.0`（未发布）。旧 MVP（M0～M4）已弃用，完整实现及实验代码归档在独立分支 `codex/archive-mvp-0.0.0`，版本／标签为 `0.0.0`／`v0.0.0`，提交 `27eec14`。设计文档的 v2.0 不等于软件发布版本。

当前文本工作台支持 TXT／Markdown 导入、DSH SQLite 持久化、按语言隔离的修订与接受、适用性检查，以及冻结快照驱动的 Markdown／JSON 导出。CLI、HTTP/SSE 与 React WebUI 共用内核；DSH profile 设置和命名凭据可保存模型路由，翻译任务支持快速接受、精翻草稿、暂停／恢复与取消。MCP、PDF、EPUB、RAG、Zotero 与词库结构尚未接入；完整科学质量验收仍待完成。本阶段 Windows／Linux／macOS Node 24 的 63 项测试与安装包冒烟已通过，见 [CI 记录](https://github.com/KongouAirlines/ivaraige/actions/runs/37314672867)。范围与进度见 [0.1.0 实施记录](docs/plan/0.1.0/README.md)。

## 启动文本工作台

Node.js >=24。首次准备并构建后，用一个进程持有 SQLite 文件：

```powershell
npm ci
npm run setup:dsh
npm run build
node src/cli.mjs serve --store .\evaluation\runs\workbench\store.sqlite
```

浏览器打开终端打印的地址（默认 `http://127.0.0.1:8787`）。在设置页保存模型和凭据，然后导入 TXT／Markdown、逐段审校并导出。服务运行时，其他 CLI 命令应带 `--url http://127.0.0.1:8787`，避免第二个进程同时打开同一数据库。操作步骤、[DeepSeek 示例](examples/translation-deepseek.json)与 Markdown 语法边界见 [工作台指南](docs/plan/0.1.0/workbench-guide.md)。当前只允许本机回环监听。

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

以库方式使用时，`createApp({ store: 'records.sqlite', exportDir: 'exports' })` 开启持久化与导出；`createApp({ store, settingsDir })` 另启 DSH 持久模型设置及翻译；无参数仍仅加载解析。文件导出不覆盖已存在的路径。显式传 `snapshotId` 可从原清单追加格式；省略时按当前适用版本冻结新清单。无适用译文默认失败，`onMissingAccepted: 'skip'` 明确保留原文。快照默认保留，被产物或正在运行的导出引用时禁止删除。

数据服务目前供单个内核进程使用；源文档导入后不可变，原文变化形成新文档。相关上下文、实际目标或术语约束集合变化会使旧译文失去当前复用资格，历史修订与已有快照仍保留。词库结构尚未实现；当前只接收其约束集合标识。

## 翻译任务

正式工作台使用 `createApp({ store, settingsDir })`，由 DSH profile、settings/config-editor 与 credentials-local 保存模型路由、当前选择和命名凭据；无配置也能启动，保存后下一次翻译生效。已有显式 `createApp({ store, translation })` 仍供内核示例与测试使用，格式见 [配置模板](examples/translation-config.example.json)。两种配置方式不能同时传入；凭据只按引用解析，不写入模型配置。

```js
const { taskId } = await app.tasks.submit(docId, { targetLang: 'zh', mode: 'fast' })
const task = await app.tasks.wait(taskId)
// task.state === 'succeeded' 后，可使用 app.exporter 导出同源 MD / JSON。
```

`fast` 自动接受新译文；`careful` 保存草稿供人工接受。已接受且仍适用的译文直接复用。任务按文档互斥，当前队列串行执行；`pause` 在段落边界暂停，`cancel` 中止在途模型请求，`resume` 续跑暂停或失败任务。重启后未完成任务进入暂停状态，需显式恢复；已落库的完成段落（含精翻草稿）不再调用模型。请求已发送但结果尚未提交时发生崩溃，无法保证供应商未执行该请求。模型超时默认 120 秒，可用 `timeoutMs` 调整；重试策略沿用 DSH 配置。

可运行 `node examples/translate-text.mjs <config.json> <source.txt>`，默认输出到 `evaluation/runs/translation/`，支持恢复任务并导出 MD／JSON。这是显式配置的内核调用示例；正式 CLI 现已通过 `node src/cli.mjs help` 提供。当前自动翻译仅支持无术语集合（`none`）；有术语约束时明确失败。无法确认的 token 用量保留 `null`。

默认测试使用本地模拟接口。另已通过 DeepSeek 原创英汉双向小样、导出与重启复用检查，完整科学质量验收仍待完成。真实调用配置见 [DeepSeek 示例](examples/translation-deepseek.json)；启动环境提供 `DeepSeek_API_TOKEN` 后可显式运行 `node scripts/smoke-deepseek.mjs`，不会随默认测试或 CI 自动调用付费接口。

安装包冒烟会在临时目录安装本地 tarball，并验证 CLI、WebUI、设置、导出、重启及许可文件；不发布 npm 包。文本工作台已通过 Windows／Linux／macOS Node 24 验证，具体提交和运行记录见 [实施记录](docs/plan/0.1.0/README.md)；后续提交的状态以 PR 检查为准。

SQLite 数据库及其 `.owner.sqlite` 所有权文件须位于支持 SQLite 文件锁的本地文件系统。NFS／SMB 等网络文件系统不在并发安全保证范围内；多入口访问同一服务应使用 CLI 的 `--url`。库调用 `createApp({store})` 前须创建父目录，CLI 会自动创建。

旧实验的查阅方式见 [归档说明](experiments/README.md)。版权材料及既有解析缓存仍放在已忽略的 `evaluation/private/`，输出放在 `evaluation/runs/`，无需重新解析或迁移。第三方版本与许可见 [THIRD_PARTY.md](THIRD_PARTY.md)。

- [文档导航](docs/README.md)
- [v2.0 UI 设计](docs/requirements/v2.0/02_UI-design_v2.0.md)
- [v2.0 API 协议](docs/requirements/v2.0/03_API-protocol_v2.0.md)
- [历史复盘](docs/plan/mvp/retrospective.md)
