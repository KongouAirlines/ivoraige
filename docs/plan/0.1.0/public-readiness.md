# 0.1.0 公开准备评估与实施计划

**阶段记录与保留的验收条件。** 2026-10-19 后续核对：[仓库](https://github.com/KongouAirlines/ivoraige)已公开，源码准备变更已进入主线 [`43d3f1f`](https://github.com/KongouAirlines/ivoraige/commit/43d3f1fadc4930baa445aeb0cb832b3647aa08d7)。下文“仍为私有”“待合入”和“下一步”保留原记录时点，不是实时状态；公开可见不证明所有安全设置或发行验收均已完成。当前使用见[安装指南](installation-guide.md)，后续拆分与恢复分发的规划见 [0.1.x](../0.1.x/migration-distribution.md)。原 F-B 锚点及 PDF 未决验收继续保留。

首轮按**正式开源、源码使用**准备，安装包延后提供。现有文本、MCP、匿名组件下载和维护文档已经合入主线；已有代码和文档的开源授权已获所有者确认，许可范围已确定，接下来完成源码检查和 GitHub 设置复核。

## 2026-10-19 决定与进展

| 项目 | 状态 |
| --- | --- |
| 开源方向 | 已有贡献授权已确认。核心 LGPL-3.0-or-later；现有业务模块 MIT；BabelDOC Python 插件 AGPL-3.0-only，单独分发。 |
| Release 下载 | 已删除 `v0.1.0`、`v0.1.0-dev.0` 两个 Release 及全部 9 个附件；删除后 API 返回 0 个 Release。未执行 tag 删除；本地 tag 和提交历史保留，远端 tag 状态见下文。 |
| 安装包 | 延后提供。当前用户文档改为源码运行；原默认 PDF 组件源已无下载，Windows 用户可用开发准备路径，已有本机组件不受影响。 |
| 历史信息 | 按决定保留历史。当前样本目录和需求导入记录中的私人会话链接、个人下载路径已清理；未改写提交署名和旧提交。 |
| 主线与工作分支 | 起点为 `dde75f5`，已合入 main `60b5da6` 的更新；实施分支 `codex/0.1.0-open-source-preparation`。本节文档变更待合入 main。 |
| 仓库可见性 | 仍为私有。完成源码检查及设置复核后，再安排公开切换。 |

最新核对发现，PR #18、#19、#25 已合入 main；此前计划中的匿名下载、随包指南、贡献与安全说明已有实现。详情见[公开安装与维护准备记录](public-installation.md)，版本对应事项 [release-documentation-binding](../follow-ups/release-documentation-binding.md)按此前源码／npm 发行范围已解决。撤下下载不撤销这些代码和历史验收。

旧 PDF 附件的[实际归档审计](pdf-license-audit.md)、三份映射和清单工具已通过 [PR #31](https://github.com/KongouAirlines/ivaraige/pull/31) 合入 main `60b5da6`，原审计出处为 [PR #24](https://github.com/KongouAirlines/ivaraige/pull/24)。基础包通知、嵌入模块和原生组件对应源码等缺口继续保留；新 Node bundle 已补齐部分通知，不能追认旧附件。

复核时 `git ls-remote --tags` 和 GitHub tags API 均未返回远端 tag；本地 `v0.0.0`、`v0.1.0-dev.0`、`v0.1.0` 仍存在。删除前未单独读取远端 tag，原因尚未确认；本轮没有重建或移动远端 tag。

## 下一步

| 顺序 | 工作 | 完成标准 |
| --- | --- | --- |
| 1 | 合入已确定的许可、DCO 贡献说明和安全入口文档 | LICENSE 列出范围，完整条文随包携带；私密报告入口需在 GitHub 启用并实测。 |
| 2 | 核对源码与第三方边界，重点检查 PDF Python 适配层 | 第三方版权、许可证和上游来源保留；明确本项目原创代码的许可及 PDF 组合使用要求。 |
| 3 | 合入本轮源码使用文档和私人引用清理 | README 中英文、安装、PDF、设置和 MCP 指南均不再引导下载已删除附件。 |
| 4 | 对待公开提交做定向检查，准备 GitHub 设置 | 源码可按指南准备；检查新增提交、分支及公开材料，确定主线保护、外部工作流审批、依赖告警和私密报告入口。 |
| 5 | 所有者确认后切换公开并验证 | 匿名可读源码和文档，CI 实际启动，安全及贡献入口可用。 |

此前已验收的能力按[实施记录](public-installation.md)复用证据，新增变更检查受影响路径。安装包、真实在线 PDF 下载和三系统 PDF 打包暂不列为首轮源码公开的完成条件；以后恢复下载时单独核验实际包、对应源码、版本指南及干净环境安装。

### 许可与贡献

现有贡献的开源授权已确认。具体文件范围见 [LICENSE](../../../LICENSE)：

- 核心和未另行声明的自有文档采用 **LGPL-3.0-or-later**，完整条文为根目录 COPYING 和 COPYING.LESSER。
- 记录、翻译、冻结导出及格式适配模块采用 **MIT**，目前仍随主程序发布。将来独立业务插件逐个声明 GPL、MIT 等许可，不给现有文件增加任意换证选项。
- BabelDOC Python 插件采用 **AGPL-3.0-only**，从主程序 npm 包移出，独立 PDF 包携带插件源码、锁文件和许可。Node 适配器与进程客户端保持各自的 MIT／LGPL 许可。
- 新贡献按所改组件许可提交，并采用 DCO 1.1 的 Signed-off-by；不追补或改写旧提交署名。

DSH 的 MIT、MCP SDK 的 Apache-2.0 及 PDF 上游条款保持不变。[BabelDOC 0.6.4][babeldoc-license] 使用 AGPL，[PyMuPDF][pymupdf-license] 提供 AGPL／商业许可。PDF 二进制恢复分发前，仍需关闭实际归档审计中的通知和对应源码缺口；进程分离不代替这项核验。

<a id="f-b-pdf-发行物的许可闭环未获得实际归档验证"></a>

### PDF 发行物的后续验收

原 F-B／P2 已有实包审计证据，剩余整改留待恢复二进制分发前完成。旧 Release 和附件已撤下，当前不要求重新下载或打包；已有接收者所需的源码材料仍需处理。

- 三份历史映射、附件摘要和未决项保留在[审计报告](pdf-license-audit.md)，不因撤下附件或合并审计 PR 而标为已解决。
- 只有已保存原附件和 API 元数据时才能[离线复核](pdf-license-audit.md#7-可重复的归档核验)；缺少这些输入时可运行独立夹具，但不能据此宣称复验了旧包。
- 恢复分发时按[实际包验收要求](pdf-license-audit.md#6-恢复二进制分发前的验收)核对通知、依赖来源、对应源码和最终归档。PDF 拆分还需将全部直接及传递的 AGPL 内容移出主体依赖与发行范围。

### 公开前后验证

- **源码安装：** 干净目录中按文档完成 `npm ci`、固定 DSH 准备、构建和启动；TXT／Markdown 不依赖 Python。首次取得本仓库的匿名访问在公开后验证。
- **首次使用：** 文本导入、人工接受、MD／JSON 导出和重启读回；冻结导出不调用模型。PDF 开发路径保持现有 Windows 范围。
- **公开内容：** 包括开发分支、tag、旧版本、PR 引用和讨论、Actions 日志；Release 删除后不再有附件下载。若发现真实凭据，先撤销或轮换，再处理历史。
- **GitHub：** 检查 main 保护、只读工作流 token、外部 PR 审批、依赖告警、秘密扫描和私密漏洞报告入口。管理员团队负责接收报告，见 [SECURITY.md](../../../SECURITY.md)。
- **CI 与费用：** 真正启动三个系统的标准 runner，检查运行和账单结果。源码公开不等于所有账户限制都会解除。

## 关键证据与尚未完成的检查

原调查日期为 2026-10-16，主线／PR／Release 元数据于 10 月 17 日复核。本节保留原调查范围，10 月 19 日没有重新扫描全部历史和日志。完整原报告见[调查文档提交](https://github.com/KongouAirlines/ivaraige/blob/fca3c611e1f9ace64bb71a01db6acf18b1ad9cb2/docs/plan/0.1.0/public-readiness.md)；后续变化以本页日期记录及实施记录为准。

### 2026-10-16 调查范围

| 范围 | 方法与结果 |
| --- | --- |
| Git 历史 | 检查 14 个远端分支、2 个 tag；本地可达 112 个提交、892 个独特文件内容，约 8.68 MB；主线增量通过 API 补查。扫描常见令牌、私钥和敏感路径并复核候选，未发现可信的凭据泄露或被追踪的评估原件、运行输出。 |
| PR 引用 | 检查 15 个 PR 分支引用和 2 个测试合并引用，补查其中额外的 4 个提交、1 个新增文本内容；未发现所查敏感模式。 |
| Issue／PR 讨论 | 检查 7 个 Issue、15 个 PR、33 条普通评论、136 条行内评论、77 条 Review（24 条有正文）、0 条提交评论，共 268 条正文记录；未发现实际凭据、上传附件或私人分享入口。 |
| Actions 日志 | 检查 115 次运行、653 个日志文件，约 1,363 万字符；模式扫描并复核候选和失败上下文，未发现可信的凭据泄露。部分疑似值可定位到测试夹具。 |
| 图片和样本 | 唯一追踪的二进制图片为 PR #19 工作台截图，目视未见账号、密钥或出版物页面；历史路径未发现 PDF、EPUB、数据库或评估原件。 |
| 依赖 | 10 月 16 日 npm audit 为 0 条已知告警；固定 DSH 提交匿名读取成功，锁文件使用 npm 官方源和 npmmirror，未发现私有 registry 依赖。 |
| GitHub 与 Release | 读取仓库、组织、权限、安全、预算和运行接口；凭据只查元数据。检查 1 个预发行 Release、4 个附件的元数据及源码声明。 |

调查还读取了 `0a185d4` 的三系统成功 CI，包含 Python 单测、npm ci、DSH 准备、npm test 和 package smoke。[安装记录](installation.md)已有 Windows Sandbox 的离线文本／PDF 使用、冻结重放和同版本替换验收；这些是已有验收记录，调查时未重跑。

### 主要结论与限制

- 原调查发现提交邮箱和私人来源引用，未确认凭据泄露。当前引用已清理，旧提交和邮箱按决定保留。已删除内容、编辑历史、悬空对象和旧 Wiki 未完整枚举；两个 PR 测试合并引用的完整新增内容未确认，父提交和补丁已检查。
- 10 月 16 日实际发行包尚未读完；之后 PR #24 已完成读取并记录具体缺口，PR #31 已将报告和工具合入 main。本次删除 Release 后，包内整改转为恢复分发前的工作，历史接收者已有的许可义务仍需履行。
- 源码和 npm 安装的后续实测见[实施记录](public-installation.md)。跨版本迁移、三系统原生 PDF 发行和完整 Python 漏洞审计仍未完成。
- 部分组织配置及全组织 Secrets／Variables 接口无权读取；仓库可访问的凭据列表已单独检查。贡献授权已于 10 月 19 日确认，组织权限仍需复核。

### GitHub 与 CI 原快照

10 月 16 日仓库属于 Free 组织，4 位协作者（2 admin、2 maintain）；存在一个有写权限的 Codex connector。未启用分支保护、Dependabot 告警和秘密扫描；工作流 token 只读，使用 push／pull_request 和三个系统的标准托管 runner。仓库及其可访问的组织 Secrets／Variables、Environments、自托管 runner、webhook、deploy key、Actions 产物和缓存均为 0；Wiki、Discussions、Pages 关闭。这些设置需要在切换时复核。

[主线运行 38744374368](https://github.com/KongouAirlines/ivaraige/actions/runs/38744374368)在执行步骤前因账户计费限制被拦截；旧历史也有[代码断言失败](https://github.com/KongouAirlines/ivaraige/actions/runs/37723889921)，两者应分开处理。10 月 17 日的[发布记录](public-installation.md)保留了后续本地验收和未执行 CI 的范围。

按 10 月 16 日查阅的 [GitHub 计费规则][actions-billing]，公开仓库的标准托管 runner 分钟免费，larger runner 仍收费；Free 私有额度为每月 2,000 分钟和 500 MB 产物存储，缓存另按每仓库 10 GB 计算。当前配置不需要为了公开削减三系统测试。实际切换前复核规则，切换后验证账户是否允许任务启动。

设置入口：[仓库](https://github.com/KongouAirlines/ivaraige/settings)、[Actions](https://github.com/KongouAirlines/ivaraige/settings/actions)、[安全](https://github.com/KongouAirlines/ivaraige/settings/security_analysis)。规则：[可见性][visibility]、[许可证][licensing]、[分支保护][branch-protection]、[外部工作流审批][fork-approval]、[秘密扫描][secret-scanning]。

## 版本记录

- 原调查源码 `0a185d4`，增量核对至 `c8a146d`；当前准备基于 `dde75f5`。
- 已撤下的 `v0.1.0` Release 对应源码 `cb7e4a4`，包含源码归档、npm 包及校验文件，共 5 个附件。
- 已撤下的 `v0.1.0-dev.0` Release 共 4 个附件。tag 对应 `a6dcc2b`，更新后附件声明源码为 `bdd1854`；该历史差异保留在[安装记录](installation.md)和原调查文档。
- 归档 MVP 保留 `codex/archive-mvp-0.0.0`／`v0.0.0`（`27eec14`）。后续问题状态继续在既有 follow-up 中维护。

[visibility]: https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/setting-repository-visibility
[artifacts]: https://docs.github.com/en/actions/how-tos/manage-workflow-runs/download-workflow-artifacts
[licensing]: https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/licensing-a-repository
[actions-billing]: https://docs.github.com/en/billing/concepts/product-billing/github-actions
[releases]: https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases
[branch-protection]: https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches
[fork-approval]: https://docs.github.com/en/actions/how-tos/manage-workflow-runs/approve-runs-from-forks
[secret-scanning]: https://docs.github.com/en/code-security/reference/secret-security/secret-scanning-scope
[babeldoc-license]: https://pypi.org/project/BabelDOC/0.6.4/
[pymupdf-license]: https://pymupdf.io/licensing
[agpl]: https://www.gnu.org/licenses/agpl-3.0.de.html
