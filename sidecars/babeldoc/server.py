"""BabelDOC 0.6.4 PDF capture/replay over line-delimited JSON-RPC 2.0.

The only stdout writes are protocol messages. BabelDOC runs in this dedicated
process; it has no translation model, credentials, or download path.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import socket
import sys
import tempfile
import threading
import traceback
from contextlib import redirect_stdout
from dataclasses import asdict
from pathlib import Path

PROTOCOL_VERSION = 1
ENGINE_VERSION = "0.6.4"
PYMUPDF_VERSION = "1.26.7"
LAYOUT_MODEL = "doclayout_yolo_docstructbench_imgsz1024.onnx"
TOKEN_RE = re.compile(r"</?(?:b|i|u|s|f)\d+>")
OUTPUT = sys.stdout
STATE: dict = {"model_dirs": {}, "options": {}}
SUPERSCRIPT = str.maketrans("0123456789+-=()in", "⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ⁱⁿ")


def send(message: dict) -> None:
    OUTPUT.write(json.dumps(message, ensure_ascii=False, separators=(",", ":")) + "\n")
    OUTPUT.flush()


class SidecarError(Exception):
    def __init__(
        self, message: str, code: int = -32001, kind: str = "PRECONDITION_FAILED"
    ):
        super().__init__(message)
        self.code = code
        self.kind = kind


def require(
    condition: bool, message: str, code: int = -32001, kind: str = "PRECONDITION_FAILED"
) -> None:
    if not condition:
        raise SidecarError(message, code, kind)


def location_key(page: int, box: dict) -> str:
    return f"p{page}:" + ",".join(
        f"{box[field]:.3f}" for field in ("x", "y", "x2", "y2")
    )


def normalized_text(value: str) -> str:
    return "".join(char for char in value if not char.isspace() and ord(char) >= 32)


def display_span(text: str, flags: int) -> str:
    if not flags & 1:  # PyMuPDF TEXT_FONT_SUPERSCRIPT
        return text
    rendered = text.translate(SUPERSCRIPT)
    return (
        rendered
        if len(rendered) == len(text) and all(ord(char) > 127 for char in rendered)
        else f"^({text})"
    )


def display_mapping(request: str, source: str):
    """Derive placeholder displays only when literal alignment is unambiguous."""
    tokens = TOKEN_RE.findall(request)
    if not tokens:
        return []
    pieces = TOKEN_RE.split(request)
    if not source.startswith(pieces[0]):
        return [{"token": token, "text": None} for token in tokens]
    solutions = []

    def walk(index, cursor, values):
        if len(solutions) > 1:
            return
        if index == len(tokens):
            if cursor == len(source):
                solutions.append(values)
            return
        anchor = pieces[index + 1]
        if not anchor:
            # Adjacent placeholders have no unique boundary except at end.
            if index == len(tokens) - 1:
                walk(index + 1, len(source), values + [source[cursor:]])
            return
        found = source.find(anchor, cursor)
        while found >= 0:
            walk(index + 1, found + len(anchor), values + [source[cursor:found]])
            found = source.find(anchor, found + 1)

    walk(0, len(pieces[0]), [])
    if len(solutions) != 1:
        return [{"token": token, "text": None} for token in tokens]
    return [
        {"token": token, "text": value} for token, value in zip(tokens, solutions[0])
    ]


def unbound_pdf_lines(input_pdf: Path, paragraphs: list, selected_pages: list | None):
    """Audit extractable original text that BabelDOC did not represent in IL."""
    import pymupdf

    extras = []
    claimed_ranges = [[] for _ in paragraphs]
    with pymupdf.open(input_pdf) as pdf:
        for page_number, page in enumerate(pdf):
            if selected_pages and page_number + 1 not in selected_pages:
                continue
            height = page.rect.height
            for block in page.get_text("dict")["blocks"]:
                for line in block.get("lines", []):
                    raw_value = "".join(span["text"] for span in line["spans"]).strip()
                    value = "".join(
                        display_span(span["text"], span["flags"])
                        for span in line["spans"]
                    ).strip()
                    if not value:
                        continue
                    x, top, x2, bottom = line["bbox"]
                    box = [x, height - bottom, x2, height - top]
                    center_x, center_y = (x + x2) / 2, (box[1] + box[3]) / 2
                    covered = False
                    for index, item in enumerate(paragraphs):
                        if not (
                            item["page"] == page_number
                            and item["bbox"][0] - 3 <= center_x <= item["bbox"][2] + 3
                            and item["bbox"][1] - 3 <= center_y <= item["bbox"][3] + 3
                        ):
                            continue
                        source = normalized_text(item["sourceUnicode"])
                        for candidate in dict.fromkeys(
                            (normalized_text(value), normalized_text(raw_value))
                        ):
                            if not candidate:
                                continue
                            start = source.find(candidate)
                            while start >= 0:
                                end = start + len(candidate)
                                if all(
                                    end <= left or start >= right
                                    for left, right in claimed_ranges[index]
                                ):
                                    claimed_ranges[index].append((start, end))
                                    covered = True
                                    break
                                start = source.find(candidate, start + 1)
                            if covered:
                                break
                        if covered:
                            break
                    if not covered:
                        coordinates = dict(zip(("x", "y", "x2", "y2"), box))
                        extras.append(
                            {
                                "page": page_number,
                                "bbox": box,
                                "key": location_key(page_number, coordinates),
                                "sourceUnicode": value,
                                "rawExtractedText": raw_value,
                                "layoutLabel": "unmapped_pdf_text",
                                "coverageOrigin": "pymupdf_line_audit",
                            }
                        )
    return extras


def insert_unbound_lines(paragraphs: list, extras: list):
    ordered = list(paragraphs)
    for extra in extras:
        x = (extra["bbox"][0] + extra["bbox"][2]) / 2
        y = (extra["bbox"][1] + extra["bbox"][3]) / 2
        prior = [
            (index, item)
            for index, item in enumerate(ordered)
            if item["page"] == extra["page"]
            and (item["bbox"][1] + item["bbox"][3]) / 2 >= y
        ]
        if prior:
            index, _ = min(
                prior,
                key=lambda pair: (
                    abs((pair[1]["bbox"][1] + pair[1]["bbox"][3]) / 2 - y)
                    + 0.1 * abs((pair[1]["bbox"][0] + pair[1]["bbox"][2]) / 2 - x)
                ),
            )
            ordered.insert(index + 1, extra)
        else:
            index = next(
                (i for i, item in enumerate(ordered) if item["page"] >= extra["page"]),
                len(ordered),
            )
            ordered.insert(index, extra)
    return ordered


def runtime():
    import pymupdf
    from babeldoc import const

    require(
        const.__version__ == ENGINE_VERSION,
        f"BabelDOC {ENGINE_VERSION} required; found {const.__version__}",
        -32002,
        "COMPONENT_MISSING",
    )
    require(
        pymupdf.VersionBind == PYMUPDF_VERSION,
        f"PyMuPDF {PYMUPDF_VERSION} required; found {pymupdf.VersionBind}",
        -32002,
        "COMPONENT_MISSING",
    )
    return const, pymupdf


def assets():
    runtime()
    configured = STATE["model_dirs"]
    root = Path(
        configured.get("babeldoc") or Path.home() / ".cache" / "babeldoc"
    ).resolve()
    model = Path(
        configured.get("doclayout-yolo") or root / "models" / LAYOUT_MODEL
    ).resolve()
    require(
        model.is_file(),
        f"BabelDOC layout model missing: {model}",
        -32002,
        "COMPONENT_MISSING",
    )
    for directory in ("fonts", "cmap", "tiktoken"):
        require(
            (root / directory).is_dir(),
            f"BabelDOC asset directory missing: {root / directory}",
            -32002,
            "COMPONENT_MISSING",
        )
    return root, model


def capture_config(pages, min_text_length):
    return {
        "babeldoc": ENGINE_VERSION,
        "pymupdf": PYMUPDF_VERSION,
        "layoutModel": LAYOUT_MODEL,
        "pages": pages,
        "minTextLength": min_text_length,
        "disableRichTextTranslate": True,
        "autoExtractGlossary": False,
        "autoEnableOcrWorkaround": False,
        "skipScannedDetection": True,
        "poolMaxWorkers": 1,
    }


def validate_options(options):
    require(isinstance(options, dict), "options must be an object")
    pages = options.get("pages")
    if pages is not None:
        require(
            isinstance(pages, list)
            and pages
            and all(isinstance(p, int) and p > 0 for p in pages),
            "pages must be positive one-based page numbers",
        )
        require(len(pages) == len(set(pages)), "duplicate page selection")
        pages = sorted(pages)
    min_length = options.get("minTextLength", 5)
    require(
        isinstance(min_length, int) and 1 <= min_length <= 100,
        "minTextLength must be 1..100",
    )
    return pages, min_length


def run_engine(
    input_pdf: Path,
    config_id: dict,
    mode: str,
    records: list | None = None,
    out_dir: Path | None = None,
):
    """Run upstream with a text-only translator and a process-local locator hook."""
    const, pymupdf = runtime()
    asset_root, model_path = assets()
    by_key = {}
    for record in records or []:
        if not record.get("callback", True):
            continue
        key = record.get("key")
        require(
            key
            == location_key(
                record["page"], dict(zip(("x", "y", "x2", "y2"), record["bbox"]))
            ),
            f"Invalid record location: {key}",
        )
        require(key not in by_key, f"Duplicate source location: {key}")
        by_key[key] = record

    local = threading.local()
    seen = []
    all_paragraphs = []

    # Set the private writable cache before importing engine modules: some
    # module globals open the SQLite cache during import.
    work_root = Path(STATE["options"].get("workDir") or tempfile.gettempdir()).resolve()
    work_root.mkdir(parents=True, exist_ok=True)
    if "session_work" not in STATE:
        STATE["session_work"] = Path(
            tempfile.mkdtemp(prefix="ivoraige-babeldoc-", dir=work_root)
        )
        STATE["work_root"] = work_root
    work = STATE["session_work"]
    STATE["run_index"] = STATE.get("run_index", 0) + 1
    task_work = work / f"run-{STATE['run_index']}"
    old_profile = os.environ.get("USERPROFILE")
    old_tiktoken = os.environ.get("TIKTOKEN_CACHE_DIR")
    old_cache = const.CACHE_FOLDER
    old_get_cache = const.get_cache_file_path
    os.environ["USERPROFILE"] = str(work)
    os.environ["TIKTOKEN_CACHE_DIR"] = str(asset_root / "tiktoken")
    const.CACHE_FOLDER = work / ".cache" / "babeldoc"
    const.CACHE_FOLDER.mkdir(parents=True, exist_ok=True)

    def cache_path(filename, sub_folder=None):
        existing = asset_root / (sub_folder or "") / filename
        if existing.is_file():
            return existing
        writable = const.CACHE_FOLDER / (sub_folder or "") / filename
        writable.parent.mkdir(parents=True, exist_ok=True)
        return writable

    const.get_cache_file_path = cache_path
    from babeldoc.docvision.doclayout import OnnxModel
    from babeldoc.format.pdf.document_il.midend.il_translator import ILTranslator
    from babeldoc.format.pdf.high_level import translate
    from babeldoc.format.pdf.translation_config import (
        TranslationConfig,
        WatermarkOutputMode,
    )
    from babeldoc.translator.translator import BaseTranslator

    original = ILTranslator.translate_paragraph
    original_translate = ILTranslator.translate

    def inventory(self, docs):
        for page in docs.page:
            for paragraph in page.pdf_paragraph:
                box = asdict(paragraph.box)
                all_paragraphs.append(
                    {
                        "page": page.page_number,
                        "bbox": [box[n] for n in ("x", "y", "x2", "y2")],
                        "key": location_key(page.page_number, box),
                        "sourceUnicode": paragraph.unicode,
                        "layoutLabel": str(paragraph.layout_label),
                    }
                )
        return original_translate(self, docs)

    def located(self, paragraph, page, *positional, **keyword):
        box = asdict(paragraph.box)
        position = {
            "page": page.page_number,
            "bbox": [box[n] for n in ("x", "y", "x2", "y2")],
            "key": location_key(page.page_number, box),
            "sourceUnicode": paragraph.unicode,
            "layoutLabel": str(paragraph.layout_label),
        }
        seen.append(position)
        previous = getattr(local, "position", None)
        local.position = position
        try:
            return original(self, paragraph, page, *positional, **keyword)
        finally:
            tracker = keyword.get("tracker") or (
                positional[1] if len(positional) > 1 else None
            )
            if tracker is not None:
                position["preparedInput"] = getattr(tracker, "input", None)
                placeholders = []
                for item in getattr(tracker, "placeholders", []):
                    raw = item.to_dict()
                    # BabelDOC's placeholder payload varies by kind; retain it for inspection.
                    placeholders.append(raw)
                position["placeholderPayloads"] = placeholders
            local.position = previous

    class RecordTranslator(BaseTranslator):
        name = "ivoraige-records"
        model = "accepted-snapshot"

        def __init__(self):
            super().__init__("en", "zh", True)
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
            position = getattr(local, "position", None)
            if position is None:
                self.errors.append("BabelDOC callback lacked source position")
                raise ValueError(self.errors[-1])
            call = {**position, "requestText": text}
            self.calls.append(call)
            if mode == "capture":
                return text
            record = by_key.get(position["key"])
            if (
                record is None
                or record["key"] in self.used
                or record["requestText"] != text
            ):
                self.errors.append(
                    f"Missing, duplicate, or changed request: {position['key']}"
                )
                raise ValueError(self.errors[-1])
            self.used.add(record["key"])
            return record["engineProjection"]

    engine = RecordTranslator()
    try:
        ILTranslator.translate_paragraph = located
        ILTranslator.translate = inventory
        try:
            page_arg = (
                ",".join(str(page) for page in config_id["pages"])
                if config_id["pages"]
                else None
            )
            config = TranslationConfig(
                translator=engine,
                input_file=input_pdf,
                lang_in="en",
                lang_out="zh",
                doc_layout_model=OnnxModel(str(model_path)),
                output_dir=task_work / "out",
                working_dir=task_work / "work",
                debug=False,
                no_dual=True,
                watermark_output_mode=WatermarkOutputMode.NoWatermark,
                auto_extract_glossary=False,
                auto_enable_ocr_workaround=False,
                skip_scanned_detection=True,
                disable_rich_text_translate=True,
                pool_max_workers=1,
                qps=100,
                min_text_length=config_id["minTextLength"],
                pages=page_arg,
            )
            original_connect = socket.socket.connect

            def local_only(sock, address):
                if isinstance(address, tuple) and address:
                    require(
                        address[0] in ("127.0.0.1", "::1", "localhost"),
                        f"Network access disabled for PDF sidecar: {address[0]}",
                        -32003,
                    )
                return original_connect(sock, address)

            socket.socket.connect = local_only
            try:
                with redirect_stdout(sys.stderr):
                    result = translate(config)
            finally:
                socket.socket.connect = original_connect
            if mode == "replay":
                require(not engine.errors, "; ".join(engine.errors), -32003)
                require(
                    engine.used == set(by_key),
                    f"Unconsumed accepted records: {sorted(set(by_key) - engine.used)}",
                    -32003,
                )
                require(
                    len(engine.calls) == len(by_key),
                    "Replay callback count differs from accepted records",
                    -32003,
                )
                require(out_dir is not None, "Output directory missing")
                out_dir.mkdir(parents=True, exist_ok=True)
                shutil.copy2(result.mono_pdf_path, out_dir / "translated.pdf")
                with pymupdf.open(out_dir / "translated.pdf") as pdf:
                    checks = []
                    for record in records:
                        if not record.get("callback", True):
                            continue
                        target = record["text"]
                        page_text = normalized_text(pdf[record["page"]].get_text())
                        has_structural = bool(
                            TOKEN_RE.search(record["engineProjection"])
                        )
                        present = (
                            None
                            if has_structural
                            else normalized_text(target) in page_text
                        )
                        checks.append(
                            {
                                "unitId": record["unitId"],
                                "page": record["page"],
                                "present": present,
                                "reason": "structural placeholder requires visual review"
                                if has_structural
                                else None,
                            }
                        )
                    require(
                        all(item["present"] is not False for item in checks),
                        f"Accepted text absent from output PDF: {checks}",
                        -32003,
                    )
            else:
                checks = []
        finally:
            ILTranslator.translate_paragraph = original
            ILTranslator.translate = original_translate
            const.CACHE_FOLDER = old_cache
            const.get_cache_file_path = old_get_cache
            if old_profile is None:
                os.environ.pop("USERPROFILE", None)
            else:
                os.environ["USERPROFILE"] = old_profile
            if old_tiktoken is None:
                os.environ.pop("TIKTOKEN_CACHE_DIR", None)
            else:
                os.environ["TIKTOKEN_CACHE_DIR"] = old_tiktoken
    finally:
        pass
    require(not engine.errors, "; ".join(engine.errors), -32003)
    return engine.calls, all_paragraphs or seen, checks


def parse(params):
    input_pdf = Path(params["path"]).resolve(strict=True)
    require(
        input_pdf.is_file() and input_pdf.suffix.lower() == ".pdf",
        "parse.path must be an existing PDF",
    )
    options = params.get("options") or {}
    require(
        options.get("language") == "en",
        "PDF capture currently requires source language en",
    )
    pages, min_length = validate_options(options)
    config = capture_config(pages, min_length)
    send(
        {
            "jsonrpc": "2.0",
            "method": "progress",
            "params": {"stage": "pdf.capture", "done": 0, "total": 1},
        }
    )
    calls, paragraphs, _ = run_engine(input_pdf, config, "capture")
    require(calls, "BabelDOC produced no translation requests")
    extras = unbound_pdf_lines(input_pdf, paragraphs, pages)
    paragraphs = insert_unbound_lines(paragraphs, extras)
    keys = [call["key"] for call in calls]
    require(len(keys) == len(set(keys)), "BabelDOC produced duplicate source locations")
    paragraph_keys = [item["key"] for item in paragraphs]
    require(
        len(paragraph_keys) == len(set(paragraph_keys)),
        "BabelDOC source paragraphs collide at rounded locations",
    )
    require(
        set(keys) <= set(paragraph_keys),
        "BabelDOC callback absent from source paragraph inventory",
    )
    units = []
    records = []
    called_by_key = {call["key"]: call for call in calls}
    for order, paragraph in enumerate(paragraphs):
        call = called_by_key.get(paragraph["key"])
        source_text = call["requestText"] if call else paragraph["sourceUnicode"]
        # A raw placeholder token can appear in a source request. The payload
        # is retained; exact display text must be resolved before acceptance.
        placeholders = (
            display_mapping(source_text, paragraph["sourceUnicode"]) if call else []
        )
        unit_id = f"pdf-{order + 1:05d}"
        label = paragraph["layoutLabel"].lower()
        kind = (
            "heading"
            if "title" in label or "heading" in label
            else "caption"
            if "caption" in label
            else "formula"
            if "formula" in label
            else "body"
        )
        units.append(
            {
                "unitId": unit_id,
                "order": order,
                "kind": kind,
                "sourceText": source_text,
                "locator": {
                    "page": paragraph["page"] + 1,
                    "bbox": paragraph["bbox"],
                    "key": paragraph["key"],
                },
                "translatable": call is not None,
            }
        )
        records.append(
            {
                "unitId": unit_id,
                "order": order,
                "page": paragraph["page"],
                "bbox": paragraph["bbox"],
                "key": paragraph["key"],
                "requestText": source_text,
                "sourceUnicode": paragraph["sourceUnicode"],
                **(
                    {"rawExtractedText": paragraph["rawExtractedText"]}
                    if "rawExtractedText" in paragraph
                    else {}
                ),
                "placeholders": placeholders,
                "placeholderPayloads": call.get("placeholderPayloads", [])
                if call
                else [],
                "layoutLabel": paragraph["layoutLabel"],
                "callback": call is not None,
            }
        )
    called = set(keys)
    coverage = [
        {
            "page": item["page"],
            "bbox": item["bbox"],
            "key": item["key"],
            "sourceUnicode": item["sourceUnicode"],
            **(
                {"rawExtractedText": item["rawExtractedText"]}
                if "rawExtractedText" in item
                else {}
            ),
            "layoutLabel": item["layoutLabel"],
            "called": item["key"] in called,
        }
        for item in paragraphs
    ]
    send(
        {
            "jsonrpc": "2.0",
            "method": "progress",
            "params": {"stage": "pdf.capture", "done": 1, "total": 1},
        }
    )
    warnings = []
    if any(not item["called"] and item["sourceUnicode"].strip() for item in coverage):
        warnings.append(
            "Some BabelDOC paragraphs did not enter translation callbacks; inspect sourceCoverage before claiming full coverage"
        )
    if extras:
        warnings.append(
            f"{len(extras)} extractable PDF text line(s) were outside BabelDOC paragraph inventory; retained as original passthrough units"
        )
    if any(
        any(p["text"] is None for p in record["placeholders"]) for record in records
    ):
        warnings.append("Some structural placeholder display mappings need review")
    return {
        "doc": {
            "format": "pdf",
            "title": input_pdf.stem,
            "units": units,
            "chapters": [],
            "resources": [],
            "warnings": warnings,
            "sourceCoverage": {
                "called": len(calls),
                "uncalled": [item for item in coverage if not item["called"]],
            },
            "sourceBinding": {
                "adapterId": "babeldoc",
                "engineVersion": ENGINE_VERSION,
                "captureConfig": config,
                "records": records,
                "coverage": {
                    "paragraphs": coverage,
                    "called": len(calls),
                    "uncalled": sum(not item["called"] for item in coverage),
                },
            },
        }
    }


def rebuild(params):
    require(
        params.get("format") == "pdf", "Only mono PDF replay is currently supported"
    )
    doc_ref = json.loads(Path(params["docRef"]).read_text(encoding="utf-8"))
    revision_ref = json.loads(Path(params["revisionsRef"]).read_text(encoding="utf-8"))
    document = doc_ref.get("document", doc_ref)
    require(
        document.get("language") == "en",
        "PDF replay currently requires English source language",
    )
    binding = doc_ref.get("sourceBinding") or document.get("sourceBinding")
    require(
        isinstance(binding, dict) and binding.get("adapterId") == "babeldoc",
        "BabelDOC source binding required",
    )
    require(
        binding.get("engineVersion") == ENGINE_VERSION,
        "BabelDOC source version changed",
    )
    source_path = binding.get("sourcePath")
    require(isinstance(source_path, str), "Managed sourcePath missing from binding")
    input_pdf = Path(source_path).resolve(strict=True)
    config = binding.get("captureConfig")
    require(
        isinstance(config, dict)
        and config == capture_config(config.get("pages"), config.get("minTextLength")),
        "Capture configuration changed",
    )
    raw_records = binding.get("records")
    require(isinstance(raw_records, list) and raw_records, "Source records missing")
    frozen = revision_ref.get("units")
    require(
        isinstance(frozen, list) and len(frozen) == len(raw_records),
        "Frozen revision count differs from PDF source",
    )
    by_order = {item.get("unit", {}).get("order"): item for item in frozen}
    require(len(by_order) == len(frozen), "Duplicate frozen unit order")
    target = revision_ref.get("snapshot", {}).get("targetLang", "")
    require(
        target in ("zh", "zh-CN", "zh-Hans"),
        f"PDF replay target language unsupported: {target}",
    )
    records = []
    for item in raw_records:
        entry = by_order.get(item["order"])
        require(
            entry is not None, f"Accepted revision missing for order {item['order']}"
        )
        unit = entry["unit"]
        require(
            unit.get("sourceText") == item["requestText"],
            f"Frozen source text changed at order {item['order']}",
        )
        decision = entry.get("decision", {}).get("type")
        require(
            decision == ("revision" if item.get("callback", True) else "keepOriginal"),
            f"Frozen decision does not match PDF callback at order {item['order']}",
        )
        projection = entry.get("text")
        require(
            isinstance(projection, str),
            f"Accepted text missing at order {item['order']}",
        )
        expected = [p["token"] for p in item.get("placeholders", [])]
        actual = TOKEN_RE.findall(projection)
        require(
            expected == actual, f"Placeholder order mismatch at order {item['order']}"
        )
        if expected:
            displays = [p.get("text") for p in item["placeholders"]]
            require(
                all(isinstance(value, str) for value in displays),
                f"Placeholder display mapping unresolved at order {item['order']}",
            )
            expanded = iter(displays)
            rendered = TOKEN_RE.sub(
                lambda _token, iterator=expanded: next(iterator), projection
            )
        else:
            rendered = projection
        if not item.get("callback", True):
            require(
                projection == item["sourceUnicode"],
                f"Passthrough source changed at order {item['order']}",
            )
        records.append(
            {
                **item,
                "unitId": unit.get("id"),
                "engineProjection": projection,
                "text": rendered,
            }
        )
    out = Path(params["out"]).resolve()
    require(not out.exists(), f"Output already exists: {out}")
    with tempfile.TemporaryDirectory(
        prefix="ivoraige-pdf-publish-", dir=out.parent
    ) as staging_name:
        staging = Path(staging_name)
        send(
            {
                "jsonrpc": "2.0",
                "method": "progress",
                "params": {"stage": "pdf.rebuild", "done": 0, "total": 1},
            }
        )
        calls, paragraphs, checks = run_engine(
            input_pdf, config, "replay", records, staging
        )
        shutil.move(str(staging / "translated.pdf"), out)
    send(
        {
            "jsonrpc": "2.0",
            "method": "progress",
            "params": {"stage": "pdf.rebuild", "done": 1, "total": 1},
        }
    )
    return {
        "path": str(out),
        "evidence": {
            "adapterRequests": len(calls),
            "modelRequests": 0,
            "matchedRecords": sum(item.get("callback", True) for item in records),
            "textChecks": checks,
            "uncalledParagraphs": sum(
                item["key"] not in {c["key"] for c in calls} for item in paragraphs
            ),
        },
    }


def dispatch(request):
    require(
        request.get("jsonrpc") == "2.0" and isinstance(request.get("method"), str),
        "Invalid JSON-RPC request",
    )
    method = request["method"]
    params = request.get("params") or {}
    require(isinstance(params, dict), "params must be an object")
    if method == "handshake":
        require(
            params.get("protocolVersion") == PROTOCOL_VERSION,
            "Sidecar protocol version mismatch",
            -32002,
            "COMPONENT_MISSING",
        )
        return {
            "protocolVersion": PROTOCOL_VERSION,
            "capabilities": {"parse": ["pdf"], "rebuild": ["pdf"]},
        }
    if method == "configure":
        model_dirs = params.get("modelDirs") or {}
        require(isinstance(model_dirs, dict), "modelDirs must be an object")
        STATE["model_dirs"] = model_dirs
        STATE["options"] = params.get("options") or {}
        assets()
        return {}
    if method == "parse":
        return parse(params)
    if method == "rebuild":
        return rebuild(params)
    if method == "shutdown":
        return None
    raise SidecarError(f"Unknown method: {method}", -32601)


def main():
    for stream in (sys.stdin, sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")
    for line in sys.stdin:
        request = None
        try:
            request = json.loads(line)
            result = dispatch(request)
            if "id" in request:
                send({"jsonrpc": "2.0", "id": request["id"], "result": result})
            if request.get("method") == "shutdown":
                break
        except Exception as error:  # noqa: BLE001 - keep the long-lived protocol alive after an upstream failure
            traceback.print_exc(file=sys.stderr)
            if isinstance(error, SidecarError):
                code, kind = error.code, error.kind
            else:
                code, kind = -32003, "UPSTREAM_FAILURE"
            send(
                {
                    "jsonrpc": "2.0",
                    "id": request.get("id")
                    if isinstance(locals().get("request"), dict)
                    else None,
                    "error": {
                        "code": code,
                        "message": str(error),
                        "data": {"code": kind},
                    },
                }
            )
    work = STATE.get("session_work")
    root = STATE.get("work_root")
    if (
        work
        and root
        and work.resolve().parent == root.resolve()
        and work.name.startswith("ivoraige-babeldoc-")
    ):
        shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    main()
