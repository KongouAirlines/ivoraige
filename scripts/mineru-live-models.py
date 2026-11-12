# SPDX-License-Identifier: MIT
"""Explicitly fetch and verify the pinned official ONNX files for a local test."""
import hashlib
import json
import sys
from pathlib import Path


def main():
    if len(sys.argv) != 3 or sys.argv[2] not in {"--download", "--verify"}:
        raise SystemExit("usage: mineru-live-models.py RUN_DIR --download|--verify (download is about 858 MB)")

    run = Path(sys.argv[1]).resolve()
    home = run / "mineru-home"
    root = home / "models" / "MinerU-4_models_onnx"
    root.mkdir(parents=True, exist_ok=True)
    if sys.argv[2] == "--download":
        from huggingface_hub import snapshot_download

        snapshot_download(
            repo_id="opendatalab/MinerU-4_models_onnx",
            revision="358310b4f64b95f9fefc372ad899356e4111f376",
            local_dir=str(root),
            cache_dir=str(run / "cache"),
        )
    inventory = Path(__file__).resolve().parent.parent / "docs/plan/0.1.x/evidence/mineru-onnx-sha256.json"
    rows = json.loads(inventory.read_text(encoding="utf-8"))
    for row in rows:
        path = root / row["path"]
        if not path.is_file() or path.resolve() != path:
            raise ValueError("Pinned model file is missing or outside the local model directory")
        digest = hashlib.sha256()
        with path.open("rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(chunk)
        if path.stat().st_size != row["size"] or digest.hexdigest() != row["sha256"]:
            raise ValueError("Pinned model file size or digest differs")
    manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
    by_path = {row["path"]: row for row in rows}
    for row in manifest["files"]:
        observed = by_path[row["path"]]
        if observed["size"] != row["size"] or observed["sha256"] != row["sha256"]:
            raise ValueError("Model manifest does not match the pinned repository files")
    print(f"Verified {len(rows)} pinned files and {len(manifest['files'])} model-manifest hashes")


if __name__ == "__main__":
    main()
