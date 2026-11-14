# 0.1.0 PDF 开发参考

本页面向源码开发、组件构建与回归验收；环境准备完成后的日常操作请看 [PDF 使用指南](pdf-guide.md)。

## 架构与运行时基线

### 派生运行时与捕获策略

当前 PDF 路线处理**原生文本英文 PDF ↔ 中文单语 PDF**（导入后在同一工作台翻译、人工修改和接受译文，再从冻结快照生成 PDF、Markdown、JSON；PDF 来源绑定由 BabelDOC 自身捕获，导出回放只读取已接受译文，绝不调用翻译模型）。扫描件 OCR、双语 PDF、MinerU 跨引擎映射及三系统独立打包仍待验证。

- **派生版本 `0.7.1+ivoraige.3`**：配套源码使用 `0.7.1+ivoraige.3` 原生派生运行时。新捕获同时固定 `captureConfig.underscoreLinePolicy: ascii-alnum-base-v1` 和 `captureConfig.layoutFitPolicy: fit-box-v1`；相同标记用于捕获与回放，运行时必须提供匹配的原生能力标记。
  - **下划线策略（`ascii-alnum-base-v1`）**：使用邻近同字体、字号、名义基线的 ASCII 字母或数字墨迹范围，仅调整临时分行范围，不移动字形。
  - **布局策略（`fit-box-v1`）**：保留预试排框和比例，复用前重新检查当前原框、比例及可用空间，再执行正常 fit 检查。旧 Python monkeypatch 不再用于此运行时。
- **旧绑定兼容性**：旧 `0.6.4`、`0.7.1+ivoraige.1` 与 `.2` 绑定仍可读取，但不能由新 renderer 回放译文 PDF；需重新导入并人工核对接受修订，不能通过修改版本字段冒充兼容。Windows 组件必须重新构建，`--reuse-pyinstaller-build` 会拒绝复用旧可执行文件。构建和回归证据见[原生集成记录](../0.1.x/evidence/babeldoc-native-fit-0.1.x.md)（早期 Python 实验保留为历史证据，不算原生验收）。
- **构建解释器一致性**：组件构建脚本的 `--python` 必须与启动该脚本的解释器路径一致，确保版本检查、依赖与许可收集、PyInstaller 执行使用同一环境（不一致时会在加载构建依赖或清理输出前拒绝）。PowerShell 构建入口已按此方式调用；手动运行时应使用目标环境的 Python 启动脚本并将同一路径传给 `--python`，切勿通过解析符号链接将虚拟环境解释器替换为底层系统 Python。

### 语言与导出前置校验契约

- **源语言校验（`validateSourceLanguage`）**：来源适配器可选的同步 `validateSourceLanguage(language)` 在选中后、排队导入前校验声明的源语言；PDF 直接解析也会在启动 sidecar 前校验。
- **导出前置校验（`validateExport`）**：输出适配器可选的同步 `validateExport({ contentMode, targetLang, provenance })` 在具体输出选中时校验冻结文档来源与目标语言；它必须**仅检查数据**，不得访问 Cordis context、模型或产生副作用。`Tasks` 导出准入、`Exporter` 直接导出及任务恢复均复用输出注册表检查。无导出模式的裸适配器查询和格式发现不执行此校验；来源模式（`contentMode: "source"`）的 PDF 原件导出仍独立于目标语言。`0.1.0` 既有 API 请求形状及存储 schema 不变，超出能力的已选 PDF 请求在创建导出快照与任务前返回 `PRECONDITION_FAILED`。

## 准备组件（Windows x64）

本节适用于 **Windows x64 开发环境**。当前仓库尚未提供并验证 Linux/macOS 对应的 PDF 准备脚本或发行流程；三平台 Node 内核支持不代表三平台 PDF 组件均已验证。

