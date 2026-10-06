# TXT／Markdown 工作台试用

以下命令在仓库根目录的 PowerShell 执行；需要 Node.js ≥24。首次准备后启动本机服务：

```powershell
npm ci
npm run setup:dsh
npm run build
node src/cli.mjs serve --store .\evaluation\runs\workbench\store.sqlite
```

终端会打印服务地址，默认是 `http://127.0.0.1:8787`。保持该终端运行，在浏览器打开地址。当前服务只监听本机回环地址；同一 SQLite 文件一次只交给这个服务进程使用。

首次使用在“设置”页点击“填入 DeepSeek 示例配置”，核对后点击“保存模型设置”。按钮按仓库的 [DeepSeek 配置示例](../../../examples/translation-deepseek.json)填入 `deepseek-translation`／`deepseek-flash`、`https://api.deepseek.com`、`DeepSeek_API_TOKEN`、容量和推理选项；仍需用户主动保存。在下方凭据框输入自己的 API Key 并保存；设置读取只显示凭据状态。保存凭据不发起模型请求，点击翻译才会调用该端点。也可直接修改表单接入其他兼容端点。

在首页或“文档”页选择 [scientific-en.txt](../../../examples/scientific-en.txt)，导入前确认“原文”为 English。打开文档工作台，选“精细 · 保留草稿”翻译全文；任务页显示进度。回到工作台逐段查看原文与草稿，可直接修改译文，点击“保存草稿”，再点击“接受译文”。在“上下文与输出”区勾选 MD／JSON，点击“创建冻结快照并导出”，完成后从“已生成文件”下载；窄屏时先点“显示上下文与输出 →”。导出只使用已接受的修订，不调用模型；若尚有未接受的可译段落，默认导出会报前置条件错误。Markdown 的短片段可能缺少跨标记语境，接受前须逐段审校。

按 Ctrl+C 停止服务后，用相同的 `--store` 路径再次启动，文档、修订、任务及模型设置会读回。服务运行时，其他 CLI 操作用 `--url` 指向它，例如：

```powershell
node src/cli.mjs --url http://127.0.0.1:8787 documents --json
node src/cli.mjs --url http://127.0.0.1:8787 tasks --json
```

CLI 若不带 `--url` 会另起内核，不能与运行中的服务同时占用同一 SQLite 文件。当前 Markdown 只支持已明确绑定来源位置的语法子集；表格、YAML front matter、HTML 等会被拒绝，详情见 [Markdown 阶段记录](markdown.md)。PDF、EPUB、RAG、MCP、词库及非回环访问尚未接入这个工作台。
