# 安装/发行组审查报告（PR #17、#25）

> 2026-10-19 归档。以下评分、发现与验证结果来自原审查；“main”指 `dde75f5`，行号对应各节 PR head。后续变化与查阅方式见[归档说明](README.md)。


审查视角：安装/发行审查员（组合根与安装层边界、下载/校验/解压安全、生命周期与失败恢复、发行构建与 npm 包、许可与文档承诺、DSH/ADR 复用）。
审查方法：只读静态审查 PR head 完整文件树（自建 worktree，head 逐文件读）+ 对照 `origin/main` 当前状态（`dde75f5`）；未在共享 main worktree 构建/测试，未联网下载、未跑真实模型。
标注约定：`[确认]` = 代码/文档原文可直接核对；`[推断]` = 静态推理并写明前提；`[待验证]` = 需运行/外部环境；`[main 已修]` / `[main 仍存在]` = 相对当前 main 的结论。
基准注记：PR #17 head 树只有 ADR-0001；ADR-0002（`docs/decisions/0002-plugin-composition-0.1.0.md`，2026-10-13 采纳）在 PR #17 head 之后进入主线，故对 #17 的架构判断同时用 v2.0 设计 §0/§7 与 ADR-0002 的边界条款复核。

---

<a id="pr-17"></a>

## PR #17 — feat: Windows 安装与首次启动，私有 Release 按需安装 PDF（MERGED，base=4df1d72，head=db171f7，+7213/-40，58 files）

**结论**：B。把“安装选择”放在组合根、把下载/校验/解压/激活封装为 `Components` 能力，并复用 DSH jobs/credentials/settings，方向与 ADR-0002 一致；安全处理（SHA-256、大小上限、解压路径/链接拒绝、跨主机重定向不带凭据、错误信息不含 token）在同类实现里属扎实水平。主要问题不在“有没有校验”，而在**发行物来源叙述自相矛盾**、**激活崩溃窗口无恢复**、**安装任务与文档任务共用唯一 DSH job 槽**，以及把 PDF 组件设置注册写进了通用 DSH 设置引导。未发现 P0 或可直接利用的下载/解压/凭据漏洞。

**范围与流程**：8 个提交围绕“便携启动 + 组件安装 + 发行构建 + Sandbox 验收”展开，主题集中；但夹带了 5 个无关 PDF follow-up 的状态改写（`docs/plan/follow-ups/pdf-formula-replay.md` 等把“处理中”改成“已解决”）和 v2.0 §0 平台段改写，属于范围外噪声。PR body 级信息不可得；“Windows Sandbox 通过”等结论的证据全部在 gitignore 的 `evaluation/runs/`（`docs/plan/0.1.0/installation.md:78`），仓库内只有脚本和叙述，复核者无法独立验证。

**Cordis/架构**：
- 组合根确实“只做选择与装配”：`src/app.mjs:64-72` 决定 `components`/`Pdf`/PDF 设置页是否挂载，`src/components.mjs` 作为独立可选能力（有 `close()`、jobs controller disposer `src/components.mjs:39-40`），`src/adapters/pdf.mjs` 只消费冻结数据、拿不到 LLM 服务；安装/下载没有进入 `operations`/入口的业务分支，入口只做参数到内核操作的映射（`src/cli.mjs:48-58`、`src/http.mjs:10-16`）。
- 但 **PDF 组件设置插件被写进通用 DSH 设置引导**：`src/model-settings.mjs:291-296` 在 `ensureProfile()` 里无条件向受管 profile bundle 追加 `{id:'ivoraige-components', name:'cordis:componentsSettings'}`，`:314` 在 `bootModelSettings()` 内置注册 `componentsSettings`。后果：(a) 任何启用 settings 的组合（包括只读 CLI 命令、测试、未来宿主）都被写入 PDF 组件命名空间，即使没有挂载 `Components`；(b) 每次启动都可能改 `cordis.patch.yml`，使“只读命令”产生配置副作用。与 ADR-0002 §2“通用服务不根据 pdf/提供商/入口分支”不符，应把该条目交给组合根在决定挂载 `Components` 时追加。
- 生命周期总体正确：`createApp` 退出顺序 tasks → components → fiber → store lock（`src/app.mjs:107-115`），安装进行中关停会 abort/等激活（`src/components.mjs:278-288`）。但详见 R17-10、R17-02。

**设计一致性**：
- `docs/requirements/v2.0/03_API-protocol_v2.0.md:244-248` 在本 PR 同步新增 §3.8（组件路由、状态、激活边界、重启语义、CLI 映射），实现与规范基本一致（`status/catalog/credential/install/local/task/cancel`、`COMPONENT_MISSING`、激活后取消 CONFLICT、失败 4/取消 5）。
- 偏差：§3.8 未说明组件安装占用的全局 job 并发额度，也未说明安装会阻塞/失败文档任务（见 R17-04）；`installation.md:36` 只承诺“失败或取消不覆盖已有可用版本”，未覆盖进程崩溃窗口（见 R17-02）。
- “Windows/PDF 专用分支只出现在安装层/适配器”总体成立；`src/sidecar.mjs:322-333` 的 win32 进程树终止属于进程生命周期而非安装选择，可接受，但值得在 ADR-0002 复核时显式归类。

