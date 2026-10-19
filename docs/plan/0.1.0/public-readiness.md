# 0.1.0 公开准备评估与实施计划

仓库可以按早期预览推进公开。公开前主要需要确定项目授权、确认历史个人信息的公开范围，并核验拟保留的发行附件。面向普通用户提供下载前，还应解决匿名组件安装和版本说明不一致的问题。现有架构可以保留，无需为公开重写内核或补完全部功能。

本文依据 2026-10-16 的调查及 10 月 17 日的主线、PR、Release 元数据复核。2026-10-19 仅精简文字，未重新调查。以下设置、PR 状态和检查结果均对应上述日期。

## 1. 先决定什么

| 需要所有者决定 | 建议及取舍 |
| --- | --- |
| 公开供查看，还是正式开源 | 建议确认已有贡献的授权后选择开源许可证，便于复用和贡献。也可以保留权利、仅公开供查看，但应说明使用限制。缺少 LICENSE 不妨碍 GitHub 切换可见性，也不代表他人可以自由使用代码。 |
| 首轮是否保留 PDF 发行附件 | 核验许可和源码材料后保留；来不及完成则暂缓这些附件的公众分发。附件会随仓库公开，不能只在说明中写“暂不支持”。 |
| 是否接受历史署名及私人引用公开 | 建议相关人确认提交邮箱可以公开，清理当前文档中无用的私人链接。只有确有保密要求时再处理历史及 PR 引用。 |
| 谁负责维护 | 指定问题、安全报告、依赖告警和发版的负责人，提供可用入口；按小团队规模安排即可。 |

公开供查看、授予开源许可和提供安装包是不同决定。先确定范围，再完成对应工作；切换可见性由所有者另行授权。公开后的下载和 fork 副本无法通过改回私有收回。

## 2. 关键发现与处理建议

### 公开前确认：项目授权

根目录及已查历史没有项目自身的 LICENSE，GitHub 返回 `license:null`。[第三方声明](../../../THIRD_PARTY.md)不能代替本项目许可；[package.json](../../../package.json) 的 `private:true` 只控制 npm 发布。历史存在多位作者，尚未核验其贡献授权。

**处理：** 所有者确认已有贡献的授权来源，决定代码和文档的许可，补充相应文本与发行说明。没有 CLA 不等于贡献无效，不必为此搭建复杂流程。正式开源前应完成；仅公开查看时也应把使用限制说清楚。见 [GitHub 许可说明][licensing]。

### 保留二进制附件的前提：核验实际发行包

[BabelDOC 0.6.4][babeldoc-license] 使用 AGPL-3.0，[PyMuPDF][pymupdf-license] 提供 AGPL／商业许可。[构建脚本](../../../scripts/build-pdf-component.py)已收集依赖许可，[资源许可表](../../../sidecars/babeldoc/asset-licenses/ASSET-LICENSE-STATUS.md)覆盖 34 个字体、146 个 CMap、1 个 ONNX 模型和 1 个 tiktoken 数据文件。但调查时大附件下载未完成，尚未检查实际包中的文件、通知和源码材料。

**处理：** 分别检查基础 ZIP、PDF 组件和资源包，列清运行时、Python 库、DLL、字体、模型及其许可，补齐必要通知和对应源码获取方式。构建脚本在缺少独立许可文件时可能只收集包的元数据，需要检查最终包是否足够。完成后应能从发行入口取得所需材料；未完成的附件暂缓公众分发。

上游决定许可证，本项目负责实际分发内容。独立 Python 进程不能自动免除许可义务，也不能据此认定整个 Node 应用必须使用 AGPL；适用范围有疑问时再针对性核实。暂停附件也不免除此前分发已有的义务。见 [AGPL 条文][agpl]。

### 公开前确认：历史个人信息

已查历史中有四种个人邮箱；112 个提交中，104 个的作者或提交者信息包含其中至少一种。[样本目录](../mvp/m0/sample-catalog.md)和[导入记录](../../requirements/v1.0/IMPORT.md)还包含私人聊天入口，另有个人下载路径记录。这些是公开意愿确认事项，尚无证据表明它们泄露了凭据或聊天正文。

