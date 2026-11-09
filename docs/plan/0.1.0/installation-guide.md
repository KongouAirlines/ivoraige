# 0.1.0 安装与首次启动

目前从源码运行。2026-10-19 已撤下 `v0.1.0`、`v0.1.0-dev.0` 的 Release 和附件，安装包延后提供；提交历史保留。[源码仓库](https://github.com/KongouAirlines/ivoraige)现已公开，可直接取得源码。

## 从源码启动

需要 Git、默认 Node.js 26.13.0（`.node-version`）和 npm。Node 24 仅保留兼容，运行时范围仍为 `>=24.22.1 <25 || >=26.12.1 <27`。源码运行可使用这两个受支持主版本内更新的稳定补丁版；Node 25 和未来主版本暂不在支持范围内。Git 用于取得固定版本的 DSH；TXT／Markdown 不需要 Python。检出仓库后，在根目录运行：

```sh
npm ci
npm run setup:dsh
npm run build
npm start
```

浏览器会打开工作台；也可访问终端打印的本机地址。首次可跳过模型设置，导入 TXT／Markdown，人工录入并接受译文，再导出 MD／JSON。需要机器翻译时，按[设置指南](settings-guide.md)配置自己的模型和凭据。在线模型会接收待译文本，并按供应商规则收费。

退出时在终端按 Ctrl+C。默认数据与源码目录分开保存：Windows 为 `%LOCALAPPDATA%\ivoraige`，Linux/macOS 为 `$XDG_DATA_HOME/ivoraige`，后者未设置时使用 `~/.local/share/ivoraige`。可用 `IVORAIGE_DATA_DIR` 指定数据目录；更多运行方式见[开发指南](development-guide.md)。

## 可选 PDF

默认在线组件源指向已撤下的 `v0.1.0-dev.0` Release，现在无法从该源下载；添加 GitHub token 不能恢复已删除的附件。需要 PDF 时，按 [PDF 开发参考](pdf-development.md)准备 Windows x64 环境，并带 `--pdf-config` 启动。该路径需要 uv、Python 依赖及首次联网下载的字体和模型资源。

已经安装的组件仍可使用，启动时不会查询远端版本。持有配套 `components-manifest.json` 和两个归档的用户，也可以在设置 → PDF 选择本地清单安装；安装会检查尺寸、摘要及解压路径，完成后重启。具体处理范围见 [PDF 使用指南](pdf-guide.md)。

组件下载服务仍支持其他符合清单格式的来源。可通过 `IVORAIGE_COMPONENTS_REPOSITORY=owner/repo` 和 `IVORAIGE_RELEASE_TAG` 指定源；公开源允许匿名读取，私有源需要显式凭据。程序不会自动读取本机 gh 登录。授权错误、限流及下载中断可处理后重新发起；失败不替换已选组件，下载不续传。

## 自行构建本地 npm 包

完成源码准备后，可运行 `npm run pack:npm -- <输出目录>` 生成 `ivoraige-0.1.0.tgz`。这是本机构建，不是目前可下载的官方附件。将文件放入新的程序目录后执行：

```sh
npm install ./ivoraige-0.1.0.tgz
node node_modules/ivoraige/src/launch.mjs
```

该包包含构建后的应用和指南；需要上述受支持版本的 Node.js，安装时联网取得依赖，不需要再次构建 DSH。它不包含独立 PDF 运行时。可追加 `--data-dir <目录>` 或 `--no-open`。

## 数据与更新

正常退出后备份完整数据目录，包括数据库、PDF 原件、修订、快照、设置、凭据和组件。更新程序时使用新目录，再指向原数据目录，不要用程序文件覆盖数据。Windows 便携包内的 `runtime/node.exe` 独立于系统 Node；仅升级系统 Node 不会更新旧程序目录中的运行时。替换旧程序目录时先确认外置数据目录的位置并保留其全部内容，不要把外置用户数据当作程序文件删除。

已有验收覆盖旧 Windows 包及 `0.1.0` macOS npm 包的同版本替换；跨版本迁移需单独验证。组件按版本保存，不自动更新或清理旧版本。删除 Release 不会删除本机组件和用户数据。

## Offline independent source plugins

The core npm archive no longer contains `plugins/mineru/`. The same-repository
`@ivoraige/mineru-source` package contains the MIT JavaScript/Python bridge,
DSH declaration patch and its license, not MinerU, Python, native libraries or
model weights. Pack it with `npm pack ./plugins/mineru --ignore-scripts`, then
extract the resulting archive to a local directory. This is source delivery,
not a ready-to-run PDF runtime or completion of the P08 license/resource audit.

Close every host using the settings directory before changing packages. Install
`pnpm` (tested version 11.25.0) from its official distribution if it is not already available; package
operations require its executable on PATH. From a source checkout after build:

```sh
node src/plugin-install.mjs list /absolute/settings
node src/plugin-install.mjs install /absolute/settings /absolute/extracted-plugin '{"storePath":"/absolute/records.sqlite","config":{"directory":"/absolute/mineru-data","command":"/absolute/python"}}'
node src/plugin-install.mjs disable /absolute/settings @ivoraige/mineru-source
node src/plugin-install.mjs enable /absolute/settings @ivoraige/mineru-source '{"storePath":"/absolute/records.sqlite"}'
node src/plugin-install.mjs remove /absolute/settings @ivoraige/mineru-source
node src/plugin-install.mjs recover /absolute/settings
node src/plugin-install.mjs rollback /absolute/settings
```

The installed npm package also exposes `ivoraige-plugins` with these arguments.
Quote JSON according to your shell. `storePath` must be the same store used at
host launch. Installation checks plugin activation without invoking a parser,
translation model or downloading resources. Native runtime availability is
checked by the adapter on use; an installed bridge is not evidence of working OCR.

Changes take effect on restart. An open host rejects changes. Failed installation
restores the complete prior package set and profile configuration. Interrupted
transactions recover before AppBoot; `recover` and `disable` work without a UI or
loading optional plugins. `rollback` restores the last successful operation's
previous package set and its configuration: later profile edits may be replaced.
Records, snapshots, source data and credentials are not removed on uninstall.
Keep them outside the profile's `node_modules` package directory. Immutable local
package sources and the previous package snapshot are retained for recovery.

Only self-contained local packages for the exact pinned DSH commit and host API
are supported. There is no registry marketplace, background update, dependency
downloader, package-script execution or hot unload. The plugin uses host services;
it must not ship its own DSH/Cordis runtime. Local-disk SQLite ownership and
same-filesystem rename are required; network filesystems and physical power-loss
durability are not validated. A surviving DSH package process blocks recovery
until it exits. Older host binaries do not understand the profile lease: keep
all hosts closed when using this entry.

A future independent BabelDOC package retaining source id `babeldoc` and output
id `pdf` must not also enable the legacy `pdf` option or component auto-discovery.
Duplicate ownership is an explicit startup error; the partial context and store
lease are released. Existing legacy-only PDF configuration remains supported.

If cancellation reports `recoveryPending`, a validation process has not exited.
The diagnostic includes its PID. Let it exit or stop that specific process, then
run `recover`; do not delete the transaction directory or launch an older host to
bypass ownership. Nested plugin contributions must all activate successfully;
disable the whole bundle rather than declaring dormant child entries.
