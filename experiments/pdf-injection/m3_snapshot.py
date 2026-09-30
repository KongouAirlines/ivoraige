"""Freeze the three R03 capture pages as stable, source-bound M3-2 units.

This is intentionally a small, sample-specific manifest builder. It does not
import the units into M2 records or imply that untranslated text is accepted.
"""

import json
from pathlib import Path
import re


ROOT = Path(__file__).resolve().parents[2]
RUN = ROOT / "evaluation/runs/m3-2"
SOURCE = "evaluation/private/originals/mumax3/Vansteenkiste 等 - 2014 - The design and verification of MuMax3.pdf"
SOURCE_SHA = "82B9669C033275E0856E9F02D8BF19976DB19E95CADEDD24D57337FDD344F9A3"


def category(page, call):
    text = call["request_text"]
    y = call["box"]["y"]
    if page == 1:
        if text.startswith("The design"):
            return "title"
        if text.startswith("Arne Vansteenkiste"):
            return "author_affiliation"
        if text.startswith("We report"):
            return "abstract"
        if text.startswith("Keywords:"):
            return "keywords"
        if text.startswith("I. INTRODUCTION"):
            return "section_heading"
        if "Electronic address:" in text:
            return "footnote_fragment"
        return "body"
    if page == 2:
        if text.startswith("FIG."):
            return "figure_caption"
        if y > 680:
            return "figure_internal_label"
        if text in ("II. DESIGN", "A. Material Regions", "B. Geometry"):
            return "section_heading"
        return "body"
    if text.startswith("FIG."):
        return "figure_caption"
    if y > 600:
        return "figure_internal_label"
    if text in ("A. Landau-Lifshitz torque", "B. Magnetostatic field"):
        return "section_heading"
    if "exchange field" in text or "applied field" in text or "thermal field" in text or "anisotropy field" in text or "magnetostatic field <b" in text:
        return "field_list_item"
    return "body"


def main():
    units = []
    skipped = []
    seen_keys = set()
    for page in (1, 2, 4):
        base = RUN / f"page{page}-detail"
        calls = json.loads((base / "capture.json").read_text(encoding="utf-8"))
        paragraphs = json.loads((base / "paragraphs.json").read_text(encoding="utf-8"))
        by_key = {item["key"]: item for item in paragraphs}
        assert len(by_key) == len(paragraphs)
        assert all(call["page"] == page - 1 for call in calls)
        calls.sort(key=lambda item: (-item["box"]["y2"], item["box"]["x"]))
        for index, call in enumerate(calls, start=1):
            assert call["key"] not in seen_keys
            seen_keys.add(call["key"])
            paragraph = by_key[call["key"]]
            assert paragraph["callback"] and paragraph["prepared_input"] == call["request_text"]
            kind = category(page, call)
            unit = {
                "unit_id": f"R03-M3-2-p{page:02d}-u{index:03d}",
                "pdf_page": page,
                "page_index": page - 1,
                "kind": kind,
                "source_unicode": call["source_unicode"],
                "request_text": call["request_text"],
                "placeholder_tokens": re.findall(r"</?b\d+>", call["request_text"]),
                "placeholders": paragraph["placeholders"],
                "source_binding": {
                    "engine": "BabelDOC 0.6.4",
                    "key": call["key"],
                    "box_pdf_bottom_left_xyxy": [round(call["box"][field], 3) for field in ("x", "y", "x2", "y2")],
                    "text_match": "exact",
                },
                "capture_state": "captured_untranslated",
            }
            units.append(unit)
        for item in paragraphs:
            if not item["callback"]:
                skipped.append({
                    "pdf_page": page,
                    "key": item["key"],
                    "box_pdf_bottom_left_xyxy": [round(item["box"][field], 3) for field in ("x", "y", "x2", "y2")],
                    "source_unicode": item["source_unicode"],
                    "prepared_input": item.get("prepared_input"),
                    "layout_label": item["layout_label"],
                    "reason": "below_min_text_length_5" if item.get("prepared_input") and len(item["prepared_input"]) < 5 else "no_callback_check_structure_or_filter",
                })
    snapshot = {
        "snapshot_id": "R03-M3-2-babeldoc-0.6.4-pages-1-2-4-min5",
        "document_id": "R03",
        "source_pdf": SOURCE,
        "source_sha256_from_import_manifest": SOURCE_SHA,
        "source_revision": 1,
        "source_revision_note": "Original registered arXiv v3 PDF, unchanged; corrections require a new source revision and binding.",
        "pdf_page_count": 32,
        "selected_pdf_pages_one_based": [1, 2, 4],
        "capture_config": {
            "babeldoc": "0.6.4", "python": "3.13", "pymupdf": "1.26.7", "min_text_length": 5,
            "layout_model": "doclayout_yolo_docstructbench_imgsz1024.onnx",
            "disable_rich_text_translate": True,
            "auto_extract_glossary": False,
            "auto_enable_ocr_workaround": False,
            "page_mode": "one page per process",
        },
        "coordinate_contract": "zero-based engine page; PDF bottom-left origin; x,y,x2,y2 in points rounded to 0.001; key plus exact request_text is valid only in this source/config snapshot",
        "units": units,
        "uncalled_paragraphs": skipped,
        "structural_items": [
            {"id": "R03-M3-2-fig1", "pdf_page": 2, "kind": "figure_graphic", "source_image": "evaluation/private/m0/R03/page2.png", "anchor": "above FIG. 1 caption", "callback": False},
            {"id": "R03-M3-2-fig2", "pdf_page": 2, "kind": "figure_graphic", "source_image": "evaluation/private/m0/R03/page2.png", "anchor": "above FIG. 2 caption", "callback": False},
            {"id": "R03-M3-2-fig3", "pdf_page": 4, "kind": "figure_graphic", "source_image": "evaluation/private/m0/R03/page4.png", "anchor": "above FIG. 3 caption", "callback": False},
            {"id": "R03-M3-2-eq2", "pdf_page": 4, "kind": "standalone_equation", "source_image": "evaluation/private/m0/R03/page4.png", "anchor": "(2) below Landau-Lifshitz torque lead paragraph", "callback": False},
            {"id": "R03-M3-2-eq3", "pdf_page": 4, "kind": "standalone_equation", "source_image": "evaluation/private/m0/R03/page4.png", "anchor": "(3) below magnetostatic convolution paragraph", "callback": False},
            {"id": "R03-M3-2-eq4", "pdf_page": 4, "kind": "standalone_equation", "source_image": "evaluation/private/m0/R03/page4.png", "anchor": "(4) after M = M_sat m definition paragraph", "callback": False},
        ],
        "limits": [
            "Units are captured requests, not accepted translations.",
            "Figure graphics and standalone equations (2)-(4) have no paragraph callback; see coverage.md.",
            "No random BabelDOC debug_id is a business key.",
        ],
    }
    out = RUN / "r03-source-snapshot.json"
    out.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2), encoding="utf-8")
    assert len(units) == 47 and len(skipped) == 42
    assert len({item["unit_id"] for item in units}) == len(units)
    assert len({item["source_binding"]["key"] for item in units}) == len(units)
    print(f"{len(units)} units, {len(skipped)} uncalled paragraphs -> {out}")


if __name__ == "__main__":
    main()
