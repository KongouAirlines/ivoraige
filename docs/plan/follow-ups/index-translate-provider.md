# Index-Translate 官方 API 接入

- ID: index-translate-provider
- 状态: 待评估
- 实施分支／PR: 文档登记 codex/0.1.0-documentation；代码实现未安排
- 类型: 后续功能
- 发现依据: 2026-10-13 用户指定 bilibili/Index-Translate；已阅读官方 README 与 inference/llm/call_api.py，未调用模型
- 目标分支: main

## 问题与影响

学习者和兴趣翻译者希望直接选用官方免费公共 API，而无需自行运行示例脚本。官方[仓库](https://github.com/bilibili/Index-Translate)说明提供 OpenAI-compatible API，脚本使用 `https://index-translate.bilibili.com/v1`、默认模型 `Index-Translate-35B-A3B`，请求包含专用 User-Agent 与关闭思考参数，未要求 API Key。[脚本来源](https://github.com/bilibili/Index-Translate/blob/main/inference/llm/call_api.py)。以上为 2026-10-13 源码观察，免费政策、可用模型和接口稳定性以实施时官方说明为准。

## 处理条件与范围

本轮为文档整理，不加入业务代码。实施前重新核对官方接口、限流和使用条件，检查现有 DSH OpenAI-compatible 路由对免密、请求头、思考开关及返回 usage 的兼容性。优先提供商预设；存在实际契约缺口时用独立适配，不在翻译核心、CLI 或 WebUI 写模型特判。官方脚本是参考，不是引入额外 Python 运行环境的理由。

## 验收条件

- 用户可选择提供商、保存配置并通过现有内核完成翻译；不要求输入并不存在的秘密凭据。
- 正确处理响应、取消、失败和未知用量；默认测试使用 mock。
- 真实验证使用原创短样本，开始前明确授权与调用预算，不沿用已耗尽的 DeepSeek 预算。
- 冻结导出不调用该 API；移除该提供商不影响其他模型及文本流程。
- 同步能力表、设置指南和双语 README，验证前只列为规划。

## 处理记录

- 2026-10-13：完成官方脚本静态核对，未发起翻译请求。后续以独立代码 PR 实施。
