# 0.1.0 PDF 使用指南

配套源码 sidecar 提供原生文本英文→中文、简体中文→英文单语 PDF 路由，可从同一份已接受译文导出 PDF、Markdown 和 JSON。中文→英文的真实引擎排版尚待实机核验。PDF 能力由可选 BabelDOC 组件提供；未安装时仍可正常使用文本与 Markdown。

当前源码已升级到 `0.7.1+ivoraige.3` 派生桥，具体构建、平台边界和旧快照迁移见 [0.1.x 升级指南](../0.1.x/babeldoc-0.7.1.md)。旧 `0.6.4`、`0.7.1+ivoraige.1` 和 `.2` 绑定不可直接由新 renderer 回放，需重新捕获并人工核对接受修订；旧 MD/JSON 和来源模式原件复制仍保留可读。不要将历史 Windows 验收算作本次派生构建验收。

## 开始前

- **环境与组件准备**：目前不提供在线 PDF 组件下载。新用户按 [PDF 开发参考](pdf-development.md)准备 Windows x64 环境并启动；已有 `0.6.4` 组件存在已披露解析漏洞，应按升级指南更换；中文→英文须使用与此代码匹配的源码 sidecar。持有完整离线包时，安装方法见[安装指南](installation-guide.md)。组件显示“已配置”仅代表已找到配置，首次实际处理时才会验证运行环境与资产。
- **模型配置**：需要机器翻译时，先在[模型设置](settings-guide.md)中保存模型与凭据。源码开发者的 Python 准备、配置文件及回归脚本另见 [PDF 开发参考](pdf-development.md)。

## 导入、审校与导出

### 基本操作流程

1. **上传与声明源语言**：在首页或文档页上传不超过 7 MiB 的原生文本 PDF，按实际原文选择 English（`en`）或中文（`zh`）；CLI/API 还可声明 `zh-CN` 或 `zh-Hans`。程序不会自动识别 PDF 语言；`zh-TW` 等未列出的语言标签会在解析前被拒绝。
2. **查看解析任务**：在任务页查看捕获进度，完成后打开文档；不需要继续时可以取消（导入任务不支持暂停续传）。
3. **启动翻译**：英文来源选择“简体中文（zh-CN）”或“中文（zh）”；中文来源选择 English（`en`）。精细模式保留草稿，快速模式自动接受结果；两种模式均需按内容质量人工检查。
4. **对照审校**：对照来源页码、原文与译文，保存修改并接受所需修订。`zh` 与 `zh-CN` 分别独立保存译文；已有中文任务须选择一致的目标语言。
5. **冻结导出**：勾选 PDF、MD、JSON 中需要的格式，导出后从“已生成文件”下载。
   - 译文 PDF 仅接受 `en` → `zh`／`zh-CN`／`zh-Hans` 或 `zh`／`zh-CN`／`zh-Hans` → `en`；来源标签须与捕获绑定一致，其他组合会在创建快照与任务前被拒绝。
   - 原件 PDF 可通过 CLI/API 的 `contentMode: source` 独立导出，无需目标语言或已接受译文。其他目标的文本格式导出仍按各自规则处理。
   - 所选格式共享同一冻结快照，导出不会再次调用模型；修改后再次导出会生成新快照，已有快照保持原内容。通过 API/CLI 指定旧 `snapshotId` 可重放旧快照。

### PDF Markdown 导出与链接转义规则

以下规则仅属于 PDF 的 Markdown 输出，不改变通用 Markdown 导入规则：

