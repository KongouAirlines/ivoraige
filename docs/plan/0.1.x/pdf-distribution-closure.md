# PDF 分发闭包实物审计（0.1.x）

[P08](packages/pdf.md#p08) · [F-B/P2 历史门禁](../0.1.0/pdf-license-audit.md)

## 本次结论与边界

2026-11-09 对本地 PR #92 npm tar、MinerU 4.0.10 已安装 Linux 环境及 BabelDOC 0.7.1 派生 Linux 环境做离线清单检查。没有安装、下载或发布；未读取文档样本和提取文本。P08/F-B/P2 **未关闭**：没有新的最终 PDF runtime 发行归档，已安装环境不是归档验收。

[精简实物清单](pdf-closure-inventory.json)记录每个 distribution 的版本、许可声明、依赖、上游链接、notice 路径、代码/数据文件数量，以及逐项 native/model/font 路径和字节数。长 License 字段截短，全文须回到对应 METADATA/notice；该 JSON 不是法律意见或源码 offer。RECORD 是归属声明；清单未枚举 RECORD 之外的孤立安装文件、系统动态库或 Python 解释器本身，不能称完整系统闭包。本轮未逐文件独立对账上游 wheel，不把安装环境内全部包都当作最终产品依赖。

清单顶层 `inputIdentity` 记录原始清单完成时间（原始文件 mtime，UTC）、本次身份检查时间、Node/OS、tar SHA-256、模型 revision 与派生 wheel 身份。旧 source tar SHA-256 为 `bef6c2bcf36d53265c7f649207bcbb5d48e2ab422495ee9742e351d85a6a0039`，与原 build-evidence 相符，重读成员清单与本次保存观测完全一致；其 build-evidence 为 `6a5e1df` 加 modified tree，不能称精确对应 PR #92 提交，也不是 P05 后续分包产物。派生 wheel 摘要重新计算通过，并比对实际安装的 native 扩展、METADATA、LICENSE 三项字节与 wheel 一致；不是所有 runtime 文件或模型的重验。已安装环境可变，时间记录不使其变为不可变归档。

## 核心与桥接代码分开判断

实际 `mineru-package-0.1.x/ivoraige-0.1.0.tgz` 含 `plugins/mineru/{index.mjs,runner.py,package.json}`，另含 `src/adapters/pdf*.mjs`、sidecar transport。它尚不满足“独立插件包、主体不携带该插件”的目标。清单中的 `pdfBoundaryCandidates` 只检测结构边界，不判定这些文件的法律许可。

检查 PR #92 工作树的 runner：首行 MIT SPDX，package manifest 也为 MIT；逻辑为自有 JSON-RPC 参数/版本验证、offline 配置及 `mineru.parser.parse` / `FileBasedDataWriter` 调用。本轮未识别出标注的上游复制片段，但没有完整的著作权来源/相似性证明。因此不能仅凭 `.py` 或 import 就称 tar 含 AGPL 代码，也不能断言进程隔离免除相关许可义务。核心“无 PDF AGPL 内容”的闭包门禁仍需要最终核心 tar、捆绑依赖以及对应通知的独立审查。

P05 负责实现插件目录安装与拆包，本审计不重复修改 package files 或安装器；拆包后的实际 tar 应重跑本工具及干净安装 smoke。

## 本次实际组件

| 环境 | 实际观察 | 许可/来源证据 | 未关闭项 |
| --- | --- | --- | --- |
| MinerU | 113 个 dist-info；202 个 RECORD 归属原生文件（含构建/安装工具） | MinerU 4.0.10、DocVortex 0.6.21、ONNX Runtime 1.31.1 | 实际发行裁剪、原生库内嵌依赖、wheel 身份、通知与资源许可闭包 |
| MinerU 自身 | `LicenseRef-MinerU-Open-Source-License` | LICENSE.md：Apache 2.0 加商业规模阈值及在线服务署名条件；不能写为纯 Apache 或 AGPL | 保留完整附加条款；适用场景核对；最终包内基础 Apache 全文映射 |
| DocVortex | MIT AND Apache-2.0 AND BSD-3-Clause 元数据；native 扩展与 fonts NOTICE | dist-info LICENSE.md 为 MIT；字体 NOTICE 另列 | 顶层 MIT 不能覆盖所有内嵌组件；需逐项映射 |
| MinerU ONNX 资源 | 16 文件，Layout/OCR/MFR/Table；实际模型及配置路径见 JSON | 本地 upstream manifest 和 README；固定模型 revision `358310b4f64b95f9fefc372ad899356e4111f376` 已记录于下载证据 | README 明确原模型许可仍适用；本轮未按每个原模型逐项验证许可与转换材料，资源不作可再分发通过 |
| BabelDOC | 86 个 dist-info；364 个 RECORD 归属原生文件 | 实装 `0.7.1+ivoraige.1` AGPL-3.0；不是旧 stock inventory 的 0.7.1 | 原生 Rust/vendor 依赖逐项对应源码/notice 与最终归档 |
| BabelDOC 传递依赖 | PyMuPDF 1.26.7、Levenshtein 0.27.5 | 分别双重 AGPL/商业声明及 GPL-2.0-or-later；没有把商业二选一声明当作已持有授权 | MuPDF 实际构建、源码提供方式；其他原生库自有条款 |
| BabelDOC 资源 | 34 字体、146 cmap、1 模型、1 tokenizer；另有来源 manifest | `asset-provenance-0.7.1.json` 固定 URL/摘要；既有 asset-licenses 作为历史参考 | 新实际包通知/来源映射与资源权利复核；摘要/旧审计不能代替许可验收 |

MinerU 未在顶层 METADATA 许可字段检测到 GPL/AGPL，不等价于原生闭包没有 copyleft。其 OpenCV/NumPy/Pillow、PDFium、llama-cpp、DocVortex 等必须继续检查内嵌库。BabelDOC 的 OpenCV/FFmpeg、SciPy/OpenBLAS/Fortran runtime、MuPDF、FreeType、Hyperscan 等同理；Python wrapper 标签不是原生闭包许可证。

按 RECORD 路径未找到独立 notice 名称的安装包：MinerU 环境有 cobble、flatbuffers、gradio_client、jieba、latex2mathml、loguru、pypdfium2、tokenizers；BabelDOC 环境有 flatbuffers。这里只报告收集器候选缺口，许可可能在 README、嵌入 metadata 或其他路径中，不能直接断言无许可或违法。

BabelDOC 实装身份由 worker 确认来自隔离构建 wheel，SHA-256 `983e4f0ffe4a55bf83b714c95723fe97e2712146022ee5b36e490ec1dfa56d2c`；实际 dist-info 为 `babeldoc-0.7.1+ivoraige.1.dist-info`。历史 `runtime-inventory.json` 是 stock 快照，**不可**作为当前安装状态。实际 package 内存在 `licenses/LICENSE` 和 `sboms/babeldoc-p2-bridge.cyclonedx.json`，本轮清单不将 SBOM 自动视为所有依赖已完成源码交付。

## 可自动化与必须保留的阻碍

可以自动检查实际 tar 路径、危险成员/重复路径、插件结构边界、metadata/RECORD 完整性、notice 候选、native/model/font 文件以及缺失安装目录（失败而非零包通过）。`scripts/audit-pdf-closure.py` 使用标准库，不导入安装包、不提取 tar、不联网；输出独占创建。只能扫描显式指定的 runtime/资源根，不应传入用户 home 或私有样本目录。

必须另行关闭：最终归档与 wheel/构建输入身份，原生内嵌依赖与实际配置，模型/字体的逐项权利及通知，AGPL/GPL/其他适用条款对应源码和接收者可访问入口；最终干净安装及发布授权。Linux 安装快照不能追认旧 Windows ZIP，旧 F-B/P2 的 FFmpeg、MuPDF、VC/UCRT、setuptools 等未决项保持原状态。

## 复现与验证

在拥有这些已授权本地输入的同级工作树中运行；缺少输入时只运行夹具，不声称实际验收。

```sh
python3 scripts/audit-pdf-closure.py \
  --site-packages mineru=../ivoraige-mineru-plugin/evaluation/runs/mineru-live-0.1.x/venv/lib/python3.12/site-packages \
  --site-packages babeldoc=../ivoraige-babeldoc-0.7.1/evaluation/runs/babeldoc-0.7.1/.venv/lib/python3.13/site-packages \
  --assets mineru=../ivoraige-mineru-plugin/evaluation/runs/mineru-live-0.1.x/mineru-home/models/MinerU-4_models_onnx \
  --assets babeldoc=../ivoraige-babeldoc-0.7.1/evaluation/runs/babeldoc-0.7.1/assets \
  --tar source-pr92=../ivoraige-mineru-plugin/evaluation/runs/mineru-package-0.1.x/ivoraige-0.1.0.tgz \
  --output evaluation/runs/pdf-closure-0.1.x/inventory.json
python3 -m unittest discover -s test -p audit_pdf_closure_test.py
```

本轮三项夹具通过，涵盖缺目录失败、RECORD 文件分类/越界/缺失及 tar 路径拒绝和结构候选。真实清单完成；不代表整个产品测试、跨系统安装或二进制合规通过。没有新增/关闭 follow-up ID；推进 P08 证据，F-B/P2 保留。

## 审查后收紧工具边界

基础脚本只生成 `schemaVersion/limitations/installed/assets/archives`，**不生成**已提交历史精简清单的 `inputIdentity`，也不重新生成历史采集时间。该清单是在原始完整输出上人工精简并补充身份核验的证据快照；上面的命令用于重新观察显式输入，不能逐字节重建此历史文件。`distributionCounts/assetCounts/specialLicenseMetadata` 不是该文件的 schema 字段。

本次修正不重写历史清单计数或替换成 P05 新包：

- 未提供任何输入时退出失败且不写输出。
- 输入根及其祖先、dist-info/METADATA/RECORD 符号链接在读取内容前拒绝；RECORD 路径含绝对路径、`..` 或中间目录链接时只记录为外部/链接，不读取目标。
- tar 规范化路径重复及所有链接成员拒绝，需要另行人工审查。工具仍不提取/执行 tar，所解决的是清单含义和路径检查缺口，不是已发生的执行风险。
- 资源链接明确列为未检查，不静默消失；缓存目录仍按约定排除。`.pth` 可为 Python 路径配置或模型，现标为歧义候选，不推测模型用途。
- PDF 结构候选增加 `src/adapters/pdf*.mjs`、`src/sidecar*.mjs` 及单数 `sidecar/`。新输出的 coreBoundary 对命中使用 requires-pdf-boundary-review 而非自动 blocked；命中不判定 AGPL，也不判定每项必须移出核心，通用 transport 需结合架构合同人工判断。
- 许可信息保留原 METADATA 路径和 License/License-Expression 原字段，不做推断式 SPDX 规范化。

这些检查针对静态、受信任位置内的离线输入，不提供并发恶意文件替换下的安全快照保证；运行时不要同时修改被审计目录。

### 历史 inputIdentity 的人工复核方法

身份字段的观察时间与身份复查时间不同；重新执行下面步骤仅产生新的复查证据，不能回写或伪造历史时间。原始时间来自完整输出文件的 mtime，历史原始文件不在 Git 中。

1. 对明确的旧 source tar 计算 SHA-256，对比清单 `inputIdentity.sourceTar.sha256` 及同目录 `.build-evidence.json` 的 sha256。使用 `archive()` 重读文件成员，对比历史 `archives.source-pr92.files`，**不**要求后来扩展的候选列表保持一致。
2. 对明确的 recipe wheel 计算 SHA-256，对比 `inputIdentity.babeldocDerivedWheel.sha256` 及 `recipe/wheels/build-provenance.json` 的 wheelSha256。用 Python `zipfile.ZipFile.read` 仅读取清单 `installedMemberChecks` 的三条成员，逐项计算 SHA-256，并与 `.venv/lib/python3.13/site-packages/` 对应文件摘要及已记录摘要比较。不安装或解压执行 wheel。
3. 对比 `hf_api_manifest.json` 的 `id/sha` 与清单的模型 repository/revision；这不验证现有模型字节。Node/OS 是身份复查时的 `node --version`、系统/kernel/architecture，不是原包构建平台证明。

在文中指定的同级本地树中，两个归档的独立摘要可这样复核（不需联网）：

```sh
python3 -c 'import hashlib,pathlib; p=pathlib.Path("../ivoraige-mineru-plugin/evaluation/runs/mineru-package-0.1.x/ivoraige-0.1.0.tgz"); print(hashlib.file_digest(p.open("rb"), "sha256").hexdigest())'
python3 -c 'import hashlib,pathlib; p=pathlib.Path("../ivoraige-babeldoc-0.7.1/evaluation/runs/babeldoc-0.7.1/recipe/wheels/babeldoc-0.7.1+ivoraige.1-cp310-abi3-manylinux_2_34_x86_64.whl"); print(hashlib.file_digest(p.open("rb"), "sha256").hexdigest())'
```

审查修正后本地 8 项测试通过，包括空输入、metadata/父目录链接、资源链接、tar alias/链接及候选分类；既有三系统 kernel-smoke workflow 已加入该夹具命令。此处只报告本地通过及 CI 配置接入，未声称远端 CI 已通过。历史实物清单保持原样，未重扫 runtime 或新 P05 包。

### 跨平台路径边界复核

第二轮 delta 审查按实际合同处理，不扩大为许可结论：

- **实测问题：** `--assets demo=` 原来会把空路径解释为 cwd；缺少 `=` 会产生 traceback。现在 argparse 对所有输入先检查非空 `LABEL=PATH`，失败返回 2，不执行扫描或创建输出。标签、路径只为空白也拒绝。
- **可移植路径问题：** RECORD 与 tar 成员统一拒绝 Windows rooted-without-drive、drive-relative（`C:file`）、drive-absolute（`C:/file`）、UNC、反斜杠及上级路径。Windows 语义由 `PureWindowsPath` 检查，即使在 Linux 审计也不遗漏。tar 仍不解压，这里防止跨平台证据歧义，不表示已发生文件写入。
- **条件性 Windows 风险：** junction 和其他 reparse point 不一定是 symlink。现在对输入祖先、metadata、RECORD 中间路径和资源项使用不跟随最终入口的 `lstat`，检查 `FILE_ATTRIBUTE_REPARSE_POINT`；资源遍历在递归前明确移除此类目录。权限等其他 I/O 错误不吞掉。Linux 本地通过属性模拟及遍历剪枝夹具，尚未运行真实 Windows junction 验证，不能将模拟测试称为 Windows 实包通过。
- **实测遗漏：** `.cache/.locks` 的目录链接原来先被排除。现在先识别并记录为 uninspected-link，再排除正常缓存目录；链接不下钻。
- **保留约定：** 输入路径的任意祖先是链接/reparse point 都拒绝，包括 macOS 常见 `/tmp` alias。这是严格显式根策略，不自动 resolve 到另一个位置，也不为便利放宽权限。调用者须明确选择已授权的真实目录路径；夹具仅对自己创建的临时目录取得真实位置。并发替换与完整系统闭包仍不在保证内。

本轮本地 13/13 清单夹具及 4/4 既有归档夹具通过；没有运行大清单、读取新 P05 包或修改历史 inventory JSON，没有 Windows/macOS 实机运行结论。已有三系统 CI 配置将运行新夹具，远端结果另验。

### 路径组件与损坏 RECORD 的窄范围回归

纯路径夹具确认 `./C:/file`、`pkg/C:file`、`pkg/C:..` 曾通过整体 anchor 检查；`C:..` 已被拒绝。现在按既有保守跨平台格式策略，逐组件拒绝盘符形态，不将其描述为已证实的 Windows 逃逸或 tar 执行漏洞。真实临时文件夹具确认：当 `foo` 是普通文件，RECORD 的 `foo/bar` 曾触发 NotADirectoryError。链接探测现仅将 FileNotFoundError/NotADirectoryError 作为不存在入口返回，随后该项进入 missingRecordFiles；PermissionError 及其他 I/O 错误仍向上传递，未掩盖访问失败。

修复前新增测试产生三项格式断言失败和一项真实 NotADirectoryError；修复后清单夹具 16/16、既有归档夹具 4/4 本地通过。没有运行 native Windows、大清单或依赖下载；历史 inventory JSON 未改。
