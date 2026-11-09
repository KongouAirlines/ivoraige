# BabelDOC 0.7.1 source-bridge evidence

Date: 2026-11-09. Branch: `codex/0.1.x-babeldoc-0.7.1`, based on main
`6a5e1df20437c6c3c2cfa9c10aeff17ad4724d94`. Implementation:
`38e685e` (tree `67b52db7ce2475eda068b9f317b0879359eef3b0`).
This is source-level runtime migration evidence, not a binary release or a
complete P08 distribution acceptance.

## Verified upstream boundary

Official BabelDOC v0.7.1 is commit
`d922e2b0c5a353bde8731921eb442c07ae75849d`. Its PyPI Linux wheel is
`cp310-abi3-manylinux_2_28_x86_64`, supports Python 3.10–3.13, and declares
`AGPL-3.0`. PyMuPDF remains 1.26.7 (AGPL/commercial); ONNX Runtime remains
1.30.0. The 85-line Python runtime lock changes only BabelDOC. Installing the
stock 0.7.1 with that closure and `uv pip check` succeeded before building the
derived runtime. No 0.6.4 installation or adversarial resource-exhaustion
fixture was used.

The former Python `ILTranslator` is absent. In stock 0.7.1,
[`spawn_request`](https://github.com/funstory-ai/BabelDOC/blob/v0.7.1/rust/p2_bridge/src/ordinary_translation.rs#L1945-L1977)
knows page/paragraph indices, but Python gets text and token count only.
The production wheel reports `stage_capture_enabled() == False`. Completed
tracking filters out untracked entries and lacks source coordinates; neither
callback order nor duplicate text provides a safe location join.

The derived package `0.7.1+ivoraige.1` applies the [four-file patch](../../../../sidecars/babeldoc/patches/0.7.1/source-bridge-v1.patch):
a package version, native bridge marker, pretranslation read-only inventory,
and callback identity/prepared-input/placeholder metadata. No parser, layout,
normalization, typesetting or writer implementation is replaced.
`disable_parser_resource_limits=False` remains explicit.

## Build and provenance

- Python 3.13.5, Rust 1.99.1, maturin 1.15.0; official GitHub/PyPI/Rust sources.
- `maturin build --locked --release` succeeded. The committed build recipe also
  successfully rebuilt from the same pinned checkout and exact patch.
- Patch SHA-256: `08a816eef6d42b268d7d16c1b6f9a0066a2ab49d4cf0e3e8df32ea16a32be986`.
- Recipe wheel SHA-256: `d7e8210da97013b790fec384e2c2f213e2535a68d43927199a4b3ad08d0ff7c7`.
- Actual development wheel: `cp310-abi3-manylinux_2_34_x86_64`. It does **not**
  inherit the official wheel's glibc 2.28 baseline. Windows and macOS derived
  builds were not run. No binaries, assets, provider credentials or private
  corpus are committed.
- The wheel retains upstream AGPL text and a 126-component Cargo CycloneDX
  SBOM. Full Rust dependency notice/corresponding-source distribution review
  remains a release gate; an SBOM is not all license texts.
- Isolated runtime directory: about 786 MiB including the build-only maturin;
  Rust toolchain about 593 MiB, Cargo cache about 166 MiB, compiled target about
  414 MiB. These are local installed sizes, not download/package guarantees.

## Assets

The selected 34 fonts + 146 CMaps total 273,513,046 bytes, downloaded from
BabelDOC-Assets GitHub revision `1eeeec2a63b05fe6fe7a1f45f0955a8fa98793c4`.
The official ONNX model revision `ee7c3d744e5c47c58e267044ac825f95abe69653`
is 75,324,598 bytes. The o200k_base encoding came from its official OpenAI URL.
All 182 files match 0.7.1's embedded SHA3-256 checksums; total
352,451,566 bytes (336.12 MiB), downloaded in about 141 seconds in this run.
Existing asset family notices are retained and the identity audit updated in
[asset status](../../../../sidecars/babeldoc/asset-licenses/ASSET-LICENSE-STATUS.md).
No general bandwidth/timing guarantee is inferred.

## Acceptance and decisions

Only original synthetic PDFs were used. The paired input SHA-256 values are:

- mixed: `e0b949bc0c1f9532d1cfca41c1e235ff0a0b0db3894eb4239b5ee1360e575d1f`
- scan: `3bcf4870fe96bbb38ce8da11a37dd70aa5f99099f6a864b64a03b7e8a2f590f2`

The paired mixed test accepts exactly:

- `Synthetic Research Note: Water-Saving Crops` → `合成研究笔记：节水作物`
- `Abstract` → `摘要`

All other translatable units use explicit `skip`, which replays their source
text. Nontranslatable layout/audit units use `keepOriginal`. This matches the
MinerU renderer's actual `onMissingAccepted: 'skip'` invocation and exported
JSON, rather than using the prose phrase “keep original” as a wire enum.
Both paired exports use target `zh`. Their segmentation is different; this
is not a cross-engine source-binding mapping or a complete-document translation.

- mixed: 26 units = 13 callbacks and 13 retained units; final frozen decisions
  are 2 revisions, 11 skips, 13 keepOriginal. Capture, manual acceptance,
  PDF/MD/JSON export, restart, subsequent edit and old-snapshot replay passed.
  Total measured wall time 27.14 s; maximum child RSS 1,127,496 KiB (~1.08 GiB).
- Formula fixture from `scripts/pdf-formula-sample.py`: 14 units, two pages,
  four copies of the same source sentence accepted as four location-specific
  Chinese texts. Replay preserved every distinct position through restart and
  a later edit. Total wall time 26.17 s; maximum child RSS 1,258,544 KiB
  (~1.20 GiB). Native formula payloads were retained for `=` placeholders.
- scan: upstream explicitly rejected it with “The document contains no
  paragraphs.” No OCR, accepted export or success artifact was claimed.
  Measured wall time 5.05 s; maximum child RSS 939,656 KiB (~918 MiB).
- Every successful export/replay reported **0 translation model requests**.
  No provider was configured. MD/JSON replay bytes match; rendered PDF pixels
  match on all three native-text pages. The four repeated Chinese texts were
  checked at their own page and bounding-box neighborhood, not just by
  page-wide membership.

Commands are retained in `scripts/pdf-babeldoc-acceptance.mjs` and
`scripts/pdf-offline-linux.py`. The ignored run root is
`evaluation/runs/babeldoc-0.7.1/`: paired output `accepted-mixed-5/`, formula
`accepted-formula/`, scan rejection `accepted-scan-3/`; resource/visual reports
and source/wheel/asset provenance are alongside them.

## Network and verification limits

An initial smoke without OS network confinement was excluded from network
acceptance evidence after the native ORT telemetry boundary was identified.
The implementation disables ORT telemetry before the layout module is imported
and before creating an inference session. Python connect/connect_ex are guarded
across engine import/configuration/execution. For acceptance, a Linux seccomp
filter denies connect/sendto/sendmsg/sendmmsg in the child process tree; its
localhost connection denial was checked before running the engine. No host
firewall or global network setting was changed. This Linux verification helper
is not a claim of full native network isolation in every production deployment.

- Python sidecar preflight/regression suite: **26/26 passed** (including old
  binding refusal before source access, required derived/native version,
  duplicate-text inverse callback order, invalid identity and socket guard).
- Full Node suite on existing Node 24.22.1 compatibility runtime: **561 passed,
  2 skipped, 0 failed**. DSH/Node pins and npm dependency closure are unchanged.
  The default Node 26.13.0 CI runtime was not installed for this local run.
- Package smoke passed: isolated install/reinstall, complete data backup,
  frozen snapshots and original exports, saved settings, MCP and static UI.
- Python files compile, `uv pip check` passes and `git diff --check` is clean.
- PowerShell setup and Windows PyInstaller scripts were revised but not run.
  Complete three-platform native distribution and broad corpus quality are
  not established by these tests.

## Visual failures retained

The new Chinese title and abstract, English columns, table and equation are
visible in mixed. However, its existing Chinese subtitle and concluding line
are missing or garbled in both the **unmodified official 0.7.1 identity run**
and the derived sidecar. The stock probe calls `high_level.translate` with an
identity `do_translate`, without ivoraige bindings, keepOriginal handling or
native bridge. This localizes the observed failure outside the new binding
adaptation; the precise font/CID/writer cause remains unproven.

The derived text checks correctly retain two warnings. Those lines remain in
records/MD/JSON; output success and pixel repeatability do not prove PDF content
completeness. See [babeldoc-native-cjk-replay](../../follow-ups/babeldoc-native-cjk-replay.md).
The formula fixture also repeats upstream's documented long-punctuation
shortening, with one text warning; formula symbols and all four distinct
accepted Chinese positions were visually inspected. These limitations are not
fixed by changing accepted text or inserting a substitute renderer.


## Build-source review correction

A source review found that checking only `git diff HEAD` in a reusable source
cache allowed untracked/ignored Python or `.cargo/config.toml` files to become
build inputs. The build recipe now clones only the pinned Git objects into a
fresh temporary checkout, applies the exact patch there, and builds there with
a separate target cache. It never cleans or incorporates the original cache's
worktree changes. Two new regression tests cover injected untracked/ignored
inputs, dirty tracked input, preservation of the cache, and rejection of a
wrong upstream HEAD; both pass and are included in CI. This isolates source
trees, not a claim of a hermetic host compiler/toolchain environment.

The runtime/parser patch and tested sidecar behavior are unchanged from the
implementation evidence above. Windows component source recipes also retain
the repository-relative scripts/patches layout they require; Windows binary
packaging remains unverified.


The corrected recipe completed an actual isolated release build in 55.47 s
with the existing dependency cache. Its wheel SHA-256 is
`983e4f0ffe4a55bf83b714c95723fe97e2712146022ee5b36e490ec1dfa56d2c`.
After reinstalling that wheel, the offline formula acceptance again passed:
14 units, four distinct repeated-source locations, frozen replay after restart
and subsequent edit, zero model calls, 24.57 s. This run is retained at
`evaluation/runs/babeldoc-0.7.1/accepted-formula-isolated/`; the earlier paired
mixed artifacts and measurements above remain evidence of the unchanged
native bridge/sidecar implementation, not of this later wheel byte hash.
