# BabelDOC 0.7.1 derived runtime

The active derived build is `0.7.1+ivoraige.3`, based on official
[v0.7.1](https://github.com/funstory-ai/BabelDOC/releases/tag/v0.7.1), commit
`d922e2b0c5a353bde8731921eb442c07ae75849d`.
`source-bridge-layout-fit-v1.patch` is a complete patch against that pinned tree;
it changes six existing files and adds two native regression files. It retains
upstream's AGPL license and keeps the native parser, layout, translation,
typesetting and writer. Its scoped changes are the source observer, ASCII
underscore guard and fit-box preservation described below.

`source-bridge-underscore-v1.patch` remains unchanged as the complete `.2`
source/build evidence. Do not apply both patches or relabel a `.2` wheel as `.3`.

The stock wheel removed Python `ILTranslator` and does not expose paragraph
identity to translator callbacks. Its Rust job includes page/paragraph indices,
but Python receives only text and token count. Identical requests at different
locations cannot be joined by text or callback order. Production stage capture
is disabled, and tracking JSON omits untracked entries and source coordinates.

The opt-in `ivoraige_source_inventory` translator method receives every styled
paragraph before translation. Each callback's `rate_limit_params.ivoraigeSource`
contains bridge version, page-array/paragraph indices, exact prepared input and
upstream placeholder payload JSON. The sidecar resolves these indices within
the current part's inventory to actual page and box; it never guesses callback
order. The native module exposes `ivoraige_source_bridge_version = 1` so a stock
wheel or mismatched build fails before capture. Ordinary translators without the
observer do not receive the added metadata. No LLM-only path is enabled.

### Scoped ASCII underscore line guard

The Rust `paragraph_finder.rs` guard first shipped in the `.2` patch. The sidecar opts in
only for its capture/replay engine call with `IVORAIGE_ASCII_ALNUM_BASE_V1=1` and
restores the prior environment on exit. Other BabelDOC callers retain native
0.7.1 line splitting unless they explicitly opt in. The native splitter uses
the neighboring glyphs' visual y range only for a low `_` between adjacent
ASCII letters or digits with the same XObject, font, size and nominal baseline. It also
requires compatible horizontal spacing, finite geometry and overlapping letter
ink. It leaves source glyphs, coordinates, composition order and rendering
untouched; all other characters follow upstream splitting. A new capture records
`underscoreLinePolicy: ascii-alnum-base-v1` alongside the derived engine version.

The `.1` wheel and bindings remain unchanged. Because the line policy can
change paragraph segmentation and requests, translated-PDF replay refused `.1`
bindings under `.2` before opening the source. The `.3` runtime additionally
exposes `ivoraige_underscore_line_policy = "ascii-alnum-base-v1"`; this marker
attests the compiled implementation, while the environment variable selects it.

### Native fit-box preservation

`IVORAIGE_FIT_BOX_V1=1` opts into the `.3` native `fit-box-v1` implementation.
`Typesetting::process` snapshots that exact environment value once for the
invocation; an unset variable or any other value retains native `.2` behavior.
The native module exposes `ivoraige_layout_fit_policy = "fit-box-v1"`, alongside
`ivoraige_source_bridge_version = 1` and the underscore marker. The sidecar
requires the derived version and all three markers before claiming these
policies in a binding. Its engine scope sets and restores the environment.
There is no Python typesetting monkeypatch in this implementation.

The native dry run now returns the successful trial box together with its scale.
It does not mutate the paragraph box. A process-local map, keyed by the stable
page/paragraph indices, keeps only successful finite geometry. Render consumes
each plan once, after native paragraph-position adjustment. Reuse requires the
original box to be unchanged, the selected scale still to match the dry run
(within `1e-9`), and expansion only downward and/or rightward. It rechecks the
native current-obstacle limits with the original margins (`+2` bottom, `-5`
right), including the expanded vertical region when checking rightward space.
A missing/stale plan or failed space check falls back to the existing engine.

Only geometry is reused. The original native layout runs again over all units,
including its overflow checks, shrink loop, English fallback and rendering.
Document-wide scale selection is unchanged; a plan is not reused if that policy
changed its scale. Plans are discarded on return or failure and cannot survive
into another document or run. The `.3` wheel changes render behavior, so old
`.1`/`.2` bindings are not silently replayed under it. Re-import and explicitly
reconcile accepted revisions; never edit a stored binding's version or policy
marker.

### Native regression recipe

The complete `.3` patch includes `rust/p2_stages/tests/ivoraige_layout_fit.rs`
and `rust/p2_stages/src/stages/typesetting_tests.rs`. Run from a fresh pinned
upstream clone after applying the `.3` patch:

```sh
export IVORAIGE_TEST_FONT=/path/to/NimbusSans-Regular.otf
cargo test --locked --manifest-path rust/p2_stages/Cargo.toml --test ivoraige_layout_fit -- --nocapture
IVORAIGE_FIT_BOX_V1=1 cargo test --locked --manifest-path rust/p2_stages/Cargo.toml --test ivoraige_layout_fit -- --nocapture
IVORAIGE_FIT_BOX_V1=true cargo test --locked --manifest-path rust/p2_stages/Cargo.toml --test ivoraige_layout_fit -- --nocapture
```

Unset `IVORAIGE_FIT_BOX_V1` for the first command. The test font is URW Base35
Nimbus Sans Regular OTF; it is a test input, not included in the patch or wheel.
The observed Linux font SHA-256 was
`7c25be4d78155523080ab85b10277150657ff7dabbcad7037bdd536c9b6d0d08`.
Use Rust 1.99.1 and the locked dependencies. Add `--offline` if the Cargo cache
is already complete. The standalone integration target compiles the production
typesetting source and exercises its private helpers with real font metrics and
IR writes. It avoids enabling the whole library's `cfg(test)`, because the
pinned upstream release omits other declared upstream unit-test modules; no
placeholder tests or stub modules are generated.

Observed locally: all 11 tests passed in each of the three environment modes
under the debug test profile, and all 11 also passed with `cargo test --release`
with the variable unset and set to `1`.
The original heading fixture (width 70, height 24, available bottom -22) gives
native preflight `0.6999999999999997`, baseline render `0.6499999999999997`, and
opted-in render `0.6999999999999997`. Tests check actual output glyph bounds,
normal fit, no expansion space, changed content still undergoing native fit,
changed original geometry, native document-wide scale selection, current
bottom/right obstacles, combined-axis obstacle checks, malformed plans,
unsuccessful preflight, plan consumption and cross-document isolation.
These are native synthetic regressions, not real-PDF visual acceptance. The
installed production wheel exposes the full `MDocument.run_part` pipeline, not
a standalone typesetting-stage method. The same synthetic fixture was therefore
not replayed through the installed Python wheel; no test-only public API or
simulated full-PDF pipeline was added. Wheel construction and installed/frozen
runtime identity checks are separate evidence from native layout correctness.

### Bounding-box contract

The native observer preserves nullable IR fields rather than fabricating
coordinates. The sidecar accepts only the configured fresh-PDF production
pipeline and requires four finite bounding-box coordinates at this observation
point. `sourceUnicode: null` is allowed for retained non-callback
structure; `bbox: null`, an omitted box, or a partially populated box is not.
Such an inventory fails explicitly, including when the source text is empty.
It must not be silently dropped, assigned a zero box, or matched by text/index
as a substitute for a geometric source location. Native callback eligibility
does not imply that a box is present, so a missing box is not evidence that a
paragraph will remain uncalled.

In the inspected pinned source paths, the parser starts with no paragraphs;
paragraph finding assigns boxes before whitespace removal, and split paragraphs
receive an initial box. The inspected styles code and real fixtures did not
establish a boxless case. This is not proof that every styles/formula path or
every PDF preserves a box. Strict rejection is the sidecar's existing contract,
not a reproduced boxless-PDF defect. Arbitrary prebuilt IR is not supported.
See the [source trace and regression evidence](../../../../docs/plan/0.1.x/evidence/babeldoc-0.7.1.md#bounding-box-contract-review).

### Build

Build with `scripts/build-babeldoc-runtime.py` using Rust 1.99.1, maturin 1.15.0
and Python 3.13. The recipe creates a fresh clone of the exact upstream Git tree, applies only
the selected complete patch with `git apply --index`, and compares the exact
resulting `git diff --binary HEAD` with that patch, including added regression
files. It excludes tracked worktree changes and untracked/ignored cache files
without deleting the cache, uses
Cargo's locked dependencies, and writes wheel/patch provenance with all three policy markers. Python runtime
pins remain in `requirements.lock`; the active closure also retains the Pillow
13.0.0 security update. No wheel is committed or published here. Preserve the patch, upstream
license, corresponding source/build recipe, Python dependency notices and
native Cargo SBOM when preparing an independently reviewed distribution.

The Linux development build is `cp310-abi3-manylinux_2_34_x86_64`, not the
unmodified official wheel's `manylinux_2_28` baseline. Windows/macOS builds and
complete native dependency license coverage remain separate release gates.
