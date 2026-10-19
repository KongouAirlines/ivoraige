# 0.1.0 全量 PR 审查报告归档

**历史归档入口。** 下方关联表和“待合入”按原归档时点阅读；到主线 [`43d3f1f`](https://github.com/KongouAirlines/ivoraige/commit/43d3f1fadc4930baa445aeb0cb832b3647aa08d7)，PR #31／#32／#33 的审计、源码准备和审查归档已合入。基于该基线的 [136 项去重映射](../../0.1.x/audit/README.md)与 [0.1.x 工作包](../../0.1.x/work-packages.md)承接后续复核；合入报告不等于报告中的缺口已修复。五份报告正文、原 ID 和固定源码定位保留。

保存此前 DeepSeek 对 18 个 PR 的完整审查报告，原对照主线为 [dde75f5](https://github.com/KongouAirlines/ivaraige/tree/dde75f5f2456ed581d3f645e6c68dd6e3a1c92a2)。归档日期：2026-10-19。PDF、MCP 报告标注审查日期为 2026-10-17；其余报告未单列日期，原文件未记录模型版本。

| 报告 | 审查 PR | 原发现表条目数 |
| --- | --- | ---: |
| [内核与设计](report-kernel.md) | [#1](report-kernel.md#pr-1)、[#2](report-kernel.md#pr-2)、[#3](report-kernel.md#pr-3)、[#4](report-kernel.md#pr-4) | 32 |
| [特性与设置](report-features.md) | [#5](report-features.md#pr-5)、[#6](report-features.md#pr-6)、[#8](report-features.md#pr-8)、[#9](report-features.md#pr-9)、[#20](report-features.md#pr-20) | 28 |
| [PDF 管线与许可审计](report-pdf.md) | [#7](report-pdf.md#pr-7)、[#10](report-pdf.md#pr-10)、[#12](report-pdf.md#pr-12)、[#24](report-pdf.md#pr-24) | 32 |
| [MCP 与文档](report-mcp.md) | [#18](report-mcp.md#pr-18)、[#19](report-mcp.md#pr-19)、[#27](report-mcp.md#pr-27) | 15 |
| [安装与发行](report-release.md) | [#17](report-release.md#pr-17)、[#25](report-release.md#pr-25) | 29 |

五份报告共保留 136 条发现表记录，包含跨 PR 重复项、已修复项和建议，不等于 136 个尚未修复的缺陷。

<a id="reading"></a>

## 阅读说明

- 原审查关注插件边界、v2.0 设计与协议、正确性与生命周期、文档及验收证据。原有 A–D 评分、P0–P3 等级和“确认／推断／待验证”标签均保留；这些是当时的审查判断，实施前需要按当前代码复核。
- 各节的源码行号对应下表中的 PR head；“main 已修／仍存在”仅指 dde75f5。报告里的命令、测试计数和失败记录来自原审查，本次归档没有重跑这些测试。
- 保留全部发现、理由、建议、跨 PR 分析和未验证项。仅替换两处本机绝对路径、临时工作区名称和审查分工用语，补充导航与稳定章节锚点；没有改写评分或静默删除争议结论。
- 原审查提纲和临时 diff、依赖目录未一并归档。下表提供固定源码入口；报告引用的忽略目录日志和旧附件不因此变成已公开证据。

## 后续变化与关联事项（2026-10-19）

| 范围 | 报告中的定位 | 讨论／交付入口 |
| --- | --- | --- |
| 导出隔离、服务与入口契约 | kernel 的 PR1-01、PR4-02/03/04；MCP 的 M18-1/6；features 的 F9-2 | [Issue #29](https://github.com/KongouAirlines/ivaraige/issues/29)；文档修订 [PR #30](https://github.com/KongouAirlines/ivaraige/pull/30) 仍为开放草稿 |
| 格式注册与 PDF 扩展 | PDF 的 P7-2、P7-3、P12-2 及跨 PR 综合 | [Issue #14](https://github.com/KongouAirlines/ivaraige/issues/14)；继续区分接口扩展与第二引擎真实质量验证 |
| 模型配置和错误语义 | features 的 F6-3、F9-4；原报告已将部分 F6 问题标为由 #9 修复 | [Issue #23](https://github.com/KongouAirlines/ivaraige/issues/23)；两条编号描述同一类错误映射问题，不重复建单 |
| 发行一致性与许可 | release 的 R17-06/07、R25-01 至 R25-06；MCP 的 M27；PDF 的 P24 | [Issue #28](https://github.com/KongouAirlines/ivaraige/issues/28)、[PR #31](https://github.com/KongouAirlines/ivaraige/pull/31)、[PR #32](https://github.com/KongouAirlines/ivaraige/pull/32) |

旧 Release 和附件已于 2026-10-19 撤下。报告中“当前可下载”“发布前处理旧附件”等表述保留为历史记录；恢复二进制分发前仍需核验实际包的许可、对应源码和来源一致性。

PR #31 正在承接 #24 的实际归档审计，尚未合入 main。原报告 P24 对 base 分叉的观察不能解释为准备文档从未进入 main；[后续核对](https://github.com/KongouAirlines/ivaraige/pull/24#issuecomment-6236802958)已说明其内容曾通过 3936a0c 进入主线。审计证据入主线也不等于归档许可缺口已修复。

PR #32 的分支已加入核心 LGPL-3.0-or-later、现有业务模块 MIT、BabelDOC Python 插件 AGPL-3.0-only 的许可说明，以及 DCO 和精简社区文件，尚待合入 main；PDF 的独立分发拆分仍需实施。后续 PDF 拆分需将全部 AGPL 直接及传递依赖、随包代码和资源移出主体依赖链，见 [PDF 拆分要求](https://github.com/KongouAirlines/ivaraige/pull/32#issuecomment-6266772343)。原报告的许可缺失、文件清单建议应结合这项分发范围变化复核。

上述链接用于找到后续讨论与实现；各项状态继续由对应 Issue／PR 和既有 follow-up 维护。未单列关联事项的发现仍保留在报告中，不在此另建一套待办。

## 原审查源码定位

此表保留原审查元数据中的 head 与 merge-base，不随 PR 后续更新变化。打开固定源码树后，按报告的相对路径及行号查阅。

| PR | 原审查 head | 原 merge-base |
| --- | --- | --- |
| [#1](https://github.com/KongouAirlines/ivaraige/pull/1) | [59894a1d](https://github.com/KongouAirlines/ivaraige/tree/59894a1d28fcaab397f45bd316dd1f89cbeb79b4) | [e2ca13cb](https://github.com/KongouAirlines/ivaraige/tree/e2ca13cba5cde613f0e2f74303a818b47b28abb0) |
| [#2](https://github.com/KongouAirlines/ivaraige/pull/2) | [c401ffce](https://github.com/KongouAirlines/ivaraige/tree/c401ffcef9edabc4b616ebe672e5151be06b3571) | [c4fd706b](https://github.com/KongouAirlines/ivaraige/tree/c4fd706b1463a17ad85df4c95d179ce2183d56e7) |
| [#3](https://github.com/KongouAirlines/ivaraige/pull/3) | [493c3d4c](https://github.com/KongouAirlines/ivaraige/tree/493c3d4c66a649b0c3a765d0be7914ce64d2c4ea) | [958879a2](https://github.com/KongouAirlines/ivaraige/tree/958879a25309f7da6132713b49b7f5d3a87a3025) |
| [#4](https://github.com/KongouAirlines/ivaraige/pull/4) | [4a2812ee](https://github.com/KongouAirlines/ivaraige/tree/4a2812ee6deda51bfee0124f8f2524b5e2b11f83) | [12b8f370](https://github.com/KongouAirlines/ivaraige/tree/12b8f370126e36d5df3993413fc5aafcea178f21) |
| [#5](https://github.com/KongouAirlines/ivaraige/pull/5) | [94c29279](https://github.com/KongouAirlines/ivaraige/tree/94c2927925e64ca5e370e6c8c8cbabc9651a5313) | [4702943e](https://github.com/KongouAirlines/ivaraige/tree/4702943ef972ea0e110300e14dff0920081125f4) |
| [#6](https://github.com/KongouAirlines/ivaraige/pull/6) | [a1195dd0](https://github.com/KongouAirlines/ivaraige/tree/a1195dd017e3ed2af771b9ee94f82e5110357159) | [1b9eca6d](https://github.com/KongouAirlines/ivaraige/tree/1b9eca6d841d16ed5c4f056e0d1536ab354c6cf2) |
| [#7](https://github.com/KongouAirlines/ivaraige/pull/7) | [4e0537e3](https://github.com/KongouAirlines/ivaraige/tree/4e0537e315e7dcd0775ea9cc1fc1dd738f2791f8) | [47fa42d5](https://github.com/KongouAirlines/ivaraige/tree/47fa42d58e7b0589499350a0695d884d99edf670) |
| [#8](https://github.com/KongouAirlines/ivaraige/pull/8) | [3e615485](https://github.com/KongouAirlines/ivaraige/tree/3e61548543c18995691999d29965f35865ec750c) | [1b9eca6d](https://github.com/KongouAirlines/ivaraige/tree/1b9eca6d841d16ed5c4f056e0d1536ab354c6cf2) |
| [#9](https://github.com/KongouAirlines/ivaraige/pull/9) | [5214028c](https://github.com/KongouAirlines/ivaraige/tree/5214028c98d33042b29e21e779701795397ce553) | [a683f9b3](https://github.com/KongouAirlines/ivaraige/tree/a683f9b308fedc6de19068d11a32e43a7d4dc793) |
| [#10](https://github.com/KongouAirlines/ivaraige/pull/10) | [26087a4c](https://github.com/KongouAirlines/ivaraige/tree/26087a4c7d186553ae3f5f3eb8d60e37347b2bbd) | [fde5ec8e](https://github.com/KongouAirlines/ivaraige/tree/fde5ec8e37bb24a8da1f99e1e1f0b3223edaad60) |
| [#12](https://github.com/KongouAirlines/ivaraige/pull/12) | [e7ce115b](https://github.com/KongouAirlines/ivaraige/tree/e7ce115b13ffdde00cca8331a06476c1d214cd84) | [26087a4c](https://github.com/KongouAirlines/ivaraige/tree/26087a4c7d186553ae3f5f3eb8d60e37347b2bbd) |
| [#17](https://github.com/KongouAirlines/ivaraige/pull/17) | [db171f7f](https://github.com/KongouAirlines/ivaraige/tree/db171f7f7d50f16b4ec174184659a33ec5debed1) | [4df1d727](https://github.com/KongouAirlines/ivaraige/tree/4df1d727052a6d2d5a78288fdc65e1a98f4fb6ad) |
| [#18](https://github.com/KongouAirlines/ivaraige/pull/18) | [3524f965](https://github.com/KongouAirlines/ivaraige/tree/3524f96536db0eec78d63d52a82fd24c5f3a1a67) | [c8a146dd](https://github.com/KongouAirlines/ivaraige/tree/c8a146dd9b434773c9c149e4fe67ed0a6da3bb1f) |
| [#19](https://github.com/KongouAirlines/ivaraige/pull/19) | [e61c90a5](https://github.com/KongouAirlines/ivaraige/tree/e61c90a5dad7fd62540c1f2d2aec4c3f87c16250) | [3524f965](https://github.com/KongouAirlines/ivaraige/tree/3524f96536db0eec78d63d52a82fd24c5f3a1a67) |
| [#20](https://github.com/KongouAirlines/ivaraige/pull/20) | [3d696450](https://github.com/KongouAirlines/ivaraige/tree/3d696450488e4938a282b0c5318adbcab553bf73) | [0a185d49](https://github.com/KongouAirlines/ivaraige/tree/0a185d496b45e9f1f891b91b1803794c10835d69) |
| [#24](https://github.com/KongouAirlines/ivaraige/pull/24) | [3d3f9fc2](https://github.com/KongouAirlines/ivaraige/tree/3d3f9fc227aad87d7661f2a9934df38ac056d6c5) | [fca3c611](https://github.com/KongouAirlines/ivaraige/tree/fca3c611e1f9ace64bb71a01db6acf18b1ad9cb2) |
| [#25](https://github.com/KongouAirlines/ivaraige/pull/25) | [4d366247](https://github.com/KongouAirlines/ivaraige/tree/4d3662472d6c80dd4d537696c6b26566b610ef2b) | [3421ba51](https://github.com/KongouAirlines/ivaraige/tree/3421ba51f2535bcd28a1b2c67f81a82d13738c39) |
| [#27](https://github.com/KongouAirlines/ivaraige/pull/27) | [ef597b2c](https://github.com/KongouAirlines/ivaraige/tree/ef597b2c5d342df5b56913edeeb88180cd413154) | [cb7e4a4c](https://github.com/KongouAirlines/ivaraige/tree/cb7e4a4c08aa6a0984ee920f38e2f10dc1bf80a4) |
