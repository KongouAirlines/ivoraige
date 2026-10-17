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

## 发布前的文档核对

- 英文 README 与中文版功能、平台和限制一致；截图来自该阶段真实界面，样本可公开。
- 能力表只计入该源码版本实际实现并验证的范围；MCP 入口与用户指南、中文 README、截图和能力表均须保留在对应包中。已有 Release 附件未包含 MCP 时，不能沿用新源码能力声明冒充旧包能力。
- npm 与 Windows 包均应包含用户指南、双语 README、截图和能力表；开发与验收材料保留在源码。检查本地文档链接的目标是否随包存在，源码参考明确为在线链接。
- 核对 Release 附件的构建提交、tag 和指南对应关系，不能以 main 的最新说明替代旧安装版说明；该项按 [release-documentation-binding](../follow-ups/release-documentation-binding.md) 完成。
- 仓库可见性、拆仓及完整安装器分别决策；本轮文档整理不发布新版本或修改现有附件。

## 版本、源码与随包指南绑定

构建会把 `docs/plan/0.1.0/` 中的用户指南生成到 `dist/web/*.html`，设置中的 PDF 指南使用本地 `/pdf-guide.html`。`dist/web/release-info.json` 记录 `package.json` 的软件版本、Git 提交、工作树状态和源码链接；页面也展示该信息。开发工作树含未提交改动时，`sourceTree` 为 `modified` 且 `sourceUrl` 为空：此时提交链接仅表示基础提交，不能当作该构建的精确源码。无 `.git` 的源码归档仍可构建，元数据记为 `unavailable`，提交和源码 URL 均为空；这种构建不能通过正式发行校验。用户指南 HTML 随包保存，后续 main 更新不会改变已下载的页面。

Windows 目录包由 `scripts/build-distribution.mjs` 复制双语 README、用户指南、截图、贡献及安全说明，并检查这些文档在包内的相对链接。开发材料若没有随包复制，其链接改为该次基础提交的在线源码地址。npm 包使用 `npm run pack:npm -- <输出目录>` 从临时目录生成：复制用户文档并将开发资料链接固定到来源提交，不修改工作树中的 Markdown。`npm run smoke:package` 在这一实际 tarball 上核对链接，并通过包内 HTTP 服务读取 PDF 指南与元数据。私有仓库的在线源码链接仍要求仓库访问权；本地指南不需要网络。Windows ZIP 的实际启动与内容验收仍须在 Windows x64 执行，macOS 上的 npm 检查不能代替它。

正式发布时先确定新的软件版本并完成源码提交，在该提交上创建与 `package.json` 一致的 `v<version>` tag；不要移动旧 tag。首个正式版本 `0.1.0` 发布源码与 npm 安装包，Windows 新包保留待构建、待验收；旧预发行附件不重新标记版本。

在干净的 tag 工作树构建 npm 包并验证：

```sh
npm run pack:npm -- evaluation/runs/release-0.1.0
npm run verify:release -- v0.1.0 evaluation/runs/release-0.1.0/ivoraige-0.1.0.build-evidence.json
```

打包命令同时产生实际 `.tgz` 和构建证据。校验会先从该 tag 工作树重建执行文件，再逐一比对 tarball 内的源码、依赖声明、构建文件及文档，拒绝缺失、多余或内容不一致的文件；也会从该提交的 Markdown 重新生成指南，避免把旧构建误标为新版本。因此校验环境需要构建依赖和固定的 DSH 源码。发布前仍需在隔离目录安装并实际启动该包；此检查不代表 Windows／PDF 验收。

后续 Windows 版本使用干净的 tag 工作树在 Windows x64 重新构建 ZIP，并在 Windows（或 macOS 的 bsdtar 环境）运行：

```sh
npm run verify:release -- v<version> evaluation/runs/distribution-<version>/build-evidence.json
```

校验要求 tag 指向构建提交、指南元数据匹配版本与提交、构建证据中的源码一致，ZIP 大小及 SHA-256 与证据一致，并从源码 Markdown 重新生成预期页面，逐一对比 ZIP 内的元数据、HTML 与用户文档，检查相对链接及基础运行载荷是否存在。此校验不执行 Windows 程序；运行验收仍按前述 Sandbox 步骤进行。Release 正文按 [发行说明模板](release-template.md)填写精确 tag、提交、附件摘要及实际验收范围；不要把附件源码和 GitHub 自动生成的 tag 源码指向不同提交。旧 `v0.1.0-dev.0` 的 tag 和附件保留历史事实，本机制不追认或修改它们。