**处理：** 向相关人提供定位并确认是否接受公开；当前文档改用公开来源。若要求彻底移除，再制定覆盖历史提交及 PR 引用的方案。仅在存在保密要求时阻碍原样公开，不默认改写整个仓库历史。若发现真实凭据，应先撤销或轮换，再清理记录。

### 公众在线安装前修复：强制要求 GitHub token

[组件下载器](../../../src/component-package.mjs)的 `fetchRelease` 在请求前拒绝无 token 调用，`requestHeaders` 始终生成 Authorization。调查时匿名 Release 返回 404 是私有仓库的正常表现；公开后，代码中的 token 要求仍会存在。

**处理：** 让 token 可选，无 token 时省略 Authorization；继续使用 DSH 管理凭据。保留授权下载、跨域重定向保护、摘要校验、取消、重试及离线安装。验收要覆盖匿名和授权两条路径，并在公开后验证目标仓库的真实匿名下载。此问题不妨碍源码公开，但会阻碍无 token 在线安装 PDF。

### 推荐使用前修正：文档与发行版本不一致

主线 [README](../../../README.md)仍有“未发布”和安装分支进行中的表述；[设置指南](settings-guide.md)称 PDF 页面不执行安装，与已实现功能不符。[打包脚本](../../../scripts/build-distribution.mjs)只复制四份指南，其中部分链接指向包内没有的开发文件。

此外，预发行 tag 指向 `a6dcc2b`，Release 正文已明确附件对应 `bdd1854`，而自动生成的 Source code 下载仍对应 tag。设置页指南又指向随开发变化的 main。问题是版本对应不一致，并非没有源码来源。

