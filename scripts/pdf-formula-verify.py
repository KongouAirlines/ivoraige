"""Verify extracted text and repeated-location placement from the real acceptance run."""
import json
import re
import sys
from pathlib import Path
import pymupdf

root = Path(sys.argv[1])
report = json.loads((root / "report.json").read_text(encoding="utf-8"))
binding = json.loads((root / "captured.json").read_text(encoding="utf-8"))
# MuPDF can expose font spacing as control characters (e.g. U+0003).
normalize = lambda text: "".join(char for char in text if not char.isspace() and ord(char) >= 32)
with pymupdf.open(root / "accepted.pdf") as accepted, pymupdf.open(root / "replay.pdf") as replay:
    assert len(accepted) == len(replay) == 2
    assert [normalize(p.get_text()) for p in accepted] == [normalize(p.get_text()) for p in replay]
    assert "." * 20 in normalize(accepted[0].get_text())
    positions = []
    for item in report["accepted"]:
        page = accepted[item["locator"]["page"] - 1]
        displays = iter(binding["records"][item["order"]]["placeholders"])
        text = re.sub(r"</?(?:b|i|u|s|f)\d+>", lambda _match: next(displays)["text"], item["text"])
        assert normalize(text) in normalize(page.get_text()), item
        if not item["text"].startswith("位置"):
            continue
        boxes = [block[:4] for block in page.get_text("blocks")
                 if normalize(item["text"]) in normalize(block[4])]
        assert len(boxes) == 1, (item, boxes)
        box = boxes[0]
        source = item["locator"]["bbox"]
        assert abs(box[0] - source[0]) < 12, (item, box)
        assert abs(box[1] - (page.rect.height - source[3])) < 25, (item, box)
        positions.append({"unitId": item["unitId"], "page": item["locator"]["page"], "outputBox": box})
    assert len(positions) >= 4
    evidence = {"pages": len(accepted), "replayTextEqual": True,
                "punctuationRunPreserved": True, "repeatedPositions": positions}
    (root / "text-layout-checks.json").write_text(json.dumps(evidence, indent=2), encoding="utf-8")
    print(json.dumps(evidence))
