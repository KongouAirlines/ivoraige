# M2 文本闭环工程验收记录

日期：2026-09-29｜状态：M2 基本文本闭环与模拟端点工程检查通过；真实本地双向控制句通过，科学质量完整验收待执行。

依据：[M2 规划](m2-text-workflow.md)与 [运行时 ADR](../decisions/0001-runtime-selection.md)。实现复用固定 DSH vendor Cordis、storage/storage-domain/storage-json、llm/llm-pi-ai；项目业务服务为 records、terms、model、translation、textTask、termBuilder、textExport。没有引入完整 DSH agent/session、jobs、workflow 或 Web 产品壳。

## 可运行产物

- `src/cli.mjs` 提供导入／读取、源文与目标修改、词库选择、翻译、复核、明确修订确认／人工修改、Markdown／JSON 导出及术语创建／编辑／确认／合并／导入导出和独立建库。
- `src/app.mjs` 按命令装配服务。CLI 只有 translate/build 加载模型；确认、修改、术语管理和输出不依赖模型。配置可通过 `terms:false`、`builder:false` 关闭相应能力，明确选择缺少的能力会报错。
- `examples/` 有原创磁学双向控制文本、术语候选和本地模型配置。模型名为明确占位符；`LM_API_TOKEN` 为引用，未保存令牌。无认证 loopback 可省略引用；CLI 不读取 `.env` 或枚举凭据环境。
- `test/text-workflow.test.mjs` 用真实 DSH 服务与动态端口的本地 HTTP/SSE 模拟服务，未以假业务 model/records 替换实现。测试数据使用临时目录，结束时清理。

## 验证与证据

执行 `node --test test/text-workflow.test.mjs`。首次 Windows 沙箱内 Node test runner 启动子进程返回 `spawn EPERM`；使用工具批准的本地沙箱升级后退出码 0，**11 项通过、0 失败**，运行约 2.99 秒。之后在持久化检查补入替换模型仍保留人工接受、零调用的断言，单独重跑该项通过（约 0.49 秒）。没有跳过受影响的检查。最终 `npm run build` 从 742 个真实源码文件生成固定版本 bundle，通过。

| 检查 | 实际结果 |
|---|---|
| 真实 DSH → pi-ai → HTTP/SSE → 业务草稿 | 两个源文单位两次请求，路由 `/v1/chat/completions`、正文模型和方向核对；草稿未自动接受；usage 保存 unknown/null |
| 接受后重跑与双出口 | 重跑全部 reused、新增模型调用零；Markdown 和 JSON 使用同一份清单，逐单位／修订 ID 和文字一致 |
| 持久化与模型卸载 | 卸载 model/provider 后直接确认、人工修改和导出；dispose 后重新装配只读记录，单位 ID 与接受修订一致；替换正文模型后人工接受修订保留且零请求 |
| 源文／语境／目标变化 | 源文稳定单位 ID、修订递增，相关相邻单位复核失败；直接导出拒绝需检查结果，历史接受修订保留 |
| 术语变化 | 无关确认条目修改后直接导出先拒绝，重新核对可复用且零请求；相关译名修改不能自动复用，人工复核产生新的来源明确修订 |
| 双向义项与库优先级 | 同义项项目库覆盖共享库并返回冲突依据；英文多义及中文多映射报告歧义；上下文限定与确定的中译英映射通过 |
| 独立建库与角色 | builder 请求模型与正文／review 分开；候选保留精确引文和来源，确认前不约束正文；确认、合并别名、库导出导入通过 |
| 取消 | 在途 SSE 连接关闭，仅第一单位发请求；后续单位不派发，均标 cancelled；无接受记录或不完整草稿 |
| 模型错误／审校失败 | 审校 503 后任务 failed，正文和审校两次调用都有记录；没有保存或接受失败结果 |
| 真实存储失败 | 将 JSON 后端目录临时替换为普通文件构造实际落盘失败；accept 拒绝，内存 snapshot 与接受状态保持原值 |
| 配置与 CLI 边界 | 非 loopback 网络关闭被拒且无请求；明确选词库但 terms 缺失时报错；non-model CLI 使用无效 model 配置仍可导入／读回，confirm 缺明确 revision 报错，缺接受结果导出不产生文件 |

这里的模型回答是模拟服务固定输出；测试证明工程行为，不证明科学含义、术语质量或模型推理能力。既有 M1 实验未作为本阶段新增覆盖重复宣称。

## 使用入口

先按仓库构建说明准备固定 DSH bundle，再执行：