需要 Node.js `>=24.22.1 <25 || >=26.12.1 <27`（源码运行可使用这两个受支持主版本内更新的稳定补丁版）、[uv](https://docs.astral.sh/uv/) 和 PowerShell。先按 [0.7.1 源码构建与迁移指南](../0.1.x/babeldoc-0.7.1.md)准备派生 wheel（官方原样 wheel 不支持本 sidecar 的位置桥；Windows/macOS 派生成包尚未验收），然后在仓库根目录执行：

```powershell
npm ci
npm run setup:dsh
npm run build
./scripts/setup-pdf.ps1
```

- **环境初始化与缓存预热**：`setup-pdf.ps1` 使用 `uv` 建立已忽略的 `evaluation/runs/pdf-runtime/.venv`，安装 `sidecars/babeldoc/requirements.lock` 锁定的 Python 3.13、`BabelDOC 0.7.1+ivoraige.3` 和 `PyMuPDF 1.26.7` 依赖，并运行 BabelDOC `--warmup` 下载／校验所需字体、CMap、tiktoken 与布局模型到用户默认的 `~/.cache/babeldoc`。首次 warmup 需要联网且耗时较长；日常导入和导出不会自动安装或下载。再次运行脚本会复用环境和缓存；`./scripts/setup-pdf.ps1 -CheckOnly` 仅检查版本及必需资产。若组件缺失，PDF 任务报告 `COMPONENT_MISSING`，TXT／Markdown 仍可正常使用。
- **Pillow 13.0.0 锁定要求**：当前完整 lock 固定 **Pillow 13.0.0**。既有环境需重新安装，源码预检和 setup 版本检查会拒绝旧版 Pillow；冻结组件需重新构建，构建脚本会核对实际可执行文件内的 Python 3.13、BabelDOC、PyMuPDF 和 Pillow，而非仅凭构建机环境或复制的 lock 文件（历史依赖快照保留原值，不作为安装输入；详见 [Pillow 13.0.0 证据](../0.1.x/evidence/pillow-13.0.0.md)）。
- **配置文件说明**：[Windows 配置示例](../../../examples/pdf-windows.json)中的路径相对于配置文件自身解析：`command` 指向上述虚拟环境的 `python.exe`，`args` 指向仓库内的 `sidecars/babeldoc/server.py`。未配置 `modelDirs` 时使用 BabelDOC 默认缓存；若使用自定义目录，可在 JSON 中添加 `modelDirs.babeldoc`（缓存根目录）或 `modelDirs.doclayout-yolo`（模型文件），路径同样相对于配置文件。`options.workDir` 可指定可写的绝对目录。**切勿将翻译模型凭据写入 PDF 配置文件**。

## 启动与操作

```powershell
node src/cli.mjs serve --store ./evaluation/runs/workbench/store.sqlite --pdf-config ./examples/pdf-windows.json
```

也可在 VS Code“运行和调试”中选择 **ivoraige: 启动 PDF 工作台**（首次运行前须按上一步准备 Python 组件）。浏览器打开终端打印的地址（默认 `http://127.0.0.1:8787`）。同一 SQLite 文件同时只运行一个服务进程；其他 CLI 命令用 `--url` 连接该服务。

1. 在“设置”页保存翻译模型及凭据。在首页或“文档”页上传不超过 7 MiB 的原生文本英文 PDF，原文语言选 `English`。导入会立即返回任务句柄，任务页显示捕获进度、失败与取消；完成后点击“打开文档”。（PDF 组件状态区分“已配置，首次处理时验证”“已验证”与“不可用”；首次显示“已配置”不代表资产已通过检查。）
2. 在工作台选择目标语言“简体中文（zh-CN）”，按需使用“精细 · 保留草稿”或“快速 · 自动接受”。`zh` 与 `zh-CN` 是不同的修订作用域；若既有 CLI 任务使用 `zh`，须在工作台明确切换到“中文（zh）”才能看到对应译文。
3. 逐段核对来源页码、坐标、原文与译文，修改后保存草稿并接受。`sourceCoverage` 和警告会列出未进入 BabelDOC 翻译回调的文本；公式等不可译片段按原文保留。确认所需可译单位均已接受后，勾选 PDF／MD／JSON 导出并下载。修改已接受译文后再次导出会生成新快照；指定旧 `snapshotId` 可重放旧快照。

服务启动后的 CLI 操作示例：

```powershell
node src/cli.mjs --url http://127.0.0.1:8787 import --path C:/path/to/native-text.pdf --source-lang en --format pdf --json
node src/cli.mjs --url http://127.0.0.1:8787 documents --json
node src/cli.mjs --url http://127.0.0.1:8787 export DOC_ID --target-lang zh-CN --format pdf,md,json --json
```

默认 CLI 会等待 PDF 导入任务完成并输出包含 `document` 和 `taskId` 的 JSON；远程追加 `--no-wait` 则立即返回 `taskId`，随后可用 `task TASK_ID --json` 查询。注意远程 `--path` 指**服务端**可访问的路径；浏览器上传则发送二进制 PDF 的 Base64。重启服务时请保持相同的 `--store` 和 `--pdf-config`；受管理的原始 PDF 副本位于数据库同级的 `pdf/sources/`，切勿手工修改。

## 当前验收边界

### 导出警告与任务恢复

- **持久化导出警告**：导出警告显示在 WebUI 任务和产物列表中，也可通过 CLI `task TASK_ID --json` 或 HTTP 任务／产物接口查看 `warnings`（随产物持久化，重启后仍可查询）。例如公式显示回退或 PDF 提取文本未匹配时，导出仍可正常完成，但提示人工目检页面。
- **取消与重启行为**：取消导入会停止捕获，中断且未提交的导入需重新上传，不支持暂停续传；重启服务会核对已提交文档并恢复导入结果。取消导出不会删除此前已完成的格式产物，其余格式可从同一快照重新导出。组件修复或修改配置后请先重启服务。
- **部分审校跳过（`skip`）**：导出默认要求可译单元全部接受；CLI `--on-missing-accepted skip`（API `onMissingAccepted: "skip"`）允许部分审校后导出，缺失接受修订的单元保留原文，PDF、Markdown、JSON 共用同一冻结决策且不调用模型补译（PDF 中的原文仍参与 BabelDOC 排版回放，并非逐像素复制源页面）。

### 公式占位符对齐与搜索上限

- **占位符顺序与显示回退**：公式占位符必须保持原顺序。导入按来源位置关联回调与引擎 payload：能唯一对齐原文时使用对齐所得显示内容，否则回退使用 BabelDOC 公式字符、富文本成对 token 的空显示，未知 token 保留字面形式（回退会在文档警告中列出页码、位置和 token，不阻止导入或翻译；旧记录的 `null`／缺失显示在回放诊断中也保留字面 token）。回放仍严格核对来源请求和 token 顺序；`skip` 必须逐字使用来源请求。BabelDOC 可能缩写连续标点，PDF 文本提取未匹配时会在导出证据中提示目检，不直接判定导出失败。当前无手工修改来源绑定的界面。
- **对齐搜索预算上限**：占位符对齐搜索设有工作量上限——字符预算在每次 `find` 前计入整个剩余源字符串长度（属于保守的搜索上界估算，而非实际扫描字符数）。因此超长密集输入或重复文字可能提前用尽预算；达到上限时，新导入采用上述 payload／字面 token 回退并在文档警告中标明搜索达到上限，已有来源绑定和冻结快照不改写。此保护仅保证密集占位符映射的可靠性，不证明 PDF 字体、排版或视觉效果合格。合成回归见[显示映射记录](../0.1.x/evidence/pdf-display-mapping-0.1.0.md)。

### 受管原件生命周期与隔离

导入先在独立临时目录捕获，验证通过后才发布受管理原件：

- **命名与隔离**：新副本以数据库规范路径的 SHA-256 和内容 SHA-256 共同命名；同一数据库内相同内容复用副本，不同数据库即使位于同一目录也各自独立持有副本。
- **清理与损坏恢复**：正常失败或取消会释放临时文件；提交失败时仅删除本库本次新增且未被本库其他文档引用的原件。若受管原件丢失或损坏，重新导入内容相同的原始 PDF 即可由内核校验摘要后通过同目录临时文件原子替换恢复（旧版按内容命名的共享副本不会被修复或删除；旧文档冻结导出可使用恢复后的本库副本，持久绑定和快照不变，无需重新翻译旧文档）。
- **迁移与进程异常边界**：迁移时先关闭程序，将数据库与同级的整个 `pdf/` 目录一起复制到新位置并用新 `--store` 启动；导出只读取新受管理根，不回退读取旧绝对路径，且拒绝指向受管理目录之外的符号链接。BabelDOC 每次处理完成或抛错后清理当次工作目录；Node 为每次 sidecar 启动分配专属临时目录，取消或子进程异常退出后等待进程退出再回收。强杀 Node 主进程或断电仍可能留下未回收的临时目录或未提交原件；当前未提供历史孤立文件自动回收，请勿直接删除整个 `pdf/sources`。

Windows 原生组件与原创样本的实测记录见 [PDF 实施计划](pdf.md)及本机已忽略的 `evaluation/runs/pdf-acceptance/report.json`（13 个单位中 12 个可译单位完成英译中，`E = m c²` 公式保留原文，三格式从冻结快照导出且重放零模型请求，两页输出经目检无裁切、溢出或错列）。

### sidecar 失败诊断

配套源码 sidecar 会将当次异常 traceback 的末尾最多 4096 字符放入本地错误响应的私有 `diagnostic` 字段；内核仅将其保存为 `Error.cause` 供本地排障，**不会附加到公开 RPC、任务、HTTP 或 MCP 的错误详情中**（原有上游错误 `message`/`data` 保持映射，并非全字段脱敏器；`stderr` 继续独立记录）。旧 sidecar 不提供该字段时仍立即返回错误，但无逐请求 `cause`；升级内核不会自动更新已安装的 PDF 组件。崩溃或超时的会话 `stderr` 尾部在已有进程关闭等待后收集，取消与关闭语义不变。协议边界见 `03_API-protocol_v2.0.md` §7，实施与验证见[诊断顺序跟进](../follow-ups/pdf-sidecar-stderr-diagnostic-order.md)。

## 开发回归样本

公式专项验收使用原创样本和人工修订，无需配置翻译模型。准备 PDF 组件后，为用于生成样本的开发 Python 安装 `reportlab`（仅样本生成需要，不属于 sidecar 运行时依赖），再依次执行：

```powershell
python -m pip install reportlab
python scripts/pdf-formula-sample.py evaluation/runs/pdf-formula-0.1.0/original.pdf
node scripts/pdf-formula-acceptance.mjs evaluation/runs/pdf-formula-0.1.0/original.pdf evaluation/runs/pdf-runtime/.venv/Scripts/python.exe evaluation/runs/pdf-formula-0.1.0/check-1
& evaluation/runs/pdf-runtime/.venv/Scripts/python.exe scripts/pdf-formula-verify.py evaluation/runs/pdf-formula-0.1.0/check-1
```

目标工作目录须为空；运行成功后会生成三格式产物、冻结重放、payload 与坐标核对报告（页面仍需人工渲染目检）。三平台原生组件分发、真实富文本排版和更广的源行覆盖边界见[实施记录](pdf.md)及[部分行覆盖事项](../follow-ups/pdf-partial-line-coverage.md)。
