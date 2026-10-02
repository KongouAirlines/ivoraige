# ivoraige

面向科研英汉翻译的可组装中间层。核心目标是译文和术语跨任务复用，各输出消费同一份已选定译文。

当前在 `codex/restart-v2` 分支按 [v2.0 设计](docs/requirements/v2.0/01_design_v2.0.md)从头重建，软件版本为 `0.1.0-dev.0`（未发布）。旧 MVP（M0～M4）已弃用，完整实现及实验代码归档在独立分支 `codex/archive-mvp-0.0.0`，版本／本地标签为 `0.0.0`／`v0.0.0`，提交 `27eec14`。设计文档的 v2.0 不等于软件发布版本。

本轮建立按需装配的 Cordis 内核、解析注册表和 TXT 解析入口。翻译、持久修订、冻结导出、CLI、HTTP、MCP、WebUI 与 Python sidecar 尚待按阶段接入；当前不是可用翻译产品。范围与进度见 [重启实施记录](docs/plan/restart/README.md)。

## 开发验证

Node.js >=24；保留已验证的固定 DSH 源码桥接与构建方法，不另写模型、凭据、设置、存储或任务基础设施。

```powershell
npm ci
npm run setup:dsh
npm test
```

旧实验的查阅方式见 [归档说明](experiments/README.md)。版权材料及既有解析缓存仍放在已忽略的 `evaluation/private/`，输出放在 `evaluation/runs/`，无需重新解析或迁移。第三方版本与许可见 [THIRD_PARTY.md](THIRD_PARTY.md)。

- [文档导航](docs/README.md)
- [v2.0 UI 设计](docs/requirements/v2.0/02_UI-design_v2.0.md)
- [v2.0 API 协议](docs/requirements/v2.0/03_API-protocol_v2.0.md)
- [历史复盘](docs/plan/mvp/retrospective.md)
