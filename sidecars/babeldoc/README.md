# BabelDOC PDF sidecar

`server.py` implements the v2 protocol's NDJSON JSON-RPC 2.0 methods
`handshake`, `configure`, `parse`, `rebuild`, and `shutdown`. It writes protocol
messages only to stdout; engine logs and tracebacks go to stderr. Run it with
the explicit Python command printed by `scripts/setup-pdf.ps1`. That setup
script installs the pinned package versions into an ignored project runtime after
you build the **0.7.1+ivoraige.2** derived wheel using
[`scripts/build-babeldoc-runtime.py`](../../scripts/build-babeldoc-runtime.py);
it also runs BabelDOC `--warmup` to prepare the default asset cache. Use
`scripts/setup-pdf.ps1 -CheckOnly` to verify versions and required assets
without downloading. Ordinary PDF tasks never install packages or download
assets. The main npm package excludes this Python plugin. Use the source checkout
and setup script for development; the separate PDF component includes this
plugin source and lockfile. Project-owned files here use **AGPL-3.0-only**;
see [LICENSE](LICENSE) and [COPYING](COPYING). Upstream libraries and assets
retain their own licenses.

`configure.modelDirs.babeldoc` names the existing BabelDOC asset cache root
(containing `fonts`, `cmap`, `tiktoken`, and `models`). Optional
`configure.modelDirs.doclayout-yolo` overrides the model file. Missing assets
return `COMPONENT_MISSING`. Set `configure.options.workDir` to a writable
per-project directory for BabelDOC's cache and worker files. The source PDF and its managed SHA-256 are owned
and validated by the Node kernel. The sidecar accepts a `sourcePath` in the
frozen `sourceBinding` and checks every location and exact engine request again
at replay.

The stock official 0.7.1 wheel is not compatible with location-safe replay.
The [versioned bridge patch](patches/0.7.1/README.md) adds a read-only paragraph
inventory and exact native callback identity; parser resource limits remain enabled.
Old 0.6.4 and `0.7.1+ivoraige.1` bindings fail translated-PDF replay explicitly. Re-import and reconcile
accepted revisions; do not relabel or mutate old snapshots. Existing readable
projections and original-PDF copying remain available. See the
[build/migration guide](../../docs/plan/0.1.x/babeldoc-0.7.1.md).

`parse` accepts a declared English or Simplified Chinese native-text PDF and optional one-based `pages` and
`minTextLength`. It returns units in BabelDOC paragraph order, exact callback
requests, and a binding with page/bounding-box/request records. BabelDOC IL
paragraphs that did not reach callbacks become nontranslatable passthrough
units. A separate PyMuPDF line audit retains extractable text outside the IL
paragraph inventory, or text overlapping an IL box without a matching source
segment, as passthrough units and emits a coverage warning. This
audit does not prove that image-only text or formula semantics were recovered.
The line audit renders flagged superscript spans as Unicode superscripts where
possible (otherwise `^(text)`) and retains `rawExtractedText` for comparison.
Structural placeholders retain the upstream prepared-input payloads carried
by native source metadata, associated by page/paragraph indices within the
observed pretranslation inventory and then by the saved source location. A unique literal alignment supplies readable display text
when available. Otherwise a formula uses BabelDOC's `formula_chars`, paired
rich-text tokens use an empty display, and unknown tokens remain visible as
literal tokens. Capture records page, location and token warnings for fallback
displays. Missing or changed native prepared input, identity or bridge version fails
closed; the callback's source location remains mandatory. Legacy payload
projection helpers remain for historical records and tests.

`rebuild` takes a frozen `docRef` JSON containing the binding and a
`revisionsRef` JSON with units in `{unit, decision, text}` form. `text` is the
accepted BabelDOC engine projection, including any preserved placeholders.
The readable text for MD/JSON is a deterministic expansion through
`placeholders[*].text`. Legacy null or missing displays retain the visible
token for diagnostics. The sidecar checks the exact token sequence against the
original engine request regardless of saved display mappings. Callback units use an accepted revision
or a `skip` decision that replays the exact source request. Passthrough units
must retain their original text and `keepOriginal` decision.
Replay lets BabelDOC apply its own text processing, including punctuation
shortening. Extracted-text checks include expanded formulas but are informational:
a mismatch appears in export evidence as unverified and calls for visual review.
Page-level extraction also cannot prove position, clipping or reading order.
The sidecar rejects missing, duplicate, changed, or unused engine requests.
Mono PDF is the supported format; bilingual
PDF needs separate validation.

Each capture or replay removes its own BabelDOC `run-N` working directory after
the result has been copied out. The session cache stays available to subsequent
requests. The Node host allocates a private directory for each sidecar process
under the configured work root (OS temp by default). It waits for process exit
before removing that directory, including after cancellation or a crash. The
configured root and unrelated files are preserved. Killing the Node host itself
or losing power can still leave files; historical cleanup is not implemented.

Before constructing a layout inference session, the sidecar disables ONNX
Runtime telemetry. Python socket connect/connect_ex remain loopback-only for
imports, configuration and execution. This is not a native OS network sandbox.
The Linux acceptance helper `scripts/pdf-offline-linux.py` additionally denies
network syscalls within the test process tree without changing host settings.
Native-text English-to-Chinese replay has been tested with original synthetic
PDFs; image-only scans fail without OCR. Retained original CJK lines can still
be missing or garbled in the upstream PDF output, with text-check warnings;
see [the observed limitation](../../docs/plan/follow-ups/babeldoc-native-cjk-replay.md).
