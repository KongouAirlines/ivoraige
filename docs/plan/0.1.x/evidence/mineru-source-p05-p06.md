# P05 / P06 source-package branch evidence

This branch adds one opt-in MinerU source package and the minimum host contract it needs. A local live CPU/flash test now establishes a narrow P06 parse/import/source-export result on two original synthetic PDFs. It does not complete P05 independent installation, broad P06 quality acceptance, P07 second-engine proof, P08 distribution closure, P09 same-translation PDF comparison, or #14 as a whole.

## Activated contract and compatibility

- The existing DSH AppBoot profile accepts a user-selected local package row at `./node_modules/@ivoraige/mineru-source/index.mjs`. `bootModelSettings` provisions the generic Outputs, Parse and sidecar transport services before AppBoot audits profile entries; the normal app reuses them. DSH Loader still owns package activation, dependency injection, `disabled` rows, and effect disposal. The package defaults to absent. Source/offline package testing does not assert an independent install transaction, registry package, restart rollback, host control contract, or hot unload.
- The build embeds the **pinned upstream AppBoot 0.2.0-rc.2** package version into its existing compatibility function. Without this narrow shim the bundled `import.meta.url` read resolves ivoraige's host `package.json` and incorrectly reports 0.1.0. The build rejects any upstream package name/version or version-reader shape change. MinerU declares that exact DSH peer as optional, avoiding a second npm runtime while keeping AppBoot's actual compatibility gate. A deliberately wrong peer disables only that profile row; the base sources boot. The source bundle remains compatible with existing TXT/Markdown/BabelDOC paths and API/record schema; it activates no global schema migration.
- The parse-only package uses the existing NDJSON JSON-RPC 2.0 `SidecarClient` over stdio (protocol version 1). It implements `handshake`, `configure`, `parse`, and `shutdown`. `configure` checks MinerU 4.0.10 exactly before parse; the Python runner disables Python socket access and sets Hugging Face/Transformers offline flags. The bridge does not install software or models. Its `parse` saved-result response is adapter-private, as documented in protocol §7.1. Bounded sidecar diagnostics remain on the existing local error-cause/log path; public task/status/error messages do not include raw stderr.
- Each import saves `source.pdf`, full `middle_json.json`, `structured_content.json`, `markdown.md`, and image bytes before persistence. It checks `docvortex.middle` schema 2.0 and same-order structured/middle block position, type and bbox before projecting units. MinerU 4.0.10 structured blocks omit the MiddleJson `index`; the index is retained only as a locator. Resource digests and source adapter/schema/engine versions are recorded. The managed bundle key includes the physical, canonical store path, source digest, parse settings and engine version; same-source reimport is deterministic while different stores cannot remove each other's resources. A verifier checks the expected managed path and all saved file digests. The plugin resolves path aliases in existing ancestors and rejects a different store owner. Bundle paths are currently absolute: move the database and directory together only after a separately verified migration. MD/JSON use the persisted readable unit projection; they do not consume private layout files or call a model.
- This is **not** a MinerU renderer. `pdf` output remains compatible only with BabelDOC bindings. An explicitly selected MinerU import does not request translation, but no claim is made about real inline formula safety, OCR quality, table coverage, or accepted translation quality.

## Official upstream contract checked

