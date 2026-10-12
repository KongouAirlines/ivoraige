# 0.1.0 安装与首次启动

本阶段面向 Windows x64，发行源为私有仓库 [GitHub Releases](https://github.com/KongouAirlines/ivaraige/releases)。只有有仓库访问权限的用户能下载；不需要公开源码，也没有单独的公开发行仓库。

## 基础工作台

下载并解压 `ivoraige-0.1.0-dev.0-win32-x64.zip`，双击 `ivoraige.cmd`。程序自带 Node，启动本机服务并打开浏览器。请保留命令窗口；退出时按 Ctrl+C。再次双击会打开同一数据目录的已有实例。

默认数据保存在 `%LOCALAPPDATA%\ivoraige`，与程序目录分开。初次可跳过设置，先导入 TXT／Markdown；需要翻译时，在设置的模型页选择模型并保存自己的 API 凭据。模型配置步骤见 [工作台指南](workbench-guide.md)。基础启动不下载 PDF 或 MinerU。

需要指定数据位置或不打开浏览器时：

```powershell
.\ivoraige.cmd --data-dir D:\ivoraige-data --no-open
```

命令会打印服务地址。现有 CLI 命令继续可用，例如 `ivoraige.cmd documents --url <服务地址>`。开发环境可在构建后运行 `node src/launch.mjs` 体验相同启动流程。

## 按需安装 PDF

1. 打开设置 → PDF。未安装时仍可使用文本功能。
2. 保存具有当前私有仓库 **Contents read** 权限的 GitHub 访问令牌。凭据通过 DSH 保存，不会跟随附件的跨主机下载跳转传递。
3. 点击“检查可用版本”，查看平台、版本及总下载量，再点击“安装 BabelDOC”。安装读取固定 tag `v0.1.0-dev.0`，不自动追踪 latest。
4. 可以取消安装；失败后修正网络、凭据或磁盘问题再试。失败的安装不会替换已选定的可用版本。

普通安装允许升级或重新安装同版本以修复组件，不支持降级。若清单中的版本低于当前已选版本，会停止安装并保留现有组件；请取得相同或更新版本的清单。
5. 成功后先保存编辑、等待翻译／导出结束，再在命令窗口按 Ctrl+C，重新双击启动。组件会从已保存配置装配，不需要手写 JSON 或运行 Python 准备脚本。

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

替换程序时先正常退出，将新版解压到另一个程序目录，继续使用同一数据目录。不要用程序目录覆盖数据目录。数据库、PDF 原件、修订、快照、设置、凭据和组件都保存在数据目录中；备份时先退出，再复制整个目录。

安装任务使用 DSH jobs，退出会取消尚未完成的安装；下次重新发起，不续传下载。组件按版本保存，首期不自动更新或清理旧版本。已安装组件启动时不查询远端版本；离线使用仍取决于完整的本地 PDF 资产和翻译模型本身是否需要网络。
