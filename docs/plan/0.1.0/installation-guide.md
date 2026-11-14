# 0.1.0 安装与首次启动

目前从源码运行。2026-10-19 已撤下 `v0.1.0`、`v0.1.0-dev.0` 的 Release 和附件，预构建安装包延后提供；提交历史保留。[源码仓库](https://github.com/KongouAirlines/ivoraige)现已公开，可直接检出源码。

## 从源码启动

### 环境要求

- **Node.js 与 npm**：默认使用 Node.js **26.13.0**（`.node-version`）和 npm。Node 24 仅保留兼容，运行时支持范围仍为 `>=24.22.1 <25 || >=26.12.1 <27`。源码运行可使用这两个受支持主版本内更新的稳定补丁版；Node 25 和未来主版本暂不在支持范围内。
- **Git**：用于取得固定版本的 DSH 运行时源码。
- **Python**：TXT／Markdown 工作流**不需要** Python。

### 启动步骤

检出仓库后，在根目录依次运行：

```sh
npm ci
npm run setup:dsh
npm run build
npm start
```

1. 启动后浏览器会自动打开工作台；也可直接访问终端打印的本机地址。
2. 首次体验可跳过模型设置：导入 TXT／Markdown，人工录入并接受译文，即可导出 MD／JSON。
3. 需要机器翻译时，按[设置指南](settings-guide.md)配置模型和凭据。在线模型会接收待译文本，并按供应商规则计费。
4. 退出服务时在终端按 `Ctrl+C`。

### 默认数据目录

用户数据默认与源码目录分开保存：

- **Windows**：`%LOCALAPPDATA%\ivoraige`
- **Linux / macOS**：`$XDG_DATA_HOME/ivoraige`（未设置时为 `~/.local/share/ivoraige`）
- 可通过环境变量 `IVORAIGE_DATA_DIR` 指定数据目录；更多运行方式见[开发指南](development-guide.md)。

## 可选 PDF

默认在线组件源指向已撤下的 `v0.1.0-dev.0` Release，目前无法从该默认源下载（配置 GitHub token 也不会恢复已撤下的附件）。

- **Windows 开发环境准备**：需要处理 PDF 时，按 [PDF 开发参考](pdf-development.md)准备 Windows x64 环境并带 `--pdf-config` 启动。该路径需要 `uv`、Python 依赖及首次联网下载的字体和模型资源。
- **复用已有组件或本地清单**：本机已安装的组件仍可继续使用，启动时不会查询远端版本。持有配套 `components-manifest.json` 和两个归档的用户，可在“设置 → PDF”选择本地清单安装；安装过程会校验文件尺寸、摘要及解压路径，完成后重启生效。具体操作见 [PDF 使用指南](pdf-guide.md)。
- **自定义组件源**：组件下载服务支持其他符合清单格式的来源。可通过 `IVORAIGE_COMPONENTS_REPOSITORY=owner/repo` 和 `IVORAIGE_RELEASE_TAG` 指定源；公开源允许匿名读取，私有源需要显式凭据（程序不会自动读取本机 `gh` 登录状态）。授权错误、限流及下载中断可在处理后重新发起；失败不会替换已选组件，下载不支持断点续传。

## 自行构建本地 npm 包

完成源码依赖与 DSH 准备后，可运行 `npm run pack:npm -- <输出目录>` 生成本地安装包 `ivoraige-0.1.0.tgz`（这是本机构建产物，不是官方下载附件）。将其放入新的程序目录后执行：

```sh
npm install ./ivoraige-0.1.0.tgz
node node_modules/ivoraige/src/launch.mjs
```

该包内置构建后的应用和指南；需要上述受支持版本的 Node.js，安装时联网取得 npm 依赖，无需再次运行 `setup:dsh`。它不包含独立 PDF 运行时。启动时可追加 `--data-dir <目录>` 或 `--no-open`。

## 数据与更新

- **完整备份**：正常退出程序后备份完整数据目录，包括 SQLite 数据库、PDF 原件、修订、快照、设置、凭据和组件。
- **程序更新**：更新程序时使用新目录并指向原数据目录，不要用程序文件覆盖数据目录。Windows 便携包内的 `runtime/node.exe` 独立于系统 Node；仅升级系统 Node 不会更新旧程序目录中的运行时。替换旧程序目录前先确认外置数据目录位置并完整保留，切勿将外置用户数据当作程序文件删除。
- **兼容性边界**：已有验收覆盖旧 Windows 包及 `0.1.0` macOS npm 包的同版本替换；跨版本迁移需单独验证。组件按版本保存，不自动更新或清理旧版本。撤下远端 Release 不会影响本机已装组件和用户数据。

## 离线独立来源插件

### 打包与交付边界

核心 npm 归档不包含 `plugins/mineru/`。同仓库的 `@ivoraige/mineru-source` 仅包含 MIT 许可的 JavaScript/Python 桥接、DSH 声明和许可文件，不含 MinerU 本体、Python、原生库或模型权重。可使用以下命令打包并解压至本地目录：

```sh
npm pack ./plugins/mineru --ignore-scripts
```

这是源码级桥接交付，不是开箱即用的 PDF 运行时，也不代表 P08 许可审计已完成。开发检出通过 `npm ci` 安装锁定的 `pnpm 11.25.0`；使用已发布归档的用户需从官方安装 `pnpm` 并加入 `PATH`（找不到时返回 `COMPONENT_MISSING`，不会先复制来源或开始安装事务）。

### 停机安装与管理命令

不同 `store` 可以共用同一个设置目录并同时运行：运行中的宿主持有共享读取租约；而安装、移除、恢复和回滚需要**独占写租约**，执行前必须先关闭使用该设置目录的全部宿主。并发启动会等待准备窗口（最多 5 秒，超时仍忙返回 `CONFLICT`）；安装器不会等待活跃宿主退出。

```sh
node src/plugin-install.mjs list /absolute/settings
node src/plugin-install.mjs install /absolute/settings /absolute/extracted-plugin '{"storePath":"/absolute/records.sqlite","config":{"directory":"/absolute/mineru-data","command":"/absolute/python"}}'
node src/plugin-install.mjs disable /absolute/settings @ivoraige/mineru-source
node src/plugin-install.mjs enable /absolute/settings @ivoraige/mineru-source '{"storePath":"/absolute/records.sqlite"}'
node src/plugin-install.mjs remove /absolute/settings @ivoraige/mineru-source
node src/plugin-install.mjs recover /absolute/settings
node src/plugin-install.mjs rollback /absolute/settings
```

安装包同时提供 `ivoraige-plugins` 命令（JSON 引号请按当前 shell 调整）：

- **参数与激活校验**：第四个参数只允许 `storePath`、`config` 和 `allowConfigOverwrite`，不能覆盖动作、目标目录或可执行程序；`storePath` 必须与宿主使用的数据库路径一致。安装时会验证插件激活，但不调用解析器、翻译模型或下载资源；原生组件在实际使用时由适配器检查，桥接安装成功不代表 OCR 已可用。
- **只读列表与重启生效**：`list` 只读取现有 `package.json`，不创建设置目录、不恢复事务，并明确标注可能未包含并发或未完成的变化。其余操作在下次启动宿主时生效；首次启动在独占租约下完成脚手架和恢复，已有宿主共享设置时不会重复写入。
- **故障恢复**：安装失败会自动恢复原包集合与配置。若残留 DSH 包进程仍存活，恢复会拒绝继续，应先确认并停止该进程；若诊断带 `recoveryPending` 和 `validationPid`，表示验证进程尚未退出，等待或停止该 PID 后再运行 `recover`。切勿在进程存活时手工删除锁文件、事务目录或恢复目录，也不要用旧宿主绕过所有权。嵌套插件贡献必须全部激活成功，停用时应停用整个包。
- **配置保留与回滚**：重复安装会替换安装器记录的配置项；禁用保留配置；移除仅删除安装器管理的配置项，不删除用户手工修改过的项。回滚会恢复前一次包操作之前的配置；若配置在操作后被改动或旧快照无基线，默认拒绝覆盖，备份确认后可传入 `'{"allowConfigOverwrite":true}'`。记录、快照、原始数据与凭据不在卸载范围内，应置于 profile 的 `node_modules` 之外。`.plugin-packages/source-*` 仅保留当前包集合、上次回滚点或未完成事务引用的版本。
- **平台与同身份冲突限制**：仅支持精确匹配固定 DSH 提交与 host API 的自包含本地包，无插件市场、后台更新、依赖下载、安装脚本或热卸载；插件使用宿主服务，不得自带第二个 DSH/Cordis。租约依赖本地磁盘 SQLite 锁和同文件系统 `rename`，不覆盖网络文件系统或断电耐久性。旧二进制不识别共享 profile 租约，包操作前必须停止所有旧宿主。独立 BabelDOC 包（`@ivoraige/babeldoc-source`）仍使用来源 ID `babeldoc` 和输出 ID `pdf`，不能与旧 `pdf` 选项或自动发现同时启用；同身份重复注册会明确拒绝启动并释放部分上下文和 store 租约。
