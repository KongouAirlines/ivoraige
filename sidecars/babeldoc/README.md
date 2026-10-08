# BabelDOC PDF sidecar

`server.py` implements the v2 protocol's NDJSON JSON-RPC 2.0 methods
`handshake`, `configure`, `parse`, `rebuild`, and `shutdown`. It writes protocol
messages only to stdout; engine logs and tracebacks go to stderr. Run it with
the explicit Python command printed by `scripts/setup-pdf.ps1`. That setup
script installs the pinned package versions into an ignored project runtime;
it also runs BabelDOC `--warmup` to prepare the default asset cache. Use
`scripts/setup-pdf.ps1 -CheckOnly` to verify versions and required assets
without downloading. Ordinary PDF tasks never install packages or download
assets. The npm package includes this source and setup instructions, not a
Python executable, wheel set or asset cache.

`configure.modelDirs.babeldoc` names the existing BabelDOC asset cache root
(containing `fonts`, `cmap`, `tiktoken`, and `models`). Optional
`configure.modelDirs.doclayout-yolo` overrides the model file. Missing assets
return `COMPONENT_MISSING`. Set `configure.options.workDir` to a writable
per-project directory for BabelDOC's cache and worker files. The source PDF and its managed SHA-256 are owned
and validated by the Node kernel. The sidecar accepts a `sourcePath` in the
frozen `sourceBinding` and checks every location and exact engine request again
at replay.

`parse` accepts an English native-text PDF and optional one-based `pages` and
`minTextLength`. It returns units in BabelDOC paragraph order, exact callback
requests, and a binding with page/bounding-box/request records. BabelDOC IL
paragraphs that did not reach callbacks become nontranslatable passthrough
units. A separate PyMuPDF line audit retains extractable text outside the IL
paragraph inventory, or text overlapping an IL box without a matching source
segment, as passthrough units and emits a coverage warning. This
audit does not prove that image-only text or formula semantics were recovered.
The line audit renders flagged superscript spans as Unicode superscripts where
possible (otherwise `^(text)`) and retains `rawExtractedText` for comparison.
Structural placeholders retain completed upstream tracker payloads, associated
by source location. A unique literal alignment supplies readable display text
when available. Otherwise a formula uses BabelDOC's `formula_chars`, paired
rich-text tokens use an empty display, and unknown tokens remain visible as
literal tokens. Capture records page, location and token warnings for fallback
displays. Missing or changed tracker input contributes no payload and is
reported as a warning; the callback's source location remains mandatory.

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
