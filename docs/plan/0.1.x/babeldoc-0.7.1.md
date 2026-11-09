# BabelDOC 0.7.1 derived runtime

## Scope and migration

The optional sidecar now requires **BabelDOC 0.7.1+ivoraige.1**, a source build
of official 0.7.1 with a small, versioned source-location bridge. This is not
compatibility with the unmodified official wheel. The native parser's default
resource limits remain enabled. BabelDOC 0.7.0 fixed the disclosed stream
expansion and CMap expansion resource-exhaustion issues affecting 0.6.4 and
earlier; this change does not claim that every possible PDF is safe.

- [Upstream release](https://github.com/funstory-ai/BabelDOC/releases/tag/v0.7.1)
- [Stream advisory](https://github.com/funstory-ai/BabelDOC/security/advisories/GHSA-h972-phhq-7368)
- [CMap advisory](https://github.com/funstory-ai/BabelDOC/security/advisories/GHSA-wrv8-h9rp-6fqq)
- [Patch contract and source](../../../sidecars/babeldoc/patches/0.7.1/README.md)

The NDJSON protocol remains v1. Records, accepted revisions, frozen snapshots,
managed originals and existing readable Markdown/JSON projections are retained.
Old 0.6.4 source bindings are **not** passed to the upgraded renderer. A translated
PDF replay returns an explicit version error and leaves the old records intact.
Re-import the original with the upgraded engine, then explicitly reconcile its
units and accepted revisions against the retained document. Do not rewrite an
old binding's version string: segmentation, locations and placeholders may
change. Source-mode PDF export still copies the verified managed original.

## Build and setup

Prerequisites: Git, Python 3.13, Rust **1.99.1**, a platform C/C++ linker, uv,
and maturin **1.15.0**. Install build tools from their official sources. Build
inside an isolated project directory, without provider keys or a private corpus.

```sh
uv venv evaluation/runs/babeldoc-runtime-0.7.1/.venv --python 3.13
uv pip install --python evaluation/runs/babeldoc-runtime-0.7.1/.venv/bin/python --index-url https://pypi.org/simple maturin==1.15.0
evaluation/runs/babeldoc-runtime-0.7.1/.venv/bin/python scripts/build-babeldoc-runtime.py
uv pip install --python evaluation/runs/babeldoc-runtime-0.7.1/.venv/bin/python --index-url https://pypi.org/simple --find-links evaluation/runs/babeldoc-runtime-0.7.1/wheels -r sidecars/babeldoc/requirements.lock
```

On Windows use `Scripts/python.exe` instead of `bin/python`; prepare the wheel
first, then `scripts/setup-pdf.ps1 -WheelDir <wheel-directory>`. That helper
installs the full lock and prepares assets; `-CheckOnly` verifies the derived
package version, native bridge marker and asset presence. The Windows builder
has been updated but has not been run for this derived version. Do not reuse a
0.6.4 PyInstaller output. No release binaries are provided by this change.

The tested Linux wheel requires glibc 2.34 or newer. The official wheel's glibc
2.28 requirement does not apply to this local build. A reproducible manylinux
release container and Windows/macOS packaging require their own acceptance.
Node and DSH remain on the repository's existing baseline.

## Execution boundaries

Capture returns source text and native request identity, with no translation
model. Replay consumes only the frozen accepted text, validates exact request,
location, token sequence, used-record set and callback count, and never obtains
an LLM. Native exceptions may be swallowed by upstream; independent sidecar
error tracking prevents a partially untranslated output being treated as a
successful accepted replay.

Source paragraphs must retain four finite bounding-box coordinates, including
non-callback structure. A missing or null box is an explicit unsupported
inventory error, not a passthrough classification. The inspected pinned native
paths and tested fixtures retained boxes; this does not establish that all
styles/formula paths or PDFs do so. Arbitrary prebuilt IR is not accepted.
Null source text alone remains supported for non-callback structure.

ONNX Runtime telemetry is explicitly disabled before the layout module is
imported or any inference session is created. Python `connect` and `connect_ex`
are restricted to loopback throughout engine import, setup and execution.
This is not an OS-wide native network sandbox. Linux acceptance additionally
uses `scripts/pdf-offline-linux.py`, a child-process seccomp network-deny filter, inherited by its descendants;
it does not change host firewall settings. Strong deployment isolation on each
platform remains a separate operator/container concern.

Only native-text PDFs are supported. Image-only scans produce no translation
callbacks and fail explicitly; OCR is not enabled. Source coverage, text checks
and layout warnings must be inspected. Successful processing is not proof of
full translation, intact equations, complete reading order or unclipped text.

## 中文摘要

本版本使用官方 0.7.1 源码加两个只读观察钩子的派生运行时
`0.7.1+ivoraige.1`，不是原样官方 wheel。Rust 的安全解析限额保持启用；
翻译前记录完整段落位置，回调按明确页/段落身份绑定同一冻结译文，不按
原文相似度或回调顺序猜测。ONNX 原生遥测在创建 session 前禁用。

包括未进入翻译回调的结构段落在内，来源必须保留四个有限数值的边界坐标。
缺失或 null 的 box 明确报不支持的 inventory，不能据此推断为保留原文项、
填零或猜测位置。已检查的固定源码路径和实测样例保留了坐标，但不代表所有
styles/formula 路径或 PDF 都如此。不接受外部预制 IR；未调用段落的原文
为 null 仍可按既有规则保留。

旧 0.6.4 绑定不能交给新 renderer；旧文档、修订、快照及可读 MD/JSON
不会被改写。需重新导入原件，再人工核对新分段并迁移接受译文，不能只
改版本字段。来源模式的 PDF 原件复制保留。扫描件没有 OCR 时明确失败。

构建需 Python 3.13、Rust 1.99.1、maturin 1.15.0 与平台链接器；先运行
上述源码构建脚本，再用 `--find-links` 安装 lock。已测 Linux 构建基线为
x86_64/glibc 2.34；Windows/macOS、完整原生依赖许可闭包与二进制发布
尚需单独验收。当前只交付源码与构建配方，不发布二进制包。

实际测试与资源数据见[阶段证据](evidence/babeldoc-0.7.1.md)。
