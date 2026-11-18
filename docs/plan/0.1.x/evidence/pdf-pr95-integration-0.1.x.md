# PR #95 secure native integration (0.1.x)

## Revisions and reconciliation

Verification on 2026-11-14 starts from PR #95
`e75e7071d8a1ee399d6ba6e99728ca3c411dcb34` and integrates PR #103
`26a79389574a0ff370f268bd16c6e33308eb54fb`, which already contains main
`9f135c8447436179f0557cc16f6985f290415272`. These are distinct branch
histories: #95 is not an ancestor of #103. The local merge retains both parents
rather than replacing #95's history.

All 20 textual conflicts between the two feature branches were reconciled to
the reviewed #103 implementation. Before adding the tests and this record, the
entire resulting tree was byte-for-byte identical to #103. The production tree
remains identical afterward; `src/` also matches main. The two historical
source-bridge and underscore patch files from #95 remain unchanged.

This uses the existing `0.7.1+ivoraige.3` implementation rather than introducing
another native runtime variant:

- Active dependencies require Pillow 13.0.0. Source-runtime and component-build
  checks reject mismatched dependencies; the frozen probe checks the executable's
  loaded versions rather than trusting the builder's Python environment.
- The native source bridge, `fit-box-v1` and `ascii-alnum-base-v1` identities must
  match. The removed upstream Python typesetting modules are not imported by
  the current sidecar.
- Main's bounded iterative placeholder mapping, build-interpreter checks,
  MinerU implementation, CI controls and documentation are retained.
- Older 0.6.4, `.1` and `.2` translated-PDF bindings still require explicit
  re-import/reconciliation. Original-PDF copying and readable retained records
  are not relabeled or migrated silently.

The underlying native implementation and earlier build evidence are described
in [native fit integration](babeldoc-native-fit-0.1.x.md). Historical Pillow,
MinerU and `.1`/`.2` evidence files are preserved without changing their tested
versions. This record supplements, rather than re-dates, those results.

## Additional regression coverage

Three tests were added to `test/build_babeldoc_runtime_test.py`:

1. Source sidecar, component builder, native builder and active lock agree on
   runtime/dependency versions and native policy identities.
2. Frozen executables reporting 0.6.4, stock 0.7.1, `.1` or `.2` are rejected
   even when they report current policy names and Pillow 13.0.0.
3. The frozen-runtime probe removes inherited `PYTHONHOME`/`PYTHONPATH`, disables
   user site packages, uses an empty temporary home, cleans that home afterward,
   and leaves the parent environment unchanged.

The latter tests mock subprocess results. They test the packaging gate, not a
real frozen binary or the native layout algorithm.

## Executed verification

All commands below ran against the reconciled candidate, not the old #95 head.

- Python **3.13.5**: `test_server.py` **44 passed**;
  `build_babeldoc_runtime_test.py` **13 passed**;
  `audit_pdf_closure_test.py` **16 passed**;
  `audit_release_archives_test.py` **4 passed**.
- Node **26.13.0**: rebuilt the pinned DSH bundle and web assets; complete
  `npm test` **727 passed, 23 skipped, 0 failed**.
- Node **24.22.1** compatibility: the same complete Node test suite against the
  rebuilt bundle **727 passed, 23 skipped, 0 failed**. Conditional skips are not
  evidence for Windows or other unavailable execution paths.
- Node 26 `npm run smoke:package` passed an actual isolated package install,
  same-version reinstall with data backup, saved settings, frozen/original
  exports, MCP discovery/call and static UI. This is kernel/package acceptance,
  not BabelDOC native PDF rendering.
- Python compilation and whitespace checks passed.
- Independent read-only inspection found no additional concrete defect in the
  reconciliation or the three new regression tests.

A fresh Python 3.13.5 virtual environment installed the image dependency subset
at the active lock's exact versions: Pillow 13.0.0, scikit-image 0.26.0,
imageio 2.38.0, NumPy 2.5.3, SciPy 1.18.1, lazy-loader 0.6, networkx 3.7,
packaging 26.3 and tifffile 2026.9.20. `uv pip check` passed for all **9**
installed packages. `scripts/check-pdf-image-runtime.py` passed native PIL
import, PNG/JPEG/TIFF encode/decode, conversion/resize, imageio's Pillow plugin,
scikit-image structural similarity and an ordinary JPEG thumbnail. The loaded
libjpeg-turbo version was 3.2.0. This subset check does not establish installation
of the complete 85-entry BabelDOC lock.

Ignored command outputs are under `evaluation/runs/pr95-integration-0.1.x/`.

## Remaining acceptance

This run did not rebuild a native wheel or PyInstaller sidecar, execute native
Rust tests, perform real PDF/CJK capture/render/frozen replay, or test an
adversarial JPEG. Native Rust/maturin tools and the full configured PDF runtime
were not present in this environment. The earlier #103 build evidence remains
historical evidence for the unchanged implementation, not a new build result.

Windows/macOS runtime packaging, complete model/font/CMap assets, CJK quality and
redistributable license closure remain open. The previously documented CJK
missing/garbled-line limitation is not claimed fixed.

PR #98's independent BabelDOC package was reviewed against `.2`; compatibility
with this `.3` runtime has not been established by this integration or its
kernel/package smoke. Its declared runtime constraints and real capture/frozen
replay need a separate check before combining those branches. This candidate
does not incorporate #98 or silently extend its acceptance claims.
