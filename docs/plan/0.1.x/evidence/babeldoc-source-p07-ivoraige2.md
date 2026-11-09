# P07 compatibility update: BabelDOC 0.7.1+ivoraige.2

This is a compatibility correction in the existing independent BabelDOC plugin
(#98), following the bounded native underscore correction in the existing
[BabelDOC source bridge PR #95](https://github.com/KongouAirlines/ivoraige/pull/95).
It does not add a host capability, new engine, new product surface or distribution.
The prior [`.1` P07 evidence](babeldoc-source-p07.md) and the combined
[first-tier snapshot](first-tier-integration.md) retain their original versions
and results; they are not relabeled as tests of `.2`.

## Contract and unchanged host

The configured runtime must be exactly `0.7.1+ivoraige.2`. New capture and
translated-PDF admission check all three saved values:

- `sourceBinding.engineVersion = 0.7.1+ivoraige.2`
- `sourceBinding.captureConfig.babeldoc = 0.7.1+ivoraige.2`
- `sourceBinding.captureConfig.underscoreLinePolicy = ascii-alnum-base-v1`

The matching sidecar owns the opt-in native policy and compares its complete
capture configuration during replay. The plugin does not set native environment
flags or reproduce the Rust correction. The policy narrowly keeps a qualifying
same-baseline ASCII alphanumeric underscore sequence on one native line; it is
not a general equation, subscript, CJK or title-layout correction.

Source ID `babeldoc`, output ID `pdf`, binding schema 1, protocol 1 and host API 1
are unchanged. The package still contains exactly seven JavaScript/metadata/
license/documentation files, no native runtime or models, no private host imports
and no extra DSH/Cordis copy. It uses `ivoraige.sidecarFactory` and the host's
canonical `ivoraige.storePath`; rebuild receives frozen data only.

The frozen host remains local `4d8b72ac58e8b644f4e8b710363bc781ee052cdb`
(published equivalent `b350e2bd70f2d04d31444dd39e2bb056265a4281`, tree
`cca6c16993a56e14aa871146057eb17834deb58e`). The synchronization was made
from the existing #98 document head `831ca2bd` in an isolated local checkout.
There is no change to host `src/`, `scripts/`, dependency manifests or CI relative
to the frozen host. A byte/tree comparison is retained in
`evaluation/runs/p07-v2/frozen-boundary.txt`.

## Existing documents and explicit migration

Old `.1` and 0.6.4 bindings are not rewritten or marked compatible. With the
new package, they retain:

- Verified original-file source PDF export, even without an executable runtime.
- Readable frozen MD/JSON replay using their existing snapshots and revisions.
- Their original binding and document identity.

Translated PDF through the `.2` adapter requires the exact `.2` binding and
policy. Older binding or missing/wrong policy is rejected before invoking a
renderer. To obtain a `.2` translation PDF, explicitly reimport the original
using the matching runtime, then manually align units and accepted revisions.
The same source ID with changed binding creates a distinct document; old accepted
revisions are not silently transferred. A matching old renderer remains a
separate compatibility choice, not an automatic fallback in this package.

Regression tests exercise both `.1` and 0.6.4 saved documents, compare frozen
MD/JSON bytes before and after restart, export the original PDF with a deliberately
missing executable, reject translated PDF, and verify the old binding is unchanged.
Explicit reimport then creates a separate `.2` document without inherited accepted
revisions. Separate cases reject old runtime capture and missing/wrong policy.

## Verified existing runtime, without replacement or downloads

The tested native source is local DCO commit
`1fd48796b0707ad04aa5e37bbd59f068ee85f53b` in the separate `.2` bridge checkout.
Its own native trace, Rust controls and 31 Python preflights are recorded in that
checkout's `docs/plan/0.1.x/evidence/babeldoc-underscore-0.7.1.md`; they are not
repeated or claimed as new results of this JavaScript package.

The already prepared `.2` wheel has SHA-256
`7d156c91eeb35f890433c1a47d909d06545a7320e5000fbc3c72cc2a8bba08c9`.
For this local proof, the existing Python 3.13 dependency environment was reused
with the already extracted `.2` package directory prepended to the child process's
`PYTHONPATH`. The original `.1` environment was not overwritten or installed into.
`runtime-identity.log` verifies package metadata `.2` and the loaded module path.
The matching `.2` NDJSON server and existing local assets were configured explicitly.
No runtime, models or tools were downloaded or rebuilt for this synchronization.

The real run uses `test/babeldoc-offline-exec.py` to deny network syscalls in
Node and its descendants. Native layout/OCR computation may use the already
prepared local models; zero translation calls does not mean zero local inference.
The host has no configured translation provider, and output receives frozen data.

## Verification

Local evidence is under `evaluation/runs/p07-v2/`:

- `focused-final.log`: 29/29 passed. Includes compatibility/migration cases and
  all existing failure, cancellation, ownership, cleanup and lifecycle cases.
- `full-final.log`: 636 tests / 634 passed / 2 platform skips / 0 failures after rebuilding the host bundles, using explicit
  npm offline mode and an existing warmed package cache.
- `package-final.log`: offline isolated core package smoke (87 files); the independently packed
  plugin inventory is `plugin-pack.json`, still seven files and no bundled deps.
- `installed-live/report.json`: real P05 installation of independent BabelDOC
  and MinerU packages in one profile/store, new `.2` capture with explicit saved
  engine/policy evidence, two manual Chinese title/Abstract revisions plus skip,
  common frozen PDF/MD/JSON snapshots, source/accepted wrong-engine refusal,
  restart replay, disable/re-enable, missing-other-runtime and removal phases.
  All six closes leave no child processes; translation task count is zero.

The same original mixed synthetic input is used, SHA-256
`e0b949bc0c1f9532d1cfca41c1e235ff0a0b0db3894eb4239b5ee1360e575d1f`.
Run the existing `test/babeldoc-live.mjs` command with the matching `.2` Python
import path, assets and server; the positional arguments remain unchanged. The
verifier needs already installed Poppler `pdftoppm` (26.05.0 here); text inspection
uses `pdftotext` (25.03.0). Set writable HOME/cache directories and the documented
MinerU local-only environment variables. No verification tool is installed by
this package.

## Limits

This is Linux package compatibility and the existing synthetic acceptance chain,
not private-PDF validation, macOS/Windows native acceptance, broad PDF quality,
binary distribution, or a fix/acceptance of #80. The native correction is limited
to the reproduced underscore case and its controls. Fresh `installed-live/text-quality.json` checks confirm the previously documented
BabelDOC CJK loss/garbling and MinerU table-header/caption failures remain quality
limits; synchronized version checks do not fix them. The historic `.1` and broad
integration records remain separate evidence for their tested snapshots.