**代码/逻辑/结构**：
- 安全校验链完整：清单严格 schema（`src/component-package.mjs:30-59`）、asset 名称/大小/SHA-256（`:50-53`、`:143-145`）、解压前 `inside()` 路径约束（`:174-182`）、`tar.x` 只允许 File/Directory 并拒绝链接/特殊文件与 8 GiB/10 万条目上限（`:189-205`）、安装后再校验 `component.json`（`:209-237`）；本地安装先把源字节复制进 stage 再校验（`src/components.mjs:160-176`，测试 `test/components.test.mjs:204-219`）。
- 令牌边界：`fetchRelease` 在 PR #17 仍强制 token（`src/component-package.mjs:106`），下载重定向 `redirect:'manual'` 且跨主机不带 Authorization（`:82-101`）；`status()` 不含 token（`src/components.mjs:69-78`），测试断言 status 序列化不含 token（`test/components.test.mjs:301-303`）。
- 主要实现缺陷见清单：崩溃窗口/无启动恢复（R17-02）、canonical path 严格相等导致误报缺失（R17-03）、单 job 槽相互阻塞（R17-04）、组件目录无跨进程锁（R17-05）、关停可无限等待（R17-10）、临时目录残留（R17-13）。

**文档/风格**：
- `THIRD_PARTY.md:24` 把 `tar@7.5.22` 写成 “ISC”，而 `package-lock.json:2220` 记录 `"license": "BlueOak-1.0.0"`；属许可声明错误（P2）。
- `docs/plan/0.1.0/installation.md:75` 称“基础 ZIP 当前附件构建对应 `8a1bffc…`，SHA-256 为 `db0880…`”，同文件 `:105` 又写“现有基础 ZIP 仍对应 `bdd1854`”；同一唯一已发布 Windows 产物的源码提交在两处冲突，且 tag 是首轮实现位置、附件后来被更新（`:75`），使“附件↔源码↔tag”三者不可唯一复原（P1）。
- `web/pdf-settings.jsx:6` 硬编码 `blob/main` 指南链接，并被 `test/pdf-settings-ui.test.mjs:78` 断言锁死；PR 内已登记 follow-up `docs/plan/follow-ups/release-documentation-binding.md:9-14`，PR #25/#27 才解决。

**测试与证据**：
- 新增 `test/components.test.mjs`（373 行）覆盖：坏 SHA、失败升级保留旧选择、SemVer 降级拒绝、多版本清单拒绝、stage 后源文件被替换、同版本修复、激活失败回滚、激活期不可取消、关停等待提交、job 饱和映射 CONFLICT、本地/远程安装、取消下载。设计良好且断言具体（例如 `test/components.test.mjs:141-155` 同时断言 `archiveRequests` 未增加）。
- 但下载/发行全部是**受控 mock fetcher**（`test/components.test.mjs:283-292`、`:337-352`），没有真实 GitHub/代理/私有 Release 的自动化证据；解压只测了 `../escape` 文本头（`:314-335`），未测符号链接/硬链接条目、`assetsOnly` 违规、重定向到 http、>5 跳、Windows rename EPERM 重试（`src/components.mjs:16-23`）；证据在 `evaluation/runs/` 忽略目录，不能被 CI 或审阅复跑（R17-09/R17-17）。
- 文档声称“212/212”等数字与 `installation.md` 记录的 Windows Sandbox 结果 `[待验证]`（证据未随提交）；PR #17 也明确写了“干净 Windows 验收保留待完成”后又写“Sandbox 通过”，两段需按时间读，不能作为当前 main 的保证。

**问题清单**：

