# 基础契约与正确性验证

[验证索引](../validation.md) · [工作包](../packages/foundation.md)

## 基础验证链

| ID / 阶段 | 最小组合与动作 | 通过条件 | 不能据此宣称 |
| --- | --- | --- | --- |
| V01 契约与护栏 | 固定 DSH/Cordis；无业务/无翻译/完整文本三组合；部分启动失败，正常/异常退出；冻结中编辑 | 必需/可选依赖、ready、注销、存储锁顺序有探针；输出仅数据边界，模型不可达，冻结不漂移 | 任意第三方插件被沙箱隔离或所有热卸载安全 |
| V02 适配器 | 两个相同 format、不同 adapterId 的二进制/耗时来源 fixture；明选与平分、上传/排队/取消/资源提交/输出 | 输入和调度由契约决定，公共层无新增格式分支；旧 TXT/MD/PDF 兼容回归；错误返回稳定 | fixture 证明真实第二引擎质量 |
| V03 入口事件 | 同请求经 CLI/HTTP/MCP；WebUI 订阅；设置服务存在、tasks 缺席；断线重连/关闭 | 同一内核结果及错误/取消；ID 归属由服务核查；无监听泄漏；按下述同步竞态矩阵取得权威状态 | 已有持久事件重放或所有入口所有 UI 完整实现 |
| V04 独立安装 | 干净主体，装/禁用/移除插件、缺依赖、不兼容、下载中断、激活失败、重启 | 恢复入口可用；无关能力继续；上一完整包可回退；数据/配置/快照保留 | 完整插件市场/自动更新已交付 |
| V04a 独立插件合规 | 0.1.0 冻结主体后，实际独立安装两个同格式、不同 adapterId 的合规插件；执行选择、缺席、禁用、错误及重启 | 新增插件只改包/配置及其测试文档；旧记录保留可读，操作/入口不加名单分支；两个包共用配套单一运行时 | 样例或合成夹具证明真实第二 PDF 引擎质量，或替代 V05/V06 |
| V05 MinerU 纯解析 | **不安装翻译插件，无 targetLang，无 renderer**；安装 → 准备依赖 → 导入合规短 PDF → 保存/重开 → 原文结构化输出 | units/顺序/表格/公式/图片资源/来源版本可追踪；任务正常完成；已有译文不混入；无伪 accepted；翻译调用为零，OCR/VLM 另计 | 译文 PDF 或跨引擎重建已经可用 |
| V06 第二同类插件 | 在 V05 后冻结主体；接入另一个真实解析插件，执行 V02–V05 同类流程 | 仅新增包/配置/相应测试文档，主体业务及前端引擎名单无修改；两实现共存且选择可追踪 | 任意未来插件都无需演进契约 |

原文输出与翻译输出分别设置 golden fixtures；零调用同时以未装翻译服务、模型调用计数和输出依赖边界证明，不只检查界面按钮。output handler 不接收 ctx/service locator，并检查传入值不能间接携带模型或凭据。缺件测试覆盖：未安装、禁用、缺资源、版本不兼容、启动失败、执行中崩溃、取消、超时、重启；保留已保存修订和冻结产物。

已有 `test/export.test.mjs` 包含 data-only、未绑定 this、冻结不可写和无 LLM 服务断言；本轮目标是保留并按异步 signal/新插件增强。Q01 覆盖导出冲突不增快照；Q02 覆盖 failed 任务放弃、artifact 删除与活动 lease；Q03 覆盖非法 settings 值/JSON/缺件的三入口错误。P01/P05 还需双向安装/业务配额交错和无响应 wait 总截止期，不能将资源饱和记录为模型失败。当前 MCP 已有 component_status 测试调用，后续补完整 settings/组件注册及失败矩阵。

### V03 状态同步竞态

