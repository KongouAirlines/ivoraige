# P07: independently installed BabelDOC source

This implements the second independently selectable PDF source/output package,
using BabelDOC `0.7.1+ivoraige.1` alongside MinerU `4.0.10`. The proof concerns
package integration and frozen-data routing on one original synthetic PDF. It
does not certify general PDF quality, complete P06/P09 quality acceptance, P08
native distribution, P10 cross-engine mapping, or arbitrary future plugins.

## Frozen host boundary

The final host baseline is **75e7ef967c2d6ac9e8aa39f4a6860f987b35ba70**,
tree `dcf96f6c69a0370354f4a5f0258d824a11afe29b`. Its published counterpart
`8ad5329cbf8ed6b640092fafbbd6abe7aeaeeca7` was verified to have this same
tree; local and remote commit identities differ, but host files do not. It includes the final
MinerU renderer `122a0e5` and P05 recovery, lease, CLI alias and lifecycle
corrections. It was incorporated by an ordinary merge, preserving the tested
P07 package history through `f8f99bd`; the merge changes no BabelDOC package
files. Against this new frozen baseline, P07 adds only `plugins/babeldoc/`,
tests, and documentation. Host `src/`, scripts, CI and dependency manifests
remain byte-identical to the baseline. The recorded comparison is
`evaluation/runs/p07/frozen-boundary.txt`.

The earlier local baseline `6e2b0e37019cd80963768671f5bcc9aa1b2557e7`
corresponded to published base `b5cbdda966b36dcb29135f38e1ae8ee894ec978d`;
publishing verified their identical tree
`c1d83f47089f1e091a118456bc08819ec1eb9b43`. That historical SHA difference
was provenance, not a code difference; it is not the final baseline above.

Earlier preparation on `e5ce127` and the direct-mount run
`evaluation/runs/p07/dual-pre-freeze-2/` are not the final V06 evidence. The
committed acceptance script is rerun after integration of the final host.

The contract stays host API 1, pinned DSH
`639ed015397290b3745d163aafe02ffee4aa3f84`, Cordis 4.0.4, sidecar protocol 1,
source ID `babeldoc`, binding schema 1 and output ID `pdf`. The independently
installed package has no host-private imports, DSH/Cordis copy, runtime
download, or model/credential dependency. Its MIT adapter/text validator are
adapted from the existing MIT implementation, preserving managed-resource
ownership, atomic persistence, placeholder checks, readable projection,
source-language constraints, cancellation, and frozen replay.

`ivoraige.sidecarFactory.create(config)` supplies the process transport;
`ivoraige.storePath` supplies the locked canonical store identity. The plugin
owns its client and closes it on disposal. Output receives frozen values,
not a Cordis context. The Python runtime/server/assets are separately prepared;
the JS package contains only seven bridge/license/metadata/documentation files.
Local `npm pack --offline --ignore-scripts` inventory is retained in
`evaluation/runs/p07/package-manifest.json`; this is not a native-distribution
or legal dependency-closure acceptance.

## Compatibility and development

See [package setup](../../../../plugins/babeldoc/README.md) for configuration.
Both installation and re-enabling require an explicit top-level `storePath`
matching the host. The documented CLI was tested directly after disabling:
`enable` without that argument fails validation, while the corrected command
with the same store succeeds. The exact commands/results are retained in
`evaluation/runs/p07/enable-cli/report.json`; no store inference or new persisted
state was added.

Legacy `pdf/components` mounts retain their old host path. New profile
configuration installs the package alone. Both registration orders reject a
simultaneous duplicate `babeldoc` registration explicitly, and closing/reopening
releases it. The package does not silently replace legacy configuration.

Capture and translated replay require the exact `0.7.1+ivoraige.1` binding.
A `0.6.4` binding is not relabeled or rewritten. Original-file source export can
still read and verify a retained legacy managed source. Translated replay needs
an explicitly reimported compatible source. The native source-location bridge
is independent of this package; stock BabelDOC 0.7.1 is not that derived runtime.

For changes to this package:

1. Keep all engine-specific validation and adaptation inside the package.
2. Declare host injections and use the host transport. Never import a private
   core module or bring a second DI/runtime into the package.
3. Pass only frozen values into output; never obtain a model during rebuild.
4. Preserve source IDs, binding/schema ownership, and explicit wrong-engine
   refusal. Format equality does not establish source-binding compatibility.
5. Run the unit matrix and the opt-in installed-runtime test below. Test package
   absence/disable/removal and restart, not just direct in-process registration.
