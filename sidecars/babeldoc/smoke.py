"""Run a real capture and identity replay against an original test PDF."""

import argparse
import json
import subprocess
import sys
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("pdf", type=Path)
    parser.add_argument("--assets", type=Path, default=Path.home() / ".cache/babeldoc")
    parser.add_argument("--work", type=Path, required=True)
    args = parser.parse_args()
    args.work.mkdir(parents=True, exist_ok=True)
    process = subprocess.Popen(
        [sys.executable, str(Path(__file__).with_name("server.py"))],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=args.work.joinpath("engine.log").open("w", encoding="utf-8"),
        text=True,
        encoding="utf-8",
        bufsize=1,
    )
    counter = 0

    def call(method, params):
        nonlocal counter
        counter += 1
        process.stdin.write(
            json.dumps(
                {"jsonrpc": "2.0", "id": counter, "method": method, "params": params}
            )
            + "\n"
        )
        process.stdin.flush()
        while True:
            response = json.loads(process.stdout.readline())
            if response.get("id") == counter:
                if "error" in response:
                    raise RuntimeError(response["error"])
                return response.get("result")

    try:
        call("handshake", {"protocolVersion": 1})
        call(
            "configure",
            {
                "modelDirs": {"babeldoc": str(args.assets)},
                "options": {"workDir": str(args.work)},
            },
        )
        doc = call(
            "parse", {"path": str(args.pdf.resolve()), "options": {"language": "en"}}
        )["doc"]
        binding = {**doc["sourceBinding"], "sourcePath": str(args.pdf.resolve())}
        frozen = {
            "document": {"language": "en"},
            "snapshot": {"targetLang": "zh"},
            "sourceBinding": binding,
            "units": [
                {
                    "unit": {
                        "id": f"test-{item['order']}",
                        "order": item["order"],
                        "sourceText": item["sourceText"],
                    },
                    "decision": {
                        "type": "revision" if item["translatable"] else "keepOriginal"
                    },
                    "text": item["sourceText"],
                }
                for item in doc["units"]
            ],
        }
        doc_ref = args.work / "source.json"
        revision_ref = args.work / "snapshot.json"
        doc_ref.write_text(
            json.dumps({"document": frozen["document"], "sourceBinding": binding}),
            encoding="utf-8",
        )
        revision_ref.write_text(json.dumps(frozen), encoding="utf-8")
        result = call(
            "rebuild",
            {
                "docRef": str(doc_ref),
                "revisionsRef": str(revision_ref),
                "out": str(args.work / "identity.pdf"),
                "format": "pdf",
            },
        )
        print(
            json.dumps(
                {
                    "units": len(doc["units"]),
                    "uncalled": doc["sourceCoverage"]["uncalled"],
                    "result": result,
                },
                ensure_ascii=False,
            )
        )
        call("shutdown", {})
    finally:
        if process.poll() is None:
            process.kill()
        process.wait()


if __name__ == "__main__":
    main()
