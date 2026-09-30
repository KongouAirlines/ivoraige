"""M3 R03-only PDF region repairs. Invoke explicitly for historical experiment replay."""

import os
from pathlib import Path


def apply_r03_repairs(manifest, paragraphs_seen, calls, result, input_pdf, pymupdf, normalize_pdf_text):
    field_checks = {}
    if isinstance(manifest, dict):
        for unit in manifest["units"]:
            suffix = unit.get("pdfUncalledSuffix")
            if suffix:
                matches = [item for item in paragraphs_seen
                           if item["key"] == suffix["key"] and
                           item.get("prepared_input") == suffix["fragment"] and
                           item["source_unicode"] == suffix["fragment"]]
                if len(matches) != 1 or suffix["key"] in {call["key"] for call in calls}:
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
    return field_checks
