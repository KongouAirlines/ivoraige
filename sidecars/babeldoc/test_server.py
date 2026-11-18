# SPDX-License-Identifier: AGPL-3.0-only
# Copyright (c) 2026 ivoraige contributors

"""Fast preflight tests; no BabelDOC import, model, or asset download."""

import importlib.util
import json
import os
import subprocess
import sys
from io import StringIO
import tempfile
import unittest
from contextlib import chdir, nullcontext
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import server


class SidecarBuildTests(unittest.TestCase):
    def component_builder(self):
        root = Path(__file__).resolve().parents[2]
        spec = importlib.util.spec_from_file_location("component_builder", root / "scripts/build-pdf-component.py")
        build = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(build)
        return build

    def test_policy_identity_pins_native_algorithms_and_rejects_legacy(self):
        config = server.capture_config(None, 5)
        self.assertEqual(config["layoutFitPolicy"], server.LAYOUT_FIT_POLICY)
        self.assertEqual(config["underscoreLinePolicy"], server.UNDERSCORE_LINE_POLICY)
        self.assertEqual(server.capture_config(None, 5,
            layout_fit_policy=server.LAYOUT_FIT_POLICY,
            underscore_line_policy=server.UNDERSCORE_LINE_POLICY), config)
        for policy in ("invented", "fit-box-v2"):
            with self.assertRaisesRegex(server.SidecarError, "policy unsupported"):
                server.capture_config(None, 5, layout_fit_policy=policy)
        for policy in ("ascii-base-v1", "ascii-base-v2", "invented"):
            with self.assertRaisesRegex(server.SidecarError, "policy unsupported"):
                server.capture_config(None, 5, underscore_line_policy=policy)

    def test_component_build_refuses_unverified_old_executable_reuse(self):
        build = Path(__file__).resolve().parents[2] / "scripts/build-pdf-component.py"
        result = subprocess.run([sys.executable, str(build), "--python", sys.executable,
                                 "--reuse-pyinstaller-build"], capture_output=True, text=True)
        self.assertEqual(result.returncode, 2)
        self.assertIn("build a fresh matching sidecar", result.stderr)

    def test_component_build_keeps_the_current_interpreter_path(self):
        build = self.component_builder()
        current = Path(sys.executable).absolute()
        self.assertEqual(build.require_build_python(str(current)), current)
        with chdir(current.parent):
            self.assertEqual(build.require_build_python(current.name), current)
        with patch.object(build.sys, "executable", ""):
            with self.assertRaisesRegex(RuntimeError, "Cannot identify"):
                build.require_build_python(str(current))

    def test_component_build_rejects_another_environment_before_side_effects(self):
        build = self.component_builder()
        with tempfile.TemporaryDirectory() as directory:
            other = Path(directory) / "another-python"
            other.write_text("not the active interpreter", encoding="utf-8")
            with patch.object(sys, "argv", [str(build.__file__), "--python", str(other)]), \
                 patch.object(build, "run") as run, \
                 patch.object(build.shutil, "rmtree") as remove, \
                 patch.dict(sys.modules, {"babeldoc": None, "pymupdf": None, "PyInstaller": None}):
                with self.assertRaisesRegex(RuntimeError, "--python must name the interpreter running this script"):
                    build.main()
                run.assert_not_called()
                remove.assert_not_called()

    def test_component_build_does_not_collapse_virtual_environment_aliases(self):
        build = self.component_builder()
        with tempfile.TemporaryDirectory() as directory:
            first = Path(directory) / "first-python"
            second = Path(directory) / "second-python"
            try:
                first.symlink_to(sys.executable)
                second.symlink_to(sys.executable)
            except OSError as error:
                self.skipTest(f"Executable symlinks are unavailable: {error}")
            self.assertTrue(first.samefile(second))
            with patch.object(build.sys, "executable", str(first)):
                self.assertEqual(build.require_build_python(str(first)), first)
                with self.assertRaisesRegex(RuntimeError, "same environment"):
                    build.require_build_python(str(second))



    def test_component_stages_only_current_native_sidecar_sources(self):
        root = Path(__file__).resolve().parents[2]
        build = self.component_builder()
        with tempfile.TemporaryDirectory() as directory:
            stage = Path(directory)
            source = root / "sidecars/babeldoc"
            build.stage_sidecar_sources(source, stage)
            self.assertEqual({item.name for item in stage.iterdir()},
                             {"server.py", "requirements.lock", "LICENSE", "COPYING"})
            for item in stage.iterdir():
                self.assertEqual(item.read_bytes(), (source / item.name).read_bytes())


