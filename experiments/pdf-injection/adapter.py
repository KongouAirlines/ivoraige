"""M3-1 BabelDOC 0.6.4 capture/replay boundary for an existing accepted manifest.

All output stays below --run-dir. A replay is published only after every expected
record was used exactly once and its accepted text appears on the expected page.
"""

import argparse
from dataclasses import asdict
import json
import os
from pathlib import Path
import sys
import threading


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
    args = parser.parse_args()
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
    from babeldoc.docvision.doclayout import OnnxModel
    from babeldoc.format.pdf.document_il.midend.il_translator import ILTranslator
    from babeldoc.format.pdf.high_level import translate
    from babeldoc.format.pdf.translation_config import TranslationConfig, WatermarkOutputMode
    from babeldoc.translator.translator import BaseTranslator

    records = json.loads(args.records.read_text(encoding="utf-8")) if args.records else []
    by_key = {}
    for record in records:
        key = location_key(record["page"], record["box"])
        if key != record["key"] or key in by_key:
            raise ValueError(f"Invalid or duplicate manifest location: {key}")
        if record.get("status") not in ("accepted", "accepted_fixture"):
            raise ValueError(f"Record is not accepted: {key}")
        by_key[key] = record

    local = threading.local()
    original = ILTranslator.translate_paragraph

    def located(self, paragraph, page, *positional, **keyword):
        previous = getattr(local, "location", None)
        local.location = {
            "page": page.page_number,
            "box": asdict(paragraph.box),
            "source_unicode": paragraph.unicode,
            "paragraph_id": paragraph.debug_id,  # diagnostic only; random across runs
        }
        try:
            return original(self, paragraph, page, *positional, **keyword)
        finally:
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
            position = getattr(local, "location", None)
            if position is None:
                self.errors.append({"reason": "missing location", "request_text": text})
                raise ValueError("Missing BabelDOC location")
            key = location_key(position["page"], position["box"])
            call = dict(position, key=key, request_text=text)
            self.calls.append(call)
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
            pool_max_workers=1, qps=100, min_text_length=5,
        )
        result = translate(config)
    finally:
        ILTranslator.translate_paragraph = original
        (run_dir / "calls.json").write_text(json.dumps(engine.calls, ensure_ascii=False, indent=2), encoding="utf-8")
        (run_dir / "errors.json").write_text(json.dumps(engine.errors, ensure_ascii=False, indent=2), encoding="utf-8")

    if args.mode == "capture":
        if engine.errors or not engine.calls or len({call["key"] for call in engine.calls}) != len(engine.calls):
            raise RuntimeError("Capture produced callback errors, no requests or duplicate locations")
        (run_dir / "capture.json").write_text(json.dumps(engine.calls, ensure_ascii=False, indent=2), encoding="utf-8")
        return

    missing = sorted(by_key.keys() - engine.used)
    if engine.errors or missing or len(engine.calls) != len(records):
        raise RuntimeError(f"Replay incomplete: {len(engine.errors)} callback errors, {len(missing)} unused records")
    with pymupdf.open(result.mono_pdf_path) as pdf:
        checks = [{"record_id": record["record_id"], "page": record["page"],
                   "present": normalize_pdf_text(record["target"]) in normalize_pdf_text(pdf[record["page"]].get_text())}
                  for record in records]
    if not all(check["present"] for check in checks):
        raise RuntimeError(f"Accepted text absent from output PDF: {checks}")
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
