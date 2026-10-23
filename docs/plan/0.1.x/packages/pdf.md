# PDF 与独立分发工作包

[执行索引](../work-packages.md) · [领域契约](../../../requirements/0.1.x/contracts.md#解析翻译输出三份独立契约) · [验证索引](../validation.md)

## P06

MinerU parse-only：结构、图片/表格/公式资源、来源版本与通用查看/原文导出。

- 不做：不装翻译作为隐式依赖，不要求目标语言/accepted，不承诺 PDF 译文重建。
- 验收：[P06 专项](../validation/pdf.md#p06)，并通过 [V05](../validation.md#v05)。
- 回退：禁用插件保留产物/配置/历史；旧兼容阅读可用，重新解析显式建新来源。

## P07

第二个真实同类来源插件接入，另保留小型二进制/耗时 fixture。

- 不做：fixture 不冒充真实第二引擎，不追加主体/前端引擎名单。
- 验收：[P07 专项](../validation/pdf.md#p07)，并通过 [V06](../validation.md#v06)。
- 回退：移除新插件并重启；如需改主体则契约验收失败，回到 P03/P04 重审。

## P08

按实际包追踪 AGPL 直接/传递依赖、代码、原生库、模型/字体资源；拆核心和 PDF 归档/清单。

- 不做：不仅移动 Python 文件或改 LICENSE，不宣称进程隔离自动解决许可。
- 验收：[P08 专项](../validation/pdf.md#p08)。
- 回退：暂停新二进制分发，保留源码使用；不恢复旧不完整附件。

## P09

同一确认译文分别走各自兼容解析/重建，检查质量与成本。

- 不做：不接跨引擎，不由导出再调用翻译，不默认替换 BabelDOC。
- 验收：[P09 专项](../validation/pdf.md#p09)。
- 回退：保留现有 BabelDOC，MinerU renderer 独立禁用；失败不修改已接受内容。

## P10

独立 many-to-many 来源映射、版本和兼容 renderer 验证。

- 不做：不把都输出 PDF 当作兼容，不按文本相同自动复用。
- 验收：[P10 专项](../validation/pdf.md#p10)。
- 回退：不发布映射能力，继续各自同引擎重建；原 binding/快照不变。
