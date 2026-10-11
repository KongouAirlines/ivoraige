"""Fast preflight tests; no BabelDOC import, model, or asset download."""

import json
import tempfile
import unittest
from contextlib import nullcontext
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import server


class BindingTests(unittest.TestCase):
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

    def test_completed_callbacks_keep_payloads_by_location(self):
        first = {"key": "p0:first", "preparedInput": "A <b1> B",
                 "placeholderPayloads": [{"type": "formula", "placeholder": "<b1>",
                                           "formula_chars": "x"}]}
        second = {"key": "p0:second", "preparedInput": "A <b1> B",
                  "placeholderPayloads": [{"type": "formula", "placeholder": "<b1>",
                                            "formula_chars": "y"}]}
        calls = [{"key": "p0:second", "requestText": "A <b1> B"},
                 {"key": "p0:first", "requestText": "A <b1> B"}]
        server.complete_callbacks(calls, [first, second])
        self.assertEqual(calls[0]["placeholderPayloads"][0]["formula_chars"], "y")
        self.assertEqual(calls[1]["placeholderPayloads"][0]["formula_chars"], "x")

        second["preparedInput"] = "changed"
        server.complete_callbacks(calls, [first, second])
        self.assertEqual(calls[0]["placeholderPayloads"], [])
        self.assertIn("tracker missing or changed", calls[0]["payloadWarning"])

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


if __name__ == "__main__":
    unittest.main()
