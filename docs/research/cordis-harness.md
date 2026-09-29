# Cordis 与 DeepSeek Harness 调研提纲

日期：2026-09-29｜状态：已做官方资料初查，未运行实验。

## 已核实的资料关系

用户准备从 DeepSeek Harness 文档学习 Cordis 的安排合理：Cordis 官方仓库当前直接将其文档入口指向 Harness 的 Cordis primer，并说明独立官方文档仍在建设中。仓库也提示 API 尚未稳定。[Cordis 官方仓库](https://github.com/cordiverse/cordis)

Harness 的 primer 说明其 Cordis 是以 vendor 方式引入的框架；核心关注点是上下文、服务依赖、事件与可清理的注册。[Cordis 入门](https://deepseek-harness.github.io/deepseek-harness/reference/cordis-primer)

因此阅读教程时要记录使用的是上游 Cordis 还是 Harness 所带版本，示例的包名与项目依赖必须匹配；不能默认两者任意版本兼容。本次尚未核验版本差异或确定依赖版本。

DeepSeek Harness 是使用 Cordis 的 agent 产品框架，提供模型、工具、会话等能力；官方仍标为 developer preview，并明确存在破坏兼容性的变更。[官方仓库](https://github.com/deepseek-ai/deepseek-harness)

## 阅读次序与产物

| 顺序 | 资料 | 只需回答的问题 | 产物 |
|---|---|---|---|
| 1 | [Cordis 入门](https://deepseek-harness.github.io/deepseek-harness/reference/cordis-primer) | 业务能力如何声明、依赖和释放？ | 用本项目模型／术语／输出能力画一张依赖草图 |
| 2 | [Cordis 教程](https://deepseek-harness.github.io/deepseek-harness/develop/cordis-tutorial/) | 插件、生命周期、服务、事件、配置如何组合？ | 一个可运行的翻译相关小例子 |
| 3 | [Harness 架构](https://deepseek-harness.github.io/deepseek-harness/en/reference/) | 哪些产品能力可复用？哪些会引入与翻译无关的约束？ | Cordis 单独使用与完整 Harness 的对照 |
| 4 | [vendor 说明入口](https://github.com/deepseek-ai/deepseek-harness/blob/master/vendor/README.md)与选定版本源码 | 包来源、同步方式与本例适用 API 是否一致？ | 固定版本／提交及环境记录；此项仍待细读核验 |

教程提供无需 API 密钥的示例，适合首先验证框架机制。[教程说明](https://deepseek-harness.github.io/deepseek-harness/develop/cordis-tutorial/)

不必先读完所有子系统。优先读完与首个实验有关的内容，遇到实际问题再查完整 API。

## 要验证的实验

以下均为本项目拟议实验，未声明为框架已保证的业务行为。

| 实验 | 方法 | 通过条件 |
|---|---|---|
| 服务依赖 | 翻译调用方依赖模拟模型与术语服务，故意缺失一个依赖 | 可观察等待或失败原因，无静默错误执行 |
| 可替换模型 | 在不修改翻译逻辑的情况下换模拟实现 | 输入输出约定保持一致，调用落到新实现 |
| 释放与重复加载 | 注册监听器并卸载／重新加载插件 | 无重复监听、残留定时器或意外重复任务 |
| 取消传播 | 在模型请求进行中发出取消 | 业务明确区分不再派发、请求中断与结果保存 |
| Python 后端接入 | 仅在选定解析器需要时，比较子进程与 HTTP | 输入输出可定位，超时和退出有清晰处理 |
| 配置边界 | 模型、术语、联网及输出配置分别切换 | 用户配置实际生效，不因默认插件偷偷改变路线 |

每个实验记录：依赖版本／提交、环境、执行命令、输入、预期、实际输出、日志、限制、结论。无模型密钥也可以完成前几个实验。

## 选型时比较三条路线

| 路线 | 本项目可能获得的价值（待验证） | 需要证明的代价 | 采用条件 |
|---|---|---|---|
| Cordis + 自己的翻译业务层 | 可替换服务与依赖生命周期管理 | 打包、调试、任务取消及升级维护 | 小实验显示明显收益，业务逻辑与运行时可分开 |
| 完整 Harness + 翻译插件 | 可能复用模型、设置、界面或会话等已有模块 | 产品交互是否适合文档任务，是否引入过多 agent 概念 | 需要的模块确实减少工程量，且升级影响可控 |
| 普通模块化程序 | 显式组合，启动与调试路径较短 | 生命周期和依赖管理是否开始重复实现 | Cordis 收益尚不足时可作为基准或初期实现 |

倾向先验证第一条，并用第三条作成本基准；完整 Harness 是否值得采用，等实际复用点清楚后决定。这是本次工程建议，不是已完成的选型结论。

## 调研完成标准

能够说明“用了什么、解决什么、增加什么成本”，提供一个可重跑例子，并填写[运行时决策记录](../decisions/0001-runtime-selection.md)。同时完成 MVP 计划中的 PDF 译文注入实验，防止框架选定后才发现核心输出路线不可行。

本次资料核查仅覆盖上述官方页面，不代表重新验证原有 83 个候选。在线文档会更新；真正实施时固定依赖和相应文档版本。
