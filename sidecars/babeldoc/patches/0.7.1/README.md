# BabelDOC 0.7.1 source bridge v1

This is an explicit derived build, `0.7.1+ivoraige.1`, based on official
[v0.7.1](https://github.com/funstory-ai/BabelDOC/releases/tag/v0.7.1), commit
`d922e2b0c5a353bde8731921eb442c07ae75849d`. The patch retains upstream's AGPL
license and changes four files. It does not replace or weaken the PDF parser,
layout analysis, translation normalization, typesetting, or writer.

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
the checked patch, excludes tracked worktree changes and untracked/ignored cache
files without deleting the cache, uses
Cargo's locked dependencies, and writes wheel/patch provenance. Python runtime
pins remain in `requirements.lock`; only BabelDOC changes from the previous
closure. No wheel is committed or published here. Preserve the patch, upstream
license, corresponding source/build recipe, Python dependency notices and
native Cargo SBOM when preparing an independently reviewed distribution.

The Linux development build is `cp310-abi3-manylinux_2_34_x86_64`, not the
unmodified official wheel's `manylinux_2_28` baseline. Windows/macOS builds and
complete native dependency license coverage remain separate release gates.