| ID | 严重度 | 位置 | 问题与证据 | 建议 |
|---|---|---|---|---|
| R17-01 | P2 | `src/model-settings.mjs:291-296`、`:314` | `[确认]` 通用 DSH 设置引导无条件追加 `cordis:componentsSettings` 并在所有 profile 注册 `componentsSettings`；即使组合根没有挂载 `Components` 也生效。违反 ADR-0002 §2 通用服务不按组件分支。 | 由 `createApp` 在决定挂载 `Components` 时把该 profile 条目作为显式参数/补丁传入，或让 `bootModelSettings` 接受可选插件列表；增加“settings-only 组合不含组件命名空间”的测试。 |
| R17-02 | P2 | `src/components.mjs:217-246` | `[确认]` 激活是“rename root→`.replaced-<uuid>` → publish 新 root → 写 settings”三步；进程在两次 rename 之间或写 settings 前崩溃时，`installedPdf` 仍指向已不存在的 root，旧文件成为孤儿 `.replaced-*`，启动没有恢复/清扫逻辑；`installation.md:36` 只承诺“失败或取消不覆盖已有可用版本”，未覆盖崩溃。 | 增加激活 journal/原子换名协议（先写 pending 记录，启动时按 journal 回滚或完成），或启动时扫描 `.replaced-*` 并恢复；补一个模拟“rename 后崩溃”的恢复测试，并在文档写明崩溃语义。 |
| R17-03 | P2 | `src/components.mjs:59-63` | `[确认]` 代码逻辑：`if (await realpath(root) !== root) return null` 用 canonical path 与字面 path 做严格相等；`src/cli.mjs:234/256` 用 `join(dirname(resolve(store)),'components')`（未 realpath）。`[推断]` 影响：当数据目录经 junction/symlink 到达（例如 `IVORAIGE_DATA_DIR` 指向目录联接，或 macOS `--store /tmp/...`）时安装写入非 canonical root，重启后 `realpath(root) !== root` 成立，组件被误报 “missing or invalid”，Pdf 适配器不挂载、降级保护也失效。 | 改为比较 `realpath(selected)` 与 `realpath(directory)` 的包含关系（并保留 symlink 逃逸拒绝）；安装完成时把 canonical root 写入设置；补 symlink 数据目录回归。 |
| R17-04 | P2 | `src/app.mjs:63`、`src/components.mjs:119-122`、`src/tasks.mjs:244`、`src/tasks.mjs:8-11`、`test/components.test.mjs:353-372` | `[确认]` `JobsLocal{maxConcurrentJobsPerOwner:1}` 下安装任务与文档任务是同一 unowned 槽：安装运行期间任何 import/translate/export 的 `jobs.start` 都会抛普通 Error，被 `tasks.mjs:251-253` 记为 failed；`safeMessage`（`tasks.mjs:8-11`）对非 `KernelError` 统一返回 “Translation failed; check the configured model and retry”，把“安装占槽”误导成模型问题，且不是 §1.4 的“同 docId 互斥 409”。反之长翻译也让安装返回 CONFLICT。测试 `test/components.test.mjs:353-372` 已证明安装被任意 job 阻塞。文档/协议 §3.8 未说明这一全局互斥。 | 给组件安装单独的 owner/job 配额（或显式排队），或在 `Operations` 层把饱和映射为可读的 CONFLICT/PRECONDITION 并写进 §3.8/安装指南；`safeMessage` 增加 job-saturation 分支；补“安装中发起翻译”的入口测试。 |
| R17-05 | P2 | `src/cli.mjs:234`、`:256`、`src/app.mjs:66-68`、`src/adapters/pdf.mjs:17-18` | `[推断]` 组件目录由 `dirname(store)` 推导，两个使用同一目录下**不同 store 文件**的内核会共享 `components/versions/...`；`Components` 只有进程内 `this.tasks` 冲突检查，没有目录级锁，两个进程可同时 publish/rollback/删除同一 root。`pdf.mjs:17-18` 的注释已承认不同数据库可共享 PDF 目录，同一风险成立。 | 在 `components` 目录内加独占锁文件（`wx`/租约）覆盖整个 `performInstall`，或把组件目录绑定到 store 身份；文档说明不同 store 共享目录不受支持。 |
| R17-06 | P2 | `THIRD_PARTY.md:24`、`package-lock.json:2220` | `[确认]` 文档写 “The component installer uses `tar` 7.5.22 under its ISC license”，锁文件实际许可证为 `BlueOak-1.0.0`。`[main 仍存在]`。 | 更正为 BlueOak-1.0.0 并确认随包保留其 LICENSE 文本；发布前把第三方许可表纳入 `verify-release` 的机器检查。 |
| R17-07 | **P1** | `docs/plan/0.1.0/installation.md:75`、`:105`、`docs/plan/0.1.0/public-readiness.md:61`（后续 main 文档） | `[确认]` 同一文档对唯一已发布 Windows 基础 ZIP 的源码提交给出两个互斥答案：`:75` “当前附件构建对应 `8a1bffc…`，SHA-256 `db0880…`”，`:105` “现有基础 ZIP 仍对应 `bdd1854`”；`public-readiness.md:61` 又写“上传紧随 `bdd1854` 提交”。附件与 tag 本身也不对应（`:75` “tag 保留首轮实现位置”）。这直接破坏“发行附件↔源码↔tag”的可复核性，是安装/发行审查的关键失真。 | 用一张唯一来源表记录每个附件的文件名/字节数/SHA-256/构建提交/Release tag 或 run id，删除旧叙述；发版机制上由 `verify-release` 类工具生成该表（PR #25 已引入，但旧附件仍缺）。 |
| R17-08 | P2 | `scripts/build-distribution.mjs:12-16`、`:69`、`:102` | `[确认]` 便携包运行时直接复制构建机的 `process.execPath`（`:69`），只校验版本字符串（`:16`、`:102`）。没有固定官方 Node 26.7.0 发行包 URL/SHA-256/签名校验，构建机上被替换过的 `node.exe` 可通过全部证据。对“自带运行时”的发行物，这是供应链可验证性缺口。 | 从固定 URL 下载 `node-v26.7.0-win-x64.zip`，先核对官方 SHA-256 再用其中 `node.exe`；把运行时摘要写入 `build-evidence.json` 并由校验脚本比对。 |
| R17-09 | P2 | `test/components.test.mjs:275-304`、`:314-335`；`src/component-package.mjs:189-205` | `[确认]` 下载链路只以 mock fetcher 断言（含“不泄露 Authorization”），没有真实网络；解压测试只有 `../escape`，未覆盖符号链接/硬链接/设备条目、`assetsOnly` 越界、重定向到 http、>5 跳、`publishDirectory` 的 Windows EPERM 重试。这些正是 `extractVerifiedArchive`/`publishDirectory` 的失败分支。 | 增加 tar 夹具：Symlink/Link/CharacterDevice 条目、assets 包夹带 `component.json`、http 重定向、6 跳链、rename EBUSY；并把真实私有 Release 的“只读清单+下载+校验”作为可选集成测试（有凭据时运行）。 |
| R17-10 | P3 | `src/components.mjs:278-288` | `[确认]` `while (!terminal.has((await this.jobs.wait(taskId, 30_000)).status)) {}`；pinned DSH 的 `waitJob` 超时是 **resolve 当前视图**（main worktree pinned DSH bundle `dist/dsh.mjs:112694-112726`），若 job 因不响应 abort 的 fetch 或卡住的 settings.mutate 永不 settle，关停会无上限自旋，且没有日志/错误出口。 | 设总 deadline，超时后记录残留任务并以明确错误结束；对 committing 任务给出“激活超时”的可见状态。 |
| R17-11 | P3 | `src/launch.mjs:60-62` | `[确认]` `catch` 中先 `await server?.close(); await app?.dispose()` 再进入 CONFLICT 的 10 秒等待分支；清理抛错时第二实例回退逻辑不会执行，用户看到清理错误而非“已有实例/稍后重试”。`[main 已修]`（main `src/launch.mjs:61-62` 用 try/catch + console.error 包裹）。 | 保持 main 的修法；回归测试覆盖“清理失败 + CONFLICT”组合。 |
| R17-12 | P3 | `src/launch.mjs:33-48`、`src/cli.mjs:108-113` | `[确认]` 启动器只使用 `dataDir/store.sqlite`，不识别 `IVORAIGE_STORE`/`--store`；CLI 仍尊重两者。用户设置 `IVORAIGE_STORE` 时 GUI（`npm start`/便携包）与 CLI 会落到不同数据库，文档（installation-guide、development-guide）没有提示。`[main 仍存在]`。 | 启动器读取同一 precedence（`IVORAIGE_STORE`/`--store`），或在文档中明确启动器只认 `--data-dir`，并让 CLI 在该环境下打印警告。 |
| R17-13 | P3 | `src/components.mjs:88-93`、`:192`、`:256` | `[确认]` `.catalog-*` 只有正常 `finally` 清理；`.install-*` 依赖 finally；进程崩溃后残留目录无启动清扫，且 `.replaced-*` 孤儿可能长期占用数百 MB。 | 服务初始化时按前缀+年龄清扫自己目录内的临时项（失败不阻塞启动），并在状态/文档中说明。 |
| R17-14 | P3 | `src/cli.mjs:234`、`:256`、`src/model-settings.mjs:291-296` | `[确认]` 所有本地 CLI 命令都会挂载 `Components` 并首次写 profile patch，例如只读的 `ivoraige documents --json` 会在首次运行改写 `cordis.patch.yml`；与 R17-01 同一根因。 | 与 R17-01 一并修：按需挂载并把 profile 补丁限定在安装能力装配时。 |
| R17-15 | P3 | `web/pdf-settings.jsx:6`、`test/pdf-settings-ui.test.mjs:78` | `[确认]` 设置页指南写死 `.../blob/main/docs/plan/0.1.0/pdf-guide.md`，测试反而断言该可变链接；私有/离线安装中链接需要仓库权限且会随 main 漂移。已登记 follow-up `release-documentation-binding`，PR #25/#27 对 0.1.0 才提供随包静态指南。 | 跟随 main 的 `/pdf-guide.html` 本地方案；旧 tag 附件保留历史说明即可。 |
| R17-16 | P3 | `package.json:13-30`、`THIRD_PARTY.md:19` | `[确认]` `files` 不含 `sidecars/babeldoc/asset-licenses/`，但 THIRD_PARTY 用代码引用该目录作为资源许可与来源映射；npm 包中该指针指向不存在的路径（PR #25 仍存在，见 R25-06）。 | 把许可/来源映射纳入 `files`，或把随包 THIRD_PARTY 的引用改成 `dist/THIRD_PARTY_LICENSES.txt` 与包内实际文件。 |
| R17-17 | P2 | `docs/plan/0.1.0/installation.md:64-89`、`:78` | `[待验证]` “Windows Sandbox 通过 11 项检查”“真实 GitHub 下载 436,608,763 字节”等关键验收全部引用 `evaluation/runs/` 忽略目录；仓库/PR 中没有 `report.json`/`evidence.json`/日志摘要，复核者只能相信叙述。违反“evidence over assertion”的可核对性要求。 | 发版时把脱敏后的 `report.json`、`evidence.json`、`build-evidence` 作为附件或小文件随 PR/Release 提交（PR #27 对 0.1.0 做了这件事，可作为回填格式）；文档中链接可下载证据而不是本机路径。 |