```powershell
npm run build
node --test test/text-workflow.test.mjs
node src/cli.mjs --help
node src/cli.mjs import examples/scientific-en.txt --store evaluation/runs/m2/manual/store --id sample
node src/cli.mjs translate sample --config examples/model.local.json
node src/cli.mjs show sample --store evaluation/runs/m2/manual/store
```

替换配置中的已安装模型名，按启动进程环境提供所选凭据引用。Windows User 环境变量新设置后，已运行的终端可能尚未继承；本轮在授权的 PowerShell 进程中仅读取指定 `LM_API_TOKEN` 并传给 CLI，没有打印或保存值。show 的 unit ID 与明确 draft revision ID 用于 `confirm sample <unit> <revision> --store ...`；`edit` 在其后加人工译文文件路径。全部单位接受后：

```powershell
node src/cli.mjs export sample --store evaluation/runs/m2/manual/store --md evaluation/runs/m2/manual/sample.md --json evaluation/runs/m2/manual/sample.json
node src/cli.mjs translate sample --config examples/model.local.json
```

第二次翻译已适用接受结果应返回 reused，calls 为空。`check` 只核对适用性，不生成新翻译；export 不触发 check 或模型。运行中 Ctrl-C 取消并等待运行句柄结束。完整术语和双向示例见 [examples README](../../examples/README.md)。

## 真实 LM Studio 控制句

在用户授权后，用已存在的本机模型 `hy-mt2-1.8b`、端点 `http://127.0.0.1:1234/v1`、`network:false` 及指定凭据变量，通过产品 CLI → 真实 DSH 模块执行原创双向各一单位。没有下载模型，也没有调用 DeepSeek 或其他远程 API。

第一次各一请求均传输成功并生成草稿，但结果不合要求：英译中保留英文，中译英把提示中的 TERMS／CONTEXT／SOURCE 标签带入译文。修正通用提示为完整 English／Chinese 名称、只输出译文、空约束／语境不加入提示，再各一请求得到：

| 源文 | 最新草稿 |
|---|---|
| The spin wave propagates through the magnetic film. | 自旋波在磁性薄膜中传播。 |
| 自旋波在磁性薄膜中传播。 | Spin waves propagate in magnetic thin films. |

总计 **4 次本地正文请求**，其中 2 次是定位提示问题的初稿，2 次是修正重试；均有显式模型来源、stop 结束与 unknown 用量，初稿保留历史。开发中运行记录保留原始 `m2-1` 标记，定稿提示实现后续生成记录为 `m2-2`。最新草稿通过 CLI 以 `--actor agent-engineering-check` 接受，清晰区别于用户专业确认；两个方向各导出 Markdown／JSON，单位与修订 ID、译文均一致。再次通过 CLI 执行 translate，两次均 reused、`calls:[]`，**新增正文请求零**。过程和运行记录存于忽略目录 `evaluation/runs/m2-live/`，不包含凭据。这里仅证明小样基本翻译可用，不把两句控制文本当作科研质量全量验收。

本轮实际执行的产品命令（配置仅保存端点与变量名）：

```powershell
node src/cli.mjs translate live-en --config evaluation/runs/m2-live/config.json
node src/cli.mjs translate live-zh --config evaluation/runs/m2-live/config.json
node src/cli.mjs confirm live-en <unit-id> <latest-revision-id> --store evaluation/runs/m2-live/store --actor agent-engineering-check
node src/cli.mjs confirm live-zh <unit-id> <latest-revision-id> --store evaluation/runs/m2-live/store --actor agent-engineering-check
node src/cli.mjs export live-en --store evaluation/runs/m2-live/store --md evaluation/runs/m2-live/en.md --json evaluation/runs/m2-live/en.json
node src/cli.mjs export live-zh --store evaluation/runs/m2-live/store --md evaluation/runs/m2-live/zh.md --json evaluation/runs/m2-live/zh.json
```

## 剩余验收与限制

继续按 M0 开发集验证科学含义、术语约束与真实建库／审校角色；留出答案不进入翻译或建库输入。科学含义和关键术语仍需用户专业复核，本轮未把代理工程接受写成人工确认。真实建库和审校未运行，不宣称 M0 科研质量标准已全部满足。

首版为单进程文本与单个 JSON domain 存储，修改会保留历史修订；没有跨文件备份迁移、持久任务恢复、复杂翻译记忆检索或外部语料自动建库。术语处理是显式义项／语境约束，不是语义消歧模型。未知用量保持 unknown，不能据 SDK 补零报零费用。

输出单个文件通过临时文件完成后替换；多个输出共享清单，但多文件替换不构成一个事务。Markdown 内容未实现通用转义／复杂富文本往返。Office、PDF、版式输出和更完整解析留给 M3；本阶段不提供自动接受、PDF 回填或网页界面。