**处理：** 结合 [PR #19](https://github.com/KongouAirlines/ivaraige/pull/19)完成文档整理，分开说明源码运行、便携包和 PDF 开发环境。下一次发行统一 tag、附件源码及固定版本指南，保留旧版更新记录。从仓库首页和解压包分别验证首次使用；准确说明预览状态、平台范围、模型联网与费用、备份和更新限制。

版本对应继续由 [release-documentation-binding](../follow-ups/release-documentation-binding.md)跟踪，本文不另建状态。10 月 17 日 PR #19（`30e38b72`）及 MCP 的 [PR #18](https://github.com/KongouAirlines/ivaraige/pull/18)（`334ec265`）均未合并；实施前核对其进度。MCP 不是公开的前提。

### 建议同步补齐：贡献与安全报告入口

未找到 CONTRIBUTING、SECURITY 或明确的私密漏洞报告入口。建议用简短说明列出复现所需的版本、平台、步骤和样本要求，提醒贡献者使用原创或获授权材料，并指定安全报告的接收人。Issue／PR 模板和自动化可以后续补充。

GitHub 设置建议包括主线保护、外部 PR 工作流审批和依赖告警，具体状态见下一节。

## 3. GitHub 设置与 CI 费用

### 设置快照

| 检查项 | 2026-10-16 观察结果 | 建议 |
| --- | --- | --- |
| 可见性与组织 | 私有，GitHub Free；成员可改变可见性，组织未强制 2FA | 所有者确认公开范围及组织安全要求。未强制 2FA 不代表成员没有启用。 |
| 成员与集成 | 4 位协作者：2 admin、2 maintain；无列出的团队、外部协作者或待接受邀请。1 个 Codex connector 覆盖全部仓库，有内容、工作流、Actions、Issue／PR 写权限；webhook、deploy key 为 0 | 复核仍需保留的人员和 App 权限。这些授权不会因公开而赋予公众写权限。 |
| 分支规则 | 列出分支均未保护；main protection／rulesets 接口提示需升级或公开 | 公开后配置 main 防强推、删除和必要检查，明确管理员例外。 |
| Actions | 一个 push／pull_request 工作流，三个系统的标准托管 runner；无自托管 runner、部署步骤或真实模型密钥引用 | 保留现有测试，设置外部贡献工作流审批。公开仓库审批策略在私有状态下未能读取。 |
| 工作流权限 | 默认 token 只读、不能批准 PR；工作流显式 `contents:read`。允许全部 Actions，未要求完整提交 SHA | 保留只读权限；固定完整 SHA、减少重复运行可后续优化。 |
| 凭据与环境 | 仓库 Secrets、Variables、Environments，以及仓库可访问的组织 Secrets／Variables 均为 0 | 按需要增加，检查只涉及元数据。全组织列表部分接口无权读取。 |
| 安全功能 | Dependabot alerts、自动安全修复和 secret scanning 关闭；code scanning 接口提示需启用相应功能；私密报告接口返回 404 | 启用适用的依赖告警和秘密扫描，确认私密漏洞入口可用。关闭状态不能解释为零告警。 |
| 其他内容 | Wiki、Discussions、Pages 关闭；forks、Actions artifacts、cache 均为 0 | 切换前检查是否有新增内容。 |

依据：[仓库设置](https://github.com/KongouAirlines/ivaraige/settings)、[Actions 设置](https://github.com/KongouAirlines/ivaraige/settings/actions)、[安全设置](https://github.com/KongouAirlines/ivaraige/settings/security_analysis)及对应只读 API；工作流见 [kernel-smoke.yml](../../../.github/workflows/kernel-smoke.yml)。规则见[分支保护][branch-protection]、[外部工作流审批][fork-approval]和[秘密扫描范围][secret-scanning]。

### CI 红灯与公开后的费用

调查时的[主线运行 38744374368](https://github.com/KongouAirlines/ivaraige/actions/runs/38744374368)、[MCP 运行 38885723437](https://github.com/KongouAirlines/ivaraige/actions/runs/38885723437)及[文档运行 38884962189](https://github.com/KongouAirlines/ivaraige/actions/runs/38884962189)均在执行步骤前被拦截，注释指向付款或消费限制。组织 Actions 预算为 0 美元且达到后停止使用，10 月账单摘要净额为 0；这些信息不足以确定具体付款问题或哪项额度耗尽。

旧运行确有[代码断言失败](https://github.com/KongouAirlines/ivaraige/actions/runs/37723889921)，之后 [`0a185d4` 的三系统 CI](https://github.com/KongouAirlines/ivaraige/actions/runs/38398075700)通过。因此，应分别处理账户限制、测试失败和基础设施故障。

按 2026-10-16 查阅的 [GitHub 官方规则][actions-billing]：

- 公开仓库使用当前三种标准托管 runner 的分钟免费；larger runner 仍收费。公开后需实际验证能否启动，账户限制未必全部消失。
- Free 组织私有额度为每月 2,000 分钟、500 MB Actions 产物存储；cache 单独按每仓库 10 GB 计算。日志不计入产物存储，既有存储用量也不会因公开而抹去。当前工作流没有上传产物，仓库产物和缓存均为 0。
- Release 附件与 Actions 产物分开计算。现有附件均低于单文件 2 GiB 限制；[Release 规则][releases]未列总大小或带宽总量上限。

无需为了公开删掉三系统测试。新增收费 runner 或存储时再评估费用；用户调用翻译模型的费用仍由模型服务决定。

## 4. 实施顺序与验收

| 顺序 | 工作与产出 | 完成标准 |
| --- | --- | --- |
| 1. 确定范围和授权 | 所有者确认第 1 节的选择；核实贡献授权，补充代码、文档许可及发行说明 | 接收者能知道可以如何使用；拟公开内容没有未处理的授权或保密异议。 |
| 2. 处理历史信息 | 根据确认结果清理当前私人引用；确需历史移除时另行制定方案，包含 PR 引用及协作者同步方式 | 实际处理范围满足相关人的要求；默认保留可公开历史。 |
| 3. 核验发行包 | 下载确切附件，按附录摘要确认对象；检查文件、许可、通知、对应源码和必要构建材料，补齐受影响的包 | 形成文件与许可对照表，所需材料可从发行入口取得；未通过的附件不进入公众分发。 |
| 4. 修改组件安装 | token 改为可选，沿现有组件服务和 DSH 凭据处理；补充针对性测试及提示 | 匿名、授权、离线安装可用；限流、取消、坏包等失败不破坏已装版本和用户数据。 |
| 5. 整理发行文档 | 对照 PR #19，统一下一版 tag、附件源码、随包及在线指南；更新既有跟踪事项 | 仓库首页和实际解压包的首次使用路径均可走通；旧版指南不随 main 改变。 |
| 6. 准备维护配置 | 确定贡献和私密报告入口，复核人员与 App；准备主线保护、外部工作流审批、依赖告警 | 外部用户能找到入口，维护者能接收；配置符合团队规模和实际 CI 检查名。 |
| 7. 验收待公开版本 | 固定源码提交和附件，执行下表；记录日期、系统、版本、结果和未测范围 | 承诺提供的使用路径通过；未完成范围已明确暂缓。 |
| 8. 切换并复查 | 所有者授权后公开，验证匿名访问、安装、权限、CI、费用及扫描结果 | 留下实际设置和运行链接，处理新增问题。 |

步骤 1 决定后续范围；步骤 2、3、6 可并行。安装和文档以已确定的发行范围为准，最终验收在切换前完成。目标仓库的真实匿名访问及仅公开后可用的设置在切换后验证。

### 验收表

| 场景 | 要检查的结果 |
| --- | --- |
| 源码安装 | 从干净目录按文档完成准备和启动；固定 DSH 提交及依赖可读取。列清 Git、Node >=24，以及 PDF 开发所需 uv／Python／缓存；文本使用不要求 PDF 环境。 |
| Windows 基础包 | 无源码、无预装 Node／Python、无 GitHub token，完成启动、TXT／MD 导入、人工接受、导出和重启。 |
| PDF 在线安装 | 无 token 请求不带 Authorization；有 token 仍可读取授权源；跨域重定向不转发凭据。公开后在目标 Release 验证匿名下载。 |
| 安装失败与恢复 | 覆盖限流、404、网络中断、取消、磁盘失败、坏摘要和解压路径越界；错误明确，可重试，校验完成前不激活。 |
| PDF 离线与重启 | 配套清单和归档可安装；移除下载 token 后重启仍可使用已装组件，不隐式访问远端。 |
| 架构约束 | PDF 仍通过 Python sidecar，凭据仍由 DSH 管理；同一冻结快照导出和重放不调用模型。 |
| 发行许可与文档 | 检查实际归档中的许可、通知、源码获取方式和指南链接；包内命令可用且对应发行版本。 |
| 更新 | 退出并备份后，同版本替换能读回记录、设置和快照。跨版本迁移另行验证和说明。 |
| 公开后 GitHub | 匿名可读预定分支、历史、Release 和文档；主线保护、只读 token、外部工作流审批生效；维护者能接收私密报告。 |
| 公开后 CI 与安全 | 三系统标准 runner 真正启动并通过测试；检查账单、依赖告警和历史秘密扫描结果。 |

若存在未撤销的真实凭据、未确认的保密要求或拟分发附件的许可缺口，应暂停相应公开步骤。源码或附件发生实质变化时，只补查受影响部分。

## 5. 已有基础与后续工作

以下设计和措施可以保留：

- **DSH 与依赖固定。** [setup-dsh](../../../scripts/setup-dsh.mjs)使用公开的固定提交，调查中匿名读取成功。模型、凭据、设置、存储和任务继续复用 DSH。
- **本机使用。** [HTTP 服务](../../../src/http.mjs)限制回环监听并检查 Host／Origin，[入口测试](../../../test/entries.test.mjs)已有相关覆盖；无需为本机预览增加多租户认证。[启动器](../../../src/launch.mjs)已有独立数据目录和运行实例复用。
- **翻译与导出分离。** 继续使用冻结快照；安装调整不涉及翻译业务或上游 PDF 算法。
- **已有许可材料。** DSH、Web、Node、Python 及 PDF 资源已有声明和收集机制，下一步是核验实际包并补缺。

OCR、双语 PDF、EPUB、词库、跨引擎映射、三系统 PDF 发行和自动更新框架可按原路线图推进。公开预览只需准确说明能力与限制；没有证据要求删除整套 MVP 历史或替换依赖。

## 6. 调查范围与未完成检查

公开会涉及默认分支、其他远端分支、tag、历史版本、Issue／PR 及评论、保留的 PR 引用、非草稿 Release 和附件、Actions 历史及日志。删除最新文件或关闭 PR 不会自动移除历史。GitHub 设置中的秘密值不会自动公开，但提交和日志中出现的值会暴露。公开后任何人可以 fork；Actions 产物下载仍要求登录并有读取权限。见[可见性规则][visibility]、[产物下载规则][artifacts]。

### 已完成的检查

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

### 主要缺口

- **实际发行归档：** 大文件下载未完成，本地也未找到对应资产；文件清单、许可、源码材料及包内敏感内容尚未独立核验。这是保留附件公开前最重要的缺口。
- **干净环境安装：** 未重做源码安装、Sandbox、真实模型或完整 BabelDOC 运行；成功 CI 不代表三系统原生 PDF 包已验收。Python 冻结包也未完成漏洞检查。
- **权限与账单：** 部分组织 Actions 策略及全组织 Secrets／Variables 接口返回 403；未取得具体付款问题。仓库可访问的组织凭据列表已单独检查。
- **历史残留：** 已删除内容、编辑历史、悬空 Git 对象及旧 Wiki 未能完整枚举；两个 PR 测试合并引用的完整新增内容因 API 间歇 404 未确认，父提交和补丁已检查。
- **权属与个人意愿：** 尚未核验贡献者合同、商业许可、私人链接访问控制或相关人的公开意愿。

扫描未命中只能支持上述范围内的判断。后续重点补齐发行物、安装与所有者确认，不必重复全部调查。

## 附录：版本与发行附件

| 对象 | 调查时对应版本 |
| --- | --- |
| 仓库 | [KongouAirlines/ivaraige](https://github.com/KongouAirlines/ivaraige)，项目名 ivoraige |
| 主线及本文分支起点 | [`c8a146d`](https://github.com/KongouAirlines/ivaraige/tree/c8a146dd9b434773c9c149e4fe67ed0a6da3bb1f)；本地 main 从 `4702943` 快进至此 |
| 初始代码检查 | `0a185d4`；与上述主线仅差滚动条样式，已核对差异 |
| 软件版本 | `0.1.0-dev.0`，早期预发行；v2.0 是设计文档版本 |
| 预发行 tag | `v0.1.0-dev.0` → `a6dcc2beb13e908ef659420b8deb87ac7458b014` |
| 附件声明源码 | [`bdd1854`](https://github.com/KongouAirlines/ivaraige/tree/bdd18546647732718ed4b63a5847f601eb651ea9) |
| 归档 MVP | `codex/archive-mvp-0.0.0`／`v0.0.0` → `27eec14` |
| 文档分支 | `codex/0.1.0-public-readiness`，目标 main |

[Release](https://github.com/KongouAirlines/ivaraige/releases/tag/v0.1.0-dev.0)发布于 2026-10-11，附件于 10 月 12 日更新，正文及安装记录注明对应 `bdd1854`；后续 10 月 13 日源码变更未替换附件。10 月 17 日复核时，仓库仍为私有，默认分支 main，两个开放 PR 及下列附件元数据未变。

| 附件 | 字节数 | API 提供的 SHA-256 |
| --- | ---: | --- |
| `ivoraige-0.1.0-dev.0-win32-x64.zip` | 65,654,609 | `f7b37175ec4d4c3c13d2c3fffc52596880ef4f67820ad08d674277de73c991f2` |
| `babeldoc-0.6.4-win32-x64.tar.gz` | 201,314,930 | `d0174cabaffdd5c45ece2e907131752dfed346fa4a85a4c2b9eae2237359b30f` |
| `babeldoc-assets-0.6.4-win32-x64.tar.gz` | 235,512,779 | `4b9dc761f2e97703ab226059cd96ef0b28b7029505388be7ddbefec6c8157020` |
| `components-manifest.json` | 595 | `7aa6d1e9f260d9d2756a40b7e3d3db7550cf05d873299a8dc2a9038557502d92` |

复查源码时固定到 `c8a146d`，发行构建使用 `bdd1854`。官方规则查阅于 2026-10-16；实际发布前重核适用规则。后续更新本文应注明新观察的日期和变化，问题状态仍在既有 follow-up 中维护。

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
