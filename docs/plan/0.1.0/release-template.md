# 0.1.0 发行说明模板

本模板供下一次实际发行填写；不要把占位符作为 Release 发布。

## 来源与下载

- 软件版本及 tag：`v<version>`
- 精确源码提交：`<40-character commit SHA>`；源码链接：`https://github.com/KongouAirlines/ivaraige/tree/<commit SHA>`
- Windows x64 便携包：`<asset name>`；大小：`<bytes>`；SHA-256：`<digest>`
- PDF 组件清单及归档：`<asset names and SHA-256 digests>`；仅列出本次确实上传并验证的文件
- 指南：下载包内的 `app/dist/web/pdf-guide.html`，或启动工作台后在“设置 → PDF”打开；其他用户指南在 `app/docs/plan/0.1.0/`。在线源码仓库若仍为私有，访问链接需要仓库权限。

## 实际能力和限制

根据该 tag 的[能力表](capabilities.md)和真实构建结果列出已验证入口、平台与限制。区分基础包、可选 PDF 组件及模型服务联网。注明在线模型使用可能收费，实际费用由用户的提供商决定。未在附件中验证的源码能力不要写成已发布能力。

## 验证

填写 `npm run verify:release -- v<version> <build-evidence.json>` 的结果，以及在 Windows x64 上对实际解压包、组件安装、启动和 PDF 路径所做的检查。若测试只在 macOS 上运行，明确写出 Windows 验收仍未执行。
