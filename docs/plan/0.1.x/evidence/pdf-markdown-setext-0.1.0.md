# 0.1.0 PDF Markdown 等号行回归

#77 的 `f9d4b15` 仅转义无缩进的纯等号行。锁定 marked 18.1.1 与 JSDOM 独立复现：正文 `Literal\n ===` 及2、3空格变体被识别为setext一级标题，等号不再可见。0和4空格的基线仍可见，不能把它们也描述成复现失败。

修复仅限PDF的字面Markdown输出，覆盖0–4个前导空格的纯等号行，保留缩进与等号。通用Markdown适配器和PDF引擎不变。

新增测试通过模拟PDF sidecar、临时Cordis SQLite、实际冻结MD/JSON导出和锁定marked/JSDOM检查：正文没有额外标题，五个边界的可见字符与JSON一致，产物共享快照，模型调用0。修复前1–3空格失败，修复后PDF/Markdown/export定向30/30；完整npm test（含构建）547通过、2跳过、0失败。跳过项为发行输入检查和Windows专属进程树检查。diff检查通过。

没有真实PDF引擎、模型或OCR调用。修订后的各最终堆叠head仍需Mac实机验证；先前其他head的测试不能替代本次验证。本修复不恢复表格、图片、缺失内容或准确标题级别。