6. If a new host change is necessary, stop claiming a plugin-only V06 proof and
   revisit the P03/P04 contract at that boundary.

## Verification

Final verification uses Node 24.22.1 on Linux. Python/runtime versions are the
already prepared BabelDOC `0.7.1+ivoraige.1` / PyMuPDF 1.26.7 and MinerU 4.0.10 /
DocVortex 0.6.21. No paid API, private sample, new model download, or native
installation is involved. The real-runtime run and independent-plugin unit
matrix run inside `test/babeldoc-offline-exec.py`, which denies `connect`,
`sendto`, `sendmsg`, and `sendmmsg` in all descendants. A child socket probe
returns EACCES (`network-denial-proof.log`). This is a test constraint, not a
claim of a security sandbox for installed plugins.

- `test/babeldoc-plugin.test.mjs`: 22 tests including subtests. Covers frozen
  PDF/MD/JSON, reopen, missing runtime, source export while runtime is missing,
  TXT isolation, local-only imports, store mismatch, both duplicate-registration
  orders, 0.6.4/cross-engine rejection without sidecar access, data-only output,
  missing assets, crash, timeout, cancellation, cleanup and restart. A single
  fixture hook closes every opened app before removing its directory, including
  after an early assertion failure. Close failures do not prevent other closes
  or the removal attempt, and the first cleanup error is preserved. Two focused
  regressions cover that ordering/error behavior. This avoids removing a live
  SQLite store on Windows; the rerun here is Linux, not native Windows evidence.
- `test/babeldoc-live.mjs`: final report at `evaluation/runs/p07/installed-live-final-host/report.json`.
  Actual offline P05 install of both packages and AppBoot/Loader activation;
  explicit source selection in one store; two manually accepted Chinese
  title/Abstract revisions per engine with remaining translatable units skipped;
  source and accepted PDF binding routes; shared snapshot IDs across PDF/MD/JSON;
  wrong-engine rejection in source and accepted modes; save/reopen; installer
  disable/enable and restart; missing-other-runtime isolation; removal and
  retained records/resources; TXT remains usable. Every close verifies no child
  process remains. Translation task count is zero.
- `npm test`: 627 tests / 625 passed / 2 platform skips / 0 failed; `evaluation/runs/p07/final-host-full.log`. npm runs
  with `offline=true`, `update_notifier=false`, `audit=false`, `fund=false` and a
  writable local cache. The complete host suite includes loopback HTTP tests;
  the strict child network-denial wrapper applies to the above real-engine and
  independent-plugin matrix, not those intentional localhost protocol tests.

The first installed-runtime attempt completed initial import/export but stopped
at the acceptance harness's `/proc/self/task/<process.pid>/children` lookup:
this environment's procfs TIDs differ from Node's PID-namespace-relative PID.
The test now enumerates procfs TIDs; the complete six-phase rerun passes. The
failed attempt is retained in `evaluation/runs/p07/installed-live.log`. This
was a verification-script correction, not a host/plugin implementation change.

After the fixture-close ordering correction, the complete real installed-runtime
sequence was also rerun successfully: `evaluation/runs/p07/installed-live-cleanup/report.json`
retains all six passing phases, six child-release checks and zero translation
tasks. Focused cleanup/plugin results are in `evaluation/runs/p07/unit-cleanup.log`.

The original mixed synthetic input SHA-256 is
`e0b949bc0c1f9532d1cfca41c1e235ff0a0b0db3894eb4239b5ee1360e575d1f`.
It yields 26 BabelDOC units and 13 MinerU units. Different segmentation is
retained. Reopened MinerU frozen replay is byte-identical; BabelDOC PDF metadata
can change bytes, so replay compares first-page rendered pixels instead.

The live verifier requires an existing Poppler `pdftoppm` on PATH; rendered-page
checks used version 26.05.0. Separate output-text inspection used `pdftotext`
25.03.0. These external verification tools are not plugin dependencies, are not
bundled, and are not installed by the verifier.

Run the installed-runtime proof with already prepared paths:

```sh
# Set MINERU_HOME, MINERU_MODEL_SOURCE=local, MINERU_MODEL_SMALL_BACKEND=onnx,
# HF_HUB_OFFLINE=1, TRANSFORMERS_OFFLINE=1 and writable HOME/XDG_CACHE_HOME.
python3 test/babeldoc-offline-exec.py node test/babeldoc-live.mjs \
  /absolute/new-run /absolute/original-mixed.pdf \
  /absolute/babel-runtime/bin/python /absolute/babel-assets \
  /absolute/babel-runtime/sidecars/babeldoc/server.py \
  /absolute/mineru-runtime/bin/python
```

