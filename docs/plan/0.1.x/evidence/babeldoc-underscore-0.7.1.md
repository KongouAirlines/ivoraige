# BabelDOC 0.7.1 ASCII underscore line regression

Date: 2026-11-09. Candidate branch: `codex/0.1.x-babeldoc-0.7.1-underscore`,
based on the source-bridge branch at `da3328c`. This adds a source patch to the
official 0.7.1 tree and identifies the derived runtime as
`0.7.1+ivoraige.2`. The earlier `0.7.1+ivoraige.1` acceptance remains historical
evidence for that exact runtime; it is not rewritten as a test of this change.

## Mechanism and bounded change

An original PyMuPDF Helvetica PDF contained visible standalone `X_Y` and `X-Y`.
Input SHA-256 was
`f773a187c34c68bce4a3c4e7082130ed6198a2679a5f134ecf1d8df286b079e1`.
The unchanged `.1` runtime captured `X Y_` and created a separate audit-only
`X_Y`; `X-Y` remained unchanged. An isolated diagnostic build from the pinned
official source plus the unchanged `.1` source bridge logged the actual native
`paragraph_finder::split_lines` input `X_Y`: visual y bounds were
X=(662.0, 670.616), `_`=(660.5, 661.1), Y=(662.0, 670.616), and the native
line slots became `["XY", "_"]`. The error occurs before formula grouping.
Trace: `evaluation/runs/babeldoc-underscore-0.7.1/native-stage-trace.log`.

The `.2` source patch retains the four-file native observer/request-identity
bridge and adds one scoped Rust paragraph-finder change. When the sidecar opts
in for capture or replay, a low `_` between adjacent ASCII letters or digits
borrows the neighboring glyphs' effective y range solely for line
classification. The guard requires one explicit XObject, same font and positive
size, matching finite nominal baselines, finite neighboring ink overlap, and
bounded horizontal spacing and low-ink offset. It leaves glyph data, nominal
and visual boxes, render order, formula grouping and the upstream splitter
otherwise unchanged. The environment opt-in is restored after normal exit or
error; ordinary BabelDOC callers do not activate it by default.

`X_2` was not dismissed merely for containing a digit. An original same-baseline
`X_2` gave X/_/2 nominal y=702–714, with `_` ink at 700.5–701.1. A separately
drawn, genuinely lowered and smaller `2` had X/_ nominal y=642–654 but `2`
nominal y=637–647 at 10 pt; the guard refuses that case. The observed trace is
`evaluation/runs/babeldoc-underscore-0.7.1/subscript-native-trace.log`.
This does not infer semantic intent from the visible characters and does not
claim to solve general mathematical reading order.

## Identity and migration

The native bridge marker remains v1, while the exact BabelDOC package version
becomes `0.7.1+ivoraige.2` and a new capture records
`underscoreLinePolicy: ascii-alnum-base-v1`. The sidecar requires that exact
derived wheel. A `.1` or 0.6.4 source binding fails translated-PDF replay before
the source is opened. Existing records, revisions, snapshots, readable MD/JSON
and original-file source export are not rewritten. To use `.2` for a previous
document, re-import its original and explicitly reconcile units and accepted
revisions; do not relabel old bindings. The plugin in P07 currently checks for
`.1` and requires separate synchronization before this runtime is used there.

## Local verification

- The checked build recipe cloned only pinned official Git objects at
  `d922e2b0c5a353bde8731921eb442c07ae75849d`, applied the exact five-file
  patch, and built the Linux `cp310-abi3-manylinux_2_34_x86_64` wheel offline
  with Rust 1.99.1, maturin 1.15.0 and Python 3.13. The patch SHA-256 is
  `86bc93914f6b6ff655d710bf685aca26a70afdf9a7c201e3bb9ca98843ff1294`;
  wheel SHA-256 is
  `7d156c91eeb35f890433c1a47d909d06545a7320e5000fbc3c72cc2a8bba08c9`.
  Provenance: `evaluation/runs/babeldoc-underscore-0.7.1/build-provenance.json`.
  The wheel was unpacked to an isolated local import path over the previously
  prepared dependency environment, not installed over `.1` or published.
- Native focused Rust tests passed 2/2 for same-baseline `X_Y`/`X_2` and
  no-guard controls including non-ASCII, punctuation/formula neighbor,
  mismatched baseline/font/size/XObject, vertical, distant and invalid boxes.
  The pinned upstream source release omits 15 of its `#[cfg(test)]` modules;
  the focused test used empty, untracked placeholders for those unrelated
  modules in its isolated build source. Those placeholders are not in the
  source patch or wheel.
- Python preflight passed 31/31, including exact `.1` binding refusal before
  source access, policy identity, and environment restoration on an exception.
  Linux Node 24.22.1 build passed; full bounded-concurrency Node suite passed
  561 tests, 2 platform skips, 0 failures. The actual 83-file isolated package
  install/reinstall smoke passed with a copied existing npm cache in offline
  mode. Python compile and `git diff --check` passed.
- The repeatable original synthetic regression is
  `scripts/pdf-underscore-regression.py`. Run under
  `scripts/pdf-offline-linux.py` with the existing assets and the matching `.2`
  runtime; the seccomp wrapper denied network syscalls to the child tree. The
  tested input SHA-256 was
  `ca8813a74c3ac945106a5b05938f87c10cd3c5bee23742d43528cde954d8e445`.
  Capture returns one ordered `X_Y`, one ordered same-baseline `X_2`, unchanged
  `X-Y`, spaced `X _ Y`, neighboring equation and lowered `X_ 2`. It retains
  the standalone `_` as an uncalled original-source line and reports one audit
  warning rather than claiming full callback coverage. Frozen skip replay
  matched seven callbacks with zero model requests and seven passing text
  checks. The accepted PDF extracts `X_Y`, `X_2`, `X-Y` and the equation; the
  lowered digit remains at y=465 versus X/_ at y=460. Input, accepted PDF and
  report: `evaluation/runs/babeldoc-underscore-0.7.1/accepted-synthetic/`.

## Limits

These are native-text, original synthetic fixtures on Linux, not the user PDF
corpus or a Mac/Windows component. They do not validate model semantics, broad
formula behavior, OCR, all layout classes, real-document visual quality or
binary distribution. The previously identified PDF title layout-fit concern
has no measured native prepass-versus-render scale mismatch on 0.7.1 and is not
claimed fixed or accepted by this patch. The upstream CJK replay issue remains
separate. Full P07 integration with `.2`, final target-platform build and
real-PDF visual acceptance are still needed.
