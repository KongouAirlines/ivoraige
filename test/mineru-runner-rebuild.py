"""Model-free checks for MinerU's private frozen replay boundary."""
import hashlib
import importlib.util
import json
import sys
import tempfile
import types
from contextlib import contextmanager
from pathlib import Path


sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("ivoraige_mineru_runner", sys.argv[1])
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)
runner.CONFIGURED = True
runner.version = lambda name: "0.6.21" if name == "docvortex" else None


def inventory(root):
    rows = []
    for path in sorted(root.rglob("*")):
        if path.is_file():
            data = path.read_bytes()
            rows.append({"path": path.relative_to(root).as_posix(),
                         "sha256": hashlib.sha256(data).hexdigest(), "size": len(data)})
    return rows


with tempfile.TemporaryDirectory(prefix="mineru-replay-test-") as temporary:
    work = Path(temporary).resolve()
    bundle = work / "bundle"
    (bundle / "images").mkdir(parents=True)
    (bundle / "source.pdf").write_bytes(b"%PDF-1.4\n%%EOF\n")
    (bundle / "images" / "crop.png").write_bytes(b"image bytes")
    middle = {"schema": "docvortex.middle", "schema_version": "2.0",
              "metadata": {"producer": {"version": "4.0.10"}},
              "pages": [{"page_idx": 0, "blocks": [{"type": "text", "index": 0,
                        "bbox": [1, 2, 3, 4], "content": [{"type": "text", "content": "Original"}]}]}]}
    middle_path = bundle / "middle_json.json"
    middle_path.write_text(json.dumps(middle), encoding="utf-8")
    replacement = {"pageIndex": 0, "blockIndex": 0, "index": 0,
                   "bbox": [1, 2, 3, 4], "sourceText": "Original", "text": "译文"}
    params = {"bundlePath": str(bundle), "outputPath": str(work / "output.pdf"),
              "files": inventory(bundle), "replacements": [replacement], "layout": "original"}

    # Model-free renderer/diagnostics peers also model upstream's swallowed
    # PdfAssetError, rather than assuming an exception always propagates.
    base = types.ModuleType("mineru")
    parser = types.ModuleType("mineru.parser")
    parser_base = types.ModuleType("mineru.parser.base")
    render = types.ModuleType("mineru.render")
    diagnostics_module = types.ModuleType("docvortex.render._internal.pdf.diagnostics")
    diagnostic_stack = []

    @contextmanager
    def collect_pdf_diagnostics():
        diagnostics = []
        diagnostic_stack.append(diagnostics)
        try:
            yield diagnostics
        finally:
            diagnostic_stack.pop()

    diagnostics_module.collect_pdf_diagnostics = collect_pdf_diagnostics

    class ParseResult:
        @staticmethod
        def from_dict(data):
            assert data["pages"][0]["blocks"][0]["content"][0]["content"] == "译文"
            return types.SimpleNamespace(middle_json=data)

    parser_base.ParseResult = ParseResult
    render.PdfLayout = types.SimpleNamespace(ORIGINAL="original")

    def render_pdf(document, *, asset_resolver, layout):
        assert layout == "original"
        assert asset_resolver("images/crop.png") == b"image bytes"
        return b"%PDF-1.4\nreplayed\n%%EOF\n"

    render.render_pdf = render_pdf
    sys.modules.update({"mineru": base, "mineru.parser": parser,
                        "mineru.parser.base": parser_base, "mineru.render": render,
                        "docvortex": types.ModuleType("docvortex"),
                        "docvortex.render": types.ModuleType("docvortex.render"),
                        "docvortex.render._internal": types.ModuleType("docvortex.render._internal"),
                        "docvortex.render._internal.pdf": types.ModuleType("docvortex.render._internal.pdf"),
                        "docvortex.render._internal.pdf.diagnostics": diagnostics_module})
    result = runner.rebuild(params)
    assert result["sha256"] == hashlib.sha256((work / "output.pdf").read_bytes()).hexdigest()
    (work / "output.pdf").unlink()

    def swallowed_missing(document, *, asset_resolver, layout):
        try:
            asset_resolver("../not-listed.png")
        except ValueError:
            pass
        return b"%PDF-1.4\nmissing image placeholder\n%%EOF\n"

    def swallowed_missing_inventory(document, *, asset_resolver, layout):
        try:
            asset_resolver("images/crop.png")
        except ValueError:
            pass
        return b"%PDF-1.4\nmissing image placeholder\n%%EOF\n"

    render.render_pdf = swallowed_missing
    try:
        runner.rebuild(params)
    except runner.SidecarError as error:
        assert "image could not be replayed" in str(error)
    else:
        raise AssertionError("swallowed missing asset produced a successful PDF")
    assert not (work / "output.pdf").exists()

    def swallowed_corrupt(document, *, asset_resolver, layout):
        assert asset_resolver("images/crop.png") == b"image bytes"
        diagnostic_stack[-1].append(types.SimpleNamespace(code="pdf_image_unavailable"))
        return b"%PDF-1.4\ncorrupt image placeholder\n%%EOF\n"

    render.render_pdf = swallowed_corrupt
    try:
        runner.rebuild(params)
    except runner.SidecarError as error:
        assert "image could not be replayed" in str(error)
    else:
        raise AssertionError("swallowed corrupt image produced a successful PDF")
    assert not (work / "output.pdf").exists()
    render.render_pdf = render_pdf

    middle["pages"][0]["blocks"].append({"type": "table", "index": 9, "bbox": [2, 3, 4, 5],
        "content": [{"type": "table_caption", "index": 8, "bbox": [1, 2, 3, 4],
                     "content": [{"type": "text", "content": "Caption"}]},
                    {"type": "table_body", "index": 9, "content": "<table/>"}]})
    middle_path.write_text(json.dumps(middle), encoding="utf-8")
    params["files"] = inventory(bundle)
    caption = {"pageIndex": 0, "blockIndex": 1, "index": 9, "bbox": [2, 3, 4, 5],
               "part": "caption", "itemIndex": 0, "childOrder": 0,
               "childType": "table_caption", "childIndex": 8, "childBbox": [1, 2, 3, 4],
               "sourceText": "Caption", "text": "图表说明"}
    params["replacements"] = [caption]
    def parse_nested(data):
        assert data["pages"][0]["blocks"][1]["content"][0]["content"][0]["content"] == "图表说明"
        return types.SimpleNamespace(middle_json=data)
    ParseResult.from_dict = staticmethod(parse_nested)
    runner.rebuild(params)
    (work / "output.pdf").unlink()
    params["replacements"] = [{**caption, "childOrder": 1}]
    try:
        runner.rebuild(params)
    except runner.SidecarError as error:
        assert "annotation identity" in str(error)
    else:
        raise AssertionError("incorrect child locator was allowed")
    assert not (work / "output.pdf").exists()
    middle["pages"][0]["blocks"][1]["content"].append(
        {"type": "table_caption", "index": 7, "bbox": [5, 6, 7, 8],
         "content": [{"type": "text", "content": "Earlier"}]})
    middle_path.write_text(json.dumps(middle), encoding="utf-8")
    params["files"] = inventory(bundle)
    params["replacements"] = [{**caption, "childOrder": 2, "itemIndex": 0,
                               "childIndex": 7, "childBbox": [5, 6, 7, 8],
                               "sourceText": "Earlier", "text": "较早说明"}]
    ParseResult.from_dict = staticmethod(lambda data: types.SimpleNamespace(middle_json=data))
    runner.rebuild(params)
    (work / "output.pdf").unlink()
    middle["pages"][0]["blocks"].pop()
    params["replacements"] = [replacement]
    ParseResult.from_dict = staticmethod(lambda data: types.SimpleNamespace(middle_json=data))

    middle["pages"][0]["blocks"][0]["content"].append({"type": "text", "content": "Second"})
    middle_path.write_text(json.dumps(middle), encoding="utf-8")
    params["files"] = inventory(bundle)
    try:
        runner.rebuild(params)
    except runner.SidecarError as error:
        assert "complex inline text" in str(error)
    else:
        raise AssertionError("complex inline text was silently replaced")
    assert not (work / "output.pdf").exists()

    middle["pages"][0]["blocks"][0]["content"].pop()
    middle["pages"][0]["blocks"][0]["content"][0]["content"] = "A*B"
    middle_path.write_text(json.dumps(middle), encoding="utf-8")
    params["files"] = inventory(bundle)
    params["replacements"] = [{**replacement, "sourceText": "A\\*B"}]
    try:
        runner.rebuild(params)
    except runner.SidecarError as error:
        assert "complex inline text" in str(error)
    else:
        raise AssertionError("Markdown-escaped source was silently replaced")
    assert not (work / "output.pdf").exists()

    middle["pages"][0]["blocks"][0]["content"][0]["content"] = "Original"
    middle_path.write_text(json.dumps(middle), encoding="utf-8")
    params["replacements"] = [replacement]
    params["files"] = [row for row in inventory(bundle) if row["path"] != "images/crop.png"]
    render.render_pdf = swallowed_missing_inventory
    try:
        runner.rebuild(params)
    except runner.SidecarError as error:
        assert "image could not be replayed" in str(error)
    else:
        raise AssertionError("unlisted asset was silently used")
    assert not (work / "output.pdf").exists()

print("MinerU frozen span and asset guards passed")