**跨 PR 关联**：`[main 已修]` R17-11；`[PR #25 修复/演进]` 匿名令牌（R17 要求 token 的 `component-package.mjs:106` 被 PR #25 删除）、`clearToken`、私有 Release 错误分类；`[main 仍存在]` R17-01/03/04/06/07/12/16；`[被 #19/#25 更新]` 设置页指南链接（R17-15 → follow-up 关闭）；`[PR #24 OPEN]` 其许可审计正是 R17-06/R17-07 及 F-B 缺口的后续。

---

<a id="pr-25"></a>

## PR #25 — release(0.1.0): prepare source and npm distribution（MERGED，base=3421ba5，head=4d36624，+1867/-155，49 files）

**结论**：B-。发行工具链（`pack-npm`、`release-docs`、`verify-release`、`smoke-package`）比仓库以往任何阶段都更可复核：tag↔commit↔证据↔tarball 字节↔重新构建逐文件比对、指南 HTML 由 Markdown 重新生成、链接与缺失/多余文件都被拒绝，测试用真实 fixture 覆盖了篡改路径；匿名令牌实现也做了“无 token 不发 Authorization、重定向不转发凭据、错误不泄露签名 URL/token”的受控验证。问题集中在**发行元数据的最后一致性**（CHANGELOG 未写 0.1.0、项目无 LICENSE 字段/文件、THIRD_PARTY 的 tar 许可证仍错）、**文档化工作流在无 `.git` 源码归档下必失败**，以及**大量验收证据仍只在忽略目录/Release 附件**，且合并时三系统 CI 全红（docs 已披露，未作为当次发行门槛）。无 P0/P1。

