# 0.1.0 公开安装与维护准备实施记录

2026-10-17，执行[公开准备计划](public-readiness.md) F-D～F-G 及对应 P3～P6 的可执行部分。此记录不表示仓库已公开、发行资产已获再分发许可或新的 Windows 发行版已经交付。

本文按时间保留证据；最新授权范围见文末“0.1.0 正式版本准备”。此前等待公开授权、版本选择的描述仅代表当时状态。

## 基线与协作

- `origin/main` 仍为 `c8a146dd9b434773c9c149e4fe67ed0a6da3bb1f`。
- 本分支 `codex/0.1.0-public-installation` 接续 PR #19 的 `e61c90a5dad7fd62540c1f2d2aec4c3f87c16250`，因该分支已依赖 PR #18，保留其 MCP／文档成果；没有自动合并这两个 PR 到 main。将公开准备文档 `fca3c61` 复制为本分支的计划基线提交 `6acc2bc`。
- 实施前 fetch 并核对开放 PR：#18 MCP、#19 文档、#24 PDF 许可核验；未发现另一个匿名组件安装实现。按项目规则比较 main、文档分支、公开计划的已提交 follow-up 快照。
- F-A 仍待团队确定项目许可；F-B 的 PR #24 已核验实际附件，但仍有通知／对应源码缺口；F-C 按用户决定保留历史，公开意愿待团队确认。这些前置条件未由本次实现代为关闭。

## F-D：可选下载令牌

组件服务在无凭据时匿名读取 Release 和附件，不生成空 Bearer，也不读取维护者本机 `gh` 登录。显式保存的令牌继续由 DSH 管理，只发送到 GitHub API；附件跨域跳转不转发凭据。设置页面可在无令牌时查询并安装，查询失败清除旧的可安装目录，避免用户继续依据失效查询操作。

401、403、404、429 分别提供凭据、权限、源／版本不可访问及限流提示；网络错误不透传可能含签名下载 URL 或凭据的原始异常。摘要／大小、解压边界、失败回滚、取消、同版本修复及离线安装沿用现有机制。独立复核发现保存过的失效令牌会阻碍匿名恢复，已补齐 DSH `unset` 操作：HTTP `DELETE /api/components/credential`、CLI `components credential-clear`、MCP `component_credential_clear` 及 UI 显式按钮共用同一内核操作。环境提供的令牌不能伪装为已删除；清除不丢弃未提交的替换输入。受控测试覆盖失效令牌、清除、重启后的匿名安装。签名下载地址失效提示重新取得链接，不误导为 GitHub 令牌失效。

当前仓库仍私有。本轮浏览器实际无令牌查询得到 404，页面显示可恢复的源／版本／访问提示；这是真实匿名失败路径，不是本仓库匿名安装成功。成功下载、安装和授权重定向使用受控响应与原创小型组件夹具验证，不执行来源不明的远端二进制。

## F-E／F-F：用户指南和来源绑定

复用 PR #19 的双语 README、用户指南与源码／便携包分流。修正可选令牌、现有旧包能力、在线模型费用、原生英文到中文单语 PDF 及同版本替换范围。现有 `v0.1.0-dev.0` 附件尚未包含这些源码增强，不因文档更新自动获得新能力。

PDF 设置入口改用本机随包指南；构建记录版本、源码提交及工作树状态。开发中的修改构建或缺少 Git 元数据的源码归档不冒充可复现的正式发行。发行校验与模板要求新 tag、源码、实际附件和指南一致；旧 tag 及现有附件没有移动或替换。实现和验收状态统一在 [release-documentation-binding](../follow-ups/release-documentation-binding.md) 维护，仍须合入目标分支并完成下一次真实发行后关闭。

