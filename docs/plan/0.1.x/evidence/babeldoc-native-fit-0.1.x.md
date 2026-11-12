# BabelDOC native fit integration evidence (0.1.x)

## Revision and purpose

Local verification on 2026-11-12 combines PR #95 head
`e75e7071d8a1ee399d6ba6e99728ca3c411dcb34`, main
`88820a05e953d5512ebe217820e6ed965aaf3668`, and the Pillow 13 source/frozen
runtime guard. This record describes the derived **0.7.1+ivoraige.3** candidate,
not a published binary or main-branch acceptance. Earlier `.1`/`.2` patches,
Pillow evidence and historical MinerU/license inventories remain unchanged.

The main-branch Python `fit-box-v1` wrapper cannot be imported by native 0.7.1:
its Python typesetting modules were removed upstream. A mechanical conflict
resolution would either fail to import or claim a layout policy that is not
executed. Upstream 0.7.1 preflight retains only the selected scale, losing a
successful expanded box; render can then reduce scale again.

The complete [`.3` patch](../../../../sidecars/babeldoc/patches/0.7.1/source-bridge-layout-fit-v1.patch)
retains the source bridge and underscore guard, and ports the fit behavior into
the actual Rust typesetting stage. Only successful box/scale pairs are kept.
Plans are local to a document invocation, keyed by page/paragraph indices and
consumed once. Reuse checks the current original box, selected scale, finite
expansion geometry, and current vertical/horizontal obstacles with upstream's
margins. It never caches placed text: native fitting runs again on current units.

The default upstream path remains opt-in: only `IVORAIGE_FIT_BOX_V1=1` enables
reuse. The sidecar scopes this flag together with
`IVORAIGE_ASCII_ALNUM_BASE_V1=1` around capture/replay and restores both afterward.
The package and native source, layout and underscore markers must match.
Capture binds `fit-box-v1` and `ascii-alnum-base-v1` to `.3`; replay rejects
0.6.4, `.1`, `.2`, missing markers and legacy policy combinations rather than
relabeling old snapshots. Readable records/MD/JSON and original-PDF copying remain.
The old Python policy modules are retained as labeled historical fixtures,
not imported by the current server or staged into new components.

## Executed verification

- **Actual Rust regression:** with URW NimbusSans-Regular metrics, preflight
  selected 0.6999999999999997. Baseline render reduced this to
  0.6499999999999997; the native port retained 0.6999999999999997 and the
  successful lower box edge at -20. Every rendered character remained within
  the resulting paragraph box in the fixture.
- **11 native tests passed** in debug mode with the flag absent, `1`, and `true`
  (only literal `1` enables it). The same 11 passed in optimized release mode
  with the flag absent and `1`. Cases cover changed original geometry, selected
  and real document-weighted scale changes, current lower/right obstacles,
  a blocker in the expanded vertical region, changed content requiring another
  fit, ordinary fit/no expansion space, malformed plans, failed preflight and
  per-document plan consumption. See the [exact font and commands](../../../../sidecars/babeldoc/patches/0.7.1/README.md).
- **44 sidecar tests passed**, preserving main's bounded iterative placeholder
  mapping, Counter optimization and regression cases. Runtime/policy rejection,
  exact frozen binding identity and restoration of both flags are covered.
  Two historical 0.6.4 installed-engine suites correctly skip in the `.3`
  environment; these skips are not counted as native algorithm evidence.
- **9 build tests passed**, including foreign-interpreter rejection, Pillow,
  Python and native-policy checks on reported frozen output, exact lock/build
  version agreement and source isolation. The isolation fixture includes a new
  file supplied by the recorded patch: `git apply --index` in the fresh clone
  ensures it participates in the exact patch comparison while dirty/untracked/
  ignored cache files remain excluded.
- **16 distribution-inventory and 4 release-archive fixtures passed.**
- **Node 26.13.0:** rebuilt the pinned DSH bundle and web assets; complete
  `npm run test:ci` passed 699 tests, with 22 platform/conditional skips.
  `npm run smoke:package` passed a real isolated install, same-version reinstall,
  data backup, saved settings, frozen/source exports, MCP and static UI.
  Node 24.22.1 compatibility run also passed 699 with 22 skips. These are local
  Linux runs, not a new GitHub Actions or Windows/macOS result.
