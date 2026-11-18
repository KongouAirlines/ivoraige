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

## 离线独立来源插件

核心 npm 归档不再包含 `plugins/mineru/`。同仓库的 `@ivoraige/mineru-source`
只包含 MIT 许可的 JavaScript/Python 桥接、DSH 声明和许可文件，不含 MinerU、
Python、原生库或模型权重。使用 `npm pack ./plugins/mineru --ignore-scripts` 打包，
再解压至本地目录。这是源码交付，不是开箱即用的 PDF 运行时，也不代表 P08 许可审计完成。

不同 store 可以共用同一个设置目录并同时运行。宿主持有共享读取租约；安装、移除、
恢复和回滚需要独占写租约，必须先关闭使用该设置目录的全部宿主。
并发启动会等待准备窗口，最多 5 秒；超时仍忙时返回 CONFLICT。安装器不等待活跃宿主退出。
开发检出通过 `npm ci` 安装锁定的 pnpm 11.25.0；已发布归档的用户需要从官方安装 pnpm
并放入 PATH。找不到时返回 `COMPONENT_MISSING`，不会先复制来源或开始安装事务。

```sh
node src/plugin-install.mjs list /absolute/settings
node src/plugin-install.mjs install /absolute/settings /absolute/extracted-plugin '{"storePath":"/absolute/records.sqlite","config":{"directory":"/absolute/mineru-data","command":"/absolute/python"}}'
node src/plugin-install.mjs disable /absolute/settings @ivoraige/mineru-source
node src/plugin-install.mjs enable /absolute/settings @ivoraige/mineru-source '{"storePath":"/absolute/records.sqlite"}'
node src/plugin-install.mjs remove /absolute/settings @ivoraige/mineru-source
node src/plugin-install.mjs recover /absolute/settings
node src/plugin-install.mjs rollback /absolute/settings
```

安装包还提供 `ivoraige-plugins` 命令。JSON 引号按当前 shell 调整。
第四个参数只允许 `storePath`、`config` 和 `allowConfigOverwrite`，不能覆盖动作、
目标目录或可执行程序。`storePath` 必须与宿主一致。安装时会验证插件激活，不调用解析器、
翻译模型或下载资源。原生组件在实际使用时由适配器检查，桥接安装成功不代表 OCR 可用。

`list` 只读现有 package.json，不创建设置目录、不恢复事务，并明确标注可能未包含并发或未完成的变化。
其余操作重启生效。第一次启动在独占租约下完成脚手架和恢复；已有宿主共享设置时不会再次写入这些文件。
安装失败恢复原包集合与配置。若残留 DSH 包进程仍活着，恢复会拒绝继续，应先确认并停止该进程。
若诊断带 recoveryPending 和 validationPid，验证进程尚未退出；等待或确认停止该 PID 后再运行 recover。
不要删除事务目录，也不要用旧宿主绕过所有权。
嵌套插件贡献必须全部激活成功；需要停用时应停用整个包。
不要在进程仍存活时手工删除锁文件或恢复目录。

重复安装会替换本安装器记录的配置项；禁用保留配置，移除删除安装器管理的配置项，
不会删除用户后来手工改过的项。回滚会恢复前一次包操作之前的配置；若配置已在操作后改动，
或旧快照没有基线，默认拒绝覆盖。先备份并确认后可使用
`rollback /absolute/settings unused '{"allowConfigOverwrite":true}'`。
记录、快照、原始数据与凭据不在卸载范围，应放在 profile 的 node_modules 之外。
`.plugin-packages/source-*` 只保留当前包集合、上次回滚点或未完成事务引用的版本，
失败和提交后的清理不会删除这些仍被引用的来源；清理失败不改变已提交事务的结果。

仅支持精确匹配固定 DSH 提交与 host API 的自包含本地包，没有市场、后台更新、依赖下载、
安装脚本或热卸载。插件使用宿主服务，不能自带第二个 DSH/Cordis。租约依赖本地磁盘的
SQLite 锁和同文件系统 rename，不覆盖网络文件系统或物理断电耐久性。旧二进制不理解
新的共享 profile 租约，包操作前也必须停止所有旧宿主，不得混用旧安装器更改活跃 profile。

未来独立 BabelDOC 包仍使用来源 id `babeldoc` 和输出 id `pdf`，不能同时启用旧 `pdf`
选项或自动发现。同身份重复注册会明确拒绝启动并释放部分上下文和 store 租约；旧适配器单独配置仍可使用。
