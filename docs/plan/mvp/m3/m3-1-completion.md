# M3-1：固定环境与 BabelDOC 适配边界

日期：2026-09-30。此项完成的是原创控制 PDF 上的独立环境与注入边界；真实科研代表页、来源快照与完整覆盖属于后续步骤。

- 项目环境位于已忽略的 `evaluation/runs/m3-1/.venv`，通过 `experiments/pdf-injection/m3.ps1 setup` 建立。Python 3.13、官方 BabelDOC 0.6.4、PyMuPDF 1.26.7 和其余解析依赖记录在 `requirements.lock`。首次自动选择的 PyMuPDF 1.28.2 在重建期间报告保存错误，因此固定为 1.26.7。没有修改全局 pdf2zh／Zotero 环境或 vendor 源码。
- `adapter.py` 在专用进程内以 `BaseTranslator` 消费已有记录，只对该进程的 `ILTranslator.translate_paragraph` 加位置上下文。键明确采用零基页码与 x、y、x2、y2 三位小数；实际请求文本再作完全相等检查。随机 `debug_id` 只留诊断。自动术语提取、自动 OCR 与 LLM 翻译路线关闭，记录译文不经正文模型。
- M1 的原创两页 `original-control.pdf` 与 `accepted.json` 直接复用。新环境捕获 7 条请求，其位置键和请求文本与 M1 的 7 条完全一致。成功回放的 7 条目标文本均在指定 PDF 页被抽取到；重复英文句在两页分别出现“外加磁场改变磁化方向。”和“施加的磁场使磁化方向发生变化。”，未串页。适配器回调 7、正文模型请求 0、LLM 能力不可用、BabelDOC 翻译缓存命中 0。结果见 `evaluation/runs/m3-1/replay-clean/published/evidence.json`。
- 移除一条接受记录后实际重跑，回调失配被记录且进程退出 1；`evaluation/runs/m3-1/missing-record/published` 不存在。上游产生过临时 PDF，也没有被适配器报作正式成功。补充检查了输入清单中的重复位置、未接受状态、未消费记录与 PDF 目标文本缺失均会阻止发布。

运行文件只在 `evaluation/runs/m3-1/`，已沿用仓库忽略规则。Windows 子进程的 BabelDOC 缓存目录也设在本次运行目录，复用本机已有布局模型、字体与 tiktoken 资产，不覆盖它们。适配器的 `published/` 是控制样本验证产物，不代表科研 PDF 已完成翻译。

已知限制：M1 控制样本中的独立短词 `We` 仍未进入 BabelDOC 翻译回调；7/7 回放不能证明源文覆盖。此问题留给 M3-2 的实际页覆盖核对。PDF 文字抽取只验证文字与页码，控制样本排版沿用 M1 已有目视结论；本次没有新增真实页或完整科学签认。位置键只在同一原件、固定版本与解析配置下经验证，源文或配置变化须重建绑定。