- **Full runtime:** all 85 active lock entries matched installed versions in a
  fresh Python 3.13.5 environment. `uv pip check` passed all 90 packages including
  five build tools. Normal Pillow/imageio/scikit-image checks passed, including
  PNG/JPEG/TIFF, conversion/resize, imageio Pillow plugin, structural similarity
  and ordinary JPEG thumbnail. Pillow is 13.0.0 with libjpeg-turbo 3.2.0.
- **Actual new Linux wheel and frozen executable:** the exact-source recipe
  built `.3`; a fresh PyInstaller 6.22.3 one-directory sidecar was built from
  the new environment. The builder's real frozen-runtime probe, using an empty
  home and no PYTHONPATH/PYTHONHOME, returned Python 3.13.5, BabelDOC `.3`,
  PyMuPDF 1.26.7, Pillow 13.0.0, source bridge 1, `fit-box-v1` and
  `ascii-alnum-base-v1`. Frozen NDJSON handshake/shutdown passed. This is not the
  Windows component/asset build.
- Python compilation and `git diff --check` passed. Independent read-only
  review found no proven new correctness defect in the port and binding logic;
  it did not perform additional builds or real-PDF acceptance.

[Machine-readable installed versions and build provenance](babeldoc-native-fit-runtime-0.1.x.json)
record the current artifacts. Patch SHA256:
`690afea81e7ec402de70c71d3d04d9f5c180eb8ec527a4ce091798cbac954a8a`.
Wheel SHA256:
`6a3efbad90408b263382f45df53c5156ea25540168e2522bbf4a469527d89e61`.
Wheel filename:
`babeldoc-0.7.1+ivoraige.3-cp310-abi3-manylinux_2_34_x86_64.whl`.
The Rust/maturin baseline remains 1.99.1/1.15.0.

Ignored run outputs are in `evaluation/runs/native-layout-fit-0.1.x/` (native
source, tests, wheel/provenance) and `evaluation/runs/pdf-native-fit-0.1.x/`
(installed environment, frozen program, version/image/test/build logs).
The first Node run exposed the CI fixture's old count of three Python checks;
the fixture now checks all four exact commands once. A package-smoke attempt
using an unwritable default npm cache failed before installation; rerunning
with the workspace cache passed. These failures are not hidden as full passes.

## Integration preservation

Seven textual conflicts were reconciled in the local candidate:

- CI keeps main's triggers, concurrency and timeouts, both closure fixtures,
  one sidecar test invocation and the source/frozen-runtime build fixtures.
- Both READMEs retain MinerU, Markdown/link and mapping guidance, and describe
  the actual `.3` policies and explicit old-binding migration.
- THIRD_PARTY retains both native BabelDOC and MinerU notices.
- P08 retains the source/security work and P09 retains MinerU renderer evidence.
- Server/tests retain main's mapping improvements and main's build-interpreter
  guard, while replacing removed Python production hooks with native policies.

The kernel `src/` tree is unchanged from the checked main revision. No unrelated
main-branch functionality was discarded to take one conflict side wholesale.
A local integration candidate does not change PR #95's remote conflict status.

## Remaining acceptance and boundaries

No `.3` real-PDF capture/render/frozen replay or visual acceptance was performed:
the current test environment has no complete configured model/font/CMap assets.
The installed wheel exposes no standalone typesetting entry; the same synthetic
fit fixture runs directly against debug/release native source, not through the
Python wheel's full pipeline. The frozen probe proves loaded versions/markers
and protocol startup, not PDF rendering.

CJK layout and original-PDF comparisons, and geometry changes caused by the real
`render_page` adjustment rather than direct fixture mutation, merit further
regressions. The earlier documented CJK missing/garbled-line limitation is not
claimed fixed. No malicious JPEG regression was run; normal image checks are
not vulnerability exploitation evidence.

Windows/macOS native builds, complete assets, visual checks and redistributable
license closure remain unverified. Prior dependency-resolution constraints
(macOS ARM ONNX Runtime requiring macOS 14; no matching pinned Intel macOS
cryptography wheel) are not solved by this native patch. See the preserved
[Pillow/platform evidence](pillow-13.0.0.md). Linux glibc 2.34 wheel evidence is
not an assertion of official-wheel glibc 2.28 or other-platform compatibility.
