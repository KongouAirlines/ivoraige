# Pillow 13.0.0 PDF runtime security review

Date: 2026-11-12. Branch: `fix/0.1.x-pillow-security`, based on #95 head
`e75e7071d8a1ee399d6ba6e99728ca3c411dcb34`. Main inspected:
`88820a05e953d5512ebe217820e6ed965aaf3668`. This is a dependency repair,
not a completed main integration or three-platform PDF acceptance.

## Confirmed risk and reachable paths

The real installer/build input `sidecars/babeldoc/requirements.lock` pins
Pillow 12.3.0 on both inspected heads, independently of BabelDOC's version.
[GHSA-8g5g-8vmr-9782](https://github.com/python-pillow/Pillow/security/advisories/GHSA-8g5g-8vmr-9782)
affects Pillow through 12.3.0; 13.0.0 is fixed. Its particular overflow needs
an 8-bit SOF3 lossless JPEG, libjpeg-turbo >=3.0, and reduced decoding requested
by `draft()` (normally via default `thumbnail()` before load). Ordinary full
loading or loading before resize does not follow that trigger path.

The inspected BabelDOC 0.7.1 Python source has no PIL, thumbnail or draft call.
`raster_geometry._render_rgb` uses PyMuPDF's `get_pixmap` and NumPy samples;
`rust_scan_service` uses OpenCV grayscale conversion and scikit-image's
structural similarity. PyMuPDF's Pillow helpers are explicit conversions and
were not called on that inspected path. BabelDOC does not import imageio's
Pillow reader. The derived patch changes Rust and package metadata, not these
Python calls. These observations establish a vulnerable dependency version,
**not a demonstrated PDF-input exploit** and not proof that all native,
indirect or future paths are safe. No malicious image or PDF was executed.

The [Pillow 13 release notes](https://pillow.readthedocs.io/en/stable/releasenotes/13.0.0.html)
cover other security fixes too. We do not equate a Dependabot alert count with
independent advisories or claim that the entire dependency closure is safe.

## Changes

- Upgrade the active lock to Pillow 13.0.0; no other runtime pin changes.
- Validate loaded PIL in sidecar preflight and Windows setup, returning
  COMPONENT_MISSING for an unexpected version before PDF work.
- Validate Python 3.13 and Pillow in the build host and in the **actual frozen
  executable** through `--runtime-versions`, alongside BabelDOC/PyMuPDF.
  Old output without the probe, or output reporting old dependencies, cannot
  pass the reuse gate merely by copying a newer lock into its archive.
- Include the derived wheel directory in the Windows build helper's install.
- Add normal-image API checks and regressions for stale/missing frozen
  metadata, old Pillow and a non-3.13 Python build/probe.

NDJSON v1, accepted records and the native source-binding identity are unchanged.
The native patch remains `.2`. Existing installed binaries require rebuilding;
editing source does not patch an installed component.

## Installation and compatibility evidence

A fresh Linux x86_64 CPython 3.13.5 environment installed the 85 exact runtime
pins with the rebuilt derived wheel; `uv pip check` passes. The separate
[version inventory](pillow-13.0.0-runtime.json) lists actual runtime and build
packages. Key versions: BabelDOC 0.7.1+ivoraige.2, PyMuPDF 1.26.7, Pillow 13.0.0,
scikit-image 0.26.0, imageio 2.38.0, NumPy 2.5.3, SciPy 1.18.1; loaded
libjpeg-turbo 3.2.0. Preliminary resolution used stock BabelDOC 0.7.1 with
identical dependency metadata; final installation replaced it with the real
derived wheel before final probes.

Pinned BabelDOC requires scikit-image >=0.25.2. Installed scikit-image requires
Pillow >=10.1 and imageio requires Pillow >=8.3.2, without excluding 13.0.0.
Pillow 13 removed Python 3.10 support, consistent with our existing 3.13 baseline.
The manual API check uses inferred array modes and 8-bit data, avoiding removed
mode-based datatype reinterpretation and signed 32-bit PNG saving. Normal
PNG/JPEG/TIFF encode/decode, conversion/resize, imageio's Pillow reader,
structural similarity and ordinary JPEG thumbnail all pass. This does not
exercise every optional format or prove real-PDF fidelity.

Cross-platform **wheel resolution only**, using the full pinned closure with
stock BabelDOC 0.7.1 as its metadata-equivalent resolver input, Python 3.13,
`uv pip compile --only-binary :all:` against PyPI:

- Windows x64 resolves; Pillow has a CPython 3.13 win_amd64 wheel.
- Apple Silicon macOS 14 resolves. macOS 13 does not: pinned ONNX Runtime 1.30.0
  supplies its ARM64 wheel for macOS 14+, not 13.
- Intel macOS does not resolve the pinned wheel-only closure: cryptography
  50.0.1 has no matching wheel; ONNX Runtime's listed macOS wheel is ARM64.
  Pillow itself has both Intel and ARM64 wheels. These are pre-existing closure
  limits, not failures caused by changing Pillow.

These resolver checks do not build the derived Windows/macOS wheel, install or
execute on those systems, or establish that a source-build fallback works.

## Rebuild and regression results

The existing isolated source recipe rebuilt official BabelDOC revision
`d922e2b0c5a353bde8731921eb442c07ae75849d` with Rust 1.99.1 and maturin 1.15.0.
Rust release compilation finished in 2m40s. Patch SHA-256:
`86bc93914f6b6ff655d710bf685aca26a70afdf9a7c201e3bb9ca98843ff1294`.
Wheel: `babeldoc-0.7.1+ivoraige.2-cp310-abi3-manylinux_2_34_x86_64.whl`.
Wheel SHA-256: `39f18f9c2758fb882e9868b0ff29ba31ce5c0a5cfe6f1cbe3a2bf066810ffabf`.
This is a newly executed build, not a relabeling of the earlier `.1` evidence.

- Sidecar regressions: 32 passed.
- Source-isolation/frozen-dependency/build-baseline fixtures: 7 passed.
- Node PDF/entry/routing/smoke-helper suites: 33 passed on Node 24.22.1 with
  the existing pinned DSH bundle. No full Node suite or Node 26 CI claim.
- Image API checks, actual source-runtime version probe, Python compilation
  and `git diff --check` passed.
- Linux PyInstaller 6.22.3 rebuilt an onedir sidecar in about 61 seconds. The
  builder's actual executable probe passed in an isolated temporary home,
  reporting Python 3.13.5, BabelDOC 0.7.1+ivoraige.2, PyMuPDF 1.26.7 and
  Pillow 13.0.0. NDJSON handshake/shutdown passed. No model assets were
  configured, so this is not complete package/PDF acceptance. Optional hidden
  import warnings remain in its build log; those optional paths were not tested.

Run with the installed runtime's Python:

```sh
python -m unittest discover -s sidecars/babeldoc -p test_server.py
python -m unittest discover -s test -p build_babeldoc_runtime_test.py
python scripts/check-pdf-image-runtime.py
python sidecars/babeldoc/server.py --runtime-versions
```

Local ignored logs, generated wheels and probes are in
`evaluation/runs/pillow-security-0.1.x/`; no binary, model or private PDF is
committed. The image script is a manual runtime check, not a new CI job.

## Main integration remains blocked

A three-way merge against main 88820a0 reproduces seven conflicted paths:
`.github/workflows/kernel-smoke.yml`, `README.md`, `README.zh-CN.md`,
`THIRD_PARTY.md`, `docs/plan/0.1.x/work-packages.md`,
`sidecars/babeldoc/server.py`, and `sidecars/babeldoc/test_server.py`.

The CI resolution must retain main's timeouts/inventory fixtures and add the
source-build fixtures. Documentation must retain MinerU, current PDF export
behavior, license distinctions and P09 evidence, alongside the native bridge
and security update. These are not reasons to discard either branch.

The server conflict is semantic, not merely textual. Main's `fit-box-v1`
Python typesetting fix is not present in the pinned 0.7.1 native implementation:
its dry-run retains scale but loses the expanded box, so replay can shrink again.
The old Python ILTranslator/Typesetting/ParagraphFinder modules cannot be
imported into the new native pipeline. The underscore patch already uses a
separate native `ascii-alnum-base-v1` policy, extending the same-baseline guard
to ASCII digits.

A mechanical merge also combines main's legacy policy-writing configuration
with the new native invocation: it can record `fit-box-v1` / `ascii-base-v2`
without actually applying those policies. Retaining main's old invocation
instead collides with the new no-argument `underscore_line_scope` and imports
removed modules. The integration must explicitly port layout behavior, reconcile
capture policy labels and tests, and preserve source-binding compatibility.
No conflict-only merge is claimed or published by this dependency repair.

Fixed-source locations: native `typesetting.rs` saves only `optimal_scale`
at lines 1544–1546, uses a local copy of the paragraph box at 1372, writes
expanded boxes only for `apply=true` at 1435–1437/1447–1449, and retries from
the original box at 1505–1507. See the
[pinned native implementation](https://github.com/funstory-ai/BabelDOC/blob/d922e2b0c5a353bde8731921eb442c07ae75849d/rust/p2_stages/src/stages/typesetting.rs)
and [main's layout repair](https://github.com/KongouAirlines/ivoraige/blob/88820a05e953d5512ebe217820e6ed965aaf3668/sidecars/babeldoc/layout_fit.py).
This is source-path evidence; no native layout reproduction was run in this
security stage. Main's engine-specific tests still target 0.6.4 or removed
Python modules, so they need migration rather than deletion or relabeling.

## Historical evidence and remaining acceptance

`docs/plan/0.1.x/evidence/mineru-live-requirements.txt` and older PDF license
inventories describe historical environments. They remain unchanged and are
not installation inputs. No alerts are closed by rewriting those snapshots.

Windows PowerShell/native/PyInstaller execution and macOS packaging have not
been tested. Selected real-PDF capture, rendering, scanned-page behavior and
frozen replay remain manual acceptance in the upgraded environment. A source
build, version probe, image test or green CI cannot replace those checks.
Existing CJK/layout-quality findings are not resolved by this dependency fix.
P08 remains in progress pending integration and applicable platform/quality gates.
