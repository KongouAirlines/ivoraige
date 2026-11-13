# BabelDOC source plugin

Optional, independently installed PDF source and frozen-output bridge for ivoraige
host API 1. It registers source `babeldoc` (binding schema 1) and output `pdf`.
This independent package is version `0.1.1`; both adapters report `0.1.1`.
The host-bundled BabelDOC adapters remain `0.1.0` and cannot be mounted
alongside these same-ID adapters.
It shares the host's pinned DSH/Cordis runtime and obtains the NDJSON transport
through `ivoraige.sidecarFactory`; `ivoraige.storePath` owns managed sources.
No translation provider, model context, or credentials are passed to rebuild.

This MIT package contains only the JavaScript bridge and text validator, adapted
from ivoraige's MIT PDF adapter. It contains **no Python runtime, native engine,
models, fonts, or DSH/Cordis copy**. Prepare the independently managed
BabelDOC `0.7.1+ivoraige.2` runtime and its NDJSON server/assets first. Stock
BabelDOC 0.7.1 is not equivalent: the derived runtime includes the separately
versioned source-location bridge and narrow opt-in ASCII underscore line policy.
This plugin enables no native policy itself; the matching sidecar scopes it to
capture/replay. Runtime license/resource closure and binary
redistribution remain separate P08 work.

## Configuration and activation

Stop the host before installation. Use the host's local package delivery entry:

```sh
node src/plugin-install.mjs install /absolute/profile /absolute/plugins/babeldoc \
  '{"storePath":"/absolute/data/records.sqlite","config":{"directory":"/absolute/data/pdf","command":"/absolute/runtime/bin/python","args":["/absolute/runtime/sidecars/babeldoc/server.py"],"modelDirs":{"babeldoc":"/absolute/assets"},"timeoutMs":600000}}'
```

The profile is loaded through the existing `settingsDir` option on `createApp`.
Both `install` and `enable` must receive the same top-level `storePath` as the
host will use at activation. The installer does not infer a database from saved
plugin configuration. `directory` is the managed PDF resource root; preserve it with the database when backing up or
moving a store. Runtime caches must be writable in the chosen environment. Existing parent-path
aliases (such as macOS `/var`) are canonicalized. The managed root itself and
its `sources` directory/files must not be symlink escape routes.
Do not put a different `storePath` in plugin configuration: the host's canonical
store path is authoritative. The package does not download anything or prepare
native dependencies. A missing executable/assets is reported when selected;
TXT and other installed engines remain available.

Disable, re-enable or remove with the same stopped profile and package name:

```sh
node src/plugin-install.mjs disable /absolute/profile @ivoraige/babeldoc-source
node src/plugin-install.mjs enable /absolute/profile @ivoraige/babeldoc-source \
  '{"storePath":"/absolute/data/records.sqlite"}'
node src/plugin-install.mjs remove /absolute/profile @ivoraige/babeldoc-source
```

Changes take effect at restart. Disabling/removal does not delete the record
store or managed PDF resources. Keep those resources for saved documents.

## Compatibility and limits

- Keep legacy `pdf` / installed `components` configuration on the original host
  path, or use this package alone. Mounting both registers `babeldoc` twice and
  fails explicitly; there is no silent replacement or automatic migration.
- Documents and unfinished tasks pinned to an independent `0.1.0` adapter are
  not silently relabeled as `0.1.1`. Keep the old package available to finish
  them, or explicitly reimport with `0.1.1` and reconcile accepted revisions.
  Saved snapshots remain readable, but source projections and PDF replay still
  require a compatible installed adapter and binding. The package version,
  adapter version, binding schema 1, and engine version are distinct identities.
- New captures and translated replay require the exact derived engine version
  `0.7.1+ivoraige.2`, matching `captureConfig.babeldoc`, and
  `captureConfig.underscoreLinePolicy: ascii-alnum-base-v1`. Missing or different
  policy values are rejected. Existing `.1` and 0.6.4 bindings are never relabeled.
  Their original-file source PDF and already saved frozen MD/JSON artifacts remain
  readable without invoking the new runtime. A new MD/JSON export still needs
  the compatible source projection adapter. Translated PDF requires its compatible
  renderer/runtime. To use `.2`, explicitly reimport the original and manually
  reconcile units and accepted revisions; there is no automatic revision migration.
- The unchanged protocol is NDJSON JSON-RPC 2.0, protocol 1. Imports need no
  target language or translation provider. English and Chinese source-language
  constraints and placeholder validation retain their previous semantics. The
  server omits `captureConfig.sourceLanguage` for English and preserves the exact
  `zh`, `zh-CN` or `zh-Hans` value for Chinese; internal engine routing does not
  change this stored identity.
- MD/JSON use the source's readable projection. PDF output consumes frozen
  revisions and only its own source binding. No MinerU-to-BabelDOC mapping is
  supported. Two engines can share one store with explicit adapter selection.
- The original mixed synthetic PDF exposed BabelDOC CJK source loss/garbling
  and MinerU table-header/caption quality failures. Successful plugin routing
  or two manually accepted translated headings does not establish PDF quality.

## 中文摘要

此包是独立的 MIT JavaScript 来源/输出桥接，来源 ID 为 `babeldoc`，输出
ID 为 `pdf`，binding schema 与 sidecar protocol 均保持 1。通过宿主的
`sidecarFactory` 与权威 `storePath` 工作，不附带 Python、引擎、模型、字体
或另一份 DSH/Cordis。须另行准备 `0.7.1+ivoraige.2` 派生运行时及资源，不能
将官方原版 0.7.1、旧 `.1` 或 0.6.4 改标签冒充兼容。新捕获与译文 PDF
要求精确版本和 `underscoreLinePolicy: ascii-alnum-base-v1`；旧 binding
原件 PDF 与已保存的冻结 MD/JSON 产物仍可读；重新导出 MD/JSON 需兼容的来源
投影 adapter。使用 `.2` 重建旧文档须显式重导入原件并人工
对齐单元及接受修订，不自动迁移。此同步不表示 #80 已修复或已验收。

独立包与两个 adapter 的版本均为 `0.1.1`，宿主内置 adapter 仍为 `0.1.0`，
同 ID 不可同时挂载。旧独立 `0.1.0` 所固定的文档及未完成任务不会自动改写为
`0.1.1`；需保留旧包完成，或显式重导入并对齐已接受修订。包、adapter、binding
schema 与引擎版本分别管理。

停止宿主后使用上述本地安装命令，重启启用。`install` 和 `enable` 都必须
在命令的 JSON 参数顶层传入与宿主一致的 `storePath`，不会从已保存配置猜测数据库。旧 `pdf/components` 路径与新包
二选一；同时挂载会明确拒绝重复注册。禁用/移除只更改插件，保留数据库与受管
PDF。导出只消费冻结快照，不调用翻译模型；跨引擎 PDF 重建仍不支持。该包的
接线与生命周期验证不代表宽泛的 PDF 质量或跨平台二进制分发验收。

## Live verification tools

The opt-in `test/babeldoc-live.mjs` verifier also requires an already installed
Poppler `pdftoppm` executable on PATH for same-snapshot rendered-page comparison.
The separate output-text inspection uses `pdftotext`. This Linux evidence used
`pdftoppm` 26.05.0 and `pdftotext` 25.03.0. These are verification prerequisites,
not bundled plugin dependencies; the test does not install them. See the repository evidence record at
`docs/plan/0.1.x/evidence/babeldoc-source-p07-ivoraige2.md` for the network-denial wrapper,
runtime paths and remaining quality failures.