**范围与流程**：4 个提交把 public-readiness 计划文档（+369 行，来自并行分支拷贝）、匿名安装功能、发行脚本与版本/文档收尾放在同一个 PR；标题是 release 准备，实际包含功能变更（`component-package.mjs` 匿名/错误分类、`clearToken`、MCP 版本来源）与文档拷贝，范围偏混合但可追溯。分支基于 PR #19 的 merge commit（3421ba5），依赖 #19 已先行合入；merge commit `cb7e4a4` 正常，无强推迹象。本 PR 同时把 `package-lock.json` 63 个 `registry.npmmirror.com` 解析地址改为官方 registry（核验：diff 中 63 条 `-npmmirror`/66 条 `+npmjs`，多出 3 条为新增依赖），与 npm 12 `allow-remote=none` 的干净安装诉求一致，属可解释的构建修复。

**Cordis/架构**：未改变组合根职责；`mcp.mjs` 版本改为从 `package.json` 读取（`src/mcp.mjs:6`、`:22`），消除硬编码 `0.1.0-dev.0`，是正确方向。`Components.clearToken()`（`src/components.mjs:55-65` 新增）复用 DSH credentials 的 `describe().writable`/`unset` 语义，`writable:false`（环境注入）时拒绝伪删除，行为与 pinned DSH `dist/dsh.mjs:111773-111789` 一致（该行为代码见当前 main worktree 的 pinned DSH bundle）；HTTP DELETE、CLI `credential-clear`、MCP tool 共用同一内核操作，入口零业务。未新增平行 AI 基础设施。

**设计一致性**：协议 §3.8 由本 PR 更新为“匿名或显式令牌”（`docs/requirements/v2.0/03_API-protocol_v2.0.md` 相关段落）；`installation-guide.md:3`、`:40`、`:69` 明确“默认组件来源仍是旧组件 tag `v0.1.0-dev.0`，不随应用版本自动改动”，诚实但说明**应用版本与组件版本被完全解耦**，而 `release-template.md:11` 又把“PDF 组件清单及归档”放在应用 Release 资产清单下（仅一句“旧组件 tag 不随…”），`verify-release` 也不校验组件清单，发版者容易写出“组件与应用同 tag”的错误说明。另：本 PR 的 `public-readiness.md` 与 OPEN 的 PR #24 改动同一文件（PR #24 diff 包含 `docs/plan/0.1.0/public-readiness.md`），后合并者需做内容去重/冲突处理。

**代码/逻辑/结构**：
- 匿名链路正确：`requestHeaders` 无 token 时不生成 `Authorization`（`src/component-package.mjs:61-67`）；`githubFailure()` 对 401/403/404/429 分类且只回状态语义（`:68-88`）；`fetchChecked` 不再透传原始网络异常文本（`:97-104`）；重定向仍用 `redirect:'manual'` 且首请求后才切换无凭据头（`:106-130`）。测试断言了“所有请求手动重定向且无 Authorization”“签名主机 403 不误报 token”（`test/components.test.mjs` 新增 5 个用例）。
- 发行工具链见清单 R25-04/05/06：`pack-npm` 无 dirty 守卫、`smoke:package` 对无 `.git` 源码树必失败、`files` 与 `release-docs` 的 shipped 集合缺许可目录。
- `[推断]` `verifyNpmArchive` 在临时目录重建后逐文件比较（`scripts/verify-release.mjs:39-58`）依赖本机 dev 依赖与固定 DSH 源码；文档已写明校验环境要求，但 `npm run verify:release` 在“源码归档 + 无 dev 依赖”环境会以模块缺失失败，属于可预期的工具前置条件，不是 bug。

