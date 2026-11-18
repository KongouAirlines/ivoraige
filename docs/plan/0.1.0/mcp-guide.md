# 0.1.0 MCP 使用指南

ivoraige 的 MCP 入口将已装插件贡献的内核能力提供给本机 AI 客户端。当前代码使用官方 TypeScript MCP SDK `@modelcontextprotocol/server` 2.4.0 和 `@modelcontextprotocol/node` 2.1.2，提供 `stdio` 与 `Streamable HTTP` 两种传输方式；文档工具参数沿用 CLI／HTTP 的内核 schema。工具和资源列表随插件装卸动态更新，客户端发现到的能力以正在运行的实例为准。

本页对应 `0.1.0` 源码；旧 `0.1.0-dev.0` Windows 附件不代表本页的 MCP 交付范围。历史 Windows 验证覆盖官方 SDK 双 transport 及 DSH `0.2.0-rc.2` 的真实 HTTP 客户端闭环（证据见源码中的 [MCP 阶段记录](mcp.md)）；其他客户端需按其配置方式验证。

## 连接方式

目前不提供预构建下载包，请从源码构建运行：默认使用 Node.js **26.13.0**，Node 24 仅保留兼容（支持范围 `>=24.22.1 <25 || >=26.12.1 <27`，可使用这两个主版本内更新的稳定补丁版），并先按[开发指南](development-guide.md)完成依赖和 DSH 构建。从仓库运行时命令为 `node C:/path/to/ivoraige/src/cli.mjs`；安装包含 MCP 的本地 npm 包后可使用 `ivoraige` 命令。以下示例中的路径均需替换为服务器上的实际绝对路径。

### 1. 连接已运行的工作台（Streamable HTTP）

常驻服务 `ivoraige serve --store C:/data/ivoraige/store.sqlite` 默认关闭 HTTP MCP。只在本次运行中需要它时使用 `ivoraige serve --store C:/data/ivoraige/store.sqlite --mcp-enabled`，在 `http://127.0.0.1:8787/mcp` 提供 Streamable HTTP；`--no-mcp` 优先将它关闭。启动器不会默认启用 HTTP MCP，目前也没有持久的启用开关。`/mcp` 与所有 `/api/*` 路由一样需要已配对的浏览器 owner 会话；普通 HTTP MCP 客户端不能凭回环地址或服务 URL 获得授权。HTTP 仅监听回环地址，并另外检查 Host 与 Origin。具体边界见[本机宿主指南](../0.1.x/host-control-guide.md)。

### 2. 附加到常驻宿主（stdio）

先启动同一 store 的常驻宿主，再使用 `ivoraige mcp --stdio --store C:/data/ivoraige/store.sqlite`。桥接进程连接已有 owner，不创建内核或持有第二把数据库锁；owner 缺席或只是临时 owner 时直接报错。标准输出仅供 MCP 协议使用；关闭客户端/stdin 只断开桥接，不停止常驻宿主。省略 `--store` 会使用 CLI 的默认数据路径，须确保与已启动宿主一致。

通用 MCP 客户端的 `stdio` 配置示例（具体配置文件位置和字段名以各客户端文档为准）：

```json
{
  "mcpServers": {
    "ivoraige": {
      "command": "ivoraige",
      "args": ["mcp", "--stdio", "--store", "C:/data/ivoraige/store.sqlite"]
    }
  }
}
```

对于从本源码构建的 Windows 目录发行包，`stdio` 客户端宜直接将 `runtime/node.exe` 的绝对路径作为 `command`，`args` 设为 `["C:/包目录/app/src/cli.mjs", "mcp", "--stdio", "--store", "C:/data/ivoraige/store.sqlite"]`，无需依赖系统 Node 或通过 `.cmd` 启动。仅升级系统 Node 不会更新旧程序目录中的便携运行时；更新目录包时应替换程序目录并保留外置数据目录。传输机制说明可参考官方 SDK 的 [HTTP 服务说明](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/serving/http.md)、[stdio 服务说明](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/serving/stdio.md) 和 [客户端连接说明](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/clients/connect.md)。

## 工具与工作流程

