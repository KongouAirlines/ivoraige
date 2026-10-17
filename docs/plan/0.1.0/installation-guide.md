# 0.1.0 安装与首次启动

`0.1.0` 是首个正式软件版本。[Release](https://github.com/KongouAirlines/ivaraige/releases/tag/v0.1.0) 已提供源码归档和 npm 安装包，也可按[开发指南](development-guide.md)自行构建。仓库按所有者决定继续私有，下载需要仓库访问权限；新版 Windows x64 便携包尚未构建或验收。本页同时保留现有 `v0.1.0-dev.0` Windows 预览附件的使用说明。项目许可仍待团队决定，正式版本名称不授予开源许可。

`0.1.0` 源码支持公开组件源的匿名请求，也支持显式令牌访问私有源。目标仓库的真实匿名安装成功路径仍需发布后验证；受控测试不能代替它。

## 0.1.0 源码与本地 npm 包

源码方式按[开发指南](development-guide.md)执行 `npm ci`、`npm run setup:dsh`、`npm run build`、`npm start`。本地 npm 包可用 `npm run pack:npm -- <输出目录>` 生成 `ivoraige-0.1.0.tgz`；安装与运行需要 Node.js ≥24。首次可跳过模型设置，先导入 TXT／Markdown、人工录入并接受译文，再导出 MD／JSON。

取得 `ivoraige-0.1.0.tgz` 后，将它放入一个新的程序目录，在该目录打开终端并执行：

```sh
npm install ./ivoraige-0.1.0.tgz
node node_modules/ivoraige/src/launch.mjs
```

启动后打开打印的本机地址；退出时按 Ctrl+C。可追加 `--data-dir <数据目录>` 指定独立数据位置，或追加 `--no-open` 不自动打开浏览器。此安装包包含构建后的应用和指南，安装时仍需联网取得 Node 依赖；不需要 Git 或重新构建 DSH。它不是自带 Node 的便携包，也不包含独立 PDF 运行时。

## 既有 Windows 预览附件（v0.1.0-dev.0）

从 [GitHub Releases](https://github.com/KongouAirlines/ivaraige/releases/tag/v0.1.0-dev.0) 下载并解压 `ivoraige-0.1.0-dev.0-win32-x64.zip`，双击 `ivoraige.cmd`。该旧包自带 Node，启动本机服务并打开浏览器；请保留命令窗口，退出时按 Ctrl+C。再次双击会打开同一数据目录的已有实例。它尚未包含 MCP 和可选令牌安装，在线安装组件仍需令牌；不能按 `0.1.0` 源码的新行为来判断它。

默认数据保存在 `%LOCALAPPDATA%\ivoraige`，与程序目录分开。初次可跳过设置，先导入 TXT／Markdown；需要翻译时，在设置的模型页选择模型并保存自己的 API 凭据。模型配置步骤见 [工作台指南](workbench-guide.md)。基础启动不下载 PDF 或 MinerU。

需要指定数据位置或不打开浏览器时：

```powershell
.\ivoraige.cmd --data-dir D:\ivoraige-data --no-open
```

命令会打印服务地址。现有 CLI 命令继续可用，例如 `ivoraige.cmd documents --url <服务地址>`。开发环境可在构建后运行 `node src/launch.mjs` 体验相同启动流程。

## 按需安装 PDF

以下步骤针对在 Windows x64 上运行的 `0.1.0` 源码或由其构建的包；现有 Windows 预览附件的界面与令牌要求仍按旧版 Release 说明。其他平台的独立 PDF 组件尚未交付。

1. 打开设置 → PDF。未安装时仍可使用文本功能。
2. 使用本源码构建时，公开源可直接检查版本；GitHub 令牌为可选。私有源需保存具有目标仓库 **Contents read** 权限的令牌，公开源遇到匿名限流时也可选择配置令牌。凭据仍通过 DSH 保存；程序不会自动读取本机 `gh` 登录，无令牌时完全省略 Authorization，跨主机下载跳转不携带凭据。
3. 点击“检查可用版本”，查看平台、版本及总下载量，再点击“安装 BabelDOC”。当前默认组件来源仍固定在旧组件 tag `v0.1.0-dev.0`，这是组件下载来源，不是 `0.1.0` 应用版本；程序不自动追踪 latest。
4. 可以取消安装；失败后按错误提示处理并重新发起。HTTP 404 表示源／版本不存在或不可访问，不一定是私有仓库；401 检查令牌；403 按提示区分访问权限与限流；429 等待限流恢复。网络或磁盘失败可修正后重试，也可使用本地包。失败不会替换已选定的可用版本。
5. 成功后先保存编辑、等待翻译／导出结束，再在命令窗口按 Ctrl+C，按原启动方式重新运行源码或 npm 包。组件会从已保存配置装配，不需要手写 JSON 或运行 Python 准备脚本。

保存的令牌失效时，可点击“移除已保存令牌”切回公开源的匿名访问，再重新检查版本；程序不会在授权失败后静默忽略令牌。如果令牌由启动环境提供，先在该环境移除后重启，页面会明确提示。已安装组件及文档数据不受清除下载令牌影响。CLI 对应 `ivoraige components credential-clear --url <服务地址>`（便携包使用 `ivoraige.cmd`）。

普通安装允许升级或重新安装同版本以修复组件，不支持降级。若清单版本低于当前已选版本，会停止安装并保留现有组件；请取得相同或更新版本的清单。

离线补充方式：从同一个 Release 下载 `components-manifest.json` 以及清单中的组件、资源归档，放在同一文件夹。在 PDF 设置页填写**清单文件**的完整路径并选择本地安装。程序使用与在线下载相同的校验和激活流程；无需手动解压组件归档。

发行包启动器默认启用 Node 自带的环境代理支持，沿用已有 `HTTP_PROXY`／`HTTPS_PROXY`，并让本地工作台绕过代理。未配置代理时正常直连；显式设置 `NODE_USE_ENV_PROXY=0` 可禁用。若需要临时指定代理，使用自己的代理地址后启动：

```powershell
$env:NODE_USE_ENV_PROXY = '1'
$env:HTTPS_PROXY = 'http://127.0.0.1:7897'
$env:NO_PROXY = 'localhost,127.0.0.1,::1'
.\ivoraige.cmd
```

源码启动时需自行启用 `NODE_USE_ENV_PROXY=1`；本机直连大附件曾中断，因此代理路径也纳入实际下载验证。见 [Node 官方代理说明](https://nodejs.org/api/http.html#built-in-proxy-support)。下载失败可以重新安装或使用上述本地包方式，不影响已导入文档。

安装成功表示组件文件已经就位。第一次实际导入／导出才检查 BabelDOC 运行与资产；当前支持原生文本英文 PDF 到中文单语 PDF，扫描件 OCR、双语 PDF 和其他平台的独立组件仍未验收。具体操作和解析边界见 [PDF 指南](pdf-guide.md)。

## 数据、升级与恢复

已有 Windows 验收仅覆盖旧版同版本程序目录替换；`0.1.0` 的本地 npm 包在 macOS 上验证了同版本重新安装后复用完整数据目录，但未证明新版 Windows 包或跨版本数据迁移。替换前先正常退出并备份完整数据目录；便携包解压到另一个程序目录，npm 包安装到另一个目录，再继续使用原数据目录。跨版本更新须先阅读对应 Release 的迁移与恢复说明。不要用程序目录覆盖数据目录。数据库、PDF 原件、修订、快照、设置、凭据和组件都保存在数据目录中；备份时先退出，再复制整个目录。

安装任务使用 DSH jobs，退出会取消尚未完成的安装；下次重新发起，不续传下载。组件按版本保存，首期不自动更新或清理旧版本。已安装组件启动时不查询远端版本；离线使用仍取决于完整的本地 PDF 资产和翻译模型本身是否需要网络。配置在线模型会向所选供应商发送待译文本，费用由该供应商和你的账户计收；GitHub 下载令牌与模型 API 凭据用途不同。人工译文和已接受快照导出无需模型请求。

组件来源目前仍默认使用 `KongouAirlines/ivaraige` 的旧 tag `v0.1.0-dev.0`；这个组件 tag 不随应用软件版本自动改动。部署时可在启动前通过 `IVORAIGE_COMPONENTS_REPOSITORY=owner/repo` 和 `IVORAIGE_RELEASE_TAG` 指定仓库与版本；该仓库需要提供相同格式的组件清单和附件；公开源可匿名读取，私有源的令牌须具有对应仓库的读取权限。源码组合时显式传入的 `components.repository`／`releaseTag` 优先于环境变量。
