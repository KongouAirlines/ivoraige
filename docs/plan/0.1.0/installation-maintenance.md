# 0.1.0 发行构建与验收

本页面向维护者，不随终端用户发行包分发。用户操作见 [安装指南](installation-guide.md)，验证历史见 [安装记录](installation.md)。

## 维护者构建

基础包与 PDF 组件分别构建，构建者需要工具链；终端用户只需下载产物。实现、证据和未完成验收见 [安装阶段记录](installation.md)。不要把仅缩减 PATH 的开发机探针称为干净系统验收。

清单中每个组件／平台／架构只发布一个严格 SemVer 版本；普通安装拒绝降级，允许同版本修复，不提供回滚入口。不要把多个候选版本写入同一平台的清单。

Windows x64 基础包固定使用 Node 26.7.0 构建，应用源码的最低 Node 要求仍为 24：

```powershell
npm ci
npm run setup:dsh
npm run build:distribution
```

PDF 构建使用 Python 3.13、锁定的 BabelDOC 0.6.4／PyMuPDF 1.26.7 和 PyInstaller 6.22.3。维护者先用开发准备脚本取得 BabelDOC 所需缓存，再构建独立组件：

```powershell
.\scripts\setup-pdf.ps1
.\scripts\build-pdf-component.ps1
```

产物在 `evaluation/runs/distribution-0.1.0-dev.0/`；`components/` 内的清单、运行时归档及资源归档必须一起上传到相同的私有 Release。基础包包含 Node 和前端许可，PDF 包含 Python 依赖许可，资源包包含 `assets/licenses/` 的来源映射及上游声明。构建后运行 `scripts/smoke-distribution.mjs` 检查实际发行内容，不用源码环境替代它。

### Windows Sandbox 验收

准备专用输入目录，放入基础 ZIP、组件清单与两个组件归档，以及 `scripts/run-sandbox-acceptance.ps1` 和 `scripts/smoke-distribution.mjs`。可放入原创 `fixture.pdf`；缺省使用脚本生成的单页样本。只读映射该目录到沙盒 `C:\Input`，将独立结果目录可写映射到 `C:\Results`，关闭网络即可运行本地组件验收。不要映射账户配置或整个源码工作区。

沙盒 `LogonCommand` 使用 `powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\Input\run-sandbox-acceptance.ps1`。脚本在沙盒本地解压到 `C:\Package`，使用内置 Node 执行验收，数据写入 `C:\Acceptance`。每轮使用新沙盒。

`C:\Results` 自动回传 `report.json`、`environment.json`、分离的 stdout／stderr、退出码、`evidence.json` 和已下载的产物；失败时也会回传已有证据。stdout 提供阶段进度。`report.json` 的 `passed` 为真且进程退出码为零才表示这轮通过；脚本进程被强制终止时可能仅有未完成的进度记录。基础 smoke 的 `cleanVmAcceptance: false` 是其默认环境标签，是否为真实沙盒需结合运行环境记录确认，不能单凭启动脚本名宣称干净系统验收。
