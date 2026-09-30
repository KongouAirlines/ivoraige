"""M3-1 BabelDOC 0.6.4 capture/replay boundary for an existing accepted manifest.

All output stays below --run-dir. A replay is published only after every expected
record was used exactly once and its accepted text appears on the expected page.
"""

import argparse
from dataclasses import asdict
import json
import os
from pathlib import Path
import re
import sys
import threading
import time


ROOT = Path(__file__).resolve().parents[2]


def location_key(page, box):
    # BabelDOC PDF coordinates use a bottom-left origin; never depend on dict order.
    return f"p{page}:" + ",".join(f"{box[name]:.3f}" for name in ("x", "y", "x2", "y2"))


def normalize_pdf_text(value):
    return "".join(char for char in value if not char.isspace() and ord(char) >= 32)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=("capture", "replay"))
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--run-dir", type=Path, required=True)
    parser.add_argument("--records", type=Path)
    parser.add_argument("--assets", type=Path, default=Path.home() / ".cache/babeldoc")
    parser.add_argument("--pages", help="One-based PDF page selection, e.g. 1 or 1,2,4")
    parser.add_argument("--min-text-length", type=int, default=5)
    parser.add_argument("--cancel-file", type=Path, help="If present, stop accepting later callbacks and do not publish")
    parser.add_argument("--callback-pause-ms", type=int, default=0, help="Diagnostic pause used to exercise cancellation during replay")
    args = parser.parse_args()
    if args.callback_pause_ms < 0 or args.callback_pause_ms > 5000:
        parser.error("--callback-pause-ms must be between 0 and 5000")
    cancel_file = args.cancel_file.resolve() if args.cancel_file else None
    if args.mode == "replay" and not args.records:
        parser.error("replay requires --records")
    run_dir = args.run_dir.resolve()
    if ROOT not in run_dir.parents:
        parser.error("--run-dir must be inside this project")
    input_pdf = args.input.resolve(strict=True)
    assets = args.assets.resolve(strict=True)
    run_dir.mkdir(parents=True, exist_ok=True)
    staging = run_dir / "staging"
    published = run_dir / "published"
    if published.exists():
        parser.error(f"published output already exists: {published}")
    if staging.exists():
        parser.error(f"staging output already exists; choose a new --run-dir: {staging}")
    staging.mkdir()

    # Only BabelDOC's writable cache/database lives in the project run directory.
    # Its Windows font/PDF worker starts a fresh Python process and imports const.
    os.environ["USERPROFILE"] = str(run_dir)
    import babeldoc.const as const

    if const.__version__ != "0.6.4":
        raise RuntimeError(f"BabelDOC 0.6.4 required, found {const.__version__}")
    const.CACHE_FOLDER = run_dir / ".cache" / "babeldoc"
    const.CACHE_FOLDER.mkdir(parents=True, exist_ok=True)

    def cache_path(filename, sub_folder=None):
        existing = assets / (sub_folder or "") / filename
        if existing.is_file():
            return existing
        writable = const.CACHE_FOLDER / (sub_folder or "") / filename
        writable.parent.mkdir(parents=True, exist_ok=True)
        return writable

    const.get_cache_file_path = cache_path
    os.environ["TIKTOKEN_CACHE_DIR"] = str(assets / "tiktoken")

    import pymupdf
    if sys.version_info[:2] != (3, 13) or pymupdf.VersionBind != "1.26.7":
        raise RuntimeError("Fixed Python 3.13 / PyMuPDF 1.26.7 environment required")
    from babeldoc.docvision.doclayout import OnnxModel
    from babeldoc.format.pdf.document_il.midend.il_translator import ILTranslator
    from babeldoc.format.pdf.high_level import translate, do_translate as run_pipeline, get_translation_stage
    from babeldoc.format.pdf.translation_config import TranslationConfig, WatermarkOutputMode
    from babeldoc.progress_monitor import ProgressMonitor
    from babeldoc.translator.translator import BaseTranslator

    manifest = json.loads(args.records.read_text(encoding="utf-8")) if args.records else None
    if isinstance(manifest, dict):
        source = manifest.get("pdfSource") or {}
        if Path(source.get("sourcePdf", "")).resolve() != input_pdf:
            raise ValueError("Accepted manifest source PDF differs from input")
        fixed = source.get("captureConfig", {})
        required = {"babeldoc": "0.6.4", "python": "3.13", "pymupdf": "1.26.7",
                    "min_text_length": args.min_text_length,
                    "layout_model": "doclayout_yolo_docstructbench_imgsz1024.onnx",
                    "disable_rich_text_translate": True, "auto_extract_glossary": False,
                    "auto_enable_ocr_workaround": False, "page_mode": "one page per process"}
        if any(fixed.get(key) != value for key, value in required.items()):
            raise ValueError("Accepted manifest capture configuration differs from replay")
        if not args.pages or sorted(source.get("pages", [])) != sorted(int(page) for page in args.pages.split(",")):
            raise ValueError("Accepted manifest pages differ from replay")
        for unit in manifest["units"]:
            placeholders = unit["placeholders"]
            expected = [token for item in placeholders for token in re.findall(r"</?b\d+>", item["placeholder"])]
            actual = re.findall(r"</?b\d+>", unit["engineProjection"])
            display = unit["placeholderDisplay"]
            approved = unit.get("placeholderOrder") or expected
            if sorted(approved) != sorted(expected) or actual != approved or len(display) != len(expected) or any(not isinstance(value, str) or not value for value in display):
                raise ValueError(f"Invalid accepted placeholders: {unit['unitId']}")
            if approved != expected and not unit.get("placeholderOrderReason"):
                raise ValueError(f"Unexplained PDF placeholder correction: {unit['unitId']}")
            by_token = dict(zip(expected, display))
            suffix = unit.get("pdfUncalledSuffix") or {}
            if suffix and not all(isinstance(suffix.get(field), str) and suffix[field] for field in ("fragment", "key", "reason")):
                raise ValueError(f"Invalid PDF uncalled suffix binding: {unit['unitId']}")
            readable = re.sub(r"</?b\d+>", lambda match: by_token[match.group()], unit["engineProjection"]) + suffix.get("fragment", "")
            if readable != unit["text"]:
                raise ValueError(f"Accepted readable projection differs: {unit['unitId']}")
            if unit.get("pdfSourceRegionRestoration") and unit["engineProjection"] != unit["source"]:
                raise ValueError(f"Source region restoration requires original target: {unit['unitId']}")
            field = unit.get("pdfFieldLabel")
            if field and (unit.get("kind") != "field_list_item" or not field.get("text") or
                          not field.get("reason") or field["text"] not in unit["text"]):
                raise ValueError(f"Invalid translated PDF field label: {unit['unitId']}")
        records = [{"page": unit["location"]["pdfPage"] - 1,
                    "box": dict(zip(("x", "y", "x2", "y2"), unit["sourceBinding"]["box_pdf_bottom_left_xyxy"])),
                    "key": unit["sourceBinding"]["key"], "request_text": unit["source"],
                    "target": unit["text"], "replay_target": unit["engineProjection"],
                    "record_id": unit["unitId"], "revision": unit["revisionId"],
                    "status": "accepted"} for unit in manifest["units"]]
    else:
        records = manifest or []
    by_key = {}
    for record in records:
        key = location_key(record["page"], record["box"])
        if key != record["key"] or key in by_key:
            raise ValueError(f"Invalid or duplicate manifest location: {key}")
        if record.get("status") not in ("accepted", "accepted_fixture"):
            raise ValueError(f"Record is not accepted: {key}")
        by_key[key] = record
    if isinstance(manifest, dict) and len(records) != len({record["record_id"] for record in records}):
        raise ValueError("Duplicate accepted unit")

    local = threading.local()
    paragraphs_seen = []
    original = ILTranslator.translate_paragraph

    def located(self, paragraph, page, *positional, **keyword):
        previous = getattr(local, "location", None)
        local.location = {
            "page": page.page_number,
            "box": asdict(paragraph.box),
            "source_unicode": paragraph.unicode,
            "paragraph_id": paragraph.debug_id,  # diagnostic only; random across runs
        }
        seen = {**local.location, "key": location_key(page.page_number, asdict(paragraph.box)),
                "layout_label": paragraph.layout_label}
        paragraphs_seen.append(seen)
        try:
            return original(self, paragraph, page, *positional, **keyword)
        finally:
            tracker = keyword.get("tracker") or (positional[1] if len(positional) > 1 else None)
            if tracker is not None:
                seen["prepared_input"] = getattr(tracker, "input", None)
                seen["placeholders"] = [item.to_dict() for item in getattr(tracker, "placeholders", [])]
            local.location = previous

    class AcceptedTranslator(BaseTranslator):
        name = "ivoraige-accepted"
        model = "accepted-manifest"

        def __init__(self):
            super().__init__("en", "zh", True)  # ignore BabelDOC translation cache
            self.calls = []
            self.errors = []
            self.used = set()

        def do_llm_translate(self, text, rate_limit_params=None):
            raise NotImplementedError("No LLM translation capability")

        def get_formular_placeholder(self, placeholder_id):
            return f"<b{placeholder_id}>", f"<b{placeholder_id}>"

        def get_rich_text_left_placeholder(self, placeholder_id):
            return f"<b{placeholder_id}>", f"<b{placeholder_id}>"

        def get_rich_text_right_placeholder(self, placeholder_id):
            return f"</b{placeholder_id}>", f"</b{placeholder_id}>"

        def do_translate(self, text, rate_limit_params=None):
            if cancel_file and cancel_file.exists():
                self.errors.append({"reason": "cancelled"})
                raise RuntimeError("PDF replay cancelled")
            position = getattr(local, "location", None)
            if position is None:
                self.errors.append({"reason": "missing location", "request_text": text})
                raise ValueError("Missing BabelDOC location")
            key = location_key(position["page"], position["box"])
            call = dict(position, key=key, request_text=text)
            self.calls.append(call)
            if cancel_file:
                (run_dir / "live-callback-count.txt").write_text(str(len(self.calls)), encoding="ascii")
            if args.callback_pause_ms:
                time.sleep(args.callback_pause_ms / 1000)
            if cancel_file and cancel_file.exists():
                self.errors.append({"reason": "cancelled during callback", **call})
                raise RuntimeError("PDF replay cancelled")
            if args.mode == "capture":
                return text
            record = by_key.get(key)
            if key in self.used or record is None or record["request_text"] != text:
                self.errors.append({"reason": "duplicate or unmapped request", **call})
                raise ValueError(f"Invalid replay request: {key}")
            self.used.add(key)
            call.update(record_id=record["record_id"], revision=record["revision"])
            return record.get("replay_target", record["target"])

    engine = AcceptedTranslator()
    ILTranslator.translate_paragraph = located  # local to this dedicated process
    try:
        config = TranslationConfig(
            translator=engine, input_file=input_pdf, lang_in="en", lang_out="zh",
            doc_layout_model=OnnxModel(str(assets / "models/doclayout_yolo_docstructbench_imgsz1024.onnx")),
            output_dir=staging, working_dir=run_dir / "work", debug=False,
            no_dual=True, watermark_output_mode=WatermarkOutputMode.NoWatermark,
            auto_extract_glossary=False, auto_enable_ocr_workaround=False,
            skip_scanned_detection=True, disable_rich_text_translate=True,
            pool_max_workers=1, qps=100, min_text_length=args.min_text_length,
            pages=args.pages,
        )
        if cancel_file:
            cancel_event = threading.Event()
            watcher_done = threading.Event()

            def watch_cancel():
                while not watcher_done.wait(0.25):
                    if cancel_file.exists():
                        cancel_event.set()
                        return

            watcher = threading.Thread(target=watch_cancel, daemon=True)
            watcher.start()
            try:
                with ProgressMonitor(get_translation_stage(config), cancel_event=cancel_event,
                                     finish_callback=lambda **_event: None) as progress:
                    result = run_pipeline(progress, config)
            finally:
                watcher_done.set()
                watcher.join(timeout=1)
        else:
            result = translate(config)
    finally:
        ILTranslator.translate_paragraph = original
        (run_dir / "calls.json").write_text(json.dumps(engine.calls, ensure_ascii=False, indent=2), encoding="utf-8")
        (run_dir / "errors.json").write_text(json.dumps(engine.errors, ensure_ascii=False, indent=2), encoding="utf-8")
        called = {call["key"] for call in engine.calls}
        (run_dir / "paragraphs.json").write_text(json.dumps([
            {**item, "callback": item["key"] in called} for item in paragraphs_seen
        ], ensure_ascii=False, indent=2), encoding="utf-8")

    if args.mode == "capture":
        if engine.errors or not engine.calls or len({call["key"] for call in engine.calls}) != len(engine.calls):
            raise RuntimeError("Capture produced callback errors, no requests or duplicate locations")
        (run_dir / "capture.json").write_text(json.dumps(engine.calls, ensure_ascii=False, indent=2), encoding="utf-8")
        return

    if cancel_file and cancel_file.exists():
        raise RuntimeError("PDF replay cancelled; accepted records remain intact")
    missing = sorted(by_key.keys() - engine.used)
    if engine.errors or missing or len(engine.calls) != len(records):
        raise RuntimeError(f"Replay incomplete: {len(engine.errors)} callback errors, {len(missing)} unused records")
    field_checks = {}
    if isinstance(manifest, dict):
        for unit in manifest["units"]:
            suffix = unit.get("pdfUncalledSuffix")
            if suffix:
                matches = [item for item in paragraphs_seen
                           if item["key"] == suffix["key"] and
                           item.get("prepared_input") == suffix["fragment"] and
                           item["source_unicode"] == suffix["fragment"]]
                if len(matches) != 1 or suffix["key"] in {call["key"] for call in engine.calls}:
                    raise RuntimeError(f"PDF uncalled suffix changed: {unit['unitId']}")
        restored = [unit for unit in manifest["units"] if unit.get("pdfUncalledSuffix") or unit.get("pdfSourceRegionRestoration") or unit.get("pdfFieldLabel")]
        if restored:
            # BabelDOC reflows the callback and leaves the single-letter tail
            # at its original coordinate, separating an email address. Restore
            # that exact source region as a structural, non-model correction.
            repaired = Path(result.mono_pdf_path).with_name("paired-footnote.pdf")
            with pymupdf.open(result.mono_pdf_path) as output, pymupdf.open(input_pdf) as source_pdf:
                for unit in restored:
                    page_index = unit["location"]["pdfPage"] - 1
                    page = output[page_index]
                    box = unit["sourceBinding"]["box_pdf_bottom_left_xyxy"]
                    if unit.get("pdfUncalledSuffix"):
                        tail = [float(value) for value in unit["pdfUncalledSuffix"]["key"].split(":", 1)[1].split(",")]
                        rect = pymupdf.Rect(min(box[0], tail[0]) - 2, page.rect.height - max(box[3], tail[3]) - 2,
                                            max(box[2], tail[2]) + 2, page.rect.height - min(box[1], tail[1]) + 2)
                    else:
                        rect = pymupdf.Rect(box[0] - 2, page.rect.height - box[3] - 2,
                                            box[2] + 2, page.rect.height - box[1] + 2)
                    page.add_redact_annot(rect, fill=(1, 1, 1))
                    page.apply_redactions()
                    if unit.get("pdfFieldLabel"):
                        spans = [span for block in source_pdf[page_index].get_text("dict")["blocks"]
                                 for line in block.get("lines", []) for span in line["spans"]
                                 if pymupdf.Rect(span["bbox"]).intersects(rect)]
                        arrows = [span for span in spans if "⃗" in span["text"]]
                        if len(arrows) != 1:
                            raise RuntimeError(f"Expected one source vector arrow in field row: {unit['unitId']}")
                        formula_x = arrows[0]["bbox"][0] - 2
                        bullet = pymupdf.Rect(rect.x0, rect.y0, 76, rect.y1)
                        formula = pymupdf.Rect(formula_x, rect.y0, rect.x1, rect.y1)
                        field_checks[unit["unitId"]] = {"page": page_index, "rect": formula,
                                                       "source_formula": normalize_pdf_text(source_pdf[page_index].get_text(clip=formula)),
                                                       "label": unit["pdfFieldLabel"]["text"]}
                        page.show_pdf_page(bullet, source_pdf, page_index, clip=bullet, overlay=True)
                        page.show_pdf_page(formula, source_pdf, page_index, clip=formula, overlay=True)
                        label = unit["pdfFieldLabel"]["text"]
                        source_line = next((span for span in spans if span["bbox"][0] >= 74 and span["bbox"][0] < formula_x and "ﬁeld" in span["text"]), None)
                        if source_line is None:
                            raise RuntimeError(f"Missing source field label baseline: {unit['unitId']}")
                        font = pymupdf.Font("china-s")
                        size = min(10, 0.95 * (formula_x - 78) / font.text_length(label, fontsize=1))
                        if size < 7:
                            raise RuntimeError(f"Translated field label does not fit: {unit['unitId']}")
                        page.insert_text((77, source_line["origin"][1]), label, fontname="china-s", fontsize=size)
                    else:
                        page.show_pdf_page(rect, source_pdf, page_index, clip=rect, overlay=True)
                output.save(repaired)
            os.replace(repaired, result.mono_pdf_path)
    with pymupdf.open(result.mono_pdf_path) as pdf:
        checks = []
        for record in records:
            page_text = normalize_pdf_text(pdf[record["page"]].get_text())
            if record["record_id"] in field_checks:
                field = field_checks[record["record_id"]]
                formula_text = normalize_pdf_text(pdf[field["page"]].get_text(clip=field["rect"]))
                present = (normalize_pdf_text(field["label"]) in page_text and
                           field["source_formula"] and formula_text == field["source_formula"])
                check_kind = "translated_label_and_exact_source_formula_region"
            elif isinstance(manifest, dict) and re.search(r"</?b\d+>", record["replay_target"]):
                # PDF glyph extraction may flatten a faithfully preserved
                # superscript/subscript differently from the readable export.
                parts = [normalize_pdf_text(part) for part in re.split(r"</?b\d+>", record["replay_target"])]
                anchors = [part for part in parts if part]
                cursor = 0
                present = bool(anchors)
                for part in anchors:
                    found = page_text.find(part, cursor)
                    if found < 0:
                        present = False
                        break
                    cursor = found + len(part)
                check_kind = "ordered_literal_segments_around_structural_placeholders"
            else:
                present = normalize_pdf_text(record["target"]) in page_text
                check_kind = "complete_text"
            checks.append({"record_id": record["record_id"], "page": record["page"],
                           "present": present, "check_kind": check_kind})
    if not all(check["present"] for check in checks):
        raise RuntimeError(f"Accepted text absent from output PDF: {checks}")
    if isinstance(manifest, dict):
        (staging / "translations.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        (staging / "translations.md").write_text(
            f"# {manifest['title']}\n\n<!-- document:{manifest['documentId']} revision:{manifest['documentRevision']} -->\n\n" +
            "\n\n".join(f"<!-- unit:{unit['unitId']} source-revision:{unit['sourceRevision']} revision:{unit['revisionId']} -->\n{unit['text']}" for unit in manifest["units"]) + "\n", encoding="utf-8")
    else:
        (staging / "translations.json").write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding="utf-8")
        (staging / "translations.md").write_text("\n\n".join(
            f"<!-- {record['record_id']} r{record['revision']} {record['key']} -->\n{record['target']}"
            for record in records), encoding="utf-8")
    (staging / "evidence.json").write_text(json.dumps({
        "babeldoc_version": const.__version__, "adapter_requests": len(engine.calls),
        "model_requests": 0, "cache_hits": engine.translate_cache_call_count,
        "records": checks,
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    staging.rename(published)
    print(published)


if __name__ == "__main__":
    main()
