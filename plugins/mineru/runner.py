# SPDX-License-Identifier: MIT
"""MinerU 4.0.10 parse/replay NDJSON JSON-RPC 2.0 sidecar."""
import contextlib
import hashlib
import json
import os
import socket
import sys
import traceback
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path

PIN = "4.0.10"
PDF_ENGINE_PIN = "0.6.21"
PROTOCOL = 1
CONFIGURED = False
HANDSHAKEN = False


class SidecarError(Exception):
    def __init__(self, code: int, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def offline(*_args, **_kwargs):
    raise RuntimeError("MinerU network access is disabled; prepare local models")


def configure(params):
    global CONFIGURED
    if not HANDSHAKEN:
        raise SidecarError(-32002, "MinerU sidecar handshake is required")
    try:
        installed = version("mineru")
    except PackageNotFoundError as exc:
        raise SidecarError(-32002, "MinerU 4.0.10 is not installed") from exc
    if installed != PIN:
        raise SidecarError(-32002, "MinerU 4.0.10 is required")
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    socket.socket.connect = offline
    socket.socket.connect_ex = offline
    socket.create_connection = offline
    CONFIGURED = True
    return {}


def parse(params):
    if not CONFIGURED:
        raise SidecarError(-32002, "MinerU sidecar is not configured")
    options = params.get("options") or {}
    path, output = params.get("path"), options.get("outputDir")
    tier, ocr_mode = options.get("tier"), options.get("ocrMode")
    if not isinstance(path, str) or not isinstance(output, str) or not Path(path).is_file():
        raise SidecarError(-32001, "MinerU input or output path is invalid")
    if tier not in {"flash", "standard"} or ocr_mode not in {"auto", "txt", "ocr"}:
        raise SidecarError(-32001, "MinerU parse options are invalid")
    from mineru.parser import parse as mineru_parse
    from mineru.parser.writer import FileBasedDataWriter

    with contextlib.redirect_stdout(sys.stderr):
        result = mineru_parse(Path(path), tier=tier, ocr_mode=ocr_mode)
        result.save(FileBasedDataWriter(output))
    middle = json.loads((Path(output) / "middle_json.json").read_text(encoding="utf-8"))
    if middle.get("schema") != "docvortex.middle" or middle.get("schema_version") != "2.0":
        raise SidecarError(-32001, "MinerU MiddleJson schema is incompatible")
    return {"doc": {"engineVersion": PIN, "schema": middle["schema"],
                    "schemaVersion": middle["schema_version"]}}


def rebuild(params):
    if not CONFIGURED:
        raise SidecarError(-32002, "MinerU sidecar is not configured")
    try:
        renderer_version = version("docvortex")
    except PackageNotFoundError as exc:
        raise SidecarError(-32002, "DocVortex 0.6.21 is required for PDF replay") from exc
    if renderer_version != PDF_ENGINE_PIN:
        raise SidecarError(-32002, "DocVortex 0.6.21 is required for PDF replay")
    bundle, output = params.get("bundlePath"), params.get("outputPath")
    files, replacements = params.get("files"), params.get("replacements")
    if not isinstance(bundle, str) or not isinstance(output, str) or not isinstance(files, list) or not isinstance(replacements, list) or params.get("layout") != "original":
        raise SidecarError(-32001, "MinerU replay request is invalid")
    root = Path(bundle)
    if not root.is_dir() or root.resolve() != root or not Path(output).parent.is_dir() or Path(output).parent.resolve() != Path(output).parent:
        raise SidecarError(-32001, "MinerU replay paths are invalid")
    recorded = set()
    verified_images = {}
    saved_middle = None
    for row in files:
        if not isinstance(row, dict) or not isinstance(row.get("path"), str) or not isinstance(row.get("sha256"), str) or not isinstance(row.get("size"), int):
            raise SidecarError(-32001, "MinerU replay inventory is invalid")
        relative = Path(row["path"])
        if relative.is_absolute() or ".." in relative.parts or row["path"] in recorded:
            raise SidecarError(-32001, "MinerU replay inventory is invalid")
        recorded.add(row["path"])
        target = root / relative
        if not target.is_file() or target.resolve() != target:
            raise SidecarError(-32001, "MinerU saved resource is unavailable")
        data = target.read_bytes()
        if len(data) != row["size"] or hashlib.sha256(data).hexdigest() != row["sha256"]:
            raise SidecarError(-32001, "MinerU saved resource changed")
        if row["path"] == "middle_json.json":
            saved_middle = data
        if row["path"].startswith("images/"):
            verified_images[row["path"]] = data
    if "middle_json.json" not in recorded or "source.pdf" not in recorded:
        raise SidecarError(-32001, "MinerU saved result is incomplete")
    middle = json.loads(saved_middle.decode("utf-8"))
    if middle.get("schema") != "docvortex.middle" or middle.get("schema_version") != "2.0" or middle.get("metadata", {}).get("producer", {}).get("version") != PIN:
        raise SidecarError(-32001, "MinerU MiddleJson version is incompatible")
    seen = set()
    for row in replacements:
        if not isinstance(row, dict) or not isinstance(row.get("pageIndex"), int) or not isinstance(row.get("blockIndex"), int) or not isinstance(row.get("text"), str) or not row["text"].strip():
            raise SidecarError(-32001, "MinerU frozen text is invalid")
        page_index, block_index = row["pageIndex"], row["blockIndex"]
        part = row.get("part")
        if part is not None and part not in {"caption", "footnote"}:
            raise SidecarError(-32001, "MinerU frozen text part is invalid")
        key = (page_index, block_index, part, row.get("itemIndex"))
        if key in seen:
            raise SidecarError(-32001, "MinerU frozen text is duplicated")
        seen.add(key)
        try:
            page = next(page for page in middle["pages"] if page["page_idx"] == page_index)
            block = page["blocks"][block_index]
        except (KeyError, IndexError, StopIteration, TypeError) as exc:
            raise SidecarError(-32001, "MinerU frozen text position is invalid") from exc
        if block.get("index") != row.get("index") or block.get("bbox") != row.get("bbox"):
            raise SidecarError(-32001, "MinerU frozen block identity is incompatible")
        target = block
        if part is None:
            if block.get("type") not in {"text", "doc_title", "paragraph_title", "title", "paragraph", "caption", "list_item", "list-item", "footnote"}:
                raise SidecarError(-32001, "MinerU frozen block type is incompatible")
        else:
            child_order = row.get("childOrder")
            if not isinstance(child_order, int) or child_order < 0 or not isinstance(row.get("itemIndex"), int) or row["itemIndex"] < 0:
                raise SidecarError(-32001, "MinerU frozen annotation position is invalid")
            try:
                target = block["content"][child_order]
            except (KeyError, IndexError, TypeError) as exc:
                raise SidecarError(-32001, "MinerU frozen annotation position is invalid") from exc
            if (not isinstance(target, dict) or target.get("type") != row.get("childType") or
                    not isinstance(target.get("type"), str) or
                    not (target["type"] == part or target["type"].endswith("_" + part)) or
                    target.get("index") != row.get("childIndex") or target.get("bbox") != row.get("childBbox")):
                raise SidecarError(-32001, "MinerU frozen annotation identity is incompatible")
            matching = [(position, child) for position, child in enumerate(block["content"])
                        if isinstance(child, dict) and isinstance(child.get("type"), str) and
                        (child["type"] == part or child["type"].endswith("_" + part))]
            matching.sort(key=lambda item: (item[1].get("index") is None,
                                            item[1].get("index") or 0, item[0]))
            if row["itemIndex"] >= len(matching) or matching[row["itemIndex"]][1] is not target:
                raise SidecarError(-32001, "MinerU frozen annotation order is incompatible")
        spans = target.get("content")
        if not isinstance(spans, list) or len(spans) != 1 or not isinstance(spans[0], dict) or spans[0].get("type") != "text" or spans[0].get("content") != row.get("sourceText"):
            raise SidecarError(-32001, "MinerU complex inline text needs manual review")
        spans[0]["content"] = row["text"]
    from mineru.parser.base import ParseResult
    from mineru.render import PdfLayout, render_pdf
    # DocVortex 0.6.21 catches PdfAssetError and may emit a placeholder PDF.
    # Collect its structured diagnostics rather than treating bytes alone as success.
    from docvortex.render._internal.pdf.diagnostics import collect_pdf_diagnostics

    with contextlib.redirect_stdout(sys.stderr):
        document = ParseResult.from_dict(middle).middle_json
        missing_assets = []
        def asset_resolver(relative):
            if relative not in verified_images:
                missing_assets.append(True)
                raise ValueError("MinerU PDF asset is unavailable")
            return verified_images[relative]
        with collect_pdf_diagnostics() as diagnostics:
            rendered = render_pdf(document, asset_resolver=asset_resolver, layout=PdfLayout.ORIGINAL)
    if missing_assets or any(item.code == "pdf_image_unavailable" for item in diagnostics):
        raise SidecarError(-32001, "MinerU PDF image could not be replayed")
    with open(output, "xb") as stream:
        stream.write(rendered)
    return {"sha256": hashlib.sha256(rendered).hexdigest(), "size": len(rendered)}


def dispatch(request):
    global HANDSHAKEN
    if not isinstance(request, dict) or request.get("jsonrpc") != "2.0" or not isinstance(request.get("method"), str):
        raise SidecarError(-32600, "Invalid JSON-RPC request")
    params = request.get("params") or {}
    if not isinstance(params, dict):
        raise SidecarError(-32602, "Invalid JSON-RPC params")
    method = request["method"]
    if method == "handshake":
        if params.get("protocolVersion") != PROTOCOL:
            raise SidecarError(-32002, "MinerU sidecar protocol version is incompatible")
        HANDSHAKEN = True
        return {"protocolVersion": PROTOCOL, "capabilities": {"parse": ["pdf"], "rebuild": ["pdf"]}}
    if method == "configure":
        return configure(params)
    if method == "parse":
        return parse(params)
    if method == "rebuild":
        return rebuild(params)
    if method == "shutdown":
        return None
    raise SidecarError(-32601, "Unknown MinerU sidecar method")


def send(message):
    sys.stdout.write(json.dumps(message, ensure_ascii=False) + "\n")
    sys.stdout.flush()


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
            if request["method"] == "shutdown":
                return
        except Exception as exc:
            diagnostic = traceback.format_exc()[-4096:]
            sys.stderr.write(diagnostic)
            send({"jsonrpc": "2.0", "id": request.get("id") if isinstance(request, dict) else None,
                  "error": {"code": exc.code if isinstance(exc, SidecarError) else -32001,
                            "message": exc.message if isinstance(exc, SidecarError) else "MinerU parse failed",
                            "diagnostic": diagnostic}})


if __name__ == "__main__":
    main()
