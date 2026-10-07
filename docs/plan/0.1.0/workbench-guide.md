# TXT／Markdown 工作台试用

以下命令在仓库根目录的 PowerShell 执行；需要 Node.js ≥24。首次准备后启动本机服务：

```powershell
npm ci
npm run setup:dsh
npm run build
node src/cli.mjs serve --store .\evaluation\runs\workbench\store.sqlite
```

终端会打印服务地址，默认是 `http://127.0.0.1:8787`。保持该终端运行，在浏览器打开地址。当前服务只监听本机回环地址；同一 SQLite 文件一次只交给这个服务进程使用。

首次使用在“设置”页选择“提供商预设”，核对模型 ID 后点击“保存并用于翻译”。可选择 DeepSeek、Anthropic、OpenRouter、Kimi、OpenAI、硅基流动或本地 Ollama／llama.cpp／LM Studio；内置目录模型的协议与端点可留空继承默认，输入框会提示对应默认值。在下方凭据框输入自己的 API Key 并保存；设置读取只显示凭据状态。无认证的本地服务可用“填入本地占位凭据 local”，再点击“保存凭据”，这是满足当前 SDK 的非秘密占位值，需要认证时使用真实密钥。保存配置／凭据不发起模型请求，点击翻译才会调用。

要保留多个模型，填写另一组配置并点击“保存到模型列表”；当前翻译模型保持原选择。列表里可“编辑”或“用于翻译”。同一提供商标识共享端点、凭据和路由级推理设置；不同账号或端点使用不同标识，未收录模型使用自定义标识并填写 API 类型、URL 及实际容量。旧的显式模型和当前选择自动出现在列表。修改配置前须暂停运行／排队中的翻译任务。更多方案与边界见 [模型配置调研](../../research/model-settings.md)；此前 [DeepSeek 显式配置示例](../../../examples/translation-deepseek.json)仍可用于程序接口。

在首页或“文档”页选择 [scientific-en.txt](../../../examples/scientific-en.txt)，导入前确认“原文”为 English。打开文档工作台，选“精细 · 保留草稿”翻译全文；任务页显示进度。回到工作台逐段查看原文与草稿，可直接修改译文，点击“保存草稿”，再点击“接受译文”。在“上下文与输出”区勾选 MD／JSON，点击“创建冻结快照并导出”，完成后从“已生成文件”下载；窄屏时先点“显示上下文与输出 →”。导出只使用已接受的修订，不调用模型；若尚有未接受的可译段落，默认导出会报前置条件错误。Markdown 的短片段可能缺少跨标记语境，接受前须逐段审校。

按 Ctrl+C 停止服务后，用相同的 `--store` 路径再次启动，文档、修订、任务及模型设置会读回。服务运行时，其他 CLI 操作用 `--url` 指向它，例如：

```powershell
node src/cli.mjs --url http://127.0.0.1:8787 documents --json
node src/cli.mjs --url http://127.0.0.1:8787 tasks --json
```

CLI 若不带 `--url` 会另起内核，不能与运行中的服务同时占用同一 SQLite 文件。当前 Markdown 只支持已明确绑定来源位置的语法子集；文件开头有效的 YAML 映射头部原样保留、不翻译，含头部的文件可正常导入，空头部也可保留。未闭合或无效头部会报导入错误。表格、HTML 等仍会被拒绝，详情见 [Markdown 阶段记录](markdown.md)。后续 QMD 的指定 YAML 字段翻译（如摘要、双语机构名称）见 [后续事项](../follow-ups/quarto-qmd-support.md)。PDF、EPUB、RAG、MCP、词库及非回环访问尚未接入这个工作台。
