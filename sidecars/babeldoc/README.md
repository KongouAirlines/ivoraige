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
Structural placeholders retain upstream payloads; their display strings are
derived only when exact source alignment has one solution. Unresolved display
mappings remain null and require review.

`rebuild` takes a frozen `docRef` JSON containing the binding and a
`revisionsRef` JSON with units in `{unit, decision, text}` form. `text` is the
accepted BabelDOC engine projection, including any preserved placeholders.
The readable text for MD/JSON is a deterministic expansion through
`placeholders[*].text`. The sidecar checks the exact token sequence and fails
if a display mapping remains unresolved. Callback units use an accepted revision
or a `skip` decision that replays the exact source request. Passthrough units
must retain their original text and `keepOriginal` decision.
It rejects missing, duplicate, changed, or unused engine requests and publishes
the PDF only after all checks pass. Mono PDF is the supported format; bilingual
PDF needs separate validation.

Each capture or replay removes its own BabelDOC `run-N` working directory after
the result has been copied out. The session cache stays available to subsequent
requests. The sidecar attempts to remove the session cache on exit, though an
open Windows cache database can leave files behind. Forced process termination
or power loss can also leave a session directory behind because normal cleanup
cannot execute in those cases.
