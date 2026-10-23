# 0.1.0 npm 就绪准备

这是基础候选的工程验收清单，不是 npm 上架安排。状态仍在[工作包表](../0.1.x/work-packages.md)，版本范围见[基础规划](foundation-plan.md)。本次只核查源码和既有 CI，没有发布、创建凭据、运行新安装或查询 registry 所有权。

## 已有能力与尚未证明的部分

2026-10-20 核查：[package.json](../../../package.json) 为 `0.1.0`、`private: true`、当时 Node >= 24，声明 `ivoraige` bin；[打包脚本](../../../scripts/pack-npm.mjs)复制 manifest 到暂存目录，运行 `npm pack --ignore-scripts` 并记录归档证据，没有执行 publish。npm 格式 tarball 和 GitHub 附件不等于 npm registry 发布。按照 [npm package.json 文档](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/)，`private: true` 阻止发布；本轮保留此保护。

2026-10-22 已将运行范围收紧为 `>=24.22.1 <25 || >=26.12.1 <27`，Windows 便携构建固定 `26.12.1`；后续候选沿用[Node 安全基线](node-security.md)，上述历史核查不代表仍接受未修复版本。

[现有 smoke](../../../scripts/smoke-package.mjs)在隔离目录安装实际 tarball，并直接以 Node 调用已安装的 `src/cli.mjs`，验证持久化和冻结输出；这证明一部分安装链，不证明用户通过 bin shim 或 npm exec 启动成功。[CI](../../../.github/workflows/kernel-smoke.yml)配置为 Windows/Linux/macOS 的 Node 24.22.1，另含 Windows Node 26.12.1 的测试和包 smoke，不能将其描述成“三系统安装从未测试”。拆包以后仍须针对新产物重跑。

| 准备项 / 归属 | 验收证据 | 当前缺口与处理边界 |
| --- | --- | --- |
| 包身份与版本，Q04/P05 | 明确核心/插件名称、独立版本、engines、license、exports/bin、文件清单及文档来源；未来发布前确认 registry 名称/版本可用性与维护权限 | registry 可用性、所有权和权限未核实；不假定 `0.1.0` 可覆盖。正式发布是另行决定，本轮不改 private、不创建 token |
| 可重复归档，P05/P08 | 干净源码构建后从实际 tarball 检查运行模块、文档、声明资源、来源提交和完整依赖；无 `.git`/vendor 缓存环境可安装 | 不能以源码目录、tree shaking 或 package.json 的 files 列表替代最终包检查 |
| 真实命令入口，P04/P05 | 三系统受控临时环境安装 tarball 后实际调用 bin shim/适用的 npm exec；help、首次启动、错误退出、数据目录与停止均验证 | 现有直接 Node 调用 smoke 保留，补足 shim/exec 路径；不要求现在全局安装 |
| 最小宿主与插件，P05 | 无 PDF/Python、无翻译插件可启动/诊断；独立安装、缺件、不兼容、失败恢复、重启与旧配置保留 | AppBoot/Loader 负责装配，P05 负责交付事务；不另建加载器。V04/V04a 与同一实际包对应 |
| 发布安全，Q01/Q02/Q03、P01/P02 | 快照受理/释放、参数错误、退出顺序、旧记录与配置兼容、冻结零翻译；诊断与归档不含凭据或私有评测材料 | 对基础包实际提供的能力收口，不能以桌面后置推迟共同正确性问题 |
| 许可证及 PDF，P08 | 核心包无应属独立 PDF 的代码/库/资源；独立 PDF 包实际闭包、源码/构建材料、通知和资源出处完整 | 旧 Windows/PDF 的 F-B/P2 阻塞相应二进制分发；不能不检查产物便将其泛化为纯 Node 包的全部阻塞，也不能据此豁免 Node 包自己的许可核验 |
| 使用与维护说明，Q04/P05 | README 双语、随包指南、兼容范围、安装/移除/恢复和未提供功能与真实产物一致 | 历史 Release 证据按时点保留，不让用户从撤下的附件获得必要依赖 |

通过上述准备只说明候选具备可复查的发布条件。npm 发布、公开版本选择、认证方式和发布渠道必须在将来的明确发行任务中决定；[npm publish 文档](https://docs.npmjs.com/cli/v11/commands/npm-publish/)规定已发布的名称与版本组合不能重复使用，不能靠覆盖历史版本解决候选命名冲突。

失败时保留上一完整 tarball、运行时元组和兼容配置，不上传半成品。已发生的数据迁移按[迁移矩阵](../0.1.x/migration-distribution.md)恢复；仅降 npm 包版本不构成数据回退。未通过 PDF 门禁时不交付该 PDF 包，基础包可否独立交付由它自己的实际闭包和验收决定。
