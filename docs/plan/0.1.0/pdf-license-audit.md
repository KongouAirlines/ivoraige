# 0.1.0 PDF 实际发行物许可核验

**2026-10-19 更新：全部 Release 和附件已撤下，当前无发行包下载。** 本文保存旧附件的审计证据；F-B／P2 的包整改与验收留待恢复二进制分发前完成，不作为本轮仅发布源码的安装包门槛。撤下不等于旧包缺口已修复。

2026-10-17，Asia/Shanghai。对应[公开准备计划 F-B／P2](public-readiness.md#f-b-pdf-发行物的许可闭环未获得实际归档验证)。本轮完成了四个当时可下载的附件的实际读取与许可证据核验，**结果为未通过发行许可闭环；F-B 仍未关闭**。资源包的文件、来源与通知已逐项对上；基础 ZIP 的通知缺口、PDF 运行时额外依赖和对应源码材料仍须处理。不能把本报告或清单脚本退出码 0 当作发行授权。

原审计来自 [PR #24](https://github.com/KongouAirlines/ivaraige/pull/24)／提交 [`3d3f9fc`](https://github.com/KongouAirlines/ivaraige/commit/3d3f9fc227aad87d7661f2a9934df38ac056d6c5)，工作分支 `codex/0.1.0-pdf-license-audit`，从公开准备文档分支 `fca3c61` 开始，业务基线为 `c8a146d`。原审计时项目自身授权仍待确认；后续许可与贡献规则见 [PR #32](https://github.com/KongouAirlines/ivaraige/pull/32)。

§1～§7 中的“本轮”及实包数字指 2026-10-17 原审计；2026-10-18 收编没有重新执行实包审计。PR #25 对新 Node bundle 的修复已在 §3／§6 标明，来源和本次验证另见[收编记录](#integration-2026-10-18)。三份 JSON 是旧附件的历史证据索引，不是当前构建的实时依赖清单。

## 1. 核验对象与方法

2026-10-17 从当时的 `v0.1.0-dev.0` Release 完整下载四个附件（该 Release 现已删除），大小和 SHA-256 均与 API 一致。对归档逐成员读取和计算摘要，未运行发行 EXE、DLL、Python 模块或真实模型。没有重跑 Windows 安装、PDF 功能或排版验收。

| 附件 | 字节 | SHA-256 | 实际普通文件 |
| --- | ---: | --- | ---: |
| `ivoraige-0.1.0-dev.0-win32-x64.zip` | 65,654,609 | `f7b37175ec4d4c3c13d2c3fffc52596880ef4f67820ad08d674277de73c991f2` | 12,854 |
| `babeldoc-0.6.4-win32-x64.tar.gz` | 201,314,930 | `d0174cabaffdd5c45ece2e907131752dfed346fa4a85a4c2b9eae2237359b30f` | 1,660 |
| `babeldoc-assets-0.6.4-win32-x64.tar.gz` | 235,512,779 | `4b9dc761f2e97703ab226059cd96ef0b28b7029505388be7ddbefec6c8157020` | 196 |
| `components-manifest.json` | 595 | `7aa6d1e9f260d9d2756a40b7e3d3db7550cf05d873299a8dc2a9038557502d92` | 单文件 |

三个归档没有观察到越界路径、重复成员、符号链接或硬链接。PDF 包含 324 个 DLL／PYD／EXE，基础 ZIP 包含 Node 和 esbuild 两个 EXE。许可候选文件分别为基础包 114、PDF 运行时 44、资源包 13；这些是索引数量，不是独立许可证数量。

为覆盖 EXE 内隐藏的 Python 模块，在独立工具环境使用官方 PyInstaller 6.22.3 的 `CArchiveReader`／`ZlibArchiveReader`，仅读取目录表。读出 13 个 CArchive 项、5,498 个 PYZ 模块项、154 个 `base_library.zip` 项。未加载或执行嵌入代码。普通归档目录本身不能代替这一步。

提交内保留可审阅的映射，完整归档和逐文件清单留在忽略目录：

- [182 个资源的文件／许可／通知／固定上游文件映射](pdf-license-assets.json)。
- [85 个 Python 锁项及 113 个实际 npm 包的许可与来源索引](pdf-license-packages.json)。Python 的 `lockedVersion` 不代表已独立验证二进制版本；`presence` 单列实际观察结果。
- [324 个原生文件的摘要、候选归属及 RECORD 对账](pdf-license-native.json)。候选归属不等于已证明原生库版本或对应源码。
- `evaluation/runs/pdf-license-audit-0.1.0/inventory/`：四附件身份、三个归档全部成员及摘要、许可／metadata／RECORD 索引和有界文本副本。
- 同一运行目录下 `embedded-python-inventory/`、`asset-map.json`、`upstream-metadata.json`、`pypi/`、`npm/` 与各专项报告保存检查细节。没有将二进制、缓存、源码下载副本或原始运行输出提交到 Git；上面的三份精简映射作为核验记录保留。

## 2. 资源包：本轮已完成的核验

| 资源 | 数量 | 实际结果 |
| --- | ---: | --- |
| 字体 TTF | 34 | 全部有家族适用的 OFL／Naver 通知；OpenType name 记录与随包 `FONT-EMBEDDED-NOTICES.txt` 一致；全部 SHA-256 与固定 BabelDOC-Assets LFS 元数据一致 |
| CMap JSON | 146 | 全部有 Adobe 通知；全部 Git blob 摘要与固定 BabelDOC-Assets 元数据一致 |
| ONNX | 1 | 与固定模型仓库 LFS 摘要一致；精确 ONNX 和基础模型的模型卡均声明 Apache-2.0；许可全文在包内 |
| tiktoken 数据 | 1 | 确认是 `o200k_base`；文件名与官方 URL 的 SHA-1 一致，内容 SHA-256 与官方编码定义一致；MIT 通知在包内 |

固定资源仓库 revision 为 [`5f1a97ad776b502f1d967bfd9cc88860761e34fd`](https://huggingface.co/datasets/awwaawwa/BabelDOC-Assets/tree/5f1a97ad776b502f1d967bfd9cc88860761e34fd)，模型 revision 为 [`ee7c3d744e5c47c58e267044ac825f95abe69653`](https://huggingface.co/wybxc/DocLayout-YOLO-DocStructBench-onnx/tree/ee7c3d744e5c47c58e267044ac825f95abe69653)。182 项均有通知和来源映射，未观察到额外未登记资源。

包内 `ASSET-SOURCES.md` 加 13 份许可目录文件共 14 份说明材料齐全。许可目录内容与仓库一致，三份只有 CRLF／LF 差别；九份可直接取得的官方上游许可文本也作了对比。MaruBuri 使用 Naver 官方网页声明，GoNoto 适用生成字体的 OFL，而非构建脚本的 Unlicense。详细家族出处见[已有资产许可表](../../../sidecars/babeldoc/asset-licenses/ASSET-LICENSE-STATUS.md)。

本结论的边界：146 个摘要证明与该固定数据集逐文件一致，不是本轮逐文件复验 Adobe 原始格式到 JSON 的转换；后者仍只有已有六组抽样证据，转换脚本和少量记录差异未解释。字体也没有额外逐一匹配各字体项目的发行附件摘要；来源许可依据为字体嵌入记录、项目通知和数据集摘要。没有把这些历史／来源边界隐藏为整包“合规认证”。

## 3. 基础 ZIP：确认的通知缺口

`runtime/NODE-LICENSE.txt`、DSH MIT 全文及作者通知、WebUI 通知实际存在。生产 `node_modules` 中有 113 个包根，另有示例／子目录 manifest，未将后者重复算为独立安装包。113 项固定版本 npm registry 元数据已取得，索引保留版本、许可声明、tarball、integrity 和可取得的 gitHead。

`app/dist/THIRD_PARTY_LICENSES.txt` 共 50 段，其中三段只有标题，**正文为空**：

| 实际包 | 版本 | 随包证据 |
| --- | --- | --- |
| `@earendil-works/pi-ai` | 0.87.1 | `node_modules` 内没有独立许可文件；汇总只有名称／MIT 标识 |
| `data-uri-to-buffer` | 4.0.1 | 汇总为空，但包内 `app/node_modules/data-uri-to-buffer/README.md` **已携带完整 MIT 和版权**；属于收集器遗漏，不能计作实包许可缺失 |
| `standardwebhooks` | 1.1.1 | 包内未找到适用许可全文，汇总只有名称／MIT 标识；不能直接用上游仓库根许可替代其 Node 子项目适用许可 |

另有六个包根未带独立通知：`proxy-agent-negotiate`、`@earendil-works/pi-telemetry`、三个 `@aws-sdk` 包（`nested-clients`、`credential-provider-login`、`credential-provider-http`）以及 `@esbuild/win32-x64`。esbuild 同版本 JS 包已有 MIT 正文，其平台 EXE 仍需显式映射；AWS 包是否可共享现有 Apache 文本及有哪些 NOTICE／归属须核对，不能将“没有每包一份 LICENSE”直接等同于违法。当前缺的是可靠的逐项适用通知关联，不能把别处存在一个同名许可证视为自动覆盖。

该 ZIP 对应的历史 `scripts/build.mjs` 会为没有找到许可文件的包仍生成空段，这是上面三个空标题的直接原因。源码工作区中补文档不会修复已发布 ZIP。重新发行必须补充准确的上游全文／版权／必要 NOTICE，并从最终 ZIP 重新检查。

**2026-10-18 收编更新：** main 已通过 [PR #25](https://github.com/KongouAirlines/ivaraige/pull/25)／`4d36624` 为 pi-ai、standardwebhooks 增加固定版本许可全文回退，从 data-uri-to-buffer 的 README 提取 MIT，并在无通知时拒绝构建。[发行记录](public-installation.md#正式发布结果2026-10-17)记载最终 `0.1.0` npm 包的 50 项通知均非空；[回归测试](../../../test/license-notices.test.mjs)覆盖这三个包。该修复关闭新 Node bundle 的空通知段问题，不代表所有 Node 分发材料均已核验，也没有更新本节所审计的旧 Windows ZIP。

已定位可用于补齐的固定来源：pi-ai 与 pi-telemetry 使用 [该版本根 MIT](https://github.com/earendil-works/pi/blob/f07218c4d4bbc12bef056a7058c3dd49dfe41abe/LICENSE)（Mario Zechner）；standardwebhooks 使用 [该版本 `libraries/LICENSE`](https://github.com/standard-webhooks/standard-webhooks/blob/b4d2c14fc5b4ccff3ff271e3b087dff812254c59/libraries/LICENSE)（Svix），其仓库根 Apache 文本不适用于替代该 JS 库的 MIT。`proxy-agent-negotiate@1.1.0` 的[固定源码](https://github.com/TooTallNate/proxy-agents/tree/b7e5f7ccce1a3ac5b339cc4c587974e8989cbc16/packages/negotiate)只有 MIT／作者元数据，未找到根或该子包的许可全文；不擅自复制兄弟包的版权声明。这些是补齐来源，尚未进入旧 ZIP。

## 4. PDF 运行时：锁文件不能替代实际入包清单

随包有 85 项 `requirements.lock`、16 份 dist-info metadata／RECORD，以及 86 段总通知（85 锁项加 PyInstaller）。当前包没有在这些标题中漏掉锁项；这不证明 collector 能覆盖实际闭包。

基于 PYZ 模块别名和普通文件，73 个锁项观察到 payload，12 个未观察到：`filelock`、`fsspec`、`hf-xet`、`huggingface-hub`、`imageio`、`jinja2`、`markupsafe`、`networkx`、`ruff`、`tifffile`、`toposort`、`uharfbuzz`。“未观察到”仅限本轮别名及路径检查；不由此删除依赖或断言其从未用于构建。

同时发现不在锁中的 **setuptools 130 个嵌入模块**，包括 `_distutils` 和 `_vendor`，以及一个普通资源文件；没有对应 dist-info 版本或专门许可条目。PyInstaller 启动及 runtime hook 也在 CArchive 内，不能只把它当作完全未分发的构建工具。构建机需补齐实际 setuptools 版本、vendored 包及适用通知，这一缺口不能靠加上一个 MIT 简称关闭。

以下材料不足需要分别处理：

| 对象 | 已观察到 | 仍缺少的核验 |
| --- | --- | --- |
| flatbuffers 25.12.19 锁项 | PYZ 中 9 个模块；自身汇总段退化为 `Apache 2.0 (no standalone license text...)` | 包内其他库也有 FlatBuffers／Apache 文本，但未明确映射到这份 Python 分发；补核精确版本的版权、许可和 NOTICE，不能称全包没有 Apache 全文 |
| PyMuPDF 1.26.7 | metadata、两个 PYD、`mupdfcpp64.dll`；自己的 `COPYING`／汇总段仅是双重许可声明 | BabelDOC 段有共享 AGPL 全文；仍需明确 PyMuPDF／MuPDF 对应版本、归属和源码提供方式，声明本身不是商业授权 |
| FFmpeg | `_internal/cv2/opencv_videoio_ffmpeg500_64.dll`，30,876,160 字节；OpenCV 的 `LICENSE-3RD-PARTY.txt` 含 LGPL 2.1 | 该 DLL 精确源码、patch、编译配置及适用源码／重新链接材料；顶层 OpenCV Apache 标签不能替代。未验证是否启用额外 GPL 部分 |
| Levenshtein、certifi、orjson、tqdm | 实际 payload 及汇总通知存在；固定元数据分别涉及 GPL-2.0-or-later、MPL-2.0、复合 MPL／Apache／MIT、MPL／MIT | 按实际适用条款建立对应源码获取说明，不能将许可简称当作源码交付 |
| FreeType、libspatialindex、Hyperscan、OpenBLAS、OpenSSL、VC／UCRT 等 | 原生文件实际存在；若干总通知已有相关文本 | 逐 DLL 的版本、原始 wheel／runtime 及其内嵌库来源；Python wrapper 的许可不能直接套给其加载的原生库。VC 组件需对应实际可再分发条款，不能自动当作 AGPL |

324 个原生文件中，27 个能与随包 RECORD 的 SHA-256 对上，没有观察到对账项摘要不一致；其余 297 个缺少可用的随包 RECORD 对应。这是**内部一致性检查**，不是独立上游 wheel 证明，也不是说其余 297 个文件都无许可。原生映射保留每项摘要、候选包和证据强度，未确定项明确为未决。

## 5. 对应源码与构建材料

原 Release 正文指定项目源码 [`bdd18546647732718ed4b63a5847f601eb651ea9`](https://github.com/KongouAirlines/ivaraige/tree/bdd18546647732718ed4b63a5847f601eb651ea9)，当时 tag 为 `a6dcc2b`。本轮确认 PDF server、lock、构建／准备脚本与声明提交无差异；不能因 tag 较早就说没有源码定位，也不能据此宣称每个第三方二进制均已对应源码。

| 组件 | 本轮核对的固定源码入口 | 状态 |
| --- | --- | --- |
| BabelDOC 0.6.4 | [源码 `17480db9df92ddcb37349ce34b312335226e8ec9`](https://github.com/funstory-ai/BabelDOC/tree/17480db9df92ddcb37349ce34b312335226e8ec9) | AGPL-3.0；PyPI sdist 摘要记录在包映射中 |
| PyMuPDF 1.26.7 | [源码 `8264a4b3798d06ec44af2e0e9d2a13abbc94e97d`](https://github.com/pymupdf/PyMuPDF/tree/8264a4b3798d06ec44af2e0e9d2a13abbc94e97d) | AGPL／商业二选一路径；未见本项目商业授权材料 |
| MuPDF | PyMuPDF 该版 `setup.py` 指向 [MuPDF 1.26.12](https://github.com/ArtifexSoftware/mupdf/tree/4b34e2ee9ed0171f16c2891fee1601bc844334ac) | 这是上游构建线索，仍需证明实际 DLL 与其构建相对应 |
| PyInstaller 6.22.3 | [源码 `ecd7993d65c43b254f4e3f718e36d5b4a70a3ed5`](https://github.com/pyinstaller/pyinstaller/tree/ecd7993d65c43b254f4e3f718e36d5b4a70a3ed5)、[许可及例外](https://pyinstaller.org/en/v6.22.3/license.html) | 例外不豁免其他被打包依赖的条款；区分工具与嵌入的 bootloader／hook |
| Python | 历史记录 3.13.12，实际 `python313.dll` 内也有 `3.13.12` 字符串 | 仍需固定所用运行时发行来源及其原生依赖清单；字符串不是完整构建来源证明 |

86 个固定版本 PyPI metadata 均已获取；映射列出可用 sdist 的精确 URL／摘要。**未下载审阅所有 sdist，索引不是完整源码包，也不是已发布的源码 offer。** 必须继续确定实际修改、原生组件和必要构建输入，而不是给每个顶层项目一个首页链接。

[AGPL §1／§6](https://www.gnu.org/licenses/agpl-3.0.txt)要求适用的对应源码及构建／安装材料，并允许 §6(d) 的同处或明确指引到另一服务器的等价源码访问；不要求源码必须匿名公开，也不要求位级可复现。这里未验证每名二进制接收者的等价源码访问。项目自有 sidecar 的授权与适用范围仍依赖 F-A，不能仅凭进程隔离判定整个 Node 应用的许可。

构建脚本只指定 Python 3.13 和 PyInstaller 顶层版本，未固定 setuptools／hooks-contrib 等完整构建闭包，锁文件没有 wheel 身份／摘要，资产取自构建机现有缓存。这些首先是来源与重建证据缺口；不把所有通用构建工具都自动纳入 AGPL 必须提供的源码范围。对实际分发的 FFmpeg 等原生组件，仍须按其自身条款检查，参见 [FFmpeg 官方分发说明](https://ffmpeg.org/legal.html)。

<a id="6-关闭-f-b-所需的具体后续"></a>

## 6. 恢复二进制分发前的验收

1. **完成基础 ZIP 的通知整改。** 新 Node bundle 的三个空通知段和缺失通知拒绝构建已由 PR #25 修复（见 §3）。后续拟发行 ZIP 须补齐准确通知，并明确另外六项的共享／独立通知关系；必须检查最终包，不能以新 bundle 的修复追认旧附件。
2. **以实际冻结闭包收集 PDF 材料。** 保留完整安装 metadata、wheel 文件名／摘要、PyInstaller Analysis／TOC、Python 来源；补 setuptools 及其 vendored 包。不能将锁中未入包条目当作覆盖证明，或将文件名许可声明当作正文校验。
3. **关闭原生与源码未决项。** 对 FFmpeg、MuPDF、VC／UCRT 等确认精确来源、版本、修改、构建配置及适用通知／源码获取方式；将当前候选归属升级为有证据的映射。原始构建记录不足时，从记录完整的 Windows 环境重新构建并核验新包，不猜测旧 DLL 的来源。
4. **与 F-A 的权利确认衔接。** 由权利人确认自有代码的授权和拟采用的分发路径；为适用组件准备完整对应源码及清晰的接收者获取入口。商业授权只有实际取得且覆盖相应组件才可使用。
5. **最终归档再验收并另行授权发布。** 新包、通知／源码材料和配套 manifest 一起核验；从接收者视角验证源码入口后再发布新包。已撤下的旧附件保留历史身份，不将新包冒充旧包。

上述要求针对后续拟分发的实际包。旧附件已撤下，当前不安排重新打包；原审计未决项保留，恢复分发时按新包内容复核。已有接收者所需的对应源码材料仍单独处理。F-B 保持未关闭，不另建重复 follow-up ID。

## 7. 可重复的归档核验

[只读清单脚本](../../../scripts/audit-release-archives.py)只使用 Python 标准库。旧 Release 已删除，不能再通过 GitHub 下载复现原审计。只有已保存原 `release.json` 和四个附件时，才能离线运行以下命令；三份精简映射不能替代这些输入。若缺少原输入，可运行下方夹具测试，不能据此声称复核了旧实包。

```sh
python3 scripts/audit-release-archives.py \
  --release evaluation/runs/pdf-license-audit-0.1.0/release.json \
  --downloads evaluation/runs/pdf-license-audit-0.1.0/downloads \
  --output evaluation/runs/pdf-license-audit-0.1.0/inventory
python3 test/audit_release_archives_test.py
```

输出目录必须尚不存在；脚本要求所有 API 附件大小和摘要一致，缺失／半包／摘要失配／路径越界／重复成员均失败，不留下部分成功目录。文本副本按目标文件系统独占创建；若两个成员映射到同一文件（如 Windows 上的 `LICENSE` 和 `license`），整次审计失败并清理临时输出，不覆盖已有副本。不解压执行、不跟随归档链接；仅复制有界 UTF-8 许可和 metadata 供阅读。`verified` 字段仅表示资产字节身份，链接会单列人工复核要求。该脚本不自动识别所有许可证，不读取所有 EXE 内部模块，也不代替本报告的人工对应源码审查。

本轮验证：三个原创 ZIP／tar 夹具测试通过，涵盖正常索引、缺失及摘要失配、越界与重复成员；在四个真实附件上运行成功。补查了 CamelCase `ThirdPartyNotices.txt`、`CopyrightNotice.txt`，避免遗漏实际 ONNX Runtime／tslib 通知。JSON 映射、路径和文档链接另行校验；没有为只读审计重跑无关的业务全套测试。

CI 使用已有 Python 3.13 环境运行以下夹具命令，Windows 本地也可使用；仅需 Python 标准库，不下载 Release 附件或安装 BabelDOC：

```sh
python -m unittest discover -s test -p audit_release_archives_test.py
```

上面的离线示例使用 POSIX shell 续行语法；Windows 可将清单脚本调用合为一行并使用 `python`。运行前须创建输出父目录，原 API JSON 应为 UTF-8。离线脚本不访问 GitHub，也不需要 token。夹具只验证清单工具的行为，不生成或验证三份人工映射，也不代替 PyInstaller 嵌入模块和对应源码的人工核验。

<a id="integration-2026-10-18"></a>

## 8. 主线收编记录（2026-10-18，香港时间）

收编分支 `codex/0.1.0-pdf-license-integration` 基于 `main/dde75f5`，承接原审计提交 `3d3f9fc` 的六个独立文件。三份 JSON、清单脚本和夹具保持原内容；报告保留历史观察并标明 PR #25 后的变化。主线实施导航与公开准备计划只追加本次进展，第三方声明补充实际归档覆盖限制，审计夹具接入现有三系统工作流。

2026-10-18 只读 GitHub 复查显示仓库仍为 private，PR #24 的 head 仍为 `3d3f9fc`，目标仍为旧准备分支；四个旧附件的 API 大小及 SHA-256 与 §1 相同。这仅确认远端元数据与历史证据一致，本次未下载四附件、重读 PYZ／CArchive 或复验上游资源及源码。

本地 Windows／Python 3.13.12 运行上述 CI 夹具命令，3/3 通过；覆盖 ZIP／tar 清单、通知分类、链接人工复核标记、缺失／摘要失配、越界／重复成员及失败时无部分输出。首次在受限沙箱内创建临时目录时遇到 `WinError 5`，未执行测试主体；在正常权限下重跑通过。成功日志为忽略目录 `evaluation/runs/pdf-license-integration-0.1.0/audit-fixtures.log`。这不是三系统远端 CI 通过证据。

三份 JSON 可解析，182 个资源、85 个 Python 锁项、113 个 npm 安装实例、324 个原生文件的数量与原报告一致；资源／npm／原生路径无重复，资源通知非空、摘要格式与 `upstream_match` 自洽，27 项保留 RECORD owner，原生文件均保留未作独立上游二进制比较的标记。五个原样收编文件与 `3d3f9fc` 的 Git blob 一致。四份变更 Markdown 的 75 个本地链接及锚点检查通过，CI 步骤与现有三系统矩阵作了静态核对，暂存 diff 空白检查通过。这些检查只覆盖本次收编，没有重跑业务全套、真实模型、Windows 安装或 PDF 排版。

本次收编不改变旧附件、tag 或仓库可见性。F-B／P2 仍未关闭；F-A 授权和最终发行物整改继续按公开准备计划及 §6 处理。没有新增、推进或关闭 follow-up ID。

## 9. 文本副本路径冲突修正（2026-10-19）

针对 [PR #31 的评论](https://github.com/KongouAirlines/ivaraige/pull/31#issuecomment-6267057241)，将文本副本写入改为独占创建，由实际文件系统识别路径冲突；原成员路径和清单格式保持不变。区分大小写的文件系统仍可保留不同大小写的两份文件。

本地 Windows／Python 3.13.12 验证：新增 ZIP／tar.gz 夹具，分别覆盖文件名大小写冲突与目录、文件名同时变换大小写的冲突。修复前四个子例均因旧脚本错误地返回成功而失败；修复后完整夹具套件 4/4 通过，冲突报错且最终目录、临时输出均不残留。首次沙箱运行在创建临时目录时遇到 `WinError 5`，以上结果来自正常权限重跑。大小写敏感文件系统的保留副本及摘要一致性断言已加入夹具，本次未在该类文件系统运行。没有重新核验历史附件或改变三份映射，也未新增或更改 follow-up 状态。
