# 样本库最小切片验证

2026-10-23；分支 `codex/0.1.1-sample-catalog`，基于 main `8dc548d9b08d8d6374c66920efca24135d9ce86d`，待合入。范围和复跑步骤见[样本库指南](../sample-catalog.md)。没有改变运行时、存储/接口 schema 或 DSH `639ed015397290b3745d163aafe02ffee4aa3f84` pin。

环境：macOS arm64，Node 26.12.1，锁定依赖 `npm ci`；构建证据为 1003 个 DSH bundle inputs。默认系统 Node 24.20.0 低于项目门槛，验证使用独立临时 Node 26.12.1，未修改项目 engines。

| 检查 | 实测结果 |
| --- | --- |
| `npm test`（含 build） | 273 项：272 通过、0 失败、1 跳过；跳过项是 Windows 专属 sidecar 子进程取消测试 |
| 新增定向套件 | `node --test test/sample-catalog.test.mjs test/sample-replay.test.mjs`：15/15，通过 schema/权限/路径/摘要、比较变化、CLI 及真实文本内核回放 |
| 开发集重复运行 | 两次各 13 行：10 个文本结构通过，P01/P02 实际引擎/展示未测，G01 的 5 个已有 mock PDF 回归通过；0 失败 |
| 两次运行比较 | 13 行 unchanged，0 变化；参考接受不是人工签认，baselineApproval 仍 pending-human |
| heldout | 独立选择 T11/T12；2 个文本结构通过 + G01 通过，0 失败；默认 dev 不读取这两个参考 |
| `npm run smoke:package` | 68 文件 tarball；隔离安装、同版本重装备份、设置、冻结快照、MCP 和静态 UI 通过 |
| P01/P02 原始页面 | 本地 reportlab 生成，Poppler 渲染后逐页查看；相邻公式与两栏内容无裁切/重叠；仅原页视觉检查，不是译后 PDF 验收 |
| `git diff --check` | 通过；仓库没有单独 lint/typecheck npm 命令 |

第一次沙箱全套测试因 `127.0.0.1` listen EPERM 失败；允许本机测试服务器后全套通过。第一次 package smoke 因 npm cache 写入 EPERM 失败；改用临时缓存后通过，没有执行日志建议的全局 chown。PDF 渲染工具报告默认 fontconfig/cache 路径不可写，但成功生成两张页面图，已实际查看。

首轮样本重跑确实检出了 T08 裸下划线不属于当前 Markdown 子集。修为行内代码后，将保护字段检查放在实际输出上；已有 parser 行为没有改动。失败运行保留在本地 `evaluation/runs/`，随后重复运行与比较使用新目录，不覆盖先前证据。

### 0.1.1 比较与私有骨架修正

基于样本库分支 `a8b93e8bdf6e6ced41650f823b1284ef5c66e8f3` 的本地修正保留比较分类，但当 `added` 或 `input-changed` 候选结构失败时也返回非零；比较前拒绝两侧报告中的重复 ID，manifest 禁止占用固定回归 ID `G01`。`init` 生成 `.gitattributes`，防止 Git 自动行尾转换使精确字节摘要在检出后失效。没有改动跨独立运行的 JSON 文本序列摘要范围、模型调用或 Records/API schema。

Linux x64 / Node 24.22.1：构建成功，新增样本库与回放定向套件 18/18 通过；最终完整 `npm test` 计 276 项，274 通过、0 失败、2 跳过。定向覆盖 `pass→fail` 且输入变化、失败的新样本、通过的输入变化/新样本、重复报告 ID 的 CLI 拒绝及无输出、`G01` 占用拒绝，以及生成的私有骨架在 `core.autocrlf=true` 的本地 Git 检出后仍能通过源文/参考 SHA-256 校验。比较中既有且未变化的失败行保留原有退出行为。Git 属性选择保留提交时的精确原始字节，包括已有 CRLF，而不是统一改写为 LF。这些测试只使用原创合成材料，没有读取私有样本或调用模型。

每次本地完整证据位于指定输出目录的 report.json/report.md/regressions.tap，包含该次精确 commit、dirty 状态、样本与参考哈希、快照/输出和依赖信息；不把含正文的运行目录提交仓库。CI 按 PR 精确 head 查看，不能把这里的 macOS 本地结果视为其他平台结论。

未测：真实模型/收费服务、译文质量及人工逐样本签认、原生 BabelDOC 对 P01/P02 的解析与翻译重建、OCR、真实旧用户库迁移、私有远端共享。无新增 follow-up ID；#13 只交付可独立运行的最小切片，完整长期私有材料与人工评审继续保留。
