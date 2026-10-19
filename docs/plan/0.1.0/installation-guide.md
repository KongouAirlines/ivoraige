# 0.1.0 安装与首次启动

目前从源码运行。2026-10-19 已撤下 `v0.1.0`、`v0.1.0-dev.0` 的 Release 和附件，安装包延后提供；提交历史保留。项目正在准备正式开源，仓库切换公开前，取得源码仍需仓库访问权限。

## 从源码启动

需要 Git、Node.js ≥24 和 npm。Git 用于取得固定版本的 DSH；TXT／Markdown 不需要 Python。检出仓库后，在根目录运行：

```sh
npm ci
npm run setup:dsh
npm run build
npm start
```

浏览器会打开工作台；也可访问终端打印的本机地址。首次可跳过模型设置，导入 TXT／Markdown，人工录入并接受译文，再导出 MD／JSON。需要机器翻译时，按[设置指南](settings-guide.md)配置自己的模型和凭据。在线模型会接收待译文本，并按供应商规则收费。

退出时在终端按 Ctrl+C。默认数据与源码目录分开保存：Windows 为 `%LOCALAPPDATA%\ivoraige`，Linux/macOS 为 `$XDG_DATA_HOME/ivoraige`，后者未设置时使用 `~/.local/share/ivoraige`。可用 `IVORAIGE_DATA_DIR` 指定数据目录；更多运行方式见[开发指南](https://github.com/KongouAirlines/ivaraige/blob/main/docs/plan/0.1.0/development-guide.md)。

## 可选 PDF

默认在线组件源指向已撤下的 `v0.1.0-dev.0` Release，现在无法从该源下载；添加 GitHub token 不能恢复已删除的附件。需要 PDF 时，按 [PDF 开发参考](https://github.com/KongouAirlines/ivaraige/blob/main/docs/plan/0.1.0/pdf-development.md)准备 Windows x64 环境，并带 `--pdf-config` 启动。该路径需要 uv、Python 依赖及首次联网下载的字体和模型资源。

已经安装的组件仍可使用，启动时不会查询远端版本。持有配套 `components-manifest.json` 和两个归档的用户，也可以在设置 → PDF 选择本地清单安装；安装会检查尺寸、摘要及解压路径，完成后重启。具体处理范围见 [PDF 使用指南](pdf-guide.md)。

组件下载服务仍支持其他符合清单格式的来源。可通过 `IVORAIGE_COMPONENTS_REPOSITORY=owner/repo` 和 `IVORAIGE_RELEASE_TAG` 指定源；公开源允许匿名读取，私有源需要显式凭据。程序不会自动读取本机 gh 登录。授权错误、限流及下载中断可处理后重新发起；失败不替换已选组件，下载不续传。

## 自行构建本地 npm 包

完成源码准备后，可运行 `npm run pack:npm -- <输出目录>` 生成 `ivoraige-0.1.0.tgz`。这是本机构建，不是目前可下载的官方附件。将文件放入新的程序目录后执行：

```sh
npm install ./ivoraige-0.1.0.tgz
node node_modules/ivoraige/src/launch.mjs
```

该包包含构建后的应用和指南；需要 Node.js ≥24，安装时联网取得依赖，不需要再次构建 DSH。它不包含独立 PDF 运行时。可追加 `--data-dir <目录>` 或 `--no-open`。

## 数据与更新

正常退出后备份完整数据目录，包括数据库、PDF 原件、修订、快照、设置、凭据和组件。更新程序时使用新目录，再指向原数据目录，不要用程序文件覆盖数据。

已有验收覆盖旧 Windows 包及 `0.1.0` macOS npm 包的同版本替换；跨版本迁移需单独验证。组件按版本保存，不自动更新或清理旧版本。删除 Release 不会删除本机组件和用户数据。