**文档/风格**：
- 双语 README/用户指南透明标注“新版 Windows 包未构建、仓库仍私有、许可待定”，能力表（`docs/plan/0.1.0/capabilities.md`）与老 `v0.1.0-dev.0` 附件划清边界，这部分质量高。
- 但正式版本 **没有 CHANGELOG 0.1.0 条目**、**没有项目 LICENSE/`license` 字段**，且 `SECURITY.md` 的私密报告入口在私有仓库阶段不可达（文件已声明“尚未验证启用”，属诚实但仍是发行缺口）。
- `THIRD_PARTY.md:24` 的 tar 许可证错误在 PR #25 中未修正（`[main 仍存在]`）；`THIRD_PARTY.md:19`、`:89` 引用的 `sidecars/babeldoc/asset-licenses/`、`scripts/licenses/0.1.0/` 不在 npm `files` 中，随包文档指向包外路径。

**测试与证据**：
- `test/release-docs.test.mjs` 用自建 Git fixture 覆盖 tag/版本/metadata/ZIP 字节/指南 HTML/README 篡改/缺 runtime 的拒绝；`test/license-notices.test.mjs` 断言 `dist/THIRD_PARTY_LICENSES.txt` 中每一节通知非空，并核对 pi-ai/data-uri-to-buffer/standardwebhooks 的 MIT 正文与版权行；`test/components.test.mjs` 新增匿名、清除令牌、401/403/404/429、网络异常脱敏、签名 URL 失败用例；`smoke-package` 新增“完整数据目录备份 → 同版本换目录安装 → 冻结快照/原导出字节一致”“包内 HTTP 读取 PDF 指南与 release-info”。这些断言质量好，不是只断言 mock 下载成功。
- `[待验证]` 本 PR 声称的 253/254 Node 通过、69 文件 npm tarball、macOS 隔离安装、同版本换目录等，日志在忽略目录 `evaluation/runs/`（`docs/plan/0.1.0/public-installation.md:38`、`:47`、`:76`），仓库内只有脚本；真实 Release 附件（`SHA256SUMS`、build-evidence、acceptance）由后续 PR #27 记录，PR #25 自身无法独立复核。
- `[确认]` 合并时 main 三系统 CI 全部 failure 且 job 未启动（`docs/plan/0.1.0/github-maintenance.md:23-27`，原因账户计费），本 PR 在 Windows/CI 未作为当次验收门槛的情况下合并（`public-installation.md:68`、`:70`）；这是流程性风险而非代码缺陷。

**问题清单**：

