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


if __name__ == "__main__":
    unittest.main()
