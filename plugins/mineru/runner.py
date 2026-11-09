# SPDX-License-Identifier: MIT
"""MinerU 4.0.10 parse-only NDJSON JSON-RPC 2.0 sidecar."""
import contextlib
import json
import os
import socket
import sys
import traceback
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path

PIN = "4.0.10"
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
        return {"protocolVersion": PROTOCOL, "capabilities": {"parse": ["pdf"], "rebuild": []}}
    if method == "configure":
        return configure(params)
    if method == "parse":
        return parse(params)
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