| ID | 严重度 | 位置 | 问题与证据 | 建议 |
|---|---|---|---|---|
| R25-01 | P2 | `CHANGELOG.md:8`、`:15`、`:19`、`:43` | `[确认]` 以 release(0.1.0) 为题，但 CHANGELOG 仍只有 `[Unreleased]`（正文仍写 `0.1.0-dev.0`）与 `[0.0.0]`，`[Unreleased]` 链接指向 `pull/4`；没有 `## [0.1.0]` 条目。发布记录（PR #27）之后仍未补。`[main 仍存在]`。 | 增加 `## [0.1.0] - <日期>` 汇总（文本工作台、PDF 组件、MCP、安装/发行、已知限制），更新链接；把 CHANGELOG 纳入发版检查脚本。 |
| R25-02 | P2 | `package.json:4`、仓库根无 LICENSE；`README.md` 末尾、`CONTRIBUTING.md`、`SECURITY.md` | `[确认]` `"private": true` 且无 `license` 字段；仓库没有项目 LICENSE 文件，正式 Release 同时分发源码归档与 npm tarball。文档诚实地写“项目许可仍待团队决定”，但发行物本身未附任何授权文本/保留权利声明。F-A 在 `public-readiness.md:88-96`、`public-installation.md:58` 记录为未关闭；PR #24 仍 OPEN。 | 在发版前由团队选定许可并落 LICENSE/`license` 字段；若确定保留权利，至少在包内放 NOTICE 明确“仅限获授权用户、不得再分发”，并让 `verify:release` 检查许可文件存在。 |
| R25-03 | P2 | `THIRD_PARTY.md:24` | `[确认]` 同 R17-06：tar 7.5.22 标为 ISC，实际 BlueOak-1.0.0。`[main 仍存在]`。 | 更正并加入机器校验（例如构建时从依赖 package.json 生成许可表，与 THIRD_PARTY 交叉检查）。 |
| R25-04 | P2 | `scripts/smoke-package.mjs:182`、`scripts/release-docs.mjs:24`、`docs/plan/0.1.0/development-guide.md:7`、`CONTRIBUTING.md` | `[确认]` `smoke:package` 断言 `release.sourceCommit` 匹配 40 位 hex；无 `.git` 源码归档构建时 `releaseInfo` 返回 `{sourceCommit:null, sourceTree:'unavailable'}`，`assert.match(null,…)` 直接 TypeError。开发指南明确“本页可用于源码检出或无 `.git` 的源码归档”，CONTRIBUTING 又把 `npm run smoke:package` 列为常规检查，两者冲突。`[main 仍存在]`。 | 无 Git 时允许跳过该断言（断言 `sourceTree` 为 unavailable 且指南元数据如实标注），或提供 `--source-archive` 模式；文档写明哪些检查只适用于 Git 检出。 |
| R25-05 | P2 | `scripts/pack-npm.mjs:8-49`、`scripts/release-docs.mjs:19-22`、`scripts/verify-release.mjs:112` | `[确认]` `pack:npm` 不检查工作树是否干净：dirty 树仍会产出 tarball 与 `.build-evidence.json`（sourceTree=modified，指南链接指向基础提交），只有**另外执行** `verify:release` 才会因 `sourceTree !== 'clean'` 拒绝（`verify-release.mjs:112`）。发行流程因此不是“打包即绑定”，存在把未提交内容当成 0.1.0 产物传播的窗口。 | `pack-npm` 在 `sourceTree !== 'clean'` 时默认失败（允许显式 `--allow-modified` 仅供开发）；把 `verify:release` 组合进 `pack:npm` 的发布模式。 |
| R25-06 | P2 | `package.json:13-35`、`scripts/release-docs.mjs:90`、`THIRD_PARTY.md:19`、`:89` | `[确认]` npm `files` 与 `shipped` 集合都不含 `sidecars/babeldoc/asset-licenses/`（PR #17 已跟踪的资产许可/来源映射）与 `scripts/licenses/0.1.0/`（pi/standardwebhooks 的 MIT 全文副本），但 npm 包内 `THIRD_PARTY.md` 用代码引用这两个目录。`pkg` 用户得到的许可正文只有 `dist/THIRD_PARTY_LICENSES.txt`，引用路径失效。`[main 仍存在]`。 | 把这几个许可材料加入 `files`（体积很小），或让 `copyUserDocs` 在随包 THIRD_PARTY 中把这些代码引用改写为包内实际路径；`validatePackagedLinks` 同时检查代码引用的路径存在性。 |
| R25-07 | P3 | `docs/plan/0.1.0/release-template.md:5-11`、`src/app.mjs:70-71`、`installation-guide.md:40`、`:69`、`scripts/verify-release.mjs:113-115` | `[确认]` 应用 0.1.0 的组件来源默认仍是 `v0.1.0-dev.0` 组件 tag；模板把“PDF 组件清单及归档”列在应用 Release 资产下（仅一句“旧组件 tag 不随应用版本自动改动”），`verify:release` 只校验应用 tag/架构，不读取组件清单或记录组件 tag。发布说明可能被写成“组件与 0.1.0 同源”，与实际不符。 | 模板增加独立“组件 tag + `components-manifest.json` 摘要/下载 URL”字段；`verify:release` 增加可选 `--components-manifest` 检查并把组件 tag 写进证据。 |
| R25-08 | P2 | `docs/plan/0.1.0/github-maintenance.md:23-27`、`public-installation.md:68-70` | `[确认]` 合并/发行时 main 的 `ubuntu-latest / Node 24`、`windows-latest / Node 24`、`macos-latest / Node 24` 均为 failure 且零步骤（账户计费门槛，非断言失败）；文档如实披露，该状态未阻止当次发行。发行产物没有独立远端 CI 证据，只有本机/macOS 日志。 | 计费恢复后对 tag 提交重新跑三系统 CI 并记录 run id；在 Release 说明中明确“无 CI 证据、仅本机检查”，不要使用“完整 Node 检查通过”这类易被读成 CI 的措辞。 |
| R25-09 | P3 | `package.json:41-49`、`:13-35` | `[确认]` npm tarball 保留 `build`/`test`/`setup:dsh`/`pack:npm` 等脚本，但 `scripts/`、`test/`、`web/`、`experiments/` 都不在 `files`；安装后在包目录运行 `npm run build`/`npm test` 会 ENOENT。`start` 可用（`src/launch.mjs` 在包内）。 | 运行时包只保留可运行脚本（start/cli），或把这些文件纳入 `files` 并在文档区分“运行时包≠源码发行”。 |
| R25-10 | P3 | `package.json:4`、`docs/plan/0.1.0/public-installation.md:70` | `[确认]` 正式 0.1.0 tarball 仍 `"private": true`（阻止 `npm publish`）。文档明确“只构建本地 tarball，不向 npm registry 发布”，因此行为与意图一致，但 PR 标题的 “npm distribution” 易被读成发布到 registry。 | 保持 `private:true` 并在 README/发行说明中写清“npm 包经 Release 分发，不发布到公共 registry”；如未来发布，需独立授权与 `license`。 |
| R25-11 | P3 | `SECURITY.md:3-7`、`.github/ISSUE_TEMPLATE/config.yml:4`、`docs/plan/0.1.0/github-maintenance.md:22` | `[确认]` 私有仓库阶段 SECURITY.md 指向“公开后才可用”的 GitHub 私密报告入口，未给出当前可达渠道；issue 模板 contact 链接是 `blob/main/SECURITY.md`（可变）。文件已诚实声明“本文件不启用私密报告”，属可接受草案，但发行包用户会看到不可达入口。 | 在仓库保持私有时增加“通过仓库成员私密 issue/管理员”的可行说明；公开后由管理员启用并回填入口。 |
| R25-12 | P3 | `docs/plan/0.1.0/public-installation.md:38`、`:47`、`:49`、`:76` | `[待验证]` “69 文件 tarball 隔离安装”“253/254 Node 检查”“全新源码归档首次使用”等证据只存在于 `evaluation/runs/` 忽略目录与 Release 附件，PR 内不可复核；PR #27 之后才把 build-evidence/acceptance 放到 Release。 | 沿用 PR #27 的附件做法，同时在仓库提交小体积 `*.acceptance.json` 摘要（或至少 release-info/摘要列表），并让 `verify:release` 输出可直接附到 Release。 |