- **标题与段落结构**：使用捕获时保存的标题类型，将已识别标题统一写作二级标题（仅表示识别为标题，不代表恢复了原 PDF 的准确层级）。文档标题和捕获标题中的连续 CR、LF、`U+2028`（行分隔符）、`U+2029`（段分隔符）统一压平为一个空格，避免标题退化为带字面 `#` 的正文；正文不做此压平，`U+0085` 保持原样。普通正文、图注和公式单位作为字面段落输出，公式显示文本及未解出的占位符保持可见。表格单元格、列表关系、图像与未捕获内容不会凭文本补造，请结合原 PDF 核对。
- **字面行与缩进保留**：正文中的纯等号行（含前导空格）按字面内容保留，不触发 Markdown setext 标题语法（0–4 空格边界回归见[等号行记录](../0.1.x/evidence/pdf-markdown-setext-0.1.0.md)）。行首完整空格／Tab 序列（含混合缩进）按字面正文保留，不会形成代码块。
- **URL 与 `www` 链接边界**：链接标签与目的地分别转义，连字符、下划线和查询参数不携带正文转义反斜杠。紧邻字母、数字、下划线的 HTTP/HTTPS/FTP、`www` 地址及 IPv6 主机保持可导航；尖括号明确圈定的 URL 保留末尾 `!`、`?`、`;`、`.`、`:` 等地址字符，裸链接则将句尾标点留在正文；URL 中命名、十进制和十六进制实体形文本的尾分号仍属于地址。无效的 URL 形文本及 `www..`、`www.!` 保持纯文本，不会误转为邮箱链接。
- **邮箱完整候选校验**：邮箱处理先按空白、尖括号、括号、逗号、分号、冒号和 Unicode 正文标点收集完整候选，再校验整个地址；不会因末尾标签无效而回退到较短地址，也不在双 `@` 候选内截取局部邮箱（如 `user@example.com_x` 或域名后带 `_`、路径、查询、片段时整串保持纯文本）。
  - 支持 ASCII dot-atom 本地名称（点分段非空、最长 64 字符，含内部或未配对 ASCII 撇号）与至少两段的 DNS 域名；域名标签以 ASCII `.` 分隔（中文 `。` 与 Unicode 句点变体不作标签分隔符），支持 Unicode/Punycode 并经 IDNA 规范化为 ASCII 目的地（标签最长 63、域名最长 253、完整 ASCII 邮箱最长 254 字符，顶级标签至少两个 ASCII 字母或有效 Punycode）。
  - 句尾标点与邮箱外侧配对的 ASCII／弯单引号留在链接外（即使 ASCII 或 Unicode 标点在闭引号之前，配对只跨标点、不跨文字或空白）；引号式本地名称整体识别并保持纯文本，普通正文用双引号包围的独立地址仍可识别。
  - 邮箱目的地中的 `?`、`#`、`%`、`&`、`+` 等本地名称字符使用 URI 编码，防止注入邮件标题、额外收件人或片段。可见地址文本不改写；被拒绝的候选会抑制下游自动链接。校验仅针对语法与编码，不证明域名或邮箱真实可投递。
- **DOM 渲染说明**：正文保留与 Markdown 渲染并非逐字节 DOM `textContent` 等价（例如行尾双空格加换行渲染为 `<br>`，HTML 也会规范化 NUL 等控制字符）；冻结 JSON 和原始导出文本不受影响。

## 检查输出

- **下划线局部分行修正（`ascii-alnum-base-v1`）**：新捕获为明确夹在同字体、字号和基线的邻近横排 ASCII 字母或数字之间的低下划线采用局部分行修正，不移动原字形；标点、其他文字方向、独立或远离正文的符号不按此规则合并。旧记录不改写，旧引擎绑定需重新导入才能回放译文 PDF。请继续核对标识符和公式（详见[下划线分行记录](../0.1.x/evidence/pdf-underscore-line-0.1.0.md)）。
- **预试排框复用策略（`fit-box-v1`）**：新捕获固定 `fit-box-v1` 排版策略，导出在可用空间允许时复用预试排通过的框与字号比例，随后仍执行原引擎 fit 检查；邻段、框或目标比例改变时回退原排版路径。派生 `0.7.1` 运行时通过原生移植执行此策略，旧引擎绑定需重新捕获并核对修订。它不修复公式顺序、遗漏文字或所有标题缩放，最终结果仍需打开核对（详见[原生集成记录](../0.1.x/evidence/babeldoc-native-fit-0.1.x.md)）。
- **来源覆盖清单（`sourceCoverage`）与警告**：查看来源覆盖与导出警告，核对公式、图注、多栏和未进入翻译单元的文字。新导入文档的 `sourceCoverage.summary` 列出捕获单位、翻译回调、未进入回调但保留的单位、行审计补录和空文本单位（后两项可能与保留单位重叠，不能直接相加；旧导入记录缺失项显示为未知）。回调数量仅表示 BabelDOC 发起的请求，不代表全文已捕获或已翻译。
- **核对短标签与占位符**：检查短表格标签与带上下文的段落，确认译文仅对应当前单元、未混入内部请求字段或相邻正文（旧接受译文及冻结产物不会自动修复，需人工修订后重新导出）。公式等不可译内容通常保留原文，编辑时请保持占位符及原有顺序。
- **缺失译文跳过与引擎边界**：默认要求所有可译单元均有已接受译文；CLI/API 显式指定 `skip` 允许缺失部分保留原文，所有导出格式共享同一决定且不临时补译。BabelDOC 路径不提供扫描件 OCR、双语 PDF 与跨引擎映射。

## 继续工作与恢复

正常退出后重新启动即可继续使用已有文档与修订。取消导出不会删除此前已完成的格式产物。组件修复或修改配置后请先重启服务再处理。

备份前请退出程序，完整复制整个用户数据目录（保留 SQLite 数据库及同级的 `pdf/` 目录），切勿单独移动数据库或手工修改受管理原件。若受管原件丢失或损坏，可重新导入完全相同的原始 PDF 以恢复本库副本，无需重新翻译已有文档。跨版本升级和其他平台迁移需另行验证。更多范围见[能力与限制](capabilities.md)；维护者的来源绑定、目录清理和真实样本证据见源码中的 [PDF 实施记录](pdf.md)。

