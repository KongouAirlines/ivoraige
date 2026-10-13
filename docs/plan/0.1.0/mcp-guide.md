# 0.1.0 MCP 使用指南

ivoraige 的 MCP 入口把已装插件贡献的内核能力提供给本机 AI 客户端。当前代码使用官方 TypeScript MCP SDK `@modelcontextprotocol/server` 2.3.1 和 `@modelcontextprotocol/node` 2.1.1，提供 stdio 与 Streamable HTTP；文档工具参数沿用 CLI／HTTP 的内核 schema。工具和资源随插件装卸更新，因此客户端发现到的列表以正在运行的实例为准。软件版本为 `0.1.0-dev.0`，Windows 上已完成官方 SDK 双 transport 测试及 DSH 0.2.0-rc.2 的真实 HTTP 客户端闭环；其他客户端需按其配置方式验证。

## 连接方式

源码运行需要 Node.js 24 或更新版本，并先按[安装指南](installation-guide.md)完成依赖和 DSH 构建。从仓库运行时，命令可写成 `node C:/path/to/ivoraige/src/cli.mjs`；安装后使用 `ivoraige` 命令。以下示例中的路径都要换成服务器上的实际绝对路径。

**连接已经运行的工作台**：常驻服务 `ivoraige serve --store C:/data/ivoraige/store.sqlite` 默认在 `http://127.0.0.1:8787/mcp` 提供 Streamable HTTP。桌面启动器也默认在其实际监听端口的 `/mcp` 提供同一入口；它会在启动时输出服务 URL。HTTP MCP、WebUI 和 HTTP CLI 共用该进程的内核、数据库、设置与任务。`ivoraige serve --no-mcp` 关闭 MCP 入口。为保证本机访问边界，HTTP 服务只允许回环监听，并检查 Host 与 Origin；当前没有非回环认证配置。

**由客户端启动独立进程**：使用 `ivoraige mcp --stdio --store C:/data/ivoraige/store.sqlite`。这个进程持有自己的内核与数据库锁，标准输出供 MCP 协议使用。不要让它与已打开相同数据库的工作台并行运行；若需要共用工作台中的文档和任务，请连接工作台的 `/mcp`。省略 `--store` 会使用 CLI 的默认数据路径，先用 `ivoraige_capabilities` 核对实际数据目录。

通用 MCP 客户端的 stdio 配置形状如下。客户端产品的配置文件位置和字段名称可能不同，以该客户端文档为准：

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

若客户端支持 Streamable HTTP，连接地址为运行中的服务 URL 加 `/mcp`，例如 `http://127.0.0.1:8787/mcp`。连接 HTTP 不另启一个持有数据库的进程。以上是通用配置示意；本次真实 AI 客户端验证使用 DSH headless 的 Streamable HTTP，具体证据见 [MCP 阶段记录](mcp.md)。Windows 目录发行包的 stdio 客户端宜直接把 `runtime/node.exe` 的绝对路径作为 command，args 为 `["C:/包目录/app/src/cli.mjs", "mcp", "--stdio", "--store", "C:/data/ivoraige/store.sqlite"]`，无需依赖系统 Node 或让客户端执行 `.cmd`。官方 SDK 的 [HTTP 服务说明](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/serving/http.md)、[stdio 服务说明](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/serving/stdio.md) 和 [客户端连接说明](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/clients/connect.md) 解释传输机制。

## 工具与工作流程

先调用 `ivoraige_capabilities` 查看已装输入／输出格式、组件和数据目录。导入时，`ivoraige_import` 必须且只能提供服务器可读的 `path` 或 `contentBase64`。文本的 `contentBase64` 是 UTF-8 字节的标准 base64，PDF 则是原始 PDF 字节的 base64，并应指定 `format: "pdf"`。`language` 为源语言，例如 `en`。`path` 指 MCP **服务器**上的文件；导出 `outputs[].out` 也指服务器上的目标路径，不能当作客户端机器的本地路径。上传内容避免了客户端与服务器文件系统不相通的问题。PDF 格式取决于可选 BabelDOC 组件，先检查 capabilities。

TXT／Markdown 导入可直接返回完成结果；PDF 导入返回持久任务。翻译 `ivoraige_translate` 和导出 `ivoraige_export` 也返回任务句柄。用 `ivoraige_task_status` 查询，或传 `waitSeconds` 在 0～60 秒内等待一次状态变化；仍未结束就继续查询。HTTP 连接实际断开只停止当次等待，不会取消持久任务。旧协议客户端仅发送取消通知而不断开请求时，无状态 HTTP 不关联跨请求取消；当次等待最多在 `waitSeconds` 到期后结束。明确取消须调用 `ivoraige_task_cancel`。暂停与恢复分别使用 `ivoraige_task_pause`、`ivoraige_task_resume`，以任务当前生命周期为准；翻译或恢复可能产生模型用量。

审校可按 `ivoraige_documents_list` → `ivoraige_units_list`／`ivoraige_unit_get` → `ivoraige_revisions_list` 查看文档和语言范围内的版本。`ivoraige_unit_update` 保存人工修订时传最新的 `baseRevisionId`，没有现存修订时传 `null`；`ivoraige_revision_accept` 和 `ivoraige_unit_unaccept` 使用最新的 `expectedAcceptedRevisionId`。收到 `CONFLICT` 后重读单位／修订再编辑，不能覆盖别人的修改。导出从已接受修订或指定 `snapshotId` 建立冻结输出；同一导出任务的格式共用快照，导出不调用翻译模型。

`ivoraige_artifacts_list` 可查到已保存产物，随后读取 `ivoraige://artifacts/{artifactId}` 资源，得到 MIME 类型和 base64 二进制内容。文档、单位、任务资源分别是 `ivoraige://docs/{docId}`、`ivoraige://docs/{docId}/units/{unitId}?targetLang={language}`、`ivoraige://tasks/{taskId}`；它们返回包含 JSON 的 Markdown。资源本身不枚举 ID，先通过对应列表工具取得 ID。读取产物资源只读取已有字节，不重新导出。

当前还提供快照列表／读取／删除与任务列表工具。设置服务存在时才显示 `ivoraige_settings_get`、`ivoraige_settings_update`、`ivoraige_credential_set`；组件安装服务存在时才显示 `ivoraige_component_*` 工具。设置修改、保存模型凭据／仓库令牌和安装组件拥有本机内核的完整写入能力，应在用户明确要求后调用。服务仅限回环访问，但同机可访问该端口的客户端将获得这些工具；请控制本机客户端的访问。当前没有 RAG、术语库或独立文本翻译工具。

完整当前工具映射见 [v2.0 API 协议 §6](../../requirements/v2.0/03_API-protocol_v2.0.md#6-mcp-tools-映射)。成功工具响应的 `structuredContent` 是带 `apiVersion` 的内核业务对象，文本 content 是同一对象的 JSON。业务错误标记 `isError: true`，并在 `structuredContent` 中返回 `{ apiVersion, error: { code, message, details } }`；参数违反工具输入 schema 时由 MCP SDK 返回协议级校验错误。资源失败返回 MCP 协议错误。若任务失败，查询任务状态和其中的错误信息。

插件装卸后，支持现代协议订阅的 HTTP 客户端会收到工具／资源列表变化通知；使用官方 JS SDK 2.x 时配置 `versionNegotiation: { mode: "auto" }` 和 `listChanged` 回调。旧协议无状态 HTTP 不推送变化（`listChanged: false`），需要重新查询列表；stdio 保留连接内通知。