**跨 PR 关联**：依赖 PR #19（文档）且按顺序先合入；`[main 仍存在]` R25-01/03/04/06；`[PR #27 已补]` Release 附件证据（build-evidence/acceptance/SHA256SUMS）与 `release-documentation-binding` 关闭，但 CHANGELOG/LICENSE 仍未补；`[PR #24 OPEN]` 与本 PR 共同修改 `docs/plan/0.1.0/public-readiness.md` 且承载 F-B 许可审计，合并时需去重并保持证据版本；`[与 #17]` 组件 tag `v0.1.0-dev.0` 的解耦在 #25 被文档化但仍未由工具链绑定。

---

## 跨 PR 综合（本组）

**重复出现的问题与根因**
1. **发行元数据没有唯一机器可核对来源**：R17-07（同一 ZIP 两个源码提交）、R17-06/R25-03（tar 许可证写错）、R25-01（正式版本无 CHANGELOG）、R25-02（无 LICENSE）、R25-07（应用 tag 与组件 tag 分离未编码）。共同根因是“附件/tag/文档/许可/证据”由多人多轮手工维护，脚本只覆盖其中一段（PR #25 的 `verify-release` 已覆盖 tarball/ZIP，但未覆盖 CHANGELOG/LICENSE/组件 tag）。修复方向：把 release manifest 做成单一数据源（版本、源码提交、各附件摘要、组件 tag、许可证文件、检查结果），由脚本生成并行校验，文档只引用它。
2. **验收证据默认放在 gitignore 目录**：R17-17、R25-12。两 PR 的核心结论（Sandbox 通过、tarball 69 文件、253 测试）都无法在仓库内复核；PR #27 用 Release 附件部分解决，但源码/审计侧仍只看到叙述。修复方向：小体积 acceptance/build-evidence JSON 随提交或作为 PR 附件，并在文档中链接可下载证据。
3. **安装层的边界/生命周期比“读文件/下载”更薄弱**：R17-02（激活崩溃窗口）、R17-04（单 job 槽）、R17-05（跨进程目录锁）、R17-10（关停自旋）、R17-13（临时目录残留）。共同根因是 `Components` 把“进程内任务状态”当作唯一并发/恢复真相，没有持久化激活状态和目录所有权。修复方向：落盘 activation journal + 目录租约锁 + 启动恢复/清扫，作为安装层的正式状态机。
4. **应用版本与组件版本解耦但缺少工具约束**：#17 默认 `v0.1.0-dev.0` 组件 tag，#25 在文档中解释但不校验。修复方向见 R25-07。

**架构演进评价**
PR #17 把安装/发行作为独立可选能力引入：组合根选择挂载、`Components` 复用 DSH jobs/credentials/settings、`Pdf` 适配器与 sidecar 协议不变，方向上符合 Cordis“按独立生命周期划分能力”和 ADR-0002“组合根选择具体实现”；PR #18/#19/#25 没有把 MCP/PDF/模型逻辑塞进通用服务，也没有新增平行 AI 基础设施。走偏的风险只有一处且是局部的：通用 DSH 设置引导承担了 PDF 组件设置注册（R17-01/14），以及安装层把 job 槽/组件目录等共享资源当成进程内私有（R17-04/05）。整体演进是“越来越符合模块化”，未出现回退到 MVP 式平行实现或入口含业务的迹象。

**本组 Top 5 优先修复项**
1. **R17-07（P1）**：修正安装文档中 ZIP 源码提交矛盾，建立附件↔源码↔tag 的唯一来源表（并与 `public-readiness.md:61` 对齐）。
2. **R17-02 + R17-10**：安装激活崩溃窗口/关停自旋的持久化状态机与有界等待；补崩溃恢复测试。
3. **R17-04 + R17-05**：组件安装使用独立 job 配额与目录级锁，文档/协议同步说明与文档任务的互斥语义。
4. **R25-01 + R25-02 + R25-03/R17-06**：0.1.0 CHANGELOG、项目许可/保留权利声明、tar（及第三方）许可证更正，并纳入 `verify:release` 机器检查。
5. **R17-01 + R17-16/R25-06**：把 `componentsSettings` 注册移出通用设置引导；随包许可/来源文件与 `files`、`THIRD_PARTY.md` 引用保持一致。

**待验证项（需运行/外部环境）**：PR #17 的 Windows Sandbox/真实私有 Release 下载（R17-17）；PR #25 的实际 npm tarball 69 文件/253 项测试/隔离安装与同版本换目录（R25-12）；两者合并时 main 的三系统 CI 能否恢复（R25-08）；PR #24 合并后与 `public-readiness.md` 的内容去重。