## 可选 MinerU 解析与同引擎回放源码插件（实验）

### 能力范围与实验证据

本源码包含独立的 `plugins/mineru/` 包，基于 MinerU **4.0.10 SDK** 导入 PDF 并保存原件、完整 MiddleJson、结构化视图、Markdown 和图片资源；支持通用原文模式（`contentMode: source`）导出 MD/JSON 及逐字节原件 PDF。实验性 `mineru-pdf` 输出适配器使用本地 **DocVortex 0.6.21**，从同一份已保存 MiddleJson 和冻结的人工接受修订重建 PDF，不借用 BabelDOC renderer，也不调用翻译模型。

Linux CPU/flash 已用原创原生与纯图片扫描样本完成实际解析、重启、来源导出和 PDF 回放；但这不代表任意 PDF／OCR／排版质量验收，目前也没有可下载的独立 MinerU 安装包。实测环境、样本与局限见[来源实施证据](../0.1.x/evidence/mineru-source-p05-p06.md)和[回放实施证据](../0.1.x/evidence/mineru-renderer-p09.md)。

### 本地环境装配与操作命令

已自行准备本地 MinerU 4.0.10 Python 环境及模型资源的开发者，可在关闭程序后将 `plugins/mineru/` 复制到数据目录的 `settings/node_modules/@ivoraige/mineru-source/`（保留 `index.mjs`、`runner.py` 和 `package.json`），并在 `settings/cordis.patch.yml` 的现有补丁列表中追加一项（不要覆盖其他补丁）：

```yaml
- insert:
    - id: mineru-source
      name: ./node_modules/@ivoraige/mineru-source/index.mjs
      config:
        directory: /absolute/data/mineru
        command: /absolute/python-environment/bin/python
        tier: flash
        ocrMode: auto
```

- Windows 下 `command` 指向对应环境的 `python.exe`。宿主会将已锁定的 SQLite 路径传给插件作为资源归属身份，无需在 profile 中重复填写。
- 重启后显式指定 `--adapter mineru` 导入并导出：
  - 导入：`ivoraige import FILE.pdf --format pdf --adapter mineru --source-lang en`
  - 原文导出：`ivoraige export DOC_ID --format pdf,md,json --content-mode source`
  - 译文冻结导出（检查并接受目标语言译文后）：`ivoraige export DOC_ID --format pdf,md,json --target-lang zh`（缺失接受译文默认拒绝，API 可显式传 `onMissingAccepted: skip` 保留原文；旧快照不随新修订改变）。
- 若 BabelDOC 同时在场，导入时不指定 `--adapter` 可能触发同分冲突，程序不会暗中代选。停用插件时将该 DSH profile 行设为 `disabled: true` 并重启；TXT/Markdown 与已有只读记录继续可用，MinerU 私有修订校验在插件缺席时不可用。

### 运行边界、备份与许可说明

- **版本核对与离线限制**：sidecar 握手后严格核对 MinerU `4.0.10` 与 DocVortex `0.6.21` 版本，设置 Hugging Face／Transformers 离线开关并在 Python 进程内拦截常用 socket 入口（非操作系统沙箱，严格离线仍需隔离本地环境）。缺少本地运行时或资源会直接失败，插件不会自动安装或下载。
- **单 span 回放与质量边界**：回放仅替换能与存档块身份对应的**单个纯文本 span**；复杂行内混排或因 Markdown 转义／样式导致结构化文本不同于原 span 的单位不会凭模糊匹配改写，应人工处理或保留来源（来源 MD/JSON 仍保留这些文字）。图表块已捕获的 caption/footnote 作为独立可读单元保留，但表格表头仍可能并入 caption，公式文本和 PDF 英文字距仍有缺口，需逐页核对。备份时需将 SQLite 库与受管 `mineru/` 目录一起复制。
- **上游依赖与许可**：上游 MinerU 4.0.10 要求 Python `>=3.10,<3.15`。官方 [MinerU-4 ONNX 模型仓](https://huggingface.co/opendatalab/MinerU-4_models_onnx/tree/358310b4f64b95f9fefc372ad899356e4111f376)在该修订的文件合计 858,220,651 字节（约 858 MB，不含完整 Python 环境或其他模型）。插件桥的 MIT 许可不覆盖 MinerU 本体或模型；上游[许可](https://github.com/opendatalab/MinerU/blob/mineru-4.0.10-released/LICENSE.md)包含商用规模门槛和第三方在线服务显著署名要求，独立分发前需核对实际 Python、模型、字体与原生库闭包。
