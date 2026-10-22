# 0.1.x 输入、证据与待决策

## 基线与输入完整性

2026-10-19 经 GitHub 只读接口核对：仓库 `KongouAirlines/ivoraige`，ID `1396993140`，默认分支 main 为 `43d3f1fadc4930baa445aeb0cb832b3647aa08d7`，软件版本 0.1.0。本次隔离检出从该提交建立；树中只有根 AGENTS.md，未包含 `.agents/skills`。现行代码仅定向阅读架构边界，不重复逐条审计历史 136 条。

独立复核已读取该 main 的 [CI run 39255702238](https://github.com/KongouAirlines/ivoraige/actions/runs/39255702238)：Windows/Linux/macOS 成功，包含 Node 测试、打包冒烟、Python 审计夹具。这里引用已有 CI 证据，本规划分支没有重跑；历史计费导致 CI 不可用不再是当前阻塞，三系统 CI 也不等于干净 Windows/PDF 完整安装验收。固定 DSH 内 `@deepseek-ai/cordis` 的 4.0.4 是 Harness 发布版本，不是上游正式版；2026-10-20 的[运行时顺序复核](runtime-sequence.md)区分上游 Core RC.7 / Loader RC.5、DSH 补丁与候选 RC.11。

| 输入 | 读取/使用范围 | 证据边界 |
| --- | --- | --- |
| [PR #33 历史报告](../0.1.0/pr-review/README.md) | 五份报告索引、原编号与后续关联 | 136 是历史发现表记录数，含重复/已修/建议，不是当前缺陷数；报告的“未合入”等是当时状态 |
| [v2 设计](../../requirements/v2.0/01_design_v2.0.md)、[UI](../../requirements/v2.0/02_UI-design_v2.0.md)、[协议](../../requirements/v2.0/03_API-protocol_v2.0.md) | 已有不变量与待替代模块/入口/桌面边界 | 不据设计名推定实现；新契约只在对应实施 PR 启用 |
| [design-v3](../follow-ups/design-v3.md)、[ADR-0002](../../decisions/0002-plugin-composition-0.1.0.md) | 稳定事项 ID、能力组合与生命周期方向 | 后续目标改按软件 0.1.x 组织，旧 ID 不改 |
| [#13](https://github.com/KongouAirlines/ivoraige/issues/13)、[#14](https://github.com/KongouAirlines/ivoraige/issues/14)、[#16](https://github.com/KongouAirlines/ivoraige/issues/16) | 样本用途、三接口/第二引擎、无翻译纯解析、最小宿主 | #14/#16 评论明确纯解析先验收，重建独立；不等待全面插件化 |
| [#21](https://github.com/KongouAirlines/ivoraige/issues/21)、[#22](https://github.com/KongouAirlines/ivoraige/issues/22)、[#23](https://github.com/KongouAirlines/ivoraige/issues/23) | 风格、漫画/图像、服务配置 | 远期目标，未锁 schema/算法；当前错误映射可单独修 |
| [#28](https://github.com/KongouAirlines/ivoraige/issues/28)、[#29](https://github.com/KongouAirlines/ivoraige/issues/29) | 发行闭包/许可、契约重规划及后续评论 | 旧包撤下与许可证合入不等于依赖/分发拆分完成 |
| 桌面独立输入 → [全文](desktop.md) | 已读取完整子方案并整合任务、契约与测量矩阵 | 同基线源码核查；没有运行性能测试，所有门槛是建议 |
| 报告复核与差距清单独立输入 → [完整映射](audit/README.md) | 已读取完整主题、验收/备注和 136 行结构化映射，核对源报告与 CSV/JSON | 75 组不是 75 个当前缺陷；静态风险与已修/建议分开，实际业务测试未在本轮重跑 |

五份报告及关联说明已按[归档定位](../0.1.0/pr-review/README.md)保存，时态按原审阅时点解释。审计映射记录本次来源承接，不形成后续全局维护任务。

两项独立输入均已整合，无待转交全文。审计要求新增 Q01–Q04 小工作包，重点承接受理原子性、产物/快照释放、错误映射和文档追踪；既有 Records 原子写、适用性、修订和 data-only 测试保留。75 组的处理去向在审计导航逐组覆盖，未把其历史状态复制成新执行状态。

## PR #34 契约反馈

[重连版本边界建议](https://github.com/KongouAirlines/ivoraige/pull/34#issuecomment-6282252557)作为非阻塞契约澄清采纳：先订阅并缓冲，再取得一致状态快照，重取期间保留订阅；覆盖“窗口内任务完成且此后无事件”的验收。定义见[同步契约](../../requirements/0.1.x/contracts.md#状态快照与订阅的同步边界)，案例见[验证矩阵](validation.md#v03-状态同步竞态)。它没有被登记为已证实运行时缺陷，也没有据此要求持久事件日志。

[状态与 Cordis 组合反馈](https://github.com/KongouAirlines/ivoraige/pull/34#issuecomment-6290898538)及 [OBG 状态审阅](https://github.com/KongouAirlines/ivoraige/pull/34#discussion_r4323789541)已纳入草案：design-v3 改为“已安排”，保留历史记录；THIRD_PARTY 区分当前 0.1.0 与旧组件 0.1.0-dev.0；补齐服务到 provider/inject/disposer 的映射、可选入口、事件桥与 DSH 任务/装配复用边界。[版本分期](releases.md)与 [npm 就绪准备](../0.1.0/npm-readiness.md)区分工程目标与发布动作；旧 PR #33/#30 动态索引维护安排已取消，按一次性审阅归档。

## 2026-10-20 组合流程与扩展范围

新增设计见[可保存工作流/内容工作台](../../requirements/0.1.x/workflows.md)及[格式/协作](formats-integrations.md)。方向是在保留现有任务、修订/接受与冻结输出的基础上，以可组合定义替代唯一固定业务链，保存实例和版本、追溯实际输入/尝试/决定，主区仍服务内容阅读编辑。不是只调整界面，也不授权另造 Cordis/任务内核。

新增 W01–W04、F01–F04、I01–I03 仅为规划工作包，状态仍只在原表；既有 136 ID/75 主题映射是冻结审计输入，不因新增产品方向而改写。v1 F-07/F-23/F-24/F-25 和 v2 EPUB/Zotero/Office 目标已核查，当前源码仅 txt/md/pdf；一手格式资料用于设置验收边界，未做新引擎/客户端联调。版本按新增阶段重评，不预设所有功能落入 0.1.1/0.1.2，npm 仍不排期。

## 2026-10-21 UI 要求复核

完整核对 [#16](https://github.com/KongouAirlines/ivoraige/issues/16)正文与评论（包括[插件配置归属](https://github.com/KongouAirlines/ivoraige/issues/16#issuecomment-6105527453)），并结合 #13 的样本用途/外发权限、#14 的能力分离要求。独立审阅确认旧 v2 的双栏未覆盖局部替换/重写，新 workflows 的内容主区也不替代独立普通翻译。对应缺口、目标栏目与逐项映射归 [UI 草案](../../requirements/0.1.x/ui.md)，不另建平行 UI 设计或改写历史报告。

U01–U03 承接新增 UI 范围，状态只在工作包表；U-V01–U-V03 是待执行验收。详细交互和配置归属集中于 [UI 要求映射](../../requirements/0.1.x/ui.md#要求与交付映射)，不重复维护栏目清单。

## 侧栏与设置归属的后续确认

已确认侧栏管理对象/工作入口、设置管理全局默认/宿主策略、工作上下文管理本次覆盖。具体导航、五类设置、数据存储位置和共享连接关系以 [UI 设计](../../requirements/0.1.x/ui.md#三层归属与设置标签)为准；字段/schema、兼容迁移及最终路由留 U02 切片固定，未增加 0.1.0 承诺。

## 文档结构与归档定位

综合 [6320594731](https://github.com/KongouAirlines/ivoraige/pull/34#issuecomment-6320594731) 与 [6321031325](https://github.com/KongouAirlines/ivoraige/pull/34#issuecomment-6321031325)，采用产品设计、版本范围、执行索引、专项/来源四条阅读路径；领域详情及验证按任务读取。用户确认五份 PR 审查只作历史来源，取消持续刷新报告与动态 PR 状态的安排，原正文/发现 ID/固定源码证据保留。

## 宏观领域覆盖反馈

[领域覆盖建议](https://github.com/KongouAirlines/ivoraige/pull/34#issuecomment-6321399842)由[领域地图](domains.md)承接：复用术语补充 0001 和已有安全/分发契约，补译文质量及跨页验收；延后领域记录触发条件与最小决策输入，责任角色随切片认领。RAG 尚未纳入当前候选承诺，保留后续 0.1.x 重评可能；ADR 按实际取舍补充。

## 待决定项

| 决策 | 建议起点 | 在何时固定 / 未决影响 |
| --- | --- | --- |
| 服务/operation/event 名称、兼容版本、错误 details | 保留既有服务名，新增注册/事件服务；旧协议映射逐步退出 | P01 固定 DSH 探针后；不能阻止先写当前/目标差异 |
| 失败导出放弃、artifact 删除与外部 out 文件 | 记录/文件分离，外部文件默认保留；活动 lease 阻止释放 | Q02，先明确不可逆影响再暴露删除入口 |
| DSH jobs 配额与关闭 deadline | 优先明确共享队列/饱和语义；owner 按真实 Agent/session 契约 | P01/D01；单次 wait 超时不算关闭完成 |
| source 快照 schema 与旧读支持期 | 明确 source/accepted-translation，旧快照不改写；先双读，写入有版本 | P02；未定前不迁移用户库 |
| Cordis 候选与 DSH 组件来源 | 先验证现有 pin；获取/构建、发行闭包和公共包替换分别验收，保持单一运行时 | P01 的现有基线不等待 RC 定型；采用候选前及 P05 兼容定案前按[门禁](runtime-sequence.md)复评，可选经测旧组合 |
| 第一轮插件来源/布局 | 同仓、官方受控目录、独立分包、重启激活 | P05；源码拆仓/市场/热更新继续延后 |
| 第二个真实同类插件 | 先选最小且许可/接口可核验的解析实现；保留 BabelDOC 兼容路径 | P07 前选定；fixture 不能替代真实插件证明 |
| MinerU 入口/引擎版本、OCR/VLM 依赖与资源 | 由纯解析最小样本验证选定，锁定实际 SDK/CLI/API 和输出版本 | P06；不把 issue 中 4.0.10 文档能力当作本机已测版本 |
| PDF 默认引擎及跨引擎映射 | 保留 BabelDOC；按 P09 质量/成本证据再决定；P10 独立实验 | 不阻塞纯解析；没有证据不替换默认 |
| 桌面框架/进程形态、TTL/预算 | host + 轻托盘 + 可销毁 UI；两个可行候选实测 | D04/D05；暂不选 Electron/Tauri，窗口销毁依赖草稿可靠落盘 |
| 可保存工作流及项目最小边界 | 模板版本/实例修订/冻结定义与可变状态分离；能力端口有类型/schema/基数，人工后形成执行片段 | W01/W02 固定 schema、默认分支政策、共享/迁移格式和授权有效期；W02 紧接基础，不等待高级画布 |
| 内容工作台与高级编辑 | 内容主区、轻状态条、折叠侧栏；卡片/图共用模型 | W03 定上下文/草稿与可访问性，W04 后置；不以图视图简化而删分支 |
| 原生格式/协作切片 | DOCX/可重排 EPUB 优先；KT 与 Zotero 同级高优先、可并行验证，其他格式和历史客户端分别探针 | F/I 包固定支持结构、实际库/客户端版本、权限/幂等和验收软件；无联调不宣称兼容 |
| 候选版本与 npm 包身份 | 按[分期](releases.md)：0.1.0 基础、0.1.1 引擎、0.1.2 桌面；实际 registry 身份另查 | 范围可按验收调整；不承诺日期/上架；所交付包各自通过 P08 与安装门禁，不覆盖历史版本 |

## 现在可启动的下一批实现建议

执行顺序已移至[工作包索引](work-packages.md#下一批执行顺序)，本页保留来源、决定及待决问题。