- [MinerU 4.0.10 `mineru.parser.parse`](https://github.com/opendatalab/MinerU/blob/mineru-4.0.10-released/mineru/parser/__init__.py) accepts path, tier and OCR mode and returns `ParseResult`.
- [`ParseResult.save`](https://github.com/opendatalab/MinerU/blob/mineru-4.0.10-released/mineru/parser/base.py) materializes and validates assets before saving MiddleJson, structured content, Markdown and images.
- [Output contract](https://github.com/opendatalab/MinerU/blob/mineru-4.0.10-released/docs/en/reference/output_files.md) identifies `docvortex.middle` schema 2.0, producer version in `metadata.producer.version`, and separately notes that `mineru parse --json` is **not** MiddleJson. It describes PDF rendering as an SDK capability, not a validated CLI route or quality result.
- [Pinned `pyproject.toml`](https://github.com/opendatalab/MinerU/blob/mineru-4.0.10-released/pyproject.toml) declares `LicenseRef-MinerU-Open-Source-License` and dependencies including DocVortex and image/model tooling. [The license](https://github.com/opendatalab/MinerU/blob/mineru-4.0.10-released/LICENSE.md) adds commercial thresholds and online-service attribution to Apache 2.0. No local Python wheel, model, native library, font or independent release archive is bundled or audited here. P08 remains open, and no upstream license conclusion is inferred from BabelDOC.

## Verification boundary

Focused structural/protocol tests use a synthetic Node JSON-RPC sidecar and invented PDF bytes. They cover DSH profile activation/disabled/wrong peer; selected queued import and saved source/MiddleJson/images; source MD/JSON export with zero translation task; restart; same-root two-store isolation and missing resource refusal; rejection of pre-created `work`/`sources` symlinks without writing outside the managed root; private diagnostic/public task separation; Python handshake and parse-before-configure rejection; and SidecarClient cancellation waiting for a delayed child exit. These structural tests alone do **not** establish real MinerU/PDF/OCR acceptance.

On this branch after the path-alias correction, `npm test` passed 570 tests with 2 skips and no failures on Linux; `npm run smoke:package` passed with an isolated 87-file package; `npm run pack:npm` produced an 87-file, 1,332,771-byte tarball (SHA-256 `0c8b4c4874ca496c7878e5d9232ea19aa47850c09cc2ec3c3897acb5f7c8449c`). A fresh offline npm install of that tarball activated a copied `@ivoraige/mineru-source` package through the actual DSH profile and retained TXT. The installed package contains only the bridge's `index.mjs`, `runner.py` and `package.json`, not the MinerU runtime, models or a second DSH copy. These checks prove package structure and host activation, not a working MinerU Python environment. macOS and Windows CI initially failed on aliased store paths, which the correction addresses; final cross-platform CI is still pending.

## Live local MinerU source acceptance (2026-11-09)

A separate Linux CPU environment used Python 3.12.14 with official MinerU 4.0.10, DocVortex 0.6.21 and ONNX Runtime 1.31.1. The observed 112-package environment is recorded in [its version list](mineru-live-requirements.txt), but it lacks per-wheel hashes and does **not** close the full distribution or license audit; fixing MinerU alone does not reproduce this complete dependency closure. The official `opendatalab/MinerU-4_models_onnx` revision `358310b4f64b95f9fefc372ad899356e4111f376` listed 16 files totaling 858,220,651 bytes. All 16 downloaded sizes and the 13 hashes in the repository's model manifest matched; the observed local SHA-256 values are in [the model inventory](mineru-onnx-sha256.json); MinerU's model-repository check reported ready. No standard VLM, GGUF or Torch weights were used. The isolated venv occupied about 987 MiB and models about 819 MiB on disk. The bridge's offline environment/socket guard was active; no paid API or private document was used. The recorded upstream license is `LicenseRef-MinerU-Open-Source-License`, with commercial-scale and online-service obligations described above. These observations do not close P08's full dependency, font, native-library or independent archive audit.

The retained, dependency-only sample generator created a 3,473-byte `mixed.pdf` with selectable English/Chinese text, two columns, a table and a simple formula, plus a 137,186-byte `scan.pdf` rasterized with PDFium. The scan had **zero extractable PDF text characters** and a unique printed OCR line. Both were original synthetic inputs. Through the real Node adapter and Python sidecar, mixed imported as 12 units (11 translatable) in 2.2 s and scan as 13 units (12 translatable) in 5.0 s. Both saved the original PDF, MiddleJson, structured content, model output, Markdown and assets, then made frozen source MD/JSON exports. The scan OCR found `SCAN ONLY: OCR should read this line.扫描测试`. Restart and repeat import reused the same owned bundle paths without new documents; both bundles passed digest verification, with no translation tasks. Warm repeats took 2.3 s and 4.3 s. At a 0.1 s sampling interval on this repeat, observed peak Python sidecar RSS was 1,134,708 KiB and Node RSS 113,988 KiB; this is not a performance benchmark.

An earlier synthetic scan used PyMuPDF rasterization (121,730 bytes) and also imported/exported, but gave 13 units with only 11 translatable units: MinerU treated the formula as an image-backed equation. The final PDFium scan instead recovered the formula text, making it translatable. The two scans are not byte-identical. The initial source alignment failure below was discovered with this earlier input; the final retained generator has independently passed two full import/export runs after the fix.

The first real Python parses had succeeded but host imports failed because the old projection assumed structured blocks had the MiddleJson `index`. They do not: ordered position, type and bbox match. The correction also marks actual `doc_title` and `paragraph_title` as translatable headings. A focused negative test changes bbox and rejects misbinding. The next two imports and source exports succeeded. Local diagnostics recorded the failure cause while public task/status messages did not expose it.

Visible quality limits remain: MinerU merged the selectable PDF's table header into its caption; the scanned table became code/plain text. The initial scan’s formula was classified as an image-backed equation: host source MD/JSON showed `[equation]` while its legible crop stayed saved. The final PDFium scan recovered that formula as text. The selectable formula survived as text but was classified as a heading. Generic host Markdown shows heading text without MinerU's heading markup. Chinese punctuation/spacing changed in OCR. These two samples do not establish arbitrary-document OCR accuracy, formula/table coverage, full PDF rendering or accepted-translation quality.

### Reproduce with original synthetic inputs

The opt-in scripts `scripts/mineru-live-samples.py` and `scripts/mineru-live-acceptance.mjs` use only local generated PDFs and run-folder paths. Their generated raster bytes may vary by font and PDF/image library version; the unit counts above come from the final PDFium-based generator in the tested environment. They never install or download models themselves. First review the upstream license, disk requirement and model provenance, then deliberately prepare a separate Python environment with compatible fixed versions. For the tested Linux combination, the basic steps from the repository root are:

```sh
RUN="$PWD/evaluation/runs/mineru-live-0.1.x"
python3.12 -m venv "$RUN/venv"
"$RUN/venv/bin/python" -m pip install -r docs/plan/0.1.x/evidence/mineru-live-requirements.txt
"$RUN/venv/bin/python" -m pip check
"$RUN/venv/bin/python" scripts/mineru-live-samples.py "$RUN/samples"
```

The PDF generator needs ReportLab, Pillow, pypdfium2, pypdf and a local Noto CJK font (`SYNTHETIC_CJK_FONT` can override its path); verify their versions before relying on exact byte sizes. After deliberately choosing to fetch about 858 MB from the named official repository, run the separate pinned downloader/verifier. It compares all 16 sizes and SHA-256 values against [the checked inventory](mineru-onnx-sha256.json), then checks the 13 internal model-manifest hashes. The plugin and acceptance script never download files:

```sh
"$RUN/venv/bin/python" scripts/mineru-live-models.py "$RUN" --download
"$RUN/venv/bin/python" scripts/mineru-live-models.py "$RUN" --verify
```

Run MinerU's model-repository verifier and confirm it reports ready. Then:

```sh
export MINERU_HOME="$RUN/mineru-home" MINERU_MODEL_SOURCE=local MINERU_MODEL_SMALL_BACKEND=onnx
export HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1
node scripts/mineru-live-acceptance.mjs "$RUN"
node scripts/mineru-live-acceptance.mjs "$RUN"  # owned-bundle reuse and restart check
```

Review `$RUN/live_results.json`, the saved bundles, and the source MD/JSON content manually. The recorded first-run logs, resources, samples and full report live in the original developer's ignored `evaluation/runs/mineru-live-0.1.x/`, not in the release package. Installation and rendering have not been validated on Windows or macOS.

P05 remains partial: manual local package placement through the existing DSH profile has no atomic install/update/rollback workflow or independently tested archive closure. P06 has a narrow live parse/save/reopen/source-export result on these two synthetic PDFs, but broader quality and distribution acceptance remain open. P07 and P09 are separate work. Old BabelDOC snapshots retain their binding and compatible renderer; no cross-engine replay path was introduced.