完整工具映射见 [v2.0 API 协议 §6](../../requirements/v2.0/03_API-protocol_v2.0.md#6-mcp-tools-映射)。

### 能力发现与文档导入

1. 先调用 `ivoraige_capabilities` 查看已装输入／输出格式、组件状态和数据目录。
2. 调用 `ivoraige_import` 导入文档时，必须且只能提供服务器可读的 `path` 或 `contentBase64`：
   - 文本的 `contentBase64` 为 UTF-8 字节的标准 Base64；PDF 则为原始 PDF 字节的 Base64，并应指定 `format: "pdf"`（PDF 格式依赖可选组件，请先核对 capabilities）。
   - `format` 也可填写已装配来源插件声明的格式；同一格式存在多个实现时，可通过 `adapterId` 指定来源适配器，导出的每个 `outputs[]` 也可通过 `adapterId` 指定输出适配器（省略时来源按最高匹配分选择，并列最高分或多兼容输出实现返回 `CONFLICT`）。
   - `language` 指定源语言（如 `en`）。
   - **路径归属**：导入的 `path` 与导出的 `outputs[].out` 均指 **MCP 服务器所在机器**上的路径，不能当作远程客户端本地路径；跨上下文时建议使用 `contentBase64` 上传并通过产物资源读取结果。

### 任务轮询与生命周期

- TXT／Markdown 导入可直接返回完成结果；PDF 导入、翻译（`ivoraige_translate`）和导出（`ivoraige_export`）均返回持久任务句柄。
- 使用 `ivoraige_task_status` 查询任务状态，或传入 `waitSeconds`（0～60 秒）等待一次状态变化；若到期仍未结束可继续轮询。
- **断连与取消语义**：HTTP 连接实际断开仅释放当次轮询订阅，**不会取消后台持久任务**。旧协议客户端仅发送取消通知而不断开请求时，无状态 HTTP 不关联跨请求取消，当次等待最多在 `waitSeconds` 到期后结束。明确取消任务须调用 `ivoraige_task_cancel`；暂停与恢复分别使用 `ivoraige_task_pause`、`ivoraige_task_resume`（翻译或恢复可能产生模型调用计费）。

### 审校、修订与资源读取

- **审校与乐观锁**：按 `ivoraige_documents_list` → `ivoraige_units_list`／`ivoraige_unit_get` → `ivoraige_revisions_list` 查看文档和指定语言范围内的修订。单位列表、单位资源和修订查询必须指定 `targetLang`（BCP-47 语言标签；缺失、留空或非法标签会报参数或模板不匹配错误）。
  - `ivoraige_unit_update` 保存人工修订时传入最新的 `baseRevisionId`（尚无修订时传 `null`）。
  - `ivoraige_revision_accept` 和 `ivoraige_unit_unaccept` 传入最新的 `expectedAcceptedRevisionId`。
  - 若收到 `CONFLICT`，需重新读取单位与修订后再编辑，切勿盲目覆盖。
- **冻结导出与资源 URI**：导出从已接受修订或指定 `snapshotId` 建立冻结输出，同一导出任务的多格式共用快照且不调用翻译模型。
  - 通过 `ivoraige_artifacts_list` 获取产物 ID 后，读取 `ivoraige://artifacts/{artifactId}` 资源可获得 MIME 类型与 Base64 二进制内容（仅读取已有字节，不重新导出）。
  - 文档、单位、任务资源 URI 分别为 `ivoraige://docs/{docId}`、`ivoraige://docs/{docId}/units/{unitId}?targetLang={language}`、`ivoraige://tasks/{taskId}`（返回包含 JSON 的 Markdown；请先通过对应列表工具获取 ID）。

### 权限边界、响应格式与动态通知

- **写权限控制**：当前还提供快照列表／读取／删除与任务列表工具；设置服务挂载时暴露 `ivoraige_settings_get`、`ivoraige_settings_update`、`ivoraige_credential_set`，组件安装服务挂载时暴露 `ivoraige_component_*` 工具。修改设置、保存凭据／仓库令牌和安装组件拥有本机内核完整写权限，应在用户明确要求后调用。这些工具通过受保护的 stdio 桥接或已配对的 HTTP 会话访问。当前没有 RAG、术语库或独立文本翻译工具。
- **返回结构与错误**：成功工具响应的 `structuredContent` 为带 `apiVersion` 的内核业务对象，文本 `content` 为同一对象的 JSON 字符串。业务错误标记 `isError: true`，并在 `structuredContent` 中返回 `{ apiVersion, error: { code, message, details } }`；违反输入 schema 的参数由 MCP SDK 直接返回协议级校验错误；资源读取失败返回 MCP 协议错误。
- **列表变化通知**：插件装卸后，支持现代协议订阅的 HTTP 客户端会收到工具／资源列表变化通知（使用官方 JS SDK 2.x 时配置 `versionNegotiation: { mode: "auto" }` 和 `listChanged` 回调）；旧协议无状态 HTTP 不推送变化（`listChanged: false`），需重新查询列表；附加式 `stdio` 请重新查询或重连。

### 开发验收依赖

以下验收仅供源码开发使用，脚本不随用户发行包分发。零模型调用的真实 PDF 回放验收[脚本](../../../scripts/smoke-mcp-pdf.mjs)需要可用的 BabelDOC 配置及 Poppler `pdftoppm`（在 `PATH` 中，或通过 `PDFTOPPM_PATH` 指定可执行文件；Poppler 仅用于开发验收，不是正式运行依赖）。传入目录作为验收父目录，脚本每次自动创建独立的 `run-*` 子目录并打印实际报告路径：遍历所有单位分页，核对 PDF/MD/JSON 三种产物齐全，接受新修订后重放旧快照，并比较同一环境下的逐页渲染摘要及 MD/JSON 字节。缺少渲染工具或比较失败时验收直接失败并写入报告，不跳过 PDF 断言。

## Q02 retention tools

任务失败后保留重试能力及所引用的导出快照：

- **放弃失败任务（`ivoraige_task_abandon`）**：将失败任务状态设为 `abandoned`，保留错误与历史记录，同时释放其对导出快照的重试占用。
- **删除产物记录或受管文件（`ivoraige_artifact_delete`）**：默认 `fileAction: "retain"` 仅删除产物记录并返回 `retainedPath`，保留磁盘文件字节（显式外部输出文件及无归属标记的旧记录仅支持此模式）。仅在需要物理删除内核默认导出目录中的受管文件时，才指定 `fileAction: "delete-owned"`。
- **查询与恢复清理标记（`ivoraige_artifact_cleanup_list`）**：若受管文件物理删除失败，`ivoraige_artifact_cleanup_list` 会列出持久化的清理标记；排除故障原因后对同一产物重新执行删除即可完成清理。
