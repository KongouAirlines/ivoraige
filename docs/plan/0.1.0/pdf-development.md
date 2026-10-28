# 0.1.0 PDF 开发参考

本页面向源码开发与回归验收；准备完成后的日常操作请看 [PDF 使用指南](pdf-guide.md)。

当前 PDF 路线处理**原生文本英文 PDF → 中文单语 PDF**。导入后可在同一工作台翻译、人工修改和接受译文，再从冻结快照生成 PDF、Markdown、JSON。PDF 来源绑定由 BabelDOC 自身捕获；导出回放只读取已接受译文，不请求翻译模型。扫描件 OCR、双语 PDF、MinerU 跨引擎映射及三系统独立打包仍待验证。

## 准备组件

本节适用于 **Windows x64 开发环境**。当前仓库未提供并验证 Linux/macOS 对应的 PDF 准备脚本或发行流程；三平台 Node 内核支持不等于三平台 PDF 组件均已验证。

需要 Node.js `>=24.22.1 <25 || >=26.12.1 <27`、[uv](https://docs.astral.sh/uv/) 和 PowerShell。源码运行可使用这两个受支持主版本内更新的稳定补丁版。以下命令在仓库根目录执行：

```powershell
npm ci
npm run setup:dsh
npm run build
./scripts/setup-pdf.ps1
```

`setup-pdf.ps1` 用 uv 建立已忽略的 `evaluation/runs/pdf-runtime/.venv`，安装 `sidecars/babeldoc/requirements.lock` 锁定的 Python 3.13、BabelDOC 0.6.4 和 PyMuPDF 1.26.7 依赖，并运行 BabelDOC `--warmup` 下载／校验所需字体、CMap、tiktoken 与布局模型到用户默认的 `~/.cache/babeldoc`。首次 warmup 需要网络且耗时；普通导入和导出不会安装或下载。再次运行脚本会复用环境和缓存；`./scripts/setup-pdf.ps1 -CheckOnly` 只检查版本及必需资产。若组件缺失，PDF 任务报告 `COMPONENT_MISSING`，TXT／Markdown 仍可使用。

[Windows 配置示例](../../../examples/pdf-windows.json)的路径相对于配置文件解析：`command` 指向上述虚拟环境的 `python.exe`，`args` 指向仓库内的 `sidecars/babeldoc/server.py`。未配置 `modelDirs` 时使用 BabelDOC 默认缓存。若使用其他目录，可在 JSON 中添加 `modelDirs.babeldoc`（缓存根目录）或 `modelDirs.doclayout-yolo`（模型文件）；这些路径同样相对于配置文件。`options.workDir` 可指定可写的绝对目录。不要把模型凭据写进 PDF 配置。

## 启动与操作

```powershell
node src/cli.mjs serve --store ./evaluation/runs/workbench/store.sqlite --pdf-config ./examples/pdf-windows.json
```

也可在 VS Code“运行和调试”中选 **ivoraige: 启动 PDF 工作台**；首次按上一步准备 Python 组件。浏览器打开终端给出的地址（默认 `http://127.0.0.1:8787`）。使用同一 SQLite 文件时只运行一个服务进程；其他 CLI 命令用 `--url` 连接它。

在“设置”页保存翻译模型及凭据。首页或“文档”页上传不超过 7 MiB 的原生文本英文 PDF，原文语言选 English。导入立即返回任务句柄，任务页显示捕获进度、失败与取消；完成后点击“打开文档”。PDF 组件状态显示“已配置，首次处理时验证”“已验证”或“不可用”，首次显示配置状态不代表资产已通过检查。

在工作台选择目标语言“简体中文（zh-CN）”，按需使用“精细 · 保留草稿”或“快速 · 自动接受”。`zh` 与 `zh-CN` 是不同的修订作用域；若既有 CLI 任务使用 `zh`，须在工作台明确切换到“中文（zh）”才能看到它的译文。逐段查看来源页码、坐标、原文与译文，人工修改后保存草稿并接受。`sourceCoverage` 和警告列出未进入 BabelDOC 翻译回调的文本；公式等不可译片段按原文保留。覆盖提示要求人工核对，不能仅以回调成功宣称全文完整。确认所需可译单位均已接受后，勾选 PDF／MD／JSON 导出并从“已生成文件”下载。修改已接受译文后再次导出会创建新快照；指定旧 `snapshotId` 可重放旧快照，旧输出不会随编辑改变。

CLI 示例（服务已启动）：

```powershell
node src/cli.mjs --url http://127.0.0.1:8787 import --path C:/path/to/native-text.pdf --source-lang en --format pdf --json
node src/cli.mjs --url http://127.0.0.1:8787 documents --json
node src/cli.mjs --url http://127.0.0.1:8787 export DOC_ID --target-lang zh-CN --format pdf,md,json --json
```

默认 CLI 会等 PDF 导入任务完成并输出一次带 `document` 和 `taskId` 的 JSON；远程 `--no-wait` 立即返回 `taskId`，随后用 `task TASK_ID --json` 查询。远程 `--path` 是**服务端**能访问的路径；浏览器上传则使用二进制 PDF 的 Base64。重新启动服务时保持相同的 `--store` 和 `--pdf-config`；受管理的原始 PDF 副本放在数据库旁的 `pdf/sources/`，不要手工修改。

## 当前验收边界

导出警告显示在 WebUI 任务和产物列表中，也可用 CLI `task TASK_ID --json` 或 HTTP 的任务／产物接口查看 `warnings`。这些提示随产物持久化，重启后仍可查询；例如公式显示回退或 PDF 提取文本未匹配，导出可正常完成，但建议人工检查页面。

取消导入会停止捕获；中断且未提交的导入需重新上传，不能暂停后续传。重启会核对已经提交的文档并恢复导入结果。取消导出不会删除此前已完成的格式产物，其他格式可从同一快照重新导出。组件修复或配置更改后请重启服务，再进行 PDF 处理。

公式占位符必须保留原顺序。导入按来源位置关联回调与引擎 payload；能唯一对齐原文时使用对齐得到的显示内容，否则使用 BabelDOC 的公式字符、富文本成对 token 的空显示，未知 token 保留字面形式。回退会在文档警告中列出页码、位置和 token，不会阻止导入或翻译。旧记录的 null／缺失显示在回放诊断中也保留字面 token。回放仍核对来源请求和 token 顺序；`skip` 必须逐字使用来源请求。BabelDOC 可能缩写连续标点，PDF 文本提取未匹配时会在导出证据中提示目检，不据此判定导出失败。当前没有手工修改来源绑定的界面。

导出默认要求可译单元全部接受。CLI 的 `--on-missing-accepted skip`（API 的 `onMissingAccepted: "skip"`）允许部分审校后导出：缺少接受修订的单元保留原文，PDF、Markdown、JSON 继续共用同一冻结决策，不调用模型补译。PDF 中的原文会参与 BabelDOC 排版回放，并非逐像素复制源页面。

导入先在独立临时目录捕获，验证后才发布受管理原件。新副本以数据库规范路径的 SHA-256 和内容 SHA-256 共同命名；同库相同内容复用副本，不同数据库即使位于同目录也各自拥有副本。正常失败或取消会释放临时文件；提交失败时只删除本库本次新增且未被本库文档引用的原件。来源丢失或损坏时，重新导入内容相同的原始 PDF：内核校验原件摘要后恢复本库副本，损坏文件通过同目录临时文件原子替换。旧版按内容命名的共享副本不会被修复或删除；旧文档的冻结导出可使用本库恢复后的副本，持久绑定和快照不变。重新导入旧文档可能生成新文档身份，但不需要重新翻译旧文档。迁移时先关闭程序，把数据库与旁边的整个 `pdf/` 目录一起复制到新位置，再用新 store 路径启动；导出只读取新受管理根，不回退读取旧绝对路径。指向受管理目录之外的链接会被拒绝。BabelDOC 每次处理完成或抛错后清理本次工作目录，常驻进程保留共享缓存。Node 为每次 sidecar 启动分配专属临时目录；取消或子进程异常退出后等待进程退出再回收，不删除配置的工作根或其他文件。强杀 Node 主进程或断电仍可能绕过清理，留下临时目录或发布后尚未提交的原件；本阶段未提供历史孤立文件自动回收，勿直接删除整个 `pdf/sources`。

Windows 原生组件与原创样本的实测记录在 [PDF 实施计划](pdf.md)及本机已忽略的 `evaluation/runs/pdf-acceptance/report.json`。样本产生 13 个单位，其中 12 个可译单位完成英译中；`E = m c²` 公式作为原文保留。PDF／MD／JSON 从冻结快照导出，旧快照重放及复用没有新增模型请求。本机浏览器另完成新 PDF 上传、zh-CN 审校接受、三格式导出与 PDF 下载，编辑后的两页输出已目检无裁切、溢出或错列。OCR、双语 PDF 和三系统打包验收仍须另行记录。

## 开发回归样本

公式专项验收使用原创样本和人工修订，不需要配置模型。准备 PDF 组件后，给用于生成样本的开发 Python 安装 ReportLab（仅样本生成需要，不属于 sidecar 运行时依赖），再运行：

```powershell
python -m pip install reportlab
python scripts/pdf-formula-sample.py evaluation/runs/pdf-formula-0.1.0/original.pdf
node scripts/pdf-formula-acceptance.mjs evaluation/runs/pdf-formula-0.1.0/original.pdf evaluation/runs/pdf-runtime/.venv/Scripts/python.exe evaluation/runs/pdf-formula-0.1.0/check-1
& evaluation/runs/pdf-runtime/.venv/Scripts/python.exe scripts/pdf-formula-verify.py evaluation/runs/pdf-formula-0.1.0/check-1
```

工作目录须为空；成功后包含三格式产物、冻结重放、payload 与坐标核对报告。页面仍需渲染目检。已验证 Windows 开发环境；三平台原生组件分发、真实富文本排版和更广的源行覆盖仍有边界，见 [实施记录](pdf.md)及 [部分行覆盖事项](../follow-ups/pdf-partial-line-coverage.md)。

### sidecar 失败诊断

配套源码 sidecar 将本次异常 traceback 的末尾最多 4096 字符放入本地错误响应的私有 `diagnostic` 字段；内核仅保存为 `Error.cause`，用于本地排障，不附加到公开 RPC/任务/HTTP/MCP 的错误详情。原有上游错误 message/data 保持映射，并非新增全字段脱敏器。stderr 继续独立记录。旧 sidecar 不提供该字段时仍立即返回错误，但没有可靠逐请求 cause；升级内核不会自动更新已安装的 PDF 组件。正常成功和普通失败均不额外等待。崩溃／超时的会话 stderr 尾部在已有进程关闭等待后收集，取消／关闭语义不变；强杀前未刷出的日志无法保证恢复。协议边界见 §7，实施与验证见 [诊断顺序跟进](../follow-ups/pdf-sidecar-stderr-diagnostic-order.md)。