干净源码准备实际发现 npm 12.0.2 在默认 `allow-remote=none` 下拒绝锁文件中的镜像 tarball，报 `EALLOWREMOTE`。将锁文件 63 个 `registry.npmmirror.com` 地址统一为 npm 官方 registry，原有依赖版本和 integrity 不变；随后普通 `npm ci` 与构建成功。没有放宽全局安装策略。依据 [npm allow-remote 官方说明](https://docs.npmjs.com/cli/using-npm/config/#allow-remote)。

## F-G：维护入口和权限边界

补齐根目录贡献／安全指南、问题与 PR 模板；[GitHub 维护配置](github-maintenance.md) 保存精确检查名、拟议保护请求体、fork 审批和告警设置。用户于 2026-10-17 明确：**由仓库管理员团队负责漏洞和依赖告警，公开后使用 GitHub 私密漏洞报告**。管理员仍需安排实际通知接收、轮值及路由演练；不编造个人邮箱或响应时限。

当前访问身份只有 maintain，没有 admin；分支保护还受 Free 私有仓库功能限制。不能在当前权限下应用管理员设置。main 的三系统 CI 均在任何步骤开始前被账户付款／消费限制拦截，属于启动前限制，不是本次代码测试失败。没有增加预算、改变 token 权限、公开仓库或发送外部 Issue／评论。

## 验收证据

运行于 macOS arm64、Node 24.20.0、npm 12.0.2。日志与截图保存于忽略目录 `evaluation/runs/public-readiness-0.1.0/`，不提交测试数据或本机凭据。

| 检查 | 实际结果与边界 |
| --- | --- |
| npm 依赖和 DSH 准备 | 新 worktree 中安装成功，原有锁定版本／integrity 全部保持，仅新增文档构建用 Marked／heading-id／slugger；DSH 固定提交在禁用 Git 凭据助手、禁止交互登录时匿名 fetch 成功 |
| Node 全套 | 完整 252 项：251 通过、1 个 Windows 专属进程清理测试在 macOS 跳过；没有失败 |
| Python sidecar 单测 | 14/14；使用测试替身，不是原生 BabelDOC 发行验收 |
| 组件定向检查 | 收尾 45/45，含匿名／授权／限流／失败回滚／离线、UI、HTTP／CLI／MCP 及凭据清除恢复 |
| 浏览器 | 独立数据目录中匿名查询按钮可用；实际 GitHub 请求记录 `authorization:false`、HTTP 404，页面可重试；随包 PDF → 安装指南链接走通；证据 `browser-network.json`、`anonymous-settings.png` |
| 实际 npm tarball | 69 文件的暂存打包路径；隔离安装、CLI／HTTP／MCP、持久化重启和本地 PDF 指南访问通过。补充检查在服务退出后完整备份隔离数据目录，再于另一程序目录安装相同 tarball 并复用原数据；设置、记录、冻结快照及原 MD／JSON 下载字节均保持。仅为 macOS npm 包级同版本验证，不代替 Windows ZIP 验收 |
| 来源与发行校验 | 无 Git 元数据的临时源码树构建通过，元数据如实记 unavailable；指南 Markdown 结构与版本错配／实际 ZIP 校验的定向测试通过，ZIP 使用占位运行时夹具，不能视为原生软件运行 |
| 全新源码归档及首次使用 | 从 `690578c` 导出不含 `.git`、依赖及 vendor 的源码归档，使用空 npm 用户／全局配置和全新缓存，禁用 Git 凭据助手及全局配置，不继承凭据环境变量；`npm ci`、`npm run setup:dsh`、`npm run build` 均退出 0。以独立数据目录启动，HTTP 走通 TXT 导入／人工接受／MD+JSON 导出；浏览器从空首页选择原创 Markdown，接受两段人工译文并下载 MD／JSON，内容核对通过。未准备 PDF 开发环境或配置模型。日志、下载产物、截图见 `source-archive-check/`，临时服务和源码目录已清理 |
| Windows ZIP | 本机没有可用 Windows x64 验收环境；未把文档复制检查、npm tarball 或旧 Sandbox 记录当成本次 Windows 验收 |
| 真实模型／原生 PDF | 未调用付费模型；未重跑真实引擎排版，既有单测继续覆盖冻结快照与模型调用隔离 |

## 仍未满足的完成条件

1. F-D 目标仓库的匿名成功路径：需先获准公开或提供获授权的公开组件源，再运行真实无令牌安装；当前离线与受控安装证据不替代它。
2. F-E／F-F 实际 Windows 新版发行：需 Windows x64 构建与干净用户验收、确定新软件版本／源码／tag，并在 F-A／F-B 关闭后发布对应资产；旧附件不能静默追认。
3. F-G／P5 远端应用：需要管理员执行已经准备好的设置，确认 main 管理员例外策略、通知与私密渠道；当前维护身份不能代替管理员。
4. P6／P7：F-A 许可、F-B 分发材料及 F-C 历史公开意愿尚未关闭，最终待公开版本和资产未固定；公开切换仍需要具体结果可审阅后的明确授权。公开后的匿名成功、三系统线上 CI、费用与安全扫描均尚未执行。

以上保持未完成，不将“本地代码通过”写成公开准备全部完成。独立审查已复核匿名安装及发行校验的修正，未发现剩余阻断项；该审查为静态复核，运行结果以上表日志为准。

本轮推进的 follow-up ID 为 `release-documentation-binding`；没有新增或关闭其他事项。

2026-10-17 补充验收：按第 7 节矩阵复查后，补齐上述全新源码归档和同版本 npm 包换目录检查。GitHub 只读复查仍为 private、当前身份 maintain 而非 admin；本机没有 Windows x64 运行环境，Docker CLI 存在但本地 daemon 未运行，未将这些替代为三系统 CI 或 Windows 验收。用户已明确授权推送本分支并向 `codex/0.1.0-documentation` 创建草稿 PR；不包含合并、公开仓库、发布附件或改变费用／权限的授权。

## 0.1.0 正式版本准备（2026-10-17）

用户随后确定 `0.1.0` 为首个正式版本，授权将 PR #18、#19、#25 合入 main，并发布源码与 npm 安装包；Windows 验收、CI 暂不作为本轮门槛。用户最初授权公开，但当前 maintain 身份执行可见性变更被 GitHub 以 HTTP 404 拒绝，仓库没有发生公开切换；用户随后明确“目前不要公开”，因此后续发布保持在私有仓库内。真实匿名线上安装、公开后的私密漏洞报告入口及安全设置保留待办，不继续申请或执行公开。

软件版本、双语 README、能力表、用户指南及 MCP 握手版本统一为 `0.1.0`。旧 Windows／PDF 附件及组件来源 tag `v0.1.0-dev.0` 保留原身份，本次不提供新版 Windows 包、不发布到 npm 公共 registry。项目许可证仍待团队决定；仓库可见性和正式版本名称均不代替许可授权。

npm 打包新增 `.build-evidence.json`，记录版本、干净源码提交、实际 tarball 大小和 SHA-256。正式校验要求 tag 指向该提交，重新构建执行文件后逐文件核对包内容，并从 Markdown 重新生成指南；被 Git 忽略的旧 JS 或指南不能仅凭重新计算摘要获得新版本身份。定向夹具覆盖源码、执行文件、指南被替换，以及缺失／多余文件的拒绝；夹具不冒充真实运行环境。

补齐本次 DSH bundle 中三个缺失许可正文的通知：`@earendil-works/pi-ai@0.87.1`、`standardwebhooks@1.1.1` 使用固定上游提交中的 MIT 全文，`data-uri-to-buffer@4.0.1` 使用包内 README 的许可段落。构建遇到空通知立即失败。实际生成的 50 节通知均非空；此修正不追认旧 Windows／PDF 归档的 F-B 缺口。

本地完整 Node 检查 254 项：253 通过、1 个 Windows 专属测试跳过、0 失败；新增发行校验收尾测试 4/4 通过。`0.1.0` 实际 npm tarball 的 69 文件检查、隔离安装、CLI／HTTP／MCP、持久化、完整数据备份后同版本换目录安装、原冻结快照与导出字节核对均通过。正式 tag 下的打包及发布结果另记在该版本 Release；本段不预先宣称远端合并或发布成功。日志为 `release-node-tests.log`、`release-package-smoke.log`。

远端管理员设置不在当前权限内；原有 GitHub 配置草案保留，且本轮不设置尚未通过的三系统检查为强制门槛、不变更费用。PR #18、#19 的旧审阅意见已与当前实现只读核对，主要修复存在；#18 仍有两条作者解释后保留的 Minor 线程，旧 `CHANGES_REQUESTED` 状态未被伪造为批准。合并依据用户明确指示，并保留这些审阅历史。

## 正式发布结果（2026-10-17）

PR #18、#19、#25 已按顺序合入 main，最终发行提交为 `cb7e4a4c08aa6a0984ee920f38e2f10dc1bf80a4`。GitHub 为叠放 PR 自动更新了后续分支历史，已核对更新前后文件树完全相同，再接续本轮版本提交；没有强制覆盖远端分支。软件版本提交为 `4d3662472d6c80dd4d537696c6b26566b610ef2b`。

[v0.1.0](https://github.com/KongouAirlines/ivaraige/releases/tag/v0.1.0) 是非草稿、非预发行的正式 Release，仓库仍为 private。tag、源码包、npm 包和指南来源均固定到上述提交。发布前对干净 tag 重建并核对实际 tarball；以该文件进行隔离安装和同版本换目录验收，同时验证其与 smoke 生成的包字节完全一致。发布后下载全部附件并核对摘要，全部通过。

| 产物 | 字节数 | SHA-256 |
| --- | ---: | --- |
| `ivoraige-0.1.0.tgz` | 1236966 | `16ff3f919bc770698bbf2ac0fbd6607c05a7fd4e904f52d40e39fa717dd2ab9c` |
| `ivoraige-0.1.0-source.tar.gz` | 657398 | `24ce4c73ec1d8b7b05039461586188458f1c0c2aef1feb41d327557c9ee99c41` |

Release 同时保存 `SHA256SUMS`、`ivoraige-0.1.0.build-evidence.json` 和 `ivoraige-0.1.0.acceptance.json`。最终 npm 包内许可通知独立检查为 50 项、0 空项。完整 Node 检查仍为 253 通过／1 个 Windows 跳过，0 失败；实际最终包的 69 文件 smoke 通过。日志见 `release-verification.log`、`final-tarball-smoke.log` 和 `final-license-check.json`，数据只存于忽略目录。

本轮按用户缩减后的首轮发行范围完成，`release-documentation-binding` 已解决。尚待后续的范围是 Windows 新包与运行验收、三系统 CI、公开切换及其匿名安装／安全配置验证；F-A 许可与 F-B 旧附件问题仍属原工作包，没有由本次发布代为关闭。仓库管理员设置未应用，旧 `v0.1.0-dev.0` tag 和四个附件未修改。
