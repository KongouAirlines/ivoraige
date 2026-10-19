# 0.1.0 发行说明模板

本模板保留在 0.1.0 维护目录，供未来实际发行时按选定软件版本填写；不要把占位符作为 Release 发布。当前从源码运行，旧 Release 和附件已撤下，历史提交与旧版本身份保留；本地可构建 npm 包不等于已经恢复分发。Windows／PDF 新包仍须单独构建并验收。

## 来源与下载

- 软件版本及 tag：`v<version>`
- 精确源码提交：`<40-character commit SHA>`；源码链接：`https://github.com/KongouAirlines/ivoraige/tree/<commit SHA>`
- 源码与 npm tarball：`<source/archive or tarball name>`；大小：`<bytes>`；SHA-256：`<digest>`；只列本次实际生成并检查的产物。`npm run pack:npm -- <输出目录>` 会生成 `ivoraige-<version>.tgz` 和对应的 `ivoraige-<version>.build-evidence.json`，版本取自 `package.json`。
- Windows x64 便携包：`<asset name, bytes, digest>`；若本次没有构建和验收，明确写“未提供”，不引用旧预览附件冒充新版
- PDF 组件清单及归档：`<asset names and SHA-256 digests>`；仅列出本次确实上传并验证的文件；旧组件 tag 不随应用版本自动改动
- 指南：源码及 npm 包内的 `dist/web/pdf-guide.html` 可由工作台“设置 → PDF”打开，其他用户指南在 `docs/plan/0.1.0/`；Windows 包若实际提供，对应路径为 `app/dist/web/` 与 `app/docs/plan/0.1.0/`。在线源码链接若仍受访问控制，需相应仓库权限。

## 实际能力和限制

根据该 tag 的[能力表](capabilities.md)和真实构建结果列出已验证入口、平台与限制。区分基础包、可选 PDF 组件及模型服务联网。注明在线模型使用可能收费，实际费用由用户的提供商决定。未在对应产物中验证的源码能力不要写成已发布包能力。许可按该提交的 [LICENSE](../../../LICENSE) 及组件声明填写：当前核心 LGPL-3.0-or-later、列明的业务模块 MIT、BabelDOC Python 插件 AGPL-3.0-only。PDF 包还须完成实际依赖、资源通知和对应源码验收，不能用组件分包代替许可核对。

## 验证

对实际 npm tarball，填写 `npm run verify:release -- v<version> <对应的 .build-evidence.json>` 的结果；该命令还支持 Windows ZIP，但只在对应产物已构建、证据文件存在且 tag 指向相同的干净源码提交后运行。若发布 Windows ZIP，还要记录 Windows x64 上对实际解压包、组件安装、启动和 PDF 路径所做的检查。没有 Windows 新包时写明未构建、未验收；源码/npm 路径分别记录其实际检查，不能用 macOS 检查替代 Windows 验收。
