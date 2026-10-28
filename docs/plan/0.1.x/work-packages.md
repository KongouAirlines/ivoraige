# 0.1.x 工作包与依赖

先读目标 ID 的一行，再打开对应领域详情、契约章节和验证 ID。版本范围见[候选分期](releases.md)；领域详情不重复维护进度。

## 状态与证据

本表维护当前工作包的执行状态及实现/验收证据。“草案”表示尚未实施；分支通过后记录提交与未完成范围，集成验收后再标完成。当前交付能力见[能力表](../0.1.0/capabilities.md)。历史报告及审计映射仅是固定来源，纳入规划不等于修复；已有 follow-up 保留自身事项身份与结案条件，不另复制工作包进度。

子交付以 `父包.名称@契约版本` 引用，定义与责任见[I01 子交付](packages/formats-integrations.md#共享子交付)、[U03.terms@1](packages/ui.md#u03-terms)、[W03.publish-ui@1](packages/workflows.md#w03-publish-ui)。它们不是新顶层工作包；实现/验收证据按子 ID 写入本表所属父包行，不能把某个子交付通过当作父包全部完成。

## 执行状态与依赖（唯一表）

| ID | 目标 | 前置 | 状态 / 实施与验收证据 | 详情 |
| --- | --- | --- | --- | --- |
| Q01 | 导出受理冲突的快照原子性/补偿 | 按现有契约先复现；可独立于 P01 | 分支已实现／待集成；修复提交 `4e929478`，本地专项验证见 [Q01 证据](evidence/foundation-qfix.md#q01--export-admission)；[PR #46 旧 head CI](https://github.com/KongouAirlines/ivoraige/actions/runs/39927549289) 不覆盖本次修复 | [基础契约与正确性](packages/foundation.md#q01) |
| Q02 | 产物、失败导出任务与快照释放 | P01 固定删除/保留政策 | 草案 | [基础契约与正确性](packages/foundation.md#q02) |
| Q03 | 设置值/缺件错误与 CLI 非法 JSON/根值 | 当前协议；可独立于 P01 | 分支已实现／待集成；PR #46 的基础修复 `4e929478`、原生 DSH CAS 修复 `76758b9` 与 compat 完整修复 `a2d1fd1`；本地验证见 [Q03 基础证据](evidence/foundation-qfix.md#q03--settings-and-cli-errors)、[部分保存与 CAS 证据](evidence/foundation-qfix.md#46-cas-review-correction--native-dsh-settings-conflicts)、[compat 证据](evidence/foundation-qfix.md#46-protocol-specific-compat-review-correction)、[CLI 根值验证](evidence/foundation-qfix.md#q03-cli-json-root-validation)；[完整代码 head a2d1fd1 的 CI](https://github.com/KongouAirlines/ivoraige/actions/runs/40057038484) 已通过；待 main 集成 | [基础契约与正确性](packages/foundation.md#q03) |
| Q04 | 需求/协议差异及源码交付元数据收口 | 相关需求/协议与当前交付元数据；按文档域并行 | 草案 | [基础契约与正确性](packages/foundation.md#q04) |
| P01 | DSH/Cordis 契约、最小宿主边界与护栏 | 本规划评审 | 草案 | [基础契约与正确性](packages/foundation.md#p01) |
| P02 | 解析产物、原文快照及旧记录兼容 | P01、Q01 | 草案 | [基础契约与正确性](packages/foundation.md#p02) |
| P03 | 适配器身份/格式分离与导入编排 | P01、P02 | 草案 | [基础契约与正确性](packages/foundation.md#p03) |
| P04 | 操作注册、跨域事件及入口收口 | P03；删除入口依赖 Q02 | 草案 | [基础契约与正确性](packages/foundation.md#p04) |
| P05 | 独立官方插件包与安装恢复 | P04；兼容范围定案前完成运行时基线复评（不要求升级） | 草案 | [基础契约与正确性](packages/foundation.md#p05) |
| P06 | MinerU 纯解析插件 | P05、验证 V01–V04 | 草案 | [PDF 与独立分发](packages/pdf.md#p06) |
| P07 | 第二同类插件与主体稳定性证明 | P06 后冻结的契约 | 草案 | [PDF 与独立分发](packages/pdf.md#p07) |
| P08 | PDF 依赖闭包与独立分发 | 清单核对可并行；成包依赖 P05 | 草案 | [PDF 与独立分发](packages/pdf.md#p08) |
| P09 | MinerU 自身重建及同译文 PDF 对照 | P06；受影响包依赖 P08 | 草案 | [PDF 与独立分发](packages/pdf.md#p09) |
| P10 | 跨引擎来源映射与 PDF 重建 | P07、P09；单独批准实验范围 | 草案 | [PDF 与独立分发](packages/pdf.md#p10) |
| D01 | 桌面 HostSession/任务/worker/退出契约探针 | P01；集成依赖 P04 | 草案 | [桌面生命周期](packages/desktop.md#d01) |
| D02 | WebUI 草稿日志及恢复 | 可先用 D01 草案做夹具；接线依赖 D01/P04 | 草案 | [桌面生命周期](packages/desktop.md#d02) |
| D03 | UI session 客户端与事件定向失效 | P04；测量与设计可并行 | 草案 | [桌面生命周期](packages/desktop.md#d03) |
| D04 | 现有 host/browser 性能和故障基线 | [测量协议](desktop.md)；可并行 | 草案 | [桌面生命周期](packages/desktop.md#d04) |
| D05 | 桌面候选探针、选型及集成验收 | D01–D04；正式壳依赖稳定接口 | 草案 | [桌面生命周期](packages/desktop.md#d05) |
| W01 | 能力/产物/来源契约与默认链的真实组合证明 | P02、P03、P04；独立插件证据接 P05 | 草案 | [可组合工作流](packages/workflows.md#w01) |
| W02 | 可保存模板/实例版本、运行追溯与局部重跑 | W01；紧接基础，复用 P02/P04/P05 | 草案 | [可组合工作流](packages/workflows.md#w02) |
| W03 | 内容优先工作台与卡片/参数编辑 | W01、W02、D03；发布管理 UI 子交付 W03.publish-ui@1 另接 I01.callable@1；自动销毁另依赖 D02 | 草案 | [可组合工作流](packages/workflows.md#w03) |
| W04 | 高级节点图编辑与无损视图切换 | W02、W03；不作为真实组合保存的前置 | 草案 | [可组合工作流](packages/workflows.md#w04) |
| U01 | 独立普通翻译、可选即时预览、局部候选与修订交互 | P04；仅预览切片另需 U02 模型/连接与预览设置交付（[U-V02.preview-settings](validation/ui.md#u-v02-preview-settings)），普通页不等 U02；保留既有 Records/翻译服务；预览独立选用已有配置模型，内置引擎/语言包及 #39 非前置，转项目另接 W02 | 草案 | [普通翻译与管理 UI](packages/ui.md#u01) |
| U02 | 分组导航、五类设置（含独立预览默认模型及普通页配置入口）、模型/连接管理与插件配置归属 | P04、P05；项目区接 W02，资源准备接 P08/对应插件 | 草案 | [普通翻译与管理 UI](packages/ui.md#u02) |
| U03 | 术语后端、术语页、数据与存储设置子页及可解释预检切片 | U03.terms@1 仅需 P01/P02 及现有翻译接点，不等 U02/UI；术语页接 U02 与该后端，存储接 Q02/P02，项目挂载接 W02，预检接 P03 | 草案 | [普通翻译与管理 UI](packages/ui.md#u03) |
| F01 | DOCX 窄范围提取、草稿与原生回写 | P02、P03；公共入口 P04，独立交付 P05 | 草案 | [格式与软件协作](packages/formats-integrations.md#f01) |
| F02 | 可重排 EPUB 窄范围读取与原生回写 | P02、P03；公共入口 P04，独立交付 P05 | 草案 | [格式与软件协作](packages/formats-integrations.md#f02) |
| F03 | PPTX 提取与版面约束回填 | P02、P03；公共入口 P04，独立交付 P05 | 草案 | [格式与软件协作](packages/formats-integrations.md#f03) |
| F04 | XLSX 用户选区文本与公式隔离 | P02、P03；公共入口 P04，独立交付 P05 | 草案 | [格式与软件协作](packages/formats-integrations.md#f04) |
| I01 | 共用外部 API、可调用方案与薄协议适配；Zotero 高优先切片 | I01.shared@1 ← P04；I01.callable@1 ← I01.shared@1、W02、U03.terms@1；I01.zotero@1 ← I01.shared@1、P02/P03 导入与产物能力；方案调用再接 I01.callable@1。独立交付接 P05；不等 KT 或 W03 UI | 草案 | [格式与软件协作](packages/formats-integrations.md#i01) |
| I02 | KT 高优先集成；其他网页/OCR 入口后续切片 | [I01.shared@1、I01.callable@1](packages/formats-integrations.md#共享子交付)（后者含 U03.terms@1），独立交付接 P05；不依赖整个 I01、I01.zotero@1、OpenAI 包装或 W03.publish-ui@1 | 草案 | [格式与软件协作](packages/formats-integrations.md#i02) |
| I03 | 笔记/知识库及电子书文件交换 | I01.shared@1、P05；电子书成品按 F02 | 草案 | [格式与软件协作](packages/formats-integrations.md#i03) |

## 每包验收与回退

详情按[基础](packages/foundation.md)、[PDF/分发](packages/pdf.md)、[桌面](packages/desktop.md)、[工作流](packages/workflows.md)、[UI](packages/ui.md)、[格式/协作](packages/formats-integrations.md)分组。每包链接验收 ID，案例集中到[验证索引](validation.md)。

## 下一批执行顺序

P01 固定当前基线契约与护栏；运行时升级/同 SHA 构建缩减依[专项评估](runtime-sequence.md)独立切片。Q01/Q03 可先行，Q04、P08 清单及 D04 现有 host/browser 基线可并行。P02/P03 顺序修改 Records，Q02 的释放政策接 P04；P05 兼容复评后推进 P06/P07。

W01 的前置是 P02/P03/P04，P05 只承接独立插件证据；W02 紧接可保存组合，W03 衔接内容工作台，W04 图编辑后置。U01 普通页在 P04 后可独立推进，不等待 U02、项目、画布或桌面，转项目接 W02；仅预览切片等待 U02 模型/连接与预览设置通过 [U-V02.preview-settings](validation/ui.md#u-v02-preview-settings) 后再按 U-V01 验收，不等待 U02 无关管理页；U02 按导航/设置、模型/连接、插件管理拆 PR，U03 按术语/存储/预检交付。F01/F02 按各自前置进入窄范围支线。KT 与 Zotero 同级高优先，可与共享接口/适配契约并行联调；端到端验收按上表引用确切子交付版本和验收 ID，不要求整个 I01 完成。I01.callable@1 通过本机受控 CLI 验收发布与运行，W03.publish-ui@1 后置接同一管理服务；U03.terms@1 是实际术语后端前置，不等待 U03 全部页面。KT 不等待 Zotero 或 OpenAI 包装，也不等全部 PDF、桌面或 W04 图编辑。

## 去重关联与远期边界


| 原事项 / 证据 | 本轮承接 | 不重复新建的范围 |
| --- | --- | --- |
| [design-v3](../follow-ups/design-v3.md)、[#29](https://github.com/KongouAirlines/ivoraige/issues/29)；PR1-01、PR4-02/03/04、M18-1/6、F9-2 | P01–P04 | 契约、导入编排、入口归属/产物读取、跨域事件；旧编号不改 |
| [#14](https://github.com/KongouAirlines/ivoraige/issues/14)；P7-2/3、P12-2 | P03、P06/P07、P09/P10 | 适配器通用化与真实 PDF 质量分开，不将其视为一个大 PR |
| [#16](https://github.com/KongouAirlines/ivoraige/issues/16)与 2026-10-20 可保存/按需组合方向 | P02、P05–P07、W01–W04、U01–U03、D01–D05 | 纯解析与真实组合均需证明；完整共享权限/多库管理后续分期，不再将所有项目流程含糊归远期 |
| v1 F-07、v2 EPUB/Office 目标 | F01–F04 | DOCX/EPUB 按原分期保留；PPTX/XLSX 独立切片，不改旧主优先级、不冒充已实现 |
| [共享接口契约](../../requirements/0.1.x/contracts.md#稳定对外接口与可调用方案)、[#41](https://github.com/KongouAirlines/ivoraige/issues/41)、[#42](https://github.com/KongouAirlines/ivoraige/issues/42) | I01/I02，复用 P04、W01–W03 及术语后端 | 共用 API、方案发布、OpenAI 包装与 KT 接入按切片验收，不新建第二任务树 |
| v1 F-23/F-24/F-25 与历史客户端候选 | I01–I03 | 协作以公共契约及显式交接为核心，软件候选不是承诺全部完成的清单 |
| [#28](https://github.com/KongouAirlines/ivoraige/issues/28)、[历史许可审计](../0.1.0/pdf-license-audit.md) | P08；发行前独立门禁 | 撤下旧包、加入许可证不等于实际依赖拆分或旧包问题已修 |
| [pdf-store-relocation](../follow-ups/pdf-store-relocation.md)、[pdf-source-restoration](../follow-ups/pdf-source-restoration.md) | P02/P03 相关兼容回归 | 资源搬迁、同源重导入复用、跨引擎迁移是不同验收 |
| [#23](https://github.com/KongouAirlines/ivoraige/issues/23) 的 F6-3/F9-4 | 小型协议校验修复可独立，完整服务管理远期 | 同一非法 compat/reasoningEfforts 错误映射只算一类；不等待模型目录重设计 |
| [records-update-validation](../follow-ups/records-update-validation.md) | D04 可先观察；是否优化由测量决定 | 不为性能删除事务/适用性/schema 校验 |
| [#13](https://github.com/KongouAirlines/ivoraige/issues/13) | 合规小样本、私有评测接口 | 基础链不等待完整长期私有样本库；不默认外发或公开材料 |
| [#21](https://github.com/KongouAirlines/ivoraige/issues/21)、[#22](https://github.com/KongouAirlines/ivoraige/issues/22)、[#23](https://github.com/KongouAirlines/ivoraige/issues/23) | 远期；接口留实际扩展点 | 风格/漫画/超分/完整服务配置不阻塞首轮；不预定 schema 或默认引擎 |

完整报告复核已进入 [审计映射](audit/README.md)。若实现时发现阻塞本轮验收的正确性缺陷，先拆小修复 PR，不能借“架构重构以后处理”跳过；表外低优先主题按原事项触发条件处理。
