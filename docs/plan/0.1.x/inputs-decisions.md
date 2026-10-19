# 0.1.x 输入、证据与待决策

## 基线与输入完整性

2026-10-19 经 GitHub 只读接口核对：仓库 `KongouAirlines/ivoraige`，ID `1396993140`，默认分支 main 为 `43d3f1fadc4930baa445aeb0cb832b3647aa08d7`，软件版本 0.1.0。本次隔离检出从该提交建立；树中只有根 AGENTS.md，未包含 `.agents/skills`。现行代码仅定向阅读架构边界，不重复逐条审计历史 136 条。

独立复核已读取该 main 的 [CI run 39255702238](https://github.com/KongouAirlines/ivoraige/actions/runs/39255702238)：Windows/Linux/macOS 成功，包含 Node 测试、打包冒烟、Python 审计夹具。这里引用已有 CI 证据，本规划分支没有重跑；历史计费导致 CI 不可用不再是当前阻塞，三系统 CI 也不等于干净 Windows/PDF 完整安装验收。固定 DSH 提交内 Cordis 版本已核对为 4.0.4。

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

GitHub #31/#32/#33 的历史讨论与归档索引可能保留“尚未合入”；本轮基线已包含相应审计/许可/报告内容，见 [0.1.0 合流记录](../0.1.0/README.md)。原报告正文保留，不全局改成“已修复”。具体剩余缺口以复核证据和原事项为准。

两项独立输入均已整合，无待转交全文。审计要求新增 Q01–Q04 小工作包，重点承接受理原子性、产物/快照释放、错误映射和文档追踪；既有 Records 原子写、适用性、修订和 data-only 测试保留。75 组的处理去向在审计导航逐组覆盖，未把其历史状态复制成新执行状态。

## 待决定项

| 决策 | 建议起点 | 在何时固定 / 未决影响 |
| --- | --- | --- |
| 服务/operation/event 名称、兼容版本、错误 details | 保留既有服务名，新增注册/事件服务；旧协议映射逐步退出 | P01 固定 DSH 探针后；不能阻止先写当前/目标差异 |
| 失败导出放弃、artifact 删除与外部 out 文件 | 记录/文件分离，外部文件默认保留；活动 lease 阻止释放 | Q02，先明确不可逆影响再暴露删除入口 |
| DSH jobs 配额与关闭 deadline | 优先明确共享队列/饱和语义；owner 按真实 Agent/session 契约 | P01/D01；单次 wait 超时不算关闭完成 |
| source 快照 schema 与旧读支持期 | 明确 source/accepted-translation，旧快照不改写；先双读，写入有版本 | P02；未定前不迁移用户库 |
| 第一轮插件来源/布局 | 同仓、官方受控目录、独立分包、重启激活 | P05；源码拆仓/市场/热更新继续延后 |
| 第二个真实同类插件 | 先选最小且许可/接口可核验的解析实现；保留 BabelDOC 兼容路径 | P07 前选定；fixture 不能替代真实插件证明 |
| MinerU 入口/引擎版本、OCR/VLM 依赖与资源 | 由纯解析最小样本验证选定，锁定实际 SDK/CLI/API 和输出版本 | P06；不把 issue 中 4.0.10 文档能力当作本机已测版本 |
| PDF 默认引擎及跨引擎映射 | 保留 BabelDOC；按 P09 质量/成本证据再决定；P10 独立实验 | 不阻塞纯解析；没有证据不替换默认 |
| 桌面框架/进程形态、TTL/预算 | host + 轻托盘 + 可销毁 UI；两个可行候选实测 | D04/D05；暂不选 Electron/Tauri，窗口销毁依赖草稿可靠落盘 |
| 具体 0.1.x 发行里程碑 | 先按可验收工作包收口，再决定 0.1.1/0.1.2 范围 | 不承诺日期；二进制恢复受 P08 实际包门禁约束 |

## 现在可启动的下一批实现建议

先以 P01 收口契约与护栏；Q01 快照受理、Q03 参数错误可先做独立小修复，Q04 文档追踪、桌面 D04 基线方案及 P08 依赖清单可并行准备。P02/P03 按顺序接续，避免同时改 Records；Q02 资源释放政策接入 P04，P05 冻结安装和操作接口后才进入 P06/P07。报告复核指出的正确性问题不并入整个基础链的大 PR。