按[同步契约](../../../requirements/0.1.x/contracts.md#状态快照与订阅的同步边界)用可控提交/握手/快照屏障测试，不能靠 sleep 碰运气。记录 generation、scope、barrier、快照 revision 和通知投递次序；这是后续 P04/D01/D03 的验收要求，以实际实现提交记录结果。

| 调度 / 故障 | 必须证明 |
| --- | --- |
| 任务恰在旧的“snapshot 返回后、订阅生效前”窗口完成，此后无新事件 | 旧读取结果不能直接作为已同步视图；先完成订阅握手再重新取快照，完成状态要么已在快照内，要么由缓冲通知触发重取，不依赖未来事件唤醒 |
| 任务分别在订阅安装边界前/后、就绪响应传输中、快照读取/响应中完成，此后无新事件 | 每个提交要么由一致快照覆盖，要么可靠失效通知；最终状态与后端一致，不能用发送端时间戳猜测顺序 |
| 收到 > r 通知，重取快照时再次完成另一任务，此后无新事件 | 同一有效订阅持续缓冲，第二次变化也被快照或再次失效覆盖；重取不能重新引入订阅空窗 |
| 重复/延迟通知、过滤导致 revision 跳号、scope 变化 | 同 generation/scope 下 ≤ r 通知可忽略，> r 失效；跳号本身不等于丢包，scope 变化重新握手，不交叉比较 |
| host 重启、断线、缓冲溢出或显式 resync-required | 丢弃旧 generation/订阅的同步资格，新握手后重取；有限缓冲、合并/退避和关闭清理有效；状态静止后收敛，不需要持久事件重放 |

## 运行时与组件变更门禁

P01 的当前行为探针与候选迁移证据分别记录；[顺序评估](../runtime-sequence.md#候选兼容门禁与维护成本)列出单一运行时、依赖闭包、Records 消费者先清理后关库、AppBoot/Loader/settings/volatile、补丁处置与成套回退门禁。同 SHA 构建缩减验证来源和行为等价；升级或公共包替换须额外验证精确组合、实际 tarball 和旧配置/数据。优先在基础改造前段完成候选比较；P05 兼容范围定案前选择经测基线，候选未通过不阻止选择旧 pin，并记录复评触发。旧 head CI 通过不代表候选升级通过。

## 工作包专项验收

### Q01

阻塞首个导出并发提交第二个，冲突后快照数不增长；取消/重启同样成立；普通 addArtifact 失败已有 unlink 继续保留。

### Q02

三入口删除后无引用快照可释放；其他产物/在途租约阻止删除；明确外部文件策略与恢复提示。

### Q03

HTTP/CLI/MCP 值错误为 INVALID_ARGUMENT，缺件 COMPONENT_MISSING；CLI 语法错误 exit 2，无 INTERNAL 栈泄漏。

### Q04

44 项全覆盖，协议差异明确兼容/后置；旧材料不改写，新增勘误有来源；当前元数据与实际源码一致。

### P01

固定提交探针覆盖选装/缺席/启动失败/消费者清理后关库、配置与双向安装/业务交错；配额饱和不误报模型失败；候选采用另过运行时门禁。

### P02

0.1.0 fixture 升级、只读旧快照、原文导出不混译文且无 targetLang；断电/失败原子性与备份恢复。

### P03

两个相同 format/不同 id 的来源 fixture，经通用路径二进制导入、取消、资源持久化及 MD/JSON；人工/模型/接受修订三路径校验；旧 TXT/MD/PDF 定向回归。

### P04

CLI/HTTP/MCP 同输入结果/错误/取消一致；注册清理无泄漏；settings 事件不依赖 tasks；V03 订阅 barrier/一致快照及重取竞态，之后无事件也收敛。

### P05

干净宿主安装/缺依赖/不兼容/中断/回滚/重启；单一配套运行时及完整发行闭包；无 UI 仍可诊断禁用；卸载不删数据。

### Q02 branch validation checklist

- Failed task: `cancel` remains invalid; explicit `abandon` preserves history, prevents resume, and releases only its resumable snapshot reference.
- Artifact: default deletion retains external and managed bytes; explicit owned-file removal requires a proven managed path/digest, blocks active/shared/read-lease references, and is reported separately from record deletion.
- Recovery: durable cleanup tombstone remains visible and retryable after unlink failure/restart; a pending tombstone blocks same-path adoption and snapshot release. Verify synthetic v1 first-write schema 3 and unknown-version refusal.
- Three entries: CLI, HTTP and MCP use the same operation contract. No real user library, simulated power-cut or native PDF acceptance is claimed.

### P04 branch verification mapping

`test/operation-catalog.test.mjs` covers shared schemas, requirements, owner disposal, in-flight drain and preflight/close admission. `test/entry-plugins.test.mjs` exercises contributed operations through real CLI/HTTP/MCP, result/error/cancel parity, disabled entries, HTTP disconnect and ready/snapshot session cleanup. `test/resource-access.test.mjs` verifies exact opaque resource ownership, common read limits and disconnect during lease acquisition. `test/entry-events.test.mjs`, `test/event-state.test.mjs` and `test/state-sync.test.mjs` cover V03 barriers using controlled commits, actual DSH partial settings save and quiescent convergence. `test/settings-ui.test.mjs` also exercises the built existing browser bundle's ready/refetch handshake. These are synthetic/in-process/browser-harness checks; native desktop, real PDF quality and arbitrary plugin hot unload are not asserted.