## Quality and remaining scope

The two translated headings are manual acceptance data, not model output or a
complete-document translation. BabelDOC still loses/garbles original CJK text
in the mixed output, including the original Chinese subtitle/conclusion;
MinerU still has a table-header/caption fidelity failure. These known failures
are not repaired or hidden by independent packaging. Final output text and
one-page PNG inspection are recorded in
`evaluation/runs/p07/installed-live-final/text-quality.json` and
`visual-review.json`, with `babeldoc.png` / `mineru.png`. Original CJK text
checks normalize whitespace and ASCII/full-width colons; both manual headings
are extractable in both outputs. Routing success, frozen
replay, and zero translation calls do not establish complete PDF quality.
Windows/macOS native-runtime behavior, binary/asset distribution, broader
samples, full-page quality acceptance and cross-engine mapping remain outside
this branch. P07/V06 branch evidence remains pending integration into the target
branch; this document does not close #14 as a whole.

## DSH review corrections and contract checks

The pinned Python server's `capture_config` preserves each Chinese source tag
exactly and omits `sourceLanguage` for English. Its replay path compares this
same configuration strictly. The two pinned Python language tests pass in
`evaluation/runs/p07/pinned-language-contract-final.log`; the JS regression
accepts matching tags and rejects changed tags or explicit English metadata.
The proposed language-normalization relaxation was therefore not applied.

Cleanup could previously mask a parse/import/rebuild or publication failure
when a subsequent `rm` failed. Package-local cleanup now preserves the original
error object/code/details, retains secondary errors in a non-enumerable
`cleanupErrors` property, and still rejects cleanup failures after successful
operations. Six actual adapter-path regressions inject filesystem EPERM/EBUSY
at capture cleanup, persistence rollback, rebuild, new-source publication,
repair rename and cleanup-only success. They do not claim native Windows runs.

A reproduced ancestor-alias failure was corrected inside the package: root
resolution canonicalizes existing ancestors and optional store-path assertions,
while rejecting a symlink root and preserving managed-source escape/digest
checks. The pre-fix reproduction is `evaluation/runs/p07/directory-alias-before.log`;
the ancestor-alias/root-symlink regression passes in `dsh-review-unit.log`.

Other conditional review concerns did not establish new defects in the pinned
contract. Importer supplies synchronous `Records.referencesSourcePath`; a
speculative asynchronous callback is not the deployed interface. A duplicate
mount creates only a lazy client, not a process; both registration orders and
close/reopen are covered. Saved-name fallback preserves documented legacy and
store-relocation reads under the verified current source root; new-file cleanup
still targets only this store's owned name. Missing install configuration does
not satisfy the plugin's required directory/transport validation. None of these
checks introduces a host engine-name branch or changes upstream CJK behavior.

Post-review verification passes all 22 plugin tests and the complete 615-pass /
2-skip host suite. The real installed-runtime six-phase rerun is
`evaluation/runs/p07/installed-live-dsh-review/report.json`, again with no child
processes after all six closes and zero translation tasks. Root package smoke
passes in `dsh-review-package-smoke-final.log` using the pre-existing warmed
cache in explicit offline mode; an earlier empty-cache attempt failed with
ENOTCACHED, not a downloaded dependency. Independent plugin packing remains
seven source/metadata/license/documentation files with no bundled dependencies
(`dsh-review-plugin-pack.json`).


## Final merged-host verification

After the ordinary merge of the final host baseline `75e7ef9`, no BabelDOC
package or plugin-test file changed relative to `f8f99bd`. Rebuilt tests pass:
627 total / 625 passed / 2 platform skips / 0 failures
(`evaluation/runs/p07/final-host-full.log`), with all 22 independent-plugin
checks also passing under child network denial (`final-host-unit.log`).
Offline root package smoke passes with 87 files (`final-host-package.log`).

The complete real installation/disable/enable/missing-runtime/removal sequence
was repeated on this merged host under child network denial. Its report is
`evaluation/runs/p07/installed-live-final-host/report.json`: all six phases
pass, every close leaves no child processes, and translation task count is zero.
BabelDOC rendered-pixel and MinerU PDF-byte hashes match the prior post-review
run, preserving the documented quality limitations rather than claiming a
quality fix from host integration.
