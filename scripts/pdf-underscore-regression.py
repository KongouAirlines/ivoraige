# SPDX-License-Identifier: AGPL-3.0-only
"""Offline installed-runtime regression for the derived ASCII line policy.

Run through scripts/pdf-offline-linux.py with the matching derived Python runtime.
Only original synthetic PDFs and identity/skip replay are used; no model is called.
"""

import hashlib
import json
import sys
from pathlib import Path

import pymupdf

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "sidecars/babeldoc"))
import server  # noqa: E402


def sample(path):
    pdf = pymupdf.open()
    page = pdf.new_page(width=595, height=842)
    page.insert_text((60, 80), "Original ASCII line controls", fontname="helv", fontsize=16)
    for index, line in enumerate(("X_Y", "X_2", "X-Y", "X _ Y", "_", "E = - m H")):
        page.insert_text((60, 140 + 45 * index), line, fontname="helv", fontsize=12)
    # A genuine lowered, smaller digit has different nominal baseline and size.
    page.insert_text((60, 460), "X", fontname="helv", fontsize=12)
    page.insert_text((68, 460), "_", fontname="helv", fontsize=12)
    page.insert_text((76, 465), "2", fontname="helv", fontsize=10)
    pdf.save(path)
    pdf.close()


def main():
    if len(sys.argv) != 3:
        raise SystemExit("Usage: pdf-underscore-regression.py ASSETS OUTPUT_DIRECTORY")
    assets, work = Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve()
    work.mkdir(parents=True, exist_ok=False)
    source = work / "input.pdf"
    sample(source)
    server.STATE.update(model_dirs={"babeldoc": str(assets)},
                        options={"workDir": str(work / "engine")})
    doc = server.parse({"path": str(source), "options": {"language": "en", "minTextLength": 1}})["doc"]
    binding = doc["sourceBinding"]
    assert binding["engineVersion"] == "0.7.1+ivoraige.3"
    assert binding["captureConfig"]["underscoreLinePolicy"] == "ascii-alnum-base-v1"
    records = binding["records"]
    called = [record["sourceUnicode"] for record in records if record["callback"]]
    assert called.count("X_Y") == 1 and called.count("X_2") == 1, called
    assert "X-Y" in called and "X _ Y" in called and "E = - m H" in called
    assert "X_ 2" in called and "X 2_" not in called, called
    assert not any(record["layoutLabel"] == "unmapped_pdf_text"
                   and record["sourceUnicode"] in ("X_Y", "X_2") for record in records)
    binding["sourcePath"] = str(source)
    doc_ref, revision_ref = work / "docRef.json", work / "revisionRef.json"
    doc_ref.write_text(json.dumps({"document": {"language": "en"}, "sourceBinding": binding}))
    units = []
    for record in records:
        decision = "skip" if record["callback"] else "keepOriginal"
        units.append({"unit": {"id": record["unitId"], "order": record["order"],
                               "sourceText": record["requestText"]},
                      "decision": {"type": decision},
                      "text": record["requestText"] if record["callback"] else record["sourceUnicode"]})
    revision_ref.write_text(json.dumps({"snapshot": {"targetLang": "zh"}, "units": units}))
    rebuilt = server.rebuild({"format": "pdf", "docRef": str(doc_ref),
                              "revisionsRef": str(revision_ref), "out": str(work / "accepted.pdf")})
    with pymupdf.open(rebuilt["path"]) as accepted:
        output = accepted[0].get_text()
        subscript = [(char["c"], char["origin"][1])
                     for block in accepted[0].get_text("rawdict")["blocks"]
                     for line in block.get("lines", []) for span in line["spans"]
                     for char in span["chars"] if 450 < char["origin"][1] < 475]
    assert "X_Y" in output and "X_2" in output and "X-Y" in output
    assert "E = - m H" in output
    assert [char for char, _ in subscript] == ["X", "_", "2"], subscript
    assert abs(subscript[0][1] - subscript[1][1]) < 0.1
    assert subscript[2][1] - subscript[0][1] > 4., subscript
    assert rebuilt["evidence"]["modelRequests"] == 0
    report = {"inputSha256": hashlib.sha256(source.read_bytes()).hexdigest(),
              "engineVersion": binding["engineVersion"], "captureConfig": binding["captureConfig"],
              "callbackSources": called, "sourceWarnings": doc["warnings"],
              "replayEvidence": rebuilt["evidence"], "replayText": output,
              "subscriptGlyphOrigins": subscript}
    (work / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2))
    print(json.dumps({"inputSha256": report["inputSha256"], "callbackSources": called,
                      "modelRequests": 0}, ensure_ascii=False))


if __name__ == "__main__":
    main()