class NativeBridgeTests(unittest.TestCase):
    def test_duplicate_text_is_bound_by_indices_not_callback_order(self):
        inventory = server.SourceInventory()
        items = [{"pageIndex": 0, "paragraphIndex": i, "page": 7,
                  "bbox": [10, y, 100, y + 20], "sourceUnicode": "Repeated source",
                  "layoutLabel": "plain text"} for i, y in enumerate((50, 100))]
        inventory.load(json.dumps(items))
        def context(index):
            return {"ivoraigeSource": {"version": 1, "pageIndex": 0,
                "paragraphIndex": index, "preparedInput": "Repeated source",
                "placeholderPayloadsJson": "[]"}}
        second = inventory.locate("Repeated source", context(1))
        first = inventory.locate("Repeated source", context(0))
        self.assertEqual(second["bbox"][1], 100)
        self.assertEqual(first["bbox"][1], 50)
        self.assertEqual(first["page"], 7)
        self.assertNotEqual(first["key"], second["key"])
        with self.assertRaisesRegex(server.SidecarError, "differs from callback"):
            inventory.locate("Changed source", context(0))
        with self.assertRaisesRegex(server.SidecarError, "absent from source inventory"):
            inventory.locate("Repeated source", context(2))
        with self.assertRaisesRegex(server.SidecarError, "context missing"):
            inventory.locate("Repeated source", {})
        inventory.load("[]")
        with self.assertRaisesRegex(server.SidecarError, "absent from source inventory"):
            inventory.locate("Repeated source", context(0))

    def test_inventory_retains_uncalled_null_and_rejects_malformed_locations(self):
        inventory = server.SourceInventory()
        item = {"pageIndex": 0, "paragraphIndex": 0, "page": 0,
                "bbox": [0, 0, 10, 10], "sourceUnicode": None, "layoutLabel": None}
        self.assertIsNone(inventory.load(json.dumps([item]))[0]["sourceUnicode"])
        for records in ([item, item], [{**item, "bbox": [0, 0, float("inf"), 10]}],
                        [{**item, "page": True}], [{**item, "sourceUnicode": 1}]):
            with self.assertRaises(server.SidecarError):
                inventory.load(json.dumps(records))

    def test_inventory_requires_box_even_for_textless_or_uncalled_paragraphs(self):
        for source in (None, "", "Repeated source"):
            for missing in (False, True):
                with self.subTest(source=source, missing=missing):
                    inventory = server.SourceInventory()
                    item = {"pageIndex": 0, "paragraphIndex": 3, "page": 7,
                            "bbox": None, "sourceUnicode": source, "layoutLabel": "unknown"}
                    if missing:
                        del item["bbox"]
                    valid = {**item, "paragraphIndex": 2, "bbox": [0, 0, 10, 10]}
                    with self.assertRaisesRegex(server.SidecarError,
                            r"no bounding box at indices \(0, 3\); unsupported source inventory"):
                        inventory.load(json.dumps([valid, item]))
                    self.assertEqual(inventory.positions, {})
        # A textless retained layout paragraph still has its real box, not a
        # fabricated zero box or an index-derived substitute location.
        item.update(bbox=[10, 50, 100, 70], sourceUnicode=None)
        position = server.SourceInventory().load(json.dumps([item]))[0]
        self.assertEqual(position["bbox"], [10, 50, 100, 70])
        self.assertIsNone(position["sourceUnicode"])

    def test_inventory_rejects_partial_nonfinite_or_malformed_box(self):
        for box in ([], [0, 0, 10], [0, 0, 10, 10, 10], {}, "0,0,10,10",
                    [None, 0, 10, 10], [0, False, 10, 10], [0, 0, "10", 10],
                    [0, 0, float("nan"), 10], [0, 0, float("inf"), 10]):
            with self.subTest(box=box):
                item = {"pageIndex": 0, "paragraphIndex": 0, "page": 0,
                        "bbox": box, "sourceUnicode": None, "layoutLabel": None}
                with self.assertRaisesRegex(server.SidecarError, "Invalid native source box"):
                    server.SourceInventory().load(json.dumps([item]))

    def test_handcrafted_inventory_rejects_integer_overflow_as_sidecar_error(self):
        for value in (10 ** 400, -(10 ** 400)):
            with self.subTest(value=value):
                inventory = server.SourceInventory()
                item = {"pageIndex": 0, "paragraphIndex": 0, "page": 0,
                        "bbox": [0, 0, value, 10], "sourceUnicode": "Synthetic source",
                        "layoutLabel": "plain text"}
                with self.assertRaisesRegex(server.SidecarError, "Invalid native source box"):
                    inventory.load(json.dumps([item]))
                self.assertEqual(inventory.positions, {})

    def test_socket_connect_and_connect_ex_are_guarded_and_restored(self):
        import socket
        for method in ("connect", "connect_ex"):
            original = getattr(socket.socket, method)
            with server.loopback_only_network():
                with self.assertRaisesRegex(server.SidecarError, "Network access disabled"):
                    getattr(socket.socket, method)(None, ("example.com", 443))
            self.assertIs(getattr(socket.socket, method), original)

    def test_runtime_requires_both_derived_distribution_and_native_marker(self):
        fake_babeldoc = SimpleNamespace(const=SimpleNamespace(__version__="0.7.1"),
                                      _rust_il=SimpleNamespace(
                                          ivoraige_source_bridge_version=1,
                                          ivoraige_layout_fit_policy=server.LAYOUT_FIT_POLICY,
                                          ivoraige_underscore_line_policy=server.UNDERSCORE_LINE_POLICY))
        with patch.dict("sys.modules", {"pymupdf": SimpleNamespace(VersionBind="1.26.7"),
                                         "PIL": SimpleNamespace(Image=SimpleNamespace(__version__=server.PILLOW_VERSION)),
                                         "babeldoc": fake_babeldoc}), \
             patch.object(server.sys, "version_info", (3, 13)):
            with patch.object(server, "package_version", return_value="0.7.1"):
                with self.assertRaisesRegex(server.SidecarError, "derived runtime"):
                    server.runtime()
            with patch.object(server, "package_version", return_value=server.ENGINE_VERSION):
                server.runtime()
                fake_babeldoc._rust_il = SimpleNamespace()
                with self.assertRaisesRegex(server.SidecarError, "source bridge v1 missing"):
                    server.runtime()
                fake_babeldoc._rust_il.ivoraige_source_bridge_version = 1
                with self.assertRaisesRegex(server.SidecarError, "fit-box-v1 layout policy missing"):
                    server.runtime()
                fake_babeldoc._rust_il.ivoraige_layout_fit_policy = server.LAYOUT_FIT_POLICY
                with self.assertRaisesRegex(server.SidecarError, "underscore policy missing"):
                    server.runtime()

    def test_runtime_rejects_wrong_python_before_importing_engine(self):
        with patch.object(server.sys, "version_info", (3, 12)), \
             patch.dict("sys.modules", {"babeldoc": None}):
            with self.assertRaisesRegex(server.SidecarError, "Python 3.13 required"):
                server.runtime()

    def test_runtime_rejects_unsafe_pillow_and_reports_loaded_versions(self):
        image = SimpleNamespace(__version__="12.3.0")
        fake_babeldoc = SimpleNamespace(const=SimpleNamespace(__version__="0.7.1"),
                                      _rust_il=SimpleNamespace(
                                          ivoraige_source_bridge_version=1,
                                          ivoraige_layout_fit_policy=server.LAYOUT_FIT_POLICY,
                                          ivoraige_underscore_line_policy=server.UNDERSCORE_LINE_POLICY))
        with patch.dict("sys.modules", {"PIL": SimpleNamespace(Image=image),
                                         "pymupdf": SimpleNamespace(VersionBind="1.26.7"),
                                         "babeldoc": fake_babeldoc}), \
                patch.object(server.sys, "version_info", (3, 13)), \
                patch.object(server, "package_version", return_value=server.ENGINE_VERSION):
            with self.assertRaisesRegex(server.SidecarError, "Pillow 13.0.0 required") as error:
                server.runtime()
            self.assertEqual(error.exception.code, -32002)
            self.assertEqual(error.exception.kind, "COMPONENT_MISSING")
            image.__version__ = server.PILLOW_VERSION
            versions = server.runtime_versions()
            self.assertEqual(versions["pillow"], "13.0.0")
            self.assertEqual(versions["babeldoc"], server.ENGINE_VERSION)
            self.assertEqual(versions["pymupdf"], server.PYMUPDF_VERSION)
            self.assertEqual(versions["sourceBridge"], 1)
            self.assertEqual(versions["layoutFitPolicy"], server.LAYOUT_FIT_POLICY)
            self.assertEqual(versions["underscoreLinePolicy"], server.UNDERSCORE_LINE_POLICY)

    def test_old_binding_fails_before_resolving_source_or_running_engine(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            doc = root / "doc.json"
            frozen = root / "frozen.json"
            doc.write_text(json.dumps({"document": {"language": "en"},
                "sourceBinding": {"adapterId": "babeldoc", "engineVersion": "0.6.4",
                    "sourcePath": "/missing/original.pdf"}}))
            frozen.write_text("{}")
            with patch.object(server, "run_engine") as engine:
                with self.assertRaisesRegex(server.SidecarError, "re-import.*reconcile accepted revisions"):
                    server.rebuild({"format": "pdf", "docRef": str(doc), "revisionsRef": str(frozen)})
                engine.assert_not_called()

    def test_previous_derived_bindings_also_require_explicit_reimport(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            doc, frozen = root / "doc.json", root / "frozen.json"
            frozen.write_text("{}")
            for version in ("0.7.1+ivoraige.1", "0.7.1+ivoraige.2"):
                with self.subTest(version=version):
                    doc.write_text(json.dumps({"document": {"language": "en"},
                        "sourceBinding": {"adapterId": "babeldoc", "engineVersion": version,
                            "sourcePath": "/missing/original.pdf"}}))
                    with patch.object(server, "run_engine") as engine:
                        with self.assertRaisesRegex(server.SidecarError, "re-import.*reconcile accepted revisions"):
                            server.rebuild({"format": "pdf", "docRef": str(doc), "revisionsRef": str(frozen)})
                        engine.assert_not_called()

    def test_capture_config_enables_parser_limits_and_versions_bridge(self):
        config = server.capture_config(None, 5)
        self.assertTrue(config["parserResourceLimits"])
        self.assertEqual(config["sourceBridge"], 1)
        self.assertEqual(config["babeldoc"], "0.7.1+ivoraige.3")
        self.assertEqual(config["layoutFitPolicy"], "fit-box-v1")
        self.assertEqual(config["underscoreLinePolicy"], "ascii-alnum-base-v1")

    def test_scoped_native_policies_restore_environment_even_on_error(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(ValueError, "synthetic"):
                with server.native_policy_scope(server.capture_config(None, 5)):
                    self.assertEqual(os.environ["IVORAIGE_FIT_BOX_V1"], "1")
                    self.assertEqual(os.environ["IVORAIGE_ASCII_ALNUM_BASE_V1"], "1")
                    raise ValueError("synthetic")
            self.assertNotIn("IVORAIGE_FIT_BOX_V1", os.environ)
            self.assertNotIn("IVORAIGE_ASCII_ALNUM_BASE_V1", os.environ)
            os.environ["IVORAIGE_FIT_BOX_V1"] = "earlier"
            os.environ["IVORAIGE_ASCII_ALNUM_BASE_V1"] = "previous"
            with server.native_policy_scope(server.capture_config(None, 5)):
                self.assertEqual(os.environ["IVORAIGE_FIT_BOX_V1"], "1")
                self.assertEqual(os.environ["IVORAIGE_ASCII_ALNUM_BASE_V1"], "1")
            self.assertEqual(os.environ["IVORAIGE_FIT_BOX_V1"], "earlier")
            self.assertEqual(os.environ["IVORAIGE_ASCII_ALNUM_BASE_V1"], "previous")
            for field in ("layoutFitPolicy", "underscoreLinePolicy"):
                with self.subTest(field=field):
                    config = {**server.capture_config(None, 5), field: "legacy"}
                    with self.assertRaisesRegex(server.SidecarError, "policy unsupported"):
                        with server.native_policy_scope(config):
                            pass


class BindingTests(unittest.TestCase):




    def test_capture_summary_counts_overlapping_audit_and_empty_units(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as directory:
            path = Path(directory) / "invented.pdf"
            path.write_bytes(b"%PDF-1.7\n")
            def item(key, text, label="plain text"):
                return {"page": 0, "bbox": [0, 0, 1, 1], "key": key,
                        "sourceUnicode": text, "layoutLabel": label}
            # An upstream label alone does not establish audit provenance.
            called = item("called", "Invented body", "unmapped_pdf_text")
            paragraphs = [called, item("retained", "Figure marker"),
                          item("empty", None, "unknown")]
            audit = {**item("audit", "Separate extracted line", "unmapped_pdf_text"),
                     "rawExtractedText": "Separate extracted line",
                     "coverageOrigin": "pymupdf_line_audit"}
            with patch.object(server, "run_engine", return_value=(
                    [{**called, "requestText": "Invented body", "placeholderPayloads": []}],
                    paragraphs, [])), \
                 patch.object(server, "unbound_pdf_lines", return_value=[audit]):
                parsed = server.parse({"path": str(path), "options": {"language": "en"}})["doc"]
            coverage = parsed["sourceCoverage"]
            self.assertEqual(coverage["summary"], {
                "unitCount": 4, "callbackCount": 1, "uncalledCount": 3,
                "emptyUnitCount": 1, "auditOnlyLineCount": 1,
            })
            self.assertEqual(len(parsed["units"]), 4)
            self.assertEqual(len(coverage["uncalled"]), 3)
            self.assertIn("Separate extracted line", [unit["sourceText"] for unit in parsed["units"]])

    def test_language_route_keeps_english_config_and_exact_chinese_source(self):
        english = server.capture_config(None, 5)
        self.assertNotIn("sourceLanguage", english)
        self.assertEqual(server.engine_pair("en"), ("en", "zh"))
        for source in ("zh", "zh-CN", "zh-Hans"):
            self.assertEqual(server.engine_pair(source), ("zh", "en"))
            self.assertEqual(server.capture_config(None, 5, source)["sourceLanguage"], source)
        with self.assertRaises(server.SidecarError):
            server.engine_pair("zh-TW")

    def test_chinese_capture_passes_persisted_route_to_engine(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as directory:
            path = Path(directory) / "chinese.pdf"
            path.write_bytes(b"%PDF-1.7\n")
            paragraph = {"page": 0, "bbox": [0, 0, 1, 1],
                         "key": "p0:0.000,0.000,1.000,1.000",
                         "sourceUnicode": "中文原文", "layoutLabel": "plain text"}
            call = {**paragraph, "requestText": "中文原文", "placeholderPayloads": []}

            def capture(_source, config, mode):
                self.assertEqual(mode, "capture")
                self.assertEqual(config["sourceLanguage"], "zh-CN")
                self.assertEqual(config["layoutFitPolicy"], server.LAYOUT_FIT_POLICY)
                self.assertEqual(config["underscoreLinePolicy"], server.UNDERSCORE_LINE_POLICY)
                self.assertEqual(server.engine_pair(config["sourceLanguage"]), ("zh", "en"))
                return [call], [paragraph], []

            with patch.object(server, "run_engine", side_effect=capture), \
                 patch.object(server, "unbound_pdf_lines", return_value=[]):
                parsed = server.parse({"path": str(path), "options": {"language": "zh-CN"}})
            self.assertEqual(parsed["doc"]["sourceBinding"]["captureConfig"]["sourceLanguage"], "zh-CN")
            self.assertEqual(parsed["doc"]["units"][0]["sourceText"], "中文原文")

    def test_chinese_replay_requires_bound_source_and_english_target(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as directory:
            root = Path(directory)
            source = root / "source.pdf"
            source.write_bytes(b"%PDF-1.7\n")
            record = {"order": 0, "page": 0, "bbox": [0, 0, 1, 1],
                      "key": "p0:0.000,0.000,1.000,1.000", "requestText": "中文原文",
                      "sourceUnicode": "中文原文", "placeholders": [], "callback": True}
            binding = {"adapterId": "babeldoc", "engineVersion": server.ENGINE_VERSION,
                       "sourcePath": str(source),
                       "captureConfig": server.capture_config(None, 5, "zh-Hans"),
                       "records": [record]}
            doc_ref = root / "doc.json"
            frozen_ref = root / "frozen.json"
            frozen = {"snapshot": {"targetLang": "en"}, "units": [
                {"unit": {"id": "u", "order": 0, "sourceText": "中文原文"},
                 "decision": {"type": "revision"}, "text": "English text"}]}
            params = {"docRef": str(doc_ref), "revisionsRef": str(frozen_ref),
                      "out": str(root / "output.pdf"), "format": "pdf"}

            def write(source_language, target):
                doc_ref.write_text(json.dumps({"document": {"language": source_language},
                                               "sourceBinding": binding}), encoding="utf-8")
                frozen["snapshot"]["targetLang"] = target
                frozen_ref.write_text(json.dumps(frozen), encoding="utf-8")

            write("zh-CN", "en")
            with self.assertRaisesRegex(server.SidecarError, "Capture configuration changed"):
                server.rebuild(params)
            write("zh-Hans", "zh")
            with self.assertRaisesRegex(server.SidecarError, "target language unsupported"):
                server.rebuild(params)
            write("zh-Hans", "en")

            def replay(_source, config, mode, records, staging):
                self.assertEqual(mode, "replay")
                self.assertEqual(config["sourceLanguage"], "zh-Hans")
                self.assertEqual(server.engine_pair(config["sourceLanguage"]), ("zh", "en"))
                self.assertEqual(records[0]["engineProjection"], "English text")
                staging.joinpath("translated.pdf").write_bytes(b"%PDF-1.7\n")
                return [{"key": record["key"]}], [], []

            with patch.object(server, "run_engine", side_effect=replay):
                result = server.rebuild(params)
            self.assertEqual(result["evidence"]["modelRequests"], 0)
            # A same-version binding with absent or legacy policy fields must
            # not masquerade as the native renderer's capture configuration.
            for field, old in (("layoutFitPolicy", None),
                               ("underscoreLinePolicy", None),
                               ("underscoreLinePolicy", "ascii-base-v1"),
                               ("underscoreLinePolicy", "ascii-base-v2")):
                with self.subTest(field=field, old=old):
                    binding["captureConfig"] = server.capture_config(None, 5, "zh-Hans")
                    if old is None:
                        del binding["captureConfig"][field]
                    else:
                        binding["captureConfig"][field] = old
                    write("zh-Hans", "en")
                    with patch.object(server, "run_engine") as engine:
                        with self.assertRaisesRegex(server.SidecarError, "Capture configuration changed|policy unsupported"):
                            server.rebuild(params)
                        engine.assert_not_called()
            binding["captureConfig"] = server.capture_config(None, 5, "zh-Hans")
            binding["captureConfig"]["layoutFitPolicy"] = "unknown"
            write("zh-Hans", "en")
            with patch.object(server, "run_engine") as engine:
                with self.assertRaisesRegex(server.SidecarError, "policy unsupported"):
                    server.rebuild(params)
                engine.assert_not_called()
            binding["captureConfig"]["layoutFitPolicy"] = server.LAYOUT_FIT_POLICY
            binding["captureConfig"]["underscoreLinePolicy"] = "unknown"
            write("zh-Hans", "en")
            with patch.object(server, "run_engine") as engine:
                with self.assertRaisesRegex(server.SidecarError, "policy unsupported"):
                    server.rebuild(params)
                engine.assert_not_called()

    def test_null_noncallback_structure_keeps_location_and_body(self):
        structure = {'key': 'layout', 'page': 0, 'bbox': [0, 0, 1, 1],
                     'sourceUnicode': None, 'layoutLabel': 'unknown'}
        body = {'key': 'body', 'sourceUnicode': 'Body text'}
        normalized = server.normalize_paragraph_sources(
            [{'key': 'body', 'requestText': 'Body text'}], [structure, body])
        self.assertEqual(len(normalized), 2)
        self.assertEqual(normalized[0]['sourceUnicode'], '')
        self.assertIsNone(normalized[0]['rawSourceUnicode'])
        self.assertEqual(normalized[0]['bbox'], structure['bbox'])
        self.assertEqual(normalized[1], body)
        raw = {**structure, 'rawExtractedText': 'Retain this text'}
        self.assertEqual(server.normalize_paragraph_sources([], [raw])[0]['sourceUnicode'],
                         'Retain this text')
        with self.assertRaises(server.SidecarError):
            server.normalize_paragraph_sources([{'key': 'body', 'requestText': None}], [body])
        with self.assertRaises(server.SidecarError):
            server.normalize_paragraph_sources([{'key': 'layout', 'requestText': 'Body'}], [structure])

    def test_overlapping_unmatched_line_is_retained(self):
        paragraph = {"page": 0, "bbox": [0, 0, 100, 100], "sourceUnicode": "Known text"}
        lines = [
            {"bbox": [10, 10, 90, 20], "spans": [{"text": "Known text", "flags": 0}]},
            {
                "bbox": [10, 10, 90, 20],
                "spans": [{"text": "Different text", "flags": 0}],
            },
        ]
        page = SimpleNamespace(
            rect=SimpleNamespace(height=100),
            get_text=lambda _mode: {"blocks": [{"lines": lines}]},
        )
        fake_pymupdf = SimpleNamespace(open=lambda _path: nullcontext([page]))
        with patch.dict("sys.modules", {"pymupdf": fake_pymupdf}):
            extras = server.unbound_pdf_lines(Path("unused.pdf"), [paragraph], None)
        self.assertEqual([item["sourceUnicode"] for item in extras], ["Different text"])

    def test_location_and_formula_display(self):
        self.assertEqual(server.display_span("2", 5), "²")
        self.assertEqual(server.display_span("x", 1), "^(x)")
        self.assertEqual(server.display_span("2", 4), "2")
        self.assertEqual(
            server.location_key(0, {"x": 1.23449, "y": 2, "x2": 3, "y2": 4}),
            "p0:1.234,2.000,3.000,4.000",
        )
        self.assertEqual(
            server.display_mapping("E <b1>- m H", "E = - m H"),
            [{"token": "<b1>", "text": "= "}],
        )

    def test_adjacent_formula_payloads_resolve_display(self):
        payloads = [
            {"type": "formula", "id": 1, "placeholder": "<b1>", "formula_chars": "x"},
            {"type": "formula", "id": 2, "placeholder": "<b2>", "formula_chars": "y"},
        ]
        self.assertEqual(
            server.display_mapping("A <b1><b2> B", "A xy B", payloads),
            [{"token": "<b1>", "text": "x"}, {"token": "<b2>", "text": "y"}],
        )

    def test_repeated_anchors_use_formula_payload(self):
        payloads = [
            {"type": "formula", "id": 1, "placeholder": "<b1>", "formula_chars": "x B y"},
            {"type": "formula", "id": 2, "placeholder": "<b2>", "formula_chars": "z"},
        ]
        self.assertEqual(
            server.display_mapping("A <b1> B <b2> C", "A x B y B z C", payloads),
            [{"token": "<b1>", "text": "x B y"}, {"token": "<b2>", "text": "z"}],
        )

    def test_rich_text_pair_has_empty_display(self):
        payloads = [{"type": "rich_text", "id": 1, "left_placeholder": "<b1>",
                     "right_placeholder": "</b1>", "composition_chars": "word"}]
        self.assertEqual(
            server.display_mapping("A <b1>word</b1> B", "A word B", payloads),
            [{"token": "<b1>", "text": ""}, {"token": "</b1>", "text": ""}],
        )
        payloads[0]["composition_chars"] = "different"
        self.assertEqual(
            server.display_mapping("A <b1>word</b1> B", "A word B", payloads),
            [{"token": "<b1>", "text": ""}, {"token": "</b1>", "text": ""}],
        )

    def test_ambiguous_mapping_falls_back_to_payload_or_literal(self):
        wrong = [{"type": "formula", "id": 1, "placeholder": "<b1>", "formula_chars": "z"}]
        self.assertEqual(server.display_mapping("A <b1> B", "A x B", wrong),
                         [{"token": "<b1>", "text": "x"}])
        adjacent = [
            {"type": "formula", "id": 1, "placeholder": "<b1>", "formula_chars": "x"},
            {"type": "formula", "id": 2, "placeholder": "<b2>", "formula_chars": "y"},
        ]
        uncertain = []
        self.assertEqual(server.display_mapping("A <b1><b2> B", "A x y B", adjacent, uncertain),
                         [{"token": "<b1>", "text": "x"}, {"token": "<b2>", "text": "y"}])
        self.assertEqual(uncertain, ["<b1> (payload)", "<b2> (payload)"])
        self.assertEqual(server.display_mapping("A <b1><b2> B", "unknown", []),
                         [{"token": "<b1>", "text": "<b1>"},
                          {"token": "<b2>", "text": "<b2>"}])
        self.assertEqual(server.display_mapping("<b1><b1> B", "unknown", [adjacent[0]]),
                         [{"token": "<b1>", "text": "<b1>"},
                          {"token": "<b1>", "text": "<b1>"}])

    def test_many_unique_literal_anchors_do_not_recurse(self):
        count = 1200
        request = "START " + "".join(f"<b{i}> K{i} " for i in range(count)) + "END"
        source = "START " + "".join(f"x K{i} " for i in range(count)) + "END"
        uncertain = []
        mapped = server.display_mapping(request, source, uncertain=uncertain)
        self.assertEqual(mapped, [
            {"token": f"<b{i}>", "text": "x"} for i in range(count)
        ])
        self.assertEqual(uncertain, [])

    def test_repeated_anchors_without_complete_match_have_bounded_fallback(self):
        request = "A " + "".join(f"<b{i}> a " for i in range(8)) + "END"
        source = "A " + "x a " * 40 + "missing"
        payloads = [{"type": "formula", "placeholder": "<b0>",
                     "formula_chars": "retained formula"}]
        uncertain = []
        with patch.object(server, "DISPLAY_MAPPING_MAX_CANDIDATES", 300):
            mapped = server.display_mapping(request, source, payloads, uncertain)
        self.assertEqual(mapped[0], {"token": "<b0>", "text": "retained formula"})
        self.assertEqual(mapped[1], {"token": "<b1>", "text": "<b1>"})
        self.assertEqual(len(mapped), 8)
        self.assertIn("literal alignment search limit reached", uncertain)
        self.assertIn("<b0> (payload)", uncertain)
        self.assertIn("<b1> (literal token)", uncertain)

    def test_search_character_budget_also_falls_back(self):
        uncertain = []
        with patch.object(server, "DISPLAY_MAPPING_MAX_SEARCH_CHARS", 2):
            mapped = server.display_mapping("A <b1> B <b2> C", "A x B y C",
                                            uncertain=uncertain)
        self.assertEqual(mapped, [{"token": "<b1>", "text": "<b1>"},
                                  {"token": "<b2>", "text": "<b2>"}])
        self.assertEqual(uncertain, ["literal alignment search limit reached",
                                     "<b1> (literal token)", "<b2> (literal token)"])

    def test_budget_exhaustion_discards_a_complete_but_unproven_solution(self):
        request = "A <b1> B <b2> C"
        source = "A x B y B z C"
        payloads = [{"type": "formula", "placeholder": "<b1>",
                     "formula_chars": "retained formula"}]
        # Both limits allow the first complete alignment, but stop the search
        # before it can discover the second one and disprove uniqueness.
        for limit, budget in (("DISPLAY_MAPPING_MAX_CANDIDATES", 1),
                              ("DISPLAY_MAPPING_MAX_SEARCH_CHARS", len(source) - 2)):
            with self.subTest(limit=limit), patch.object(server, limit, budget):
                uncertain = []
                mapped = server.display_mapping(request, source, payloads, uncertain)
                self.assertEqual(mapped, [
                    {"token": "<b1>", "text": "retained formula"},
                    {"token": "<b2>", "text": "<b2>"},
                ])
                self.assertEqual(uncertain, ["literal alignment search limit reached",
                                             "<b1> (payload)", "<b2> (literal token)"])

    def test_alignment_copies_only_a_proven_unique_result(self):
        class CountedSource(str):
            def __new__(cls, value):
                instance = super().__new__(cls, value)
                instance.slices = []
                return instance

            def __getitem__(self, key):
                if isinstance(key, slice):
                    self.slices.append(key)
                return super().__getitem__(key)

        # Repeated late anchors used to copy the long prefix on every dead end.
        # Keep the fixture small and count slices rather than stressing memory.
        source = CountedSource("x" * 10_000 + "A" * 200 + "Z")
        mapped = server.display_mapping("<b0>A<b1>MISSING<b2>Z", source)
        self.assertEqual([item["text"] for item in mapped], ["<b0>", "<b1>", "<b2>"])
        self.assertEqual(source.slices, [])

        for limit, budget in ((None, None), ("DISPLAY_MAPPING_MAX_CANDIDATES", 1),
                              ("DISPLAY_MAPPING_MAX_SEARCH_CHARS", 6)):
            with self.subTest(limit=limit, budget=budget):
                source = CountedSource("xAyAzZ")
                scope = patch.object(server, limit, budget) if limit else nullcontext()
                with scope:
                    mapped = server.display_mapping("<b0>A<b1>Z", source)
                self.assertEqual([item["text"] for item in mapped], ["<b0>", "<b1>"])
                self.assertEqual(source.slices, [])

        source = CountedSource("xAyZ")
        self.assertEqual(server.display_mapping("<b0>A<b1>Z", source),
                         [{"token": "<b0>", "text": "x"}, {"token": "<b1>", "text": "y"}])
        self.assertEqual(source.slices, [slice(0, 1), slice(2, 3)])


    def test_pdf_text_check_keeps_punctuation_and_checks_formulas(self):
        records = [{"unitId": "u1", "page": 0, "text": "A x... B",
                    "engineProjection": "A <b1>... B"}]
        self.assertEqual(server.pdf_text_checks(records, ["A x ... B"])[0]["present"], True)
        self.assertEqual(server.pdf_text_checks(records, ["A x… B"])[0]["present"], False)

    def test_capture_warns_on_fallback_with_location(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as directory:
            path = Path(directory) / "formula.pdf"
            path.write_bytes(b"%PDF-1.7\n")
            box = [1, 2, 3, 4]
            key = server.location_key(0, dict(zip(("x", "y", "x2", "y2"), box)))
            paragraph = {"page": 0, "bbox": box, "key": key,
                         "sourceUnicode": "A x y B", "layoutLabel": "plain text"}
            call = {**paragraph, "requestText": "A <b1><b2> B", "placeholderPayloads": [
                {"type": "formula", "placeholder": "<b1>", "formula_chars": "x"},
                {"type": "formula", "placeholder": "<b2>", "formula_chars": "y"},
            ]}
            with patch.object(server, "run_engine", return_value=([call], [paragraph], [])), \
                 patch.object(server, "unbound_pdf_lines", return_value=[]):
                parsed = server.parse({"path": str(path), "options": {"language": "en"}})
            record = parsed["doc"]["sourceBinding"]["records"][0]
            self.assertEqual(record["placeholders"],
                             [{"token": "<b1>", "text": "x"}, {"token": "<b2>", "text": "y"}])
            self.assertIn(f"page 1, {key} used fallback", parsed["doc"]["warnings"][0])

    def test_capture_records_alignment_limit_warning(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as directory:
            path = Path(directory) / "formula.pdf"
            path.write_bytes(b"%PDF-1.7\n")
            paragraph = {"page": 0, "bbox": [1, 2, 3, 4], "key": "p0:limit",
                         "sourceUnicode": "A x B y C", "layoutLabel": "plain text"}
            call = {**paragraph, "requestText": "A <b1> B <b2> C",
                    "placeholderPayloads": []}
            with patch.object(server, "DISPLAY_MAPPING_MAX_SEARCH_CHARS", 2), \
                 patch.object(server, "run_engine", return_value=([call], [paragraph], [])), \
                 patch.object(server, "unbound_pdf_lines", return_value=[]):
                parsed = server.parse({"path": str(path), "options": {"language": "en"}})
            self.assertEqual(parsed["doc"]["sourceBinding"]["records"][0]["placeholders"],
                             [{"token": "<b1>", "text": "<b1>"},
                              {"token": "<b2>", "text": "<b2>"}])
            self.assertTrue(any("p0:limit used fallback: literal alignment search limit reached"
                                in warning for warning in parsed["doc"]["warnings"]))

    def test_rebuild_preflight_rejects_changed_source_and_placeholders(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as directory:
            root = Path(directory)
            source = root / "source.pdf"
            source.write_bytes(b"%PDF-1.7\n")
            record = {
                "order": 0,
                "page": 0,
                "bbox": [0, 0, 1, 1],
                "key": "p0:0.000,0.000,1.000,1.000",
                "requestText": "E <b1>- m H",
                "sourceUnicode": "E = - m H",
                "placeholders": [{"token": "<b1>", "text": "= "}],
                "callback": True,
            }
            binding = {
                "adapterId": "babeldoc",
                "engineVersion": server.ENGINE_VERSION,
                "sourcePath": str(source),
                "captureConfig": server.capture_config(None, 5),
                "records": [record],
            }
            doc_ref = root / "source.json"
            revision_ref = root / "snapshot.json"
            doc_ref.write_text(
                json.dumps({"document": {"language": "en"}, "sourceBinding": binding}),
                encoding="utf-8",
            )
            frozen = {
                "snapshot": {"targetLang": "zh"},
                "units": [
                    {
                        "unit": {
                            "id": "test",
                            "order": 0,
                            "sourceText": record["requestText"],
                        },
                        "decision": {"type": "revision"},
                        "text": record["requestText"],
                    }
                ],
            }
            params = {
                "docRef": str(doc_ref),
                "revisionsRef": str(revision_ref),
                "out": str(root / "out.pdf"),
                "format": "pdf",
            }

            frozen["units"][0]["unit"]["sourceText"] = "changed"
            revision_ref.write_text(json.dumps(frozen), encoding="utf-8")
            with self.assertRaisesRegex(
                server.SidecarError, "Frozen source text changed"
            ):
                server.rebuild(params)

            frozen["units"][0]["unit"]["sourceText"] = record["requestText"]
            frozen["units"][0]["text"] = "E - m H"
            revision_ref.write_text(json.dumps(frozen), encoding="utf-8")
            with self.assertRaisesRegex(
                server.SidecarError, "Placeholder order mismatch"
            ):
                server.rebuild(params)

            frozen["units"][0]["text"] = record["requestText"]
            frozen["units"][0]["decision"]["type"] = "skip"
            revision_ref.write_text(json.dumps(frozen), encoding="utf-8")

            def replay(_source, _config, _mode, records, staging):
                self.assertEqual(records[0]["engineProjection"], record["requestText"])
                self.assertEqual(records[0]["text"], record["sourceUnicode"])
                staging.joinpath("translated.pdf").write_bytes(b"%PDF-1.7\n")
                return [dict(key=record["key"])], [], []

            with patch.object(server, "run_engine", side_effect=replay):
                result = server.rebuild(params)
            self.assertEqual(result["evidence"]["modelRequests"], 0)
            self.assertEqual(Path(params["out"]).read_bytes(), b"%PDF-1.7\n")

            Path(params["out"]).unlink()
            record["placeholders"] = [{"token": "<b1>", "text": None}]
            doc_ref.write_text(
                json.dumps({"document": {"language": "en"}, "sourceBinding": binding}),
                encoding="utf-8",
            )

            def replay_unmapped(_source, _config, _mode, records, staging):
                self.assertEqual(records[0]["engineProjection"], record["requestText"])
                self.assertEqual(records[0]["text"], record["requestText"])
                staging.joinpath("translated.pdf").write_bytes(b"%PDF-1.7\n")
                return [dict(key=record["key"])], [], [
                    {"unitId": "test", "page": 0, "present": False,
                     "reason": "PDF text extraction did not show expanded accepted text"}
                ]

            with patch.object(server, "run_engine", side_effect=replay_unmapped):
                result = server.rebuild(params)
            self.assertEqual(len(result["evidence"]["warnings"]), 2)
            self.assertIn("retained literal token", result["evidence"]["warnings"][0])
            self.assertIn("visual review needed", result["evidence"]["warnings"][1])

            Path(params["out"]).unlink()
            record["placeholders"] = []
            doc_ref.write_text(
                json.dumps({"document": {"language": "en"}, "sourceBinding": binding}),
                encoding="utf-8",
            )
            frozen["units"][0]["decision"]["type"] = "revision"
            frozen["units"][0]["text"] = "E - m H"
            revision_ref.write_text(json.dumps(frozen), encoding="utf-8")
            with self.assertRaisesRegex(server.SidecarError, "Placeholder order mismatch"):
                server.rebuild(params)

            frozen["units"][0]["decision"]["type"] = "skip"
            frozen["units"][0]["text"] = "different <b1>- m H"
            revision_ref.write_text(json.dumps(frozen), encoding="utf-8")
            with self.assertRaisesRegex(server.SidecarError, "Skipped source text changed"):
                server.rebuild(params)

            frozen["units"][0]["text"] = record["requestText"]
            frozen["units"][0]["decision"]["type"] = "keepOriginal"
            revision_ref.write_text(json.dumps(frozen), encoding="utf-8")
            with self.assertRaisesRegex(server.SidecarError, "Frozen decision"):
                server.rebuild(params)

    def test_run_directory_removed_after_success_and_failure(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as directory:
            root = Path(directory)
            session = root / "ivoraige-babeldoc-test"
            session.mkdir()
            cache = session / ".cache" / "babeldoc"
            cache.mkdir(parents=True)
            cache.joinpath("retained").write_text("shared", encoding="utf-8")
            output = root / "published.pdf"
            output.write_bytes(b"published")

            def fake_engine(*_args):
                task_work = session / "run-1"
                task_work.mkdir()
                task_work.joinpath("temporary").write_text("work", encoding="utf-8")
                server.STATE["active_run_work"] = task_work
                if failing:
                    raise RuntimeError("engine failed")
                return [], [], []

            with patch.dict(server.STATE, {}, clear=True):
                with patch.object(server, "_run_engine", side_effect=fake_engine):
                    for failing in (False, True):
                        if failing:
                            with self.assertRaisesRegex(RuntimeError, "engine failed"):
                                server.run_engine(Path("source.pdf"), {}, "capture")
                        else:
                            server.run_engine(Path("source.pdf"), {}, "capture")
                        self.assertFalse((session / "run-1").exists())
            self.assertEqual(cache.joinpath("retained").read_text(encoding="utf-8"), "shared")
            self.assertEqual(output.read_bytes(), b"published")

    def test_engine_input_uses_short_stem_and_preserves_managed_source(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / ("a" * 64 + "-" + "b" * 64 + ".pdf")
            source.write_bytes(b"%PDF-original")
            staged = server.stage_engine_input(source, root / "run-1")
            self.assertEqual(staged.name, "input.pdf")
            self.assertEqual(staged.read_bytes(), source.read_bytes())
            staged.write_bytes(b"derived")
            self.assertEqual(source.read_bytes(), b"%PDF-original")

    def test_cleanup_failure_does_not_replace_engine_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            def failing_engine(*_args):
                server.STATE["active_run_work"] = root
                raise ValueError("original engine save failure")
            with patch.dict(server.STATE, {}, clear=True), \
                    patch.object(server, "_run_engine", side_effect=failing_engine), \
                    patch.object(server.shutil, "rmtree", side_effect=PermissionError("held PDF")), \
                    patch.object(server.traceback, "print_exc") as log:
                with self.assertRaisesRegex(ValueError, "original engine save failure"):
                    server.run_engine(Path("source.pdf"), {}, "replay")
                log.assert_called_once()

    def test_only_input_pdf_documents_are_owned_by_engine(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as directory:
            source = Path(directory) / "source.pdf"
            other = Path(directory) / "other.pdf"
            made = []
            owned = []

            class Document:
                def __init__(self, path):
                    self.path = path
                    self.is_closed = False

                def close(self):
                    self.is_closed = True

            def constructor(path):
                item = Document(path)
                made.append(item)
                return item

            open_document = server.source_document_factory(constructor, source, owned)
            first = open_document(source)
            second = open_document(str(other))
            third = open_document(str(source))
            self.assertEqual(owned, [first, third])
            self.assertEqual(made, [first, second, third])
            server.close_source_documents(owned)
            self.assertTrue(first.is_closed)
            self.assertTrue(third.is_closed)
            self.assertFalse(second.is_closed)


class ProtocolDiagnosticTests(unittest.TestCase):
    def test_error_diagnostic_is_bounded_correlated_and_separate_from_public_data(self):
        requests = [{"jsonrpc": "2.0", "id": i, "method": "parse"} for i in range(3)]
        output, stderr = StringIO(), StringIO()
        failures = [RuntimeError("private first"), RuntimeError("x" * 5000 + "private second"), {"ok": True}]
        with patch.object(server.sys, "stdin", StringIO("\n".join(map(json.dumps, requests)))), \
             patch.object(server.sys, "stderr", stderr), patch.object(server, "OUTPUT", output), \
             patch.object(server, "dispatch", side_effect=failures), patch.dict(server.STATE, {}, clear=True):
            server.main()
        messages = [json.loads(line) for line in output.getvalue().splitlines()]
        self.assertEqual([m["id"] for m in messages], [0, 1, 2])
        for i, suffix in enumerate(["private first", "private second"]):
            error = messages[i]["error"]
            self.assertTrue(error["diagnostic"].endswith(suffix + "\n"))
            self.assertLessEqual(len(error["diagnostic"]), 4096)
            self.assertEqual(error["data"], {"code": "UPSTREAM_FAILURE"})
        self.assertNotIn("private first", messages[1]["error"]["diagnostic"])
        self.assertEqual(messages[2]["result"], {"ok": True})
        self.assertNotIn("error", messages[2])
        self.assertIn("Traceback", stderr.getvalue())


if __name__ == "__main__":
    unittest.main()
