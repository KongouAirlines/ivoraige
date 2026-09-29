# M0 样本目录与来源

日期：2026-09-29。候选线索来自[科研翻译系统可行性分析](https://chatgpt.com/c/6aa80fe3-afa0-83e8-b038-41478f3374cf)新增的科学双语材料推荐。聊天中的引用编号不能作为可访问来源，以下区分本次核实与仍待核实的内容。

材料准备更新：9份原件保留于 `evaluation/private/originals/`，已有导入登记直接复用。核心R01／R02已核实实际来源并固定24个对齐单位（R01为12段对，R02为12句子／短语义单位）；R03固定PDF第1／2／4页。当前清单 `m0-corpus-002` 已落实用户反馈；001出版摘录快照保留，未做整批逐条签认。详见[M0交付报告](../plans/m0-completion-report.md)。后备材料未因此自动视为核实。

## 核心与后备材料

| ID／层次 | 材料 | 原文入口与核实内容 | 中文参考及取得状态 |
|---|---|---|---|
| R01 核心 | *The Scattering of Electrons by a Single Crystal of Nickel*；C. Davisson、L. H. Germer | [Nature 原刊](https://www.nature.com/articles/119558a0)：119，558–560（1927），DOI 10.1038/119558a0 | 原刊首页对应；单篇中文为杨威生译、北大学报38卷增刊（2002年），文集第1卷为王静另一译本（ISBN978-7-5600-9091-7）；采用文集EPUB12段对，非单篇PDF全文对齐 |
| R02 核心 | *The Feynman Lectures on Physics*, II，第 36 章 *Ferromagnetism* | [Caltech 全章](https://www.feynmanlectures.caltech.edu/II_36.html)：可核对 36–1、36–2、36–3、36–6 等小节 | 采用套装EPUB第II卷新千年版选段；书名页见李洪芳／王子辅／钟万蘅译、上海科技出版社，目标小节已核。检查的前置页未见独立版权页或ISBN，不推定为9787547816370；两份PDF不作为本轮对齐依据 |
| R03 核心／无正式对照 | *The design and verification of MuMax3* | [作者 arXiv 记录](https://arxiv.org/abs/1406.7635)、[MuMax3 官方仓库](https://github.com/mumax/3)；论文 DOI 10.1063/1.4899186；2014 年 | 实件为arXiv:1406.7635v3（2014-07-10），32页；第1／2／4页已作原图版面核对。未取得正式中译本，不计双语质量集 |
| R04 后备 | *A New Type of Secondary Radiation*；C. V. Raman、K. S. Krishnan | [Nature 原刊](https://www.nature.com/articles/121501c0)：121，501–502（1928），DOI 10.1038/121501c0 | 已收到 Nature 文集候选，尚待核对是否包含目标论文；[外研阅读同一分册](https://iyc.unipus.cn/book/detail/4449)已核实目录项 |
| R05 后续迁移 | 费恩曼讲义 II，第 37 章 *Magnetic Materials* | [Caltech 全章](https://www.feynmanlectures.caltech.edu/II_37.html)已核实 | 与 R02 采用同一中文版本，固定小节后再配对 |

论文页数来自原刊起止页，并不表示整页都属于该论文。原刊页面／文集目录核实不等于具备 PDF 下载权或电子文本导出能力；本轮没有购买、登录或尝试绕过访问限制。

R02 英文入口为Caltech网页，中文选段采用已核章节的EPUB派生文件（仍由MinerU解析）；工具页序与EPUB内部路径作定位，不冒充纸书页码。不能把网页打印 PDF 当作原版教材排版基准。实际 PDF 若是扫描件，记录为 OCR 扩展测试；翻译质量可先用人工核对的文本块，二者分别统计。

## 保留的扩展候选

以下内容仅记录新增聊天中的推荐，未作本轮独立书目核验，不作为当前已就绪材料。

| ID | 候选 | 建议阶段与范围 | 待核实 |
|---|---|---|---|
| R06 | Peter Atkins，*The Laws of Thermodynamics: A Very Short Introduction*／《简说热力学定律》；聊天给出 ISBN 9787311066833 | M3 后先选一节，再决定是否做整书压力测试 | 中英版本、目录、实际篇幅和电子文件形式 |
| R07 | Richard P. Feynman，*QED: The Strange Theory of Light and Matter*／《QED：光和物质的奇妙理论》；聊天给出 ISBN 9787571000141 | 检查解释性文字和比喻，选 2～4 页对应内容 | 版本、图文关系、可配对范围 |
| R08 | Stephen J. Blundell，*Magnetism: A Very Short Introduction*／《简说磁学》 | 量子磁学、自旋相关选章；不以聊天中的页码直接冻结 | 中文版权页与目录、中英选段对应 |
| R09 | *Experimental Proof of the Spin of the Photon*；聊天 DOI 10.1038/129022a0 | 后续短文留出候选 | 原刊元数据、中译卷册与正文位置 |
| R10 | *The Angular Momentum of Light*；聊天 DOI 10.1038/128545a0 | 后续微型对照候选 | 原刊元数据、中译卷册与正文位置 |

## 本地登记规则

原件及包含出版译文的对齐文本放在 `evaluation/private/`，运行输出放在 `evaluation/runs/`；两者默认不加入 Git。公开目录保存来源元数据、项目原创工程样本和不包含大段原文的评审摘要。忽略规则只是避免误提交，不构成使用许可；具体文本按取得版本的条件使用。

下方是可选登记模板，已有记录直接复用，只补当前任务需要的字段。哈希可引用导入清单，没有实际用途时留空，不反复计算。未取得的信息保持空值，不能把候选状态写成 ready。

```json
{
  "sample_id": "R01",
  "corpus_version": null,
  "status": "awaiting_files",
  "source_url": "https://www.nature.com/articles/119558a0",
  "source_edition": null,
  "reference_edition": null,
  "source_file": null,
  "reference_file": null,
  "source_sha256": null,
  "reference_sha256": null,
  "source_format": null,
  "source_locator": null,
  "reference_locator": null,
  "acquisition_and_use_note": null,
  "reviewer": null
}
```

每个对齐单位再记录 `pair_id`、双方独立定位、源文本块 ID、参考块 ID、对齐类型、dev／heldout 划分、允许上下文、公式／图注关联和人工校核状态。未配对段落单独记录原因；中英分段不同时允许多对多，不强求页码或段号一致。
