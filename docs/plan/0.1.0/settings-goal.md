# 独立设置窗口与插件设置页面规划

2026-10-07 修订。分支 `codex/0.1.0-settings` 的规划提交已重放到本次 fetch 后的远端 `main`：`a683f9b`，包含已合并的 [模型修复 PR #6](https://github.com/KongouAirlines/ivaraige/pull/6)、[PDF PR #7](https://github.com/KongouAirlines/ivaraige/pull/7) 和版本命名规则 PR #8。只重放设置规划提交，不重复带入已 squash 合并的修复历史。本轮更新规划，尚未修改设置界面实现。

事项的当前状态、认领范围和处理记录统一见 [plugin-settings-window](../follow-ups/plugin-settings-window.md)。本文件维护方案、阶段和验收清单，不另维护后续事项状态表；开始阶段时按 [跟踪规则](../follow-ups/README.md) 核对目标和参与分支的已提交快照。

## 已合并基线与 PDF 带来的调整

- `web/model-settings.jsx` 仍是模型列表、端点和凭据的连续卡片；PDF 合入没有新增独立设置组件。`src/model-settings.mjs` 继续使用 DSH 路由、凭据与模型选择持久化。
- PDF 已由 `createApp({pdf})`／CLI `--pdf-config` 装配，启动文件管理 command、args、timeoutMs、modelDirs 和 options；尚无 PDF 设置写入 HTTP 接口。具体准备方式见 [PDF 指南](pdf-guide.md)。
- `/api/capabilities` 已返回 `components.babeldoc`、输入／输出格式；PDF 状态来自适配器，当前为 `unchecked`、`ready`、`unavailable`。`unchecked` 只表示已配置，第一次实际处理后才可能成为 `ready`。打开设置或刷新状态不能隐式导入、导出、下载资产或调用模型。
- PDF 工作台已增加原件页面、bbox 定位、目标语言作用域及多格式冻结导出；设置窗口的背景保留验收须覆盖这些状态，不能只检查 TXT 编辑器。
- 当前 `features.settings` 由模型设置服务是否存在决定。插件设置壳接入后须按实际注册页面暴露入口，避免仅装配 PDF 时设置不可达；不能把 `inputFormats` 中暂时缺少 PDF 当作卸载插件的依据。

## 问题与体验目标

当前设置页把已保存模型、模型／端点编辑和凭据平铺为连续卡片，浏览与编辑混在同一层级。目标是独立的大型设置窗口：有专用侧边栏和明确的关闭入口；一级页面包括“模型”和已装配 PDF 插件贡献的“PDF”。模型配置与凭据位于所属对象的编辑流程中。页面和侧边栏项目由已装配插件贡献，新增插件不要求修改设置壳的业务分支。

桌面采用占据主要窗口的大型对话框，窄屏采用全屏窗口。背景工作台保留原页面、选段及未保存译文，不因打开设置被卸载。设置窗口独立滚动，背景不可交互；关闭后返回原位置并恢复焦点。URL 能表示当前设置页面，支持直接打开、刷新和浏览器返回。

## 信息结构与模型流程

| 层级 | 内容 | 操作 |
|---|---|---|
| 设置窗口 | 独立侧边栏、标题、关闭入口 | 模型／PDF 按插件实际注册显示，无未装配功能的空入口 |
| 模型主页 | 已保存模型列表，提供商、当前使用状态与凭据状态 | 添加、查看／编辑、设为当前翻译模型 |
| 模型添加／编辑 | 提供商选择，模型 ID、容量覆盖与超时 | 仅保存、保存并用于翻译、取消 |
| 所属提供商配置 | 端点、API、凭据引用、路由级推理参数 | 查看／编辑共享设置，列出受影响模型 |
| 所属提供商凭据 | 配置状态及写入入口 | 输入新密钥；无认证本地服务可保存明确标识的占位值 |
| PDF 页面 | 组件状态、实际可用格式、缺失原因、准备与重启指引 | 读取／刷新现有状态；未验证和不可用时仍可进入说明页 |

继续使用 PR #6 的 savedModels、routes、selected 与 DSH credentials；不复制模型或密钥存储。“设为当前模型”与保存配置分开；配置保存、切换不自动启动翻译或覆盖已接受译文。同一提供商的模型共享路由参数，编辑时明确影响范围。

模型详情先使用内层页面，减少多重弹窗。提供商和凭据作为子视图；是否提供“提供商”子标签由 S1 小样验收决定，不提前增为设置侧边栏一级项目。当前模型用 provider／model 组合定位，URL 正确编码斜杠等字符；显示名称与未来协作标签不成为记录主键。

PDF 页首期是组件状态与使用配置说明。继续从 capabilities 读取已公开信息，不为展示路径而返回完整启动配置或进程环境。组件未装配时不注册页面；已装配但握手失败／资产缺失时保留页面并显示真实原因。刷新只重读状态，不将 `unchecked` 显示为“已验证”；准备脚本、缓存和 sidecar 启停仍由现有流程管理。在线编辑可执行命令、权重路径、安装／下载按钮和热重启不在本阶段范围，需要独立内核操作、任务互斥与协议设计后再安排。

## DSH 复用证据与接入边界

固定源码版本：`639ed015397290b3745d163aafe02ffee4aa3f84`。本轮已只读检查以下实现，未运行 DSH 客户端集成：

- [ui-settings slots 契约](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/client/ui-settings/src/client/contract/slots.ts)：`settings.section` 为有序列表，注册选项包含 id、order、label；标题、关闭按钮等也由 slots 贡献。
- [ui-settings-general SettingsRoot](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/client/ui-settings-general/src/client/SettingsRoot.tsx)：带侧边导航的 modal shell，使用 portal 和 modal primitives。其窗口尺寸仅作参考。
- [ui-settings 客户端装配](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/client/ui-settings/src/client/index.ts)：依赖 remote／remote.settings，维护 schema、form 和 describe mirror；设置变更及连接重置触发刷新。

ivoraige 当前是静态 React SPA＋REST/SSE，不是完整 DSH client composition。复制组件不能满足其 slots、store、remote、connection 和 primitives 依赖。S0 必须验证最小依赖闭包，优先复用注册、窗口和表单机制；如需适配，只桥接当前内核入口与这些能力，不建立另一套 settings／credentials／模型注册表。

侧边栏由实际页面注册产生，不由 App 固定数组或 provider 名称推导。页面组件属于插件；静态构建提供已打包组件，后端配置内容不能当作可执行前端代码。首期动态能力是已打包插件的挂载／卸载，运行时下载任意第三方 UI 包不在范围内。

## 导航、编辑与插件生命周期

- 建议地址为 `#/settings/models` 和 `#/settings/pdf`，模型详情用编码后的 provider／model 参数；旧 `#/settings` 转到首个已注册页面。关闭恢复原业务页面，直接进入设置时返回可用主页。S0 决定最终地址后同步 UI 规范。
- 普通设置表单与翻译编辑器各自拥有未保存状态。切换子页、关闭及浏览器返回走同一变更检查；取消退出保留输入。凭据不写入 URL、localStorage 或普通草稿，提交完成后清空。
- 保存中避免重复提交；取消界面等待不等于后端写入已取消。revision 冲突或可能的部分保存提示重新读取，不显示假成功；旧请求结果不能覆盖新页面／新编辑。S2 认领 [model-settings-partial-save](../follow-ups/model-settings-partial-save.md) 的反馈与恢复范围：明确保存可能部分完成，提供重读操作，保留非秘密输入供核对，不自动重试覆盖配置；凭据成功写入后即清空，即使后续刷新失败也不误报为未保存。
- 注册随插件 effect 释放。当前插件卸载后禁止提交，显示组件已卸载反馈；保留可展示的非秘密草稿、清空凭据输入，用户确认后退到可用页面。无页面时显示空状态，不保留失效导航项。
- 重挂载不重复注册，排序确定；重连后刷新实际可用页面与设置。窗口壳不取得翻译模型服务、不干预调度，任务互斥与 revision 校验仍由内核执行。
- 焦点限制在窗口内，Escape 与关闭按钮行为一致；关闭后恢复焦点，dialog 有可访问名称。窗口继承主题，自身滚动正确。

## 实施阶段与退出条件

| 阶段 | 交付 | 必须验证 |
|---|---|---|
| S0 复用验证与接线决定 | DSH 最小依赖闭包、模型／PDF 页面注册小样、技术决策；设置入口与模型服务解耦 | 实际注册页面可打开／关闭；仅模型、仅 PDF、两者均有和均无的装配矩阵；卸载撤销导航，组件不可用保留状态页；构建可打包 |
| S1 窗口、模型管理与 PDF 状态页 | 独立窗口、专用侧边栏、模型列表与内层编辑、PDF 状态和准备指引 | TXT／MD／PDF 工作台未保存译文、目标语言、选段、PDF 页面与滚动位置保留；关闭／返回／刷新一致；两个提供商及同提供商两个模型保存／切换通过 |
| S2 生命周期与编辑收尾 | 动态页面、卸载回退、重连、未保存与保存中处理、部分保存反馈 | Cordis 挂载／卸载；状态从 unchecked 到 ready／unavailable 的刷新；晚响应不覆盖新视图；可控第二次写入失败的反馈与重读，不自动覆盖新 revision；无重复条目或生命周期泄漏 |
| S3 交付验收 | 指南、能力记录、安装包及可体验 PR | 相关回归、浏览器键盘与窄屏；PDF 缺失不阻塞文本；冻结 PDF／MD／JSON 导出无追加模型请求；安装包与三系统 Node 24 CI 按最终变化运行，报告实际结果 |

窗口与模型流程属于中等规模前端重组；DSH client 最小装配及动态生命周期是主要不确定性，总体按中等偏大工作量规划。S0 后再估计成本，不在依赖闭包未验证前承诺工期。可分阶段提交，但静态原型或硬编码导航不能替代插件接入验收。

## 范围与完成审计

本目标不重构翻译／导出服务，不设计模型标签、多模型协作调度、在线模型目录、配置删除策略或全功能插件市场。相关范围分别见 [model-collaboration-labels](../follow-ups/model-collaboration-labels.md) 和 [provider-catalog-connections](../follow-ups/provider-catalog-connections.md)；新发现先查重，再按跟踪规则独立记录，不因登记而自动扩大实施范围。

- [ ] S0 复用路线有运行证据和依赖清单。
- [ ] 窗口可直接打开、刷新、关闭、返回，背景编辑不丢失。
- [ ] 模型管理、端点与凭据形成明确的主从流程。
- [ ] PDF 页面反映真实组件状态，刷新不触发任务、安装或模型调用；失败状态不被误当作卸载。
- [ ] 打开／关闭设置不丢失 PDF 选页、选段、目标语言及未保存译文。
- [ ] 插件注册／卸载驱动导航和内容，依赖错误可解释。
- [ ] 旧设置可读回，保存／选择／凭据安全边界不回退。
- [ ] 键盘、焦点、主题及窄屏检查通过。
- [ ] 验证及限制更新入文档，提供体验 PR；Merge 等用户确认。

规划状态：已按包含 PDF 的主线重新形成，尚未实施。下一步从 S0 验证 DSH 客户端最小装配及模型／PDF 页面注册开始；S0 通过后再进入界面重组。上述验收是未来要求，本轮仅核对源码、分支关系与文档链接，没有重新运行 PDF 实测或声明客户端插件集成已通过。
